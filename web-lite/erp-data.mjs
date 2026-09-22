import {validateSnapshot} from '../prototype/erp-sync.js';
export function validateWebSnapshot(data){
 if(data?.format!=='diy-erp-snapshot-v1'||data.origin!=='https://cqzs.3cerp.com'||data.warehouse!=='公司大库'||typeof data.account!=='string'||!data.account.trim()||typeof data.depotId!=='string'||!/^\d+$/.test(data.depotId)||typeof data.costField!=='string'||!data.costField||typeof data.costHeader!=='string'||!data.costHeader||!Number.isFinite(Date.parse(data.capturedAt))||Date.parse(data.capturedAt)>Date.now()+300000)throw Error('不是有效的工作台 ERP 库存快照');
 validateSnapshot(data);return data;
}
export function applyErpSnapshot(state,input){
 const data=validateWebSnapshot(input),rows=data.rows.map(r=>({goodsId:r.goodsId,name:r.name,erp:r.erp,stockAvailable:r.stockAvailable}));
 state.erpSnapshot={...Object.fromEntries(['format','source','sqlSource','origin','account','warehouse','depotId','costField','costHeader','capturedAt','complete','total'].map(k=>[k,data[k]])),rows};
 return refreshErpCatalog(state);
}
export function refreshErpCatalog(state){
 if(!state.erpSnapshot)return {matched:0,unmatched:state.catalog.length};const data=validateWebSnapshot(state.erpSnapshot),map=new Map(data.rows.map(r=>[r.goodsId,r]));let matched=0;
 for(const p of state.catalog){const r=map.get(p.goodsId);p.erp=r?.erp??null;p.stockAvailable=r?.stockAvailable??null;p.erpName=r?.name||'';p.stockUpdatedAt=data.capturedAt;p.erpUpdatedAt=data.capturedAt;p.erpMissing=!r;if(r)matched++;}
 return {matched,unmatched:state.catalog.length-matched};
}
