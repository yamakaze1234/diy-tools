import {randomUUID} from 'node:crypto';
import {SyncClient} from './sync-client.mjs';
export class WorkspaceClient extends SyncClient{
 async run(){try{
  // Resolve an immutable request first. New drafts are sent only after pulling
  // the remote baseline, so compaction cannot invalidate their base version.
  if(this.store.status().uncertain)await this.upload(true);
  await this.pull();
  await this.upload(false);
  await this.pull();
  this.lastError=null;this.lastSyncedAt=new Date().toISOString();return this.status();
 }catch(e){this.lastError=e.message;throw e;}}
 async upload(uncertainOnly){
  this.progress={phase:'upload',cursor:this.store.meta('cursor')||0};
  for(let i=0;i<1000;i++){if(uncertainOnly&&!this.store.status().uncertain)break;const batch=this.store.nextBatch();if(!batch.length)break;
   const response=await this.call({protocolVersion:2,action:'sync.pushBatch',requestId:randomUUID(),payload:{requests:batch}});
   if(!response.ok||response.results?.length!==batch.length)throw Error(response.message||response.code||'云端批次结果无效');
   this.store.acknowledgeBatch(batch,response.results);
  }
  if(this.store.status().uncertain)throw Error('提交结果待确认');
 }
 async pull(){
  let headSeq;
  for(let i=0;i<5000;i++){const page=await this.call({protocolVersion:2,action:'sync.pull',requestId:randomUUID(),payload:{cursor:this.store.meta('cursor')||0,...(headSeq===undefined?{}:{headSeq}),limit:100}});
   if(page.code==='SNAPSHOT_REQUIRED'){await this.checkpoint();headSeq=undefined;continue;}
   if(!page.ok)throw Error(page.message||page.code||'拉取失败');headSeq??=page.headSeq;this.store.applyPage(page);this.progress={phase:'download',cursor:page.nextCursor,total:headSeq};
   if(!page.hasMore)return;
  }throw Error('本轮同步达到上限，下轮继续');
 }
 async checkpoint(){
  for(let attempt=0;attempt<3;attempt++){
   let seq,cursor=null,restart=false;
   for(let pageNumber=0;pageNumber<5000;pageNumber++){
    const result=await this.call({protocolVersion:2,action:'sync.snapshot',requestId:randomUUID(),payload:{cursor,limit:100,...(seq===undefined?{}:{checkpointSeq:seq})}});
    if(result.code==='SNAPSHOT_CHANGED'){restart=true;break;}
    if(!result.ok||!Number.isSafeInteger(result.checkpointSeq)||!Array.isArray(result.records)||(result.hasMore&&(!Array.isArray(result.nextCursor)||result.nextCursor.length!==2)))throw Error(result.message||result.code||'检查点分页无效');
    if(seq===undefined){seq=result.checkpointSeq;this.store.beginCheckpoint(seq);}
    if(result.checkpointSeq!==seq||result.hasMore&&!result.records.length)throw Error('检查点分页不连续');
    this.store.stageCheckpointPage(seq,result.records);cursor=result.nextCursor;
    this.progress={phase:'checkpoint',cursor:pageNumber+1};
    if(!result.hasMore){this.store.finishCheckpoint(seq);return;}
   }
   if(!restart)throw Error('检查点分页达到上限');
  }
  throw Error('检查点持续变化，请稍后重试');
 }
 status(){return {...super.status(),progress:this.progress||null};}
}
