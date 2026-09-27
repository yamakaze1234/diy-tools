import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.WORKBENCH_PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve('prototype'),out=path.resolve('python-desktop/verification/source-sync-groups');await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><dialog class="source-dialog"><div id="dialog-body"><div class="source-sync" id="mount"></div></div></dialog>');return;}const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error('path');res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':'application/octet-stream');res.end(await fs.readFile(file));}catch(e){res.statusCode=404;res.end(e.message);}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1400,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(async()=>{
  const {mountSourceSync}=await import('/source-sync-ui.js'),{applySourceSync}=await import('/source-sync-data.js');
  const row={sourceId:'source',shopId:'intel',goodsId:'123',name:'更新后散热器名称',tax:200,addonText:'【+199元升级利民 360 四寸大屏幕冷头】'};
  const old='【+299元升级利民 360 四寸大屏幕冷头+3个连体风扇】';
  const configs=['a','b','c'].map((id,i)=>({id,shopId:'intel',productId:i===1?'p2':'p1',product:i===1?'X400 黑色链接':'X400 白色链接',name:'配置'+(i+1),parts:[{slot:'散热',sourceId:'source',goodsId:'123',name:'原散热器名称',tax:100,qty:1,upgrade:i===2?'【+399元升级水冷及风扇】':old}],actualParts:[{slot:'散热',goodsId:'actual',qty:7}],addons:[{text:'原人工加购'}]}));
  window.fixture={configs,original:structuredClone(configs),row,applied:[]};
  mountSourceSync(document.querySelector('#mount'),{message(){},isEdited:()=>false,flush:async()=>{},getConfigs:()=>configs,getRows:()=>[row],shopId:()=> 'intel',apply:async plan=>{applySourceSync(plan,configs,[row]);window.fixture.applied.push(plan);}});document.querySelector('dialog').showModal();
 });
 await page.locator('#source-check').click();await page.locator('.source-option-group').first().waitFor();
 assert.equal(await page.locator('[data-source-group-by]').inputValue(),'option');assert.equal(await page.locator('.source-option-group').count(),4);
 assert.match(await page.locator('.source-option-group').first().textContent(),/2 个链接 \/ 2 套配置/);
 await page.screenshot({path:path.join(out,'grouped-preview.png')});
 await page.locator('#mount').evaluate(el=>el.style.maxWidth='650px');await page.screenshot({path:path.join(out,'grouped-preview-compact.png')});await page.locator('#mount').evaluate(el=>el.style.maxWidth='');
 await page.locator('[data-source-retain-all]').check();assert.equal(await page.locator('[data-source-retain]:checked').count(),6);assert.match(await page.locator('[data-source-sync-message]').textContent(),/3 项差异/);
 await page.locator('[data-source-retain-group="0"]').uncheck();assert.equal(await page.locator('[data-source-retain]:checked').count(),4);
 assert.equal(await page.locator('[data-source-retain-all]').evaluate(el=>el.indeterminate),true);
 await page.locator('[data-source-expand]').click();assert.equal(await page.locator('.source-diff-item:not([open])').count(),0);
 await page.locator('[data-source-retain]').first().check();assert.equal(await page.locator('[data-source-retain-group="0"]').evaluate(el=>el.indeterminate),true);
 await page.locator('[data-source-group-by]').selectOption('link');assert.equal(await page.locator('[data-source-retain]:checked').count(),5);
 await page.locator('.source-scope summary').click();await page.locator('[data-source-link][value="p2"]').uncheck();
 await page.locator('[data-source-retain-all]').uncheck();
 await page.locator('[data-source-group-by]').selectOption('option');assert.equal(await page.locator('[data-source-retain]:checked').count(),0);
 await page.locator('[data-source-link][value="p2"]').check();assert.equal(await page.locator('[data-source-retain]:checked').count(),1,'Excluded link retains its own choices');
 await page.locator('[data-source-link][value="p2"]').uncheck();
 await page.locator('[data-source-none]').click();assert.equal(await page.locator('#source-apply').isDisabled(),true);assert.equal(await page.locator('[data-source-retain-all]').isDisabled(),true);
 await page.locator('[data-source-link][value="p1"]').check();await page.locator('#source-apply').click();
 const result=await page.evaluate(()=>window.fixture);assert.equal(result.applied.length,1);assert.equal(result.applied[0].changes.length,2);
 assert.deepEqual(result.configs[1],result.original[1]);
 for(const i of [0,2]){assert.equal(result.configs[i].parts[0].name,result.row.name);assert.equal(result.configs[i].parts[0].tax,200);assert.match(result.configs[i].parts[0].upgrade,/199/);assert.deepEqual(result.configs[i].actualParts,result.original[i].actualParts);assert.deepEqual(result.configs[i].addons,result.original[i].addons);}
 assert.deepEqual(errors,[]);
 const report={passed:true,groupedEqualOptions:true,differentOriginalDescriptionsSeparated:true,globalRetain:true,groupRetain:true,individualOverride:true,triState:true,viewSwitchPreservesSelection:true,excludedLinkPreserved:true,taxStillUpdates:true,actualPartsAndManualAddonsPreserved:true,errors};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
