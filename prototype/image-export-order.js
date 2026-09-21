// Export a copy in numeric configuration order without reordering saved data.
export function orderedImageConfigs(configs){
 const groups=new Map();
 for(const c of configs){const key=JSON.stringify([c.shopId,c.productId||c.product||c.spu||'']);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
 const number=c=>/^配置\s*(\d+)(?:\D|$)/.exec(c.name||'')?.[1];
 return [...groups.values()].flatMap(rows=>rows.map((c,i)=>({c,i})).sort((a,b)=>{
  const x=number(a.c),y=number(b.c);
  if(x!==undefined&&y!==undefined)return Number(x)-Number(y)||a.i-b.i;
  if(x!==undefined||y!==undefined)return x!==undefined?-1:1;
  return a.i-b.i;
 }).map(v=>v.c));
}
export const numberedImageEntries=configs=>orderedImageConfigs(configs).map((config,i)=>({config,name:`${i+1}.png`}));

export function imageArchiveName(configs,layout){
 const links=new Map();for(const c of configs){const key=JSON.stringify([c.shopId,c.productId||c.product||c.spu||'']);if(!links.has(key))links.set(key,String(c.product||'未命名链接').trim()||'未命名链接');}
 const names=[...links.values()],label=names.length>1?`${names[0]}等${names.length}个链接`:names[0]||'未命名链接';
 const safe=label.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,100)||'未命名链接';
 return `${safe}_${layout==='square'?'SKU图':'详情图'}.zip`;
}
