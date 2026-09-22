import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=path.resolve('prototype'),out=path.resolve('python-desktop/verification/part-search');await fs.mkdir(out,{recursive:true});
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const app=await fs.readFile(path.join(root,'app.js'),'utf8'),start=app.indexOf('function renderEditor()'),code=app.slice(start,app.indexOf(" }else if(tab==='addons')",start))+' }}';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage({viewport:{width:1000,height:750}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://parts.test/**',async route=>{const name=new URL(route.request().url()).pathname;await route.fulfill({contentType:name==='/'?'text/html':name.endsWith('.css')?'text/css':'text/javascript',body:name==='/'?'<meta charset="utf-8"><link rel="stylesheet" href="/style.css"><main style="padding:30px"><h2>配置编辑</h2><div class="editor" id="editor"></div><button id="outside">其他操作</button></main>':await fs.readFile(path.join(root,name))});});
 await page.goto('https://parts.test/');
 await page.evaluate(async code=>{
  const {mountProductSearch}=await import('/product-search.js'),{replaceSourcePart}=await import('/source.js'),{ensureActualParts,syncActualParts}=await import('/actual-parts.js');
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],esc=s=>String(s??''),money=v=>Number(v||0).toFixed(2),clone=structuredClone;
  const c={shopId:'intel',parts:[{slot:'CPU',sourceId:'a',goodsId:'100',name:'英特尔 酷睿 i5 14600KF',qty:2}],addons:[]};ensureActualParts(c);let baseline=clone(c.parts);window.c=c;window.edits=0;
  const state={costSource:[]},current=()=>c,posterModules=()=>[],isSpecialComponent=x=>!!x.specialComponent,componentStockHtml=()=>'',checkpoint=()=>{},copiedPart=null;
  const currentCatalog=()=>[{sourceId:'b',shopId:'intel',goodsId:'200',name:'技嘉 B760M AORUS ELITE WIFI6E',tax:500},{sourceId:'c',shopId:'intel',goodsId:'201',name:'技嘉 B850M AORUS ELITE',tax:800},{sourceId:'gone',goodsId:'300',name:'已删除',deletedAt:'yes'}];
  const changed=()=>{window.edits++;syncActualParts(c,baseline);baseline=clone(c.parts);};let tab='parts',renderAll;
  eval(code+';renderAll=renderEditor;window.actual=()=>{tab="actual";renderEditor();};renderEditor();');
 },code);
 assert.equal(await page.locator('input[type=search]').count(),1);assert.equal(await page.locator('textarea').count(),0);
 const input=()=>page.locator('[data-part-name]');await input().fill('技嘉');assert.equal(await page.locator('.product-result').count(),2);assert.equal(await page.evaluate(()=>edits),0);assert.equal(await page.evaluate(()=>c.parts[0].goodsId),'100');assert.equal(await page.locator('.product-results').evaluate(e=>getComputedStyle(e).position),'absolute');
 await page.screenshot({path:path.join(out,'dropdown.png')});await input().press('Escape');assert.equal(await input().inputValue(),'英特尔 酷睿 i5 14600KF');
 await input().fill('200');await page.locator('[data-product-id=b]').click();assert.equal(await input().inputValue(),'技嘉 B760M AORUS ELITE WIFI6E');assert.equal(await page.evaluate(()=>c.actualParts[0].goodsId),'200');assert.equal(await page.evaluate(()=>c.parts[0].qty),2);
 await input().fill('不存在');assert.ok((await page.locator('.product-results').textContent()).includes('没有匹配'));await page.locator('#outside').click();assert.equal(await input().inputValue(),'技嘉 B760M AORUS ELITE WIFI6E');assert.equal(await page.evaluate(()=>edits),1);
 await page.evaluate(()=>actual());await input().fill('201');await input().press('Enter');assert.equal(await page.evaluate(()=>c.actualParts[0].goodsId),'201');assert.equal(await page.evaluate(()=>c.parts[0].goodsId),'200');
 await page.setViewportSize({width:430,height:700});await input().fill('技嘉');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({singleInput:true,dropdown:true,typingDoesNotEdit:true,cancelRestoresName:true,replaceSyncsActual:true,actualDoesNotChangeDisplay:true,narrowLayout:true,errors},null,2));console.log('PASS: single field, dropdown, selection, Escape/blur restoration, no typing saves, display/actual sync, narrow layout');
}finally{await browser.close();}
