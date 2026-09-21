export const DEFAULT_SERVICE_TEXT='官方直营 | 直播装机 | 顺丰包邮 | 保价双11';
export const LEGACY_SERVICE_TEXT='官方直营 | 直播装机 | 顺丰包邮 | 保价双十一';
export const defaultServiceText=(state,shopId)=>state.shopSettings?.[shopId]?.serviceText??DEFAULT_SERVICE_TEXT;

// Only explicit opt-in updates existing live configurations; preserve custom copy and styling.
export function saveServiceDefault(state,shopId,text,updateExisting=false){
 if(typeof text!=='string'||text.length>1000)throw Error('服务承诺最多 1000 字');
 const previous=defaultServiceText(state,shopId),matches=new Set([previous]);
 if(previous===DEFAULT_SERVICE_TEXT)matches.add(LEGACY_SERVICE_TEXT);
 const changed=[];
 if(updateExisting)for(const config of state.configs||[]){
  if(config.shopId!==shopId||config.deletedAt)continue;
  let updated=false;
  for(const module of config.modules||[])if(module.type==='service'&&matches.has(module.text)&&module.text!==text){module.text=text;updated=true;}
  if(updated)changed.push(config.id);
 }
 state.shopSettings??={};state.shopSettings[shopId]??={coupon:0};
 state.shopSettings[shopId].serviceText=text;
 return changed;
}
