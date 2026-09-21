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


 await page.setViewportSize({width:1600,height:1000});
 const stateUrl=new URL('/api/state',page.url()).href;
 const getState=async()=>await(await page.request.get(stateUrl)).json();
 await page.evaluate(()=>window.workbenchBeforeQuit());
 assert.equal(await page.locator('[data-tab=actual]').innerText(),'实际配置');
 assert.equal(await page.locator('[data-nav=exports]').count(),0);
 assert.equal(await page.locator('#cost-summary details').count(),0);
 assert.equal(await page.locator('#installment').count(),0);
 assert.equal(await page.locator('#erp-total').isVisible(),true);
 assert.equal(await page.locator('#product-panel #overview').isVisible(),true);
 assert.equal(await page.locator('#product-panel #copy-open').isVisible(),true);
 await page.locator('#overview').click();for(const id of ['overview-copy','overview-price-copy','overview-import-price'])assert.equal(await page.locator('#'+id).isVisible(),true);
 await page.locator('#overview-import-price').click();assert.match(await page.locator('#dialog-title').innerText(),/价格/);await page.locator('#dialog .close').click();
 await page.locator('#copy-open').click();assert.equal(await page.locator('#copy-preview').isVisible(),true);await page.locator('#dialog .close').click();
 await page.locator('#edit-product').click();await page.locator('#product-installment').selectOption('12');await page.locator('#product-apply').click();
 await page.locator('#arrival-price').fill('1000');await page.evaluate(()=>window.workbenchBeforeQuit());
 let state=await getState(),firstProduct=state.configs[0].productId;
 assert.ok(state.configs.filter(c=>c.productId===firstProduct).every(c=>c.installment===12));
 assert.match(await page.locator('#installment-label').innerText(),/12 期/);assert.match(await page.locator('#installment-fee').innerText(),/60.00/);
 await page.reload();await page.locator('#edit-product').waitFor();assert.match(await page.locator('#installment-label').innerText(),/12 期/);
 await page.locator('#add-empty').click();await page.evaluate(()=>window.workbenchBeforeQuit());state=await getState();assert.ok(state.configs.filter(c=>c.productId===firstProduct).every(c=>c.installment===12));
 await page.locator('#new-product').click();await page.locator('#product-name').fill('24期测试商品');await page.locator('#product-installment').selectOption('24');await page.locator('#product-apply').click();await page.evaluate(()=>window.workbenchBeforeQuit());state=await getState();assert.equal(state.configs.find(c=>c.product==='24期测试商品').installment,24);assert.ok(state.configs.filter(c=>c.productId===firstProduct).every(c=>c.installment===12));
 const savedName=await page.locator('[data-config=name]').inputValue();
 const versions=await(await page.request.get(new URL('/api/versions',page.url()).href)).json();const restoreId=versions.versions[0].id;
 await page.locator('[data-config=name]').fill('准备还原的临时改名');await page.evaluate(()=>window.workbenchBeforeQuit());
 await page.locator('#workspace-sync').click();await page.locator('#cloud-restore').click();await page.getByRole('heading',{name:'还原配置',exact:true}).waitFor();
 await page.locator('[data-version="'+restoreId+'"]').click();await page.locator('#version-apply').waitFor();assert.match(await page.locator('#dialog-title').innerText(),/还原版本预览/);
 await page.locator('#version-apply').click();await page.getByRole('heading',{name:'还原配置',exact:true}).waitFor();await page.locator('#dialog .close').click();
 state=await getState();assert.equal(state.configs.find(c=>c.product==='24期测试商品').name,savedName);assert.ok(state.logs.some(l=>l.message.includes('还原历史版本')));
 await page.locator('#workspace-tools>summary').click();assert.equal(await page.locator('[data-nav=source]').innerText(),'输出源维护');await page.locator('#workspace-tools>summary').click();
 await page.screenshot({path:path.join(root,'verification/change-doc-main.png')});
 await page.locator('#edit-product').click();await page.screenshot({path:path.join(root,'verification/change-doc-product.png')});await page.locator('#dialog .close').click();
 await page.locator('#workspace-sync').click();await page.locator('#cloud-restore').waitFor();await page.screenshot({path:path.join(root,'verification/change-doc-restore.png')});await page.locator('#dialog .close').click();
 for(const width of [1366,1920,900]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);}
 assert.deepEqual(errors,[]);
 const result={passed:true,directory,checks:['actual config label','expanded costs','product overview and price sync','maintenance export','link installments saved and reloaded','new configs inherit link installment','other links unaffected','history preview and restore with log','source label','responsive layout'],syntheticCloud:true,realCloudWrites:false};
 await fs.writeFile(path.join(root,'verification/change-doc-ui.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({message:error.message,checks,errors,logs}));if(page)console.error(await page.locator('body').innerText().catch(()=>''));throw error;}
finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
