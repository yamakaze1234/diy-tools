import test from 'node:test';
import assert from 'node:assert/strict';
import {moveConfig} from '../config-drag.js';
import {restoreConfigOrder} from '../config-order.js';
import {applyWorkspace,projectWorkspace} from '../workspace-records.mjs';
const fixture=()=>[1,2,3].map(n=>({id:String(n),name:'配置'+n,shopId:'intel',productId:'p',price:0,parts:[]}));
test('配置上下拖动持久化顺序，重新归一化和同步往返保留',()=>{
 const original=fixture(),next=moveConfig(original,'3','1');
 assert.deepEqual(next.map(c=>c.id),['3','1','2']);assert.deepEqual(original.map(c=>c.id),['1','2','3']);
 assert.deepEqual(restoreConfigOrder([...next].reverse()).map(c=>c.id),['3','1','2']);
 const state={configs:next,templates:[],sourceCatalog:[],costSource:[],caseGallery:[],shopSettings:{}};
 assert.deepEqual(applyWorkspace(state,projectWorkspace(state)).configs.map(c=>c.id),['3','1','2']);
 assert.deepEqual(moveConfig(next,'3','2',true).map(c=>c.id),['1','2','3']);
});
test('无效拖动不修改配置，不跨店铺或商品移动，不改变删除项',()=>{
 const rows=fixture();rows.push({id:'other',shopId:'intel',productId:'q'},{id:'deleted',shopId:'intel',productId:'p',deletedAt:'yes'});
 for(const pair of [['1','1'],['1','other'],['deleted','1'],['missing','1']])assert.equal(moveConfig(rows,...pair),null);
 const next=moveConfig(rows,'3','1');assert.equal(next[3],rows[3]);assert.equal(next[4],rows[4]);
});
