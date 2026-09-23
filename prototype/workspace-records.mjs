import {allConfigParts} from './actual-parts.js';
import {isSpecialComponent,normalizeSpecialComponent} from './special-components.js';
import {stripLocalErp,localErpFields} from './local-erp-policy.mjs';
import {restoreConfigOrder} from './config-order.js';
import {createHash} from 'node:crypto';
import {equal,recordKey} from '../shared/sync/protocol.mjs';
const copy=v=>structuredClone(v);
export const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const derived=['erp','tax','stockAvailable','stockUpdatedAt','erpUpdatedAt','erpMissing','erpUnknown','taxUpdatedAt'];
const strip=row=>{const r=stripLocalErp(row);for(const k of derived)delete r[k];return r;};
const cents=v=>v==null?null:Math.round(v*100);
export function projectWorkspace(state,configurationOnly=false,selected=null){
 const records=[],scope=state.sharedCostScope||state.erpSync?.scope||'unbound',seen=new Set(),componentIds=new Set((state.costSource||[]).map(c=>c.goodsId));
 const wanted=(type,id)=>!selected||selected[type]===null||selected[type].has(id);
 const add=(type,id,data)=>{const key=recordKey(type,id);if(seen.has(key))throw Error('重复记录 ID：'+id);seen.add(key);records.push({type,id,data:stripLocalErp(data)});};
 // Product grouping can change array positions without changing the saved order.
 // Keep that order in the edit baseline so deletion does not look concurrent.
 for(const [index,c] of (state.configs||[]).entries()){if(!wanted('configuration',c.id))continue;const d=copy(c);d.workspaceOrder=Number.isFinite(c.workspaceOrder)?c.workspaceOrder:index;d.priceCents=cents(d.price);delete d.price;for(const k of ['deletionSessionId','updatedAt','taxUpdatedAt','erpImportedAt'])delete d[k];for(const field of ['parts',...(Array.isArray(d.actualParts)?['actualParts']:[])])d[field]=d[field].map((p,i)=>({...(!componentIds.has(p.goodsId)||c.deletedAt?copy(p):strip(p)),lineId:p.lineId||'line-'+hash(field==='parts'?[c.id,i,p.slot]:[c.id,field,i,p.slot]).slice(0,24)}));add('configuration',c.id,d);}
 if(configurationOnly)return records;
 for(const c of state.costSource||[])if(wanted('component',c.goodsId)&&(!c.localInventoryOnly||c.tax!=null))add('component',`${scope}|${c.goodsId}`,{erpScopeId:scope,goodsId:c.goodsId,name:c.name,taxCents:cents(c.tax)});
 for(const s of state.sourceCatalog||[])if(wanted('source',s.sourceId))add('source',s.sourceId,componentIds.has(s.goodsId)?strip(s):copy(s));
 for(const t of state.templates||[])if(wanted('template',t.id))add('template',t.id,copy(t));
 for(const [id,d] of Object.entries(state.shopSettings||{})){if(!wanted('settings',id))continue;const data={...copy(d),couponCents:cents(d.coupon)};delete data.coupon;add('settings',id,data);}
 for(const g of state.caseGallery||[])if(wanted('gallery',g.id))add('gallery',g.id,copy(g));
 return records;
}
export function applyWorkspace(template,records){
 const next=copy(template),groups=new Map();for(const r of records){if(!groups.has(r.type))groups.set(r.type,[]);groups.get(r.type).push(r);}
 const values=type=>(groups.get(type)||[]).map(r=>stripLocalErp(r.draft??r.data));
 next.configs=values('configuration').map(d=>{d.price=d.priceCents/100;delete d.priceCents;return d;});
 const previous=new Map((template.configs||[]).map((c,i)=>[c.id,i]));next.configs.sort((a,b)=>(a.workspaceOrder??previous.get(a.id)??Number.MAX_SAFE_INTEGER)-(b.workspaceOrder??previous.get(b.id)??Number.MAX_SAFE_INTEGER));next.configs=restoreConfigOrder(next.configs);
 next.templates=values('template');next.sourceCatalog=values('source');next.caseGallery=values('gallery');next.shopSettings={};
 for(const r of groups.get('settings')||[]){const d=copy(r.draft??r.data);next.shopSettings[r.id]={...d,coupon:d.couponCents/100};delete next.shopSettings[r.id].couponCents;}
 const localRows=new Map();for(const r of [...(template.sourceCatalog||[]),...(template.configs||[]).flatMap(allConfigParts),...(template.costSource||[])])if(r.goodsId)localRows.set(r.goodsId,{...localRows.get(r.goodsId),...r});
 const components=values('component').filter(c=>!c.deletedAt),scope=components[0]?.erpScopeId;
 if(scope)next.sharedCostScope=scope;
 const inventory=new Map((template.costSource||[]).map(r=>[r.goodsId,copy(r)]));
 for(const c of components)inventory.set(c.goodsId,{...inventory.get(c.goodsId),goodsId:c.goodsId,name:c.name,tax:c.taxCents==null?null:c.taxCents/100});
 for(const c of values('component').filter(c=>c.deletedAt))inventory.delete(c.goodsId);
 next.costSource=[...inventory.values()];
 const restore=value=>{if(!value||typeof value!=='object')return;for(const child of Object.values(value))if(child&&typeof child==='object')restore(child);if(isSpecialComponent(value)){Object.assign(value,normalizeSpecialComponent(value));return;}if(typeof value.goodsId==='string'&&('name' in value||'slot' in value)){const local=localRows.get(value.goodsId);for(const key of localErpFields){if(local&&key in local)value[key]=copy(local[key]);}value.erp=local?.erp??null;value.stockAvailable=local?.stockAvailable??null;}};
 restore(next.configs);restore(next.templates);restore(next.sourceCatalog);restore(next.costSource);
 const costs=new Map(next.costSource.map(c=>[c.goodsId,c]));
 const enrich=r=>{if(isSpecialComponent(r)){Object.assign(r,normalizeSpecialComponent(r));return;}const c=costs.get(r.goodsId);if(!c)return;for(const k of derived)if(k in c)r[k]=copy(c[k]);};
 next.sourceCatalog.forEach(enrich);next.configs.forEach(c=>{if(!c.deletedAt)allConfigParts(c).forEach(enrich);});return next;
}
function changedProjectionIds(before,after){
 const changed=(oldRows,newRows,key,transform=row=>row)=>{
  const index=rows=>{const map=new Map();for(const [i,row] of (rows||[]).entries()){const id=row[key];if(map.has(id))throw Error('重复记录 ID：'+id);map.set(id,JSON.stringify(transform(row,i)));}return map;};
  const old=index(oldRows),fresh=index(newRows);
  return new Set([...new Set([...old.keys(),...fresh.keys()])].filter(id=>old.get(id)!==fresh.get(id)));
 };
 const settings=state=>Object.entries(state.shopSettings||{}).map(([id,data])=>({id,data}));
 const selected={configuration:changed(before.configs,after.configs,'id',(c,i)=>({...c,workspaceOrder:Number.isFinite(c.workspaceOrder)?c.workspaceOrder:i})),component:changed(before.costSource,after.costSource,'goodsId'),source:changed(before.sourceCatalog,after.sourceCatalog,'sourceId'),template:changed(before.templates,after.templates,'id'),settings:changed(settings(before),settings(after),'id'),gallery:changed(before.caseGallery,after.caseGallery,'id')};
 // Component membership controls stripping of derived prices from both sources
 // and configurations. Re-project those records when that dependency changes.
 const oldIds=new Set((before.costSource||[]).map(c=>c.goodsId)),newIds=new Set((after.costSource||[]).map(c=>c.goodsId));
 if(oldIds.size!==newIds.size||[...oldIds].some(id=>!newIds.has(id))){selected.configuration=null;selected.source=null;}
 if((before.sharedCostScope||before.erpSync?.scope||'unbound')!==(after.sharedCostScope||after.erpSync?.scope||'unbound'))selected.component=null;
 return selected;
}
export function changesBetween(before,after){
 // Saving gallery metadata does not change component/configuration records.
 // Compare their inputs once instead of projecting and hashing every ERP row.
 if(['configs','costSource','sourceCatalog','templates','shopSettings','sharedCostScope'].every(key=>JSON.stringify(before[key])===JSON.stringify(after[key]))&&equal(before.erpSync?.scope,after.erpSync?.scope)){
  const galleryOnly=state=>({...state,configs:[],costSource:[],sourceCatalog:[],templates:[],shopSettings:{}});
  const old=new Map(projectWorkspace(galleryOnly(before)).map(r=>[recordKey(r.type,r.id),r])),changes=[];
  for(const r of projectWorkspace(galleryOnly(after))){const key=recordKey(r.type,r.id),prev=old.get(key);if(!prev||!equal(prev.data,r.data))changes.push({...r,expectedDraft:prev?.data});old.delete(key);}
  for(const r of old.values())changes.push({...r,data:{...r.data,deletedAt:new Date().toISOString()},expectedDraft:r.data});
  return changes;
 }
 const selected=changedProjectionIds(before,after);
 const old=new Map(projectWorkspace(before,false,selected).map(r=>[recordKey(r.type,r.id),r])),fresh=projectWorkspace(after,false,selected),changes=[];
 // Legacy records have no saved order. Do not invent one in the comparison
 // baseline: it would make an unchanged stored record appear remotely edited.
 const legacyOrder=new Set((before.configs||[]).filter(c=>!Number.isFinite(c.workspaceOrder)).map(c=>c.id));
 for(const r of fresh){const prev=old.get(recordKey(r.type,r.id));if(!prev||!equal(prev.data,r.data))changes.push({...r,expectedDraft:prev?.data});old.delete(recordKey(r.type,r.id));}
 for(const r of old.values())if(!['erp_chunk','erp_snapshot'].includes(r.type))changes.push({...r,data:{...r.data,deletedAt:new Date().toISOString()},expectedDraft:r.data});
 for(const change of changes)if(change.type==='configuration'&&legacyOrder.has(change.id)&&change.expectedDraft)delete change.expectedDraft.workspaceOrder;
 return changes;
}
export function migrationSummary(state){const records=projectWorkspace(state),roundtrip=applyWorkspace(state,records);const issues=[];
 const costs=new Map((state.costSource||[]).map(c=>[c.goodsId,c]));
 for(const c of state.configs||[])for(const p of allConfigParts(c)){const shared=costs.get(p.goodsId);if(shared&&cents(p.tax)!==cents(shared.tax))issues.push({code:'COST_DIFF',configId:c.id,goodsId:p.goodsId,message:'配置缓存成本与共享成本不同'});}
 if(records.some(r=>r.type==='component')&&!state.sharedCostScope&&!state.erpSync?.scope)issues.push({code:'SCOPE_MISSING',message:'请先确认成本对应的 ERP 账套/仓库来源'});
 const expected=new Map((state.configs||[]).map(c=>[c.id,cents(c.price)]));if(roundtrip.configs.some(c=>cents(c.price)!==expected.get(c.id)))issues.push({code:'PRICE_DIFF',message:'售价换算不一致'});
 return {hash:hash(records),counts:records.reduce((a,r)=>(a[r.type]=(a[r.type]||0)+1,a),{}),issues,records};
}
