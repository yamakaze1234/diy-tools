import {actualParts} from '../prototype/actual-parts.js';
import {sourcePart} from '../prototype/source.js';
import {slots} from '../prototype/core.js';
import {specialChoices} from './special-parts.mjs';
export const partKey=p=>p.specialComponent?'name:'+p.name:p.goodsId?'id:'+p.goodsId:'name:'+p.name;
export function batchCatalog(state,shopId){
 const sources=new Map();for(const s of state.sources){if(s.shopId!==shopId||s.deletedAt||s.specialComponent)continue;const list=sources.get(s.goodsId)||[];list.push(s);sources.set(s.goodsId,list);}
 return [...state.catalog.flatMap(p=>{const list=sources.get(p.goodsId);return list?.length?list.map(s=>({...p,...s,shopId})):[{...p,shopId}];}),...specialChoices(state,shopId)].map(p=>({...p,search:(p.name+' '+p.goodsId).toLowerCase()}));
}
export function planParts(configs,{mode,key,row,slot,qty,shopId}){
 if(!row||row.shopId!==shopId)throw Error('请选择本店配件');
 if(!['replace','add'].includes(mode))throw Error('请选择操作');
 if(qty!==null&&(!Number.isInteger(qty)||qty<1||qty>100000))throw Error('数量必须为 1–100000 的整数');
 if(mode==='add'&&(!slots.includes(slot)||qty===null))throw Error('添加配件需要选择槽位并填写数量');
 if(mode==='replace'&&!key)throw Error('请选择原配件');
 const changes=[];
 for(const c of configs){
  if(c.shopId!==shopId)throw Error('不能跨店修改配置');
  const parts=actualParts(c);if(mode==='add'&&parts.some(p=>p.slot===slot&&(p.name||p.goodsId)))throw Error(`${c.product||''} / ${c.name} 的 ${slot} 已有配件，请使用替换或选择空槽位`);
  const after=structuredClone(c);after.actualParts=structuredClone(parts);const diffs=[];
  let indices=mode==='replace'?parts.flatMap((p,i)=>partKey(p)===key?[i]:[]):[parts.findIndex(p=>p.slot===slot)];
  for(let i of indices){if(i<0){i=after.actualParts.length;after.actualParts.push({lineId:crypto.randomUUID(),slot,qty:1});}
   const p=after.actualParts[i],old=structuredClone(p),same=p.goodsId===row.goodsId&&p.sourceId===row.sourceId&&!!p.specialComponent===!!row.specialComponent;
   Object.assign(p,sourcePart(row),{lineId:p.lineId||crypto.randomUUID(),qty:qty??p.qty});if(!same)delete p.addonOverride;
   if(JSON.stringify(old)!==JSON.stringify(p))diffs.push({slot:p.slot,before:old.name?`${old.name} × ${old.qty}`:'空',after:`${p.name} × ${p.qty}`});
  }
  if(diffs.length)changes.push({id:c.id,before:c,after,diffs});
 }
 return changes;
}
