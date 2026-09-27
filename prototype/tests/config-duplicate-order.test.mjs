import test from 'node:test';
import assert from 'node:assert/strict';
import {insertConfigAfter,restoreConfigOrder} from '../config-order.js';
import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';
const config=(id,order,productId='p')=>({id,workspaceOrder:order,shopId:'intel',productId,product:productId,name:'配置'+id,price:100,parts:[],actualParts:[],addons:[]});
test('复制插在原配置后，原配置和其他链接不变，连续复制仍紧跟原配置',()=>{
 const rows=[config('1',10),config('2',20),config('3',30),config('other',100,'q')],snapshot=structuredClone(rows);
 const once=insertConfigAfter(rows,'1',{...rows[0],id:'copy'});
 assert.deepEqual(once.map(c=>c.id),['1','copy','2','3','other']);assert.deepEqual(rows,snapshot);
 assert.equal(once[1].workspaceOrder,15);assert.equal(once[4],rows[3]);
 const twice=insertConfigAfter(once,'1',{...rows[0],id:'copy2'});
 assert.deepEqual(restoreConfigOrder([...twice].reverse()).filter(c=>c.productId==='p').map(c=>c.id),['1','copy2','copy','2','3']);
});
test('末项、旧记录和浮点间距耗尽仍能插入并通过同步投影保持顺序',()=>{
 for(const orders of [[10,20,30],[undefined,undefined,undefined],[1,1+Number.EPSILON,2]]){
  const rows=orders.map((order,i)=>config(String(i+1),order));
  for(const original of ['1','3']){
   const result=insertConfigAfter(rows,original,{...rows.find(c=>c.id===original),id:'copy'});
   const state={configs:result,sourceCatalog:[],costSource:[],templates:[],caseGallery:[],shopSettings:{}};
   const restored=applyWorkspace(state,projectWorkspace(state).reverse());
   assert.deepEqual(restored.configs.map(c=>c.id),result.map(c=>c.id));
   assert.equal(restored.configs.findIndex(c=>c.id==='copy'),restored.configs.findIndex(c=>c.id===original)+1);
  }
 }
});
