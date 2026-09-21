// CoreHub/pypkgs PR 13, contract pinned to b550c733a159472724cb79f99e4d6790edcac090.
import {actualParts} from './actual-parts.js';
import {blankConfig,clone,slots,productGroups} from './core.js';
import {isSpecialComponent} from './special-components.js';
import {pricing} from './pricing.js';
import {defaultServiceText} from './service-promises.js';
import {sourcesFor,DEFAULT_ERP_SHOP_IDS} from './shops.js';
import {sourcePart} from './source.js';
import {excludedComponent} from './component-policy.js';

export const productFields=['店铺ID','店铺','数据来源','状态','网店类别','SPU编码','SPU名称','备注'];
export const skuFields=['SKU名称','SKU价格','SKU库存','SKU更新时间','goods_id','商品名称','图片网址','商品网址','关联更新时间'];
export function standardId(value,label,nullable=false){
 if(nullable&&(value===null||value===undefined||value===''))return null;
 if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error(`${label} 必须使用字符串，避免长编码失真`);
 const id=String(value??'').trim();
 if(!/^\d{1,30}$/.test(id)||/^0+$/.test(id))throw Error(`${label} 必须是有效的数字编码`);
 return id;
}
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,label)=>{if(v==null)return null;if(typeof v!=='string'||v.length>5000)throw Error(`${label} 格式无效`);return v;};
const number=(v,label)=>{if(v==null)return null;if(typeof v!=='number'||!Number.isFinite(v))throw Error(`${label} 必须是数字或 null`);return v;};
export function parseStandardProduct(input){
 const raw=typeof input==='string'?JSON.parse(input.replace(/^\uFEFF/,'')):input;
 if(!object(raw)||!object(raw.SKU))throw Error('请选择以店铺、SPU 和 SKU 对象组成的标准 JSON');
 const entries=Object.entries(raw.SKU);
 if(entries.length>500)throw Error('单个商品最多支持 500 个 SKU');
 if(!entries.length)return {SKU:{}};
 const result={};
 for(const key of productFields)result[key]=['店铺ID','SPU编码'].includes(key)?standardId(raw[key],key):text(raw[key],key);
 result.SKU={};
 for(const [key,row] of entries){
  const id=standardId(key,'SKU 编码');
  if(Object.hasOwn(result.SKU,id)||!object(row))throw Error('SKU 编码重复或内容无效');
  const sku={};
  for(const field of skuFields)sku[field]=field==='goods_id'?standardId(row[field],field,true):['SKU价格','SKU库存'].includes(field)?number(row[field],field):text(row[field],field);
  if(sku.SKU价格!==null&&sku.SKU价格<0)throw Error('SKU 价格不能小于 0');
  if(Object.hasOwn(row,'SKU明细')){
   if(!Array.isArray(row.SKU明细)||row.SKU明细.length>200)throw Error('SKU 明细格式无效或超过 200 行');
   sku.SKU明细=row.SKU明细.map(p=>{
    if(!object(p))throw Error('SKU 明细行无效');
    const n=number(p.n,'配件数量');
    if(!Number.isSafeInteger(n)||n<1)throw Error('配件数量必须是正整数，当前工作台不支持小数数量');
    return {goods_id:standardId(p.goods_id,'配件 goods_id'),n,商品名称:text(p.商品名称,'配件名称'),简称:text(p.简称,'简称')};
   });
  }
  result.SKU[id]=sku;
 }
 return result;
}

