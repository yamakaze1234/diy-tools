import {validateConfigCapacity} from './config-capacity.js';
import {recentActivity,activityEntry} from './activity.js';
import {VersionHistory} from './version-history.mjs';
import {createSqlRoutes} from './sql-sync.mjs';
import {createSqlCredentials} from './sql-credentials.mjs';
import {changesBetween} from './workspace-records.mjs';
import {validateAddon,sourceAddon} from './addon-data.js';
import os from 'node:os';
import {createWorkspaceSync} from './workspace-sync.mjs';
import {createSyncRoutes} from './sync-server.mjs';
import {validateGallery} from './case-gallery-data.js';
import {ErpJobs,validateSnapshot,mergeErp,browserErpScope} from './erp-sync.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {normalizeWorkspaceState,shops} from './shops.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const local=process.env.DATA_DIR?path.resolve(process.env.DATA_DIR):path.join(root,'.local');
await fs.mkdir(path.join(local,'images'),{recursive:true});
await fs.mkdir(path.join(local,'assets'),{recursive:true});
const stateFile=path.join(local,'state.json');
const baseCatalog=JSON.parse(await fs.readFile(path.join(root,'catalog.json'),'utf8'));
let state;try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state=JSON.parse(await fs.readFile(path.join(root,'seed.json'),'utf8'));}
const stateBeforeMigration=JSON.stringify(state,null,2);state=normalizeWorkspaceState(state,baseCatalog);
if(JSON.stringify(state,null,2)!==stateBeforeMigration){const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14),backup=path.join(local,`before-multishop-migration-${stamp}.json`),tmp=stateFile+'.migration.tmp';await fs.writeFile(backup,stateBeforeMigration);await fs.writeFile(tmp,JSON.stringify(state,null,2));await fs.rename(tmp,stateFile);}
const erpJobs=new ErpJobs(()=>browserErpScope(state.erpSync));
const session={id:crypto.randomUUID(),startedAt:new Date().toISOString(),defaultOperator:os.userInfo().username};
const actor=value=>String(value||session.defaultOperator).trim().slice(0,60)||session.defaultOperator;
let queue=Promise.resolve();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){const maximumMb=['/api/state','/api/recovery-draft'].includes(req.url.split('?')[0])?256:40;let size=0,buf=[];for await(const chunk of req){size+=chunk.length;if(size>maximumMb*1024*1024)throw Error(`文件过大（最大 ${maximumMb}MB）`);buf.push(chunk);}return JSON.parse(Buffer.concat(buf).toString());}
async function atomic(file,data){const tmp=file+'.tmp';await fs.writeFile(tmp,data);await fs.rename(tmp,file);}
const history=new VersionHistory(path.join(local,'versions.sqlite'));
const historyScope=()=>workspaceSync.store.meta('workspaceId')||'local';
async function saveVersion(next,reason){history.record(state,historyScope(),'修改前自动备份');await atomic(stateFile,JSON.stringify(next,null,2));state=next;history.record(state,historyScope(),reason);}
function allowedOrigin(req){const origin=req.headers.origin;return !origin||origin===`http://${req.headers.host}`;}
const workspaceSync=await createWorkspaceSync({root,local,getState:()=>state,setState:fn=>{const task=queue.catch(()=>{}).then(async()=>{const next=fn(state);if(next!==state)await saveVersion(next,'接收云端更新');});queue=task;return task;},json,body});
if(workspaceSync.recovered())state=workspaceSync.recovered();
state.logs=recentActivity(state.logs);await atomic(stateFile,JSON.stringify(state,null,2));
history.record(state,historyScope(),'启动工作台');
const sqlRoutes=createSqlRoutes({json,body,getState:()=>state,credentials:createSqlCredentials({local}),getMember:req=>{workspaceSync.requireLogin(req);const member=workspaceSync.status().member;return JSON.stringify([member.workspaceId,member.uid]);},getIdentity:req=>{workspaceSync.requireLogin(req);return req.headers.cookie;},commit:fn=>{const task=queue.catch(()=>{}).then(async()=>{let next=await fn(state);next=await workspaceSync.persist(state,next);await saveVersion(next,'应用 SQL 库存');});queue=task;return task;}});
const pruneActivity=()=>{queue=queue.catch(()=>{}).then(async()=>{const logs=recentActivity(state.logs);if(JSON.stringify(logs)!==JSON.stringify(state.logs)){state={...state,logs};await atomic(stateFile,JSON.stringify(state,null,2));}workspaceSync.store.setMeta('activity',recentActivity(workspaceSync.store.meta('activity')||[]));const cached=workspaceSync.store.meta('workspaceState');if(cached)workspaceSync.store.setMeta('workspaceState',{...cached,logs:recentActivity(cached.logs)});});return queue;};
await pruneActivity();const activityTimer=setInterval(()=>pruneActivity().catch(()=>{}),60*60*1000);activityTimer.unref();
const syncRoutes=await createSyncRoutes({root,local,json,body,getState:()=>state});
const server=http.createServer(async(req,res)=>{
 try{
  if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||''))return json(res,403,{error:'仅允许本机访问'});
  const url=new URL(req.url,'http://localhost');
  const isCollector=url.pathname.startsWith('/api/erp-bridge/');
  if(isCollector&&req.headers.origin==='https://cqzs.3cerp.com'){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');}
  if(isCollector&&req.method==='OPTIONS'){if(req.headers.origin!=='https://cqzs.3cerp.com')return json(res,403,{error:'来源不匹配'});res.setHeader('Access-Control-Allow-Headers','Content-Type, X-DIY-Collector');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.writeHead(204);return res.end();}
  if(req.method==='POST'&&!isCollector&&!allowedOrigin(req))return json(res,403,{error:'来源不匹配'});
  if(await workspaceSync.routes(req,res,url))return;
  // Business data and mutations require the local session issued after cloud verification.
  const decodedPath=decodeURIComponent(url.pathname).toLowerCase();
  const protectedPath=decodedPath.startsWith('/api/')||decodedPath.startsWith('/uploads/')||decodedPath.startsWith('/saved/')||decodedPath.endsWith('.json');
  if(protectedPath){if(isCollector){if(!workspaceSync.status().signedIn)return json(res,401,{error:'请先登录工作台成员账号'});}else workspaceSync.requireLogin(req);}
  if(await syncRoutes(req,res,url))return;
  if(await sqlRoutes(req,res,url))return;
  if(url.pathname==='/api/versions'&&req.method==='GET')return json(res,200,{versions:history.list(historyScope())});
  if(url.pathname==='/api/versions/preview'&&req.method==='POST'){const data=await body(req);return json(res,200,history.preview(data.id,historyScope(),state));}
  if(url.pathname==='/api/versions/restore'&&req.method==='POST'){
   const data=await body(req);queue=queue.catch(()=>{}).then(async()=>{
    workspaceSync.requireLogin(req);const status=workspaceSync.status();if(status.running||status.conflicts||status.uncertain)throw Error('请等待同步结束并处理冲突或未确认提交，再还原版本');
    const preview=history.preview(data.id,historyScope(),state);if(data.baseRevision!==state.revision||data.hash!==preview.hash)throw Error('当前数据或历史版本已变化，请重新预览');
    const saved=history.get(data.id,historyScope()).state,at=new Date().toISOString();let next=normalizeWorkspaceState({...saved,revision:state.revision+1,updatedAt:at,logs:[{at,operator:status.member?.name||session.defaultOperator,message:`还原历史版本 ${preview.revision}`},...(state.logs||[])]},baseCatalog);
    next=await workspaceSync.persist(state,next);await saveVersion(next,`还原自版本 ${preview.revision}`);json(res,200,{revision:state.revision});
   });await queue;return;
  }
  if(url.pathname.startsWith('/uploads/')&&workspaceSync.enabled()&&req.method==='GET'){const bytes=await workspaceSync.assets.download(url.pathname);res.writeHead(200,{'Content-Type':url.pathname.endsWith('.png')?'image/png':'image/jpeg','Cache-Control':'private, max-age=86400'});res.end(bytes);return;}
  if(url.pathname==='/api/session'&&req.method==='GET')return json(res,200,session);
  if(url.pathname==='/api/erp-sync/status'&&req.method==='GET')return json(res,200,{...erpJobs.status(),lastSuccess:state.erpSync||null});
  if(url.pathname==='/api/erp-sync/start'&&req.method==='POST'){const data=await body(req),previous=erpJobs.job;const result=erpJobs.start();if(erpJobs.job!==previous)erpJobs.job.operator=actor(data.operator);return json(res,200,{...result,lastSuccess:state.erpSync||null});}
  if(isCollector){
   if(req.method!=='POST'||req.headers['x-diy-collector']!=='workbench-erp-v1'||req.headers.origin&&req.headers.origin!=='https://cqzs.3cerp.com')return json(res,403,{error:'仅接受 ERP 采集脚本'});
   const data=await body(req);
   if(url.pathname==='/api/erp-bridge/poll')return json(res,200,erpJobs.poll(data));
   if(url.pathname==='/api/erp-bridge/progress')return json(res,200,erpJobs.progress(data));
   if(url.pathname==='/api/erp-bridge/error')return json(res,200,erpJobs.fail(data));
   if(url.pathname==='/api/erp-bridge/snapshot'){
    queue=queue.catch(()=>{}).then(async()=>{const job=erpJobs.verify(data);const rows=validateSnapshot(data);const at=new Date().toISOString();const merged=mergeErp(state,rows,baseCatalog,at);merged.next.revision=state.revision+1;merged.next.updatedAt=at;merged.next.erpSync={...(state.erpSync||{}),scope:state.erpSync?.scope||job.scope,browserScope:job.scope,stockSource:'browser-script',stockUpdatedAt:at,account:data.account,warehouse:data.warehouse,depotId:data.depotId,updatedAt:at,total:rows.length,excluded:merged.excluded,matched:merged.matched,unmatched:merged.unmatched,costField:data.costField};merged.next.logs=[{at,operator:job.operator||session.defaultOperator,message:`同步库存与 ERP 成本：${rows.length} 条，自动排除 ${merged.excluded} 条带星号配件，匹配 ${merged.matched} 条输出源`},...(state.logs||[])];merged.next.logs=recentActivity(merged.next.logs);merged.next=await workspaceSync.persist(state,merged.next);await saveVersion(merged.next,'应用 ERP 库存与成本');job.status='complete';job.completedAt=at;job.result={...state.erpSync,configIds:merged.configIds,revision:state.revision};json(res,200,{ok:true,revision:state.revision});});await queue;return;
   }return json(res,404,{error:'未知采集操作'});
  }
  if(url.pathname==='/api/state'&&req.method==='GET')return json(res,200,{...state,logs:recentActivity(state.logs)});
  if(url.pathname==='/api/state'&&req.method==='POST'){
   const incoming=await body(req);
   queue=queue.catch(()=>{}).then(async()=>{
    workspaceSync.requireLogin(req);
    if(incoming.baseRevision!==state.revision&&!(workspaceSync.enabled()&&incoming.baseState))return json(res,409,{error:'其他页面已经保存更新，请先下载当前草稿，再重新载入。',revision:state.revision});
    if(!Array.isArray(incoming.configs)||(!incoming.configs.length&&state.configs.length>0)||!Array.isArray(incoming.templates))return json(res,400,{error:'配置数据格式不正确'});
    validateConfigCapacity(incoming.configs);
    if(incoming.caseGallery!==undefined){try{validateGallery(incoming.caseGallery);}catch(error){return json(res,400,{error:error.message});}}
    const shopIds=new Set(shops.map(shop=>shop.id));
    if(incoming.sourceCatalog!==undefined&&(!Array.isArray(incoming.sourceCatalog)||incoming.sourceCatalog.length>30000||incoming.sourceCatalog.some(r=>!r||typeof r.sourceId!=='string'||!shopIds.has(r.shopId)||typeof r.goodsId!=='string'||typeof r.name!=='string'||(r.tax!==null&&(!Number.isFinite(r.tax)||r.tax<0)))||new Set(incoming.sourceCatalog.map(r=>r.sourceId)).size!==incoming.sourceCatalog.length))return json(res,400,{error:'输出源格式不正确'});
    if(incoming.costSource!==undefined&&(!Array.isArray(incoming.costSource)||incoming.costSource.length>100000||incoming.costSource.some(r=>!r||typeof r.goodsId!=='string'||!/^\d{1,20}$/.test(r.goodsId)||r.tax!==null&&(!Number.isFinite(r.tax)||r.tax<0))||new Set(incoming.costSource.map(r=>r.goodsId)).size!==incoming.costSource.length))return json(res,400,{error:'成本源格式不正确'});
    if(incoming.shopSettings!==undefined&&(!incoming.shopSettings||typeof incoming.shopSettings!=='object'||Array.isArray(incoming.shopSettings)||shops.some(shop=>!incoming.shopSettings[shop.id]||!Number.isFinite(incoming.shopSettings[shop.id].coupon)||incoming.shopSettings[shop.id].coupon<0)))return json(res,400,{error:'店铺优惠券金额无效'});
    if(incoming.configs.some(c=>!shopIds.has(c.shopId)))return json(res,400,{error:'配置店铺归属无效'});
    if(incoming.configs.some(c=>c.installment!==undefined&&![0,12,24].includes(c.installment)))return json(res,400,{error:'分期期数无效'});
    try{for(const c of incoming.configs){if(!Array.isArray(c.addons))throw Error('加购列表格式无效');for(const a of c.addons)validateAddon(a);}for(const r of incoming.sourceCatalog||[])validateAddon(sourceAddon(r));}catch(e){return json(res,400,{error:e.message});}
    const existing=new Map(state.configs.map(c=>[c.id,c]));
    for(const c of incoming.configs){if(c.deletedAt){c.deletionSessionId=existing.get(c.id)?.deletedAt?existing.get(c.id).deletionSessionId:session.id;}else delete c.deletionSessionId;}
    let next=normalizeWorkspaceState({...state,...(incoming.caseGallery!==undefined?{caseGallery:incoming.caseGallery}:{}),...(incoming.shopSettings!==undefined?{shopSettings:incoming.shopSettings}:{}),...(incoming.costSource!==undefined?{costSource:incoming.costSource}:{}),...(incoming.sourceCatalog!==undefined?{sourceCatalog:incoming.sourceCatalog}:{}),configs:incoming.configs,templates:incoming.templates,revision:state.revision+1,updatedAt:new Date().toISOString(),logs:[{at:new Date().toISOString(),operator:actor(incoming.operator),message:String(incoming.message||'保存配置').slice(0,160)},...(state.logs||[])]},baseCatalog);
    const activity=changesBetween(state,next).map(r=>activityEntry(r.type,r.id,r.expectedDraft,r.data,{operator:workspaceSync.status().member?.name||actor(incoming.operator),message:String(incoming.message||'保存配置').slice(0,160)})).filter(Boolean);next.logs=recentActivity([...activity,...(state.logs||[])]);
    next=await workspaceSync.persist(state,next,incoming.baseState||state);await saveVersion(next,String(incoming.message||'保存配置').slice(0,160));json(res,200,{revision:state.revision,updatedAt:state.updatedAt,logs:state.logs,...(workspaceSync.enabled()?{state}:{} )});
   });await queue;return;
  }
  if(url.pathname==='/api/image'&&req.method==='POST'){
   const data=await body(req);if(!state.configs.some(c=>c.id===data.id)||data.revision!==state.revision)return json(res,409,{error:'配置版本已变化，请重新生成图片'});
   if(!['long','square'].includes(data.layout)||!['light','dark'].includes(data.theme))return json(res,400,{error:'未知版式'});
   const buf=Buffer.from(data.png||'','base64');if(buf.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')return json(res,400,{error:'不是 PNG 图片'});
   const config=state.configs.find(c=>c.id===data.id),safeId=String(data.id).replace(/[^a-zA-Z0-9_-]/g,'_'),safeShop=String(config?.shopId||'intel').replace(/[^a-zA-Z0-9_-]/g,'_');const name=`${safeShop}_${safeId}_r${data.revision}_${data.layout}_${data.theme}.png`;
   await fs.writeFile(path.join(local,'images',name),buf);return json(res,200,{url:'/saved/'+name,revision:data.revision,width:buf.readUInt32BE(16),height:buf.readUInt32BE(20)});
  }
  if(url.pathname==='/api/asset'&&req.method==='POST'){
   const data=await body(req),buf=Buffer.from(data.base64||'','base64');let ext;
   if(buf.subarray(0,8).toString('hex')==='89504e470d0a1a0a')ext='png';else if(buf[0]===255&&buf[1]===216)ext='jpg';else return json(res,400,{error:'请选择 PNG 或 JPG 图片'});
   const name=crypto.createHash('sha256').update(buf).digest('hex')+'.'+ext;await fs.writeFile(path.join(local,'assets',name),buf);return json(res,200,{url:'/uploads/'+name});
  }
  if(req.method!=='GET')return json(res,405,{error:'不支持此操作'});
  let base=root,relative=decodeURIComponent(url.pathname).replace(/^\//,'');
  if(relative.startsWith('saved/')){base=path.join(local,'images');relative=relative.slice(6);}else if(relative.startsWith('uploads/')){base=path.join(local,'assets');relative=relative.slice(8);}else if(!relative)relative='index.html';
  if(relative.split('/').some(p=>p.startsWith('.'))||relative.includes('\\'))return json(res,403,{error:'路径不可访问'});
  const file=path.resolve(base,relative);if(!file.startsWith(base+path.sep))return json(res,403,{error:'路径不可访问'});
  const ext=path.extname(file);const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'}[ext];
  if(!mime)return json(res,404,{error:'文件不存在'});
  let data=await fs.readFile(file);if(relative==='workbench-erp.user.js')data=Buffer.from(data.toString('utf8').replaceAll('http://127.0.0.1:4178/api/erp-bridge/',`http://127.0.0.1:${server.address().port}/api/erp-bridge/`));res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);
 }catch(e){json(res,e.code==='ENOENT'?404:e.status||500,{error:e.code==='ENOENT'?'文件不存在':e.message});}
});
export const serverHandle=server;
export const ready=new Promise((resolve,reject)=>{let fallback=false;const onError=error=>{if(error.code==='EADDRINUSE'&&process.env.WORKBENCH_PORT_FALLBACK==='1'&&!fallback){fallback=true;server.listen(0,'127.0.0.1');}else reject(error);};server.on('error',onError);server.once('listening',()=>{server.removeListener('error',onError);const actualPort=server.address().port;console.log(`DIY 配置工作台 http://127.0.0.1:${actualPort}`);resolve(actualPort);});server.listen(Number(process.env.PORT||4178),'127.0.0.1');});
export const closeServer=()=>new Promise(resolve=>server.close(()=>{clearInterval(activityTimer);workspaceSync.close();history.close();resolve();}));
