import test from 'node:test';
import assert from 'node:assert/strict';
import {changesBetween,projectWorkspace} from '../workspace-records.mjs';
import {equal,recordKey} from '../../shared/sync/protocol.mjs';

test('图库保存的快速差异与全量投影一致，成本和来源变更仍被记录',()=>{
 const before={configs:[],templates:[],shopSettings:{intel:{coupon:0}},costSource:Array.from({length:16110},(_,i)=>({goodsId:String(i+1),name:'配件'+i,tax:10})),sourceCatalog:[],caseGallery:[{id:'old',name:'原图',url:'/assets/case.png'}]};
 const after=structuredClone(before);after.caseGallery.push({id:'new',name:'新增',url:'/assets/new.png'});after.caseGallery[0].name='修改名称';
 const expected=(a,b)=>{const old=new Map(projectWorkspace(a).map(r=>[recordKey(r.type,r.id),r]));return projectWorkspace(b).flatMap(r=>{const prev=old.get(recordKey(r.type,r.id));return !prev||!equal(prev.data,r.data)?[{...r,expectedDraft:prev?.data}]:[];});};
 assert.deepEqual(changesBetween(before,after),expected(before,after));
 after.costSource[0].tax=11;
 assert.deepEqual(changesBetween(before,after),expected(before,after));
 const removed=structuredClone(before);removed.caseGallery=[];
 const changes=changesBetween(before,removed);assert.equal(changes.length,1);assert.equal(changes[0].id,'old');assert.ok(changes[0].data.deletedAt);assert.deepEqual(changes[0].expectedDraft,before.caseGallery[0]);
});
