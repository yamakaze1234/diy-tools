import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const root=path.resolve('python-desktop');
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const directory=await fs.mkdtemp(path.join(root,'.verification/ui-refresh-')),data=path.join(directory,'data');
const child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8',path.join(root,'tests/local_first_harness.py'),'--headless','--port','0'],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_DATA_DIR:data,DIY_WORKBENCH_USER_DATA:path.join(directory,'profile')},stdio:['ignore','pipe','pipe']});
let logs='',browser;child.stderr.on('data',b=>logs+=b);
const sdk=`let session=null;export default {init(){return {auth:{onAuthStateChange(){},async signInWithPassword(v){session={access_token:v.username,user:{is_anonymous:false}};return{data:{session}};},async getSession(){return{data:{session}}},async signOut(){session=null;return{}}}}}};`;
const report={directory,checks:[],screens:[]};
try{
 const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Startup timeout '+logs)),20000);child.stdout.on('data',b=>{output+=b;const match=output.match(/WORKBENCH_READY (http:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});child.once('exit',code=>reject(Error('Test backend exited '+code+' '+logs)));});
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',r=>r.abort());await page.route('**/vendor/cloudbase.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
 await page.goto(url);await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');await page.locator('[name=username]').fill('A');await page.locator('[name=password]').fill('synthetic');await page.locator('#startup-login button').click();
 await page.waitForFunction(()=>document.querySelector('[data-config=name]')?.value==='配置1');await page.waitForFunction(()=>document.querySelector('#poster').height>500);
 const screenshot=async name=>{const file=path.join(root,'verification',name+'.png');await page.screenshot({path:file,fullPage:false});report.screens.push(file);};
 const check=async name=>{await page.waitForFunction(()=>[...document.querySelectorAll('.error')].every(n=>n.textContent.trim()||getComputedStyle(n).display==='none'));const result=await page.evaluate(()=>{const d=document.querySelector('#dialog');const body=d.open?document.querySelector('#dialog-body'):document.documentElement;const clipped=[...(d.open?d:document).querySelectorAll('.actions button')].filter(b=>b.getClientRects().length).filter(b=>{const x=b.getBoundingClientRect(),r=body.getBoundingClientRect();return x.left<r.left-1||x.right>r.right+1;}).map(b=>b.textContent);return {overflow:body.scrollWidth>body.clientWidth+2,clipped};});assert.equal(result.overflow,false,name+' horizontal overflow');assert.deepEqual(result.clipped,[],name+' clipped actions');report.checks.push(name);};
 await screenshot('ui-refresh-main');await check('main-1600');
 for(const tab of ['addons','modules','costs','parts']){await page.locator(`[data-tab="${tab}"]`).click();await check('tab-'+tab);}
 for(const [name,selector] of [['sync','#workspace-sync'],['history','#cloud-history'],['source','[data-nav="source"]'],['cost-source','[data-nav="cost-source"]'],['templates','[data-nav="templates"]'],['exports','[data-nav="exports"]'],['gallery','#case-gallery-open'],['inventory','#inventory-export-open'],['batch','#global-batch-open'],['overview','#overview'],['copy','#copy-open'],['sql-settings','#erp-setup'],['new-product','#new-product'],['appearance','#batch-style'],['ids','#ids'],['shop-settings','#shop-settings']]){
  if(name!=='history'&&await page.locator('#dialog').evaluate(d=>d.open))await page.locator('#dialog .close').click();
  await page.locator(selector).click();await page.locator('#dialog[open]').waitFor();await check(name+'-1600');
  if(['sync','history','gallery'].includes(name))await screenshot('ui-refresh-'+name);
 }
 await page.locator('#dialog .close').click();
 await page.locator('.nav-section>summary').click();assert.equal(await page.locator('[data-nav="configs"]').isVisible(),false);await page.locator('.nav-section>summary').click();assert.equal(await page.locator('[data-nav="configs"]').isVisible(),true);report.checks.push('navigation-collapse-expand');
 let starts=0;
 await page.route('**/api/erp-sync/status',r=>starts?r.fulfill({json:{job:{id:'test-job',status:'waiting'},connection:null}}):r.continue());
 await page.route('**/api/erp-sync/start',r=>{starts++;return r.fulfill({json:{job:{id:'test-job',status:'waiting'},connection:null}});});
 await page.locator('#erp-setup').click();await page.locator('#inventory-source').selectOption('browser-script');await page.locator('#erp-script-start').click();await page.waitForFunction(()=>document.querySelector('#erp-script-start')?.disabled);assert.equal(starts,1);await screenshot('ui-refresh-script-sync');await page.locator('#dialog .close').click();report.checks.push('script-sync-start');
 const conflict={type:'configuration',id:'test-conflict',draft:{name:'游戏主机',priceCents:899900,parts:[{slot:'显卡',name:'RTX 5090D',qty:1}]},conflict:{fields:['priceCents','parts'],base:{name:'游戏主机',priceCents:800000},remote:{data:{name:'游戏主机',priceCents:999900,parts:[{slot:'显卡',name:'RTX 5090',qty:1}],deletedAt:'2026-09-17'}}}};
 await page.route('**/api/workspace-sync/status',async r=>{const response=await r.fetch();const status=await response.json();await r.fulfill({json:{...status,conflicts:1}});});
 await page.route('**/api/workspace-sync/conflicts',r=>r.fulfill({json:{records:[conflict]}}));
 let choice;
 await page.route('**/api/workspace-sync/resolve',r=>{choice=r.request().postDataJSON();return r.fulfill({json:{ok:true}});});
 await page.locator('#workspace-sync').click();await page.locator('#cloud-conflicts').click();await page.locator('.conflict-card').waitFor();assert.equal(await page.locator('.conflict-card pre').count(),0);const comparison=await page.locator('.conflict-card').innerText();assert.ok(comparison.includes('8,999.00')&&comparison.includes('RTX 5090D')&&comparison.includes('已删除'));await screenshot('ui-refresh-conflicts');await check('visual-conflicts');
 await page.locator('[data-choice="remote"]').click();await page.locator('#cloud-history').waitFor();assert.deepEqual(choice,{type:'configuration',id:'test-conflict',choice:'remote'});await page.locator('#dialog .close').click();report.checks.push('conflict-choice-payload');
 await page.evaluate(()=>{const p=document.createElement('p');p.id='test-empty-error';p.className='error';p.textContent='   ';document.querySelector('.main').append(p);});
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#test-empty-error')).display==='none');
 await page.evaluate(()=>document.querySelector('#test-empty-error').textContent='真实错误');await page.waitForFunction(()=>getComputedStyle(document.querySelector('#test-empty-error')).display!=='none');
 await page.evaluate(()=>document.querySelector('#test-empty-error').textContent='');await page.waitForFunction(()=>getComputedStyle(document.querySelector('#test-empty-error')).display==='none');report.checks.push('empty-real-cleared-error');
 for(const width of [1280,1100,720]){await page.setViewportSize({width,height:900});await check('main-'+width);await page.locator('#workspace-sync').click();await check('sync-'+width);await screenshot('ui-refresh-sync-'+width);await page.locator('#dialog .close').click();}
 assert.deepEqual(errors,[]);report.pageErrors=errors;console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();child.kill();await new Promise(resolve=>child.once('exit',resolve));await fs.writeFile(path.join(root,'verification/ui-refresh.json'),JSON.stringify(report,null,2));}
