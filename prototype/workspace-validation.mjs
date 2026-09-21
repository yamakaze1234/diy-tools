import {validateAddon,sourceAddon} from './addon-data.js';
const types=['configuration','component','source','template','settings','gallery','erp_chunk','erp_snapshot','workspace_meta'];
export function validateWorkspaceRecord(type,id,data){
 if(!types.includes(type)||typeof id!=='string'||!id||id.length>200||!data||typeof data!=='object'||Array.isArray(data)||Buffer.byteLength(JSON.stringify(data))>250000)throw Error('记录格式无效');
 if(Object.keys(data).some(k=>['__proto__','constructor','prototype'].includes(k)))throw Error('字段名无效');
 if(type==='component'&&(id!==`${data.erpScopeId}|${data.goodsId}`||typeof data.goodsId!=='string'||!/^\d{1,20}$/.test(data.goodsId)||data.taxCents!==null&&(!Number.isSafeInteger(data.taxCents)||data.taxCents<0)))throw Error('共享成本来源或金额无效');
 if(type==='configuration'){
  if(data.id!==id||!['intel','gigabyte','jonsbo'].includes(data.shopId)||!Number.isSafeInteger(data.priceCents)||data.priceCents<0||!Array.isArray(data.parts))throw Error('配置格式无效');
  if(data.actualParts!==undefined&&!Array.isArray(data.actualParts))throw Error('实际配置格式无效');
  for(const rows of [data.parts,...(data.actualParts?[data.actualParts]:[])]){const lines=new Set();for(const p of rows){if(!p.lineId||lines.has(p.lineId)||typeof p.goodsId!=='string'||!Number.isSafeInteger(p.qty)||p.qty<0||p.goodsId&&p.qty<1)throw Error('配件行 ID 或数量无效');lines.add(p.lineId);}}
  for(const a of data.addons||[])validateAddon(a);
  for(const k of ['spu','skuId'])if(data[k]!==undefined&&typeof data[k]!=='string')throw Error('平台 ID 必须是字符串');
 }
 if(type==='source')validateAddon(sourceAddon(data));
 if(type==='settings'&&data.serviceText!==undefined&&(typeof data.serviceText!=='string'||data.serviceText.length>1000))throw Error('默认服务承诺无效');
 if(type==='settings'&&data.erpShopId!==undefined&&(typeof data.erpShopId!=='string'||data.erpShopId&&!/^\d{1,30}$/.test(data.erpShopId)))throw Error('ERP 店铺 ID 无效');
 if(type==='settings'&&data.erpShopName!==undefined&&(typeof data.erpShopName!=='string'||data.erpShopName.length>200))throw Error('ERP 店铺名称无效');
 if(type==='settings'&&(!Number.isSafeInteger(data.couponCents)||data.couponCents<0))throw Error('优惠券金额无效');
 return data;
}
