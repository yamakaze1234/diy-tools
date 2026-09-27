import test from 'node:test';
import assert from 'node:assert/strict';
import {additionPlan} from '../link-parts.js';
import {applyReplacement} from '../global-batch.js';
import {copyPartPayload,pastePartPayload,overviewProfits} from '../part-transfer.js';
import {captureTextFormat,applyTextFormat} from '../poster-format.js';
import {snapRegion} from '../poster-geometry.js';
const row={shopId:'intel',sourceId:'s1',goodsId:'10',name:'风扇',erp:10.12,tax:20.34};
const configs=()=>[0,1,2].map(i=>({id:String(i),name:'配置'+i,shopId:'intel',productId:i===2?'b':'a',addons:[],parts:[]}));
test('link addition carries quantity and leaves other links unchanged; occupied slots and stale plans block atomically',()=>{
 const cs=configs(),plan=additionPlan(cs,'a',row,'风扇',3);applyReplacement(plan,cs);
 assert.deepEqual(cs.map(c=>c.parts.length),[1,1,0]);assert.equal(cs[0].parts[0].qty,3);
 assert.throws(()=>additionPlan(cs,'a',row,'风扇',2),/已有配件/);
 const next=additionPlan(cs,'a',row,'配件1',2);cs[1].price=10;assert.throws(()=>applyReplacement(next,cs),/配置已变化/);assert.equal(cs[0].parts.length,1);
 assert.throws(()=>additionPlan(cs,'a',row,'配件1',1.5));
});
test('part copy/paste replaces target quantity and clones data',()=>{
 const c={shopId:'intel',addons:[],parts:[{...row,slot:'风扇',qty:6}]},dest={shopId:'intel',addons:[],parts:[{slot:'风扇',qty:1}]};
 const payload=copyPartPayload(c,0);pastePartPayload(dest,0,payload,[row]);assert.equal(dest.parts[0].qty,6);dest.parts[0].qty=9;assert.equal(c.parts[0].qty,6);
});
test('overview profits deduct arrival-based installment fee including fractional costs',()=>{
 assert.deepEqual(overviewProfits({price:7999,installment:12,parts:[{name:'CPU',erp:6520,tax:6440,qty:1}]},{coupon:200}),[659.1,839.08]);
});
test('format brush uses resolved style while preserving target content and transforms',()=>{
 const fmt=captureTextFormat({}, {key:'a',size:40,color:'#123456',weight:700,fontFamily:'SimHei'},2);
 const c={textStyles:{b:{text:'保留文案',width:123,ranges:[{start:0,end:2,style:{color:'red'}}]}},textTransforms:{long:{b:{x:12}}}};
 applyTextFormat(c,'b',fmt);assert.equal(c.textStyles.b.size,20);assert.equal(c.textStyles.b.text,'保留文案');assert.equal(c.textStyles.b.width,123);assert.equal(c.textStyles.b.ranges,undefined);assert.equal(c.textTransforms.long.b.x,12);
});
test('alignment snaps nearby edges/centres but leaves distant objects untouched',()=>{
 const r={x:203,top:104,width:40,height:20};const {value,guides}=snapRegion(r,[{x:200,top:100,width:40,height:20}],700,1000,5);
 assert.equal(value.x,200);assert.equal(value.top,100);assert.equal(guides.length,2);
 assert.deepEqual(snapRegion({x:123,top:234,width:40,height:20},[],700,1000,5).guides,[]);
});
