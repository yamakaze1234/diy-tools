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
const directory=await fs.mkdtemp(path.join(root,'.verification/packaged-window-'));
const port=await freePort();
const build=JSON.parse(await fs.readFile(path.join(root,'verification/latest-build.json'),'utf8'));
const evidence=path.join(root,'verification',`packaged-window-${build.version}`);
await fs.mkdir(evidence,{recursive:true});
const child=spawn(build.executable,['--port','0'],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_USER_DATA:path.join(directory,'profile'),DIY_WORKBENCH_DATA_DIR:path.join(directory,'data'),DIY_WORKBENCH_DEBUG_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
let browser,page;
const sdk=`let session=JSON.parse(localStorage.getItem('synthetic-sdk-session')||'null');export default {init(){return {auth:{onAuthStateChange(){},async signInWithPassword(v){session={access_token:v.username,user:{is_anonymous:false}};localStorage.setItem('synthetic-sdk-session',JSON.stringify(session));return{data:{session}};},async getSession(){return{data:{session}}},async signOut(){session=null;return{}}}}}};`;
try{
 for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break;}catch{}if(child.exitCode!==null)throw Error('Desktop failed: '+logs);await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const context=browser.contexts()[0];page=context.pages()[0]||await context.waitForEvent('page');await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
 await page.route('**/vendor/cloudbase.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));await page.reload();
 await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');
 await page.waitForFunction(()=>typeof window.pywebview?.api?.export_image_folder==='function');
 assert.equal(await page.locator('[name=username]').inputValue(),'');
 assert.equal(await page.locator('[name=password]').inputValue(),'');
 const unauthorized=await page.evaluate(()=>fetch('/api/state').then(r=>r.status));assert.equal(unauthorized,401);
 let denied=false;try{await page.evaluate(()=>window.pywebview.api.export_image_folder({files:[]}));}catch(error){denied=/登录/.test(error.message);}assert.equal(denied,true,'Packaged native export requires login');
 await page.screenshot({path:path.join(evidence,'packaged-login.png')});
 const report={version:build.version,realWindow:true,isolatedData:true,desktopBridgeLoaded:true,nativeExportLoginGate:true,loginPerformed:false,productionWrites:false,directory};
 await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
