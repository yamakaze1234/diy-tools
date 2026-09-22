import {withSpecialPresets,normalizeSpecialComponent} from '../prototype/special-components.js';
// Read native records too: older browser views omitted the specialComponent flag.
export function specialChoices(state,shopId){
 const native=new Map((state.cloudSync?.records||[]).filter(r=>r.type==='source').map(r=>[r.id,r.draft]));
 const rows=new Map(state.sources.filter(s=>s.shopId===shopId).map(s=>[s.sourceId,{...native.get(s.sourceId),...s,specialComponent:s.specialComponent??native.get(s.sourceId)?.specialComponent,deletedAt:native.get(s.sourceId)?.deletedAt||s.deletedAt}]));
 for(const [id,row] of native)if(row.shopId===shopId&&!rows.has(id))rows.set(id,row);
 return withSpecialPresets([...rows.values()],shopId).filter(s=>s.specialComponent===true&&!s.deletedAt).map(normalizeSpecialComponent);
}
export function applySpecialPart(part,source){
 const name=String(source.name||'').trim();if(!name)throw Error('请填写特殊配件的显示内容');if(name.length>160)throw Error('显示内容不能超过 160 个字');
 delete part.addonOverride;
 Object.assign(part,normalizeSpecialComponent({name,sourceId:source.sourceId||'',specialComponent:true}),{upgrade:''});
 return part;
}
