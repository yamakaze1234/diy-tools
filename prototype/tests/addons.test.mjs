import test from 'node:test';
import assert from 'node:assert/strict';
import {addonCheck,validateAddon,sourceAddon,addonBatchPlan,applyAddonBatch,addonKey} from '../addon-data.js';
import {replaceSourcePart,sourceDiff,syncSource} from '../source.js';
import {replacementPlan,applyReplacement} from '../global-batch.js';
import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';
const costs=[{goodsId:'3800690311462781053',name:'商品',erp:100,tax:110}];
const addon=()=>({text:'+59 元加购',note:'每件',goodsId:costs[0].goodsId,priceCents:5900,qty:1});
const originals=[{sourceId:'old',goodsId:'1',name:'原配件',erp:40,tax:40}];
test('差价包含原配件价格，ERP 与核算分别比较，负 49.99 黄、50 红、0 正常',()=>{
 const a={...addon(),sourceId:'old',priceCents:1001};
 let r=addonCheck(a,[{...costs[0],tax:100}],originals);assert.deepEqual(r.fields.map(f=>[f.diffCents,f.severity]),[[-4999,'warning'],[-4999,'warning']]);
 r=addonCheck({...a,priceCents:1000},costs,originals);assert.deepEqual(r.fields.map(f=>[f.diffCents,f.severity]),[[-5000,'danger'],[-6000,'danger']]);
 r=addonCheck({...a,priceCents:6000},costs,[{...originals[0],tax:50}]);assert.deepEqual(r.fields.map(f=>f.diffCents),[0,0]);assert.equal(r.severity,'ok');
 assert.equal(addonCheck({...a,priceCents:29900},[{...costs[0],erp:995.55,tax:930}],[{...originals[0],erp:800,tax:750}]).fields[0].diffCents,10345);
});
test('显式指定原、新配件等量替换，合计加购价只加一次',()=>{
 const r=addonCheck({...addon(),sourceId:'old',qty:2,originalQty:2},costs,originals);assert.equal(r.fields[0].originalPriceCents,8000);assert.equal(r.fields[0].diffCents,-6100);
 assert.equal(addonCheck({...addon(),sourceId:'old'},costs,[{...originals[0],qty:4}]).fields[0].diffCents,-100);
});
test('缺少原配件、新配件成本或关联不按零计算，明确零价格有效',()=>{
 const a={...addon(),sourceId:'old'};
 assert.equal(addonCheck(a,costs).severity,'pending');assert.match(addonCheck(a,costs).reason,/原配件/);
 assert.equal(addonCheck(a,costs,[{...originals[0],erp:null}]).fields[0].severity,'pending');
 assert.equal(addonCheck(a,[{...costs[0],erp:null}],originals).fields[0].severity,'pending');
 assert.equal(addonCheck(a,[costs[0],costs[0]],originals).severity,'pending');
 assert.equal(addonCheck(a,costs,[...originals,{...originals[0],goodsId:'2'}]).severity,'pending');
 assert.equal(addonCheck(a,[{...costs[0],erp:0,tax:0}],[{...originals[0],erp:0,tax:0}]).severity,'ok');
 assert.equal(addonCheck(a,costs,[...originals,...originals]).fields[0].diffCents,-100);
});
test('商品 ID 不转数字，商品关联可选，选择商品后要求加购价',()=>{assert.equal(validateAddon(addon(),{required:true,costs}).goodsId,'3800690311462781053');assert.throws(()=>validateAddon({...addon(),goodsId:3800690311462781053}),/ID/);assert.equal(validateAddon({text:'旧文案'},{required:true,costs}).text,'旧文案');assert.throws(()=>validateAddon({...addon(),priceCents:null},{required:true,costs}),/设置/);assert.throws(()=>validateAddon({...addon(),priceCents:-1}),/加购价/);});
test('配件替换带入完整加购关联，保留独立加购，重复原配件仍用旧关联',()=>{const c={parts:[{sourceId:'old',goodsId:'1',qty:1},{sourceId:'old',goodsId:'1',qty:1}],addons:[{...addon(),sourceId:'old'},{text:'独立',note:'保留'}]},row={sourceId:'new',goodsId:'2',name:'新配件',addonText:'新加购',addonGoodsId:costs[0].goodsId,addonPriceCents:12000,addonQty:2};replaceSourcePart(c,0,row);assert.equal(c.addons.length,3);replaceSourcePart(c,1,row);assert.equal(c.addons.length,2);assert.ok(c.addons.some(a=>a.text==='独立'));assert.deepEqual(c.addons.find(a=>a.sourceId==='new'),sourceAddon(row));});
test('跨链接批量替换同样更新绑定加购且没有串改手动项',()=>{const c={id:'c',productId:'p',product:'链接',name:'配置',parts:[{sourceId:'old',goodsId:'1',name:'旧',qty:1}],addons:[{...addon(),sourceId:'old'},{text:'独立'}]},row={sourceId:'new',goodsId:'2',name:'新',addonText:'新的加购',addonGoodsId:costs[0].goodsId,addonPriceCents:1900};const plan=replacementPlan([c],'id:1',['p'],row,null);applyReplacement(plan,[c]);assert.deepEqual(c.addons.map(a=>a.text),['独立','新的加购']);});
test('只改加购价格或商品关联也进入输出源差异并同步',()=>{const row={sourceId:'s',addonText:'描述',addonGoodsId:costs[0].goodsId,addonPriceCents:10000,addonQty:1},c={id:'c',parts:[{sourceId:'s'}],addons:[sourceAddon(row)]};row.addonPriceCents=12000;assert.equal(sourceDiff([c],row,['addon']).length,1);syncSource([c],row,['addon']);assert.equal(c.addons[0].priceCents,12000);});
test('批量改描述保留不同报价与来源，过期预览整批拒绝',()=>{const cs=[1,2].map(i=>({id:String(i),addons:[{...addon(),priceCents:5900+i,sourceId:'s'+i}]})),plan=addonBatchPlan(cs,addonKey(addon()),{text:'新描述',note:'新说明'},{costs});assert.equal(plan.changes.length,2);cs[1].addons[0].text='别人正在编辑';assert.throws(()=>applyAddonBatch(plan,cs),/重新预览/);assert.equal(cs[0].addons[0].text,'+59 元加购');cs[1].addons[0].text='+59 元加购';applyAddonBatch(plan,cs);assert.equal(cs[0].addons[0].priceCents,5901);assert.equal(cs[1].addons[0].sourceId,'s2');});
test('旧手动加购可独立批量改写，删除配置不变',()=>{const cs=[{id:'a',addons:[{text:'旧描述'}]},{id:'b',deletedAt:'now',addons:[{text:'旧描述'}]}],key=addonKey(cs[0].addons[0]);assert.equal(addonBatchPlan(cs,key,{text:'新描述'},{costs}).changes.length,1);const plan=addonBatchPlan(cs,key,addon(),{updatePricing:true,costs});assert.equal(plan.changes.length,1);applyAddonBatch(plan,cs);assert.equal(cs[0].addons[0].goodsId,costs[0].goodsId);assert.equal(cs[1].addons[0].text,'旧描述');});
test('新增加购字段以整数分通过工作台投影往返',()=>{const s={configs:[{id:'c',shopId:'intel',price:100,parts:[],addons:[addon()]}],sourceCatalog:[{sourceId:'s',shopId:'intel',goodsId:'1',addonText:'描述',addonGoodsId:costs[0].goodsId,addonPriceCents:5900,addonQty:1}],templates:[],costSource:[],caseGallery:[],shopSettings:{intel:{coupon:0}}};const result=applyWorkspace(s,projectWorkspace(s));assert.deepEqual(result.configs[0].addons,s.configs[0].addons);assert.equal(result.sourceCatalog[0].addonPriceCents,5900);});
