import {equal,mergeRecord} from '../shared/sync/protocol.mjs';
import {stripLocalErp,keepCloudType} from '../prototype/local-erp-policy.mjs';
const copy=v=>structuredClone(v);
export const envelope=(action,payload={})=>({protocolVersion:2,action,requestId:crypto.randomUUID(),payload});
export const emptySync=member=>({workspaceId:member.workspaceId,uid:member.uid,deviceId:crypto.randomUUID(),cursor:0,records:[],outbox:null,lastSyncedAt:null});
const recordIndexes=new WeakMap();
export function record(sync,type,id){let index=recordIndexes.get(sync.records);if(!index||index.count>sync.records.length){index={count:0,rows:new Map()};recordIndexes.set(sync.records,index);}for(;index.count<sync.records.length;index.count++){const r=sync.records[index.count];index.rows.set(JSON.stringify([r.type,r.id]),r);}return index.rows.get(JSON.stringify([type,id]));}
export const pending=sync=>sync.records.filter(r=>!equal(r.base,r.draft));
export function editRecord(sync,type,id,data){
 if(!['source','configuration','component','template','settings'].includes(type))throw Error('网页版不支持修改此记录类型');
 const clean=stripLocalErp(data);
 if(new TextEncoder().encode(JSON.stringify(clean)).length>250000)throw Error('记录过大，无法同步');
 let r=record(sync,type,id);if(!r){r={type,id,base:null,version:0,draft:null,conflict:null};sync.records.push(r);}
 if(r.conflict)throw Error('此记录存在同步冲突，请先处理');
 r.draft=clean;
}
export function receive(sync,change){
 if(!keepCloudType(change.type))return;
 const remote={...change,data:stripLocalErp(change.data)},r=record(sync,remote.type,remote.id);
 if(!Number.isSafeInteger(remote.version)||remote.version<1||!remote.data||typeof remote.id!=='string')throw Error('云端记录格式无效');
 if(r&&remote.version<=r.version)return;
 if(!r){sync.records.push({type:remote.type,id:remote.id,base:copy(remote.data),draft:copy(remote.data),version:remote.version,conflict:null});return;}
 const merged=mergeRecord(r.base,r.draft,remote.data);
 r.conflict=r.conflict|| (merged.fields.length?{fields:merged.fields,remote:copy(remote)}:null);
 // A later remote edit must replace the conflict's remote revision too.
 if(r.conflict)r.conflict.remote=copy(remote);
 r.base=copy(remote.data);r.version=remote.version;r.draft=merged.value;
}
export function applyPage(sync,page){
 if(!page.ok||!Array.isArray(page.changes)||!Number.isSafeInteger(page.headSeq)||page.headSeq<sync.cursor||!Number.isSafeInteger(page.nextCursor))throw Error(page.message||'同步分页格式无效');
 let cursor=sync.cursor;
 for(const change of page.changes){if(change.seq!==cursor+1||change.seq>page.headSeq)throw Error('同步序号不连续，已保留原游标');receive(sync,change);cursor=change.seq;}
 if(page.nextCursor!==cursor||(page.hasMore&&!page.changes.length)||(!page.hasMore&&cursor!==page.headSeq))throw Error('云端游标不完整');
 sync.cursor=cursor;
}
export function acknowledge(sync,result){
 const req=sync.outbox;if(!req)throw Error('缺少待确认提交');
 const {entityType,entityId,after}=req.payload,r=record(sync,entityType,entityId);
 if(result.code==='CONFLICT'){
  const remote=result.remote;if(!remote||!Number.isSafeInteger(remote.version)||!remote.data)throw Error('冲突回执无效');
  const merged=mergeRecord(r.base,r.draft,stripLocalErp(remote.data));
  r.base=stripLocalErp(remote.data);r.version=remote.version;r.draft=merged.value;r.conflict=merged.fields.length?{fields:merged.fields,remote:copy(remote)}:null;
 }else if(result.ok&&result.record){
  const remote=result.record;if(!Number.isSafeInteger(remote.version)||remote.version<r.version||!remote.data)throw Error('提交回执无效');
  const merged=mergeRecord(after,r.draft,stripLocalErp(remote.data));r.base=stripLocalErp(remote.data);r.version=remote.version;r.draft=merged.value;
  r.conflict=merged.fields.length?{fields:merged.fields,remote:copy(remote)}:null;
 }else throw Error(result.message||result.code||'提交结果待确认');
 sync.outbox=null;
}
export function resolve(sync,type,id,choice){
 const r=record(sync,type,id);if(!r?.conflict)throw Error('冲突已变化');
 if(!['local','remote'].includes(choice))throw Error('请选择保留的版本');
 if(choice==='remote')r.draft=copy(r.conflict.remote.data);
 r.base=copy(r.conflict.remote.data);r.version=r.conflict.remote.version;r.conflict=null;
}
// save is an atomic durable write of the full UI state and sync queue. Every
// immutable request is saved before network I/O; an uncertain retry reuses it.
export async function syncCycle({getSync,save,call,upload=true,onProgress=()=>{}}){
 if(upload)for(let n=0;n<10000;n++){
  let sync=copy(getSync());let req=sync.outbox;
  if(!req){const r=pending(sync).find(r=>!r.conflict);if(!r)break;req=envelope('sync.push',{mutationId:crypto.randomUUID(),deviceId:sync.deviceId,entityType:r.type,entityId:r.id,baseVersion:r.version,after:copy(r.draft)});sync.outbox=req;await save(sync);}
  onProgress('正在提交修改');const result=await call(req);sync=copy(getSync());acknowledge(sync,result);await save(sync);
 }
 if(getSync().outbox)throw Error('提交结果待确认，请重试原提交');
 let headSeq;
 for(let n=0;n<10000;n++){
  const cursor=getSync().cursor;onProgress('正在拉取更新：'+cursor);
  const page=await call(envelope('sync.pull',{cursor,limit:100,...(headSeq===undefined?{}:{headSeq})}));
  if(headSeq!==undefined&&page.headSeq!==headSeq)throw Error('云端分页快照已变化');
  headSeq??=page.headSeq;const sync=copy(getSync());applyPage(sync,page);await save(sync);
  if(!page.hasMore){sync.lastSyncedAt=new Date().toISOString();await save(sync);return;}
 }
 throw Error('本轮数据较多，请继续同步');
}
