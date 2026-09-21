import test from 'node:test';
import assert from 'node:assert/strict';
import {productInstallment,applyProductInstallment,pricing} from '../pricing.js';
import {productGroups,blankConfig,importTemplateConfigs} from '../core.js';

test('link installment updates only live configurations in the chosen shop and link',()=>{
 const configs=[{id:'a',shopId:'intel',productId:'p',installment:0,price:1000},{id:'b',shopId:'intel',productId:'p',installment:24,price:2000},{id:'c',shopId:'intel',productId:'other',installment:0},{id:'d',shopId:'jonsbo',productId:'p',installment:0},{id:'e',shopId:'intel',productId:'p',installment:24,deletedAt:'2026'}];
 assert.equal(productInstallment(configs.slice(0,2)),null);
 assert.deepEqual(applyProductInstallment(configs,{id:'p',shopId:'intel'},12),['a','b']);
 assert.equal(productInstallment(configs.slice(0,2)),12);
 assert.equal(pricing(configs[0]).fee,60);assert.equal(pricing(configs[1]).fee,120);
 assert.deepEqual(configs.slice(2).map(c=>c.installment),[0,0,24]);
 assert.throws(()=>applyProductInstallment(configs,{id:'p',shopId:'intel'},6));
});
test('new configs and imported templates inherit link installment, not source installment',()=>{
 const source=blankConfig(null,{id:'old',shopId:'intel',installment:24});
 const target={id:'new',shopId:'intel',installment:12,configs:[]};
 assert.equal(blankConfig(source,target).installment,12);
 assert.equal(importTemplateConfigs([source],target)[0].installment,12);
 assert.equal(source.installment,24);
 assert.equal(blankConfig(source,{id:'fresh',shopId:'intel'}).installment,0);
});
test('legacy mixed link remains unchanged until explicitly selected',()=>{
 const configs=[{id:'a',shopId:'intel',productId:'p',installment:12},{id:'b',shopId:'intel',productId:'p',installment:24}];
 const [p]=productGroups(configs);
 assert.equal(p.installment,null);
 assert.throws(()=>blankConfig(null,p),/统一分期/);
 assert.throws(()=>importTemplateConfigs([configs[0]],p),/统一分期/);
 assert.deepEqual(configs.map(c=>c.installment),[12,24]);
});
