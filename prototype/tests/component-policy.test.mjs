import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeErp,validateSnapshot,costRows} from '../erp-sync.js';
import {sourcesFor,normalizeWorkspaceState} from '../shops.js';
import {selectableComponents} from '../component-policy.js';
const row=(goodsId,name)=>({goodsId,name,erp:100,stockAvailable:5});
test('每次完整 ERP 导入排除星号及任意后缀，店铺别名不能绕过，已有配置保留',()=>{
 const state={configs:[{id:'c',price:300,parts:[{goodsId:'1',name:'已有配置配件',erp:90,tax:80,qty:1}]}],costSource:[{...row('1','旧名称'),tax:80}],sourceCatalog:[{sourceId:'s',shopId:'intel',goodsId:'1',name:'本店别名',tax:80}]};
 const rows=[row('1','配件*停用'),row('2','配件*!'),row('3','正常配件'),row('4','全角＊配件'),row('5','配件*'),row('6','配件*任意后缀')];
 const valid=validateSnapshot({complete:true,total:6,rows});assert.equal(valid.length,6);
 let result=mergeErp(state,valid,[],'now');assert.equal(result.excluded,5);assert.deepEqual(result.next.costSource.map(r=>r.goodsId),['3']);assert.equal(sourcesFor(result.next,'intel').filter(r=>!r.specialComponent).length,0);
 const synced=applyWorkspace(result.next,projectWorkspace(result.next));assert.equal(synced.configs[0].parts[0].tax,80);assert.equal(synced.configs[0].parts[0].erp,100);assert.equal(sourcesFor(synced,'intel').filter(r=>!r.specialComponent).length,0);assert.equal(result.next.configs[0].parts[0].name,'已有配置配件');assert.equal(result.next.configs[0].parts[0].qty,1);assert.equal(state.costSource[0].name,'旧名称');
 assert.deepEqual(costRows(result.next.sourceCatalog,result.next.costSource).map(r=>r.goodsId),['3']);
 result=mergeErp(result.next,valid,[],'later');assert.deepEqual(result.next.costSource.map(r=>r.goodsId),['3']);
 result=mergeErp(result.next,[row('1','恢复配件'),row('3','正常配件')],[],'again');assert.equal(sourcesFor(result.next,'intel').filter(r=>!r.specialComponent).length,1);assert.ok(result.next.costSource.some(r=>r.goodsId==='1'));
});
test('历史数据按 ERP 原名排除，普通感叹号不排除',()=>{
 const state=normalizeWorkspaceState({configs:[],sourceCatalog:[{sourceId:'s',shopId:'intel',goodsId:'1',name:'店铺别名'}],costSource:[row('1','ERP*!停用')]});assert.equal(sourcesFor(state,'intel').filter(r=>!r.specialComponent).length,0);
 assert.deepEqual(selectableComponents([row('1','*A'),row('2','B*!'),row('3','正常!配件')]).map(r=>r.goodsId),['3']);
});
