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

 await page.locator('#shop-settings').click();
 assert.equal(await page.locator('#shop-service-text').inputValue(),'官方直营 | 直播装机 | 顺丰包邮 | 保价双11');
 await page.locator('#shop-service-text').fill('英特尔测试承诺');
 await page.locator('#service-save').click();await page.evaluate(()=>window.workbenchBeforeQuit());
 await page.reload();await page.locator('#shop-settings').click();
 assert.equal(await page.locator('#shop-service-text').inputValue(),'英特尔测试承诺');
 await page.locator('#dialog .close').click();
 await page.locator('#add-empty').click();await page.evaluate(()=>window.workbenchBeforeQuit());
 let saved=await(await page.request.get(new URL('/api/state',page.url()).href)).json();
 assert.ok(saved.configs.some(c=>c.modules?.some(m=>m.type==='service'&&m.text==='英特尔测试承诺')));
 await page.locator('#shop-picker').selectOption('jonsbo');await page.locator('#shop-settings').click();
 assert.equal(await page.locator('#shop-service-text').inputValue(),'官方直营 | 直播装机 | 顺丰包邮 | 保价双11');
 await page.locator('#shop-service-text').fill('乔思伯测试承诺');await page.locator('#service-save').click();
 await page.evaluate(()=>window.workbenchBeforeQuit());
 await page.locator('#shop-picker').selectOption('intel');await page.locator('#shop-settings').click();
 assert.equal(await page.locator('#shop-service-text').inputValue(),'英特尔测试承诺');
 await page.locator('#shop-service-text').fill('英特尔更新承诺');await page.locator('#shop-service-existing').check();
 await page.locator('#service-save').click();await page.evaluate(()=>window.workbenchBeforeQuit());
 saved=await(await page.request.get(new URL('/api/state',page.url()).href)).json();
 assert.ok(saved.configs.some(c=>c.modules?.some(m=>m.type==='service'&&m.text==='英特尔更新承诺')));
 assert.equal(saved.shopSettings.jonsbo.serviceText,'乔思伯测试承诺');
 await page.locator('#shop-settings').click();await page.screenshot({path:path.join(root,'verification/service-defaults-ui.png')});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,directory,checks:['default text','save and reload','new blank config','shop isolation','opt-in existing update'],syntheticCloud:true}));
}catch(error){console.error(JSON.stringify({message:error.message,checks,errors,logs}));if(page)console.error(await page.locator('body').innerText().catch(()=>''));throw error;}
finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
