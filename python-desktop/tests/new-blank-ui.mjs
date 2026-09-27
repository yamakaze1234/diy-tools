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
const directory=await fs.mkdtemp(path.join(root,'.verification/new-blank-ui-'));
const port=await freePort();
const child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8',path.join(root,'tests/desktop_harness.py')],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_PORT:'0',DIY_WORKBENCH_USER_DATA:path.join(directory,'profile'),DIY_WORKBENCH_DATA_DIR:path.join(directory,'data'),DIY_WORKBENCH_DEBUG_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
let browser,page;
const sdk=`let session=JSON.parse(localStorage.getItem('synthetic-sdk-session')||'null');export default {init(){return {auth:{onAuthStateChange(){},async signInWithPassword(v){session={access_token:v.username,user:{is_anonymous:false}};localStorage.setItem('synthetic-sdk-session',JSON.stringify(session));return{data:{session}};},async getSession(){return{data:{session}}},async signOut(){session=null;return{}}}}}};`;
try{
 for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break;}catch{}if(child.exitCode!==null)throw Error('Desktop failed: '+logs);await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const context=browser.contexts()[0];page=context.pages()[0]||await context.waitForEvent('page');await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
 await page.route('**/vendor/cloudbase.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));await page.reload();
 await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');await page.locator('[name=username]').fill('A');await page.locator('[name=password]').fill('synthetic');await page.locator('#startup-login button').click();await page.locator('#login-screen').waitFor({state:'hidden',timeout:15000});
 await page.waitForFunction(()=>document.querySelector('[data-config=name]')?.value==='配置1',{timeout:20000});
 const state=()=>page.evaluate(()=>fetch('/api/state').then(r=>r.json()));
 await page.evaluate(async()=>{const before=await fetch('/api/state').then(r=>r.json()),next=structuredClone(before);const c=next.configs[0];c.caseImage='/assets/case.png';c.posterImages=[{id:'fixture-image-1',url:'/assets/case.png',naturalWidth:600,naturalHeight:600,transforms:{}},{id:'fixture-image-2',url:'/assets/workbench-icon-v1.png',naturalWidth:256,naturalHeight:256,transforms:{}}];c.caseTransforms={long:{x:45,y:30,scale:2}};c.modules.push({id:'fixture-custom',type:'custom',title:'旧链接文案',text:'不可继承的自定义模块',visible:true,size:22});const response=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...next,baseState:before,baseRevision:before.revision,message:'synthetic fixture'})});if(!response.ok)throw Error(await response.text());});
 await page.reload();await page.locator('#add-empty').waitFor();
 await page.locator('[data-theme=dark]').evaluate(el=>el.click());await page.locator('#layout').evaluate(el=>{el.value='square';el.dispatchEvent(new Event('change'));});
 await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已保存'));

 const before=await state(),original=before.configs[0];
 await page.locator(`[data-id="${original.id}"]`).first().click();
 await page.locator('[data-group-select]').first().check();
 await page.locator('#add-empty').click();
 // Independent creation must require explicit new-link details, never inherit a selected link.
 await page.locator('#product-name').waitFor();assert.equal(await page.locator('#product-name').inputValue(),'');
 await page.locator('#product-name').fill('独立空白测试');await page.locator('#product-card-color').selectOption('#e4f5e9');
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/state'));
 await page.locator('#product-apply').click();await page.locator('#save').click();
 const receipt=await response;assert.equal(receipt.status(),200,await receipt.text());
 const after=await state(),added=after.configs.filter(c=>!before.configs.some(o=>o.id===c.id));assert.equal(added.length,1);
 const created=added[0];assert.equal(created.productCardColor,'#e4f5e9');assert.equal(created.theme,'light');assert.equal(created.layout,'long');assert.equal(created.fixedInitialFormat,true);assert.notEqual(created.productId,original.productId);assert.equal(created.product,'独立空白测试');assert.equal(created.shopId,original.shopId);assert.equal(created.caseImage,'');assert.equal(created.posterImages?.length||0,0);assert.ok(!created.caseTransforms);assert.ok(!created.modules.some(m=>m.id==='fixture-custom'));assert.ok(created.parts.every(p=>!p.goodsId&&!p.name));
 for(const old of before.configs){
  const saved=structuredClone(after.configs.find(c=>c.id===old.id));
  // Existing startup binding may materialize a previously implicit catalog ID.
  // Every other field, including existing explicit bindings, must remain exact.
  for(const field of ['parts','actualParts'])for(let i=0;i<(old[field]||[]).length;i++){
   const previous=old[field][i],current=saved[field][i];
   if(previous.sourceId===undefined&&current.sourceId!==undefined){
    assert.ok(before.sourceCatalog.some(row=>row.sourceId===current.sourceId&&row.goodsId===previous.goodsId&&row.name===previous.name),'Only the exact existing source binding may be materialized');
    delete current.sourceId;
   }
  }
  assert.deepEqual(saved,old);
 }
 await page.reload();await page.locator('#new-product').waitFor();assert.deepEqual((await state()).configs,after.configs);
 await page.locator(`[data-id="${created.id}"]`).first().click();await page.waitForFunction(()=>document.querySelector('#dimensions')?.textContent.includes('px'));
 assert.equal(await page.locator(`[data-list-product="${created.productId}"]`).evaluate(el=>el.style.getPropertyValue('--link-card-color')),'#e4f5e9');await page.locator(`[data-link-menu="${created.productId}"]`).click();await page.locator('[data-card-color="#fce5ed"]').click();await page.locator('#save').click();assert.equal((await state()).configs.find(c=>c.id===created.id).productCardColor,'#fce5ed');await page.locator('#edit-product').click();assert.equal(await page.locator('#product-card-color').inputValue(),'#fce5ed');await page.locator('#product-card-color').selectOption('');await page.locator('#product-apply').click();await page.locator('#save').click();assert.equal((await state()).configs.find(c=>c.id===created.id).productCardColor,'');
 // Target a different link through its menu without switching the active configuration.
 await page.locator(`[data-link-menu="${original.productId}"]`).click();await page.locator('[data-edit-link]').click();
 assert.equal(await page.locator('#product-name').inputValue(),original.product);
 const displayName='X400灰 24期3799195680174637347';await page.locator('#product-name').fill(displayName);await page.locator('#product-spu').fill('3799195680174637347');await page.locator('#product-apply').click();
 assert.equal(await page.locator(`[data-list-product="${original.productId}"] .link-card-title strong`).innerText(),'X400灰 24期');
 assert.equal(await page.locator('[data-config=name]').inputValue(),created.name);
 await page.locator(`[data-link-menu="${original.productId}"]`).click();await page.locator('[data-edit-category]').click();await page.locator('#quick-category-name').fill('24期主机专区');await page.locator('#quick-category-save').click();
 await page.locator(`[data-link-menu="${original.productId}"]`).click();await page.locator('[data-card-color="#fff2ce"]').click();
 await page.locator('.list-actions-menu>summary').click();await page.locator('#collapse-all-links').click();
 assert.equal(await page.locator('[data-product-toggle][aria-expanded=true]').count(),0);
 await page.locator(`[data-group-select="${original.productId}"]`).check();assert.equal(await page.locator(`[data-group-select="${original.productId}"]`).isChecked(),true);
 await page.locator(`[data-link-menu="${original.productId}"]`).click();await page.keyboard.press('Escape');assert.equal(await page.locator('.link-card-menu').count(),0);
 await page.locator('#save').click();const savedCards=await state();assert.ok(savedCards.configs.filter(c=>c.productId===original.productId).every(c=>c.product===displayName&&c.productCategory==='24期主机专区'&&c.productCardColor==='#fff2ce'));
 const cardSize=await page.locator('.compact-link-card').first().boundingBox();assert.ok(cardSize.height<85,'Compact card should stay under 85px');
 assert.equal(await page.locator('#config-list').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 await page.screenshot({path:path.join(directory,'new-blank-ui.png')});
 await page.locator(`[data-link-menu="${original.productId}"]`).click();await page.screenshot({path:path.join(directory,'card-menu.png')});

 // Deleting one card must ignore unrelated selected links and support restore.
 await page.locator('[data-delete-link]').click();await page.locator('#save').click();
 await page.waitForFunction(async id=>{const s=await fetch('/api/state').then(r=>r.json());return !!s.configs.find(c=>c.id===id)?.deletedAt;},original.id);const deletedState=await page.evaluate(()=>fetch('/api/state?verify=delete').then(r=>r.json()));assert.ok(deletedState.configs.filter(c=>c.productId===original.productId&&c.shopId===original.shopId).every(c=>c.deletedAt));assert.ok(!deletedState.configs.find(c=>c.id===created.id).deletedAt);
 assert.equal(await page.locator(`[data-list-product="${original.productId}"]`).count(),0);
 await page.locator('.list-actions-menu>summary').click();await page.locator('#deleted-configs').click();await page.locator(`[data-restore-config="${original.id}"]`).click();await page.locator('#dialog .close').click();await page.locator('#save').click();assert.ok(!(await state()).configs.find(c=>c.id===original.id).deletedAt);
 const report={cardDeleteScope:true,cardRestore:true,passed:true,directory,realWindow:true,isolatedData:true,independentNewLink:true,noInheritedImages:true,oldBusinessFieldsAndImagesUnchanged:true,reloadPreserved:true};
 await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
