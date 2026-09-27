import test from 'node:test';
import assert from 'node:assert/strict';
import {SyncStore} from '../../prototype/local-store/sync-store.mjs';
import {WorkspaceClient} from '../../prototype/workspace-client.mjs';
import {insertConfigAfter} from '../../prototype/config-order.js';
import {projectWorkspace,applyWorkspace} from '../../prototype/workspace-records.mjs';
import {validateWorkspaceRecord} from '../../prototype/workspace-validation.mjs';
import {emptySync,syncCycle,record,editRecord,pending} from '../cloud-sync.mjs';
import {materialize,stageChanges} from '../cloud-adapter.mjs';
import {member,fixture,fakeCloud} from './cloud-fixture.mjs';

const copy=value=>structuredClone(value);
function harness(){
 const cloud=fakeCloud();
 const call=async request=>request.action==='sync.pushBatch'
  ? {ok:true,results:await Promise.all(request.payload.requests.map(item=>cloud.call(item)))}
  : cloud.call(request);
 const store=new SyncStore(':memory:',{protocolVersion:2,validate:validateWorkspaceRecord});
 store.bind(member.workspaceId,member.uid);
 const desktop=new WorkspaceClient(store,call);
 let webState=emptySync(member);
 const web={getSync:()=>webState,save:state=>{webState=copy(state);},call,view:()=>materialize(webState)};
 return {cloud,call,store,desktop,web};
}

test('桌面与网页经同一云端完成创建、复制排序、模板、双向编辑、删除与恢复',async t=>{
 const {store,desktop,web}=harness();t.after(()=>store.close());
 await desktop.cycle();await syncCycle({...web,upload:false});

 const initial=applyWorkspace(fixture(),store.list());
 const duplicate={...copy(initial.configs[0]),id:'cross-copy',name:'配置2'};
 const copied=insertConfigAfter(initial.configs,'config-one',duplicate);
 const projected=projectWorkspace({...initial,configs:copied}).find(row=>row.id==='cross-copy');
 store.edit(projected.type,projected.id,projected.data);
 store.edit('template','cross-template',{id:'cross-template',shopId:'intel',name:'跨端模板',configs:[copy(initial.configs[0])]});
 await desktop.cycle();await syncCycle({...web,upload:false});
 assert.deepEqual(web.view().configs.map(config=>config.id),['config-one','cross-copy']);
 assert.ok(record(web.getSync(),'configuration','config-one').draft.workspaceOrder<record(web.getSync(),'configuration','cross-copy').draft.workspaceOrder);
 assert.equal(web.view().templates.find(item=>item.id==='cross-template').name,'跨端模板');

 let before=web.view(),next=copy(before);
 next.configs.find(config=>config.id==='cross-copy').name='网页修改的配置';
 next.configs.push({...copy(next.configs[0]),id:'web-create',name:'配置3'});
 stageChanges(before,next);web.save(next.cloudSync);await syncCycle(web);
 await desktop.cycle();
 assert.equal(store.get('configuration','cross-copy').draft.name,'网页修改的配置');
 assert.ok(store.get('configuration','web-create').draft.workspaceOrder>store.get('configuration','cross-copy').draft.workspaceOrder);
 store.edit('configuration','cross-copy',{...store.get('configuration','cross-copy').draft,footer:'桌面修改的备注'});
 await desktop.cycle();await syncCycle({...web,upload:false});
 assert.equal(web.view().configs.find(config=>config.id==='cross-copy').footer,'桌面修改的备注');

 store.edit('configuration','cross-copy',{...store.get('configuration','cross-copy').draft,deletedAt:'2026-09-27T00:00:00.000Z'});
 await desktop.cycle();await syncCycle({...web,upload:false});
 assert.equal(web.view().configs.some(config=>config.id==='cross-copy'),false);
 const restored=copy(store.get('configuration','cross-copy').draft);delete restored.deletedAt;
 store.edit('configuration','cross-copy',restored);
 await desktop.cycle();await syncCycle({...web,upload:false});
 assert.deepEqual(web.view().configs.map(config=>config.id),['config-one','cross-copy','web-create']);
 assert.equal(web.view().configs[1].name,'网页修改的配置');
 assert.equal(pending(web.getSync()).length,0);
});

test('跨端独立字段合并；同字段冲突阻止网页覆盖桌面',async t=>{
 const {store,desktop,web,cloud}=harness();t.after(()=>store.close());
 await desktop.cycle();await syncCycle({...web,upload:false});
 let source=record(web.getSync(),'source','source-ssd');
 editRecord(web.getSync(),'source',source.id,{...source.draft,name:'网页离线名称'});
 store.edit('source',source.id,{...store.get('source',source.id).draft,upgrade:'桌面新增说明'});
 await desktop.cycle();await syncCycle(web);await desktop.cycle();
 source=record(web.getSync(),'source','source-ssd');
 assert.equal(source.draft.name,'网页离线名称');
 assert.equal(source.draft.upgrade,'桌面新增说明');
 assert.equal(store.get('source',source.id).draft.name,'网页离线名称');

 editRecord(web.getSync(),'source',source.id,{...source.draft,name:'网页冲突名称'});
 store.edit('source',source.id,{...store.get('source',source.id).draft,name:'桌面冲突名称'});
 await desktop.cycle();await syncCycle(web);
 assert.deepEqual(record(web.getSync(),'source',source.id).conflict.fields,['name']);
 assert.equal(cloud.records.get(JSON.stringify(['source',source.id])).data.name,'桌面冲突名称');
});

test('桌面批次生效后丢失回执，备份恢复沿用 mutationId 且网页只见一次修改',async()=>{
 const {store,desktop,web,cloud,call}=harness();
 await desktop.cycle();await syncCycle({...web,upload:false});
 const source=store.get('source','source-ssd');
 store.edit('source',source.id,{...source.draft,name:'断线后恢复'});
 let lost=true;
 desktop.call=async request=>{
  const response=await call(request);
  if(request.action==='sync.pushBatch'&&lost){lost=false;throw Error('模拟回执丢失');}
  return response;
 };
 await assert.rejects(desktop.cycle(),/模拟回执丢失/);
 const request=store.nextRequest(),mutationId=request.payload.mutationId;
 const count=cloud.log.length,backup=store.backup();store.close();
 const restarted=new SyncStore(':memory:',{protocolVersion:2,validate:validateWorkspaceRecord});
 try{
  restarted.restore(backup);
  assert.equal(restarted.nextRequest().payload.mutationId,mutationId);
  await new WorkspaceClient(restarted,call).cycle();
  assert.equal(cloud.log.length,count);
  assert.equal(restarted.status().uncertain,0);
  await syncCycle({...web,upload:false});
  assert.equal(web.view().sources.find(item=>item.sourceId==='source-ssd').name,'断线后恢复');
 }finally{restarted.close();}
});
