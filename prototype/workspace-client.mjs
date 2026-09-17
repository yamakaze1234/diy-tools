import {randomUUID} from 'node:crypto';
import {SyncClient} from './sync-client.mjs';
export class WorkspaceClient extends SyncClient{
 async run(){try{
  this.progress={phase:'upload',cursor:this.store.meta('cursor')||0};
  for(let i=0;i<1000;i++){const batch=this.store.nextBatch();if(!batch.length)break;
   const response=await this.call({protocolVersion:2,action:'sync.pushBatch',requestId:randomUUID(),payload:{requests:batch}});
   if(!response.ok||response.results?.length!==batch.length)throw Error(response.message||response.code||'云端批次结果无效');
   this.store.acknowledgeBatch(batch,response.results);
  }
  if(this.store.status().uncertain)throw Error('提交结果待确认');
  let headSeq;
  for(let i=0;i<5000;i++){const page=await this.call({protocolVersion:2,action:'sync.pull',requestId:randomUUID(),payload:{cursor:this.store.meta('cursor')||0,...(headSeq===undefined?{}:{headSeq}),limit:100}});
   if(!page.ok)throw Error(page.message||page.code||'拉取失败');headSeq??=page.headSeq;this.store.applyPage(page);this.progress={phase:'download',cursor:page.nextCursor,total:headSeq};
   if(!page.hasMore){this.lastError=null;this.lastSyncedAt=new Date().toISOString();return this.status();}
  }throw Error('本轮同步达到上限，下轮继续');
 }catch(e){this.lastError=e.message;throw e;}}
 status(){return {...super.status(),progress:this.progress||null};}
}
