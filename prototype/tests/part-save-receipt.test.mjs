import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeEditingState,sameEditingState} from '../workspace-ui-merge.js';
const fixture=()=>({configs:[{id:'c',parts:[{slot:'CPU',goodsId:'100',name:'CPU A',qty:1}],actualParts:[{slot:'CPU',goodsId:'100',name:'CPU A',qty:1}]}],templates:[],sourceCatalog:[],costSource:[],caseGallery:[],shopSettings:{}});
const reversed=o=>Array.isArray(o)?o.map(reversed):o&&typeof o==='object'?Object.fromEntries(Object.entries(o).reverse().map(([k,v])=>[k,reversed(v)])):o;
test('保存回执仅重排字段，连续替换配件不误报冲突',()=>{
 const base=fixture(),remote=reversed(base),local=fixture();
 local.configs[0].parts[0].goodsId='200';local.configs[0].parts[0].name='CPU B';
 assert.equal(sameEditingState(base,remote),true);
 const result=mergeEditingState(base,local,remote);assert.equal(result.conflict,false);assert.equal(result.state.configs[0].parts[0].goodsId,'200');
});
test('回执补齐行编号时继续替换，保留新配件和稳定行编号',()=>{
 const base=fixture(),remote=reversed(base),local=fixture();
 for(const field of ['parts','actualParts']){remote.configs[0][field][0].lineId=field+'-line';local.configs[0][field][0].goodsId='200';local.configs[0][field][0].name='CPU B';}
 const result=mergeEditingState(base,local,remote);assert.equal(result.conflict,false);
 for(const field of ['parts','actualParts']){assert.equal(result.state.configs[0][field][0].goodsId,'200');assert.equal(result.state.configs[0][field][0].lineId,field+'-line');}
});
test('真实的配件替换与并发数量或型号修改仍需比较',()=>{
 const base=fixture(),local=fixture(),remote=fixture();local.configs[0].parts[0].goodsId='200';
 for(const patch of [{qty:2},{goodsId:'300'},{name:'别人修改'}]){remote.configs[0].parts[0]={...base.configs[0].parts[0],...patch,lineId:'line'};assert.equal(mergeEditingState(base,local,remote).conflict,true);}
});
