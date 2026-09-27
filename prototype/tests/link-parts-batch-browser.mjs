import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.WORKBENCH_PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve('prototype'),out=path.resolve('.verification/link-parts-batch-20260925');await fs.mkdir(out,{recursive:true});
const app=await fs.readFile(path.join(root,'app.js'),'utf8'),source=app.slice(app.indexOf('function overviewProfitCell('),app.indexOf('function openMaintenancePrices('));
const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/workbench-ui.css"><link rel="stylesheet" href="/workbench-simple.css"><dialog id="dialog" class="overview-dialog"><form><div class="dialog-title"><h2>配置总览</h2><button class="close">×</button></div></form><div id="dialog-body"></div></dialog>');return;}const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep))throw Error('path');res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async()=>{
  const {openLinkParts}=await import('/link-parts.js'),{applyReplacement}=await import('/global-batch.js');
  const part=(goodsId,slot)=>({goodsId,slot,name:'原配件'+goodsId,qty:2});
  const configs=[1,2].map(i=>({id:'c'+i,shopId:'intel',productId:'p',product:'测试链接',name:'配置'+i,parts:[part('1','CPU'),part('2','内存')],actualParts:[part('1','CPU'),part('2','内存')],addons:[]}));
  window.catalog=[{sourceId:'cpu',goodsId:'10',name:'新处理器'},{sourceId:'ram',goodsId:'20',name:'新内存'},{sourceId:'fan',goodsId:'30',name:'新风扇'},{sourceId:'extra',goodsId:'40',name:'新增配件'}];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  openLinkParts({product:{id:'p',name:'测试链接'},openDialog:(title,html)=>{document.querySelector('.dialog-title h2').textContent=title;document.querySelector('#dialog').classList.remove('overview-dialog');document.querySelector('#dialog-body').innerHTML=html;document.querySelector('#dialog').showModal();},closeDialog:()=>document.querySelector('#dialog').close(),afterApply:()=>window.overviewOpened=true,esc,getConfigs:()=>configs,getCatalog:()=>window.catalog,toast:()=>{},apply:async plan=>{window.applyCalls=(window.applyCalls||0)+1;applyReplacement(plan,configs);window.savedConfigs=configs;}});
 });
 const fillReplace=async(index,from,to)=>{const r=page.locator('.link-part-rule').nth(index);await r.locator('[data-rule-query]').fill(from);await r.locator('[data-rule-match]').selectOption('id:'+from);await r.locator('[data-product-query]').fill(to);await r.locator('[data-product-id]').click();};
 const fillAdd=async(index,slot,to)=>{const r=page.locator('.link-part-rule').nth(index);await r.locator('[data-rule-slot]').selectOption(slot);await r.locator('[data-product-query]').fill(to);await r.locator('[data-product-id]').click();};
 await fillReplace(0,'1','10');await page.locator('#link-part-add-replace').click();await fillReplace(1,'2','20');
 await page.locator('#link-part-add-new').click();await fillAdd(2,'风扇','30');await page.locator('#link-part-add-new').click();await fillAdd(3,'配件1','40');
 await page.screenshot({path:path.join(out,'rules.png')});
 await page.locator('#link-part-preview').click();assert.equal(await page.locator('.link-part-overview tbody tr').count(),16);assert.match(await page.locator('#link-part-diff').innerText(),/4 条规则/);
 await page.screenshot({path:path.join(out,'overview.png')});
 for(const width of [820,500]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('#dialog-body').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);}
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('.link-part-rule').nth(3).locator('[data-rule-remove]').click();assert.equal(await page.locator('#link-part-apply').isDisabled(),true);
 await page.locator('#link-part-preview').click();assert.equal(await page.locator('.link-part-overview tbody tr').count(),12);
 await page.evaluate(()=>window.catalog[1].name='changed after preview');await page.locator('#link-part-apply').click();await page.waitForFunction(()=>document.querySelector('#link-part-status').textContent.includes('配件资料已变化'));assert.match(await page.locator('#link-part-status').innerText(),/配件资料已变化/);assert.equal(await page.evaluate(()=>window.applyCalls||0),0);
 await page.locator('#link-part-preview').click();await page.locator('#link-part-apply').click();
 await page.waitForFunction(()=>document.querySelector('#link-part-status').textContent.includes('已保存'));assert.equal(await page.evaluate(()=>window.applyCalls),1);assert.equal(await page.evaluate(()=>window.overviewOpened),undefined);assert.equal(await page.locator('#dialog').evaluate(el=>el.open),true);assert.equal(await page.locator('#link-part-apply').isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.savedConfigs.map(c=>c.parts.map(p=>p.goodsId))),[['10','20','30'],['10','20','30']]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,rules:4,overviewRows:16,widths:[1440,820,500],staleSourceBlocked:true,keepsEditorOpenAfterSave:true,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
