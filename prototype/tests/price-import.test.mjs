import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePriceTable,priceImportPlan,applyPriceImport} from '../price-import.js';
const name='配置1：14600KF+无卡+32G+1T丨进阶版';
const config=()=>({id:'one',shortName:name,price:6000,installment:12,parts:[{qty:2,cost:200}],stock:5});
test('Markdown retains first data row and decodes bold/entity, TSV allows negative stock',()=>{
 const parsed=parsePriceTable(`| **${name}** | 2 | **6499&#x20;** |\n| --- | --- | --- |\n| 配置2 | -1 | 8,199.50 |`);assert.equal(parsed.errors.length,0);assert.equal(parsed.rows.length,2);assert.equal(parsed.rows[0].name,name);assert.equal(parsed.rows[0].listPrice,6499);assert.equal(parsed.rows[1].stock,'-1');assert.equal(parsed.rows[1].listPrice,8199.5);
 assert.equal(parsePriceTable(`${name}\t-1\t6499`).rows[0].listPrice,6499);
});
test('price import changes only arrival price and audit timestamp; stock is reference',()=>{const c=config(),before=structuredClone(c),plan=priceImportPlan(`${name}\t-1\t6499`,[c],{coupon:400});assert.equal(plan.changes[0].after,6099);assert.deepEqual(c,before);assert.deepEqual(applyPriceImport(plan,[c],{coupon:400},'test'),['one']);assert.deepEqual(c,{...before,price:6099,priceImportedAt:'test'});});
test('ambiguous names, conflicting input and invalid values block; unmatched rows skip',()=>{assert.ok(priceImportPlan(`${name}\t0\t6499`,[config(),{...config(),id:'two'}],{}).errors.length);assert.ok(priceImportPlan(`${name}\t0\t6499\n${name}\t2\t6500`,[config()],{}).errors.length);for(const value of ['1e4','-1','100.001','6,49'])assert.ok(parsePriceTable(`${name}\t0\t${value}`).errors.length);assert.equal(priceImportPlan('配置9\t0\t6499',[config()],{}).changes.length,0);assert.ok(priceImportPlan(`${name}\t0\t399`,[config()],{coupon:400}).errors.length);});
test('stale preview cannot partially update and coupon changes require new preview',()=>{const a=config(),b={...config(),id:'two',shortName:'配置2'},plan=priceImportPlan(`${name}\t0\t6499\n配置2\t0\t8199`,[a,b],{coupon:400});b.price=7000;assert.throws(()=>applyPriceImport(plan,[a,b],{coupon:400}));assert.equal(a.price,6000);assert.throws(()=>applyPriceImport(plan,[a,b],{coupon:200}));});
