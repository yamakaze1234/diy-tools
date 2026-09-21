import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const root=path.resolve('python-desktop');
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const directory=await fs.mkdtemp(path.join(root,'.verification/local-first-')),data=path.join(directory,'data');
const child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8',path.join(root,'tests/local_first_harness.py'),'--headless','--port','0'],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_DATA_DIR:data,DIY_WORKBENCH_USER_DATA:path.join(directory,'profile')},stdio:['ignore','pipe','pipe']});
let logs='',browser;child.stderr.on('data',b=>logs+=b);
const sdk=`let session=null;export default {init(){return {auth:{onAuthStateChange(){},async signInWithPassword(v){session={access_token:v.username,user:{is_anonymous:false}};return{data:{session}};},async getSession(){return{data:{session}}},async signOut(){session=null;return{}}}}}};`;
const report={checks:[],directory};
try{
 const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Startup timeout '+logs)),20000);child.stdout.on('data',b=>{output+=b;const match=output.match(/WORKBENCH_READY (http:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});child.once('exit',code=>reject(Error('Test backend exited '+code+' '+logs)));});
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',r=>r.abort());
 await page.route('**/vendor/cloudbase.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));

 await page.goto(url);await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');await page.locator('[name=username]').fill('A');await page.locator('[name=password]').fill('synthetic');await page.locator('#startup-login button').click();
 await page.waitForFunction(()=>document.querySelector('#add-special-page'));await page.waitForFunction(()=>document.querySelector('#poster').height>500);
 await page.locator('#add-special-page').click();await page.waitForFunction(()=>document.querySelector('[data-config=name]').value==='颜值升级包');
 await page.locator('#poster-title-settings').click();await page.locator('[data-poster-field=name]').uncheck();await page.locator('#poster-titles-save').click();
 await page.waitForFunction(()=>document.querySelector('#save-status').textContent.startsWith('已保存'));
 const current=await page.evaluate(async()=>{const s=await(await fetch('/api/state')).json();return s.configs.find(c=>c.name==='颜值升级包');});
 const check=await page.evaluate(async c=>{const {renderPoster}=await import('/poster.js');const r=await renderPoster(c,700);return {titles:r.textRegions.filter(t=>['header.version','header.subtitle'].includes(t.key)),custom:r.textRegions.find(t=>t.value==='点击预览文字编辑内容')};},current);
 assert.equal(check.titles.length,0);assert.ok(check.custom);report.checks.push('特殊页面可创建并隐藏名称、版本、摘要');
 // Directly click the rendered custom text in the real preview.
 const rect=await page.locator('#poster').boundingBox();const dimensions=await page.locator('#poster').evaluate(c=>({w:c.width,h:c.height}));
 const render=await page.evaluate(async c=>{const {renderPoster}=await import('/poster.js');const r=await renderPoster(c);return {height:r.height,text:r.textRegions.find(t=>t.value==='点击预览文字编辑内容')};},current);
 await page.locator('#poster-stage').click({position:{x:(render.text.x+15)/700*rect.width,y:(render.text.top+8)/render.height*rect.height}});
 await page.locator('#poster-text-content').waitFor();await page.locator('#poster-text-content').fill('升级包仅需 +500元');
 await page.locator('#poster-text-content').evaluate(el=>{el.setSelectionRange(6,11);el.dispatchEvent(new Event('select'));});await page.locator('#text-size').fill('32');
 await page.locator('#poster-inspector details summary').click();await page.locator('[data-module-position=width]').fill('580');await page.locator('[data-module-position=x]').fill('40');
 const circles=await page.locator('.color-swatch').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.width,r.height];}));assert.ok(circles.every(([w,h])=>w===h));
 await page.waitForFunction(()=>document.querySelector('#save-status').textContent.startsWith('已保存'));
 const stored=await page.evaluate(async()=>{const s=await(await fetch('/api/state')).json();return s.configs.find(c=>c.name==='颜值升级包');});
 const style=Object.values(stored.textStyles).find(s=>s.text==='升级包仅需 +500元');assert.ok(style.ranges.some(r=>r.start===6&&r.style.size===32));assert.ok(Object.values(stored.moduleTransforms.long).some(m=>m.width===580&&m.x===40));report.checks.push('选中文字独立字号、模块位置宽度保存、色块保持圆形');
 await page.screenshot({path:path.join(root,'verification/bugfix-0.3.8.png')});
 await page.reload();await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');await page.locator('[name=username]').fill('A');await page.locator('[name=password]').fill('synthetic');await page.locator('#startup-login button').click();await page.waitForFunction(()=>document.querySelector('#add-special-page'));const restored=await page.evaluate(async()=>await(await fetch('/api/state')).json());assert.deepEqual(restored.configs.find(c=>c.id===stored.id).textStyles,stored.textStyles);report.checks.push('刷新后样式与布局保留');
 assert.deepEqual(errors,[]);report.ok=true;report.errors=errors;console.log(JSON.stringify(report,null,2));
}finally{if(browser)await browser.close();child.kill();await new Promise(resolve=>child.once('exit',resolve));await fs.writeFile(path.join(root,'verification/bugfix-0.3.8.json'),JSON.stringify(report,null,2));}
