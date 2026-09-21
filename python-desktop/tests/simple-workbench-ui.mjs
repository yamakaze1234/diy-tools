import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import net from 'node:net';
const root=path.resolve('python-desktop'),{chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
await fs.mkdir(path.join(root,'.verification'),{recursive:true});
const directory=await fs.mkdtemp(path.join(root,'.verification/desktop-')),profile=path.join(directory,'profile'),data=path.join(directory,'data'),debugPort=await freePort();
const child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8',path.join(root,'tests/desktop_harness.py'),'--port','0'],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_USER_DATA:profile,DIY_WORKBENCH_DATA_DIR:data,DIY_WORKBENCH_DEBUG_PORT:String(debugPort)},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);const exited=new Promise(resolve=>child.on('exit',code=>resolve(code)));let browser,page;const checks=[],errors=[];
const sdk=`let session=JSON.parse(localStorage.getItem('synthetic-sdk-session')||'null');export default {init(){return {auth:{onAuthStateChange(){},async signInWithPassword(v){if(v.password!=='synthetic')return{error:{message:'账号或密码错误'}};session={access_token:v.username,user:{is_anonymous:false}};localStorage.setItem('synthetic-sdk-session',JSON.stringify(session));return{data:{session}};},async getSession(){return{data:{session}}},async signOut(){session=null;localStorage.removeItem('synthetic-sdk-session');return{}}}}}};`;
try{
 for(let i=0;i<120;i++){try{const response=await fetch(`http://127.0.0.1:${debugPort}/json/version`);if(response.ok)break;}catch{}if(child.exitCode!==null)throw Error('Desktop failed: '+logs);await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);const context=browser.contexts()[0];page=context.pages()[0]||await context.waitForEvent('page');await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);page.on('pageerror',e=>errors.push(e.message));await page.route('**/vendor/cloudbase.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));await page.reload();await page.locator('#startup-login').waitFor();assert.equal(await page.locator('.workspace').isVisible(),false);assert.equal((await page.request.get(new URL('/api/state',page.url()).href)).status(),401);checks.push('Python 原生窗口显示原界面；未登录不可读取业务数据');
 const login=async uid=>{await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');await page.locator('[name=username]').fill(uid);await page.locator('[name=password]').fill('synthetic');await page.locator('#startup-login button').click();await page.locator('#login-screen').waitFor({state:'hidden',timeout:15000});};await login('A');await page.waitForFunction(()=>document.querySelector('[data-config=name]')?.value==='配置1',{timeout:20000});checks.push('新电脑登录后由 Python 自动下载配置并显示');


 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>window.workbenchBeforeQuit());
 const stateUrl=new URL('/api/state',page.url()).href;
 const before=await(await page.request.get(stateUrl)).json();
 assert.equal(await page.locator('#workspace-tools').getAttribute('open'),null);
 assert.equal(await page.locator('.top-right #erp-sync').isVisible(),true);assert.equal(await page.locator('.top-right #erp-setup').isVisible(),true);
 assert.equal(await page.locator('[data-config=spu]').isVisible(),false);
 assert.equal(await page.locator('#arrival-price').isVisible(),true);
 await page.screenshot({path:path.join(root,'verification/simple-workbench-1440.png')});
 await page.locator('#workspace-tools>summary').click();
 for(const id of ['erp-sync','erp-setup','global-batch-open','inventory-check-open','inventory-export-open','logs-open'])assert.equal(await page.locator('#'+id).isVisible(),true,id);
 await page.locator('[data-nav="cost-source"]').click();await page.locator('#dialog[open]').waitFor();await page.locator('#dialog .close').click();
 await page.locator('#workspace-tools>summary').click();
 await page.locator('.identity-extra>summary').click();assert.equal(await page.locator('[data-config=skuId]').isVisible(),true);
 await page.locator('.identity-extra>summary').click();
 await page.locator('.maintenance-tools>summary').click();await page.locator('#ids').click();await page.locator('#dialog[open]').waitFor();await page.locator('#dialog .close').click();await page.locator('.maintenance-tools>summary').click();
 assert.equal(await page.locator('#installment-label').isVisible(),true);assert.equal(await page.locator('#erp-total').isVisible(),true);
 for(const tab of ['actual','addons','modules','costs','parts']){await page.locator('[data-tab="'+tab+'"]').click();assert.ok((await page.locator('#editor').innerText()).length>0);}
 await page.locator('.heading-actions .action-menu>summary').click();assert.equal(await page.locator('#copy-shop').isVisible(),true);await page.keyboard.press('Escape');
 await page.locator('.image-settings>summary').click();assert.equal(await page.locator('#layout').isVisible(),true);await page.locator('.image-settings>summary').click();
 await page.locator('#preview-expand').click();await page.locator('.canvas-tools>summary').click();assert.equal(await page.locator('#poster-add-image').isVisible(),true);assert.equal(await page.locator('#poster-auto-layout').isVisible(),true);await page.screenshot({path:path.join(root,'verification/simple-workbench-expanded.png')});await page.locator('.canvas-tools>summary').click();await page.keyboard.press('Escape');
 await page.evaluate(()=>window.workbenchBeforeQuit());
 const after=await(await page.request.get(stateUrl)).json();
 for(const key of ['configs','templates','shopSettings','sourceCatalog','costSource'])assert.deepEqual(after[key],before[key],key+' changed during navigation');
 const downloadPromise=page.waitForEvent('download');await page.locator('#download').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/\.png$/);assert.equal(await download.failure(),null);
 for(const width of [1366,1920,900,600]){
  await page.setViewportSize({width,height:width===1366?768:900});await page.waitForTimeout(150);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow at '+width);
  await page.screenshot({path:path.join(root,'verification/simple-workbench-'+width+'.png')});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('#shop-picker').selectOption('jonsbo');await page.locator('#empty-state').waitFor();assert.equal(await page.locator('#empty-create').isVisible(),true);
 await page.locator('#shop-picker').selectOption('intel');await page.locator('#shop-settings').click();assert.equal(await page.locator('#service-save').isVisible(),true);await page.locator('#dialog .close').click();
 assert.deepEqual(errors,[]);
 const result={passed:true,directory,checks:['collapsed tools accessible','platform fields accessible','batch IDs dialog','cost details','all editor tabs','canvas tools and escape','navigation preserves business data','PNG download','1366/1440/1920/900/600 layout','empty shop','per-shop service settings'],syntheticCloud:true,realCloudWrites:false};
 await fs.writeFile(path.join(root,'verification/simple-workbench-ui.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({message:error.message,checks,errors,logs}));if(page)console.error(await page.locator('body').innerText().catch(()=>''));throw error;}
finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
