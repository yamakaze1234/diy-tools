// Pure business rules shared with the existing UI. No filesystem/network/Node runtime.
export {normalizeWorkspaceState} from '../prototype/shops.js';
export {projectWorkspace,applyWorkspace,changesBetween,migrationSummary,hash,mergeWorkspaceEdit} from '../prototype/workspace-records.mjs';
export {stripLocalErp,keepCloudType} from '../prototype/local-erp-policy.mjs';
export {mergeRecord,equal} from '../shared/sync/protocol.mjs';
export {validateWorkspaceRecord} from '../prototype/workspace-validation.mjs';
export {recentActivity,activityEntry} from '../prototype/activity.js';
import {recentActivity as recent,activityEntry as activity} from '../prototype/activity.js';
export function batchActivityEntries(changes,details,logs){const events=changes.map(c=>activity(c.type,c.id,c.expectedDraft,c.data,details)).filter(Boolean);return {events,logs:recent(events.concat(logs||[]))};}
export {sqlStockPlan} from '../prototype/sql-sync.mjs';
export {validateGallery} from '../prototype/case-gallery-data.js';
export {validateAddon,sourceAddon} from '../prototype/addon-data.js';
import {validateAddon,sourceAddon} from '../prototype/addon-data.js';
// Cross the Python/JS boundary once per save, retaining the same validators.
export function validateSaveAddons(sources,addons){
 for(const row of sources)validateAddon(sourceAddon(row));
 for(const addon of addons)validateAddon(addon);
 return true;
}
export {validateSnapshot,mergeErp} from '../prototype/erp-sync.js';
import {ErpJobs,browserErpScope} from '../prototype/erp-sync.js';
let scope=null;const jobs=new ErpJobs(()=>scope);
export function erpJob(action,data,info){scope=browserErpScope(info);if(action==='complete'){Object.assign(jobs.job,{status:'complete',completedAt:data.updatedAt,result:data});return {ok:true};}if(action==='operator'){jobs.job.operator=data;return {ok:true};}return jobs[action](data);}

export {mergeEditingState} from '../prototype/workspace-ui-merge.js';

export {initializeActualParts} from '../prototype/actual-parts.js';
export {parseStandardProduct,standardProducts} from '../prototype/product-standard.js';
import {standardProducts as buildStandardProducts} from '../prototype/product-standard.js';
import {projectWorkspace as project,applyWorkspace as apply,mergeWorkspaceEdit as mergeEdit,changesBetween} from '../prototype/workspace-records.mjs';
import {validateWorkspaceRecord as validateRecord} from '../prototype/workspace-validation.mjs';
import {equal as recordsEqual,mergeRecord as plainMerge} from '../shared/sync/protocol.mjs';

// Keep the business rules on one side of the Python/QuickJS boundary. The
// context contains only the target configurations and their cost dependencies.
export function prepareBatchConfigurations(context,changes,stored){
 const rows=[],materialize=[],edited=[];
 const shared=new Set((context.costSource||[]).map(r=>r.goodsId));
 for(const [index,change] of changes.entries()){
  if(recordsEqual(change.after,change.current))continue;
  const order=Number.isFinite(change.current.workspaceOrder)?change.current.workspaceOrder:change.order;
  const base={...change.base,workspaceOrder:Number.isFinite(change.base.workspaceOrder)?change.base.workspaceOrder:order};
  const after={...change.after,workspaceOrder:Number.isFinite(change.after.workspaceOrder)?change.after.workspaceOrder:order};
  const tiny={configs:[base],costSource:context.costSource||[],sharedCostScope:context.sharedCostScope,erpSync:context.erpSync};
  const original=project(tiny,true)[0];
  tiny.configs=[after];
  const next=project(tiny,true)[0];
  const previous=stored[index];
  let expected=original.data;
  if(previous&&previous.draft&&!Object.hasOwn(previous.draft,'actualParts'))delete expected.actualParts;
  if(previous&&previous.draft&&!Object.hasOwn(previous.draft,'workspaceOrder'))delete expected.workspaceOrder;
  let value=next.data;
  if(previous?.draft){
   const related=new Set([...(previous.draft.parts||[]),...(previous.draft.actualParts||[])].map(p=>p.goodsId));
   const merged=mergeEdit('configuration',expected,value,previous.draft,[...related].filter(id=>shared.has(id)));
   if(merged.fields.length)throw Object.assign(Error('编辑期间同一字段已变化：'+merged.fields.join('、')),{status:409});
   value=merged.value;
  }
  validateRecord('configuration',change.id,value);
  if(!previous||!recordsEqual(previous.draft,value))rows.push({type:'configuration',id:change.id,data:value,expectedDraft:expected});
  materialize.push({type:'configuration',id:change.id,draft:value});
  edited.push(change);
 }
 const template={configs:edited.map(c=>c.current),templates:[],sourceCatalog:context.sourceCatalog||[],costSource:context.costSource||[],shopSettings:{},caseGallery:[],sharedCostScope:context.sharedCostScope,erpSync:context.erpSync};
 const configs=materialize.length?initializeMaterializedState(apply(template,materialize)).configs:[];
 const originals=new Map(edited.map(change=>[change.id,change]));
 for(const config of configs){const change=originals.get(config.id);for(const field of ['parts','actualParts','addons'])if(recordsEqual(change.after[field],change.current[field])){
  if(Object.hasOwn(change.current,field))config[field]=change.current[field];else delete config[field];
 }}
 const result=new Map(configs.map(c=>[c.id,c]));
 return {rows,configs:changes.map(c=>result.get(c.id)||c.current)};
}

export function prepareWorkspaceChanges(before,after){return changesBetween(before,after);}
export function validateAndMergeChanges(changes,stored,sharedCostIds){
 const shared=new Set(sharedCostIds||[]),output=[];
 for(const [index,change] of changes.entries()){
  const row=stored[index];let data=change.data;
  if(row&&Object.hasOwn(change,'expectedDraft')){
   const relevant=new Set([...(row.draft?.parts||[]),...(row.draft?.actualParts||[])].map(p=>p.goodsId));
   relevant.add(row.draft?.goodsId);
   const merged=sharedCostIds===null?plainMerge(change.expectedDraft,data,row.draft):mergeEdit(change.type,change.expectedDraft,data,row.draft,[...relevant].filter(id=>shared.has(id)));
   if(merged.fields.length)throw Object.assign(Error('编辑期间同一字段已变化：'+merged.fields.join('、')),{status:409});
   data=merged.value;
  }
  validateRecord(change.type,change.id,data);
  output.push({...change,data});
 }
 return output;
}

export function standardProductsForLinks(state,links){
 const wanted=new Set(links.map(([shop,id])=>shop+'\u0000'+id));
 return buildStandardProducts({...state,configs:(state.configs||[]).filter(c=>wanted.has(c.shopId+'\u0000'+(c.productId||'legacy:'+String(c.spu||c.product||c.id))))});
}

import {initializeActualParts as initializeParts} from "../prototype/actual-parts.js";
import {normalizePosterDesign} from "../prototype/poster-design.js";
// Materialized legacy records need the same in-memory defaults as loaded records.
export function initializeMaterializedState(state){initializeParts(state);for(const config of state.configs||[])normalizePosterDesign(config);return state;}

export {validateConfigCapacity} from '../prototype/config-capacity.js';
