import {actualParts} from './actual-parts.js';
import {inventoryLinks} from './inventory-export.js';
import {isSpecialComponent} from './special-components.js';
import {replaceSourcePart} from './source.js';
import {applyReplacement} from './global-batch.js';

export function inventoryThreshold(value){
 const text=String(value).trim();if(!/^\d+$/.test(text)||Number(text)>100000000)throw Error('低库存阈值须为 0 至 100000000 的整数');return Number(text);
}
export function componentStock(goodsId,costs,threshold=5){
 const hits=costs instanceof Map?(costs.get(goodsId)||[]):costs.filter(r=>r.goodsId===goodsId),row=hits.length===1?hits[0]:null;
 const validId=typeof goodsId==='string'&&/^[1-9]\d*$/.test(goodsId);
 const known=validId&&row&&!row.erpMissing&&typeof row.stockAvailable==='number'&&Number.isFinite(row.stockAvailable);
 const value=known?row.stockAvailable:null;
 return {goodsId,value,status:value===null?'unknown':value<=0?'out':value<=threshold?'low':'ok',updatedAt:row?.stockUpdatedAt||null,
  reason:!validId?'未绑定有效 goodsId':hits.length>1?'库存源 ID 重复':!row?'本机库存源未找到':row.erpMissing?'最近一次 ERP 未匹配':value===null?'库存尚未确认':''};
}
export function checkInventory(configs,costs,shopId,threshold=5){
 threshold=inventoryThreshold(threshold);const groups=inventoryLinks(configs,shopId),map=new Map(),stocks=new Map();let skippedSpecial=0;
 for(const row of costs){if(!stocks.has(row.goodsId))stocks.set(row.goodsId,[]);stocks.get(row.goodsId).push(row);}
 for(const group of groups)for(const config of group.configs)for(const [index,part] of actualParts(config).entries()){
  if(isSpecialComponent(part)){skippedSpecial++;continue;}if(!part.name&&!part.goodsId)continue;
  const stock=componentStock(part.goodsId,stocks,threshold);if(stock.status==='ok')continue;
  const key=typeof part.goodsId==='string'&&/^[1-9]\d*$/.test(part.goodsId)?part.goodsId:JSON.stringify([config.id,index]);
  if(!map.has(key))map.set(key,{...stock,key,name:part.name||part.goodsId,sources:[]});
  map.get(key).sources.push({configId:config.id,config:config.name,productId:group.id,product:group.name,spu:group.spu,slot:part.slot,index,qty:part.qty,name:part.name});
 }
 const issues=[...map.values()].sort((a,b)=>({out:0,low:1,unknown:2}[a.status]-{out:0,low:1,unknown:2}[b.status]));
 return {shopId,threshold,issues,skippedSpecial,linkCount:groups.length,configCount:groups.reduce((n,g)=>n+g.configs.length,0),checkedAt:new Date().toISOString()};
}
export function stockReplacementPlan(configs,costs,catalog,report,key,productIds,sourceId){
 const original=report.issues.find(r=>r.key===key);if(!original||original.status==='unknown')throw Error('请先选择一个低库存或无库存配件');
 if(!productIds.length)throw Error('请勾选要修改的链接');
 const current=checkInventory(configs,costs,report.shopId,report.threshold).issues.find(r=>r.key===key);
 if(JSON.stringify(current)!==JSON.stringify(original))throw Error('库存或配件使用情况已变化，请重新检查');
 const replacement=catalog.find(r=>r.sourceId===sourceId&&r.shopId===report.shopId&&!r.deletedAt);if(!replacement)throw Error('请选择本店有效的新配件');
 const selected=new Set(productIds),changes=[];
 for(const config of configs.filter(c=>!c.deletedAt&&!c.emptyLinkDraft&&c.shopId===report.shopId)){
  const targets=original.sources.filter(s=>s.configId===config.id&&selected.has(s.productId));if(!targets.length)continue;
  const after=structuredClone(config);for(const target of targets)replaceSourcePart(Array.isArray(after.actualParts)?{...after,parts:after.actualParts,addons:[]}:after,target.index,replacement);
  if(JSON.stringify(config)!==JSON.stringify(after))changes.push({id:config.id,productId:targets[0].productId,product:config.product,name:config.name,before:structuredClone(config),after});
 }
 if(!changes.length)throw Error('所选链接没有需要替换的配件');
 return {changes,productIds:[...new Set(changes.map(c=>c.productId))],shopId:report.shopId,issue:structuredClone(original),threshold:report.threshold,replacement:structuredClone(replacement)};
}
export function validateStockReplacement(plan,configs,costs,catalog){
 const current=componentStock(plan.issue.goodsId,costs,plan.threshold);
 for(const key of ['value','status','updatedAt','reason'])if(current[key]!==plan.issue[key])throw Error('库存已变化，请重新检查');
 const row=catalog.find(r=>r.sourceId===plan.replacement.sourceId);if(JSON.stringify(row)!==JSON.stringify(plan.replacement))throw Error('新配件或绑定加购已变化，请重新预览');
 applyReplacement(plan,structuredClone(configs));
}
