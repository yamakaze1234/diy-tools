import {allConfigParts} from './actual-parts.js';
import {isSpecialComponent,normalizeSpecialComponent} from './special-components.js';
import {excludedComponent} from './component-policy.js';
import {clone} from './core.js';
import {selectedSourceAddons} from './addon-data.js';

export function sourceCatalog(rows){return rows.map((r,i)=>({...clone(r),sourceId:r.sourceId||`catalog-${i}`,shopId:r.shopId||'intel',originalName:r.originalName||r.name,addonText:r.addonText||'',addonNote:r.addonNote||''}));}
export function bindSources(configs,catalog){for(const c of configs){const scoped=catalog.filter(r=>r.shopId===(c.shopId||'intel'));for(const p of allConfigParts(c)){if(p.sourceId&&scoped.some(r=>r.sourceId===p.sourceId))continue;const ids=scoped.filter(r=>r.goodsId&&r.goodsId===p.goodsId);const exact=ids.filter(r=>r.name===p.name||r.originalName===p.name);const row=exact.length===1?exact[0]:ids.length===1?ids[0]:null;if(row)p.sourceId=row.sourceId;}}}
export function alignDisplaySourceNames(configs,catalog){
 const sources=new Map(catalog.map(row=>[row.sourceId,row]));
 for(const config of configs)for(const part of config.parts||[]){
  const source=sources.get(part.sourceId);
  if(!source||source.shopId!==(config.shopId||'intel')||source.goodsId!==part.goodsId||!source.name||part.name===source.name)continue;
  if(!part.displayName&&part.name)part.displayName=part.name;
  part.name=source.name;
 }
}
export function sourcePart(row){row=normalizeSpecialComponent(row);if(excludedComponent(row))throw Error('带 * 或 *! 标记的配件不可选用');if(row.deletedAt)throw Error('该输出源已删除，请先恢复');const {sourceId,goodsId,name,erp,tax}=row;return{sourceId,goodsId,name,erp,tax,upgrade:'',specialComponent:isSpecialComponent(row),stockAvailable:row.stockAvailable??null,stockUpdatedAt:row.stockUpdatedAt??null,stockSource:row.stockSource??null,erpUpdatedAt:row.erpUpdatedAt??null,erpMissing:row.erpMissing??false,erpUnknown:row.erpUnknown??(erp==null),erpName:row.erpName||row.originalName||name};}
export function sourceUpgradeDescription(row,previous=[]){
 return selectedSourceAddons(row,previous).map(a=>a.text?.trim()).filter(Boolean).join('')||String(row.upgrade||'').trim();
}
export function replaceSourcePart(config,index,row){
 const description=sourceUpgradeDescription(row,config.addons?.filter(a=>a.sourceId===row.sourceId)||[]);
 delete config.parts[index].displayName;
 Object.assign(config.parts[index],sourcePart(row),{upgrade:description});
}
const hasDescriptionSetting=row=>!!row.addonChoices?.length||row.addonShowTogether!==undefined||(row.addonVariants||[]).some(v=>v.showTogether!==undefined);
const descriptionFields=fields=>[...new Set(fields.map(field=>field==='addon'?'upgrade':field))];
export function sourceDiff(configs,row,fields){fields=descriptionFields(fields);const result=[];for(const config of configs){if(config.deletedAt)continue;const changes=[];const description=fields.includes('upgrade')?sourceUpgradeDescription(row,config.addons?.filter(a=>a.sourceId===row.sourceId)||[]):'';for(const p of config.parts.filter(p=>p.sourceId===row.sourceId))for(const key of ['name','tax','upgrade']){if(!fields.includes(key))continue;const target=key==='upgrade'?description:row[key];if(key==='upgrade'&&!target&&!hasDescriptionSetting(row))continue;if((p[key]??'')!==(target??''))changes.push({slot:p.slot,field:key,before:p[key]??'',after:target??''});}if(changes.length)result.push({configId:config.id,product:config.product,name:config.name,changes});}return result;}
export function syncSource(configs,row,fields){fields=descriptionFields(fields);const diff=sourceDiff(configs,row,fields),ids=new Set(diff.map(d=>d.configId));for(const c of configs){if(!ids.has(c.id))continue;for(const p of c.parts.filter(p=>p.sourceId===row.sourceId))for(const key of ['name','tax','upgrade'])if(fields.includes(key)){const target=key==='upgrade'?sourceUpgradeDescription(row,c.addons?.filter(a=>a.sourceId===row.sourceId)||[]):row[key];if(key!=='upgrade'||target||hasDescriptionSetting(row))p[key]=target;}if(diff.find(d=>d.configId===c.id).changes.some(change=>change.field==='tax'))c.taxUpdatedAt=new Date().toISOString();}return diff;}

export function setSourceDeleted(rows,id,deleted=true,at=new Date().toISOString()){const row=rows.find(r=>r.sourceId===id);if(!row)throw Error('输出源不存在');if(deleted)row.deletedAt=at;else delete row.deletedAt;return row;}

// Display descriptions belong to the shop's output source; ERP names are searchable aliases.
export function preferredSourceRows(rows,costs=[]){const byId=new Map(costs.map(r=>[r.goodsId,r]));return rows.map(r=>{if(isSpecialComponent(r))return normalizeSpecialComponent(r);const cost=byId.get(r.goodsId);return {...r,name:String(r.name||'').trim()||r.originalName||cost?.name||'',...(cost?{erp:cost.erp??null,tax:cost.tax??r.tax,stockAvailable:cost.stockAvailable??null,stockUpdatedAt:cost.stockUpdatedAt??null,stockSource:cost.stockSource??null,erpMissing:cost.erpMissing??false,erpUnknown:cost.erpUnknown??(cost.erp==null),erpName:cost.name||r.erpName||r.originalName||r.name}:{})};}).sort((a,b)=>Number(!!b.name&&!!(b.originalName||byId.get(b.goodsId)?.name)&&b.name!==(b.originalName||byId.get(b.goodsId)?.name))-Number(!!a.name&&!!(a.originalName||byId.get(a.goodsId)?.name)&&a.name!==(a.originalName||byId.get(a.goodsId)?.name)));}
