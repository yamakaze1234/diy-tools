import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,calculate,instantiateTemplate} from '../model.mjs';
import {specialChoices,applySpecialPart} from '../special-parts.mjs';
import {materialize,stageChanges} from '../cloud-adapter.mjs';
import {fakeCloud,member} from './cloud-fixture.mjs';
import {emptySync} from '../cloud-sync.mjs';
test('特殊配件移除旧绑定和加购，不计成本或库存；普通未绑定配件仍缺成本',()=>{
 const s=createDemo(),c=structuredClone(s.configs[0]),before=calculate(c,s.catalog);c.actualParts[0].addonOverride={goodsId:c.actualParts[0].goodsId};applySpecialPart(c.actualParts[0],{name:'自备 CPU'});const result=calculate(c,s.catalog);assert.equal(result.erp,before.erp-900);assert.equal(result.tax,before.tax-880);assert.equal(c.actualParts[0].goodsId,'');assert.equal(c.actualParts[0].addonOverride,undefined);
 const only={...c,actualParts:[c.actualParts[0]]};assert.equal(calculate(only,s.catalog).erp,0);assert.equal(calculate(only,s.catalog).missing,0);assert.equal(calculate(only,s.catalog).capacity,null);assert.equal(calculate({...only,actualParts:[{name:'未绑定',goodsId:'',qty:1}]},s.catalog).erp,null);assert.equal(calculate({...only,actualParts:[]},s.catalog).erp,null);
 assert.equal(instantiateTemplate(c,'p1').actualParts[0].specialComponent,true);
});
test('沿用工作台预设，恢复旧缓存的特殊标记，删除的预设不复活且不跨店',()=>{
 const state={sources:[],cloudSync:{records:[{type:'source',id:'special:intel:1',draft:{sourceId:'special:intel:1',shopId:'intel',specialComponent:true,deletedAt:'now'}},{type:'source',id:'custom',draft:{sourceId:'custom',shopId:'intel',name:'自定义服务',specialComponent:true}}]}};const result=specialChoices(state,'intel');assert.equal(result.length,5);assert.ok(!result.some(s=>s.sourceId==='special:intel:1'));assert.ok(result.some(s=>s.name==='自定义服务'));assert.equal(specialChoices(state,'jonsbo').length,5);
});
test('特殊配件保存为原生云端配置，清除旧来源加购，往返保留显示标记',()=>{
 const cloud=fakeCloud(),sync=emptySync(member);sync.records=[...cloud.records.values()].map(r=>({type:r.type,id:r.id,base:r.data,draft:structuredClone(r.data),version:r.version,conflict:null}));const before=materialize(sync),next=structuredClone(before);applySpecialPart(next.configs[0].actualParts[0],{sourceId:'special:intel:1',name:'自备固态'});stageChanges(before,next);const native=next.cloudSync.records.find(r=>r.id==='config-one').draft;assert.equal(native.actualParts[0].specialComponent,true);assert.equal(native.actualParts[0].goodsId,'');assert.equal(native.addons.length,0);assert.equal(native.parts[0].goodsId,'123');const round=materialize(next.cloudSync);assert.equal(round.configs[0].actualParts[0].name,'自备固态');assert.equal(calculate(round.configs[0],round.catalog).tax,0);
});
