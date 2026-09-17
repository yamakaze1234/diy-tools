import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {mergeRecord,validateRecord,equal} from '../../shared/sync/protocol.mjs';
import {previewMigration} from '../../shared/sync/migration-preview.mjs';
import {SyncStore} from '../local-store/sync-store.mjs';
import {SyncClient} from '../sync-client.mjs';
import {cloudTransport} from '../cloud-transport.mjs';
const config=(id='c')=>({id,name:'测试',shopId:'intel',priceCents:100000,parts:[{lineId:'line-1',goodsId:'3800690311462781053',qty:1}],note:'原备注'});
const mem=()=>{const s=new SyncStore(':memory:');s.bind('test','member-a');return s;};
const record=(data,version=1,seq=1)=>({type:'configuration',id:data.id,data,version,seq});
function receive(store,...changes){store.applyPage({ok:true,changes,headSeq:changes.at(-1)?.seq||0,nextCursor:changes.at(-1)?.seq||0,hasMore:false});}

test('三方合并不同字段、同值、空值与缺省字段',()=>{
 const base={a:1,b:2,c:'old'},local={a:2,b:2,c:null},remote={a:1,b:3,c:'old'};
 assert.deepEqual(mergeRecord(base,local,remote),{value:{a:2,b:3,c:null},fields:[]});
 assert.deepEqual(mergeRecord({a:1},{},{a:2}).fields,['a']);
 assert.equal(equal({b:2,a:1},{a:1,b:2}),true);
});
test('删除与编辑冲突；配件更换与数量变化不机械合并',()=>{
 const b=config(),l=structuredClone(b),r=structuredClone(b);l.parts[0].goodsId='999';r.parts[0].qty=2;
 assert.deepEqual(mergeRecord(b,l,r).fields,['parts']);
 assert.deepEqual(mergeRecord(b,{...b,deletedAt:new Date().toISOString()},{...b,name:'变更'}).fields,['$record']);
});
test('真实长 ID、整数分、来源确定键与稳定行 ID 校验',()=>{
 assert.doesNotThrow(()=>validateRecord('configuration','c',config()));
 assert.throws(()=>validateRecord('configuration','c',{...config(),skuId:3800690311462781053}));
 assert.throws(()=>validateRecord('configuration','c',{...config(),priceCents:1.2}));
 assert.throws(()=>validateRecord('component','bad',{erpScopeId:'scope',goodsId:'123',taxCents:2}));
 assert.doesNotThrow(()=>validateRecord('component','scope|123',{erpScopeId:'scope',goodsId:'123',taxCents:null}));
});
test('保存后重启，草稿与已经发出的原请求仍在',()=>{
 const dir=new URL('../.verification/sync-tests/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
 // Decode Windows/Chinese file URLs through the platform API below.
 const u=new URL(randomUUID()+'.sqlite',dir);
 const s=new SyncStore(u);s.bind('test','member-a');s.edit('configuration','c',config());const req=s.nextRequest();s.close();
 const reopened=new SyncStore(u);assert.deepEqual(reopened.nextRequest(),req);assert.equal(reopened.get('configuration','c').draft.parts[0].goodsId,'3800690311462781053');reopened.close();
});
test('确认回执时继续编辑，不覆盖新输入',()=>{
 const s=mem();s.edit('configuration','c',config());const req=s.nextRequest();s.edit('configuration','c',{...config(),note:'发送期间输入'});
 s.acknowledge(req,{ok:true,record:record({...config(),name:'云端合并'},1)});
 assert.equal(s.get('configuration','c').draft.note,'发送期间输入');assert.equal(s.get('configuration','c').draft.name,'云端合并');assert.equal(s.status().pending,1);s.close();
});
test('固定上界分页：序号不连续时整页回滚且不推进游标',()=>{
 const s=mem();receive(s,record(config(),1,1));assert.throws(()=>receive(s,record({...config(),note:'跳页'},2,3)));assert.equal(s.meta('cursor'),1);assert.equal(s.get('configuration','c').draft.note,'原备注');s.close();
});
test('冲突只阻塞当前记录，其他记录继续；解决时用所见云端版本',()=>{
 const s=mem();receive(s,record(config(),1,1));s.edit('configuration','c',{...config(),name:'我的'});const req=s.nextRequest();
 s.acknowledge(req,{ok:false,code:'CONFLICT',fields:['name'],base:config(),remote:record({...config(),name:'他的'},2,2)});
 s.edit('configuration','d',config('d'));assert.equal(s.nextRequest().payload.entityId,'d');s.resolve('configuration','c','local');assert.equal(s.get('configuration','c').version,2);assert.equal(s.get('configuration','c').draft.name,'我的');s.close();
});
test('云端成功但响应丢失，重试保持同一 ID 和请求体',async()=>{
 const s=mem();s.edit('configuration','c',config());let seen,tries=0,writes=0;const receipts=new Map();
 const call=async req=>{if(req.action==='sync.pull')return {ok:true,changes:[record(config())],headSeq:1,nextCursor:1,hasMore:false};tries++;seen??=req;assert.deepEqual(req,seen);if(!receipts.has(req.payload.mutationId)){receipts.set(req.payload.mutationId,{ok:true,record:record(config())});writes++;}if(tries===1)throw Error('响应丢失');return receipts.get(req.payload.mutationId);};
 const c=new SyncClient(s,call);await assert.rejects(c.cycle());assert.equal(s.status().uncertain,1);await c.cycle();assert.equal(writes,1);assert.equal(s.status().pending,0);s.close();
});
test('云端拉取保留本地草稿并合并独立字段',()=>{
 const s=mem();receive(s,record(config(),1,1));s.edit('configuration','c',{...config(),name:'我的名称'});receive(s,record({...config(),note:'远端备注'},2,2));assert.equal(s.get('configuration','c').draft.name,'我的名称');assert.equal(s.get('configuration','c').draft.note,'远端备注');s.close();
});
test('备份验证哈希，在空白库恢复包括待确认请求',()=>{
 const s=mem();s.edit('configuration','c',config());const req=s.nextRequest(),backup=s.backup(),other=new SyncStore(':memory:');other.restore(backup);assert.deepEqual(other.nextRequest(),req);assert.equal(other.status().uid,'member-a');assert.throws(()=>other.restore(backup));const empty=new SyncStore(':memory:');assert.throws(()=>empty.restore({...backup,content:backup.content+' '}));s.close();other.close();empty.close();
});
test('成员或工作区不能静默换绑',()=>{const s=mem();assert.throws(()=>s.bind('other','member-a'));assert.throws(()=>s.bind('test','member-b'));s.close();});
test('迁移预览不改输入，缺来源和原图单独列出，正式数据不能自动发布',()=>{
 const state={configs:[{...config(),price:1000,caseImage:'/uploads/a.png'}],costSource:[{goodsId:'123',name:'成本',tax:2}],templates:[],sourceCatalog:[]},before=structuredClone(state);const p=previewMigration(state);assert.deepEqual(state,before);assert.equal(p.readyForProduction,false);assert.ok(p.issues.some(i=>i.code==='ERP_SCOPE_UNKNOWN'));assert.ok(p.issues.some(i=>i.code==='ASSET_PENDING'));
});


test('编辑表单期间到达的独立云端字段不会被旧表单覆盖',()=>{
 const s=mem(),snapshot=config();receive(s,record(snapshot));
 receive(s,record({...snapshot,note:'别人刚保存的备注'},2,2));
 s.edit('configuration','c',{...snapshot,name:'我正在输入的名称'},snapshot);
 assert.equal(s.get('configuration','c').draft.name,'我正在输入的名称');
 assert.equal(s.get('configuration','c').draft.note,'别人刚保存的备注');s.close();
});
test('编辑表单期间同字段变化时拒绝覆盖，保留最新本地状态',()=>{
 const s=mem(),snapshot=config();receive(s,record(snapshot));
 receive(s,record({...snapshot,name:'别人刚保存的名称'},2,2));
 assert.throws(()=>s.edit('configuration','c',{...snapshot,name:'我的名称'},snapshot),/编辑期间已变化/);
 assert.equal(s.get('configuration','c').draft.name,'别人刚保存的名称');s.close();
});

test('失效用户会话返回可识别错误，队列保留等待重新登录',async()=>{
 const cfg={envId:'test-env',functionName:'workbenchApi'};
 for(const response of [{ok:false,status:401,json:async()=>({code:'EXPIRED'})},{ok:true,status:200,json:async()=>({ok:false,code:'UNAUTHENTICATED'})}]){
  const s=mem();s.edit('configuration','c',config());const c=new SyncClient(s,cloudTransport(cfg,()=> 'invalid',async()=>response));
  await assert.rejects(c.cycle(),{code:'UNAUTHENTICATED'});assert.equal(s.status().uncertain,1);assert.equal(s.get('configuration','c').draft.name,'测试');s.close();
 }
});
