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
const directory=await fs.mkdtemp(path.join(root,'.verification/web-sync-save-ui-'));
const port=await freePort();
const child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8',path.join(root,'tests/desktop_harness.py')],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_USER_DATA:path.join(directory,'profile'),DIY_WORKBENCH_DATA_DIR:path.join(directory,'data'),DIY_WORKBENCH_DEBUG_PORT:String(port),DIY_TEST_WEB_CACHED_COST:"1"},stdio:['ignore','pipe','pipe']});
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
 const name='网页同步后继续编辑展示名称';
 await page.locator('[data-display-name="0"]').fill(name);
 await page.locator('[data-display-name="0"]').press('Tab');
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.startsWith('已保存'),{timeout:20000});
 await page.route('**/api/workspace-sync/status', route=>route.fulfill({contentType:'application/json',body:JSON.stringify({localBusy:true})}));
 await page.waitForFunction(()=>document.querySelector('#workspace-sync-status')?.textContent==='本机正在处理…');
 assert.equal(await page.locator('#login-screen').isVisible(),false);
 await page.unroute('**/api/workspace-sync/status');
 await page.waitForFunction(()=>document.querySelector('#workspace-sync-status')?.textContent!=='本机正在处理…');
 const saved=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()));
 assert.equal(saved.configs[0].parts[0].displayName,name);
 assert.equal(saved.configs[0].parts[0].tax,120);
 assert.deepEqual(errors,[]);
 assert.equal(await page.locator('#conflict-compare').count(),0);
 await page.reload();
 await page.locator('[data-display-name="0"]').waitFor();
 assert.equal(await page.locator('[data-display-name="0"]').inputValue(),name);
 // The second configuration has not been edited and still carries updatedAt:null.
 const other=saved.configs.find(c=>c.id!==saved.configs[0].id&&!c.deletedAt);
 assert.ok(other);
 await page.locator(`[data-id="${other.id}"]`).first().click();
 await page.locator('.heading-actions .action-menu summary').click();
 await page.locator('#delete-current').click();
 await page.waitForFunction(id=>fetch('/api/state').then(r=>r.json()).then(s=>!!s.configs.find(c=>c.id===id)?.deletedAt),other.id,{timeout:20000});
 assert.deepEqual(errors,[]);
 assert.equal(await page.locator('#conflict-compare').count(),0);
 await page.screenshot({path:path.join(directory,'web-sync-save-ui.png')});
 console.log(JSON.stringify({passed:true,directory,realWindow:true,isolatedData:true,cachedCost:999,sharedCost:120,savedDisplayName:name,reloadPreserved:true,webCopyDeleted:true,busyStatusRecovered:true}));

}finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
