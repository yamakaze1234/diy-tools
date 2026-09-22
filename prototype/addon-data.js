const copy=v=>structuredClone(v);
export function sourceAddon(row){const a={text:row.addonText||'',note:row.addonNote||'',sourceId:row.sourceId};for(const [to,from] of [['goodsId','addonGoodsId'],['priceCents','addonPriceCents'],['qty','addonQty'],['items','addonItems'],['originalQty','addonOriginalQty'],['variants','addonVariants'],['showTogether','addonShowTogether'],['choices','addonChoices'],['mode','addonMode']])if(row[from]!==undefined)a[to]=copy(row[from]);return a;}
export function sourceAddonFields(a){return {...(a.mode!==undefined?{addonMode:a.mode}:{}),addonText:a.text,addonNote:a.note||'',addonGoodsId:a.goodsId||'',addonPriceCents:a.priceCents??null,addonQty:a.qty??1,...(a.variants!==undefined?{addonVariants:copy(a.variants)}:{}),...(a.items!==undefined?{addonItems:copy(a.items)}:{}),...(a.originalQty!==undefined?{addonOriginalQty:a.originalQty}:{}),...(a.showTogether!==undefined?{addonShowTogether:a.showTogether}:{}),...(a.choices!==undefined?{addonChoices:copy(a.choices)}:{})};}
export const addonItems=a=>a.items!==undefined?a.items:a.goodsId?[{goodsId:a.goodsId,qty:a.qty??1}]:[];
export function validateAddon(a,{required=false,costs}={}){
 if(!a||typeof a!=='object'||typeof a.text!=='string')throw Error('加购描述格式无效');
 if(a.mode!==undefined&&!['replace','add'].includes(a.mode))throw Error('加购方式无效');
 if(a.choices!==undefined){
  if(!Array.isArray(a.choices)||a.choices.length>30)throw Error('最多选择 30 个加购商品');
  const ids=new Set();for(const c of a.choices){
   if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||typeof c.label!=='string'||typeof c.enabled!=='boolean')throw Error('加购商品信息无效或重复');ids.add(c.id);if(required&&!c.label.trim())throw Error('请填写每项加购商品的升级文案');
   if(typeof c.goodsId!=='string'||c.goodsId!==''&&!/^\d{1,20}$/.test(c.goodsId))throw Error('请选择每项加购的准确商品');
   validateAddon(choiceAddon(c,a.sourceId),{required,costs});
  }
  return a;
 }
 if(a.showTogether!==undefined&&typeof a.showTogether!=='boolean')throw Error('加购展示选项无效');
 if(a.variantId!==undefined&&(typeof a.variantId!=='string'||!a.variantId.trim()))throw Error('加购描述标识无效');
 if(a.variants!==undefined){if(!Array.isArray(a.variants)||a.variants.length>30)throw Error('同一配件最多维护 30 条其他加购描述');const ids=new Set();for(const v of a.variants){if(!v||!v.variantId||ids.has(v.variantId)||v.variants!==undefined)throw Error('加购描述标识重复或无效');ids.add(v.variantId);validateAddon(v,{required:true,costs});}}
 if(a.goodsId!==undefined&&(typeof a.goodsId!=='string'||a.goodsId&&!/^\d{1,20}$/.test(a.goodsId)))throw Error('加购商品 ID 必须是准确的数字字符串');
 if(a.priceCents!=null&&(!Number.isSafeInteger(a.priceCents)||a.priceCents<0))throw Error('加购价须为非负金额，最多两位小数');
 if(a.qty!==undefined&&(!Number.isSafeInteger(a.qty)||a.qty<1||a.qty>100000))throw Error('加购数量必须是 1 至 100000 的整数');
 if(a.items!==undefined&&(!Array.isArray(a.items)||a.items.length>100))throw Error('组合配件最多 100 项');
 if(a.originalQty!==undefined&&(!Number.isSafeInteger(a.originalQty)||a.originalQty<1||a.originalQty>100000))throw Error('原配件数量无效');
 for(const item of addonItems(a)){if(!item||typeof item.goodsId!=='string'||!/^\d{1,20}$/.test(item.goodsId))throw Error('请选择组合配件的准确商品 ID');if(!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>100000)throw Error('组合配件数量必须为 1 至 100000 的整数');if(required&&costs&&costs.filter(r=>r.goodsId===item.goodsId).length!==1)throw Error('关联商品不存在或 ID 不唯一，请重新选择');}
 if(required){if(!a.text.trim())throw Error('请填写加购描述');if(addonItems(a).length&&a.priceCents==null)throw Error('请设置加购价');}
 return a;
}
export const choiceText=c=>!c.goodsId?c.label||'':`【+${c.priceCents==null?'待填':Number((c.priceCents/100).toFixed(2))}元${c.label||'升级商品'}】`;
export const choiceAddon=(c,sourceId)=>({text:choiceText(c),goodsId:c.goodsId,qty:c.qty,priceCents:c.priceCents,originalQty:c.originalQty??1,sourceId});
export const choiceDescription=choices=>choices.filter(c=>c.enabled).map(choiceText).join('');
export const addonChecks=a=>a.choices!==undefined?a.choices.map(c=>choiceAddon(c,a.sourceId)):[a];
export function addonCheck(a,costs,originals=[]){
 if(a.choices!==undefined){const checks=addonChecks(a).map(v=>addonCheck(v,costs,originals)),rank={ok:0,pending:1,warning:2,danger:3};const severity=checks.reduce((s,c)=>rank[c.severity]>rank[s]?c.severity:s,checks.length?'ok':'pending');return {fields:[],checks,severity,needsAdjustment:checks.some(c=>c.needsAdjustment),name:'逐项检查 '+checks.length+' 个加购商品',reason:checks.length?'':'尚未选择加购商品'};}

 const items=addonItems(a),rows=items.map(item=>{const hits=costs.filter(r=>r.goodsId===item.goodsId);return hits.length===1?hits[0]:null;});
 const sourceId=a.mode==='add'?null:a.sourceId;
 const candidates=originals.filter(p=>sourceId&&p.sourceId===sourceId),unique=[...new Map(candidates.map(p=>[JSON.stringify([p.goodsId,p.erp,p.tax]),p])).values()],original=unique.length===1?unique[0]:null;
 const validPrice=Number.isSafeInteger(a.priceCents)&&a.priceCents>=0;
 const total=(unit,qty)=>typeof unit==='number'&&Number.isFinite(unit)&&unit>=0&&Number.isSafeInteger(qty)&&qty>0?Math.round(unit*100)*qty:null;
 const fields=['erp','tax'].map(key=>{const amounts=items.map((item,i)=>total(rows[i]?.[key],item.qty)),cost=amounts.length&&amounts.every(v=>v!==null)?amounts.reduce((a,b)=>a+b,0):null,originalPrice=sourceId?total(original?.[key],a.originalQty??1):0,diff=validPrice&&cost!==null&&originalPrice!==null?originalPrice+a.priceCents-cost:null;return {key,label:key==='erp'?'ERP':'核算',originalPriceCents:originalPrice,costCents:cost,diffCents:diff,severity:diff===null?'pending':diff<=-5000?'danger':diff<0?'warning':'ok'};});
 const needsAdjustment=fields.every(f=>f.severity==='danger'),tax=fields.find(f=>f.key==='tax');
 const severity=needsAdjustment?'danger':tax.severity==='danger'?'warning':tax.severity;
 return {goodsId:a.goodsId||'',name:rows.map((r,i)=>(r?.name||items[i].goodsId)+' ×'+items[i].qty).join('；'),originalName:original?.name||'',fields,severity,needsAdjustment,reason:!items.length?'仅展示描述，未设置核算商品':rows.some(r=>!r)?'商品不存在或 ID 不唯一':sourceId&&!original?'待关联原配件或原配件不唯一':!validPrice?'待设置加购价':fields.some(f=>f.originalPriceCents===null)?'待补充原配件价格':fields.some(f=>f.costCents===null)?'待补充新配件成本':''};
}
export function addonSummary(a){if(!a)return '无';if(a.choices!==undefined)return a.choices.map(c=>addonSummary(choiceAddon(c,a.sourceId))+(c.enabled?'':'（不展示）')).join('；');return [a.text,a.note,addonItems(a).length?addonItems(a).map(i=>'商品 ID '+i.goodsId+' ×'+i.qty).join('；'):'未关联商品',a.priceCents==null?'价格待设置':'加购价 ¥'+(a.priceCents/100).toFixed(2),'数量 '+(a.qty??1)].filter(Boolean).join(' · ');}
export function sourceAddonOptions(row){const {variants=[],...base}=sourceAddon(row);if(base.choices!==undefined)return [{...base,text:choiceDescription(base.choices)}];return [base,...variants.map(v=>({...copy(v),sourceId:row.sourceId}))];}
export function selectedSourceAddons(row,previous=[]){
 const options=sourceAddonOptions(row);
 if(row.addonChoices!==undefined)return options[0].text?[options[0]]:[];
 if(options.some(a=>a.showTogether!==undefined))return options.filter(a=>a.showTogether===true&&a.text?.trim());
 return (previous.length?previous.map(a=>selectedSourceAddon(row,a)):[options[0]]).filter(a=>a.text?.trim());
}
export function selectedSourceAddon(row,previous){const options=sourceAddonOptions(row);return previous?.variantId?options.find(a=>a.variantId===previous.variantId)||copy(previous):options[0];}
export function addonKey(a){if(a.choices!==undefined)return JSON.stringify(['choices',a.sourceId,a.choices]);const product=a.items?.length?'items:'+JSON.stringify(a.items.map(i=>[i.goodsId,i.qty]).sort()):a.goodsId?'goods:'+a.goodsId:a.sourceId?'source:'+a.sourceId:'manual';return JSON.stringify([product,a.variantId||'',a.text,a.note||'']);}
export function addonGroups(configs){const groups=new Map();for(const c of configs.filter(c=>!c.deletedAt))for(const a of c.addons||[]){const key=addonKey(a);if(!groups.has(key))groups.set(key,{key,example:copy(a),configIds:new Set(),count:0});const g=groups.get(key);g.configIds.add(c.id);g.count++;}return [...groups.values()].map(g=>({...g,configIds:[...g.configIds]}));}
export function addonBatchPlan(configs,key,patch,{updatePricing=false,costs=[]}={}){
 const changes=[];for(const c of configs.filter(c=>!c.deletedAt)){const after=copy(c);for(const a of after.addons||[])if(addonKey(a)===key){if(a.choices!==undefined&&patch.choices!==undefined){a.choices=patch.choices.map(c=>{const old=a.choices.find(v=>v.id===c.id);if(!updatePricing){if(!old)throw Error('增加加购商品时请勾选同时更新商品和价格');return {...old,label:c.label,enabled:c.enabled};}return copy(c);});a.text=choiceDescription(a.choices);}else a.text=patch.text;a.note=patch.note||'';if(updatePricing)Object.assign(a,{goodsId:patch.goodsId,priceCents:patch.priceCents,qty:patch.qty,...(patch.items!==undefined?{items:copy(patch.items)}:{}),...(patch.originalQty!==undefined?{originalQty:patch.originalQty}:{})});validateAddon(a,{required:true,costs});}if(JSON.stringify(c)!==JSON.stringify(after))changes.push({id:c.id,name:c.name,product:c.product,before:copy(c),after});}return {changes};
}
export function applyAddonBatch(plan,configs){const targets=plan.changes.map(d=>{const c=configs.find(c=>c.id===d.id);if(!c||JSON.stringify(c)!==JSON.stringify(d.before))throw Error('配置已变化，请重新预览加购修改');return c;});targets.forEach((c,i)=>Object.assign(c,copy(plan.changes[i].after)));return targets.map(c=>c.id);}
