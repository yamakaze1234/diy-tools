import {equal} from '../shared/sync/protocol.mjs';
import {sourceAddonOptions,addonItems,choiceAddon,choiceText,selectedSourceAddons} from '../prototype/addon-data.js';
import {actualParts} from '../prototype/actual-parts.js';
import {stripLocalErp} from '../prototype/local-erp-policy.mjs';
import {editRecord,record} from './cloud-sync.mjs';
const copy=v=>structuredClone(v);
const shopNames={intel:'英特尔官方旗舰店',gigabyte:'技嘉旗舰店',jonsbo:'乔思伯官方旗舰店'};
const rows=(sync,type)=>sync.records.filter(r=>r.type===type&&!r.draft.deletedAt);
const nativeOption=(a,i)=>({id:a.variantId||'base-'+i,text:a.text||'',note:a.note||'',priceCents:a.priceCents??null,enabled:a.showTogether??true,mode:a.mode==='add'?'add':'replace',originalQty:a.originalQty??a.qty??1,items:copy(addonItems(a))});
const optionsFromAddons=addons=>addons.flatMap((a,i)=>a.choices?a.choices.map(x=>({...nativeOption(choiceAddon(x,a.sourceId),i),id:x.id,enabled:x.enabled,text:x.label,_choice:true})):[nativeOption(a,i)]);
const signature=addons=>optionsFromAddons(addons).map(({id,_choice,...o})=>({...o,text:_choice?choiceText({label:o.text,priceCents:o.priceCents}):o.text}));
export function sourceFromNative(row){
 const options=row.addonChoices!==undefined?row.addonChoices.map(c=>({...nativeOption(choiceAddon(c,row.sourceId),0),id:c.id,enabled:c.enabled,text:c.label,_choice:true})):sourceAddonOptions(row).filter(a=>a.text||addonItems(a).length).map(nativeOption);
 return {sourceId:row.sourceId,shopId:row.shopId,goodsId:row.goodsId,name:row.name||row.originalName||'',upgrade:row.upgrade||'',addons:options};
}
function optionToNative(o){return {variantId:o.id,text:o._choice?choiceText({label:o.text,priceCents:o.priceCents}):o.text,note:o.note||'',priceCents:o.priceCents,items:copy(o.items),originalQty:o.originalQty,showTogether:o.enabled,mode:o.mode};}
export function sourceToNative(source,base={}){
 const next={...copy(base),sourceId:source.sourceId,shopId:source.shopId,goodsId:source.goodsId,name:source.name,upgrade:source.upgrade};
 if(equal(source.addons,sourceFromNative({...base,sourceId:source.sourceId}).addons))return next;
 // Keep the workbench's current choice format whenever its single-item
 // structure suffices. Bundles use its existing variants/items format.
 for(const k of Object.keys(next))if(k.startsWith('addon'))delete next[k];
 if(base.addonChoices!==undefined&&source.addons.every(o=>o.items.length===1&&o.mode==='replace')){
  next.addonChoices=source.addons.map(o=>({...copy(base.addonChoices.find(c=>c.id===o.id)||{}),id:o.id,label:o.text,enabled:o.enabled,goodsId:o.items[0].goodsId,qty:o.items[0].qty,originalQty:o.originalQty,priceCents:o.priceCents}));
  next.addonText='';return next;
 }
 const [first,...rest]=source.addons.map(optionToNative);
 Object.assign(next,{addonText:first?.text||'',addonNote:first?.note||'',addonGoodsId:'',addonPriceCents:first?.priceCents??null,addonQty:1,addonItems:first?.items||[],addonOriginalQty:first?.originalQty||1,addonShowTogether:first?.showTogether??false,addonMode:first?.mode||'replace',addonVariants:rest});
 return next;
}
function configFromNative(data){
 const c=copy(data);if(c.priceCents!==undefined){c.price=c.priceCents/100;delete c.priceCents;}
 c.version??='';c.shortName??='';c.skuId??='';c.installment??=0;
 c.actualParts=actualParts(c).map(p=>({...p}));return c;
}
const productKey=c=>c.productId||`cloud-product:${c.shopId}:${c.spu||c.product||c.id}`;
export function materialize(sync,previous={}){
 const state={schemaVersion:1,revision:previous.revision||0,shops:Object.entries(shopNames).map(([id,name])=>({id,name,short:name,coupon:(record(sync,'settings',id)?.draft.couponCents||0)/100})),products:[],configs:[],catalog:[],sources:[],templates:[],drafts:copy(previous.drafts||{}),logs:copy(previous.logs||[]),cloudSync:sync,cloud:true};
 const catalog=new Map();const addProduct=(id,name,slot='配件')=>{if(!/^\d{1,20}$/.test(id||''))return;const old=catalog.get(id);if(!old)catalog.set(id,{goodsId:id,name:name||id,slot,erp:null,tax:null,stockAvailable:null});else{if(old.slot==='配件'&&slot!=='配件')old.slot=slot;if(old.name===id&&name)old.name=name;}};
 for(const r of rows(sync,'source')){const s=sourceFromNative(r.draft);state.sources.push(s);addProduct(s.goodsId,s.name,r.draft.slot||r.draft.category||'配件');for(const o of s.addons)for(const item of o.items)addProduct(item.goodsId,item.goodsId);}
 for(const r of rows(sync,'configuration').sort((a,b)=>(a.draft.workspaceOrder??1e9)-(b.draft.workspaceOrder??1e9))){const c=configFromNative(r.draft);c.productId=productKey(c);if(!state.products.some(p=>p.id===c.productId))state.products.push({id:c.productId,shopId:c.shopId,name:c.product||c.productId,category:c.productCategory||c.category||'未分类',spu:c.spu||''});state.configs.push(c);for(const p of [...(c.parts||[]),...c.actualParts])addProduct(p.goodsId,p.name,p.slot);}
 const components=rows(sync,'component');for(const r of components){const c=r.draft;addProduct(c.goodsId,c.name);const p=catalog.get(c.goodsId);if(!p)continue;if(p.componentId)throw Error('同一商品存在多个核算账套，暂不能在网页版合并，请先确认数据来源');p.componentId=r.id;p.tax=c.taxCents==null?null:c.taxCents/100;}
 state.catalog=[...catalog.values()];
 state.templates=rows(sync,'template').map(r=>({...copy(r.draft),configs:(r.draft.configs||[r.draft.config].filter(Boolean)).map(configFromNative)}));
 // Custom native addons are snapshots, not implicit source inheritance.
 const sourcesById=new Map(state.sources.map(s=>[s.sourceId,s]));
 for(const c of [...state.configs,...state.templates.flatMap(t=>t.configs.map(c=>({...c,shopId:t.shopId,_template:true})))]){for(const p of c.actualParts){const source=sourcesById.get(p.sourceId);if(!source||source.shopId!==c.shopId)continue;const native=record(sync,'source',source.sourceId).draft,current=(c.addons||[]).filter(a=>a.sourceId===p.sourceId),inherited=selectedSourceAddons(native,current);
  // A desktop addon edit outranks stale metadata left by an older web save.
  if(p.addonOverride&&!equal(signature(p.addonOverride.addons.filter(o=>o.enabled).map(optionToNative)),signature(current)))delete p.addonOverride;
  if(!p.addonOverride&&(c._template||!equal(signature(current),signature(inherited))))p.addonOverride={goodsId:p.goodsId,upgrade:p.upgrade||'',addons:optionsFromAddons(current)};
 }}
 // Empty local links have no record until their first configuration is saved.
 for(const p of previous.products||[])if(!state.products.some(x=>x.id===p.id)&&!(previous.configs||[]).some(c=>c.productId===p.id))state.products.push(copy(p));
 return state;
}
function configToNative(c,state,base={},beforeView={}){
 const p=state.products.find(p=>p.id===c.productId);if(!p)throw Error('配置所属商品链接不存在');
 const next={...copy(base),...copy(c),shopId:p.shopId,product:p.name,productId:p.id,spu:p.spu||'',productCategory:p.category,priceCents:Math.round(c.price*100)};delete next.price;
 // Keep display/poster fields from the native record. Only actual BOM edits
 // and this source's addon group are changed by the web editor.
 for(const key of ['parts','actualParts'])if(Array.isArray(next[key]))next[key]=next[key].map(p=>{const row={...p,lineId:p.lineId||crypto.randomUUID()};delete row.addonOverride;return row;});
 next.addons=copy(c.addons||base.addons||[]);
 const previousSources=new Set(actualParts(beforeView).map(p=>p.sourceId).filter(Boolean)),presentSources=new Set(actualParts(c).map(p=>p.sourceId).filter(Boolean));
 next.addons=next.addons.filter(a=>!previousSources.has(a.sourceId)||presentSources.has(a.sourceId));
 for(const part of actualParts(c)){
  const source=state.sources.find(s=>s.sourceId===part.sourceId&&s.shopId===p.shopId);if(!source)continue;
  const beforePart=actualParts(beforeView).find(x=>x.lineId===part.lineId);
  if(equal(beforePart?.addonOverride,part.addonOverride)&&beforePart?.sourceId===part.sourceId&&base.id)continue;
  const options=part.addonOverride?.goodsId===part.goodsId?part.addonOverride.addons:source.addons;
  next.addons=next.addons.filter(a=>a.sourceId!==source.sourceId);
  next.addons.push(...options.filter(o=>o.enabled).map(o=>({...optionToNative(o),sourceId:source.sourceId})));
 }
 // Store override metadata on actual parts too, so inheritance survives the
 // web/desktop round trip without editing poster descriptions.
 next.actualParts=next.actualParts.map((part,i)=>c.actualParts[i].addonOverride?{...part,addonOverride:copy(c.actualParts[i].addonOverride)}:part);
 return stripLocalErp(next);
}
export function stageChanges(before,next){
 const sync=next.cloudSync,oldSources=new Map(before.sources.map(s=>[s.sourceId,s])),oldConfigs=new Map(before.configs.map(c=>[c.id,c])),oldCatalog=new Map(before.catalog.map(p=>[p.goodsId,p])),oldTemplates=new Map(before.templates.map(t=>[t.id,t]));
 for(const source of next.sources){const old=oldSources.get(source.sourceId);if(!equal(old,source)){
  const native=sourceToNative(source,record(sync,'source',source.sourceId)?.draft);editRecord(sync,'source',source.sourceId,native);
  // Persist the same selected offers for configurations that visibly follow
  // this source. Custom configurations and all poster/BOM fields stay intact.
  for(const c of next.configs){if(c.shopId!==source.shopId||!actualParts(c).some(p=>p.sourceId===source.sourceId))continue;if(actualParts(c).some(p=>p.sourceId===source.sourceId&&p.addonOverride))continue;
   const oldAddons=(c.addons||[]).filter(a=>a.sourceId===source.sourceId);c.addons=[...(c.addons||[]).filter(a=>a.sourceId!==source.sourceId),...selectedSourceAddons(native,oldAddons)];
  }
 }}
 for(const c of next.configs){const old=oldConfigs.get(c.id);if(!equal(old,c)){const data=configToNative(c,next,record(sync,'configuration',c.id)?.draft,old);if(!old)data.workspaceOrder=Math.max(-1,...rows(sync,'configuration').map(r=>r.draft.workspaceOrder??0))+1;editRecord(sync,'configuration',c.id,data);}}
 for(const p of next.catalog){const old=oldCatalog.get(p.goodsId);if(old&&p.tax!==old.tax){const r=record(sync,'component',p.componentId);if(!r)throw Error('此商品未绑定云端核算账套，不能直接新建核算价');editRecord(sync,'component',r.id,{...r.draft,taxCents:p.tax==null?null:Math.round(p.tax*100)});}}
 for(const s of next.shops)if(s.coupon!==before.shops.find(x=>x.id===s.id)?.coupon)editRecord(sync,'settings',s.id,{...record(sync,'settings',s.id)?.draft,couponCents:Math.round(s.coupon*100)});
 for(const t of next.templates){const old=oldTemplates.get(t.id);if(!equal(old,t))editRecord(sync,'template',t.id,stripLocalErp({...record(sync,'template',t.id)?.draft,...copy(t)}));}
 return next;
}
