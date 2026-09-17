import test from 'node:test';
import assert from 'node:assert/strict';
import {addonCheck,validateAddon,addonBatchPlan,addonKey} from '../addon-data.js';
import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';
const costs=[{goodsId:'1',name:'风扇',erp:20,tax:18},{goodsId:'2',name:'灯带',erp:40,tax:30}];
const a={text:'整组灯效升级',items:[{goodsId:'1',qty:3},{goodsId:'2',qty:1}],priceCents:12000};
test('独立组合按各自数量合计成本，仅一个总报价与描述',()=>{
 validateAddon(a,{required:true,costs});const r=addonCheck(a,costs);
 assert.deepEqual(r.fields.map(f=>f.costCents),[10000,8400]);
 assert.deepEqual(r.fields.map(f=>f.diffCents),[2000,3600]);assert.equal(r.reason,'');
 const linked=addonCheck({...a,sourceId:'old',originalQty:2},costs,[{sourceId:'old',erp:10,tax:8}]);
 assert.deepEqual(linked.fields.map(f=>f.diffCents),[4000,5200]);
 assert.equal(addonCheck(a,[costs[0]]).severity,'pending');
 assert.equal(addonCheck({...a,priceCents:1000},costs).needsAdjustment,true);
 assert.throws(()=>validateAddon({...a,items:[{goodsId:'1',qty:0}]}),/数量/);
});
test('组合批量改文案和工作台投影往返不拆条、不丢失商品',()=>{
 const state={configs:[{id:'c',shopId:'intel',price:100,parts:[],addons:[a]}],sourceCatalog:[],templates:[],costSource:costs,caseGallery:[],shopSettings:{intel:{coupon:0}}};
 const restored=applyWorkspace(state,projectWorkspace(state));assert.deepEqual(restored.configs[0].addons,[a]);
 const plan=addonBatchPlan(state.configs,addonKey(a),{text:'组合新描述'},{costs});
 assert.equal(plan.changes[0].after.addons.length,1);assert.deepEqual(plan.changes[0].after.addons[0].items,a.items);
});