// No fuzzy name matching: shop + SPU + SKU and goods_id are the only identities.
export function planStandardProduct(input,state,product,options={}){
 const data=parseStandardProduct(input),errors=[],warnings=[],rows=[],needs=new Map(),bindings=[];
 if(!Object.keys(data.SKU).length)throw Error('未返回上架 SKU，原配置保持不变');
 const shopId=standardId(options.erpShopId||DEFAULT_ERP_SHOP_IDS[product.shopId],'ERP 店铺 ID');
 if(data.店铺ID!==shopId)throw Error('JSON 店铺 ID 与本次选择的 ERP 店铺不一致');
 const settings=state.shopSettings?.[product.shopId]||{coupon:0};
 if(settings.erpShopId&&settings.erpShopId!==shopId)throw Error('ERP 店铺 ID 与本店已保存的对应关系不一致，请先在店铺设置修改');
 const configs=state.configs.filter(c=>!c.deletedAt&&c.shopId===product.shopId&&c.productId===product.id);
 if(configs.some(c=>c.spu&&c.spu!==data.SPU编码))throw Error('SPU 与当前链接不一致，请选择对应链接或新建空白链接');
 const catalog=sourcesFor(state,product.shopId),costs=state.costSource||[];
 for(const [skuId,sku] of Object.entries(data.SKU)){
  const matches=state.configs.filter(c=>!c.deletedAt&&c.shopId===product.shopId&&c.skuId===skuId);
  if(matches.length>1||matches.some(c=>c.productId!==product.id)){errors.push(`SKU ${skuId} 在本店重复或属于其他链接`);continue;}
  let existing=matches[0];
  const unbound=configs.filter(c=>!c.skuId),choice=options.configs?.[skuId];
  if(!existing&&choice&&choice!=='new'){
   existing=unbound.find(c=>c.id===choice);
   if(!existing)errors.push(`SKU ${skuId} 所选配置已绑定其他 SKU 或不属于本链接`);
  }
  if(!existing&&!choice&&unbound.length)bindings.push({skuId,name:sku.SKU名称||skuId,choices:unbound.map(c=>({id:c.id,name:c.name}))});
  if(existing&&rows.some(r=>r.existingId===existing.id))errors.push(`同一套配置不能同时绑定多个 SKU：${existing.name}`);
  const parts=[],used=new Set();
  const grouped=new Map();for(const detail of sku.SKU明细||[]){const prev=grouped.get(detail.goods_id);grouped.set(detail.goods_id,{...detail,n:detail.n+(prev?.n||0)});}
  for(const detail of grouped.values()){
   const choices=catalog.filter(p=>p.goodsId===detail.goods_id&&!p.deletedAt&&!isSpecialComponent(p));
   const old=existing?actualParts(existing).filter(p=>p.goodsId===detail.goods_id):[];
   const preferred=choices.find(p=>old.length===1&&p.sourceId===old[0].sourceId)||choices[0];
   const knownSlots=new Set(state.configs.filter(c=>!c.deletedAt&&c.shopId===product.shopId).flatMap(c=>actualParts(c)).filter(p=>p.goodsId===detail.goods_id&&slots.includes(p.slot)).map(p=>p.slot));
   const inferred=old.length===1?old[0].slot:knownSlots.size===1?[...knownSlots][0]:new Set(choices.map(p=>p.slot)).size===1?choices[0]?.slot:null;
   const slot=options.slots?.[detail.goods_id]||inferred;
   if(!slots.includes(slot))needs.set(detail.goods_id,{...detail,name:preferred?.name||detail.简称||detail.商品名称});
   if(slot&&used.has(slot))errors.push(`SKU ${skuId} 的 ${slot} 存在不同配件，请调整槽位`);
   if(slot)used.add(slot);
   if(!Number.isSafeInteger(detail.n))errors.push(`SKU ${skuId} 配件数量过大`);
   const cost=costs.find(p=>p.goodsId===detail.goods_id);
   if(excludedComponent(cost)||excludedComponent({name:detail.商品名称,originalName:detail.简称}))errors.push(`SKU ${skuId} 含已禁用的带星号配件 ${detail.goods_id}`);
   parts.push({...preferred?sourcePart(preferred):{name:detail.简称||detail.商品名称||detail.goods_id,goodsId:detail.goods_id,erp:cost?.erp??null,tax:cost?.tax??null,warranty:'',upgrade:''},slot,qty:detail.n});
  }
  if(!parts.length)warnings.push(`${skuId}：未返回配件明细，${existing?'保留原实际配置':'新增后需补充配件'}`);
  if(!existing&&(!options.prices||sku.SKU价格===null))warnings.push(`${skuId}：新增配置的到手价暂为 0，请勾选更新价格或导入后补填`);
  let price=existing?.price??0;
  if(options.prices&&sku.SKU价格!==null){price=Math.round((sku.SKU价格-Number(settings.coupon||0))*100)/100;if(price<0)errors.push(`SKU ${skuId} 的定价低于店铺券，请先核对优惠券`);}
  if(!existing&&product.installment===null)errors.push('新增 SKU 前请先统一本链接的分期设置');
  rows.push({skuId,sku,existingId:existing?.id||null,parts,price,name:sku.SKU名称||existing?.name||skuId});
 }
 const added=rows.filter(r=>!r.existingId).length;
 if(state.configs.length+added>500)errors.push('导入后配置总数超过 500');
 const unchanged=configs.filter(c=>!rows.some(r=>r.existingId===c.id)).length;
 if(unchanged)warnings.push(`本链接另有 ${unchanged} 套配置未出现在结果中，将保留`);
 return {data,rows,errors,warnings,needs:[...needs.values()],bindings,added,updated:rows.length-added,options:clone(options),productId:product.id,shopId:product.shopId,baseline:JSON.stringify({configs,stateSettings:settings,catalog,costs})};
}
export function applyStandardProduct(plan,state,product){
 const fresh=planStandardProduct(plan.data,state,product,plan.options);
 if(fresh.baseline!==plan.baseline||product.id!==plan.productId||product.shopId!==plan.shopId)throw Error('配置或输出源已经变化，请重新预览');
 if(fresh.errors.length||fresh.needs.length||fresh.bindings.length)throw Error('请先处理预览中的错误、SKU 对应配置和配件槽位');
 const next=clone(state),ids=[];
 const root=Object.fromEntries(productFields.map(k=>[k,plan.data[k]]));
 for(const row of fresh.rows){
  let c=next.configs.find(c=>c.id===row.existingId);
  const created=!c;
  if(created){c=blankConfig(null,product,row.name,defaultServiceText(state,product.shopId));c.workspaceOrder=Math.max(-1,...next.configs.map(c=>c.workspaceOrder??0))+1;next.configs.push(c);}
  Object.assign(c,{skuId:row.skuId,spu:root.SPU编码,name:row.name,price:row.price,productStandard:{...root,SKU编码:row.skuId,sku:clone(row.sku)}});
  if(row.parts.length)c.actualParts=clone(row.parts);
  if(created&&row.parts.length)c.parts=clone(row.parts);
  delete c.emptyLinkDraft;
  ids.push(c.id);
 }
 // The shared SPU title belongs to the entire link. User categories and artwork stay local.
 for(const c of next.configs.filter(c=>!c.deletedAt&&c.shopId===product.shopId&&c.productId===product.id)){
  c.spu=root.SPU编码;if(root.SPU名称)c.product=root.SPU名称;if(!ids.includes(c.id))ids.push(c.id);
 }
 next.shopSettings[product.shopId]={...next.shopSettings[product.shopId],erpShopId:root.店铺ID,erpShopName:root.店铺||''};
 return {next,ids};
}
export function exportStandardProduct(state,product,{erpShopId,erpShopName,allowIncomplete=false}={}){
 const configs=state.configs.filter(c=>!c.deletedAt&&c.shopId===product.shopId&&(c.productId||'legacy:'+String(c.spu||c.product||c.id))===product.id&&c.skuId);
 if(!configs.length&&!allowIncomplete)throw Error('当前链接尚未填写 SKU 编码');
 const safeId=(value,label)=>{try{return standardId(value,label);}catch(e){if(allowIncomplete)return null;throw e;}};
 const settings=state.shopSettings[product.shopId]||{},shop=safeId(erpShopId||settings.erpShopId||DEFAULT_ERP_SHOP_IDS[product.shopId],'ERP 店铺 ID'),spu=safeId(product.spu,'SPU');
 const validMeta=c=>c.productStandard?.SKU编码===c.skuId&&c.productStandard?.SPU编码===spu&&c.productStandard?.店铺ID===shop?c.productStandard:null;
 const first=configs[0]?validMeta(configs[0]):null,result=Object.fromEntries(productFields.map(k=>[k,first?.[k]??null]));
 Object.assign(result,{店铺ID:shop,店铺:erpShopName||settings.erpShopName||first?.店铺||null,SPU编码:spu,SPU名称:product.name,SKU:{}});
 const duplicates=new Set(configs.filter((c,i)=>configs.findIndex(x=>x.skuId===c.skuId)!==i).map(c=>c.skuId));
 for(const c of configs){
  if(c.spu!==spu&&!allowIncomplete)throw Error('本链接 SPU 不一致，请先统一');
  const id=safeId(c.skuId,'SKU');if(!id)continue;if(duplicates.has(id)){if(allowIncomplete)continue;throw Error('本链接 SKU 重复');}
  const meta=validMeta(c)?.sku,sku=Object.fromEntries(skuFields.map(k=>[k,meta?.[k]??null]));
  sku.SKU名称=c.name;try{sku.SKU价格=pricing(c,settings).listPrice;}catch(e){if(!allowIncomplete)throw e;sku.SKU价格=null;}
  sku.SKU明细=actualParts(c).filter(p=>!isSpecialComponent(p)&&(p.goodsId||p.name)).map(p=>{
   const goods_id=safeId(p.goodsId,`${p.slot} goods_id`);if((!Number.isSafeInteger(p.qty)||p.qty<1)&&!allowIncomplete)throw Error(`${p.slot} 数量无效`);
   const original=meta?.SKU明细?.find(x=>x.goods_id===goods_id),cost=state.costSource?.find(x=>x.goodsId===goods_id);
   return {goods_id,n:Number.isSafeInteger(p.qty)&&p.qty>0?p.qty:null,商品名称:cost?.name||original?.商品名称||p.erpName||p.name,简称:p.name};
  });
  result.SKU[id]=sku;
 }
 return allowIncomplete?result:parseStandardProduct(result);
}

