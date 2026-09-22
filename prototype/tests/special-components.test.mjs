import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcesFor,normalizeWorkspaceState} from '../shops.js';
import {specialComponentNames,normalizeSpecialComponent} from '../special-components.js';
import {replaceSourcePart} from '../source.js';
import {totals,erpRow,slots} from '../core.js';
import {costRows,mergeErp} from '../erp-sync.js';
import {sqlStockPlan} from '../sql-sync.mjs';
import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';
import {copyPartPayload,pastePartPayload,overviewProfits} from '../part-transfer.js';
const blank=()=>({configs:[],sourceCatalog:[],costSource:[],templates:[],shopSettings:{},caseGallery:[]});
test('five virtual presets per shop do not make a new workspace nonempty; deleted and edited defaults persist',()=>{
 const state=normalizeWorkspaceState(blank());assert.equal(state.sourceCatalog.length,0);
 for(const shop of ['intel','gigabyte','jonsbo']){const rows=sourcesFor(state,shop);assert.deepEqual(rows.map(r=>r.name),specialComponentNames);assert.ok(rows.every(r=>r.goodsId===''&&r.tax===0&&r.erp===0&&r.shopId===shop));}
 const original=sourcesFor(state,'intel')[0];state.sourceCatalog.push({...original,name:'自定义旧预设',deletedAt:'now'});
 const rows=sourcesFor(state,'intel');assert.equal(rows.length,5);assert.equal(rows[0].name,'自定义旧预设');assert.equal(rows[0].deletedAt,'now');
});
test('special replaces real binding and stale costs; all maintenance cells are zero without hiding a normal unbound part',()=>{
 const config={id:'c',shopId:'intel',price:1000,parts:[{slot:'CPU',goodsId:'123',sourceId:'old',qty:2,erp:999,tax:999}],addons:[{sourceId:'old',text:'旧加购'}]};
 replaceSourcePart(config,0,sourcesFor(blank(),'intel')[0]);assert.equal(config.parts[0].goodsId,'');assert.equal(config.parts[0].erp,0);assert.equal(config.parts[0].tax,0);assert.equal(config.addons.length,0);
 assert.deepEqual(erpRow(config).slice(0,4),['0','0','0','']);assert.equal(erpRow(config).length,56);assert.equal(totals(config).erp,0);assert.equal(totals(config).missing,0);assert.deepEqual(overviewProfits(config,{}),[860,980]);
 const payload=copyPartPayload(config,0),other=structuredClone(config);pastePartPayload(other,0,payload,sourcesFor(blank(),'intel'));assert.equal(other.parts[0].specialComponent,true);
 replaceSourcePart(config,0,{sourceId:'real',goodsId:'321',name:'真实 CPU',erp:400,tax:420});assert.equal(config.parts[0].specialComponent,false);assert.equal(erpRow(config)[0],'321');assert.equal(totals(config).erp,800);
 config.parts[0].goodsId='';assert.throws(()=>erpRow(config),/尚未绑定/);
});
test('custom special records survive cloud projection and templates without becoming ERP components',()=>{
 const special=normalizeSpecialComponent({sourceId:'custom',shopId:'intel',specialComponent:true,name:'自定义服务',goodsId:'',erp:999,tax:999,slot:'配件1',qty:1});
 const state={...blank(),sourceCatalog:[special],configs:[{id:'c',shopId:'intel',price:500,parts:[special],addons:[]}],templates:[{id:'t',configs:[{parts:[special]}]}]};
 const records=projectWorkspace(state);assert.equal(records.filter(r=>r.type==='component').length,0);assert.equal(costRows(state.sourceCatalog).length,0);
 const next=applyWorkspace(blank(),records);for(const item of [next.sourceCatalog[0],next.configs[0].parts[0],next.templates[0].configs[0].parts[0]]){assert.equal(item.erp,0);assert.equal(item.tax,0);assert.equal(item.goodsId,'');}
 assert.equal(erpRow(next.configs[0])[slots.indexOf('配件1')*4],'0');
 const sql=sqlStockPlan(next,[{goodsId:'5',name:'正常',erp:12,stockAvailable:3}]).next;assert.equal(sql.configs[0].parts[0].erp,0);
 const erp=mergeErp(next,[{goodsId:'5',name:'正常',erp:12,stockAvailable:3}],[],'now').next;assert.equal(erp.sourceCatalog[0].erp,0);assert.equal(erp.sourceCatalog[0].erpMissing,false);
});
