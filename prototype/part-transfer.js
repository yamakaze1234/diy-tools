import {actualParts} from './actual-parts.js';
import {isSpecialComponent} from './special-components.js';
import {totals} from './core.js';
import {pricing} from './pricing.js';
import {replaceSourcePart} from './source.js';

export function copyPartPayload(config,index){
 const part=config.parts[index];if(!part)throw Error('配件不存在');
 return structuredClone({shopId:config.shopId,part,addons:(config.addons||[]).filter(a=>part.sourceId&&a.sourceId===part.sourceId)});
}
export function pastePartPayload(config,index,payload,catalog){
 if(!payload||payload.shopId!==config.shopId)throw Error('请先复制当前店铺的配件');
 const old=config.parts[index],part=payload.part;if(!old)throw Error('目标配件不存在');
 if(old.slot!==part.slot)throw Error(`请粘贴到“${part.slot}”槽位，避免放错配件`);
 const row=catalog.find(r=>r.sourceId===part.sourceId&&r.goodsId===part.goodsId&&r.shopId===config.shopId&&!r.deletedAt);
 if(!row)throw Error('复制的配件尚未绑定有效输出源或已删除，请重新选择配件');
 replaceSourcePart(config,index,row);
 Object.assign(config.parts[index],{name:part.name,upgrade:part.upgrade,warranty:part.warranty,qty:part.qty});
 delete config.parts[index].memoryUpgradeConfirmed;
 if(part.memoryUpgradeConfirmed)config.parts[index].memoryUpgradeConfirmed=part.memoryUpgradeConfirmed;
 config.addons=config.addons.filter(a=>a.sourceId!==row.sourceId);
 config.addons.push(...structuredClone(payload.addons));
}
export function overviewProfits(config,settings){
 const t=totals(config),fee=pricing(config,settings).fee;
 const parts=actualParts(config).filter(p=>p.name||p.goodsId);
 return [['tax',t.taxProfit],['erp',t.erpProfit]].map(([field,value])=>parts.length&&parts.every(p=>isSpecialComponent(p)||p[field]!=null&&Number.isFinite(Number(p[field])))?Math.round((value-fee)*100)/100:null);
}
