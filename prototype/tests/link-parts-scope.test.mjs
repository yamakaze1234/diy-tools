import test from 'node:test';
import assert from 'node:assert/strict';
import {linkPartsPlan,scopedPartUsage,linkPartsDiff} from '../link-parts.js';
import {applyReplacement,validateReplacement} from '../global-batch.js';
const part=(id,qty=1)=>({slot:'内存',name:'配件'+id,goodsId:id,qty});
const config=()=>({id:'c',productId:'p',product:'链接',name:'配置1',parts:[part('1')],actualParts:[part('2',2)],addons:[]});
const row={sourceId:'new',goodsId:'3',name:'新配件'};
for(const scope of [{parts:true,actualParts:false},{parts:false,actualParts:true},{parts:true,actualParts:true}])test('替换隔离 '+JSON.stringify(scope),()=>{
 const c=config();c.actualParts[0].goodsId='1';const before=structuredClone(c);
 const plan=linkPartsPlan([c],{scope,partKey:'id:1',row});applyReplacement(plan,[c]);
 assert.equal(c.parts[0].goodsId,scope.parts?'3':'1');assert.equal(c.actualParts[0].goodsId,scope.actualParts?'3':'1');assert.equal(c.actualParts[0].qty,2);
 if(!scope.parts)assert.deepEqual(c.parts,before.parts);if(!scope.actualParts)assert.deepEqual(c.actualParts,before.actualParts);
 assert.match(linkPartsDiff(plan),scope.parts?/展示配件/:/实际配置/);
});
test('默认全选，搜索实际独有配件，只替换命中的实际行',()=>{
 const c=config(),scope={parts:true,actualParts:true};assert.equal(scopedPartUsage([c],'2',scope)[0].count,1);
 const plan=linkPartsPlan([c],{partKey:'id:2',row});assert.deepEqual(plan.changes[0].after.parts,c.parts);assert.equal(plan.changes[0].after.actualParts[0].goodsId,'3');
});
test('展示单独修改旧数据时保留原实际清单，空勾选拒绝',()=>{
 const c=config();delete c.actualParts;const plan=linkPartsPlan([c],{scope:{parts:true},partKey:'id:1',row});assert.deepEqual(plan.changes[0].after.actualParts,c.parts);
 assert.throws(()=>linkPartsPlan([c],{scope:{},row}),/至少勾选/);
});
test('添加仅检查所选清单的槽位，全选时同时添加',()=>{
 const c=config();c.actualParts=[];
 const plan=linkPartsPlan([c],{scope:{actualParts:true},mode:'add',row,slot:'内存',qty:3});assert.equal(plan.changes[0].after.actualParts[0].qty,3);assert.deepEqual(plan.changes[0].after.parts,c.parts);
 assert.throws(()=>linkPartsPlan([c],{mode:'add',row,slot:'内存',qty:3}),/已有配件/);
 const both=linkPartsPlan([c],{mode:'add',row,slot:'风扇',qty:2});assert.equal(both.changes[0].after.parts.at(-1).qty,2);assert.equal(both.changes[0].after.actualParts.at(-1).qty,2);
});

test('批量预览快照隔离完整配置，后置冲突阻止整个批次',()=>{
 const configs=Array.from({length:80},(_,i)=>({...config(),id:'c'+i,modules:[{text:'保留版式'}],custom:{nested:['保留数据']}}));
 const before=structuredClone(configs);
 const plan=linkPartsPlan(configs,{mode:'add',row,slot:'风扇',qty:2});
 assert.deepEqual(configs,before);
 validateReplacement(plan,configs);
 assert.deepEqual(configs,before);
 assert.deepEqual(plan.changes[0].after.modules,before[0].modules);
 plan.changes[0].after.custom.nested.push('预览副本');
 assert.deepEqual(configs[0].custom,before[0].custom);
 configs.at(-1).modules[0].text='预览后编辑';
 assert.throws(()=>applyReplacement(plan,configs),/配置已变化/);
 assert.deepEqual(configs[0],before[0]);
});
