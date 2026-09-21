import {projectWorkspace} from '../../prototype/workspace-records.mjs';
import {validateWorkspaceRecord} from '../../prototype/workspace-validation.mjs';
export const member={ok:true,uid:'test-user',workspaceId:'test-workspace',memberId:'test-member',name:'隔离测试成员',ready:true};
export function fixture(){
 const source={sourceId:'source-ssd',shopId:'intel',goodsId:'123',slot:'硬盘',name:'桌面输出源固态',upgrade:'支持容量升级',warranty:'五年质保',addonText:'升级 2TB',addonPriceCents:39900,addonItems:[{goodsId:'456',qty:1}],addonOriginalQty:1,addonShowTogether:true};
 const part={sourceId:source.sourceId,lineId:'ssd-line',goodsId:'123',name:source.name,slot:'硬盘',qty:1};
 return {configs:[{id:'config-one',shopId:'intel',productId:'product-one',product:'云端测试商品',productCategory:'日常主推',name:'配置1',price:1999,installment:0,parts:[part],actualParts:[structuredClone(part)],addons:[{sourceId:source.sourceId,text:source.addonText,priceCents:39900,items:[{goodsId:'456',qty:1}],originalQty:1,showTogether:true}],caseImage:'/assets/keep.png',freeCanvasLayouts:{long:{x:22}},footer:'保留展示信息'}],sourceCatalog:[source,{...structuredClone(source),sourceId:'source-ssd-other',name:'同商品第二个输出源',addonText:'独立文案'},{...structuredClone(source),shopId:'jonsbo',sourceId:'source-jonsbo',name:'其他店铺输出源'}],costSource:[{goodsId:'123',name:'原固态',erp:450,tax:440,stockAvailable:20},{goodsId:'456',name:'升级固态',erp:800,tax:780}],templates:[],shopSettings:{intel:{coupon:200},gigabyte:{coupon:100},jonsbo:{coupon:100}},caseGallery:[],sharedCostScope:'test-scope'};
}
export function fakeCloud(){
 const records=new Map(),log=[],receipts=new Map(),requests=[];
 const put=(type,id,data)=>{validateWorkspaceRecord(type,id,data);const key=JSON.stringify([type,id]),version=(records.get(key)?.version||0)+1;const row={type,id,data:structuredClone(data),version,seq:log.length+1};records.set(key,row);log.push(row);return structuredClone(row);};
 for(const r of projectWorkspace(fixture()))put(r.type,r.id,r.data);put('workspace_meta','root',{format:2,counts:{}});
 const call=async req=>{requests.push(structuredClone(req));const p=req.payload||{};
  if(req.action==='session.get')return structuredClone(member);
  if(req.action==='sync.pull'){const headSeq=p.headSeq??log.length,changes=log.filter(r=>r.seq>p.cursor&&r.seq<=headSeq).slice(0,3),nextCursor=changes.at(-1)?.seq??p.cursor;return {ok:true,changes:structuredClone(changes),headSeq,nextCursor,hasMore:nextCursor<headSeq};}
  if(req.action==='sync.push'){if(receipts.has(p.mutationId))return structuredClone(receipts.get(p.mutationId));const current=records.get(JSON.stringify([p.entityType,p.entityId]));const response=(current?.version||0)!==p.baseVersion?{ok:false,code:'CONFLICT',remote:structuredClone(current)}:{ok:true,record:put(p.entityType,p.entityId,p.after)};receipts.set(p.mutationId,response);return structuredClone(response);}
  throw Error('Unexpected action '+req.action);
 };return {put,call,records,log,requests};
}
