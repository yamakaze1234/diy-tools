import test from 'node:test';
import assert from 'node:assert/strict';
import {linkPartsBatchPlan,linkPartsOverview} from '../link-parts.js';
import {applyReplacement} from '../global-batch.js';
const row=id=>({sourceId:'source-'+id,goodsId:id,name:'配件'+id,shopId:'intel'});
const part=(id,slot)=>({...row(id),slot,qty:2});
const config=id=>({id,shopId:'intel',productId:'p',product:'链接',name:id,parts:[part('1','CPU'),part('2','内存')],actualParts:[part('1','CPU'),part('2','内存')],addons:[],modules:[{text:'保留版式'}]});
const replace=(from,to)=>({mode:'replace',partKey:'id:'+from,row:row(to),qty:null});
const add=(id,slot)=>({mode:'add',row:row(id),slot,qty:3});

test('多次替换与多次新增合并为每套配置一个快照，预览无副作用',()=>{
 const configs=[config('a'),config('b')],before=structuredClone(configs);
 const plan=linkPartsBatchPlan(configs,{rules:[replace('1','10'),replace('2','20'),add('30','风扇'),add('40','配件1')]});
 assert.deepEqual(configs,before);assert.equal(plan.changes.length,2);
 assert.equal(plan.replacements.length,4);
 assert.equal(linkPartsOverview(plan).filter(r=>r.changed).length,16);
 applyReplacement(plan,configs);
 for(const c of configs){assert.deepEqual(c.parts.map(p=>p.goodsId),['10','20','30','40']);assert.deepEqual(c.actualParts.map(p=>p.qty),[2,2,3,3]);assert.deepEqual(c.modules,before[0].modules);}
});
test('按顺序执行替换链，总览直接展示原始值到最终值',()=>{
 const plan=linkPartsBatchPlan([config('a')],{rules:[replace('1','10'),replace('10','11')]});
 assert.equal(plan.changes[0].before.parts[0].goodsId,'1');assert.equal(plan.changes[0].after.parts[0].goodsId,'11');
 assert.equal(linkPartsOverview(plan)[0].before.goodsId,'1');assert.equal(linkPartsOverview(plan)[0].after.goodsId,'11');
});
test('后续规则占用槽位或无效时整个批次不修改数据',()=>{
 const configs=[config('a')],before=structuredClone(configs);
 assert.throws(()=>linkPartsBatchPlan(configs,{rules:[replace('1','10'),add('30','风扇'),add('40','风扇')]}),/第 3 条规则.*已有配件/);
 assert.deepEqual(configs,before);
 assert.throws(()=>linkPartsBatchPlan(configs,{rules:[replace('1','10'),{...add('30','风扇'),qty:0}]}),/第 2 条规则.*正整数/);
 assert.throws(()=>linkPartsBatchPlan(configs,{rules:[]}),/至少添加/);
 assert.throws(()=>linkPartsBatchPlan(configs,{rules:[{...replace('1','10'),row:{...row('10'),shopId:'jonsbo'}}]}),/当前店铺/);
});
test('仅实际配置范围和未选中配置保持隔离，过期预览阻止整批应用',()=>{
 const configs=[config('a'),config('b')],before=structuredClone(configs);
 const plan=linkPartsBatchPlan([configs[0]],{scope:{actualParts:true},rules:[replace('1','10'),add('30','风扇')]});
 applyReplacement(plan,configs);assert.deepEqual(configs[0].parts,before[0].parts);assert.deepEqual(configs[1],before[1]);
 const next=linkPartsBatchPlan(configs,{rules:[replace('2','20')]});configs[1].name='已变化';
 assert.throws(()=>applyReplacement(next,configs),/配置已变化/);assert.equal(configs[0].parts[1].goodsId,'2');
});
test('没有命中的规则显示零变化，全部总览仍包含原配件',()=>{
 const plan=linkPartsBatchPlan([config('a')],{rules:[replace('missing','10')]});
 assert.equal(plan.changes.length,0);assert.equal(plan.rules[0].count,0);assert.equal(linkPartsOverview(plan).length,4);
 assert.ok(linkPartsOverview(plan).every(r=>!r.changed));
});
