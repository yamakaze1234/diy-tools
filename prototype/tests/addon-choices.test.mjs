import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceAddon,sourceAddonFields,choiceDescription,addonCheck,addonChecks,validateAddon} from '../addon-data.js';
import {replaceSourcePart,syncSource,sourceDiff} from '../source.js';
import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';
const choices=()=>[{id:'250',goodsId:'250',qty:1,priceCents:59900,label:'升级250K Plus',enabled:true},{id:'265',goodsId:'265',qty:1,priceCents:79900,label:'升级265KF',enabled:true}];
const source=()=>({sourceId:'cpu',shopId:'intel',name:'245KF',goodsId:'245',erp:1000,tax:1000,addonChoices:choices(),addonText:choiceDescription(choices())});
const costs=[{goodsId:'250',name:'250K Plus',erp:1700,tax:1500},{goodsId:'265',name:'265KF',erp:2000,tax:1900}];
test('一个原配件多个升级商品合并成一条描述，价格分别检查不累加',()=>{
 const r=source(),a=sourceAddon(r),results=addonCheck(a,costs,[r]);assert.deepEqual(addonChecks(a).map(v=>v.priceCents),[59900,79900]);assert.equal(results.checks.length,2);assert.equal(results.checks[0].fields.find(f=>f.key==='tax').diffCents,9900);assert.equal(results.checks[1].fields.find(f=>f.key==='tax').diffCents,-10100);assert.equal(results.checks[1].needsAdjustment,true);
 const config={id:'c',parts:[{sourceId:'cpu',goodsId:'245'}],addons:[{text:'无关加购'}]};replaceSourcePart(config,0,r);assert.equal(config.addons.length,2);assert.equal(config.addons[1].text,'【+599元升级250K Plus】【+799元升级265KF】');assert.deepEqual(config.addons[1].choices,choices());
});
test('仅改变某项商品或加价也能发现差异、同步，取消展示仍保留检查商品',()=>{
 const r=source(),c={id:'c',parts:[{sourceId:'cpu',goodsId:'245'}],addons:[]};replaceSourcePart(c,0,r);r.addonChoices[1].goodsId='250';assert.equal(sourceDiff([c],r,['addon']).length,1);syncSource([c],r,['addon']);assert.equal(c.addons[0].choices[1].goodsId,'250');r.addonChoices[1].enabled=false;syncSource([c],r,['addon']);assert.equal(c.addons[0].text,'【+599元升级250K Plus】');assert.equal(addonChecks(c.addons[0]).length,2);
});
test('缺少真实商品或独立价格阻止保存，未知成本不作零',()=>{
 const a=sourceAddon(source());a.choices[1].priceCents=null;assert.throws(()=>validateAddon(a,{required:true,costs}),/加购价/);a.choices[1].priceCents=79900;a.choices[1].goodsId='999';assert.throws(()=>validateAddon(a,{required:true,costs}),/不存在/);assert.equal(addonCheck(a,costs,[source()]).checks[1].severity,'pending');
});
test('多人同步投影与本机字段往返保留多个商品对应价格',()=>{
 const r=source(),s={configs:[],sourceCatalog:[r],templates:[],caseGallery:[],costSource:costs,shopSettings:{}};assert.deepEqual(sourceAddonFields(sourceAddon(r)).addonChoices,choices());const restored=applyWorkspace(s,projectWorkspace(s));assert.deepEqual(restored.sourceCatalog[0].addonChoices,choices());
});

test('内存一根升级两根默认只抵扣一根原件，显式替换数量独立保存',()=>{
 const row={sourceId:'ram',goodsId:'250682',erp:750,tax:750};
 const choice={id:'ram-up',goodsId:'250682',qty:2,priceCents:79900,label:'升级32G 16G×2',enabled:true};
 const check=c=>addonCheck({text:'升级',sourceId:'ram',choices:[c]},[row],[row]).checks[0];
 for(const f of check(choice).fields){assert.equal(f.originalPriceCents,75000);assert.equal(f.costCents,150000);assert.equal(f.diffCents,4900);}
 for(const f of check({...choice,originalQty:2}).fields){assert.equal(f.originalPriceCents,150000);assert.equal(f.diffCents,79900);}
 const direct=addonCheck({text:'升级',sourceId:'ram',goodsId:'250682',qty:2,priceCents:79900},[row],[row]);
 assert.equal(direct.fields[0].originalPriceCents,75000);
 const a={text:'升级',sourceId:'ram',choices:[{...choice,originalQty:1}]};
 assert.equal(sourceAddon(sourceAddonFields(a)).choices[0].originalQty,1);
 assert.throws(()=>validateAddon({...a,choices:[{...choice,originalQty:0}]},{required:true,costs:[row]}),/原配件数量/);
});

test('纯文字加购无需商品和价格，投影往返及配件选用保留原文',()=>{
 const r=source();r.addonChoices=[{id:'text',goodsId:'',qty:1,label:'【联系客服升级】',enabled:true,priceCents:null}];r.addonText=choiceDescription(r.addonChoices);
 assert.equal(r.addonText,'【联系客服升级】');validateAddon(sourceAddon(r),{required:true,costs});
 const state={configs:[],sourceCatalog:[r],templates:[],caseGallery:[],costSource:costs,shopSettings:{}};
 assert.deepEqual(applyWorkspace(state,projectWorkspace(state)).sourceCatalog[0].addonChoices,r.addonChoices);
 const c={parts:[{}],addons:[]};replaceSourcePart(c,0,r);assert.equal(c.addons[0].text,r.addonText);
});
