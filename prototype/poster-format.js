const fields=['size','weight','color','fontFamily','italic'];
export function captureTextFormat(config,region,density=1){
 const explicit=config.textStyles?.[region.key]||{};
 return Object.fromEntries(fields.map(k=>[k,explicit[k]??(k==='size'?region.styleSize??Math.round(region.size/density):region[k]??(k==='italic'?false:''))]));
}
export function applyTextFormat(config,key,format){
 config.textStyles??={};const style=config.textStyles[key]??={};
 for(const field of fields)style[field]=structuredClone(format[field]);
 // Old range overrides must not obscure the newly painted typography.
 if(style.ranges){style.ranges=style.ranges.map(r=>({...r,style:Object.fromEntries(Object.entries(r.style||{}).filter(([k])=>!fields.includes(k)))})).filter(r=>Object.keys(r.style).length);if(!style.ranges.length)delete style.ranges;}
}
