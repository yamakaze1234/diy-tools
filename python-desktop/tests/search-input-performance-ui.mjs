import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();await page.route('https://search.test/**',async route=>{const name=new URL(route.request().url()).pathname;await route.fulfill({contentType:name==='/'?'text/html':name.endsWith('.css')?'text/css':'text/javascript',body:name==='/'?'<link rel="stylesheet" href="/style.css"><div class="part-model" style="width:1000px"><div data-part-search><input type="search"></div></div>':await fs.readFile(path.join('prototype',name))});});await page.goto('https://search.test/');
 const report=await page.evaluate(async()=>{
  const {mountProductSearch}=await import('/product-search.js');const moneyFormatter=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0});
  const names=['金百达 刃 3600C18 黑色 RGB灯条 16G','英特尔 酷睿 i5 14600KF','技嘉 B760M AORUS ELITE DDR4','盈通 RTX5060Ti 16G'];
  const rows=Array.from({length:6000},(_,i)=>({sourceId:'p'+i,goodsId:String(100000+i),name:names[i%4]+' '+i,erpName:names[i%4],originalName:names[i%4],erp:i,tax:i+100})),costs=rows.map(r=>({...r,stockAvailable:30,stockUpdatedAt:'2026-09-27T03:00:00Z'}));
  let calls=0;const selected=[];const input=document.querySelector('input');const picker=mountProductSearch(input.parentNode,{onChange:r=>{if(r)selected.push(r.sourceId);},deferred:true,stableRows:true,getRows:()=>rows,getCosts:()=>costs,idKey:'sourceId',inputElement:input,describe:x=>{calls++;return `ERP ID ${x.goodsId} · ERP ¥${moneyFormatter.format(x.erp)} · 含税 ¥${moneyFormatter.format(x.tax)} · ERP 原名：${x.erpName} · 原名：${x.originalName}`;}});
  const samples=[];for(const q of ['金','金百','金百达','3','36','360','3600','i5','14600','RTX','RTX5060','105999']){await new Promise(requestAnimationFrame);const before=calls,start=performance.now();input.value=q;input.dispatchEvent(new Event('input',{bubbles:true}));const handlerMs=performance.now()-start;while(document.querySelector('.product-results').hasAttribute('aria-busy'))await new Promise(r=>setTimeout(r,1));document.querySelector('.product-results').getBoundingClientRect();samples.push({query:q,handlerMs,withLayoutMs:performance.now()-start,describeCalls:calls-before,results:document.querySelectorAll('[data-product-id]').length});}

  const ready=async()=>{while(document.querySelector('.product-results').hasAttribute('aria-busy'))await new Promise(r=>setTimeout(r,1));};
  const type=q=>{input.value=q;input.dispatchEvent(new Event('input',{bubbles:true}));};
  const check=(v,m)=>{if(!v)throw Error(m);};
  type('金');type('i5');type('RTX5060');await ready();check([...document.querySelectorAll('[data-product-id] strong')].every(e=>e.textContent.includes('RTX5060')),'Stale results after rapid typing');
  type('金');input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,60));check(!document.querySelector('[data-product-id]'),'Escape reopened results');
  input.value='jin';input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));await new Promise(r=>setTimeout(r,30));check(!document.querySelector('[data-product-id]'),'IME intermediate query rendered');
  input.value='金百达';input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await ready();check(document.querySelectorAll('[data-product-id]').length===50,'IME final query missing');
  type('105999');input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await ready();check(selected.at(-1)==='p5999','Pending Enter did not select latest result');
  rows[0].name='刷新后的配件';type('刷新后的配件');picker.refresh();await ready();check(document.querySelector('[data-product-id]')?.dataset.productId==='p0','Refresh retained stale description');
  rows[0].deletedAt='deleted';document.querySelector('[data-product-id]').click();check(selected.length===1,'Deleted result selected');
  return {rows:rows.length,samples,rapidTyping:true,escapeCancellation:true,ime:true,pendingEnter:true,refreshInvalidation:true,deletedResultRejected:true};
 });const label=process.argv[2];await fs.writeFile(`python-desktop/verification/search-input-${label}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
