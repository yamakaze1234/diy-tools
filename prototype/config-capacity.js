// Each shop has an independent quota; recoverable deleted rows do not consume it.
export const MAX_CONFIGS_PER_SHOP=8000;
export function configCapacityMessage(configs,shopId,added=0){
 const count=configs.filter(c=>!c.deletedAt&&(c.shopId||'intel')===shopId).length;
 return count+added>MAX_CONFIGS_PER_SHOP?`本店最多保存 ${MAX_CONFIGS_PER_SHOP} 套在用配置（当前 ${count} 套，本次新增 ${added} 套）`:'';
}
export function validateConfigCapacity(configs){
 for(const shopId of new Set(configs.map(c=>c.shopId||'intel'))){const message=configCapacityMessage(configs,shopId);if(message)throw Error(message);}
 return true;
}
