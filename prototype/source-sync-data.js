import {sourceDiff,syncSource} from './source.js';
import {selectableComponents} from './component-policy.js';
export function sourceSyncPlan(configs,rows,fields,shopId){
 if(!fields.length)throw Error('请至少勾选一个同步字段');
 const catalog=selectableComponents(rows).filter(r=>!r.deletedAt&&r.shopId===shopId),byId=new Map(catalog.map(r=>[r.sourceId,r])),used=new Map(),changes=[];
 for(const c of configs.filter(c=>!c.deletedAt&&c.shopId===shopId)){
  const after=structuredClone(c),details=[];
  for(const id of new Set(c.parts.map(p=>p.sourceId))){const row=byId.get(id);if(!row)continue;const diffs=sourceDiff([after],row,fields);if(!diffs.length)continue;details.push(...diffs[0].changes);syncSource([after],row,fields);used.set(id,structuredClone(row));}
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
export function sourceImageEntries(configs){return configs.flatMap((c,i)=>['long','square'].map(layout=>({name:`${safe(c.spu||c.productId)}_${safe(c.product)}/${layout==='long'?'配置清单图':'SKU图'}/${String(i+1).padStart(3,'0')}_${safe(c.name)}.png`,config:{...structuredClone(c),layout}})));}
