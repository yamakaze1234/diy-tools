import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const retentionSource=(await fs.readFile(new URL('../session-retention.js',import.meta.url),'utf8')).replaceAll('export ','');
const source=retentionSource+'\n'+(await fs.readFile(new URL('../workspace-auth.js',import.meta.url),'utf8')).replace(/^import .+;\s*/gm,'').replaceAll('export ','');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function harness({remembered=false,expired=false,denied=false}={}){
 let listener,inFlight=0,maxInFlight=0,requests=0;const calls=[],events=[];
 const session={access_token:'test-token',user:{is_anonymous:false}},button={disabled:false},message={textContent:''};
 const form={elements:{username:{value:'new-name',focus(){}},password:{value:'new-password',focus(){}}},querySelector:()=>button};
 const storage=new Map();if(remembered)storage.set('diy-login-retained-until',String(Date.now()+(expired?-1000:86400000)));
 const context={console,AbortSignal,setInterval(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},sessionStorage:{getItem(){return null;},removeItem(){}},document:{querySelector:selector=>selector==='#startup-login'?form:message},window:{dispatchEvent:event=>events.push(event)},cloudbase:{init:()=>({auth:{onAuthStateChange:fn=>listener=fn,async signInWithPassword(){listener('TOKEN_REFRESHED',session);return {error:null};},async getSession(){return {data:{session}};}}})},fetch:async(url,options)=>{
  if(url.endsWith('/config'))return {ok:true,json:async()=>({csrf:'test-csrf',config:{envId:'test-env'}})};
  calls.push(JSON.parse(options.body));requests++;inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);const busy=inFlight>1;await turn();inFlight--;
  return {ok:!busy&&!denied,status:denied?401:busy?400:200,json:async()=>denied?{error:'成员已停用'}:busy?{error:'正在切换登录状态，请稍后重试'}:{signedIn:true,member:{uid:'A'}}};
 }};
 vm.runInNewContext(source+'\nglobalThis.testApi={requireWorkspaceLogin,workspaceAuth};',context);
 let signedIn=false;context.testApi.requireWorkspaceLogin().then(()=>{signedIn=true;});
 for(let i=0;i<20&&!form.onsubmit&&!signedIn;i++)await turn();if(!signedIn)assert.equal(typeof form.onsubmit,'function');
 return {form,button,message,calls,events,context,session,emit:()=>listener('TOKEN_REFRESHED',session),stats:()=>({signedIn,requests,maxInFlight})};
}
test('SDK 在登录时触发令牌刷新仍能进入工作台，不出现并发身份校验',async()=>{
 const h=await harness();await h.form.onsubmit({preventDefault(){}});await turn();
 assert.equal(h.stats().signedIn,true,h.message.textContent);assert.equal(h.stats().maxInFlight,1);assert.equal(h.stats().requests,1);assert.equal(h.form.elements.password.value,'');
});
test('已登录后连续刷新令牌按顺序校验，不触发登录状态错误',async()=>{
 const h=await harness();await h.form.onsubmit({preventDefault(){}});await turn();h.emit();h.emit();
 for(let i=0;i<10;i++)await turn();assert.equal(h.stats().maxInFlight,1);assert.equal(h.stats().requests,3);assert.deepEqual(h.events,[]);
});

test('一周内启动自动校验成员，刷新不延长保存期限',async()=>{const h=await harness({remembered:true});assert.equal(h.stats().signedIn,true);assert.equal(h.calls.length,1);const until=h.context.localStorage.getItem('diy-login-retained-until');h.emit();await turn();await turn();assert.equal(h.context.localStorage.getItem('diy-login-retained-until'),until);});
test('保存期限已过不自动登录，仍显示登录页',async()=>{const h=await harness({remembered:true,expired:true});assert.equal(h.stats().signedIn,false);assert.equal(h.calls.length,0);assert.equal(h.context.localStorage.getItem('diy-login-retained-until'),null);});
test('保存的令牌被云端拒绝时清除自动登录资格',async()=>{const h=await harness({remembered:true,denied:true});assert.equal(h.stats().signedIn,false);assert.equal(h.context.localStorage.getItem('diy-login-retained-until'),null);assert.match(h.message.textContent,/停用/);});

test('同步前续期沿用原成员与原保留期限，重复调用合并',async()=>{const h=await harness();await h.form.onsubmit({preventDefault(){}});const auth=await h.context.testApi.workspaceAuth();const until=h.context.localStorage.getItem('diy-login-retained-until');await Promise.all([auth.renewSession(),auth.renewSession()]);assert.equal(h.stats().requests,2);assert.equal(h.calls.at(-1).resumeUid,'A');assert.equal(h.context.localStorage.getItem('diy-login-retained-until'),until);});
