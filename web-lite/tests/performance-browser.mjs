import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {createDemo} from '../model.mjs';
import {initializeSources} from '../addon-model.mjs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/d1832/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const baseline=process.argv.includes('--baseline');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const state=createDemo();initializeSources(state);state.cloud=true;
 for(let i=0;i<5000;i++){const goodsId=String(700000+i);state.catalog.push({goodsId,slot:'CPU',name:'大目录处理器 '+i,erp:100,tax:90,stockAvailable:10});for(const s of state.shops)state.sources.push({sourceId:s.id+':'+goodsId,goodsId,shopId:s.id,name:s.short+' 专用处理器 '+i,upgrade:'',addons:[]});}
 await page.goto('http://127.0.0.1:4196');await page.evaluate(state=>localStorage.setItem('diy-web-lite-prototype-v1',JSON.stringify(state)),state);await page.reload();
 const measure=selector=>page.evaluate(async selector=>{const t=performance.now();document.querySelector(selector).click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return Math.round(performance.now()-t);},selector);
 const costsMs=await measure('[data-action="nav-costs"]'),costRows=await page.locator('#cost-rows tr').count();
 await page.locator('#cost-query').fill('704999');await page.waitForTimeout(200);assert.ok((await page.locator('#cost-rows').innerText()).includes('704999'));
 await page.locator('[data-action="nav-overview"]').click();await page.locator('#overview-rows [data-action="edit"]').first().click();const pickerMs=await measure('[data-action="pick-part"][data-index="0"]'),pickerRows=await page.locator('.part-option').count();
 await page.locator('#part-query').fill('704999');await page.waitForTimeout(200);assert.ok((await page.locator('#part-options').innerText()).includes('704999'));await page.locator('dialog [data-action="close"]').first().click();
 await page.locator('[data-action="addon-part"][data-index="4"]').click();const options=await page.locator('[data-addon-item="goodsId"] option').count();
 if(!baseline){assert.ok(costRows<=50);assert.ok(pickerRows<=60);assert.ok(options<=62);await page.locator('[data-addon-search]').fill('704999');await page.waitForTimeout(200);await page.locator('[data-addon-item="goodsId"]').selectOption('704999');await page.getByRole('button',{name:'保存本配置加购',exact:true}).click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('diy-web-lite-prototype-v1')).drafts.c1.actualParts[4].addonOverride.addons[0].items[0].goodsId),'704999');}
 assert.deepEqual(errors,[]);const result={catalog:state.catalog.length,sources:state.sources.length,costsMs,costRows,pickerMs,pickerRows,addonOptions:options,errors};console.log(JSON.stringify(result));await writeFile(new URL('../verification/performance-'+(baseline?'before':'after')+'.json',import.meta.url),JSON.stringify(result,null,2));
}finally{await browser.close();}
