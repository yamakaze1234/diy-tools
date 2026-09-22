// A shop shares its output view; artwork and business fields stay per configuration.
export function normalizePosterView(value){
 if(!value||!['long','square'].includes(value.layout))return null;
 return {layout:value.layout,skuMode:value.skuMode==='padded'?'padded':'dedicated'};
}

export function applyPosterView(configs,value){
 const view=normalizePosterView(value),ids=[];
 if(!view)return ids;
 for(const config of configs){
  if(config.deletedAt||config.layout===view.layout&&(config.skuMode||'dedicated')===view.skuMode)continue;
  Object.assign(config,view);ids.push(config.id);
 }
 return ids;
}
