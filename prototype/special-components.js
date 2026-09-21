export const specialComponentNames=[
 '不含显卡，可咨询客服加装独显使用',
 '支持一对一直播装机 从无到有尽收眼底 包装全保留',
 '全新Intel ARC Xe核显 支持8K 60HZ视频输出',
 '支持DIY升级改配 联系客服核算差价',
 'intel UHD770 超核心显卡'
];
export const isSpecialComponent=row=>row?.specialComponent===true;
export function normalizeSpecialComponent(row){
 if(!isSpecialComponent(row))return row;
 return {...row,goodsId:'',erp:0,tax:0,erpUnknown:false,erpMissing:false,erpName:'',stockAvailable:null,stockUpdatedAt:null,stockSource:null,erpUpdatedAt:null};
}
// Defaults are virtual until edited, so an empty new workspace can still receive cloud data.
export function withSpecialPresets(rows,shopId){
 const ids=new Set(rows.map(r=>r.sourceId));
 return [...rows,...specialComponentNames.map((name,i)=>normalizeSpecialComponent({sourceId:`special:${shopId}:${i+1}`,shopId,specialComponent:true,goodsId:'',name,originalName:name,warranty:'',upgrade:'',addonText:'',addonNote:''})).filter(r=>!ids.has(r.sourceId))];
}
