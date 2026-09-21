import {numberedImageEntries} from './image-export-order.js';
import {sourceDiff,syncSource} from './source.js';
import {selectableComponents} from './component-policy.js';
export const sourceChangeKey=(configId,sourceId,slot,field)=>JSON.stringify([configId,sourceId,slot,field]);
export function sourceSyncPlan(configs,rows,fields,shopId,options={}){
 if(!fields.length)throw Error('请至少勾选一个同步字段');
 const catalog=selectableComponents(rows).filter(r=>!r.deletedAt&&r.shopId===shopId),byId=new Map(catalog.map(r=>[r.sourceId,r])),used=new Map(),changes=[];
 const retained=new Set(options.retained||[]);
 for(const c of configs.filter(c=>!c.deletedAt&&c.shopId===shopId&&(!options.productIds||options.productIds.includes(c.productId)))){
  const after=structuredClone(c),details=[];
  for(const id of new Set(c.parts.map(p=>p.sourceId))){
   const row=byId.get(id);if(!row)continue;
   const selectedFields=fields.filter(f=>f!=='addon'||!retained.has(sourceChangeKey(c.id,id,'加购',f)));
   const diffs=sourceDiff([after],row,selectedFields);if(!diffs.length)continue;
   const selected=diffs[0].changes.map(d=>({...d,key:sourceChangeKey(c.id,id,d.slot,d.field)})).filter(d=>!retained.has(d.key));
   if(!selected.length)continue;
   const before=structuredClone(after);syncSource([after],row,selectedFields);
   after.parts.forEach((p,i)=>{if(p.sourceId===id)for(const field of ['name','tax','upgrade'])if(retained.has(sourceChangeKey(c.id,id,p.slot,field))){if(Object.hasOwn(before.parts[i],field))p[field]=before.parts[i][field];else delete p[field];}});
   if(!selected.some(d=>d.field==='tax')){if(Object.hasOwn(before,'taxUpdatedAt'))after.taxUpdatedAt=before.taxUpdatedAt;else delete after.taxUpdatedAt;}
   details.push(...selected);used.set(id,structuredClone(row));
  }
  if(details.length)changes.push({id:c.id,product:c.product,name:c.name,before:structuredClone(c),after,details});
 }
 return {shopId,fields:[...fields],sources:[...used.values()],changes};
}
export function applySourceSync(plan,configs,rows){
 for(const before of plan.sources){const current=rows.find(r=>r.sourceId===before.sourceId);if(JSON.stringify(current)!==JSON.stringify(before))throw Error('输出源已变化，请重新预览');}
 const targets=plan.changes.map(change=>{const c=configs.find(c=>c.id===change.id);if(!c||c.shopId!==plan.shopId||JSON.stringify(c)!==JSON.stringify(change.before))throw Error('配置已变化，请重新预览');return c;});
 targets.forEach((c,i)=>Object.assign(c,structuredClone(plan.changes[i].after)));return targets.map(c=>c.id);
}
const safe=v=>String(v||'未命名').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,65);
export function sourceImageEntries(configs){
 const groups=new Map(),folders=new Set();
 for(const c of configs){const key=JSON.stringify([c.shopId,c.productId||c.product||c.spu||'']);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
 return [...groups.values()].flatMap(rows=>{const first=rows[0],base=`${safe(first.spu||first.productId)}_${safe(first.product)}`;let folder=base,n=2;while(folders.has(folder))folder=base+'_'+n++;folders.add(folder);return numberedImageEntries(rows).flatMap(({config:c,name})=>['long','square'].map(layout=>({name:`${folder}/${layout==='long'?'配置清单图':'SKU图'}/${name}`,config:{...structuredClone(c),layout}})));});
}
