import test from 'node:test';
import assert from 'node:assert/strict';
import {recentActivity,activityEntry} from '../activity.js';
import {SyncStore} from '../local-store/sync-store.mjs';
test('操作记录按七天而非条数保留，去重且摘要可定位',()=>{
 const now=Date.now(),at=new Date(now).toISOString(),old=new Date(now-8*86400000).toISOString();
 const rows=Array.from({length:150},(_,i)=>({id:String(i),at}));assert.equal(recentActivity([...rows,rows[0],{id:'old',at:old}],now).length,150);
 const a={name:'配置1',shopId:'intel',parts:[{slot:'CPU',upgrade:'旧'}]},b=structuredClone(a);b.parts[0].upgrade='新的文案';const entry=activityEntry('configuration','c',a,b,{operator:'同事B'});assert.equal(entry.target.tab,'addons');assert.equal(entry.target.slot,'CPU');assert.equal(entry.operator,'同事B');assert.ok(entry.summary.length<=80);
});
test('同步记录使用远端成员及远端时间，分页失败时连同记录一起回滚',()=>{
 const store=new SyncStore(':memory:',{protocolVersion:2,validate:()=>{}}),at=new Date().toISOString();
 const change={seq:1,type:'configuration',id:'c',version:1,updatedBy:'member-b',updatedAt:at,data:{name:'配置',parts:[],addons:[{text:'组合'}]}};
 assert.throws(()=>store.applyPage({ok:true,headSeq:2,nextCursor:2,hasMore:false,changes:[change]}));assert.equal(store.meta('activity'),undefined);
 store.applyPage({ok:true,headSeq:1,nextCursor:1,hasMore:false,changes:[change]});const log=store.meta('activity')[0];assert.equal(log.operator,'member-b');assert.equal(log.at,at);assert.equal(log.origin,'cloud');assert.equal(log.target.id,'c');store.close();
});
