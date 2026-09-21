import test from 'node:test';
import assert from 'node:assert/strict';
import {checkInventory,componentStock,inventoryThreshold,stockReplacementPlan,validateStockReplacement} from '../inventory-check-data.js';
import {applyReplacement} from '../global-batch.js';
const costs=[{goodsId:'100',stockAvailable:0,stockUpdatedAt:'2026-09-18T10:00:00Z'},{goodsId:'200',stockAvailable:5},{goodsId:'300',stockAvailable:6},{goodsId:'400',stockAvailable:null}];
const original={sourceId:'old',goodsId:'100',name:'旧 CPU',qty:2,slot:'CPU',posterVisible:false,erp:100,tax:120};
const config=(id,productId)=>({id,productId,shopId:'intel',product:productId,name:id,parts:[structuredClone(original)],addons:[{sourceId:'old',text:'原绑定加购',variantId:'old-variant'},{text:'独立服务'}]});
const replacement={sourceId:'new',shopId:'intel',goodsId:'300',name:'新 CPU',erp:200,tax:220,addonText:'新绑定加购',addonGoodsId:'200',addonPriceCents:1000,addonQty:1};
test('stock scan groups exact IDs and ignores specials, other shops, deleted and draft configs',()=>{
 const a=config('a','p'),b=config('b','q');a.parts.push({slot:'配件1',name:'免费服务',specialComponent:true,goodsId:''},{name:'低库存',goodsId:'200'},{name:'充足',goodsId:'300'},{name:'未知',goodsId:'400'});
 const report=checkInventory([a,b,{...config('x','x'),shopId:'jonsbo'},{...config('deleted','d'),deletedAt:'now'},{...config('draft','d'),emptyLinkDraft:true}],costs,'intel',5);
 assert.equal(report.linkCount,2);assert.equal(report.skippedSpecial,1);assert.equal(report.issues.length,3);assert.equal(report.issues[0].sources.length,2);assert.equal(report.issues[0].sources[0].slot,'CPU');assert.deepEqual(report.issues.map(r=>r.status),['out','low','unknown']);
 assert.equal(checkInventory([a],costs,'intel',4).issues.some(r=>r.goodsId==='200'),false);
});
test('unknown remains unknown: absent or duplicated inventory, null, strings and missing ERP records',()=>{
 for(const rows of [[],[{goodsId:'100',stockAvailable:null}],[{goodsId:'100',stockAvailable:''}],[{goodsId:'100',stockAvailable:'0'}],[{goodsId:'100',stockAvailable:0,erpMissing:true}],[costs[0],costs[0]]])assert.equal(componentStock('100',rows).status,'unknown');
 assert.equal(componentStock('100',[{goodsId:'100',stockAvailable:-2}]).status,'out');
 assert.equal(componentStock('0',[{goodsId:'0',stockAvailable:0}]).status,'unknown');
 const a=config('a','p');a.parts[0].stockAvailable=0;assert.equal(checkInventory([a],[],'intel').issues[0].status,'unknown');
 assert.throws(()=>inventoryThreshold(''),/阈值/);assert.throws(()=>inventoryThreshold('-1'),/阈值/);assert.throws(()=>inventoryThreshold('1.5'),/阈值/);assert.equal(inventoryThreshold('5'),5);
});
test('replacement affects only selected links and keeps quantity, hidden state and independent addons',()=>{
 const configs=[config('a','p'),config('b','q')],before=structuredClone(configs),report=checkInventory(configs,costs,'intel');
 const plan=stockReplacementPlan(configs,costs,[replacement],report,'100',['p'],'new');validateStockReplacement(plan,configs,costs,[replacement]);applyReplacement(plan,configs);
 assert.deepEqual(configs[1],before[1]);assert.equal(configs[0].parts[0].goodsId,'300');assert.equal(configs[0].parts[0].qty,2);assert.equal(configs[0].parts[0].posterVisible,false);assert.equal(configs[0].addons.some(a=>a.sourceId==='old'),false);assert.equal(configs[0].addons.find(a=>a.sourceId==='new').text,'新绑定加购');assert.ok(configs[0].addons.some(a=>a.text==='独立服务'));
});
test('multiple source descriptions for same goodsId are replaced together without leaving bound addons',()=>{
 const a=config('a','p');a.parts.push({...original,slot:'配件1',sourceId:'old2'});a.addons.push({sourceId:'old2',text:'第二条绑定'});
 const report=checkInventory([a],costs,'intel'),plan=stockReplacementPlan([a],costs,[replacement],report,'100',['p'],'new');
 assert.equal(plan.changes[0].after.parts.every(p=>p.sourceId==='new'),true);assert.equal(plan.changes[0].after.addons.filter(a=>a.sourceId).length,1);
});
test('stale stock, changed replacement addon and concurrent config edits reject before any changes',()=>{
 const configs=[config('a','p'),config('b','q')],report=checkInventory(configs,costs,'intel'),plan=stockReplacementPlan(configs,costs,[replacement],report,'100',['p','q'],'new');
 assert.throws(()=>validateStockReplacement(plan,configs,[{...costs[0],stockAvailable:20}], [replacement]),/库存已变化/);
 assert.throws(()=>validateStockReplacement(plan,configs,costs,[{...replacement,addonText:'被修改'}]),/绑定加购已变化/);
 configs[1].price=600;assert.throws(()=>validateStockReplacement(plan,configs,costs,[replacement]),/配置已变化/);assert.equal(configs[0].parts[0].goodsId,'100');
 configs[1].parts[0].qty=3;assert.throws(()=>stockReplacementPlan(configs,costs,[replacement],report,'100',['p'],'new'),/使用情况已变化/);
});
test('special replacement removes bound addon and unknown stock cannot be batch replaced here',()=>{
 const configs=[config('a','p')],report=checkInventory(configs,costs,'intel'),special={sourceId:'sp',shopId:'intel',specialComponent:true,goodsId:'',name:'不含 CPU'};
 const plan=stockReplacementPlan(configs,costs,[special],report,'100',['p'],'sp');assert.equal(plan.changes[0].after.parts[0].erp,0);assert.equal(plan.changes[0].after.addons.length,1);
 assert.throws(()=>stockReplacementPlan(configs,[],[replacement],checkInventory(configs,[],'intel'),'100',['p'],'new'),/低库存或无库存/);
 assert.throws(()=>stockReplacementPlan(configs,costs,[replacement],report,'100',[],'new'),/勾选/);
});
