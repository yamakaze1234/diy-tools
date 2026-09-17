export const slots=['CPU','散热','主板','内存','硬盘','显卡','电源','机箱','风扇','配件1','配件2','配件3','配件4','配件5'];
export const clone=x=>structuredClone(x);
export const cents=x=>x===''||x==null?null:Math.round(Number(x)*100);
export function totals(config){let erp=0,tax=0,missing=0;for(const p of config.parts){if(!p.name&&!p.goodsId)continue;const a=cents(p.erp),b=cents(p.tax);if(a==null||b==null)missing++;erp+=(a||0)*Number(p.qty||0);tax+=(b||0)*Number(p.qty||0);}const price=cents(config.price)||0;return{erp:erp/100,tax:tax/100,basis:Math.round(tax*1.04+10000)/100,erpProfit:Math.round(price*.98-erp)/100,taxProfit:(price-Math.round(tax*1.04+10000))/100,missing};}
export function erpFormula(label){return `=IF([@[${label}_id]]<>"",INDEX([主机成本表V2.xlsb]库存数据!$BD:$BD,MATCH([@[${label}_id]],[主机成本表V2.xlsb]库存数据!$BB:$BB,0)),"")`;}
const clean=x=>{const v=String(x??'').trim();return ['0','/','good id','数量'].includes(v.toLowerCase())?'':v;};
export function erpRow(config){const seen=new Set();for(const p of config.parts){if(p.name&&!clean(p.goodsId)&&!(p.slot==='显卡'&&/不含|无卡|核显|不配/.test(p.name)))throw Error(`${p.slot} 尚未绑定 ERP ID，请先选择配件`);if(clean(p.goodsId)){if(!slots.includes(p.slot))throw Error(`未分配 ERP 槽位：${p.name}`);if(seen.has(p.slot))throw Error(`ERP 槽位重复：${p.slot}`);seen.add(p.slot);if(!Number.isInteger(Number(p.qty))||Number(p.qty)<=0)throw Error(`${p.slot} 数量必须为正整数`);}}
return slots.flatMap(slot=>{const p=config.parts.find(x=>x.slot===slot)||{},id=clean(p.goodsId),qty=id?clean(p.qty):'';return[id||'0',erpFormula(slot),qty||'1',''];});}
export function copyText(configs,kind){if(!configs.length)throw Error('请先勾选配置');if(kind==='parts')return configs.map(c=>erpRow(c).join('\t')).join('\r\n');const key={spu:'spu',sku:'skuId',name:'shortName'}[kind];if(!key)throw Error('未知复制类型');for(const c of configs){if(!String(c[key]||'').trim())throw Error(`${c.name} 尚未填写${kind==='sku'?' SKU ID':kind==='spu'?' SPU':'简称'}`);if(kind!=='name'&&!/^\d+$/.test(c[key]))throw Error(`${c.name} 的 ID 只能包含数字`);if(/[\t\r\n]/.test(c[key]))throw Error('字段包含换行或制表符，请先清理');}return configs.map(c=>c[key]).join('\r\n');}
export const serviceModule=()=>({id:'service',type:'service',title:'服务承诺',text:'官方直营 | 直播装机 | 顺丰包邮 | 保价15天',visible:true,size:18,weight:700,color:'#ffffff',background:'#173e76',fontFamily:'',gap:8});
export const modulesDefault=()=>[
 {id:'header',type:'header',title:'标题与机箱',visible:true,size:29,weight:700,color:'',gap:18},
 {id:'parts',type:'parts',title:'配件清单',visible:true,size:19,weight:600,color:'',gap:16},
 {id:'addons',type:'addons',title:'加购与选配',visible:true,size:17,weight:500,color:'',gap:16},
 {id:'benefits',type:'benefits',title:'专属福利',visible:true,size:17,weight:500,color:'',gap:16},
 serviceModule(),
 {id:'footer',type:'footer',title:'页脚说明',visible:true,size:12,weight:400,color:'',gap:8}
];
// Add the new module without replacing existing text, styling, visibility or order.
export function posterModules(config){const modules=config.modules||modulesDefault();if(modules.some(m=>m.type==='service'))return modules;const next=[...modules],footer=next.findIndex(m=>m.type==='footer');let service=serviceModule();while(next.some(m=>m.id===service.id))service.id+='-new';next.splice(footer<0?next.length:footer,0,service);return next;}
export const posterPalette=theme=>theme==='dark'?{bg:'#07172e',text:'#eef5ff',accent:'#57bdff',line:'#213a59',muted:'#a3b7d0',panel:'#0e2643'}:{bg:'#ffffff',text:'#132b50',accent:'#0070dc',line:'#deebf7',muted:'#6b85a3',panel:'#eff6fd'};
export const posterParts=config=>config.parts.filter(p=>p.name&&p.posterVisible!==false);
// Copy presentation only. Content and per-component visibility belong to each configuration.
export function applyPosterStyle(source,target,{colors=true,format=true,images=false}={}){
 const src=clone(source),copyKeys=(from,to,keys)=>{for(const key of keys){if(from[key]===undefined)delete to[key];else to[key]=clone(from[key]);}};
 if(colors)copyKeys(src,target,['theme','palette','upgradeColor']);
 if(format)copyKeys(src,target,['layout','fontFamily','upgradeSize','upgradeWeight','showUpgrades','showWarranty']);
 if(images)copyKeys(src,target,['caseTransforms','caseVisible']);
 const sourceModules=posterModules(src),targetModules=posterModules(target),used=new Set(),pairs=[];
 for(const m of sourceModules){const match=targetModules.find(t=>!used.has(t)&&t.type===m.type&&t.id===m.id)||targetModules.find(t=>!used.has(t)&&t.type===m.type);if(match){used.add(match);pairs.push([m,match]);}}
 for(const [from,to] of pairs){if(colors)copyKeys(from,to,['color','background']);if(format)copyKeys(from,to,['size','weight','gap','fontFamily','visible']);}
 target.modules=format?[...pairs.map(([,to])=>to),...targetModules.filter(t=>!used.has(t))]:targetModules;
 const colorKeys=['color'],formatKeys=['size','weight','fontFamily','italic'],keys=[...(colors?colorKeys:[]),...(format?formatKeys:[])];
 const styles=clone(target.textStyles||{});for(const s of Object.values(styles))for(const key of keys)delete s[key];
 for(const [key,style] of Object.entries(src.textStyles||{})){
  let dest=key;const pair=pairs.find(([m])=>key.startsWith(m.id+'.'));if(pair)dest=pair[1].id+key.slice(pair[0].id.length);
  if(key.startsWith('part.')&&!target.parts.some(p=>key.startsWith(`part.${p.slot}.`)))continue;
  if(!key.startsWith('part.')&&!pair)continue;
  styles[dest]??={};for(const field of keys)if(style[field]!==undefined)styles[dest][field]=clone(style[field]);
 }
 target.textStyles=Object.fromEntries(Object.entries(styles).filter(([,s])=>Object.keys(s).length));return target;
}
export function templateOf(c,name){return{id:crypto.randomUUID(),name,createdAt:new Date().toISOString(),config:clone(c)};}
export function fromTemplate(t){const c=clone(t.config);c.id=crypto.randomUUID();c.skuId='';c.name=t.name+' · 副本';c.spu='';c.updatedAt=null;return c;}
// Assign a stable product identity once; later SPU edits must not split a link.
export function normalizeProducts(configs){for(const c of configs)c.productId??='legacy:'+String(c.spu||c.product||c.id);return configs;}
export function productGroups(configs){const groups=new Map();for(const c of configs){const id=c.productId||'legacy:'+String(c.spu||c.product||c.id);if(!groups.has(id))groups.set(id,{id,shopId:c.shopId||'intel',name:c.product||'未命名商品链接',url:c.productUrl||'',spu:c.spu||'',category:c.productCategory||'',configs:[]});groups.get(id).configs.push(c);}return [...groups.values()];}
export function templateConfigs(template){return Array.isArray(template.configs)?template.configs:template.config?[template.config]:[];}
export function productTemplate(configs,name){if(!configs.length)throw Error('链接中没有配置');return{id:crypto.randomUUID(),shopId:configs[0].shopId||'intel',name,createdAt:new Date().toISOString(),configs:clone(configs)};}
export function importTemplateConfigs(configs,product){return configs.map(source=>{const c=clone(source);Object.assign(c,{id:crypto.randomUUID(),shopId:product.shopId||c.shopId||'intel',productId:product.id,product:product.name,productCategory:product.category||'',productUrl:product.url||'',spu:product.spu||'',skuId:'',updatedAt:null,shortNameAuto:true});delete c.sampleNote;delete c.emptyLinkDraft;delete c.deletedAt;delete c.deletionSessionId;return c;});}
export function blankConfig(reference,product,name='配置1'){const c=clone(reference??{theme:'light',layout:'long',fontFamily:'Microsoft YaHei',upgradeColor:'',upgradeSize:14,upgradeWeight:400,showUpgrades:true,showWarranty:true,caseImage:'',footer:'配置以所选方案为准',modules:modulesDefault()});Object.assign(c,{id:crypto.randomUUID(),shopId:product.shopId||reference?.shopId||'intel',productId:product.id,product:product.name,productCategory:product.category||'',productUrl:product.url||'',spu:product.spu||'',skuId:'',name,version:'进阶版',shortName:'',shortNameAuto:true,price:0,updatedAt:null,taxUpdatedAt:null,erpImportedAt:null,addons:[],benefits:[],parts:slots.slice(0,8).map(slot=>({slot,name:'',goodsId:'',qty:1,erp:null,tax:null,warranty:'',upgrade:''}))});delete c.sampleNote;delete c.emptyLinkDraft;delete c.deletedAt;delete c.deletionSessionId;return c;}
export function wrapText(ctx,text,maxWidth){const lines=[];for(const para of String(text||'').split('\n')){let line='';const tokens=para.match(/[A-Za-z0-9][A-Za-z0-9._/+*-]*|[^A-Za-z0-9]/gu)||[];for(const token of tokens){if(ctx.measureText(token).width>maxWidth){for(const ch of token){if(line&&ctx.measureText(line+ch).width>maxWidth){lines.push(line.trimEnd());line='';}line+=ch;}}else{if(line&&ctx.measureText(line+token).width>maxWidth){lines.push(line.trimEnd());line='';}line+=!line?token.trimStart():token;}}lines.push(line);}return lines;}

export const liveConfigs=configs=>configs.filter(c=>!c.deletedAt);
export function deleteConfigs(configs,ids,at=new Date().toISOString()){const selectedIds=new Set(ids);let count=0;for(const c of configs)if(!c.deletedAt&&selectedIds.has(c.id)){c.deletedAt=at;count++;}return count;}
export function restoreConfigs(configs,ids){const selectedIds=new Set(ids);for(const c of configs)if(selectedIds.has(c.id)){delete c.deletedAt;delete c.deletionSessionId;}}
