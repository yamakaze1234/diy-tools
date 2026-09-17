import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBatchContent} from '../batch-content.js';
test('批量同步组合加购与福利独立勾选，深复制且仅保留目标已有的准确原配件关联',()=>{
 const reference={addons:[{text:'组合描述',sourceId:'s',items:[{goodsId:'1',qty:2},{goodsId:'2',qty:1}],priceCents:40000,note:'说明'}],benefits:[{text:'福利'}]};
 const target={parts:[{sourceId:'other'}],addons:[{text:'旧加购'}],benefits:[{text:'旧福利'}],price:100,skuId:'123'};
 const unchanged=structuredClone(target);applyBatchContent(reference,target);assert.deepEqual(target,unchanged);
 applyBatchContent(reference,target,{addons:true});assert.equal(target.addons[0].sourceId,undefined);assert.deepEqual(target.addons[0].items,reference.addons[0].items);assert.deepEqual(target.benefits,unchanged.benefits);
 target.addons[0].items[0].qty=5;assert.equal(reference.addons[0].items[0].qty,2);
 applyBatchContent(reference,target,{benefits:true});assert.deepEqual(target.benefits,reference.benefits);assert.equal(target.price,100);assert.equal(target.skuId,'123');
 target.parts=[{sourceId:'s'}];applyBatchContent(reference,target,{addons:true});assert.equal(target.addons[0].sourceId,'s');
 applyBatchContent({addons:[],benefits:[]},target,{addons:true,benefits:true});assert.deepEqual(target.addons,[]);assert.deepEqual(target.benefits,[]);
});
