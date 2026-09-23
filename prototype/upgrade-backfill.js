import {sourceUpgradeDescription} from './source.js';

// Fill only missing descriptions from the same shop's exact output-source ID.
export function backfillMissingSourceUpgrades(configs,rows){
 const sources=new Map(rows.filter(r=>!r.deletedAt).map(r=>[r.sourceId,r]));
 const changes=[];
 for(const config of configs){
  if(config.deletedAt)continue;
  for(const part of config.parts||[]){
   if(String(part.upgrade||'').trim()||!part.sourceId)continue;
   const row=sources.get(part.sourceId);
   if(!row||row.shopId!==config.shopId||part.goodsId!==row.goodsId)continue;
   const text=sourceUpgradeDescription(row,config.addons?.filter(a=>a.sourceId===row.sourceId)||[]);
   if(!text)continue;
   part.upgrade=text;
   changes.push({configId:config.id,slot:part.slot,sourceId:row.sourceId});
  }
 }
 return changes;
}
