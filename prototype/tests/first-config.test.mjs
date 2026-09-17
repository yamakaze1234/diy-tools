import test from 'node:test';
import assert from 'node:assert/strict';
import {blankConfig} from '../core.js';
import {applyShopIdentity} from '../shops.js';

test('空工作台首次创建无需已有配置，默认图片样式完整且互不共享',()=>{
 const product={id:'first',shopId:'intel',name:'新链接'};
 const a=applyShopIdentity(blankConfig(undefined,product),'intel',{resetAppearance:true});
 const b=blankConfig(null,{...product,shopId:'jonsbo'});
 assert.equal(a.parts.length,8);assert.equal(a.layout,'long');assert.equal(a.caseImage,'');
 assert.ok(a.modules.some(m=>m.type==='parts'));assert.equal(a.shopId,'intel');
 assert.equal(b.shopId,'jonsbo');assert.notEqual(a.id,b.id);
 a.modules[0].title='changed';assert.notEqual(b.modules[0].title,'changed');
 assert.deepEqual(a.addons,[]);assert.equal(a.skuId,'');
});
