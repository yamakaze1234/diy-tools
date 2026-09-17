import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {SyncStore} from '../local-store/sync-store.mjs';
import {validateWorkspaceRecord} from '../workspace-validation.mjs';
import {createWorkspaceSync} from '../workspace-sync.mjs';

const options={protocolVersion:2,validate:validateWorkspaceRecord};
const settings={couponCents:0};
function store(t){const s=new SyncStore(':memory:',options);t.after(()=>s.close());s.bind('team','A');return s;}
test('同一工作区可切换成员，并保留数据、游标和自动备份',t=>{
 const s=store(t);s.applyPage({ok:true,headSeq:1,nextCursor:1,hasMore:false,changes:[{seq:1,type:'settings',id:'intel',version:1,data:settings}]});
 s.switchMember('team','B');assert.equal(s.meta('uid'),'B');assert.equal(s.meta('cursor'),1);assert.deepEqual(s.get('settings','intel').draft,settings);
 assert.equal(s.db.prepare('SELECT count(*) AS n FROM backups').get().n,1);
 assert.throws(()=>s.switchMember('other','C'),/当前工作区/);assert.equal(s.meta('uid'),'B');
});
test('未同步草稿和未确认请求不能由新成员接管，原成员可重新登录',t=>{
 const s=store(t);s.edit('settings','intel',settings);assert.throws(()=>s.switchMember('team','B'),/原账号/);
 const request=s.nextBatch()[0];assert.throws(()=>s.switchMember('team','B'),/原账号/);
 s.switchMember('team','A');assert.deepEqual(s.nextBatch()[0],request);assert.equal(s.meta('uid'),'A');
});
test('存在冲突时不允许切换成员',t=>{
 const s=store(t);s.edit('settings','intel',settings);const request=s.nextBatch()[0];
 s.acknowledge(request,{code:'CONFLICT',fields:['couponCents'],remote:{version:1,data:{couponCents:1}}});
 assert.throws(()=>s.switchMember('team','B'),/冲突/);assert.equal(s.status().conflicts,1);
});

const root=await fs.mkdtemp(new URL('../.verification/auth-unit-',import.meta.url));
await fs.writeFile(path.join(root,'.env.local'),'CLOUDBASE_PUBLIC_CONFIG='+JSON.stringify({envId:'test-environment',functionName:'workbenchApi'}));
let index=0;
async function router(t,fetchImpl,state={configs:[],templates:[],caseGallery:[]}){
 const local=path.join(root,String(++index));await fs.mkdir(local);
 t.mock.method(globalThis,'fetch',fetchImpl|| (async(_url,opts)=>{
  const request=JSON.parse(opts.body),uid=request.accessToken;
  return Response.json({ok:true,uid,memberId:uid,name:uid,workspaceId:'team'});
 }));
 const sync=await createWorkspaceSync({root,local,getState:()=>state,setState:async()=>{},body:async req=>req.data,json:(res,code,data)=>Object.assign(res,{code,data})});
 t.after(()=>sync.close());
 let csrf;
 const call=async(action,data,cookie='')=>{
  const res={headers:{},setHeader(key,value){this.headers[key]=value;}};
  await sync.routes({method:data===undefined?'GET':'POST',headers:{'x-diy-sync':csrf,cookie},data},res,new URL('http://localhost/api/workspace-sync/'+action));return res;
 };
 csrf=(await call('config')).data.csrf;return {sync,call};
}
test('empty new device joins a ready workspace on login, existing local data is never auto-replaced',async t=>{
 const fetchImpl=async()=>Response.json({ok:true,uid:'A',memberId:'A',workspaceId:'team',ready:true});
 const fresh=await router(t,fetchImpl);const joined=await fresh.call('session',{accessToken:'A'});assert.equal(joined.data.enabled,true);
 const existing=await router(t,fetchImpl,{configs:[{id:'local'}],templates:[],caseGallery:[]});assert.equal((await existing.call('session',{accessToken:'A'})).data.enabled,false);
});
test('未登录不暴露数据；退出撤销 Cookie；同工作区新成员可登录',async t=>{
 const {sync,call}=await router(t);
 assert.equal((await call('preview')).code,401);assert.equal((await call('backup',{})).code,401);
 const login=await call('session',{accessToken:'A'}),cookie=login.headers['Set-Cookie'].split(';')[0];
 assert.equal(login.code,200);assert.ok(sync.authenticated({headers:{cookie}}));
 assert.equal((await call('status')).data.member,undefined);
 assert.equal((await call('session',{accessToken:'B'},cookie)).code,400);
 assert.equal((await call('logout',{},cookie)).code,200);assert.equal(sync.authenticated({headers:{cookie}}),false);
 assert.equal((await call('session',{accessToken:'B'})).data.member.uid,'B');
 assert.equal(sync.authenticated({headers:{cookie}}),false);
});
test('退出后迟到的登录校验不会恢复登录态',async t=>{
 let release,started;const ready=new Promise(r=>started=r),response=new Promise(r=>release=r);
 const {sync,call}=await router(t,async()=>{started();return response;});
 const pending=call('session',{accessToken:'A'});await ready;
 assert.equal((await call('logout',{})).code,200);
 release(Response.json({ok:true,uid:'A',workspaceId:'team'}));assert.equal((await pending).code,400);assert.equal(sync.status().signedIn,false);
});
test('账号校验失败不建立本地会话',async t=>{
 const {sync,call}=await router(t,async()=>Response.json({code:'UNAUTHENTICATED'},{status:401}));
 const result=await call('session',{accessToken:'invalid'});assert.equal(result.code,400);assert.equal(result.headers['Set-Cookie'],undefined);assert.equal(sync.status().signedIn,false);
});
test('用户名和密码更新后按稳定 UID 继续使用原数据，失效恢复不能换身份',async t=>{
 let renamed=false;
 const {sync,call}=await router(t,async(_url,options)=>{
  const token=JSON.parse(options.body).accessToken;
  return Response.json({ok:true,uid:token==='other'?'B':'A',workspaceId:'team',name:renamed?'新名称':'原名称'});
 });
 let result=await call('session',{accessToken:'old-valid-token'});const cookie=result.headers['Set-Cookie'].split(';')[0];
 sync.store.edit('settings','intel',settings);await call('logout',{},cookie);renamed=true;
 assert.equal((await call('session',{accessToken:'other',resumeUid:'A'})).code,400);
 result=await call('session',{accessToken:'new-valid-token'});assert.equal(result.code,200);assert.equal(result.data.member.name,'新名称');assert.equal(result.data.member.uid,'A');assert.equal(sync.store.status().pending,1);
});
