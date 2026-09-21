// Display parts drive posters; actualParts is the bill of materials for costing/export.
const copy=value=>structuredClone(value);
export const actualParts=config=>Array.isArray(config.actualParts)?config.actualParts:(config.parts||[]);
export function ensureActualParts(config){
 if(!Object.hasOwn(config,'actualParts'))config.actualParts=copy(config.parts||[]);
 if(!Array.isArray(config.actualParts))throw Error('实际配置必须是配件清单');
 return config.actualParts;
}
// Only a deliberate component/name/quantity edit replaces the corresponding row.
// Poster visibility, upgrade text and refreshed costs must not erase an independent BOM.
const componentKeys=['name','goodsId','sourceId','qty','specialComponent'];
export function syncActualParts(config,beforeParts){
 const rows=ensureActualParts(config);
 if(!beforeParts)return rows;
 const previous=new Map(beforeParts.map(p=>[p.slot,p])),present=new Set((config.parts||[]).map(p=>p.slot));
 for(let i=rows.length-1;i>=0;i--)if(previous.has(rows[i].slot)&&!present.has(rows[i].slot))rows.splice(i,1);
 for(const part of config.parts||[]){
  const old=previous.get(part.slot);
  if(old&&componentKeys.every(key=>JSON.stringify(old[key])===JSON.stringify(part[key])))continue;
  const index=config.actualParts.findIndex(p=>p.slot===part.slot),next=copy(part);
  if(index<0)config.actualParts.push(next);else config.actualParts[index]=next;
 }
 return config.actualParts;
}
export const allConfigParts=config=>[...(config.parts||[]),...(config.actualParts||[])];

export function initializeActualParts(state){
 for(const c of [...(state.configs||[]),...(state.templates||[]).flatMap(t=>t.configs||[t.config].filter(Boolean))])ensureActualParts(c);
 return state;
}
