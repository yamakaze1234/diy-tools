// Isolated check of the real template dialog handler with a delayed save receipt.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const app=await fs.readFile(path.join(root,'app.js'),'utf8');
const dialogCode=app.slice(app.indexOf('function openTemplates(){'),app.indexOf('async function exportCurrent(){'));
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage();
 await page.route('https://template.test/**',async route=>{
  const name=new URL(route.request().url()).pathname;
  await route.fulfill({contentType:name==='/'?'text/html':'text/javascript',body:name==='/'?'<div id="dialog-body"></div>':await fs.readFile(path.join(root,name))});
 });
 await page.goto('https://template.test/');
 await page.evaluate(async code=>{
  const core={...await import('/core.js'),...await import('/config-capacity.js')};
  const setup=new Function('core',`
   const {clone,templateConfigs,importTemplateConfigs,productGroups,blankConfig,configCapacityMessage}=core;
   const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],esc=String;
   const activeShopId='intel',p={id:'target',name:'目标商品',shopId:'intel',configs:[]};
   const placeholder={...blankConfig(null,p),emptyLinkDraft:true};
   let state={configs:[placeholder],templates:[{id:'t',name:'模板',shopId:'intel',configs:[{...blankConfig(null,p),name:'配置8'}]}]};
   let selected=new Set(),active=placeholder.id,pendingImages=new Set(),collapsedProducts=new Set(),calls=0,checkpoints=0,release;
   const available=()=>state.configs.filter(c=>!c.deletedAt),currentProduct=()=>productGroups(available())[0],currentShop=()=>({name:'测试店'});
   const suggestedName=c=>c.name,openProduct=()=>{},openDialog=(title,html)=>$('#dialog-body').innerHTML=html,closeDialog=()=>{},renderAll=()=>{},changed=()=>{},toast=()=>{},checkpoint=()=>checkpoints++;
   const save=async()=>{calls++;if(calls===1)await new Promise((resolve,reject)=>release={resolve:()=>{state=structuredClone(state);state.configs[0].workspaceOrder=10;resolve();},reject});};
   ${code}
   openTemplates();
   window.fixture={snapshot:()=>({calls,checkpoints,configs:structuredClone(state.configs)}),release:()=>release.resolve(),fail:()=>release.reject(Error('保存失败'))};
  `);setup(core);
 },dialogCode);
 await page.locator('.template-choice').check();
 await page.locator('#template-use').click();
 let snapshot=await page.evaluate(()=>window.fixture.snapshot());
 assert.equal(snapshot.calls,1);assert.equal(snapshot.checkpoints,0);assert.equal(snapshot.configs.length,1);assert.equal(snapshot.configs[0].emptyLinkDraft,true);
 await page.evaluate(()=>{document.querySelector('#template-use').onclick();window.fixture.release();});
 await page.waitForFunction(()=>window.fixture.snapshot().calls===2);
 snapshot=await page.evaluate(()=>window.fixture.snapshot());
 assert.equal(snapshot.checkpoints,1);assert.equal(snapshot.configs.length,1);assert.equal(snapshot.configs[0].name,'配置1');assert.equal(snapshot.configs[0].workspaceOrder,11);assert.equal(snapshot.configs[0].version,'进阶版');assert.equal(snapshot.configs[0].emptyLinkDraft,undefined);
 console.log(JSON.stringify({passed:true,waitsForReceipt:true,usesLatestTarget:true,duplicateClickIgnored:true,sequentialName:true,savedImmediately:true}));
}finally{await browser.close();}
