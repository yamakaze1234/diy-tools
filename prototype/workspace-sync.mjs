import {initializeActualParts} from './actual-parts.js';
import {recentActivity} from './activity.js';
import {LOGIN_RETENTION_MS} from './session-retention.js';
import fs from 'node:fs/promises';
import {createWorkspaceAssets} from './workspace-assets.mjs';
import path from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {SyncStore} from './local-store/sync-store.mjs';
import {WorkspaceClient} from './workspace-client.mjs';
import {cloudTransport} from './cloud-transport.mjs';
import {validateWorkspaceRecord} from './workspace-validation.mjs';
import {projectWorkspace,applyWorkspace,changesBetween,migrationSummary,hash} from './workspace-records.mjs';
import {localErpPolicy,migrateLocalErp} from './local-erp-policy.mjs';
import {equal} from '../shared/sync/protocol.mjs';
import {createCloudSchedule,AUTO_SYNC_INTERVAL_MS} from './cloud-schedule.mjs';
export async function createWorkspaceSync({root,local,getState,setState,json,body}){
 let config=null,token=null,member=null,paused=false,lastError=null,sessionCookie=null,sessionEpoch=0,authChanging=false,sessionExpiresAt=0;
 try{const raw=await fs.readFile(path.join(root,'.env.local'),'utf8');config=JSON.parse(raw.split(/\r?\n/).find(l=>l.startsWith('CLOUDBASE_PUBLIC_CONFIG=')).slice('CLOUDBASE_PUBLIC_CONFIG='.length));}catch{}
 const store=new SyncStore(path.join(local,'workspace.sqlite'),{protocolVersion:2,validate:validateWorkspaceRecord,cloudPolicy:localErpPolicy});
 migrateLocalErp(store);
 const csrf=randomUUID(),base=config?`https://${config.envId}.api.tcloudbasegateway.com`:null;
 const transport=config?cloudTransport(config,()=>token):()=>{throw Error('未配置云端环境');};
 const call=async request=>{try{return await transport(request);}catch(e){if(e.code==='UNAUTHENTICATED'){token=null;member=null;}throw e;}};
 const envelope=(action,payload={})=>({protocolVersion:2,action,requestId:randomUUID(),payload});
 const client=new WorkspaceClient(store,call);let job=null,debounce;
 const assets=createWorkspaceAssets({local,base,getToken:()=>token,getWorkspace:()=>store.meta('workspaceId'),store});
 const enabled=()=>!!store.meta('enabled');
 const authenticated=req=>!!token&&Date.now()<sessionExpiresAt&&!!sessionCookie&&(req.headers.cookie||'').split(';').some(value=>value.trim()===`diy_session=${sessionCookie}`);
 const requireLogin=req=>{if(!authenticated(req))throw Object.assign(Error('请先登录成员账号'),{status:401});};
 const status=()=>({...client.status(),enabled:enabled(),signedIn:!!token&&Date.now()<sessionExpiresAt,member,paused,running:!!job,lastError:lastError||client.lastError,autoSyncIntervalMs:AUTO_SYNC_INTERVAL_MS,nextAutoSyncAt:scheduler.next(),configured:!!config,workspaceRevision:getState().revision||0,inventorySources:[{id:'company-sql',name:'公司数据库',configured:true},{id:'browser-script',name:'脚本抓取',configured:true}]});
 async function backup(){const dir=path.join(local,'backups');await fs.mkdir(dir,{recursive:true});const id=new Date().toISOString().replace(/[:.]/g,'-');await fs.writeFile(path.join(dir,`before-sync-${id}.json`),JSON.stringify(getState()));return id;}
 async function materialize(){if(!store.get('workspace_meta','root'))return;
  await setState(current=>{const next=initializeActualParts(applyWorkspace(current,store.list()));const received=recentActivity(store.meta('activity')||[]).filter(r=>r.operator!==member?.memberId);store.setMeta('activity',recentActivity(store.meta('activity')||[]));next.logs=recentActivity([...received,...(current.logs||[])]);if(equal(projectWorkspace(current),projectWorkspace(next))&&equal(current.logs,next.logs))return current;next.revision=current.revision+1;next.updatedAt=new Date().toISOString();store.setMeta('workspaceState',next);return next;});
 }
 const run=(manual=false)=>{if(job)return job;if(!token||Date.now()>=sessionExpiresAt||authChanging||(paused&&!manual)||!enabled())return Promise.resolve();job=(async()=>{try{lastError=null;await assets.uploadAll(getState());const beforeCursor=store.meta('cursor')||0,hadPending=store.status().pending>0;await client.cycle();if(hadPending||(store.meta('cursor')||0)!==beforeCursor||!store.db.prepare("SELECT 1 FROM meta WHERE key='workspaceState'").get())await materialize();}catch(e){lastError=e.message;throw e;}finally{job=null;}})();return job;};
 const scheduler=createCloudSchedule({run,canRun:()=>!!token&&Date.now()<sessionExpiresAt&&!authChanging&&!paused&&enabled(),dueAt:store.meta('nextAutoSyncAt'),onDeadline:value=>store.setMeta('nextAutoSyncAt',value)});
 const schedule=()=>{clearTimeout(debounce);debounce=setTimeout(()=>scheduler.manual().catch(()=>{}),0);debounce.unref();};
 async function persist(before,next,expected=before){if(!enabled())return next;if(!store.get('workspace_meta','root'))throw Error('首次云端数据仍在下载，请稍后编辑');const baseline=structuredClone(expected),edited=new Set(changesBetween(expected,next).filter(c=>c.type==='configuration').map(c=>c.id));for(const c of baseline.configs||[]){const stored=store.get('configuration',c.id);if(edited.has(c.id)&&stored&&!Object.hasOwn(stored.draft,'actualParts'))delete c.actualParts;}const changes=changesBetween(baseline,next);let merged;store.editMany(changes,()=>{merged=initializeActualParts(applyWorkspace(next,store.list()));return merged;});return merged;}
 async function routes(req,res,url){if(!url.pathname.startsWith('/api/workspace-sync/'))return false;const action=url.pathname.slice('/api/workspace-sync/'.length);
  if(action==='config'&&req.method==='GET'){json(res,200,{config,csrf});return true;}
  const header=req.headers['x-diy-sync'];if(typeof header!=='string'||Buffer.byteLength(header)!==Buffer.byteLength(csrf)||!timingSafeEqual(Buffer.from(header),Buffer.from(csrf))){json(res,403,{error:'请从工作台打开同步功能'});return true;}
  try{if(req.method==='GET'){
   if(action==='status'){json(res,200,authenticated(req)?status():{configured:!!config,signedIn:false,enabled:false});return true;}
   requireLogin(req);
   if(action==='preview'){const {records,...preview}=migrationSummary(getState());json(res,200,preview);}
   else if(action==='conflicts')json(res,200,{records:store.list().filter(r=>r.conflict)});
   else json(res,404,{error:'未知同步操作'});
  }else if(req.method==='POST'){const data=await body(req);
   if(!['session','logout'].includes(action))requireLogin(req);
   if(action==='session'){
    if(authChanging)throw Error('正在切换登录状态，请稍后重试');
    if(typeof data.accessToken!=='string'||!data.accessToken||data.accessToken.length>16000)throw Error('登录信息无效');
    const epoch=sessionEpoch;authChanging=true;
    try{const verified=await cloudTransport(config,()=>data.accessToken)(envelope('session.get'));
     if(epoch!==sessionEpoch)throw Error('登录已取消，请重新登录');
     if(!verified.ok||!verified.uid||!verified.workspaceId)throw Error(verified.message||verified.code||'成员身份校验失败');
     if(data.resumeUid&&data.resumeUid!==verified.uid)throw Error('请用原账号重新登录，以保留当前编辑；进入工作台后可切换账号');
     if(token&&member?.uid!==verified.uid)throw Error('请先退出当前账号，再切换账号');
     if(job&&store.meta('uid')!==verified.uid)await job.catch(()=>{});
     if(epoch!==sessionEpoch)throw Error('登录已取消，请重新登录');
     store.switchMember(verified.workspaceId,verified.uid);token=data.accessToken;member=verified;lastError=null;client.lastError=null;
     const until=Number(data.retainedUntil);sessionExpiresAt=Number.isFinite(until)&&until>Date.now()?Math.min(until,Date.now()+LOGIN_RETENTION_MS):Date.now()+LOGIN_RETENTION_MS;
     if(!enabled()&&verified.ready===true&&store.list().length===0&&['configs','templates','sourceCatalog','costSource','caseGallery'].every(k=>!(getState()[k]||[]).length))store.setMeta('enabled',true);
     sessionCookie??=randomUUID();res.setHeader('Set-Cookie',`diy_session=${sessionCookie}; HttpOnly; SameSite=Strict; Path=/`);
     json(res,200,status());if(enabled()&&!store.get('workspace_meta','root'))schedule();
    }finally{if(epoch===sessionEpoch){authChanging=false;scheduler.checkDue();}}
   }
   else if(action==='logout'){
    if(token)requireLogin(req);
    sessionEpoch++;authChanging=true;token=null;member=null;sessionCookie=null;clearTimeout(debounce);
    // Drain the old cycle before another identity may use the shared queue.
    if(job)await job.catch(()=>{});
    authChanging=false;lastError=null;client.lastError=null;res.setHeader('Set-Cookie','diy_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(res,200,{signedIn:false});
   }
   else if(action==='enable'){
    if(!token)throw Error('请先登录');if(enabled())throw Error('此目录已经启用同步');const latest=await call(envelope('session.get'));if(!latest.ok)throw Error(latest.code);
    const summary=migrationSummary(getState());if(data.mode==='publish'&&(latest.ready||summary.hash!==data.previewHash||summary.issues.length))throw Error('预览已变化、存在待处理项，或云端已有数据，请重新预览/选择接收');
    if(data.mode!=='publish'&&data.mode!=='join')throw Error('请选择发布或接收');if(data.mode==='join'&&!latest.ready)throw Error('云端尚未发布初始数据');
    await backup();store.bind(latest.workspaceId,latest.uid);
    if(data.mode==='publish')store.editMany([...summary.records,{type:'workspace_meta',id:'root',data:{format:2,createdAt:new Date().toISOString(),counts:summary.counts}}],getState());
    store.setMeta('enabled',true);json(res,200,status());schedule();
   }else if(action==='run'){if(!token||!enabled())throw Error('请先登录并启用同步');scheduler.manual().catch(()=>{});json(res,200,status());}
   else if(action==='pause'){paused=!!data.paused;json(res,200,status());}
   else if(action==='resolve'){if(!enabled())throw Error('尚未启用同步');store.resolve(data.type,data.id,data.choice);await materialize();json(res,200,status());}
   else if(action==='backup'){json(res,200,store.backup());}
   else json(res,404,{error:'未知同步操作'});
  }else json(res,405,{error:'不支持此操作'});
  }catch(e){json(res,e.status||400,{error:e.message});}return true;
 }
 return {routes,persist,enabled,assets,status,authenticated,requireLogin,store,recovered:()=>enabled()?store.meta('workspaceState'):null,close:()=>{scheduler.close();clearTimeout(debounce);store.close();}};
}
