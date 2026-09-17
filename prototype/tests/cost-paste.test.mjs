import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCostPaste} from '../cost-paste.js';
import {applyManualCosts} from '../erp-sync.js';
const rows=[{goodsId:'57339',tax:1},{goodsId:'401040',tax:2},{goodsId:'21690',tax:3}];

test('#VALUE! 按精确 ID 使用 ERP 成本，保留普通价格、零价和 ERP 精度',()=>{
 const data=[{goodsId:'1',erp:80.125,tax:70},{goodsId:'2',erp:0,tax:20},{goodsId:'3',erp:100,tax:20}];
 const r=parseCostPaste('goods_id\t含税成本\n1\t#VALUE!\n2\t #value! \n3\t100',data);
 assert.deepEqual(r.entries,[{goodsId:'1',tax:80.125},{goodsId:'2',tax:0},{goodsId:'3',tax:100}]);
 assert.equal(r.valueErrors.length,2);assert.equal(r.erpFallbacks.length,2);assert.equal(data[0].tax,70);
 const state={costSource:structuredClone(data),sourceCatalog:structuredClone(data),configs:[{id:'c',parts:[{goodsId:'1',tax:70,erp:80.125,qty:2}]}]};
 applyManualCosts(state,r.entries,'2026-09-15T04:00:00Z');assert.equal(state.configs[0].parts[0].tax,80.125);assert.equal(state.costSource[0].taxUpdatedAt,'2026-09-15T04:00:00Z');
});
test('#VALUE! 无有效 ERP 时保留原价并报告；单列位置不移动，冲突仍阻止',()=>{
 const data=[{goodsId:'1',erp:null},{goodsId:'2',erp:45},{goodsId:'3',erp:60,erpUnknown:true},{goodsId:'4',erp:70,erpMissing:true}];
 const r=parseCostPaste('#VALUE!\n#VALUE!\n#VALUE!\n#VALUE!',data,['4','3','2','1']);
 assert.deepEqual(r.entries,[{goodsId:'2',tax:45}]);assert.equal(r.unavailableErp.length,3);
 const missing=parseCostPaste('999\t#VALUE!\n2\t#VALUE!',data);assert.equal(missing.unmatched[0].goodsId,'999');
 assert.throws(()=>parseCostPaste('1\t#VALUE!',data),/ERP 成本不可用.*保留原价/);
 assert.throws(()=>parseCostPaste('2\t#VALUE!\n2\t50',data),/重复且价格不一致/);
});

test('截图中的双列表头及重复 goods_id 表头自动跳过',()=>{
 const r=parseCostPaste('goods_id\t含税成本\ngoods_id\n57339\t750\n401040\t1150\n21690\t390\n',rows);
 assert.equal(r.headers,2);assert.deepEqual(r.entries,rows.map((r,i)=>({goodsId:r.goodsId,tax:[750,1150,390][i]})));
});
test('未匹配 ID 单独报告，空价保留，零价有效，相同重复合并',()=>{
 const r=parseCostPaste('57339\t0\n401040\t\n999\t20\n57339\t0',rows);
 assert.deepEqual(r.entries,[{goodsId:'57339',tax:0}]);assert.equal(r.blank,1);assert.equal(r.unmatched[0].goodsId,'999');assert.equal(r.duplicates,1);
 assert.throws(()=>parseCostPaste('57339\t1\n57339\t2',rows),/第 2 行.*重复且价格不一致/);
 assert.throws(()=>parseCostPaste('57339\t错误',rows),/第 1 行/);
});
test('单列仍按选中商品原始顺序，保留空行并支持单价表头',()=>{
 const r=parseCostPaste('含税成本\n\n0\n',rows,['401040','57339']);
 assert.deepEqual(r.entries,[{goodsId:'401040',tax:0}]);assert.equal(r.blank,1);
 assert.throws(()=>parseCostPaste('10',rows,['57339','401040']),/行.*已选 2/);
});
test('16110 行完整解析和核算更新，ERP 数据及原输入保持不变',()=>{
 const rows=Array.from({length:16110},(_,i)=>({goodsId:String(100000+i),tax:50,erp:60,stockAvailable:10}));
 const text='goods_id\t含税成本\ngoods_id\n'+rows.map(r=>r.goodsId+'\t75').join('\n');
 const parsed=parseCostPaste(text,rows);assert.equal(parsed.entries.length,16110);
 const state={costSource:structuredClone(rows),sourceCatalog:structuredClone(rows),configs:[{id:'c',parts:[{goodsId:'100000',tax:50,qty:2,erp:60}]}]};
 assert.deepEqual(applyManualCosts(state,parsed.entries,'2026-09-15T03:00:00Z'),['c']);
 assert.equal(state.sourceCatalog.at(-1).tax,75);assert.equal(state.sourceCatalog.at(-1).erp,60);assert.equal(state.configs[0].parts[0].qty,2);assert.equal(rows[0].tax,50);
});
