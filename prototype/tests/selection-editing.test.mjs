import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function activate(id)'),source.indexOf('function renderShop()'));
test('点击卡片编辑后仅选择当前配置，清除同组或跨组遗留批量选择',()=>{
 for(const initial of [['a','b','c'],['a'],[]]){
  const messages=[];const context={selected:new Set(initial),active:'a',posterEditor:null,collapsedProducts:new Set(['p']),current:()=>({productId:'p'}),renderAll(){},toast:text=>messages.push(text)};
  vm.runInNewContext(code+';activate("b");',context);
  assert.deepEqual([...context.selected],['b']);assert.equal(context.active,'b');assert.equal(context.collapsedProducts.has('p'),false);
  assert.equal(messages.length,initial.length?1:0);
 }
});
