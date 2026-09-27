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
const directory=await fs.mkdtemp(path.join(root,'.verification/wps-special-ui-'));
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
 const errors=[];page.on('response',r=>{if(r.url().endsWith('/api/state')&&r.request().method()==='POST'&&r.status()!==200)errors.push(r.status());});
 await page.locator('#new-product').click();
 await page.locator('#product-name').fill('WPS 特殊配件自动识别验证');
 await page.locator('.wps-import > summary').click();
 await page.locator('[data-wps-text]').fill('0\t1\t不含显卡，可咨询客服加装显卡使用\n0\t1\t支持一对一直播装机 从无到有尽收眼底 包装全保留\n0\t1\t支持DIY升级改配 联系客服核算差价');
 await page.locator('[data-wps-check]').click();
 assert.match(await page.locator('[data-wps-status]').textContent(),/核对后可一次创建/);
 assert.equal(await page.locator('[data-wps-preview] small').filter({hasText:'已自动匹配本店特殊配件'}).count(),3);
 const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.request().method()==='POST');
 await page.locator('#product-apply').click();
 await page.locator('#save').click();
 assert.equal((await savedResponse).status(),200);
 const readSaved=()=>page.evaluate(()=>fetch('/api/state').then(r=>r.json()).then(s=>s.configs.find(c=>c.product==='WPS 特殊配件自动识别验证')));
 const saved=await readSaved();
 assert.equal(saved.parts.length,3);assert.equal(saved.actualParts.length,3);
 for(const part of [...saved.parts,...saved.actualParts]){
  assert.equal(part.specialComponent,true);assert.equal(part.goodsId,'');
  assert.equal(part.erp,0);assert.equal(part.tax,0);assert.ok(part.sourceId.startsWith('special:intel:'));
 }
 assert.deepEqual(errors,[]);assert.equal(await page.locator('#conflict-compare').count(),0);
 await page.locator('[data-tab="actual"]').click();
 assert.equal(await page.locator('#editor small').filter({hasText:'特殊配件 · 成本 ¥0'}).count(),3);
 await page.locator('[data-tab="costs"]').click();
 assert.doesNotMatch(await page.locator('#cost-summary').innerText(),/待补|缺失|未填写/);
 await page.screenshot({path:path.join(directory,'wps-special-costs.png')});
 await page.reload();await page.locator('#new-product').waitFor();
 assert.deepEqual((await readSaved()).actualParts,saved.actualParts);
 console.log(JSON.stringify({passed:true,directory,realWindow:true,isolatedData:true,importedSpecialParts:3,actualPartsZeroCost:true,reloadPreserved:true}));
}finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
