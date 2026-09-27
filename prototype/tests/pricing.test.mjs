import test from 'node:test';
import assert from 'node:assert/strict';
import {pricing,pricingColumn,deletedWithinRetention} from '../pricing.js';
import {totals,deleteConfigs,restoreConfigs} from '../core.js';

test('定价加店铺券，分期仅按到手价扣费，不改变原成本',()=>{
 const c={price:7999,installment:12,parts:[{name:'CPU',erp:6520,tax:6440,qty:1}]};
 const p=pricing(c,{coupon:200});assert.equal(p.listPrice,8199);assert.equal(p.fee,479.94);
 const t=totals(c);assert.equal(Number((t.taxProfit-p.fee).toFixed(2)),659.1);assert.equal(Number((t.erpProfit-p.fee).toFixed(2)),839.08);
 assert.equal(pricing({...c,installment:24},{coupon:200}).fee,799.9);
 assert.equal(pricing({...c,installment:0}).fee,0);assert.equal(c.parts[0].erp,6520);
});
test('定价复制保持输入顺序、四舍五入整数和零价，无表头与货币符号',()=>{
 assert.equal(pricingColumn([{price:0},{price:10.1},{price:1.23}],{coupon:.2}),'0\r\n10\r\n1');
 assert.throws(()=>pricing({price:-1}));assert.throws(()=>pricing({price:2},{coupon:NaN}));assert.throws(()=>pricing({price:2,installment:3}));
});
test('删除记录跨重启保留72小时，临界到期不再列出',()=>{
 const at=Date.parse('2026-09-25T12:00:00Z');
 const configs=[{id:'old',deletedAt:new Date(at-3*86400000).toISOString()},{id:'new',deletedAt:new Date(at-3*86400000+1).toISOString(),deletionSessionId:'previous',price:12},{id:'active'}];
 assert.deepEqual(deletedWithinRetention(JSON.parse(JSON.stringify(configs)),at).map(c=>c.id),['new']);
 assert.equal(deletedWithinRetention(configs,at+1).length,0);
 restoreConfigs(configs,['new']);assert.equal(configs[1].price,12);assert.equal(configs[1].deletionSessionId,undefined);
});

 test('24期配置按到手价扣点，ERP 主利润不扣分期',()=>{
 const c={price:7199,installment:24,parts:[{name:'合计',erp:6249,tax:6169,qty:1}]};
 const t=totals(c),p=pricing(c);
 assert.equal(p.fee,719.9);
 assert.equal(t.taxProfit,642.04);
 assert.equal(Number((t.taxProfit-p.fee).toFixed(2)),-77.86);
 assert.equal(t.erpProfit,806.02);
 assert.equal(Number((t.erpProfit-p.fee).toFixed(2)),86.12);
 });

test('S960V2 核算利润按到手价扣点，ERP 利润独立计算',()=>{
 const t=totals({price:8599,parts:[{name:'合计',qty:1,tax:8359,erp:8498.59}]});
 assert.equal(t.basis,8802.96);assert.equal(t.taxProfit,-203.96);assert.equal(t.erpProfit,-71.57);
});

test('维护表24期标准扣点：原截图与X400CG同输入对账',()=>{
 for(const [price,tax,expected] of [[5999,5132,-72.86],[7199,6116,-24.86],[7199,6166.36,-75.22]]){
  const c={price,installment:24,actualParts:[{name:'核算成本',qty:1,tax,erp:tax}]};
  assert.equal(Math.round((totals(c).taxProfit-pricing(c).fee)*100)/100,expected);
 }
});

test('扣点只跟到手价变化，增加100元成本只减少100元利润',()=>{
 const c={price:5999,parts:[{name:'核算成本',qty:1,tax:5132}]};
 const before=totals(c);c.parts[0].tax+=100;
 assert.equal(Math.round((totals(c).taxProfit-before.taxProfit)*100),-10000);
 c.price+=100;
 assert.equal(Math.round((totals(c).taxProfit-before.taxProfit)*100),-400);
 const fractional=totals({price:100.13,parts:[{name:'配件',qty:2,tax:20.01}]});
 assert.equal(fractional.basis,144.03);
 assert.equal(fractional.taxProfit,-43.9);
});
