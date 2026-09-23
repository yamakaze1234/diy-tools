import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const root=path.resolve('prototype');
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://batch.test/**',async route=>{const name=new URL(route.request().url()).pathname;await route.fulfill({contentType:name==='/'?'text/html':'text/javascript',body:name==='/'?'<meta charset="utf-8"><div id="dialog-body"></div>':await fs.readFile(path.join(root,name))});});
 await page.goto('https://batch.test/');
 await page.evaluate(async()=>{
  const {openUpgradeDescriptionBatch,applyReplacement}=await import('/global-batch.js');
  const part={slot:'CPU',goodsId:'100',name:'原配件',upgrade:'旧说明'};
  window.configs=['a','b'].map(id=>({id,productId:id,product:'链接'+id,name:'配置'+id,parts:[structuredClone(part)],actualParts:[structuredClone(part)],addons:[{text:'手动加购'}]}));
  openUpgradeDescriptionBatch({openDialog:(_title,html)=>document.querySelector('#dialog-body').innerHTML=html,getConfigs:()=>window.configs,esc:value=>String(value),apply:async plan=>applyReplacement(plan,window.configs)});
 });
 await page.locator('#upgrade-batch-query').fill('100');await page.locator('[data-upgrade-part]').click();
 await page.locator('[data-upgrade-link][value=b]').uncheck();await page.locator('#upgrade-batch-text').fill('新说明');
 await page.locator('#upgrade-batch-preview').click();assert.match(await page.locator('#upgrade-batch-diff').textContent(),/旧说明 → 新说明/);
 await page.locator('#upgrade-batch-apply').click();
 assert.equal(await page.evaluate(()=>configs[0].parts[0].upgrade),'新说明');
 assert.equal(await page.evaluate(()=>configs[1].parts[0].upgrade),'旧说明');
 assert.equal(await page.evaluate(()=>configs[0].addons[0].text),'手动加购');
 assert.equal(await page.evaluate(()=>configs[0].actualParts[0].upgrade),'旧说明');
 assert.deepEqual(errors,[]);console.log('PASS: batch UI edits only selected matching part descriptions');
}finally{await browser.close();}
