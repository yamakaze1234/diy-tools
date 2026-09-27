import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.WORKBENCH_PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('diy-web-lite-prototype-v1')));
const row=(data,id)=>data.catalog.find(part=>part.goodsId===id);

try{
 await page.goto('http://127.0.0.1:4196');
 await page.locator('[data-action="nav-costs"]').click();
 const before=await state();
 await page.locator('[data-action="addon-cost-paste"]').click();
 await page.locator('#cost-paste-text').fill('goods_id\t含税单价\n990006\t2500.50\n990005\t\n999999\t99\n990006\t2500.50');
 await page.getByRole('button',{name:'解析并预览',exact:true}).click();
 const preview=await page.locator('dialog').innerText();
 assert.match(preview,/变化 1 项/);assert.match(preview,/空值保留 1 行/);assert.match(preview,/未匹配 ID 1 行/);
 assert.equal(row(await state(),'990006').tax,row(before,'990006').tax);
 await page.getByRole('button',{name:'确认保存 1 项核算价',exact:true}).click();
 const after=await state();
 assert.equal(row(after,'990006').tax,2500.5);
 assert.equal(row(after,'990006').erp,row(before,'990006').erp);
 assert.equal(row(after,'990005').tax,row(before,'990005').tax);
 assert.deepEqual(after.configs,before.configs);
 console.log('PASS cost paste preview, exact IDs, blank and unmatched preservation, ERP isolation');

 await page.locator('[data-action="addon-cost-paste"]').click();
 await page.locator('#cost-paste-text').fill('990006\t#VALUE!');
 await page.getByRole('button',{name:'解析并预览',exact:true}).click();
 assert.match(await page.locator('dialog').innerText(),/#VALUE! 使用 ERP 成本 1 行/);
 await page.getByRole('button',{name:'确认保存 1 项核算价',exact:true}).click();
 assert.equal(row(await state(),'990006').tax,row(before,'990006').erp);
 console.log('PASS #VALUE! uses the exact ID ERP cost only after confirmation');

 await page.locator('[data-action="addon-cost-paste"]').click();
 await page.locator('#cost-paste-text').fill('990006\t-1');
 await page.getByRole('button',{name:'解析并预览',exact:true}).click();
 assert.match(await page.locator('#modal-status').innerText(),/非负金额/);
 assert.equal(row(await state(),'990006').tax,row(before,'990006').erp);
 await page.locator('dialog [data-action="close"]').first().click();
 await page.evaluate(()=>{const key='diy-web-lite-prototype-v1',data=JSON.parse(localStorage.getItem(key));for(let i=0;i<105;i++)data.catalog.push({goodsId:String(800000+i),name:'翻页商品 '+i,slot:'配件',erp:10,tax:null,stockAvailable:null});localStorage.setItem(key,JSON.stringify(data));});
 await page.reload();await page.locator('[data-action="nav-costs"]').click();await page.locator('[data-action="addon-cost-paste"]').click();
 await page.locator('#cost-paste-text').fill(Array.from({length:105},(_,i)=>`${800000+i}\t${i}.00`).join('\n'));
 await page.getByRole('button',{name:'解析并预览',exact:true}).click();
 assert.match(await page.locator('#cost-paste-page').innerText(),/第 1 \/ 2 页/);
 await page.locator('[data-action="addon-cost-preview-next"]').click();
 assert.match(await page.locator('#cost-paste-page').innerText(),/第 2 \/ 2 页/);
 assert.match(await page.locator('#cost-paste-preview-rows').innerText(),/800104/);
 await page.getByRole('button',{name:'确认保存 105 项核算价',exact:true}).click();
 assert.equal(row(await state(),'800104').tax,104);
 assert.deepEqual(errors,[]);
 console.log('PASS invalid amount rejected and all 105 changed rows previewable before save');
}finally{await browser.close();}
