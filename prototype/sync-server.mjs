import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {SyncStore} from './local-store/sync-store.mjs';
import {SyncClient} from './sync-client.mjs';
import {cloudTransport} from './cloud-transport.mjs';
import {previewMigration} from '../shared/sync/migration-preview.mjs';

export async function createSyncRoutes({root,local,json,body,getState}) {
  let config=null;
  try {const text=await fs.readFile(path.join(root,'.env.local'),'utf8');const line=text.split(/\r?\n/).find(l=>l.startsWith('CLOUDBASE_PUBLIC_CONFIG='));if(line)config=JSON.parse(line.slice('CLOUDBASE_PUBLIC_CONFIG='.length));}catch(e){if(e.code!=='ENOENT')throw e;}
  // This is an isolated validation workspace. The production state.json is never read into its queue.
  const store=new SyncStore(path.join(local,'sync-lab.sqlite'));
  const csrf=randomUUID();let token=null,member=null,offline=false;
  const transport=config?cloudTransport(config,()=>token):async()=>{throw Error('尚未配置 CloudBase');};
  const call=async request=>{try{return await transport(request);}catch(e){if(e.code==='UNAUTHENTICATED'){token=null;member=null;}throw e;}};
  const client=new SyncClient(store,request=>{if(offline)throw Error('已暂停同步，可继续编辑本地草稿');return call(request);});
  let debounce;
  const run=async()=>{if(!token||offline)return;try{await client.cycle();}catch{/* Error retained in client.status for the UI; do not log tokens. */}};
  const timer=setInterval(run,30000);timer.unref();
  const schedule=()=>{clearTimeout(debounce);debounce=setTimeout(run,2500);debounce.unref();};
  const status=()=>({...client.status(),signedIn:!!token,member,offline,configured:!!config});
  return async(req,res,url)=>{
    if(!url.pathname.startsWith('/api/cloud-sync/'))return false;
    const action=url.pathname.slice('/api/cloud-sync/'.length);
    if(action==='config'&&req.method==='GET'){json(res,200,{config,csrf});return true;}
    const header=req.headers['x-diy-sync'];
    if(typeof header!=='string'||Buffer.byteLength(header)!==Buffer.byteLength(csrf)||!timingSafeEqual(Buffer.from(header),Buffer.from(csrf))){json(res,403,{error:'请从工作台打开同步页面'});return true;}
    try{
      if(req.method==='GET'){
        if(action==='status')json(res,200,status());
        else if(action==='migration-preview'){const {records,...preview}=previewMigration(getState());json(res,200,preview);}
        else if(action==='records')json(res,200,{records:store.list(),status:status()});
        else json(res,404,{error:'未知同步操作'});
      }else if(req.method==='POST'){
        const data=await body(req);
        if(action==='session'){
          if(typeof data.accessToken!=='string'||data.accessToken.length>16000)throw Error('登录信息无效');
          if(client.running)throw Error('正在同步，请稍后重试登录');
          const pending=cloudTransport(config,()=>data.accessToken);
          const verified=await pending({protocolVersion:1,action:'session.get',requestId:randomUUID(),payload:{}});
          if(!verified.ok)throw Error(verified.message||verified.code||'成员身份校验失败');
          store.bind(verified.workspaceId,verified.uid);token=data.accessToken;member=verified;json(res,200,status());schedule();
        }else if(action==='logout'){token=null;member=null;json(res,200,status());}
        else if(action==='run'){if(!token)throw Error('请先登录成员账号');await client.cycle();json(res,200,status());}
        else if(action==='pause'){offline=!!data.paused;if(!offline)schedule();json(res,200,status());}
        else if(action==='edit'){if(!store.meta('workspaceId'))throw Error('请先登录并绑定验证工作区');store.edit(data.type,data.id,data.data,data.expectedDraft);json(res,200,status());schedule();}
        else if(action==='resolve'){store.resolve(data.type,data.id,data.choice);json(res,200,status());schedule();}
        else if(action==='backup'){json(res,200,store.backup());}
        else if(action==='history'){const result=await call({protocolVersion:1,action:'records.history',requestId:randomUUID(),payload:{entityType:data.type,entityId:data.id}});json(res,result.ok?200:400,result);}
        else json(res,404,{error:'未知同步操作'});
      }else json(res,405,{error:'不支持此操作'});
    }catch(e){json(res,400,{error:e.message,status:status()});}
    return true;
  };
}
