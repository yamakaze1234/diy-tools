import {createHash} from 'node:crypto';
import {validateRecord} from './protocol.mjs';
export function previewMigration(state) {
  const issues=[],records=[],assets=new Map(),scope=state.erpSync?.scope;
  if(!scope)issues.push({code:'ERP_SCOPE_UNKNOWN',message:'尚未核验 ERP 账套与仓库来源'});
  const costs=new Map((state.costSource||[]).map(r=>[r.goodsId,r]));
  for(const row of costs.values()) {
    if(!scope)continue;
    const data={erpScopeId:scope,goodsId:row.goodsId,name:row.name,taxCents:row.tax==null?null:Math.round(row.tax*100)};
    const id=`${scope}|${row.goodsId}`;
    try{validateRecord('component',id,data);records.push({type:'component',id,data});}catch(e){issues.push({code:'INVALID_COMPONENT',id,message:e.message});}
  }
  for(const c of state.configs||[]) {
    const data=structuredClone(c);data.priceCents=Math.round(c.price*100);delete data.price;
    for(const key of ['deletionSessionId','taxUpdatedAt','erpImportedAt','updatedAt'])delete data[key];
    for(const [i,p] of (data.parts||[]).entries()){
      p.lineId ||= 'line-'+createHash('sha256').update(JSON.stringify([c.id,i,p.slot])).digest('hex').slice(0,24);
      const cost=costs.get(p.goodsId);if(cost&&p.tax!=null&&cost.tax!=null&&Math.round(p.tax*100)!==Math.round(cost.tax*100))issues.push({code:'COST_DIFF',id:c.id,goodsId:p.goodsId,localTax:p.tax,sharedTax:cost.tax});
      for(const k of ['erp','tax','stockAvailable','stockUpdatedAt','erpUpdatedAt','erpMissing','erpUnknown'])delete p[k];
    }
    if(c.caseImage)assets.set(c.caseImage,(assets.get(c.caseImage)||0)+1);
    try{validateRecord('configuration',c.id,data);records.push({type:'configuration',id:c.id,data});}catch(e){issues.push({code:'INVALID_CONFIGURATION',id:c.id,message:e.message});}
  }
  for(const [url,references] of assets)issues.push({code:'ASSET_PENDING',configurationReferences:references,message:`一张原始图片被 ${references} 条配置引用，尚未接入跨设备素材管理`});
  const ids=new Set();for(const r of records){const key=JSON.stringify([r.type,r.id]);if(ids.has(key))issues.push({code:'DUPLICATE_ID',id:r.id});ids.add(key);}
  return {readOnly:true,readyForProduction:false,counts:{configurations:state.configs?.length||0,components:costs.size,templates:state.templates?.length||0,sources:state.sourceCatalog?.length||0,gallery:state.caseGallery?.length||0,originalImageReferences:[...assets.values()].reduce((a,b)=>a+b,0),uniqueOriginalImageAddresses:assets.size},issues,sha256:createHash('sha256').update(JSON.stringify(records)).digest('hex'),records};
}
