import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/d1832/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve('prototype'),out=path.resolve('.verification/overview-20260923');await fs.mkdir(out,{recursive:true});
const app=await fs.readFile(path.join(root,'app.js'),'utf8'),source=app.slice(app.indexOf('function overviewProfitCell('),app.indexOf('function openMaintenancePrices('));
const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/workbench-ui.css"><link rel="stylesheet" href="/workbench-simple.css"><dialog id="dialog" class="overview-dialog"><form><div class="dialog-title"><h2>配置总览</h2><button class="close">×</button></div></form><div id="dialog-body"></div></dialog>');return;}const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep))throw Error('path');res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async source=>{
  const {totals}=await import('/core.js'),{pricing,pricingColumn}=await import('/pricing.js'),{overviewProfits}=await import('/part-transfer.js');
  const configs=Array.from({length:20},(_,i)=>({id:'c'+i,name:'配置'+(i+1),shortName:`配置${i+1}：14600KF+5060Ti+32G+1T | 进阶版`,price:i===8?0:6599+i*400,installment:i===2?12:0,parts:[{slot:'CPU',goodsId:'123',name:'CPU',qty:1,tax:6200+i*350,erp:i<2?null:6200+i*350}]}));
  const $=s=>document.querySelector(s),esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const context={totals,pricing,pricingColumn,overviewProfits,money:v=>Number(v).toLocaleString('zh-CN'),esc,$,$$:s=>[...document.querySelectorAll(s)],currentProduct:()=>({name:'X400CG · 演示链接',configs}),currentSettings:()=>({coupon:400}),currentShop:()=>({name:'英特尔官方旗舰店'}),openDialog:(_,html)=>{$('#dialog-body').innerHTML=html;$('#dialog').showModal();},activate:id=>window.chosen=id,closeDialog:()=>$('#dialog').close(),toast:()=>{},openMaintenancePrices:()=>{},suggestedName:c=>c.name,copyText:cs=>cs.map(c=>c.shortName).join('\r\n')};
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}}});
  new Function(...Object.keys(context),source+';openOverview();')(...Object.values(context));
 },source);
 assert.equal(await page.locator('.overview-row').count(),20);
 const layouts=[];for(const width of [1440,820,500]){
  await page.setViewportSize({width,height:1000});
  const check=await page.evaluate(()=>{const head=[...document.querySelector('.overview-head').children].map(e=>e.getBoundingClientRect());const rows=[...document.querySelectorAll('.overview-row')];return {overflow:document.querySelector('#dialog-body').scrollWidth>document.querySelector('#dialog-body').clientWidth,aligned:rows.every(row=>[...row.children].slice(0,5).every((el,i)=>Math.abs(el.getBoundingClientRect().right-head[i].right)<2)),contained:rows.every(row=>[...row.children].every(el=>el.getBoundingClientRect().bottom<=row.getBoundingClientRect().bottom)),rowHeight:rows[0].getBoundingClientRect().height};});
  assert.equal(check.overflow,false);assert.equal(check.aligned,true);assert.equal(check.contained,true);layouts.push({width,...check});await page.screenshot({path:path.join(out,'overview-'+width+'.png')});
 }
 await page.locator('#overview-price-copy').click();assert.equal((await page.evaluate(()=>window.copied)).split('\r\n').length,20);
 await page.locator('[data-overview="c0"]').click();assert.equal(await page.evaluate(()=>window.chosen),'c0');assert.deepEqual(errors,[]);
 await page.evaluate(async()=>{
  const {openLinkParts}=await import('/link-parts.js'),{applyReplacement}=await import('/global-batch.js');
  const configs=[{id:'c',productId:'p',product:'测试链接',name:'配置1',parts:[],actualParts:[],addons:[]}];
  const row={sourceId:'new',goodsId:'20',name:'测试风扇'};
  openLinkParts({product:{id:'p',name:'测试链接'},openDialog:(_,html)=>{document.querySelector('#dialog-body').innerHTML=html;document.querySelector('#dialog').showModal();},closeDialog:()=>document.querySelector('#dialog').close(),esc:String,getConfigs:()=>configs,getCatalog:()=>[row],toast:()=>{},apply:async plan=>{window.applyCalls=(window.applyCalls||0)+1;applyReplacement(plan,configs);await new Promise(resolve=>window.finishSave=resolve);window.savedConfigs=configs;}});
 });
 await page.locator('#link-part-mode').selectOption('add');await page.locator('#link-part-slot').selectOption('风扇');await page.locator('#link-part-new-query').fill('20');await page.locator('[data-product-id="new"]').click();await page.locator('#link-part-preview').click();await page.locator('#link-part-apply').click();
 await page.waitForFunction(()=>!!window.finishSave);assert.match(await page.locator('#link-part-status').innerText(),/正在应用并保存/);assert.equal(await page.locator('#link-part-mode').isDisabled(),true);assert.equal(await page.locator('.close').isDisabled(),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#dialog').evaluate(e=>e.open),true);await page.evaluate(()=>window.finishSave());await page.waitForFunction(()=>!document.querySelector('#dialog').open);assert.equal(await page.evaluate(()=>window.applyCalls),1);assert.equal(await page.evaluate(()=>window.savedConfigs[0].actualParts[0].qty),1);assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({layouts,copyRows:20,editNavigation:true,batchSaveFeedback:true,errors},null,2));console.log(JSON.stringify({layouts,copyRows:20,editNavigation:true,batchSaveFeedback:true,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
