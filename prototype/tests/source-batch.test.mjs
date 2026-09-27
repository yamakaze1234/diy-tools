import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceBatch} from '../source-batch.js';
import {selectedSourceAddons,sourceAddon,sourceAddonFields,addonCheck} from '../addon-data.js';
import {syncSource,replaceSourcePart,sourceDiff} from '../source.js';
import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';
const row=(id,shop='intel')=>({sourceId:id,shopId:shop,goodsId:id==='b'?'200':'100',name:id,tax:100,erp:90,upgrade:'',addonText:'原方案',addonNote:'',addonGoodsId:'900',addonQty:1,addonPriceCents:59900});
const state=()=>({sourceCatalog:[row('a'),row('b'),row('g','gigabyte')],costSource:[{goodsId:'100',tax:100,erp:90},{goodsId:'200',tax:100,erp:90},{goodsId:'900',tax:500,erp:400},{goodsId:'901',tax:700,erp:600}],configs:[{id:'c',shopId:'intel',parts:[{sourceId:'a',goodsId:'100',tax:100,erp:90}],addons:[]}]});
test('批量保存多个商品只生成一份新状态，共用核算价更新三店，输入保持不变',()=>{
 const s=state(),original=structuredClone(s),changes=s.sourceCatalog.slice(0,2).map(r=>({before:structuredClone(r),row:{...r,name:r.name+'新',tax:r.sourceId==='a'?120:r.tax}}));
 const result=sourceBatch(s,changes);assert.deepEqual(s,original);assert.equal(result.next.sourceCatalog[2].tax,120);assert.equal(result.next.configs[0].parts[0].tax,120);assert.equal(result.next.sourceCatalog[1].name,'b新');assert.equal(result.count,2);
 assert.doesNotThrow(()=>sourceBatch(result.next,changes));
});
test('一条记录并发变化或无效，整批拒绝，未修改原状态',()=>{
 const s=state(),changes=s.sourceCatalog.slice(0,2).map(r=>({before:structuredClone(r),row:{...r,name:r.name+'新'}}));s.sourceCatalog[1].name='其他人修改';const original=structuredClone(s);assert.throws(()=>sourceBatch(s,changes),/已被更新/);assert.deepEqual(s,original);
 changes[1].before.name='其他人修改';changes[1].row.addonPriceCents=-1;assert.throws(()=>sourceBatch(s,changes),/非负/);assert.deepEqual(s,original);
});
test('多个升级方案可同时展示、分别核算，取消一项只移除对应展示',()=>{
 const r=row('a');r.addonShowTogether=true;r.addonVariants=[{variantId:'v2',goodsId:'901',qty:1,text:'【+799元升级265KF】',priceCents:79900,showTogether:true}];r.addonText='【+599元升级250K Plus】';
 const c={id:'c',parts:[{sourceId:'a',goodsId:'100'}],addons:[{text:'独立保留'}]};replaceSourcePart(c,0,r);assert.equal(c.addons.length,1);assert.equal(selectedSourceAddons(r).length,2);
 assert.equal(addonCheck(selectedSourceAddons(r)[0],state().costSource,[r]).fields.find(f=>f.key==='tax').diffCents,19900);assert.equal(addonCheck(selectedSourceAddons(r)[1],state().costSource,[r]).fields.find(f=>f.key==='tax').diffCents,19900);
 r.addonShowTogether=false;assert.equal(sourceDiff([c],r,['addon']).length,1);syncSource([c],r,['addon']);assert.equal(c.addons.length,1);assert.equal(c.parts[0].upgrade,'【+799元升级265KF】');assert.equal(c.addons[0].text,'独立保留');
 r.addonVariants[0].showTogether=false;syncSource([c],r,['addon']);assert.deepEqual(c.addons,[{text:'独立保留'}]);assert.equal(c.parts[0].upgrade,'');assert.deepEqual(sourceAddonFields(sourceAddon(r)).addonVariants,r.addonVariants);
});
test('新展示字段通过多人同步投影往返保留',()=>{
 const s={...state(),templates:[],caseGallery:[],shopSettings:{},logs:[]};s.sourceCatalog[0].addonShowTogether=false;s.sourceCatalog[0].addonVariants=[{variantId:'v2',text:'升级',showTogether:true}];
 const records=projectWorkspace(s);const restored=applyWorkspace(s,records);const r=restored.sourceCatalog.find(r=>r.sourceId==='a');assert.equal(r.addonShowTogether,false);assert.equal(r.addonVariants[0].showTogether,true);
});

test('ERP 查询保存更新对应 ID 的成本，保留自定义名称和其他 ID；旧结果不覆盖新价格',()=>{
 const before={sourceId:'a',shopId:'intel',goodsId:'100',name:'自定义',tax:50,erp:10};
 const state={sourceCatalog:[before],costSource:[{goodsId:'100',name:'ERP旧名',tax:50,erp:10},{goodsId:'200',name:'其他',erp:99}],configs:[{id:'c',parts:[{goodsId:'100',name:'海报名'}],actualParts:[{goodsId:'100',name:'实际名'}]}]};
 const row={...before,erp:25,erpName:'ERP新名',erpUpdatedAt:'2026-09-27T03:00:00Z'};
 const result=sourceBatch(state,[{before,row}]);assert.equal(result.next.costSource[0].erp,25);assert.equal(result.next.costSource[1].erp,99);assert.equal(result.next.sourceCatalog[0].name,'自定义');assert.equal(result.next.configs[0].parts[0].name,'海报名');assert.equal(result.next.configs[0].actualParts[0].erp,25);
 state.costSource[0].erp=88;state.costSource[0].erpUpdatedAt='2026-09-27T04:00:00Z';assert.equal(sourceBatch(state,[{before,row}]).next.costSource[0].erp,88);
});

test('新增按勾选店铺创建独立输出源，已有同 ID（包括已删除）不覆盖或恢复',()=>{
 const row={sourceId:'new',shopId:'intel',goodsId:'555',name:'新品',tax:null,erp:null};
 const state={sourceCatalog:[{sourceId:'old',shopId:'jonsbo',goodsId:'555',name:'原有名字',tax:null,deletedAt:'2026-01-01'}],costSource:[],configs:[]};
 const result=sourceBatch(state,[{before:null,row,targetShopIds:['intel','gigabyte','jonsbo']}]);assert.equal(result.count,2);assert.equal(result.skipped,1);assert.equal(result.next.sourceCatalog.length,3);assert.equal(result.next.sourceCatalog[0].name,'原有名字');assert.equal(result.next.sourceCatalog[0].deletedAt,'2026-01-01');assert.equal(new Set(result.next.sourceCatalog.map(r=>r.sourceId)).size,3);
 const single=sourceBatch({sourceCatalog:[],costSource:[],configs:[]},[{before:null,row,targetShopIds:['intel']}]);assert.equal(single.next.sourceCatalog.length,1);
});
