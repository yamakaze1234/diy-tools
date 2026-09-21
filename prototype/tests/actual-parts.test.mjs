import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from './fixtures/workspace.mjs';
import {actualParts,ensureActualParts,syncActualParts} from '../actual-parts.js';
import {totals,erpRow,posterParts,blankConfig,importTemplateConfigs} from '../core.js';
import {normalizeWorkspaceState} from '../shops.js';
import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';
import {validateWorkspaceRecord} from '../workspace-validation.mjs';
import {applyManualCosts,mergeErp} from '../erp-sync.js';
import {inventoryPlan} from '../inventory-export.js';
import {checkInventory,stockReplacementPlan} from '../inventory-check-data.js';
const clone=structuredClone;
const part=(slot,id,qty=1)=>({slot,goodsId:id,name:'配件 '+id,sourceId:'src-'+id,qty,erp:Number(id),tax:Number(id)+10});
const config=()=>({...clone(seed.configs[0]),shopId:'intel',id:'actual-test',productId:'actual-product',price:1000,parts:[part('CPU','100'),part('风扇','200',3)],addons:[]});

test('legacy migration copies independently; explicit empty actual bill survives repeated normalization',()=>{
 const c=config(),s=normalizeWorkspaceState({...clone(seed),configs:[c],templates:[{id:'t',configs:[clone(c)]}]});
 assert.deepEqual(s.configs[0].actualParts,c.parts);assert.deepEqual(s.templates[0].configs[0].actualParts,c.parts);
 s.configs[0].actualParts[0].name='真实型号';assert.notEqual(s.configs[0].parts[0].name,'真实型号');
 s.configs[0].actualParts=[];assert.deepEqual(normalizeWorkspaceState(s).configs[0].actualParts,[]);
 assert.throws(()=>ensureActualParts({parts:[],actualParts:{}}),/实际配置/);
});
test('display changes sync the affected slot only; actual-only rows and other overrides survive',()=>{
 const c=config();ensureActualParts(c);c.actualParts[0]=part('CPU','300',2);c.actualParts[1].name='实际风扇';c.actualParts.push(part('配件1','400'));
 const before=clone(c.parts);c.parts[0].qty=4;syncActualParts(c,before);
 assert.deepEqual(c.actualParts[0],c.parts[0]);assert.equal(c.actualParts[1].name,'实际风扇');assert.equal(c.actualParts[2].goodsId,'400');
 const next=clone(c.parts);c.parts.splice(0,1);syncActualParts(c,next);assert.deepEqual(c.actualParts.map(p=>p.slot),['风扇','配件1']);
 const removed=clone(c.parts);c.parts.push(part('内存','500',2));syncActualParts(c,removed);assert.equal(c.actualParts.at(-1).qty,2);
});
test('continuous actual edits preserve the array reference; visual edits cannot reset the real bill',()=>{
 const c=config(),rows=ensureActualParts(c),before=clone(c.parts);rows[0]=part('CPU','300');
 c.parts[0].posterVisible=false;c.parts[0].upgrade='展示升级';c.parts[0].erp=999;syncActualParts(c,before);
 assert.equal(c.actualParts,rows);assert.equal(rows[0].goodsId,'300');rows[0].qty=5;syncActualParts(c,c.parts);assert.equal(c.actualParts[0].qty,5);
 assert.equal(c.parts[0].qty,1);
});
test('costs and ERP columns use actual quantities and IDs; posters still use display parts',()=>{
 const c=config(),shown=clone(c.parts);c.actualParts=[part('CPU','300',2)];
 assert.equal(totals(c).erp,600);assert.equal(totals(c).tax,620);assert.deepEqual(erpRow(c).slice(0,3),['300',erpRow(c)[1],'2']);
 assert.deepEqual(posterParts(c),shown);c.actualParts=[];assert.equal(totals(c).erp,0);assert.equal(erpRow(c)[0],'0');
});
test('new blank configs clear the real bill; templates preserve independently edited actual rows',()=>{
 const c=config();c.actualParts=[part('CPU','300',2)];const product={id:'p',shopId:'intel',name:'链接'};
 const blank=blankConfig(c,product);assert.deepEqual(blank.actualParts,blank.parts);assert.notEqual(blank.actualParts,blank.parts);
 const imported=importTemplateConfigs([c],product)[0];assert.deepEqual(imported.actualParts,c.actualParts);imported.actualParts[0].qty=9;assert.equal(c.actualParts[0].qty,2);
});
test('shared costs and ERP refresh update actual-only IDs without touching their descriptions',()=>{
 const c=config();c.actualParts=[part('CPU','300',2)];const s={configs:[c],sourceCatalog:[],costSource:[{goodsId:'300',name:'原始名',tax:310}]};
 applyManualCosts(s,[{goodsId:'300',tax:333}]);assert.equal(c.actualParts[0].tax,333);assert.equal(c.parts[0].tax,110);
 const {next}=mergeErp(s,[{goodsId:'300',name:'ERP 名称',erp:222,stockAvailable:5}],[],'now');
 assert.equal(next.configs[0].actualParts[0].erp,222);assert.equal(next.configs[0].actualParts[0].name,'配件 300');
});
test('cloud record round-trip preserves actual overrides and validates actual quantities',()=>{
 const c=config();c.actualParts=[part('CPU','300',2)];const s=normalizeWorkspaceState({...clone(seed),configs:[c],costSource:[{goodsId:'300',name:'ERP 名',tax:310,erp:300}],sourceCatalog:[],templates:[]});
 const records=projectWorkspace(s),record=records.find(r=>r.type==='configuration');validateWorkspaceRecord(record.type,record.id,record.data);
 assert.equal(record.data.actualParts[0].erp,undefined);assert.equal(record.data.actualParts[0].tax,undefined);
 const restored=applyWorkspace(s,records).configs[0];assert.equal(restored.actualParts[0].goodsId,'300');assert.equal(restored.actualParts[0].qty,2);assert.equal(restored.actualParts[0].tax,310);assert.equal(restored.actualParts[0].erp,300);assert.equal(restored.parts[0].goodsId,'100');
 record.data.actualParts[0].qty=-1;assert.throws(()=>validateWorkspaceRecord(record.type,record.id,record.data),/数量/);
});
test('inventory export/check and replacement use actual bill without changing poster parts',()=>{
 const c=config();c.actualParts=[part('CPU','300',2)];const costs=[{goodsId:'300',stockAvailable:0}],catalog=[{...part('CPU','400'),shopId:'intel'}];
 assert.deepEqual(inventoryPlan([c],'intel',[c.productId]).rows.map(r=>r.goodsId),['300']);
 const report=checkInventory([c],costs,'intel'),plan=stockReplacementPlan([c],costs,catalog,report,'300',[c.productId],'src-400');
 assert.deepEqual(plan.changes[0].after.parts,c.parts);assert.equal(plan.changes[0].after.actualParts[0].goodsId,'400');assert.equal(plan.changes[0].after.actualParts[0].qty,2);
});
