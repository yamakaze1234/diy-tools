export function applyBatchContent(reference,target,{addons=false,benefits=false,version=false}={}){
 if(version)target.version=reference.version||'';
 if(addons){
  target.addons=structuredClone(reference.addons||[]);
  for(const addon of target.addons)if(addon.sourceId&&!target.parts.some(p=>p.sourceId===addon.sourceId))delete addon.sourceId;
 }
 if(benefits)target.benefits=structuredClone(reference.benefits||[]);
 return target;
}
