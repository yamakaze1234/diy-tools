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

// Persist insertion beside its source, without renumbering other links.
export function insertConfigAfter(configs,sourceId,duplicate){
 const index=configs.findIndex(c=>c.id===sourceId),source=configs[index];
 const group=c=>JSON.stringify([c.shopId,c.productId||c.product||c.spu]);
 if(!source||source.deletedAt)throw Error('原配置已删除或不存在');
 if(!duplicate?.id||configs.some(c=>c.id===duplicate.id)||group(source)!==group(duplicate))throw Error('复制配置的 ID 或链接无效');
 const siblings=configs.filter(c=>group(c)===group(source));
 let ordered=configs,position=siblings.indexOf(source);
 const rank=rows=>position+1<rows.length?(rows[position].workspaceOrder+rows[position+1].workspaceOrder)/2:rows[position].workspaceOrder+1;
 const usable=siblings.every((c,i)=>Number.isFinite(c.workspaceOrder)&&(!i||c.workspaceOrder>siblings[i-1].workspaceOrder));
 let value=usable?rank(siblings):NaN;
 if(!Number.isFinite(value)||value<=source.workspaceOrder||(position+1<siblings.length&&value>=siblings[position+1].workspaceOrder)){
  // Legacy/duplicate ranks or exhausted floating-point gaps: repair this link only.
  const start=configs.indexOf(siblings[0]),ranks=new Map(siblings.map((c,i)=>[c.id,start+i*2]));
  ordered=configs.map(c=>ranks.has(c.id)?{...c,workspaceOrder:ranks.get(c.id)}:c);
  value=ranks.get(sourceId)+1;
 }
 const result=[...ordered];result.splice(index+1,0,{...duplicate,workspaceOrder:value});return result;
}
