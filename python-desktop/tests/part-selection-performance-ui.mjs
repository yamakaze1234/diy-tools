import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import net from 'node:net';
const root=path.resolve('python-desktop');
const catalogSize=Number(process.env.DIY_PERF_ROWS||6000),configSize=Number(process.env.DIY_PERF_CONFIGS||1000);
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
await fs.mkdir(path.join(root,'.verification'),{recursive:true});
const directory=await fs.mkdtemp(path.join(root,'.verification/part-selection-perf-'));
const port=await freePort();
const child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8',path.join(root,'tests/desktop_harness.py')],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_PORT:'0',DIY_WORKBENCH_USER_DATA:path.join(directory,'profile'),DIY_WORKBENCH_DATA_DIR:path.join(directory,'data'),DIY_WORKBENCH_DEBUG_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
let browser,page;
const sdk=`let session=JSON.parse(localStorage.getItem('synthetic-sdk-session')||'null');export default {init(){return {auth:{onAuthStateChange(){},async signInWithPassword(v){session={access_token:v.username,user:{is_anonymous:false}};localStorage.setItem('synthetic-sdk-session',JSON.stringify(session));return{data:{session}};},async getSession(){return{data:{session}}},async signOut(){session=null;return{}}}}}};`;
try{
 for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break;}catch{}if(child.exitCode!==null)throw Error('Desktop failed: '+logs);await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const context=browser.contexts()[0];page=context.pages()[0]||await context.waitForEvent('page');await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
 const label=process.env.DIY_SEARCH_LABEL||'after';
 if(label==='before'){const build=JSON.parse(await fs.readFile(path.join(root,'verification/latest-build.json'),'utf8'));for(const name of ['app.js','product-search.js'])await page.route('**/'+name,r=>r.fulfill({contentType:'text/javascript',path:path.join(build.directory,'_internal/web',name)}));}
 if(label!=='before')for(const name of ['app.js','product-search.js'])await page.route('**/'+name,r=>r.fulfill({contentType:'text/javascript',path:path.resolve('prototype',name)}));
 await page.route('**/vendor/cloudbase.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));await page.reload();
 await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');await page.locator('[name=username]').fill('A');await page.locator('[name=password]').fill('synthetic');await page.locator('#startup-login button').click();await page.locator('#login-screen').waitFor({state:'hidden',timeout:15000});
 await page.waitForFunction(()=>document.querySelector('[data-config=name]')?.value==='配置1',{timeout:20000});
 const state=()=>page.evaluate(()=>fetch('/api/state').then(r=>r.json()));
 await page.evaluate(async({catalogSize,configSize})=>{
  const before=await fetch('/api/state').then(r=>r.json()),next=structuredClone(before),base=next.configs[0];
  next.templates=[];next.configs=Array.from({length:configSize},(_,i)=>({...structuredClone(base),id:'perf-config-'+i,shopId:'intel',productId:'perf-group-'+Math.floor(i/25),product:'测试链接'+Math.floor(i/25),name:'配置'+i}));
  next.sourceCatalog=Array.from({length:catalogSize},(_,i)=>({sourceId:'perf-source-'+i,shopId:'intel',goodsId:String(100000+i),name:'性能测试配件 '+i,tax:100,erp:90,upgrade:''}));
  next.costSource=next.sourceCatalog.map(r=>({goodsId:r.goodsId,name:r.name,tax:100,erp:90,stockAvailable:30}));
  const response=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...next,baseState:before,baseRevision:before.revision,message:'isolated performance fixture'})});if(!response.ok)throw Error(await response.text());
 },{catalogSize,configSize});
 await page.reload();await page.locator('[data-part-name]').first().waitFor();
 const timings=await page.evaluate(async catalogSize=>{
  const input=document.querySelector('[data-part-name]');let start=performance.now();input.focus();const focusMs=performance.now()-start;
  start=performance.now();input.value=String(100000+catalogSize-1);input.dispatchEvent(new Event('input',{bubbles:true}));const searchMs=performance.now()-start;while(document.querySelector('.product-results[aria-busy]'))await new Promise(r=>setTimeout(r,1));
  const button=document.querySelector('[data-product-id="perf-source-'+(catalogSize-1)+'"]');if(!button)throw Error('Missing result');
  start=performance.now();button.click();const selectMs=performance.now()-start;await new Promise(requestAnimationFrame);
  return {focusMs,searchMs,selectMs,selectToFrameMs:performance.now()-start};
 },catalogSize);
 await page.locator('#save').click();await page.waitForFunction(id=>fetch('/api/state').then(r=>r.json()).then(s=>s.configs.find(c=>c.id==='perf-config-0')?.parts[0]?.goodsId===id),String(100000+catalogSize-1),{timeout:60000});
 const saved=await state();assert.equal(saved.configs.find(c=>c.id==='perf-config-0').actualParts[0].goodsId,String(100000+catalogSize-1));assert.equal(saved.configs.find(c=>c.id==='perf-config-1').parts[0].goodsId,'123');
 await page.locator('#undo').click();await page.locator('#save').click();await page.waitForFunction(()=>fetch('/api/state').then(r=>r.json()).then(s=>s.configs.find(c=>c.id==='perf-config-0')?.parts[0]?.goodsId==='123'),undefined,{timeout:60000});
 const report={label,realWindow:true,isolatedData:true,configs:configSize,catalogRows:catalogSize,...timings,saveVerified:true,undoVerified:true,otherConfigPreserved:true};
 await fs.writeFile(path.join(root,'verification',`part-selection-${label}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
