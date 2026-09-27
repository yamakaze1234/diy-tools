import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve('prototype'),out=path.resolve('python-desktop/verification/optimization-20260927');await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/workbench-ui.css"><link rel="stylesheet" href="/workbench-simple.css"><dialog id="dialog"><button class="close">×</button><div id="dialog-body"></div></dialog>');return;}const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep))throw Error('path');res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(file));}catch(error){res.statusCode=404;res.end(error.message);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async()=>{
  const {openGlobalBatch,applyReplacement}=await import('/global-batch.js');
  const part=slot=>({slot,goodsId:'100',sourceId:'old',name:'原配件',qty:2});
  const configs=['a','b'].map(id=>({id,shopId:'intel',productId:id,product:'链接'+id,spu:id==='a'?'123':'456',name:'配置1',parts:[part('CPU'),part('风扇')],actualParts:[part('CPU'),part('风扇')],addons:[]}));
  const catalog=[{sourceId:'new',shopId:'intel',goodsId:'200',name:'新配件',tax:30,erp:20}];window.fixture={configs,catalog,applyCalls:0,exports:[]};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.openBatch=()=>openGlobalBatch({openDialog:(title,html)=>{const d=document.querySelector('#dialog');d.classList.remove('global-batch-dialog');document.querySelector('#dialog-body').innerHTML=html;if(!d.open)d.showModal();},esc,toast:()=>{},getConfigs:()=>configs,getCatalog:()=>catalog,openUpgrades:()=>{},save:async()=>{},download:()=>{throw Error('Expected native folder');},apply:async plan=>{window.fixture.applyCalls++;if(window.fixture.conflict){document.querySelector('#dialog-body').innerHTML='<p id="conflict">保存版本需要比较</p>';document.querySelector('#dialog').classList.remove('global-batch-dialog');throw Error('Conflict');}applyReplacement(plan,configs);},renderImage:async()=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;return {canvas,overflow:false};},saveFolder:async(files)=>{window.fixture.exports.push(files.map(file=>file.name));return window.fixture.cancelExport?{cancelled:true}:{directory:'isolated/export'};}});
  window.openBatch();
 });
 assert.equal(await page.locator('[data-global-part]').count(),1);
 await page.screenshot({path:path.join(out,'batch-component-summary.png')});
 await page.locator('#global-query').fill('链接a');await page.locator('#global-slot').selectOption('风扇');await page.locator('[data-global-part]').click();
 assert.equal(await page.locator('[data-global-link]').count(),1);assert.equal(await page.locator('[data-global-link]').inputValue(),'a');
 await page.locator('#global-new-query').fill('200');await page.locator('[data-product-id="new"]').click();await page.locator('#global-export').check();await page.locator('#global-preview').click();
 assert.doesNotMatch(await page.locator('#global-diff').innerText(),/CPU/);
 await page.screenshot({path:path.join(out,'batch-selected-links.png')});
 await page.locator('#global-apply').click();await page.waitForFunction(()=>window.fixture.exports.length===1);
 assert.deepEqual(await page.evaluate(()=>window.fixture.configs.map(c=>c.parts.map(p=>p.goodsId))),[['100','200'],['100','100']]);
 assert.equal(await page.locator('#dialog').evaluate(el=>el.open),true);assert.equal(await page.locator('#global-apply').isDisabled(),true);
 assert.deepEqual(await page.evaluate(()=>window.fixture.exports[0]),['123_链接a/配置清单图/123_配置1.png','123_链接a/SKU图/123_配置1.png','导出清单.json']);
 await page.evaluate(()=>window.fixture.cancelExport=true);await page.locator('#global-retry').click();await page.waitForFunction(()=>document.querySelector('#global-status').textContent.includes('取消图片导出'));
 assert.equal(await page.evaluate(()=>window.fixture.applyCalls),1);
 await page.evaluate(()=>{window.fixture.conflict=true;window.openBatch();});await page.locator('#global-query').fill('100');await page.locator('[data-global-part]').click();await page.locator('#global-new-query').fill('200');await page.locator('[data-product-id="new"]').click();await page.locator('#global-preview').click();await page.locator('#global-apply').click();await page.locator('#conflict').waitFor();
 assert.equal(await page.locator('#dialog .close').isDisabled(),false);assert.deepEqual(errors,[]);
 const report={passed:true,partSummary:true,slotAndLinkScopeExact:true,actualPartsSynced:true,menuStaysOpen:true,folderExport:true,exportCancelDoesNotReapply:true,conflictDialogCloseRestored:true,errors};await fs.writeFile(path.join(out,'global-batch-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
