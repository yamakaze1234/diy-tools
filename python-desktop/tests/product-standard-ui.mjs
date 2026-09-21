import {stripLocalErp} from '../../prototype/local-erp-policy.mjs';
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
const child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8',path.join(root,'tests/desktop_harness.py'),'--headless','--port','0'],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_USER_DATA:profile,DIY_WORKBENCH_DATA_DIR:data,DIY_WORKBENCH_DEBUG_PORT:String(debugPort)},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);const exited=new Promise(resolve=>child.on('exit',code=>resolve(code)));let browser,page;const checks=[],errors=[];
const sdk=`let session=JSON.parse(localStorage.getItem('synthetic-sdk-session')||'null');export default {init(){return {auth:{onAuthStateChange(){},async signInWithPassword(v){if(v.password!=='synthetic')return{error:{message:'账号或密码错误'}};session={access_token:v.username,user:{is_anonymous:false}};localStorage.setItem('synthetic-sdk-session',JSON.stringify(session));return{data:{session}};},async getSession(){return{data:{session}}},async signOut(){session=null;localStorage.removeItem('synthetic-sdk-session');return{}}}}}};`;

try{
 for(let i=0;i<120&&!logs.includes('WORKBENCH_READY');i++){if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,150));}
 const url=logs.match(/WORKBENCH_READY (http:\/\/127\.0\.0\.1:\d+)/)?.[1];assert.ok(url,logs);
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1600,height:1000}});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/vendor/cloudbase.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));await page.goto(url);
 await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');await page.locator('[name=username]').fill('A');await page.locator('[name=password]').fill('synthetic');await page.locator('#startup-login button').click();await page.waitForFunction(()=>document.querySelector('[data-config=name]')?.value==='配置1');
 const get=async endpoint=>{const r=await page.request.get(url+endpoint);assert.equal(r.status(),200);return r.json();};
 const stateBefore=await get('/api/state');stateBefore.shopSettings.intel.erpShopId='18';const first=stateBefore.configs[0];first.spu='10020445846503';first.skuId='';
 const part=first.actualParts.find(p=>p.goodsId)||first.parts.find(p=>p.goodsId),source=stateBefore.sourceCatalog.find(p=>p.goodsId===part.goodsId&&p.shopId===first.shopId),cost=stateBefore.costSource.find(p=>p.goodsId===part.goodsId);assert.ok(source&&cost);
 source.name='维护表优化名称';cost.stockAvailable=8;cost.stockUpdatedAt='2026-09-21T01:00:00Z';cost.erpMissing=false;
 const saved=await page.request.post(url+'/api/state',{data:{...stateBefore,baseRevision:stateBefore.revision,message:'Synthetic standard fixture'}});assert.equal(saved.status(),200,await saved.text());await page.reload();await page.locator('#product-sync-open').waitFor();
 await page.locator('[data-tab=actual]').click();assert.match(await page.locator('#editor').innerText(),/ERP 可销库存：8/);
 await page.locator('#product-sync-open').click();await page.locator('#standard-shop').fill('18');await page.locator('#standard-account').fill('测试账号');await page.locator('#standard-query').click();
 const bridge=async(action,data)=>fetch(url+'/api/erp-bridge/product-'+action,{method:'POST',headers:{'Content-Type':'application/json','X-DIY-Collector':'workbench-erp-v1',Origin:'https://cqzs.3cerp.com'},body:JSON.stringify(data)});
 let status;for(let i=0;i<30;i++){status=await get('/api/product-sync/status');if(status.job?.status==='waiting')break;await new Promise(r=>setTimeout(r,100));}assert.equal(status.job.status,'waiting');
 const before=await get('/api/state'),identity={clientId:'synthetic-erp-browser',account:'测试账号'};
 const claim=await(await bridge('poll',identity)).json();assert.ok(claim.job);const packet={...identity,jobId:claim.job.id,token:claim.job.token};
 const payload={店铺ID:'18',店铺:'测试店铺',数据来源:'系统下载',状态:'上架',网店类别:'组装电脑',SPU编码:first.spu,SPU名称:'标准商品链接',备注:null,SKU:{'10176474256939':{SKU名称:'标准配置 A',SKU价格:6999,SKU库存:5,SKU更新时间:'2026-09-21T09:00:00',goods_id:'339289',商品名称:'关联套餐',图片网址:'https://example.test/a.jpg',商品网址:'https://example.test/sku',关联更新时间:null,SKU明细:[{goods_id:part.goodsId,n:2,商品名称:'ERP 原名',简称:'ERP 简称'}]}}};
 assert.equal((await bridge('result',{...packet,result:{...payload,店铺ID:'19'}})).status,400);
 assert.equal((await bridge('result',{...packet,result:payload})).status,200);
 await page.locator('[data-standard-config]').waitFor();assert.equal(await page.locator('#standard-apply').isDisabled(),true);
 assert.deepEqual((await get('/api/state')).configs,before.configs);
 await page.locator('[data-standard-config]').selectOption(first.id);await page.locator('#standard-apply:not([disabled])').waitFor();await page.locator('.standard-row>summary').first().click();assert.match(await page.locator('#standard-preview').innerText(),/维护表优化名称/);
 await page.screenshot({path:path.join(root,'verification/product-standard/preview.png')});
 await page.locator('#standard-apply').click();await page.locator('#dialog').waitFor({state:'hidden'});
 const after=await get('/api/state'),updated=after.configs.find(c=>c.id===first.id);
 assert.equal(after.configs.length,before.configs.length);assert.equal(updated.skuId,'10176474256939');assert.equal(updated.price,first.price);assert.equal(updated.actualParts[0].qty,2);assert.equal(updated.actualParts[0].name,'维护表优化名称');assert.deepEqual(stripLocalErp(updated.parts),stripLocalErp(first.parts));
 const index=JSON.parse(await fs.readFile(path.join(data,'products-standard/index.json'),'utf8')),entry=index.links.find(l=>l.productId===first.productId),stored=JSON.parse(await fs.readFile(path.join(data,'products-standard',entry.file),'utf8'));
 assert.equal(stored.SKU[updated.skuId].SKU明细[0].n,2);assert.equal(stored.SKU[updated.skuId].goods_id,'339289');assert.equal(stored.店铺ID,'18');assert.equal(stored.SKU[updated.skuId].SKU库存,5);assert.equal(stored.SKU[updated.skuId].SKU明细[0].stockAvailable,undefined);
 await page.locator('[data-tab=actual]').click();assert.match(await page.locator('#editor').innerText(),/ERP 可销库存：8/);
 await page.screenshot({path:path.join(root,'verification/product-standard/actual.png')});
 await page.locator('#editor button').filter({hasText:'选择'}).first().click();await page.locator('#catalog-results').waitFor();assert.match(await page.locator('#catalog-results').innerText(),/维护表优化名称/);assert.match(await page.locator('#catalog-results').innerText(),/ERP 可销库存：8/);await page.screenshot({path:path.join(root,'verification/product-standard/picker.png')});await page.locator('#dialog .close').click();
 await page.locator('#product-sync-open').click();await page.locator('#standard-json-tools>summary').click();const downloadPromise=page.waitForEvent('download');await page.locator('#standard-export').click();const download=await downloadPromise,stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')),stored);
 await page.locator('#standard-json').fill(JSON.stringify(payload));await page.locator('#standard-import').click();await page.locator('#standard-apply').waitFor();await page.locator('#standard-json').fill('{bad json');assert.equal(await page.locator('#standard-apply').count(),0);await page.locator('#standard-import').click();assert.equal(await page.locator('#standard-apply').count(),0);
 await page.locator('#dialog .close').click();await page.reload();await page.locator('#product-sync-open').waitFor();await page.locator('[data-tab=actual]').click();assert.equal(await page.locator('#editor textarea').first().inputValue(),'维护表优化名称');
 for(const width of [1366,900,600]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow at '+width);}
 assert.deepEqual(errors,[]);
 const result={passed:true,directory,syntheticCloud:true,realCloudWrites:false,realErpRequests:false,checks:['stock in actual parts','ERP job start and browser callback','wrong shop rejected','preview preserves data','explicit SKU binding avoids duplicates','optimized names and preserved poster','per-link standard JSON persisted','standard export equals stored JSON','picker stock','invalid JSON clears stale preview','reload and responsive layout']};await fs.writeFile(path.join(root,'verification/product-standard/ui.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({message:error.message,errors,logs}));if(page)console.error(await page.locator('body').innerText().catch(()=>''));throw error;}
finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
