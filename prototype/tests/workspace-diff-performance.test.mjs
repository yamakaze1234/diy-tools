import test from 'node:test';
import assert from 'node:assert/strict';
import {projectWorkspace,changesBetween} from '../workspace-records.mjs';
import {equal,recordKey} from '../../shared/sync/protocol.mjs';

const fixture=()=>({configs:Array.from({length:8},(_,i)=>({id:'c'+i,productId:'p',parts:[{slot:'CPU',goodsId:'123',name:'CPU',qty:1,tax:10}],addons:[],price:100})),costSource:[{goodsId:'123',name:'CPU',tax:10}],sourceCatalog:[{sourceId:'s',goodsId:'123',name:'CPU'}],templates:[],shopSettings:{intel:{coupon:0}},caseGallery:[]});
function fullDiff(before,after){
 const old=new Map(projectWorkspace(before).map(r=>[recordKey(r.type,r.id),r])),out=[];
 for(const r of projectWorkspace(after)){const key=recordKey(r.type,r.id),prev=old.get(key);if(!prev||!equal(prev.data,r.data))out.push({...r,expectedDraft:prev?.data});old.delete(key);}
 for(const r of old.values())out.push({...r,data:{...r.data,deletedAt:'removed'},expectedDraft:r.data});
 const legacy=new Set(before.configs.filter(c=>!Number.isFinite(c.workspaceOrder)).map(c=>c.id));
 for(const r of out)if(r.type==='configuration'&&legacy.has(r.id)&&r.expectedDraft)delete r.expectedDraft.workspaceOrder;
 return out;
}
for(const [name,edit] of Object.entries({
 part:s=>{s.configs[5].parts[0].qty=3;},
 reorder:s=>s.configs.reverse(),
 remove:s=>s.configs.splice(2,1),
 insert:s=>s.configs.splice(2,0,{id:'new',parts:[],addons:[],price:0}),
 tombstone:s=>{s.configs[3].deletedAt='deleted';},
 cost:s=>{s.costSource[0].tax=15;},
 scope:s=>{s.sharedCostScope='new';},
 source:s=>{s.sourceCatalog[0].name='updated';},
 sourceCost:s=>{s.sourceCatalog[0].name='updated';s.sourceCatalog[0].tax=15;s.costSource[0].tax=15;s.configs[0].parts[0].tax=15;},
 componentRemoved:s=>{s.costSource=[];},
 componentAdded:s=>{s.costSource.push({goodsId:'456',name:'新增',tax:12});s.sourceCatalog.push({sourceId:'new',goodsId:'456',name:'新增',tax:12});},
 inventoryOnly:s=>{s.costSource[0].localInventoryOnly=true;s.costSource[0].tax=null;},
 sourceRemoved:s=>{s.sourceCatalog=[];},
 sourceAdded:s=>{s.sourceCatalog.push({sourceId:'s2',goodsId:'123',shopId:'gigabyte',name:'跨店',addonChoices:[{text:'独立加购'}]});},
 sourceDeleted:s=>{s.sourceCatalog[0].deletedAt='deleted';},
 gallery:s=>{s.caseGallery.push({id:'gallery',name:'图片'});s.sourceCatalog[0].name='updated';},
 template:s=>{s.templates.push({id:'template',configs:[]});s.sourceCatalog[0].name='updated';},
 setting:s=>{s.shopSettings.intel.coupon=400;s.sourceCatalog[0].name='updated';}
}))test('增量对比与完整投影一致：'+name,()=>{
 const before=fixture(),after=structuredClone(before);edit(after);
 const actual=changesBetween(before,after);for(const c of actual)if(c.data.deletedAt&&c.data.deletedAt!=='deleted')c.data.deletedAt='removed';
 assert.deepEqual(actual,fullDiff(before,after));
});
test('配置未变化不生成记录，重复 ID 仍拒绝',()=>{
 const before=fixture(),after=structuredClone(before);after.configs[0].parts[0].tax=20;
 assert.deepEqual(changesBetween(before,after),[]);
 after.configs.push(structuredClone(after.configs[0]));assert.throws(()=>changesBetween(before,after),/重复记录/);
});
test('新增已有配件的共享成本时，重新比较其配置与输出源依赖',()=>{
 const before=fixture();before.costSource=[];before.sourceCatalog[0].tax=10;
 const after=structuredClone(before);after.costSource=[{goodsId:'123',name:'CPU',tax:10}];
 assert.deepEqual(changesBetween(before,after),fullDiff(before,after));
});
