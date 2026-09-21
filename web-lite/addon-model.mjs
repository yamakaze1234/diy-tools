import {addonCheck,validateAddon} from '../prototype/addon-data.js';
import {actualParts} from '../prototype/actual-parts.js';
const copy=value=>structuredClone(value);
const uid=()=>crypto.randomUUID();
export const sourceKey=(shopId,goodsId)=>`lite-source:${shopId}:${goodsId}`;
export function defaultSource(state,shopId,goodsId){
 const row=state.catalog.find(r=>r.goodsId===goodsId);
 return {sourceId:sourceKey(shopId,goodsId),shopId,goodsId,name:row?.name||'',upgrade:'',addons:[]};
}
export function sourceFor(state,shopId,goodsId,sourceId){const hits=state.sources?.filter(s=>s.shopId===shopId&&s.goodsId===goodsId)||[];if(sourceId){const exact=hits.find(s=>s.sourceId===sourceId);if(exact)return exact;if(state.cloud)return {...defaultSource(state,shopId,goodsId),sourceId,unbound:true};}if(hits.length===1)return hits[0];return {...defaultSource(state,shopId,goodsId),unbound:hits.length>1};}
export function initializeSources(state){
 if(state.sources!==undefined){if(!Array.isArray(state.sources))throw Error('输出源缓存格式不兼容');return false;}
 state.sources=[];
 const sample=(text,price,goodsId,qty=1,originalQty=1,mode='replace')=>({id:uid(),text,priceCents:price*100,enabled:true,mode,originalQty,items:[{goodsId,qty}],note:''});
 for(const shop of state.shops){for(const row of state.catalog){const source=defaultSource(state,shop.id,row.goodsId);
  if(row.goodsId==='990004'&&state.catalog.some(p=>p.goodsId==='990017'))source.addons=[sample('升级 64GB DDR5 双通道内存',499,'990017',2,2)];
  if(row.goodsId==='990005'&&state.catalog.some(p=>p.goodsId==='990016'))source.addons=[sample('升级 2TB 高速固态硬盘',399,'990016')];
  if(row.goodsId==='990008'&&state.catalog.some(p=>p.goodsId==='990018'))source.addons=[sample('加装 3 把 PWM 机箱风扇',129,'990018',3,1,'add')];
  state.sources.push(source);
 }}return true;
}
export function partAddons(state,shopId,part){
 const source=sourceFor(state,shopId,part.goodsId,part.sourceId);
 const custom=part.addonOverride?.goodsId===part.goodsId;
 return {...copy(custom?part.addonOverride:source),custom,sourceId:source.sourceId,goodsId:part.goodsId,addons:copy((custom?part.addonOverride:source).addons||[])};
}
export function asWorkbenchAddon(option,source){return {text:option.text,note:option.note||'',priceCents:option.priceCents,items:option.items,originalQty:option.originalQty,...(option.mode==='replace'?{sourceId:source.sourceId}:{})};}
export function checkOption(state,source,option){
 const original=state.catalog.find(p=>p.goodsId===source.goodsId);
 return addonCheck(asWorkbenchAddon(option,source),state.catalog,original?[{...original,sourceId:source.sourceId}]:[]);
}
export function validateOptions(options,catalog,{allowDisplayOnly=false}={}){
 if(!Array.isArray(options)||options.length>30)throw Error('每个配件最多维护 30 个加购方案');
 const ids=new Set();for(const o of options){
  if(!o.id||ids.has(o.id))throw Error('加购方案标识重复');ids.add(o.id);
  if(!['replace','add'].includes(o.mode)||typeof o.enabled!=='boolean')throw Error('加购类型或展示状态无效');
  if(!o.items?.length&&!allowDisplayOnly)throw Error('请为每个加购方案选择至少一个准确商品');
  validateAddon(asWorkbenchAddon(o,{sourceId:'validation'}),{required:true,costs:catalog});
 }return options;
}
export function validateSource(state,source){
 if(!state.shops.some(s=>s.id===source.shopId))throw Error('店铺不存在');
 if(state.catalog.filter(p=>p.goodsId===source.goodsId).length!==1)throw Error('输出源须绑定唯一准确的商品 ID');
 if(!source.name?.trim())throw Error('请填写本店显示名称');
 validateOptions(source.addons,state.catalog,{allowDisplayOnly:!!state.cloud});return source;
}
export function applySource(state,source){
 validateSource(state,source);const i=state.sources.findIndex(s=>s.sourceId===source.sourceId);
 if(i<0)state.sources.push(copy(source));else state.sources[i]=copy(source);
}
export function sourceReferences(state,source){
 const products=new Set(state.products.filter(p=>p.shopId===source.shopId).map(p=>p.id));
 let inherited=0,custom=0;for(const base of state.configs.filter(c=>products.has(c.productId))){const c=state.drafts[base.id]||base,parts=actualParts(c).filter(p=>p.goodsId===source.goodsId&&(!state.cloud||p.sourceId===source.sourceId));if(parts.some(p=>p.addonOverride?.goodsId!==p.goodsId))inherited++;if(parts.some(p=>p.addonOverride?.goodsId===p.goodsId))custom++;}
 return {inherited,custom};
}
export function newOption(){return {id:uid(),text:'',priceCents:null,mode:'replace',originalQty:1,enabled:true,items:[{goodsId:'',qty:1}],note:''};}
export function snapshotOptions(state,config,shopId){
 const c=copy(config);c.actualParts=actualParts(c).map(p=>{const data=partAddons(state,shopId,p);return {...p,addonOverride:{goodsId:p.goodsId,upgrade:data.upgrade,addons:data.addons}};});return c;
}
