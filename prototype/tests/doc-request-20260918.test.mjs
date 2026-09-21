import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceSyncPlan,sourceChangeKey,applySourceSync} from '../source-sync-data.js';
import {copyPartPayload,pastePartPayload,overviewProfits} from '../part-transfer.js';
const row={shopId:'intel',sourceId:'s',goodsId:'101',name:'新名称',upgrade:'新升级',erp:100,tax:110,addonText:'新加购'};
const config=(id='a',productId='p')=>({id,productId,shopId:'intel',name:id,product:productId,price:1000,installment:12,parts:[{...row,slot:'CPU',name:'原名称',upgrade:'原升级',qty:2,erp:1}],addons:[{sourceId:'s',text:'原加购',note:''}]});
test('selected links and retained descriptions exclude exact fields without touching other links or shops',()=>{
 const configs=[config(),config('b','q'),{...config('c'),shopId:'jonsbo'}];
 const plan=sourceSyncPlan(configs,[row],['name','upgrade','addon'],'intel',{productIds:['p'],retained:[sourceChangeKey('a','s','CPU','name'),sourceChangeKey('a','s','加购','addon')]});
 assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].details.length,1);
 applySourceSync(plan,configs,[row]);assert.equal(configs[0].parts[0].name,'原名称');assert.equal(configs[0].addons[0].text,'原加购');assert.equal(configs[0].parts[0].upgrade,'新升级');assert.equal(configs[1].parts[0].upgrade,'原升级');assert.equal(configs[2].parts[0].upgrade,'原升级');
 assert.equal(sourceSyncPlan(configs,[row],['name'],'intel',{productIds:[]}).changes.length,0);
});
test('retained preview still blocks concurrent source/config changes atomically',()=>{
 const configs=[config(),config('b')],plan=sourceSyncPlan(configs,[row],['name'],'intel');configs[1].price=1;
 assert.throws(()=>applySourceSync(plan,configs,[row]),/配置已变化/);assert.equal(configs[0].parts[0].name,'原名称');
 assert.throws(()=>applySourceSync(plan,configs,[{...row,name:'再次修改'}]),/输出源已变化/);
});
test('copy transfers binding quantity descriptions and addons but reads current costs and is deep copied',()=>{
 const source=config(),payload=copyPartPayload(source,0),target=config('b');source.parts[0].name='后来更改';source.addons[0].text='后来更改';
 target.parts[0].goodsId='old';target.parts[0].posterVisible=false;
 pastePartPayload(target,0,payload,[row]);assert.equal(target.parts[0].goodsId,'101');assert.equal(target.parts[0].name,'原名称');assert.equal(target.parts[0].qty,2);assert.equal(target.parts[0].erp,100);assert.equal(target.parts[0].posterVisible,false);assert.equal(target.addons[0].text,'原加购');
 target.addons[0].text='目标编辑';assert.equal(payload.addons[0].text,'原加购');
 assert.throws(()=>pastePartPayload({...target,shopId:'jonsbo'},0,payload,[row]),/当前店铺/);
 assert.throws(()=>pastePartPayload(target,0,payload,[]),/有效输出源/);
 target.parts[0].slot='显卡';assert.throws(()=>pastePartPayload(target,0,payload,[row]),/槽位/);
});
test('overview deducts installment and shows missing costs independently',()=>{
 const c=config();c.parts[0].erp=100;assert.deepEqual(overviewProfits(c,{coupon:400}),[611.2,720]);
 c.parts[0].tax=null;assert.deepEqual(overviewProfits(c,{coupon:400}),[null,720]);c.parts[0].erp=null;assert.deepEqual(overviewProfits(c,{}),[null,null]);
});
