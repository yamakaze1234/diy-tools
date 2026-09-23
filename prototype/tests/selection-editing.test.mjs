import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function activate(id)'),source.indexOf('function renderShop()'));
test('点击配置只切换编辑对象，保留本店同链接与跨链接勾选',()=>{
 for(const initial of [['a','b','c'],['a'],[]]){
  const context={selected:new Set(initial),active:'a',posterEditor:null,collapsedProducts:new Set(['p']),available:()=>[{id:'a'},{id:'b'},{id:'c'}],current:()=>({productId:'p'}),renderAll(){}};
  vm.runInNewContext(code+';activate("b");',context);
  assert.deepEqual([...context.selected],initial);assert.equal(context.active,'b');assert.equal(context.collapsedProducts.has('p'),false);
 }
});
test('跳到另一店铺配置时仅移除旧店勾选，不自动勾选刚打开的配置',()=>{
 const context={selected:new Set(['a','b']),active:'a',posterEditor:null,collapsedProducts:new Set(),available:()=>[{id:'c'}],current:()=>({productId:'other'}),renderAll(){}};
 vm.runInNewContext(code+';activate("c");',context);
 assert.deepEqual([...context.selected],[]);assert.equal(context.active,'c');
});
