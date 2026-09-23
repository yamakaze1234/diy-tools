import test from 'node:test';
import assert from 'node:assert/strict';
import {erpUnitCost,totals} from '../core.js';
import {overviewProfits} from '../part-transfer.js';
import {sqlStockPlan} from '../sql-sync.mjs';
import {sourcePart} from '../source.js';

const config=part=>({price:2000,parts:[{slot:'CPU',goodsId:'123',name:'CPU',qty:2,...part}]});

test('SQL 未识别时按核算单价计算 ERP 利润，旧 ERP 缓存不会冒充新价格',()=>{
 const c=config({erp:400,tax:500,erpMissing:true});
 assert.deepEqual(erpUnitCost(c.parts[0]),{cents:50000,fallback:true});
 assert.equal(totals(c).erp,1000);
 assert.equal(totals(c).erpProfit,960);
 assert.equal(totals(c).erpFallback,1);
 assert.deepEqual(overviewProfits(c,{}),[860,960]);
 c.parts[0].tax=600;
 assert.equal(totals(c).erp,1200);
 assert.equal(c.parts[0].erp,400);
});

test('SQL 零价有效；SQL 和核算成本都缺失时不显示虚假的 ERP 利润',()=>{
 const known=config({erp:0,tax:500,erpMissing:false,erpUnknown:false});
 assert.equal(totals(known).erp,0);
 assert.equal(totals(known).erpFallback,0);
 const unknown=config({erp:400,tax:null,erpUnknown:true});
 assert.equal(totals(unknown).erp,null);
 assert.equal(totals(unknown).erpProfit,null);
 assert.equal(totals(unknown).erpUnresolved,1);
 assert.deepEqual(overviewProfits(unknown,{}),[null,null]);
 const zeroFallback=config({erp:null,tax:0});
 assert.equal(totals(zeroFallback).erp,0);
 assert.equal(totals(zeroFallback).erpFallback,1);
});

test('SQL 无匹配与空成本均保留未识别标记，再次识别后恢复真实 ERP 价',()=>{
 const c=config({erp:400,tax:500});
 const state={configs:[c],sourceCatalog:[],costSource:[]};
 const missing=sqlStockPlan(state,[]).next.configs[0].parts[0];
 assert.equal(missing.erpMissing,true);
 assert.equal(erpUnitCost(missing).cents,50000);
 const unknown=sqlStockPlan(state,[{goodsId:'123',name:'CPU',erp:null,stockAvailable:2}]).next.configs[0].parts[0];
 assert.equal(unknown.erpMissing,false);
 assert.equal(unknown.erpUnknown,true);
 assert.equal(erpUnitCost(unknown).cents,50000);
 const found=sqlStockPlan(state,[{goodsId:'123',name:'CPU',erp:450,stockAvailable:2}]).next.configs[0].parts[0];
 assert.equal(found.erpMissing,false);
 assert.equal(found.erpUnknown,false);
 assert.equal(erpUnitCost(found).cents,45000);
 const picked=sourcePart({sourceId:'cpu',goodsId:'123',name:'CPU',erp:400,tax:500,erpUnknown:true});
 assert.equal(erpUnitCost(picked).cents,50000);
});
