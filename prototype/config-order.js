export function restoreConfigOrder(configs){
 const groups=new Map();for(const c of configs){const key=JSON.stringify([c.shopId,c.productId||c.product||c.spu]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
 for(const group of groups.values()){
  if(group.every(c=>Number.isFinite(c.workspaceOrder))&&new Set(group.map(c=>c.workspaceOrder)).size===group.length){group.sort((a,b)=>a.workspaceOrder-b.workspaceOrder);continue;}
  const line=c=>c.wpsImport?.lineStart,num=c=>/^配置\s*(\d+)$/.exec(c.name||'')?.[1];
  if(group.every(c=>Number.isFinite(line(c)))&&new Set(group.map(line)).size===group.length)group.sort((a,b)=>line(a)-line(b));
  else if(group.every(c=>num(c))&&new Set(group.map(num)).size===group.length)group.sort((a,b)=>Number(num(a))-Number(num(b)));
 }
 return [...groups.values()].flat();
}
