import cloudbase from '../prototype/vendor/cloudbase.js';
import {cloudTransport} from '../prototype/cloud-transport.mjs';
import {emptySync,envelope,syncCycle,pending,resolve} from './cloud-sync.mjs';
import {openCloudStorage} from './cloud-storage.mjs';
import {materialize,stageChanges} from './cloud-adapter.mjs';
// Injected by build.mjs from a whitelist of public configuration fields only.
const config=__WEB_LITE_CLOUD_CONFIG__;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=v=>structuredClone(v);
const root=document.querySelector('#app');
let auth,member,runtime,activeToken,api,busy=false,sessionInvalid=false,storageResources;
function loginScreen(message='使用本地工作台已开通的成员账号。首次登录只拉取云端数据。'){
 root.innerHTML=`<main class="panel" style="max-width:480px;margin:12vh auto;padding:32px"><h1>登录云端工作区</h1><p>配置工作台 · 轻量网页版</p><div class="notice-box">${esc(message)}</div><form id="cloud-login"><label class="block-label">成员账号<input name="username" autocomplete="username" required></label><label class="block-label">密码<input name="password" type="password" autocomplete="current-password" required></label><p id="login-error" role="alert"></p><button class="primary" type="submit">登录并拉取工作区</button></form><p class="muted">账号由工作台管理员开通。忘记密码请联系管理员。</p><a href="./index.html">返回示例原型</a></main>`;
 document.querySelector('#cloud-login').onsubmit=async e=>{e.preventDefault();const form=e.target,button=form.querySelector('button'),message=document.querySelector('#login-error');button.disabled=true;
  try{if(!auth)throw Error('云端登录尚未就绪，请刷新');const {error}=await auth.signInWithPassword({username:form.elements.username.value.trim(),password:form.elements.password.value});form.elements.password.value='';if(error)throw error;await start();}
  catch(error){message.textContent=error.message;button.disabled=false;}
 };
}
async function call(request){
 if(sessionInvalid)throw Error('登录已失效，请重新登录');
 const {data,error}=await auth.getSession();if(error)throw error;
 if(!data?.session||data.session.user?.is_anonymous)throw Error('请使用正式成员账号登录');
 if(member&&data.session.user?.id&&data.session.user.id!==member.uid)throw Error('登录账号已变化，请刷新后重试');
 activeToken=data.session.access_token;
 const response=await cloudTransport(config,()=>activeToken)(request);
 if(!response.ok)throw Object.assign(Error(response.message||response.code||'云端请求失败'),{code:response.code});
 return response;
}
// CONFLICT is a valid sync receipt, not a transport failure.
async function syncCall(request){
 if(request.action!=='sync.push')return call(request);
 const {data,error}=await auth.getSession();if(error)throw error;
 if(sessionInvalid||!data?.session||data.session.user?.is_anonymous)throw Error('登录已失效，请重新登录');
 if(data.session.user?.id&&data.session.user.id!==member.uid)throw Error('登录账号已变化');
 return cloudTransport(config,()=>data.session.access_token)(request);
}
async function start(){
 storageResources?.channel.close();storageResources?.storage.close();
 sessionInvalid=false;member=null;member=await call(envelope('session.get'));
 if(!member.uid||!member.workspaceId||!member.ready)throw Error('云端工作区尚未发布，请先在本地工作台完成初始化');
 const key='diy-web-lite-cloud-v1:'+config.envId+':'+member.workspaceId+':'+member.uid;
 const storage=await openCloudStorage();let cached=await storage.get(key);
 if(!cached){try{const raw=localStorage.getItem(key);cached=raw?JSON.parse(raw):null;}catch{throw Error('旧缓存无法读取，原缓存已保留，请备份后处理');}
  if(cached){cached.revision=(cached.revision||0)+1;await storage.put(key,cached,0);}
 }
 if(cached&&(cached.cloudSync?.uid!==member.uid||cached.cloudSync?.workspaceId!==member.workspaceId||!Array.isArray(cached.cloudSync.records)||!Array.isArray(cached.configs)||!cached.drafts))throw Error('云端缓存格式不兼容，未覆盖原数据');
 let snapshot=cached||materialize(emptySync(member));
 let queue=Promise.resolve(),storageFailure=null,labelCache;const channel=new BroadcastChannel('diy-web-lite-cloud-changes');storageResources={storage,channel};
 channel.onmessage=event=>{if(event.data?.key===key&&event.data.revision!==snapshot.revision){storageFailure=Error('另一窗口已修改工作区，请导出当前副本后刷新');api?.storageFailed(storageFailure);}};
 const flush=()=>queue;
 const write=next=>{labelCache=undefined;
  if(storageFailure)throw storageFailure;
  const expected=snapshot.revision||0;next.revision=expected+1;const saved=copy(next);snapshot=saved;
  queue=queue.then(()=>storage.put(key,saved,expected)).then(()=>channel.postMessage({key,revision:saved.revision}));
  queue.catch(error=>{storageFailure=error;api?.storageFailed(error);});return queue;
 };
 const writeDrafts=next=>{
  if(storageFailure)throw storageFailure;
  if(busy||sessionInvalid)throw Error(busy?'同步进行中，请稍后编辑':'登录已失效，请重新登录');
  const expected=snapshot.revision||0;next.revision=expected+1;
  const saved={revision:next.revision,drafts:copy(next.drafts)};
  snapshot={...snapshot,...saved};
  queue=queue.then(()=>storage.putDrafts(key,saved,expected)).then(()=>channel.postMessage({key,revision:saved.revision}));
  queue.catch(error=>{storageFailure=error;api?.storageFailed(error);});return queue;
 };
 const save=async sync=>{const next=copy(api?api.getState():snapshot);next.cloudSync=sync;await write(next);if(api)api.replace(next);};
 if(!cached?.cloudSync?.ready){document.querySelector('#login-error').textContent='正在拉取云端输出源、配置和核算价格…';await syncCycle({getSync:()=>snapshot.cloudSync,save,call:syncCall,upload:false});snapshot.cloudSync.ready=true;await write(materialize(snapshot.cloudSync,snapshot));}
 runtime={key,initial:snapshot,member,config,busy:false,write,writeDrafts,flush,
  prepare(next){if(busy||sessionInvalid)throw Error(busy?'同步进行中，请稍后编辑':'登录已失效，请重新登录');stageChanges(snapshot,next);},
  accepted(){labelCache=undefined;},
  attach(value){api=value;},
  label(){if(labelCache!==undefined)return labelCache;const s=(api?api.getState():snapshot).cloudSync;const count=pending(s).length;return labelCache=s.records.some(r=>r.conflict)?'有同步冲突':s.outbox?'提交待确认':count?`待同步 ${count} 项`:'云端工作区';},
  async inventory(action,data){
   if(location.hostname!=='127.0.0.1')throw Error('SQL 连接只在本机运行：请启动本地连接程序并打开 http://127.0.0.1:4196/cloud.html，账号密码不会发送到静态托管站点');
   if(sessionInvalid)throw Error('登录已失效，请重新登录');const {data:sessionData,error}=await auth.getSession();if(error)throw error;
   if(!sessionData?.session||sessionData.session.user?.id!==member.uid)throw Error('成员登录已变化，请重新登录');
   const response=await fetch('/api/inventory/'+action,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+sessionData.session.access_token,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(action==='sql-preview'?90000:35000)});
   let result;try{result=await response.json();}catch{throw Error('SQL 需通过本机连接程序使用，请启动本地服务并打开它提供的云端工作区地址');}if(!response.ok)throw Error(result.error||'库存服务不可用');return result;
  },
  open(){panel();},
  actions(action,data){if(!action.startsWith('cloud-'))return false;if(action==='cloud-now'){void synchronize();return true;}if(action==='cloud-logout'){void logout();return true;}if(action==='cloud-conflict'){conflictPanel(Number(data.index));return true;}if(action==='cloud-panel'){panel();return true;}return false;}
 };
 globalThis.webLiteCloud=runtime;
 await import('./app.mjs');
}
function panel(){const s=api.getState().cloudSync,conflicts=s.records.filter(r=>r.conflict);
 api.openModal('云端同步',`<div class="notice-box">${esc(member.name||member.memberId)} · ${esc(runtime.label())}</div><p>网页保存后点击「立即同步」，本地工作台也完成一次同步，即可互相接收修改。</p><p>待提交 ${pending(s).length} 项 · 冲突 ${conflicts.length} 项 · ${s.lastSyncedAt?'上次同步 '+esc(new Date(s.lastSyncedAt).toLocaleString()):'尚未同步'}</p><p class="muted">输出源、已保存配置、模板、核算价与优惠券使用现有工作台记录。ERP 库存和 ERP 成本仍由各端独立读取。</p>${conflicts.map((r,i)=>`<p>${esc(r.draft.name||r.id)} <button type="button" data-action="cloud-conflict" data-index="${i}">比较冲突版本</button></p>`).join('')}<p id="cloud-progress" role="status"></p>`,`<button type="button" data-action="cloud-logout">退出登录</button><button type="button" class="primary" data-action="cloud-now">立即同步</button>`);
}
async function synchronize(){if(busy)return;const message=document.querySelector('#cloud-progress');
 try{await runtime.flush();if(Object.keys(api.getState().drafts).length)throw Error('请先保存或撤销配置草稿，再执行云端同步');busy=true;runtime.busy=true;
  await syncCycle({getSync:()=>api.getState().cloudSync,save:async sync=>{const next=copy(api.getState());next.cloudSync=sync;await api.persistCloud(next);runtime.accepted(next);},call:syncCall,onProgress:text=>{if(message)message.textContent=text;}});
  const next=materialize(api.getState().cloudSync,api.getState());await api.persistCloud(next);runtime.accepted(next);api.replace(next);panel();api.toast(next.cloudSync.records.some(r=>r.conflict)?'发现冲突，请比较后选择保留版本':'已完成云端同步');
 }catch(error){if(message)message.textContent=error.message;api.toast(error.message);}
 finally{busy=false;runtime.busy=false;}
}
function conflictPanel(index){const r=api.getState().cloudSync.records.filter(r=>r.conflict)[index];if(!r)return panel();const version=copy(r.conflict);
 api.openModal('比较同步冲突',`<p>记录：${esc(r.draft.name||r.id)}。双方修改了：${esc(r.conflict.fields.join('、'))}</p><div class="form-grid two"><div><h3>浏览器版本</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto">${esc(JSON.stringify(r.draft,null,2))}</pre></div><div><h3>云端版本</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto">${esc(JSON.stringify(r.conflict.remote.data,null,2))}</pre></div></div><label class="block-label">保留哪个版本<select name="choice"><option value="remote">采用云端版本</option><option value="local">保留浏览器版本，下次同步提交</option></select></label>`,`<button class="primary" type="submit">确认保留版本</button>`,async form=>{await runtime.flush();if(busy)throw Error('请等待同步结束');if(Object.keys(api.getState().drafts).length)throw Error('请先处理配置草稿');const next=copy(api.getState()),current=next.cloudSync.records.find(x=>x.type===r.type&&x.id===r.id);if(JSON.stringify(current.conflict)!==JSON.stringify(version))throw Error('冲突已变化，请重新比较');resolve(next.cloudSync,r.type,r.id,form.elements.choice.value);const materialized=materialize(next.cloudSync,next);await api.persistCloud(materialized);runtime.accepted(materialized);api.replace(materialized);panel();});
}
async function logout(){if(busy)return;try{await runtime.flush();}catch(error){api.toast(error.message);return;}busy=true;runtime.busy=true;sessionInvalid=true;activeToken=null;
 try{const {error}=await auth.signOut();if(error)throw error;location.reload();}catch(error){document.querySelector('#modal')?.close();root.innerHTML=`<div class="notice-box">本页面已锁定。退出登录请求失败：${esc(error.message)}。请刷新后重新登录。</div>`;}finally{busy=false;runtime.busy=false;}}
async function boot(){loginScreen();if(!config){document.querySelector('#login-error').textContent='尚未配置云端环境，请重新构建云端版';return;}if(location.protocol==='file:'){document.querySelector('#login-error').textContent='云端版请通过 HTTP / HTTPS 网页地址打开';return;}
 auth=cloudbase.init({...config,env:config.envId,persistence:'session',auth:{detectSessionInUrl:false}}).auth;
 auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'&&runtime&&!busy){sessionInvalid=true;document.querySelector('#modal')?.close();root.innerHTML='<div class="notice-box">登录已失效，编辑已保留。请刷新并用原账号重新登录。</div>';}});
}
boot().catch(error=>{document.querySelector('#login-error').textContent=error.message;});
