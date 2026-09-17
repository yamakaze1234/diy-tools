const week=7*24*60*60*1000;
export function recentActivity(rows,now=Date.now()){
 const seen=new Set();return (rows||[]).filter(r=>{const t=Date.parse(r.at);if(!Number.isFinite(t)||t<now-week||t>now+60000)return false;const id=r.id||JSON.stringify([r.at,r.operator,r.message]);if(seen.has(id))return false;seen.add(id);return true;}).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}
const labels={addons:'加购与选配',benefits:'福利点',parts:'配件',price:'售价',priceCents:'售价',name:'配置名称',shortName:'简称',spu:'SPU',skuId:'SKU',posterImages:'添加的图片',caseImage:'机箱图',modules:'模块',theme:'主题',palette:'配色',tax:'核算价',taxCents:'核算价',upgrade:'升级文案',addonText:'加购文案'};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),cut=v=>String(v||'').slice(0,80);
export function activityEntry(type,id,before,after,{at=new Date().toISOString(),operator='未知成员',origin='local',eventId,message}={}){
 if(['erp_chunk','workspace_meta'].includes(type))return null;
 const fields=[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(k=>!['updatedAt','taxUpdatedAt','erpImportedAt','deletionSessionId','lineId'].includes(k)&&!equal(before?.[k],after?.[k]));
 if(!fields.length)return null;const data=after||before||{},target={type,id,shopId:data.shopId,goodsId:data.goodsId};
 let detail=fields.map(k=>labels[k]||k).slice(0,6).join('、');
 if(type==='configuration'){
  target.field=fields.includes('addons')?'addons':fields.includes('benefits')?'benefits':fields.find(k=>['name','shortName','spu','skuId'].includes(k));
  target.tab=fields.includes('addons')||fields.includes('benefits')?'addons':fields.includes('parts')?'parts':fields.some(k=>['price','priceCents'].includes(k))?'costs':target.field?'parts':'modules';
  const part=(after?.parts||[]).find((p,i)=>!equal(p,before?.parts?.[i]));
  if(fields.includes('parts')&&part){target.slot=part.slot;const old=before?.parts?.find(p=>p.slot===part.slot);if(old&&old.upgrade!==part.upgrade){target.tab='addons';target.field='upgrade';}detail=(part.slot||'配件')+'：'+detail;}
 }
 const content=data.addons?.map(a=>a.text).join('；')||data.benefits?.map(b=>b.text).join('；');
 const changedPart=(data.parts||[]).find((p,i)=>!equal(p,before?.parts?.[i]));
 const preview=cut(fields.includes('parts')?(changedPart?.upgrade||changedPart?.name):fields.includes('addons')||fields.includes('benefits')?content:fields.includes('taxCents')?`核算价：${data.taxCents==null?'待补充':data.taxCents/100}`:'');
 const title=cut(type==='configuration'?[data.product,data.name].filter(Boolean).join(' / '):data.name||data.goodsId||id);
 return {id:eventId||crypto.randomUUID(),at,operator:cut(operator),origin,message:cut(message||((!before?'新增':data.deletedAt?'删除':'修改')+' '+title)),summary:cut(title+' · '+detail),preview,target};
}
