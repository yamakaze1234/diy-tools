import {excludedComponent} from './component-policy.js';
import crypto from 'node:crypto';
import {normalizeSqlBundle,readSqlBundle,sqlSettings} from './sql-source.mjs';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function sqlStockPlan(state,rows,at=new Date().toISOString()){
 const next=structuredClone(state),map=new Map(rows.map(r=>[r.goodsId,r])),changes=[],configIds=new Set();let matched=0,unmatched=0;
 next.sharedCostScope=state.sharedCostScope||state.erpSync?.scope||'unbound';const manual=new Map();for(const r of [...(state.sourceCatalog||[]),...(state.configs||[]).flatMap(c=>c.parts||[])])if(r.goodsId&&r.tax!=null){if(!manual.has(r.goodsId))manual.set(r.goodsId,new Set());manual.get(r.goodsId).add(r.tax);}
 const costs=new Set((next.costSource||[]).map(r=>r.goodsId));next.costSource??=[];for(const row of rows)if(!costs.has(row.goodsId)&&!excludedComponent(row))next.costSource.push({goodsId:row.goodsId,name:row.name,tax:manual.get(row.goodsId)?.size===1?[...manual.get(row.goodsId)][0]:null,erp:null,stockAvailable:null,localInventoryOnly:true});
 const update=(record,area,configId)=>{if(!record.goodsId)return;const row=map.get(record.goodsId);if(!row){unmatched++;return;}matched++;const value=row.stockAvailable;if(record.stockAvailable!==value||record.erp!==row.erp)changes.push({erpBefore:record.erp??null,erpAfter:row.erp??null,area,configId,goodsId:record.goodsId,name:record.name||row.name,before:record.stockAvailable??null,after:value});record.stockAvailable=value;record.stockUpdatedAt=at;record.stockSource='company-sql';record.erp=row.erp??null;record.erpUnknown=row.erp==null;record.erpUpdatedAt=at;if(configId)configIds.add(configId);};
 for(const r of next.sourceCatalog||[])update(r,'输出源');for(const r of next.costSource||[])update(r,'成本源');for(const c of next.configs||[])if(!c.deletedAt)for(const p of c.parts||[])update(p,'配置',c.id);
 return{next,changes,matched,unmatched,configIds:[...configIds],unknown:rows.filter(r=>r.stockAvailable===null).length,total:rows.length};
}
// commit(callback) is supplied by the server and owns serialization, auth recheck,
// cloud persistence and atomic local persistence. Credentials stay in a separate local vault.
export function createSqlRoutes({json,body,getState,commit,getIdentity,getMember=getIdentity,credentials,reader=readSqlBundle,now=()=>Date.now()}){
 const previews=new Map();const identity=req=>digest(getIdentity(req));
 return async(req,res,url)=>{
  if(!url.pathname.startsWith('/api/sql-sync/'))return false;
  for(const [id,p] of previews)if(p.expiresAt<=now())previews.delete(id);
  const action=url.pathname.slice('/api/sql-sync/'.length);
  if(action==='credentials'&&req.method==='GET'){
   const owner=identity(req),member=getMember(req),saved=credentials?await credentials.read(member):{saved:false,settings:null,password:''};
   if(owner!==identity(req))throw Error('登录身份已变化，请重新打开连接设置');json(res,200,saved);return true;
  }
  if(action==='status'&&req.method==='GET'){json(res,200,{lastSuccess:getState().erpSync?.sqlSync||getState().sqlSync||null});return true;}
  if(req.method!=='POST'){json(res,405,{error:'不支持此操作'});return true;}
  const data=await body(req);
  if(action==='forget'){const owner=identity(req);if(credentials)await credentials.clear(getMember(req));if(owner!==identity(req))throw Error('登录身份已变化');json(res,200,{saved:false});return true;}
  if(action==='preview'){
   const owner=identity(req),settings=sqlSettings(data.settings),scope=digest({server:settings.server.toLowerCase(),port:settings.port,database:settings.database.toLowerCase()});
   const bound=getState().erpSync?.sqlSync?.scope;if(bound&&bound!==scope)throw Error('SQL 数据库与上次同步不同，请连接原服务器和数据库');
   if(credentials){if(data.remember===true)await credentials.save(getMember(req),{settings,password:data.password});else if(data.remember===false)await credentials.clear(getMember(req));}
   if(owner!==identity(req))throw Error('登录身份已变化，请重新读取');
   const bundle=await reader(settings,data.password);data.password='';
   if(owner!==identity(req))throw Error('登录身份已变化，请重新读取');const rows=normalizeSqlBundle(bundle),state=getState();if(state.erpSync?.sqlSync?.scope&&state.erpSync.sqlSync.scope!==scope)throw Error('SQL 来源在读取期间已变化，请重新预览');const plan=sqlStockPlan(state,rows),id=crypto.randomUUID(),expiresAt=now()+10*60*1000;
   // Keep at most one pending preview per login; a new read invalidates old previews.
   for(const [key,p] of previews)if(p.owner===owner)previews.delete(key);
   if(previews.size>=20)previews.delete(previews.keys().next().value);
   previews.set(id,{owner,rows,base:digest(state),expiresAt,scope,operator:String(data.operator||'').slice(0,60)});
   json(res,200,{id,expiresAt,source:{server:settings.server,port:settings.port,database:settings.database},total:plan.total,matched:plan.matched,unmatched:plan.unmatched,unknown:plan.unknown,changes:plan.changes,configIds:plan.configIds});return true;
  }
  if(action==='apply'){
   const pending=previews.get(data.id);if(!pending||pending.applying||pending.expiresAt<=now()||pending.owner!==identity(req))throw Error('预览已失效或正在应用，请重新读取');let result;pending.applying=true;
   try{await commit(async state=>{if(previews.get(data.id)!==pending||pending.expiresAt<=now()||pending.owner!==identity(req)||pending.base!==digest(state))throw Error('登录身份或配置数据已变化，请重新预览');
    const at=new Date(now()).toISOString(),plan=sqlStockPlan(state,pending.rows,at);const summary={updatedAt:at,scope:pending.scope,warehouse:'公司大库',stockField:'分库可销数',costField:'库存成本',total:plan.total,matched:plan.matched,unmatched:plan.unmatched,unknown:plan.unknown};
    // The existing ERP scope is also the shared component key namespace. Preserve
    // it across transport changes; only an unbound workspace gets a SQL scope.
    // Store SQL metadata inside the inventory manifest so it travels through cloud
    // projection. Do not advance the old ERP cost synchronization timestamp.
    plan.next.erpSync={...(state.erpSync||{}),scope:state.erpSync?.scope||'sql:'+pending.scope,stockSource:'company-sql',stockUpdatedAt:at,updatedAt:at,costField:'库存成本',sqlSync:summary};
    plan.next.sqlSync=summary;plan.next.revision=(state.revision||0)+1;plan.next.updatedAt=at;plan.next.logs=[{at,operator:pending.operator,message:`同步 SQL 公司大库库存：${plan.total} 件商品，${plan.changes.length} 处库存变化，更新本机 ERP 成本与可销数，保留人工价`},...(state.logs||[])];result={...summary,configIds:plan.configIds,revision:plan.next.revision};return plan.next;
   });}catch(error){pending.applying=false;throw error;}previews.delete(data.id);json(res,200,{ok:true,...result});return true;
  }
  json(res,404,{error:'未知数据库操作'});return true;
 };
}
