import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('C:/Users/d1832/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve('prototype');
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="UTF-8"><dialog id="dialog"><form><button>关闭</button></form><div id="dialog-body"></div></dialog>');return;}const file=path.resolve(root,'.'+decodeURIComponent(name));if(!file.startsWith(root+path.sep))throw Error('path');res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async()=>{
  const {openSourceEditor}=await import('/source-editor.js'),{sourceBatch}=await import('/source-batch.js');
  let state={configs:[],sourceCatalog:[{sourceId:'source',shopId:'intel',goodsId:'123',name:'测试配件',tax:100,erp:90}],costSource:[{goodsId:'123',name:'测试配件',tax:100,erp:90}]};window.saveCalls=0;
  openSourceEditor({openDialog:(_,html)=>{document.querySelector('#dialog-body').innerHTML=html;document.querySelector('#dialog').showModal();},shopId:()=>'intel',getRows:()=>state.sourceCatalog,getAllRows:()=>state.sourceCatalog,getCosts:()=>state.costSource,getConfigs:()=>state.configs,flush:async()=>{},applyBatch:async changes=>{window.saveCalls++;const result=sourceBatch(state,changes);await new Promise((resolve,reject)=>{window.completeSave=resolve;window.failSave=()=>reject(Error('模拟保存失败'));});state=result.next;window.savedName=state.sourceCatalog[0].name;return result;}});
 });
 await page.locator('#source-name').fill('修改后的名称');await page.locator('#source-save-all').click();await page.waitForFunction(()=>!!window.completeSave);
 assert.match(await page.locator('#source-message').innerText(),/正在保存/);assert.equal(await page.locator('#source-save-all').isDisabled(),true);assert.equal(await page.locator('#source-detail').evaluate(e=>e.inert),true);
 await page.evaluate(()=>window.failSave());await page.waitForFunction(()=>!document.querySelector('#source-save-all').disabled);assert.match(await page.locator('#source-message').innerText(),/修改仍保留/);assert.equal(await page.locator('#source-name').inputValue(),'修改后的名称');
 await page.evaluate(()=>{window.completeSave=null;});await page.locator('#source-save-all').click();await page.waitForFunction(()=>!!window.completeSave);await page.evaluate(()=>window.completeSave());await page.waitForFunction(()=>document.querySelector('#source-message').textContent.includes('已一次保存'));
 assert.equal(await page.evaluate(()=>window.savedName),'修改后的名称');assert.equal(await page.evaluate(()=>window.saveCalls),2);assert.match(await page.locator('#source-pending').innerText(),/暂无待保存/);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({savingFeedback:true,failedDraftPreserved:true,retrySaved:true,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
