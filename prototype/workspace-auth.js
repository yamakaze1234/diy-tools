import cloudbase from './vendor/cloudbase.js';
import {loginRetention,LOGIN_RETENTION_MS} from './session-retention.js';
const retention=loginRetention();

let contextPromise, leaving=false,lockPromise=null,currentUid=null,signingIn=false,authEpoch=0;
export function workspaceAuth(){
 return contextPromise??=(async()=>{
  const response=await fetch('/api/workspace-sync/config'),config=await response.json();
  if(!response.ok||!config.config)throw Error('未配置云端登录，请联系管理员');
  const auth=cloudbase.init({...config.config,env:config.config.envId,persistence:'local',auth:{detectSessionInUrl:false}}).auth;
  const api=async(action,data)=>{
   const response=await fetch('/api/workspace-sync/'+action,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-DIY-Sync':config.csrf},...(data===undefined?{}:{body:JSON.stringify(data)})});
   const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'登录操作失败'),{status:response.status});return result;
  };
  let sessionQueue=Promise.resolve();
  const establishSession=data=>{
   const epoch=authEpoch;
   const result=sessionQueue.catch(()=>{}).then(()=>{
    if(leaving||epoch!==authEpoch)throw Error('登录已取消');
    return api('session',{retainedUntil:retention.until(),...data});
   });
   sessionQueue=result;return result;
  };
  auth.onAuthStateChange((event,session)=>{
   // Some SDK versions emit TOKEN_REFRESHED during password sign-in/getSession.
   // The explicit login owns that handshake; only an established login renews here.
   if(event==='TOKEN_REFRESHED'&&session&&currentUid&&!signingIn&&!leaving&&retention.valid())establishSession({accessToken:session.access_token}).catch(error=>{
    if(!leaving&&!signingIn)window.dispatchEvent(new CustomEvent('workspace-auth-error',{detail:error.message}));
   });
  });
  return {auth,api,establishSession};
 })();
}

export async function leaveWorkspace(){
 const {auth,api}=await workspaceAuth();leaving=true;authEpoch++;
 try{
  await api('logout',{});
  retention.clear();
  // Clear the in-memory SDK session even if its remote sign-out endpoint is offline.
  try{const {error}=await auth.signOut();if(error)sessionStorage.setItem('diy-login-notice','本机已退出。云端退出请求未完成，请重新登录。');}
  catch{sessionStorage.setItem('diy-login-notice','本机已退出，请重新登录。');}
  location.reload();
 }catch(error){leaving=false;throw error;}
}

export function lockWorkspace(){
 if(leaving)return Promise.resolve();
 if(lockPromise)return lockPromise;
 document.querySelector('#dialog')?.close();
 document.body.classList.add('login-required');
 lockPromise=requireWorkspaceLogin({resumeUid:currentUid}).then(()=>{document.body.classList.remove('login-required');}).finally(()=>{lockPromise=null;});
 return lockPromise;
}

export async function requireWorkspaceLogin({resumeUid=null}={}){
 const form=document.querySelector('#startup-login'),message=document.querySelector('#login-message'),button=form.querySelector('button');
 button.disabled=true;button.textContent='登录工作台';
 message.textContent=sessionStorage.getItem('diy-login-notice')||(resumeUid?'登录已失效，请用原账号重新登录，当前编辑已保留。':'使用已开通的成员账号登录');sessionStorage.removeItem('diy-login-notice');
 let context;try{context=await workspaceAuth();}catch(error){message.textContent=error.message;button.disabled=true;throw error;}
 // A saved SDK token is never sufficient: recheck membership on every startup.
 if(!resumeUid&&retention.valid()){
  signingIn=true;button.disabled=true;message.textContent='正在恢复登录…';
  try{
   const {data,error}=await context.auth.getSession();if(error)throw error;
   if(!data?.session||data.session.user?.is_anonymous)throw Error('保存的登录已失效，请重新登录');
   const status=await context.establishSession({accessToken:data.session.access_token});currentUid=status.member.uid;return status;
  }catch(error){retention.clear();message.textContent=error.message;}
  finally{signingIn=false;button.disabled=false;}
 }else if(!resumeUid){retention.clear();}
 return new Promise(resolve=>{
  form.onsubmit=async event=>{
   event.preventDefault();if(button.disabled||signingIn)return;signingIn=true;button.disabled=true;button.textContent='正在登录…';message.textContent='正在验证成员身份…';
   try{
    const {auth,establishSession}=context,{error}=await auth.signInWithPassword({username:form.elements.username.value.trim(),password:form.elements.password.value});if(error)throw error;
    const {data,error:sessionError}=await auth.getSession();if(sessionError)throw sessionError;
    if(!data?.session||data.session.user?.is_anonymous)throw Error('请使用正式成员账号登录');
    const status=await establishSession({accessToken:data.session.access_token,retainedUntil:Date.now()+LOGIN_RETENTION_MS,...(resumeUid?{resumeUid}:{})});form.elements.password.value='';currentUid=status.member.uid;retention.remember();
    resolve(status);
   }catch(error){message.textContent=error.message;button.disabled=false;button.textContent='登录工作台';form.elements.password.value='';form.elements.password.focus();}finally{signingIn=false;}
  };
  button.disabled=false;form.elements.username.focus();
 });
}
