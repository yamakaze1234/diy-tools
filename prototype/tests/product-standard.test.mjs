import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseStandardProduct,planStandardProduct,applyStandardProduct,exportStandardProduct,standardProducts} from '../product-standard.js';
import {blankConfig} from '../core.js';
import {normalizeWorkspaceState} from '../shops.js';
import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';
import {componentStockView} from '../component-stock-view.js';
import {preferredSourceRows} from '../source.js';

const product={id:'link',shopId:'intel',name:'原链接',spu:'10020445846503',installment:12};
const skuId='10176474256939';
const sample=()=>({'店铺ID':'18',店铺:'测试店',数据来源:'系统下载',状态:'上架',网店类别:'组装电脑',SPU编码:product.spu,SPU名称:'标准商品',备注:null,SKU:{[skuId]:{SKU名称:'标准配置',SKU价格:6999,SKU库存:5,SKU更新时间:'2026-09-20T18:27:15',goods_id:'339289',商品名称:'套餐',图片网址:'https://example.test/a.jpg',商品网址:'https://example.test/sku',关联更新时间:null,SKU明细:[{goods_id:'47538',n:1,商品名称:'ERP 原名',简称:'ERP 简称'}]}}});
function fixture(){
 const config=blankConfig(null,product,'旧配置');config.skuId=skuId;config.price=6000;config.shortName='手工简称';config.shortNameAuto=false;config.caseImage='/uploads/preserved.png';config.parts[0]={slot:'CPU',goodsId:'47538',name:'海报名称',qty:1};config.actualParts=structuredClone(config.parts);
 return normalizeWorkspaceState({configs:[config],templates:[],shopSettings:{intel:{coupon:100,erpShopId:''}},sourceCatalog:[{shopId:'intel',sourceId:'optimized',goodsId:'47538',name:'维护后优化名称',originalName:'ERP 原名'}],costSource:[{goodsId:'47538',name:'ERP 原名',erp:100,tax:120,stockAvailable:8,stockUpdatedAt:'2026-09-21T00:00:00Z'}]});
}
const plan=(data,state,options={})=>planStandardProduct(data,state,product,{erpShopId:'18',...options});
test('PR contract retains exact string identities, SKU URLs and nulls; rejects lossy IDs and fractional quantities',()=>{
 assert.deepEqual(parseStandardProduct(JSON.stringify(sample())),sample());
 const v=sample();v.SPU编码=10000000000000001;assert.throws(()=>parseStandardProduct(v),/字符串/);
 v.SPU编码=product.spu;v.SKU[skuId].SKU明细[0].n=0.5;assert.throws(()=>parseStandardProduct(v),/正整数/);
 assert.deepEqual(parseStandardProduct({SKU:{}}),{SKU:{}});
});
test('preview is pure; confirmed import updates actual BOM with optimized name and preserves poster/custom price/style',()=>{
 const state=fixture(),before=structuredClone(state),p=plan(sample(),state);
 assert.deepEqual(state,before);assert.deepEqual(p.needs,[]);assert.deepEqual(p.errors,[]);
 const {next}=applyStandardProduct(p,state,product),c=next.configs[0];
 assert.equal(c.actualParts[0].name,'维护后优化名称');assert.equal(c.actualParts[0].qty,1);
 assert.deepEqual(c.parts,before.configs[0].parts);assert.equal(c.price,6000);assert.equal(c.shortName,'手工简称');assert.equal(c.caseImage,'/uploads/preserved.png');assert.equal(c.productStandard.sku.goods_id,'339289');assert.deepEqual(state,before);
 const reloaded=normalizeWorkspaceState(applyWorkspace(next,projectWorkspace(next)));
 assert.equal(reloaded.shopSettings.intel.erpShopId,'18');assert.equal(reloaded.configs[0].productStandard.SKU编码,skuId);
});
test('unknown or empty BOM never clears actual configuration; missing SKUs remain',()=>{
 for(const value of [[],undefined]){const state=fixture(),data=sample();if(value)data.SKU[skuId].SKU明细=value;else delete data.SKU[skuId].SKU明细;
  const p=plan(data,state);assert.ok(p.warnings.length);assert.deepEqual(applyStandardProduct(p,state,product).next.configs[0].actualParts,state.configs[0].actualParts);}
 assert.throws(()=>plan({SKU:{}},fixture()),/未返回/);
});
test('optional SKU price conversion subtracts shop coupon; newly discovered SKU gets own metadata and template',()=>{
 const state=fixture(),data=sample();data.SKU['10176474256940']={...structuredClone(data.SKU[skuId]),SKU名称:'新增 SKU'};
 const p=plan(data,state,{prices:true}),{next}=applyStandardProduct(p,state,product);
 assert.equal(p.added,1);assert.equal(next.configs.length,2);assert.equal(next.configs[0].price,6899);assert.equal(next.configs[1].installment,12);assert.equal(next.configs[1].caseImage,'');assert.equal(next.configs[1].actualParts[0].name,'维护后优化名称');
});
test('wrong shop, SPU, duplicate/cross-link SKU, stale previews fail closed',()=>{
 let state=fixture(),data=sample();data.店铺ID='19';assert.throws(()=>plan(data,state),/店铺/);
 data=sample();data.SPU编码='123';assert.throws(()=>plan(data,state),/SPU/);
 data=sample();state.configs.push({...structuredClone(state.configs[0]),id:'other',productId:'other'});assert.ok(plan(data,state).errors.length);
 state=fixture();const p=plan(data,state);state.configs[0].price=123;assert.throws(()=>applyStandardProduct(p,state,product),/已经变化/);
});
test('unmapped slots require explicit choice; conflicting slots cannot be confirmed',()=>{
 const data=sample(),state=fixture();data.SKU[skuId].SKU明细.push({goods_id:'777',n:2,商品名称:'风扇',简称:'风扇'});
 const p=plan(data,state);assert.equal(p.needs.length,1);assert.throws(()=>applyStandardProduct(p,state,product));
 assert.ok(plan(data,state,{slots:{777:'CPU'}}).errors.length);
 const good=plan(data,state,{slots:{777:'风扇'}});assert.equal(applyStandardProduct(good,state,product).next.configs[0].actualParts[1].qty,2);
});
test('export uses current actual goods IDs and quantities, per-SKU URL, never ERP part stock as SKU stock',()=>{
 const state=fixture(),{next}=applyStandardProduct(plan(sample(),state),state,product);next.configs[0].actualParts[0].qty=2;
 const out=exportStandardProduct(next,{...product,name:'标准商品'});
 assert.equal(out.SKU[skuId].SKU明细[0].n,2);assert.equal(out.SKU[skuId].SKU库存,5);assert.equal(out.SKU[skuId].SKU价格,6100);assert.equal(out.SKU[skuId].goods_id,'339289');assert.equal(out.SKU[skuId].图片网址,'https://example.test/a.jpg');assert.equal(out.图片网址,undefined);
 next.configs[0].skuId='888';const copy=exportStandardProduct(next,product);assert.equal(copy.SKU['888'].goods_id,null);assert.equal(copy.SKU['888'].SKU库存,null);
});
test('stock view differentiates zero, low, negative, missing, duplicate and stale/missing ERP rows',()=>{
 for(const value of [0,-1,3,12]){const result=componentStockView({goodsId:'123'},[{goodsId:'123',stockAvailable:value}]);assert.equal(result.value,value);assert.match(result.label,new RegExp(String(value)));}
 for(const costs of [[],[{goodsId:'123',stockAvailable:null}],[{goodsId:'123',stockAvailable:8,erpMissing:true}],[{goodsId:'123',stockAvailable:8},{goodsId:'123',stockAvailable:9}]])assert.equal(componentStockView({goodsId:'123'},costs).status,'unknown');
 const rows=preferredSourceRows([{name:'优化名',goodsId:'123',originalName:'原名'}],[{goodsId:'123',name:'最新 ERP 名',stockAvailable:7,stockUpdatedAt:'2026-09-21'}]);assert.equal(rows[0].name,'优化名');assert.equal(rows[0].erpName,'最新 ERP 名');assert.equal(rows[0].stockUpdatedAt,'2026-09-21');
});
test('unbound existing configurations require explicit SKU selection and are never silently duplicated',()=>{
 const state=fixture();state.configs[0].skuId='';
 const initial=plan(sample(),state);assert.equal(initial.bindings.length,1);assert.throws(()=>applyStandardProduct(initial,state,product));
 const p=plan(sample(),state,{configs:{[skuId]:state.configs[0].id}}),result=applyStandardProduct(p,state,product);
 assert.equal(p.added,0);assert.equal(result.next.configs.length,1);assert.equal(result.next.configs[0].skuId,skuId);
});
test('actual per-link documents share PR schema and incomplete identifiers stay null with readiness outside the document',()=>{
 let state=fixture(),links=standardProducts(state);assert.equal(links.length,1);assert.equal(links[0].ready,true);assert.equal(links[0].data.店铺ID,'76');assert.equal(links[0].data.SKU[skuId].SKU明细[0].goods_id,'47538');assert.equal(links[0].data.ready,undefined);
 state=applyStandardProduct(plan(sample(),state),state,product).next;
 assert.deepEqual(standardProducts(state)[0].data,exportStandardProduct(state,{...product,name:'标准商品'}));assert.equal(standardProducts(state)[0].ready,true);
 state.configs[0].skuId='';links=standardProducts(state);assert.deepEqual(links[0].data.SKU,{});assert.equal(links[0].ready,false);
});
const context={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(new URL('../workbench-erp.user.js',import.meta.url),'utf8'),context);const {collectProduct}=context.module.exports;
const raw=(id=skuId)=>({shop_id:'18',product_id:product.spu,sku_id:id,c_status:'上架',goods_id:'339289',shop_name:'测试店',sku_name:'配置',d_sku_price:'6999',sku_num:5});
const job={erpShopId:'18',spu:product.spu};
test('ERP refresh/query follows pinned endpoints, paginates, deduplicates detail requests and leaves unassociated SKU empty',async()=>{
 const calls=[];const result=await collectProduct(async(path,params,form)=>{calls.push({path,params,form});if(path.includes('downNet'))return {success:true};if(path.includes('getNet'))return {total:3,data:params.pageIndex==='0'?[raw(),raw('222')]:[{...raw('333'),goods_id:null}]};return {data:[{goods_id:47538,n:1,c_name:'原名',c_model:'简称'}]};},job);
 assert.equal(calls[0].form,true);assert.equal(calls[0].params.syncType,'spuId');assert.equal(calls.filter(c=>c.path.includes('searchGoodsDetail')).length,1);assert.equal(result.SKU[skuId].SKU明细[0].goods_id,'47538');assert.equal(result.SKU['333'].SKU明细.length,0);assert.equal(parseStandardProduct(result).SKU[skuId].SKU价格,6999);
});
test('ERP rejects failed refresh, mixed targets, duplicate or partial pages and invalid detail responses',async()=>{
 for(const mode of ['refresh','mixed','duplicate','partial','detail'])await assert.rejects(()=>collectProduct(async(path,params)=>{
  if(path.includes('downNet'))return mode==='refresh'?{success:false}:{success:true};
  if(path.includes('getNet'))return mode==='mixed'?{total:1,data:[{...raw(),shop_id:'19'}]}:mode==='duplicate'?{total:2,data:[raw(),raw()]}:mode==='partial'?{total:2,data:params.pageIndex==='0'?[raw()]:[]}:{total:1,data:[raw()]};
  return {};
 },job));
});
