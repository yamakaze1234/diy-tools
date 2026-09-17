import test from 'node:test';
import assert from 'node:assert/strict';
import {pricing,pricingColumn,sessionDeleted} from '../pricing.js';
import {totals,deleteConfigs,restoreConfigs} from '../core.js';

test('定价加店铺券，分期仅按到手价扣费，不改变原成本',()=>{
 const c={price:7999,installment:12,parts:[{name:'CPU',erp:6520,tax:6440,qty:1}]};
 const p=pricing(c,{coupon:200});assert.equal(p.listPrice,8199);assert.equal(p.fee,479.94);
 const t=totals(c);assert.equal(Number((t.taxProfit-p.fee).toFixed(2)),721.46);assert.equal(Number((t.erpProfit-p.fee).toFixed(2)),839.08);
 assert.equal(pricing({...c,installment:24},{coupon:200}).fee,799.9);
 assert.equal(pricing({...c,installment:0}).fee,0);assert.equal(c.parts[0].erp,6520);
});
test('定价复制保持输入顺序、两位小数和零价，无表头与货币符号',()=>{
 assert.equal(pricingColumn([{price:0},{price:10.1},{price:1.23}],{coupon:.2}),'0.20\r\n10.30\r\n1.43');
 assert.throws(()=>pricing({price:-1}));assert.throws(()=>pricing({price:2},{coupon:NaN}));assert.throws(()=>pricing({price:2,installment:3}));
});
test('删除列表按服务启动筛选，刷新保留，重启不显示历史且不删除数据',()=>{
 const configs=[{id:'old',deletedAt:'2020',deletionSessionId:'old'},{id:'new',price:12}];deleteConfigs(configs,['new'],'2026');configs[1].deletionSessionId='current';
 assert.deepEqual(sessionDeleted(JSON.parse(JSON.stringify(configs)),'current').map(c=>c.id),['new']);
 assert.equal(sessionDeleted(configs,'next-start').length,0);assert.equal(configs.length,2);
 restoreConfigs(configs,['new']);assert.equal(configs[1].price,12);assert.equal(configs[1].deletionSessionId,undefined);
});
