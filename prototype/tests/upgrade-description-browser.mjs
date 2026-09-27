import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.WORKBENCH_PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve('prototype'),out=path.resolve('.verification/upgrade-description-20260925');await fs.mkdir(out,{recursive:true});
const app=await fs.readFile(path.join(root,'app.js'),'utf8'),source=app.slice(app.indexOf('function overviewProfitCell('),app.indexOf('function openMaintenancePrices('));
const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/workbench-ui.css"><link rel="stylesheet" href="/workbench-simple.css"><dialog id="dialog" class="overview-dialog"><form><div class="dialog-title"><h2>配置总览</h2><button class="close">×</button></div></form><div id="dialog-body"></div></dialog>');return;}const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep))throw Error('path');res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async()=>{
 const {openUpgradeDescriptionBatch,applyReplacement}=await import('/global-batch.js');
 window.configs=[1,2,3].map(i=>({id:'c'+i,productId:i===3?'other':'p',product:'链接'+i,name:'配置'+i,parts:[{slot:'内存',goodsId:'1',name:'DDR5',upgrade:i===2?'保留说明':'加99升级'},{slot:'配件1',goodsId:'1',name:'DDR5',upgrade:'不匹配'}],actualParts:[{name:'实际配件'}],addons:[{text:'加99升级'}]}));
 window.openBatch=(local)=>openUpgradeDescriptionBatch({...(local?{productId:'p',getSelectedIds:()=>['c2','c3']}:{}),getConfigs:()=>window.configs,esc:s=>String(s),openDialog:(title,html)=>{document.querySelector('.dialog-title h2').textContent=title;document.querySelector('#dialog-body').innerHTML=html;document.querySelector('#dialog').showModal();},apply:async plan=>{applyReplacement(plan,window.configs);}});
 window.openBatch(false);
 });
 assert.equal(await page.locator('.dialog-title h2').innerText(),'批量修改全店加购说明');
 await page.locator('#upgrade-batch-description-query').fill('加99');
 assert.equal(await page.locator('[data-upgrade-part]').count(),1);
 await page.locator('[data-upgrade-part]').click();
 assert.equal(await page.locator('[data-upgrade-link]').count(),2);
 await page.locator('#upgrade-batch-text').fill('新说明');await page.locator('#upgrade-batch-preview').click();
 assert.match(await page.locator('#upgrade-batch-status').innerText(),/2 套/);
 await page.locator('#upgrade-batch-description-query').fill('保留');assert.equal(await page.locator('#upgrade-batch-apply').isDisabled(),true);
 await page.evaluate(()=>window.openBatch(true));
 await page.locator('#upgrade-batch-description-query').fill('加99');await page.locator('[data-upgrade-part]').click();
 assert.equal(await page.locator('[data-upgrade-link]').count(),1);
 await page.locator('#upgrade-batch-text').fill('本链接修改');await page.locator('#upgrade-batch-preview').click();await page.locator('#upgrade-batch-apply').click();
 assert.deepEqual(await page.evaluate(()=>window.configs.map(c=>c.parts.map(p=>p.upgrade))),[['本链接修改','不匹配'],['保留说明','不匹配'],['加99升级','不匹配']]);
 await page.locator('#upgrade-batch-scope').selectOption('selected');await page.locator('[data-upgrade-part]').click();
 await page.locator('#upgrade-batch-text').fill('勾选修改');await page.locator('#upgrade-batch-preview').click();
 await page.screenshot({path:path.join(out,'selected-preview.png')});
 await page.locator('#upgrade-batch-apply').click();
 assert.deepEqual(await page.evaluate(()=>window.configs.map(c=>c.parts[0].upgrade)),['本链接修改','保留说明','勾选修改']);
 assert.equal(await page.evaluate(()=>window.configs.every(c=>c.actualParts[0].name==='实际配件'&&c.addons[0].text==='加99升级')),true);
 assert.deepEqual(errors,[]);console.log('PASS: description search, shop/link/selected scopes, preview invalidation, preserved nonmatching slots and actual/addons');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
