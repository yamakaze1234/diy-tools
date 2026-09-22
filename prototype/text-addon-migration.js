import {sourceAddon,sourceAddonFields,choiceDescription,selectedSourceAddons} from './addon-data.js';

const linked=a=>!!a.goodsId||['items','choices','variants'].some(k=>(a[k]||[]).some(linked));
const compact=text=>String(text||'').replace(/\s+/g,'');
// Explicit one-time maintenance: preserve all unrelated fields and existing offers.
export function migrateTextAddons(state){
 const next=structuredClone(state),changes=[];
 for(const row of next.sourceCatalog){
  const text=row.upgrade||'',addon=sourceAddon(row);
  if(row.deletedAt||!text.includes('【')||!text.includes('】')||linked(addon))continue;
  const choices=structuredClone(addon.choices||[]);
  const texts=[...(addon.choices===undefined?[addon.text,...(addon.variants||[]).map(a=>a.text)]:[]),text].filter(t=>t?.trim());
  for(const value of texts)if(!choices.some(c=>compact(c.label)===compact(value)))choices.push({id:'text-'+row.sourceId+'-'+choices.length,goodsId:'',qty:1,originalQty:1,priceCents:null,label:value,enabled:true});
  Object.assign(row,sourceAddonFields({...addon,choices,text:choiceDescription(choices)}));row.upgrade='';
  changes.push({sourceId:row.sourceId,shopId:row.shopId,goodsId:row.goodsId,before:text,after:row.addonText});
  for(const config of next.configs.filter(c=>!c.deletedAt&&c.shopId===row.shopId)){
   let moved=false;
   for(const key of ['parts','actualParts'])for(const part of config[key]||[])if(part.sourceId===row.sourceId&&part.upgrade===text){part.upgrade='';moved=true;}
   if(moved){config.addons??=[];const existing=config.addons.filter(a=>a.sourceId===row.sourceId);
    if(!existing.length)config.addons.push(...selectedSourceAddons(row));
    else if(!existing.some(a=>compact(a.text).includes(compact(text))))config.addons.push({sourceId:row.sourceId,text,choices:[{id:'text-'+row.sourceId,goodsId:'',qty:1,originalQty:1,priceCents:null,label:text,enabled:true}]});
   }
  }
 }
 return {next,changes};
}
