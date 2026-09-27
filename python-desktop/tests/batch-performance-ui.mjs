import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import net from 'node:net';
import {sourcesFor} from '../../prototype/shops.js';

const root=path.resolve('python-desktop');
const label=process.env.DIY_BENCH_LABEL||'candidate';
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.join(root,'verification/save-optimization');await fs.mkdir(out,{recursive:true});
const directory=await fs.mkdtemp(path.join(out,`ui-${label}-`));
const state=JSON.parse(await fs.readFile(path.join(process.env.DIY_BENCH_BACKUP_DATA,'state.json'),'utf8'));
const groups=new Map();for(const c of state.configs.filter(c=>!c.deletedAt)){const key=JSON.stringify([c.shopId,c.productId]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
const targets=[...groups.values()].sort((a,b)=>b.length-a.length)[0];
const catalog=sourcesFor(state,targets[0].shopId).filter(c=>!c.deletedAt);
const usage=new Map();for(const c of targets)for(const p of c.parts.filter(p=>p.goodsId)){
 if(!usage.has(p.goodsId))usage.set(p.goodsId,new Set());usage.get(p.goodsId).add(c.id);
}
const goodsId=[...usage].filter(([id])=>catalog.some(c=>c.goodsId===id)).sort((a,b)=>b[1].size-a[1].size)[0][0];
const source=catalog.find(c=>c.goodsId===goodsId);
const quantity=targets[0].parts.find(p=>p.goodsId===goodsId)?.qty+1||2;
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8',path.join(root,'tests/batch_performance_harness.py')],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_USER_DATA:path.join(directory,'profile'),DIY_WORKBENCH_DATA_DIR:path.join(directory,'data'),DIY_WORKBENCH_DEBUG_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);let browser;
const sdk=`let session=JSON.parse(localStorage.getItem('synthetic-sdk-session')||'null');export default {init(){return {auth:{onAuthStateChange(){},async signInWithPassword(v){session={access_token:v.username,user:{is_anonymous:false}};localStorage.setItem('synthetic-sdk-session',JSON.stringify(session));return{data:{session}};},async getSession(){return{data:{session}}},async signOut(){session=null;return{}}}}}};`;
try{
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break;}catch{}if(child.exitCode!==null)throw Error('Desktop exited: '+logs);await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const context=browser.contexts()[0];const page=context.pages()[0]||await context.waitForEvent('page');await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
 page.setDefaultTimeout(90000);
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 await page.route('**/vendor/cloudbase.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));await page.reload();
 await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');
 await page.locator('[name=username]').fill('isolated-benchmark');await page.locator('[name=password]').fill('synthetic');await page.locator('#startup-login button').click();await page.locator('#login-screen').waitFor({state:'hidden'});
 await page.locator('#shop-picker').selectOption(targets[0].shopId);
 const section=page.locator(`[data-list-product="${targets[0].productId}"]`);
 const toggle=section.locator('[data-product-toggle]');if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
 await section.locator(`[data-id="${targets[0].id}"]`).click();
 const batchButton=page.locator('#link-parts');
 await batchButton.locator('xpath=ancestor::details/summary').click();
 await batchButton.click();
 await page.locator('[data-rule-query]').fill(goodsId);await page.locator('[data-rule-match]').selectOption('id:'+goodsId);
 await page.locator('[data-product-query]').fill(goodsId);await page.locator(`[data-product-id="${source.sourceId}"]`).click();
 await page.locator('[data-rule-qty]').fill(String(quantity));
 await page.locator('#link-part-preview').click();
 const writes=[];page.on('response',async r=>{if(r.request().method()==='POST'&&/\/api\/(state|configs\/batch)$/.test(r.url()))writes.push({path:new URL(r.url()).pathname,status:r.status(),requestBytes:Buffer.byteLength(r.request().postData()||'')});});
 const started=performance.now();await page.locator('#link-part-apply').click();
 await page.waitForFunction(()=>!document.querySelector('#link-part-apply')&&document.querySelector('#save-status')?.textContent.startsWith('已保存'),undefined,{timeout:120000});
 const elapsed=performance.now()-started;
 const saved=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()));
 let modified=0;for(const config of saved.configs.filter(c=>targets.some(t=>t.id===c.id))){
  if(!config.parts.some(p=>p.goodsId===goodsId))continue;
  modified++;
  for(const field of ['parts','actualParts'])for(const p of config[field].filter(p=>p.goodsId===goodsId))assert.equal(p.qty,quantity);
 }
 assert.ok(modified>0);assert.ok(writes.length);assert.ok(writes.every(r=>r.status===200));assert.deepEqual(pageErrors,[]);
 await page.screenshot({path:path.join(out,`ui-${label}.png`)});
 const report={label,realWindow:true,productionWrites:false,directory,configs:state.configs.length,scopeSize:targets.length,modified,clickToSavedMs:elapsed,writes,pageErrors};
 await fs.writeFile(path.join(out,`ui-${label}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close().catch(()=>{});if(child.exitCode===null)child.kill();}
