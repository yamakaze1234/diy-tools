import test from 'node:test';
import assert from 'node:assert/strict';
import {bindChangeHistory,changedFields} from '../change-history-ui.js';

const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function harness(api){
 let html='',nodes=new Map();const messages=[],calls=[];
 globalThis.document={getElementById:id=>nodes.get(id),querySelector:selector=>nodes.get(selector.slice(1))};
 const ui=bindChangeHistory({api:async(action,data)=>{calls.push(action);return api(action,data);},flush:async()=>{},esc,toast:m=>messages.push(m),openDialog:(_title,text)=>{html=text;nodes=new Map([...text.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{textContent:'',addEventListener(_e,fn){this.onclick=fn;}}]));}});
 return {ui,calls,messages,html:()=>html,node:id=>nodes.get(id)};
}

test('字段差异区分新增、删除、空值及配件列表变化',()=>{
 assert.deepEqual(changedFields({name:'同名',priceCents:100,parts:[1],removed:1},{name:'同名',priceCents:200,parts:[2],added:null}),['priceCents','parts','removed','added']);
});

test('记录展示完整提交编号、成员和前后内容并转义业务文本',async()=>{
 const h=harness(async()=>({records:[{id:'abcd1234-full-id',at:'2026-09-17T08:00:00Z',actor:{name:'成员 A',memberId:'member-a'},changes:[{type:'configuration',id:'one',before:{name:'原名'},after:{name:'<img src=x onerror=attack()>'}}]}]}));
 await h.ui.open();
 assert.match(h.html(),/abcd1234-full-id/);assert.match(h.html(),/member-a/);assert.match(h.html(),/修改前/);assert.match(h.html(),/修改后/);
 assert.ok(!h.html().includes('<img'));assert.match(h.html(),/&lt;img/);
});

test('三个入口只读取记录；云端读取失败仍能返回本机记录',async()=>{
 const h=harness(async action=>{
  if(action==='commits')throw Error('网络不可用');
  return {records:[],headSeq:5};
 });
 await h.ui.open();await h.node('changes-compare').onclick();assert.match(h.html(),/云端快照（序号 5）/);
 await h.node('changes-cloud').onclick();assert.equal(h.node('change-message').textContent,'网络不可用');
 await h.node('changes-cancel').onclick();assert.match(h.html(),/本机修改记录/);
 assert.deepEqual(h.calls,['local-history','compare','commits','local-history']);
});
