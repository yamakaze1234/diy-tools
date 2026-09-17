const copy=v=>structuredClone(v);
export function sourceAddon(row){const a={text:row.addonText||'',note:row.addonNote||'',sourceId:row.sourceId};for(const [to,from] of [['goodsId','addonGoodsId'],['priceCents','addonPriceCents'],['qty','addonQty'],['items','addonItems'],['originalQty','addonOriginalQty'],['variants','addonVariants']])if(row[from]!==undefined)a[to]=row[from];return a;}
export function sourceAddonFields(a){return {addonText:a.text,addonNote:a.note||'',addonGoodsId:a.goodsId||'',addonPriceCents:a.priceCents??null,addonQty:a.qty??1,...(a.variants!==undefined?{addonVariants:copy(a.variants)}:{}),...(a.items!==undefined?{addonItems:copy(a.items)}:{}),...(a.originalQty!==undefined?{addonOriginalQty:a.originalQty}:{})};}
export const addonItems=a=>a.items!==undefined?a.items:a.goodsId?[{goodsId:a.goodsId,qty:a.qty??1}]:[];
export function validateAddon(a,{required=false,costs}={}){
 if(!a||typeof a!=='object'||typeof a.text!=='string')throw Error('加购描述格式无效');
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
export function addonCheck(a,costs,originals=[]){
 const items=addonItems(a),rows=items.map(item=>{const hits=costs.filter(r=>r.goodsId===item.goodsId);return hits.length===1?hits[0]:null;});
 const candidates=originals.filter(p=>a.sourceId&&p.sourceId===a.sourceId),unique=[...new Map(candidates.map(p=>[JSON.stringify([p.goodsId,p.erp,p.tax]),p])).values()],original=unique.length===1?unique[0]:null;
 const validPrice=Number.isSafeInteger(a.priceCents)&&a.priceCents>=0;
 const total=(unit,qty)=>typeof unit==='number'&&Number.isFinite(unit)&&unit>=0&&Number.isSafeInteger(qty)&&qty>0?Math.round(unit*100)*qty:null;
 const fields=['erp','tax'].map(key=>{const amounts=items.map((item,i)=>total(rows[i]?.[key],item.qty)),cost=amounts.length&&amounts.every(v=>v!==null)?amounts.reduce((a,b)=>a+b,0):null,originalPrice=a.sourceId?total(original?.[key],a.originalQty??a.qty??1):0,diff=validPrice&&cost!==null&&originalPrice!==null?originalPrice+a.priceCents-cost:null;return {key,label:key==='erp'?'ERP':'核算',originalPriceCents:originalPrice,costCents:cost,diffCents:diff,severity:diff===null?'pending':diff<=-5000?'danger':diff<0?'warning':'ok'};});
 const needsAdjustment=fields.every(f=>f.severity==='danger'),tax=fields.find(f=>f.key==='tax');
 const severity=needsAdjustment?'danger':tax.severity==='danger'?'warning':tax.severity;
 return {goodsId:a.goodsId||'',name:rows.map((r,i)=>(r?.name||items[i].goodsId)+' ×'+items[i].qty).join('；'),originalName:original?.name||'',fields,severity,needsAdjustment,reason:!items.length?'仅展示描述，未设置核算商品':rows.some(r=>!r)?'商品不存在或 ID 不唯一':a.sourceId&&!original?'待关联原配件或原配件不唯一':!validPrice?'待设置加购价':fields.some(f=>f.originalPriceCents===null)?'待补充原配件价格':fields.some(f=>f.costCents===null)?'待补充新配件成本':''};
}
export function addonSummary(a){if(!a)return '无';return [a.text,a.note,addonItems(a).length?addonItems(a).map(i=>'商品 ID '+i.goodsId+' ×'+i.qty).join('；'):'未关联商品',a.priceCents==null?'价格待设置':'加购价 ¥'+(a.priceCents/100).toFixed(2),'数量 '+(a.qty??1)].filter(Boolean).join(' · ');}
export function sourceAddonOptions(row){const {variants=[],...base}=sourceAddon(row);return [base,...variants.map(v=>({...copy(v),sourceId:row.sourceId}))];}
export function selectedSourceAddon(row,previous){const options=sourceAddonOptions(row);return previous?.variantId?options.find(a=>a.variantId===previous.variantId)||copy(previous):options[0];}
export function addonKey(a){const product=a.items?.length?'items:'+JSON.stringify(a.items.map(i=>[i.goodsId,i.qty]).sort()):a.goodsId?'goods:'+a.goodsId:a.sourceId?'source:'+a.sourceId:'manual';return JSON.stringify([product,a.variantId||'',a.text,a.note||'']);}
export function addonGroups(configs){const groups=new Map();for(const c of configs.filter(c=>!c.deletedAt))for(const a of c.addons||[]){const key=addonKey(a);if(!groups.has(key))groups.set(key,{key,example:copy(a),configIds:new Set(),count:0});const g=groups.get(key);g.configIds.add(c.id);g.count++;}return [...groups.values()].map(g=>({...g,configIds:[...g.configIds]}));}
export function addonBatchPlan(configs,key,patch,{updatePricing=false,costs=[]}={}){
 const changes=[];for(const c of configs.filter(c=>!c.deletedAt)){const after=copy(c);for(const a of after.addons||[])if(addonKey(a)===key){a.text=patch.text;a.note=patch.note||'';if(updatePricing)Object.assign(a,{goodsId:patch.goodsId,priceCents:patch.priceCents,qty:patch.qty,...(patch.items!==undefined?{items:copy(patch.items)}:{}),...(patch.originalQty!==undefined?{originalQty:patch.originalQty}:{})});validateAddon(a,{required:true,costs});}if(JSON.stringify(c)!==JSON.stringify(after))changes.push({id:c.id,name:c.name,product:c.product,before:copy(c),after});}return {changes};
}
export function applyAddonBatch(plan,configs){const targets=plan.changes.map(d=>{const c=configs.find(c=>c.id===d.id);if(!c||JSON.stringify(c)!==JSON.stringify(d.before))throw Error('配置已变化，请重新预览加购修改');return c;});targets.forEach((c,i)=>Object.assign(c,copy(plan.changes[i].after)));return targets.map(c=>c.id);}