// Persist one canonical business document per link, including incomplete drafts.
// Incomplete identities stay null; readiness is outside the public PR schema.
export function standardProducts(state){
 const result=[];
 for(const shopId of ['intel','gigabyte','jonsbo'])for(const product of productGroups(state.configs.filter(c=>!c.deletedAt&&c.shopId===shopId))){
  const data=exportStandardProduct(state,product,{allowIncomplete:true,erpShopId:state.shopSettings?.[shopId]?.erpShopId||DEFAULT_ERP_SHOP_IDS[shopId]}),issues=[];
  if(!data.店铺ID)issues.push('未绑定 ERP 店铺 ID');
  if(!data.SPU编码)issues.push('未填写有效 SPU');
  const configs=product.configs,ids=new Set();
  for(const c of configs){
   if(!c.skuId)issues.push(`${c.name}：未绑定 SKU`);
   else {try{standardId(c.skuId,'SKU');}catch{issues.push(`${c.name}：SKU 编码无效`);}if(ids.has(c.skuId))issues.push(`SKU ${c.skuId} 重复`);ids.add(c.skuId);}
   if(c.spu!==product.spu)issues.push('本链接 SPU 不一致');
   const parts=actualParts(c).filter(p=>!isSpecialComponent(p)&&(p.name||p.goodsId));
   if(!parts.length)issues.push(`${c.name}：实际配件为空`);
   for(const p of parts){try{standardId(p.goodsId,'配件 ID');if(!Number.isSafeInteger(p.qty)||p.qty<1)throw Error();}catch{issues.push(`${c.name} / ${p.slot}：配件 ID 或数量不完整`);}}
  }
  result.push({shopId,productId:product.id,name:product.name,data,ready:issues.length===0,issues:[...new Set(issues)]});
 }
 return result;
}
