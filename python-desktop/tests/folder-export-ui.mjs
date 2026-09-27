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
const directory=await fs.mkdtemp(path.join(root,'.verification/folder-export-ui-'));
const port=await freePort();
const exportDirectory=path.join(directory,'exports');await fs.mkdir(exportDirectory);

const child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8',path.join(root,'tests/folder_export_harness.py')],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_USER_DATA:path.join(directory,'profile'),DIY_WORKBENCH_DATA_DIR:path.join(directory,'data'),DIY_WORKBENCH_DEBUG_PORT:String(port),DIY_TEST_EXPORT_DIRECTORY:exportDirectory},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
let browser,page;
const sdk=`let session=JSON.parse(localStorage.getItem('synthetic-sdk-session')||'null');export default {init(){return {auth:{onAuthStateChange(){},async signInWithPassword(v){session={access_token:v.username,user:{is_anonymous:false}};localStorage.setItem('synthetic-sdk-session',JSON.stringify(session));return{data:{session}};},async getSession(){return{data:{session}}},async signOut(){session=null;return{}}}}}};`;
try{
 for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break;}catch{}if(child.exitCode!==null)throw Error('Desktop failed: '+logs);await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const context=browser.contexts()[0];page=context.pages()[0]||await context.waitForEvent('page');await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
 await page.route('**/vendor/cloudbase.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));await page.reload();
 await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');await page.locator('[name=username]').fill('A');await page.locator('[name=password]').fill('synthetic');await page.locator('#startup-login button').click();await page.locator('#login-screen').waitFor({state:'hidden',timeout:15000});
 await page.waitForFunction(()=>document.querySelector('[data-config=name]')?.value==='配置1',{timeout:20000});
 const errors=[],downloads=[];page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()));
 await page.waitForFunction(()=>typeof window.pywebview?.api?.export_image_folder==='function');
 await page.locator('#select-all').check();await page.locator('#batch-export').click();
 await page.waitForFunction(()=>document.querySelector('#export-progress')?.textContent.includes('保存位置：'),undefined,{timeout:30000});
 const folders=await fs.readdir(exportDirectory);assert.equal(folders.length,1);
 const output=path.join(exportDirectory,folders[0]),names=await fs.readdir(output);
 assert.deepEqual(names.sort(),['1.png','2.png','3.png','导出清单.json'].sort());
 for(const file of names.filter(n=>n.endsWith('.png'))){const png=await fs.readFile(path.join(output,file));assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');}
 const manifest=JSON.parse(await fs.readFile(path.join(output,'导出清单.json'),'utf8'));assert.equal(manifest.success.length,3);assert.deepEqual(manifest.failures,[]);
 assert.deepEqual(downloads,[]);assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(directory,'folder-export-ui.png')});
 const report={passed:true,directory,output,realWindow:true,isolatedData:true,nativeBridge:true,folderPicker:'synthetic selection',pngCount:3,zipDownloads:0,manifest:true};
 await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
