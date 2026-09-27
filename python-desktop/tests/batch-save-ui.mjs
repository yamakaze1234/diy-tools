import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import net from 'node:net';
const root=path.resolve('python-desktop');
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
await fs.mkdir(path.join(root,'.verification'),{recursive:true});
const directory=await fs.mkdtemp(path.join(root,'.verification/batch-save-ui-'));
const port=await freePort();
const child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8',path.join(root,'tests/desktop_harness.py')],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_USER_DATA:path.join(directory,'profile'),DIY_WORKBENCH_DATA_DIR:path.join(directory,'data'),DIY_WORKBENCH_DEBUG_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
let browser,page;
const sdk=`let session=JSON.parse(localStorage.getItem('synthetic-sdk-session')||'null');export default {init(){return {auth:{onAuthStateChange(){},async signInWithPassword(v){session={access_token:v.username,user:{is_anonymous:false}};localStorage.setItem('synthetic-sdk-session',JSON.stringify(session));return{data:{session}};},async getSession(){return{data:{session}}},async signOut(){session=null;return{}}}}}};`;
try{
 for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break;}catch{}if(child.exitCode!==null)throw Error('Desktop failed: '+logs);await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const context=browser.contexts()[0];page=context.pages()[0]||await context.waitForEvent('page');await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
 await page.route('**/vendor/cloudbase.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));await page.reload();
 await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');await page.locator('[name=username]').fill('A');await page.locator('[name=password]').fill('synthetic');await page.locator('#startup-login button').click();await page.locator('#login-screen').waitFor({state:'hidden',timeout:15000});
 await page.waitForFunction(()=>document.querySelector('[data-config=name]')?.value==='配置1',{timeout:20000});
 const writes=[],images=[],errors=[];
 page.on('response',r=>{if(r.request().method()==='POST'&&r.url().includes('/api/')){const pathname=new URL(r.url()).pathname;if(pathname==='/api/image')images.push(r.status());if(pathname==='/api/configs/batch'||pathname==='/api/state'){writes.push({path:pathname,status:r.status()});if(r.status()!==200)errors.push(r.status());}}});
 const state=()=>page.evaluate(()=>fetch('/api/state').then(r=>r.json()));
 const initial=await state(),target=initial.configs.find(c=>c.parts.some(p=>p.goodsId==='123'));
 assert.ok(target);
 const quantities=[];
 for(const [scope,qty] of [['actual',2],['display',3],['both',4]]){
  if(await page.locator('#dialog').evaluate(d=>d.open))await page.locator('#dialog .close').click();
  const more=page.locator('.maintenance-tools');if(!await more.evaluate(d=>d.open))await more.locator(':scope > summary').click();
  await page.locator('#link-parts').click();
  await page.locator('#link-part-display').setChecked(scope!=='actual');
  await page.locator('#link-part-actual').setChecked(scope!=='display');
  await page.locator('[data-rule-query]').fill('123');await page.locator('[data-rule-match]').selectOption('id:123');
  await page.locator('[data-product-query]').fill('123');await page.locator('[data-product-id="optimized"]').click();
  await page.locator('[data-rule-qty]').fill(String(qty));await page.locator('#link-part-preview').click();
  const before=await state(),imageCount=images.length;
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/configs/batch'));
  await page.locator('#link-part-apply').click();
  const reply=await response;assert.equal(reply.status(),200,await reply.text());
  await page.locator('#link-part-apply').waitFor({state:'detached'});
  const after=await state(),saved=after.configs.find(c=>c.id===target.id),old=before.configs.find(c=>c.id===target.id);
  if(scope==='actual'){assert.deepEqual(saved.parts,old.parts);assert.equal(saved.actualParts.find(p=>p.goodsId==='123').qty,qty);
   await new Promise(r=>setTimeout(r,3800));assert.equal(images.length,imageCount,'Actual-only batch must not render images');
  }else if(scope==='display'){assert.deepEqual(saved.actualParts,old.actualParts);assert.equal(saved.parts.find(p=>p.goodsId==='123').qty,qty);}
  else{assert.equal(saved.parts.find(p=>p.goodsId==='123').qty,qty);assert.equal(saved.actualParts.find(p=>p.goodsId==='123').qty,qty);}
  for(const c of before.configs.filter(c=>c.id!==target.id))assert.deepEqual(after.configs.find(r=>r.id===c.id),c);
  quantities.push({scope,display:saved.parts[0].qty,actual:saved.actualParts[0].qty});
 }
 const persisted=await state();await page.reload();await page.locator('#new-product').waitFor();
 assert.deepEqual((await state()).configs,persisted.configs);assert.deepEqual(errors,[]);
 assert.equal(writes.filter(r=>r.path==='/api/configs/batch').length,3);
 await page.screenshot({path:path.join(directory,'batch-save-ui.png')});
 console.log(JSON.stringify({passed:true,directory,realWindow:true,isolatedData:true,scopeResults:quantities,actualOnlySkippedImages:true,reloadPreserved:true,writes}));
}finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
