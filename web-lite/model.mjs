import {totals,slots as workbenchSlots} from '../prototype/core.js';
import {pricing} from '../prototype/pricing.js';
import {actualParts} from '../prototype/actual-parts.js';

export const STORAGE_KEY='diy-web-lite-prototype-v1';
export const copy=value=>structuredClone(value);
export const uid=()=>crypto.randomUUID();
export const slots=workbenchSlots;
export function createDemo(){
 const rows=[
 ['990001','CPU','Intel 酷睿 i5-14600KF',1500,1480,28],['990002','散热','利民 PA120 SE 双塔风冷',180,170,36],
 ['990003','主板','技嘉 B760M AORUS ELITE',950,920,18],['990004','内存','金士顿 DDR5 6000 16GB',260,250,52],
 ['990005','硬盘','西部数据 SN770 NVMe 1TB',450,440,30],['990006','显卡','技嘉 RTX 5060 Ti 8GB',2400,2350,12],
 ['990007','电源','长城 额定 650W 金牌电源',320,310,24],['990008','机箱','乔思伯 D31 标准版 白色',280,280,16],
 ['990009','CPU','Intel 酷睿 i5-14400F',900,880,42],['990010','显卡','技嘉 RTX 5060 8GB',1700,1690,21],
 ['990011','CPU','Intel 酷睿 i7-14700KF',2100,2030,15],['990012','显卡','技嘉 RTX 5070 12GB',3150,3100,8],
 ['990013','显卡','技嘉 RTX 5070 Ti 16GB',5700,5350,6],['990014','显卡','技嘉 RTX 5080 16GB',null,null,null],
 ['990015','机箱','乔思伯 D41 标准版 黑色',350,340,10],['990016','硬盘','西部数据 SN850X NVMe 2TB',820,800,14],
 ['990017','内存','金士顿 DDR5 6000 32GB',480,470,20],['990018','风扇','乔思伯 120mm PWM 风扇',35,32,60],
 ];
 const catalog=rows.map(([goodsId,slot,name,erp,tax,stockAvailable])=>({goodsId,slot,name,erp,tax,stockAvailable}));
 const parts=rows.slice(0,8).map(([goodsId,slot,name])=>({lineId:uid(),slot,name,goodsId,qty:slot==='内存'?2:1}));
 const make=(id,name,price,changes={},productId='p1',installment=0)=>({id,productId,name,version:'进阶版',shortName:'',skuId:'',price,installment,parts:copy(parts),actualParts:parts.map(p=>({...copy(p),...(changes[p.slot]?{goodsId:changes[p.slot],name:catalog.find(x=>x.goodsId===changes[p.slot]).name}:{})}))});
 const configs=[make('c1','配置1',5999,{CPU:'990009',显卡:'990010'}),make('c2','配置2',7499),make('c3','配置3',8999,{CPU:'990011',显卡:'990012'}),make('c4','配置4',9999,{显卡:'990013'}),make('c5','配置5',12999,{显卡:'990014'}),make('c6','配置1',8199,{机箱:'990015'},'p2'),make('c7','配置1',8499,{},'p3',24),make('c8','配置1',8999,{CPU:'990011',显卡:'990012'},'p4'),make('c9','配置1',7699,{},'p5')];
 configs[0].version='入门版';configs[2].version='性能版';configs[3].version='高配版';configs[4].version='旗舰版';
 return {schemaVersion:1,revision:0,shops:[{id:'intel',name:'英特尔官方旗舰店',short:'英特尔',coupon:200},{id:'gigabyte',name:'技嘉官方旗舰店',short:'技嘉',coupon:200},{id:'jonsbo',name:'乔思伯官方旗舰店',short:'乔思伯',coupon:100}],
 products:[{id:'p1',shopId:'intel',category:'日常主推',name:'乔思伯 D31 游戏主机',spu:''},{id:'p2',shopId:'intel',category:'日常主推',name:'乔思伯 D41 性能主机',spu:''},{id:'p3',shopId:'intel',category:'24期分期',name:'高性能分期专享主机',spu:''},{id:'p4',shopId:'gigabyte',category:'日常主推',name:'技嘉全家桶游戏主机',spu:''},{id:'p5',shopId:'jonsbo',category:'日常主推',name:'乔思伯海景房主机',spu:''}],
 configs,catalog,templates:[{id:'t1',shopId:'intel',name:'14600KF 通用方案',configs:copy(configs.slice(0,3))},{id:'t2',shopId:'intel',name:'海景房标准方案',configs:copy([configs[5],configs[3]])},{id:'t3',shopId:'gigabyte',name:'技嘉游戏主机方案',configs:copy([configs[7]])},{id:'t4',shopId:'jonsbo',name:'乔思伯通用方案',configs:copy([configs[8]])}],drafts:{},logs:[],erpDemoAt:null};
}
export function hydrate(config,catalog){
 const map=catalog instanceof Map?catalog:new Map(catalog.map(p=>[p.goodsId,p]));
 return {...copy(config),actualParts:actualParts(config).map(p=>{const row=map.get(p.goodsId);return {...copy(p),erp:p.specialComponent?0:row?.erp??null,tax:p.specialComponent?0:row?.tax??null,stockAvailable:row?.stockAvailable??null};})};
}
export function calculate(config,catalog,coupon=0){
 const c=hydrate(config,catalog),rows=actualParts(c).filter(p=>!p.specialComponent),nonempty=actualParts(c).length>0;
 const validQty=rows.every(p=>Number.isInteger(p.qty)&&p.qty>0);
 const validCost=key=>nonempty&&validQty&&rows.every(p=>p.goodsId&&Number.isFinite(p[key])&&p[key]>=0);
 const hasErp=validCost('erp'),hasTax=validCost('tax');
 const validPrice=config.price!==null&&config.price!==''&&Number.isFinite(config.price)&&config.price>=0;
 let p=null;try{if(validPrice)p=pricing(config,{coupon});}catch{}
 const t=totals({...c,price:validPrice?config.price:0});
 const demands=new Map();for(const row of rows)demands.set(row.goodsId,(demands.get(row.goodsId)||0)+row.qty);
 const stockKnown=rows.length>0&&validQty&&rows.every(row=>row.goodsId&&Number.isFinite(row.stockAvailable));
 const capacity=stockKnown?Math.min(...[...demands].map(([id,qty])=>Math.max(0,Math.floor(rows.find(r=>r.goodsId===id).stockAvailable/qty)))):null;
 const round=value=>Math.round(value*100)/100;
 return {listPrice:p?.listPrice??null,fee:p?.fee??null,erp:hasErp?t.erp:null,tax:hasTax?t.tax:null,erpProfit:hasErp&&p?round(t.erpProfit-p.fee):null,taxProfit:hasTax&&p?round(t.taxProfit-p.fee):null,capacity,missing:rows.filter(p=>!p.goodsId||p.erp===null||p.tax===null).length,validQty};
}
export function validateConfig(c){
 if(!c.name?.trim())throw Error('请填写配置名称');
 if(c.price===null||!Number.isFinite(c.price)||c.price<0)throw Error('到手价必须是有效的非负金额');
 if(![0,12,24].includes(c.installment))throw Error('请选择有效的分期方式');
 if(c.skuId&&!/^\d+$/.test(c.skuId))throw Error('SKU ID 只能包含数字，请按文本粘贴');
 for(const p of actualParts(c))if(!Number.isInteger(p.qty)||p.qty<1)throw Error(`${p.slot}数量必须为正整数`);
 return c;
}
export function instantiateTemplate(source,productId,name){
 const c=copy(source);Object.assign(c,{id:uid(),productId,name:name||source.name,skuId:'',spu:'',updatedAt:null});
 delete c.deletedAt;delete c.deletionSessionId;delete c.workspaceOrder;delete c.wpsImport;delete c.emptyLinkDraft;
 for(const key of ['parts','actualParts'])if(Array.isArray(c[key]))c[key]=c[key].map(p=>({...p,lineId:uid()}));
 return c;
}
export function replaceFromTemplate(target,source){
 // Replace the costed bill of materials; preserve target identity and image/display data.
 const next=copy(target);next.actualParts=actualParts(source).map(p=>({...copy(p),lineId:uid()}));return next;
}
export function templateDiff(target,source){
 const a=actualParts(target),b=actualParts(source),keys=new Set([...a,...b].map(p=>p.slot));
 return [...keys].map(slot=>({slot,before:a.filter(p=>p.slot===slot).map(p=>`${p.name||'未选配件'} × ${p.qty}`).join(' / ')||'无',after:b.filter(p=>p.slot===slot).map(p=>`${p.name||'未选配件'} × ${p.qty}`).join(' / ')||'无'})).filter(r=>r.before!==r.after);
}
