import {productGroups,templateConfigs} from './core.js';
import {configCapacityMessage} from './config-capacity.js';
import {suggestedName} from './legacy-names.js';

export const LEGACY_TEMPLATE_CATEGORY='主机模板';

export function templateConfigLabel(config){
 return suggestedName({...config,name:''},'compact').replace(/^配置：/,'');
}

export function isLegacyTemplateConfig(config){
 return config?.productCategory===LEGACY_TEMPLATE_CATEGORY;
}

export function ordinaryConfigs(configs){
 return configs.filter(config=>!isLegacyTemplateConfig(config));
}

export function legacyTemplateConfigs(configs){
 return configs.filter(isLegacyTemplateConfig);
}

export function validateTemplateDraft(name,configs,shopId){
 if(!name?.trim())throw Error('请输入模板名称');
 if(!Array.isArray(configs)||!configs.length)throw Error('模板至少需要一套配置');
 const ids=new Set();
 for(const config of configs){
  if(!config||typeof config!=='object'||Array.isArray(config)||!config.id||typeof config.id!=='string')throw Error('模板配置缺少有效 ID');
  if(ids.has(config.id))throw Error('模板内存在重复配置 ID');
  ids.add(config.id);
  if(config.shopId!==shopId)throw Error('模板不能混入其他店铺配置');
  if(!config.name?.trim()||!Array.isArray(config.parts)||!Array.isArray(config.actualParts)||!Array.isArray(config.modules)||!Array.isArray(config.addons))throw Error('模板配置缺少名称、配件、实际配置或图片模块');
  if(typeof config.price!=='number'||!Number.isFinite(config.price)||config.price<0)throw Error('售价必须是大于等于 0 的有效金额');
  for(const part of [...config.parts,...config.actualParts])if(!part||!Number.isInteger(Number(part.qty))||Number(part.qty)<1)throw Error('配件数量必须是正整数');
 }
 return {name:name.trim(),configs};
}

// A saved template becomes a normal editable template group exactly once.
// Stable IDs also make concurrent clients agree on the migrated records.
export function migrateSavedTemplates(state,shopId){
 const added=[];
 for(const template of state.templates||[]){
  if(template.shopId!==shopId||template.deletedAt||template.editorProductId)continue;
  const productId=`saved-template:${shopId}:${template.id}`;
  const copies=templateConfigs(template).map((source,index)=>{
   const copy=structuredClone(source);
   Object.assign(copy,{id:`${productId}:${source.id||index}`,productId,product:template.name,productCategory:LEGACY_TEMPLATE_CATEGORY,shopId,productUrl:'',spu:'',skuId:'',updatedAt:null});
   delete copy.deletedAt;delete copy.deletionSessionId;delete copy.emptyLinkDraft;delete copy.workspaceOrder;
   return copy;
  }).filter(copy=>!state.configs.some(config=>config.id===copy.id));
  if(configCapacityMessage(state.configs,shopId,copies.length))continue;
  state.configs.push(...copies);added.push(...copies);template.editorProductId=productId;
 }
 return added;
}

export function editableTemplateLibrary(state,shopId){
 const rows=state.configs.filter(config=>config.shopId===shopId&&isLegacyTemplateConfig(config));
 const groups=productGroups(rows).map(group=>{
  const live=group.configs.filter(config=>!config.deletedAt);
  return {...group,editable:true,configs:live.length?live:group.configs,deletedAt:live.length?undefined:group.configs[0].deletedAt};
 });
 return [...groups,...(state.templates||[]).filter(template=>template.shopId===shopId&&!template.editorProductId)];
}
