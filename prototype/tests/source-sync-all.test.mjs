import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceSyncPlan,applySourceSync,sourceImageEntries} from '../source-sync-data.js';
const rows=[{sourceId:'a',shopId:'intel',name:'新 A',tax:20},{sourceId:'b',shopId:'intel',name:'新 B',tax:30},{sourceId:'other',shopId:'gigabyte',name:'他店',tax:40}];
const configs=rows.map((r,i)=>({id:String(i),shopId:r.shopId,name:'同名配置',productId:'p',parts:[{sourceId:r.sourceId,name:'旧名称',qty:2,tax:1}],addons:[{text:'独立加购'}]}));
test('顶部扫描全部输出源，只汇总本店实际差异，每套配置只出现一次',()=>{const cs=structuredClone(configs);cs[0].parts.push({...cs[1].parts[0]});const plan=sourceSyncPlan(cs,rows,['name','tax'],'intel');assert.equal(plan.changes.length,2);assert.equal(plan.changes[0].details.length,4);applySourceSync(plan,cs,rows);assert.equal(cs[0].parts[0].qty,2);assert.equal(cs[0].addons[0].text,'独立加购');assert.deepEqual(cs[2],configs[2]);assert.equal(sourceSyncPlan(cs,rows,['name','tax'],'intel').changes.length,0);});
test('过期配置或输出源预览整批拒绝，没有部分更新',()=>{const cs=structuredClone(configs),rs=structuredClone(rows),plan=sourceSyncPlan(cs,rs,['name'],'intel');cs[1].name='别人修改';assert.throws(()=>applySourceSync(plan,cs,rs),/重新预览/);assert.equal(cs[0].parts[0].name,'旧名称');cs[1].name=configs[1].name;rs[1].name='新版本';assert.throws(()=>applySourceSync(plan,cs,rs),/重新预览/);assert.equal(cs[0].parts[0].name,'旧名称');});
test('全部差异配置每套输出两种图，缺 SPU 仍可导出且同名不重名',()=>{const plan=sourceSyncPlan(configs,rows,['name'],'intel'),entries=sourceImageEntries(plan.changes.map(c=>c.after));assert.equal(entries.length,4);assert.equal(new Set(entries.map(e=>e.name)).size,4);assert.equal(entries.filter(e=>e.config.layout==='long').length,2);assert.ok(entries.every(e=>e.config.shopId==='intel'));});


test('输出源仅文字与商品加购都预览为逐项升级，空源不清除手写说明',()=>{
 const row={sourceId:'text',shopId:'intel',goodsId:'101',name:'CPU',addonText:'【仅文字】',addonChoices:[{id:'text',label:'【仅文字】',goodsId:'',enabled:true}]};
 const configs=[{id:'one',shopId:'intel',productId:'p',name:'配置1',parts:[{slot:'CPU',sourceId:'text',upgrade:''}],addons:[]},{id:'two',shopId:'intel',productId:'p',name:'配置2',parts:[{slot:'CPU',sourceId:'text',upgrade:'手写特殊说明'}],addons:[]}];
 const plan=sourceSyncPlan(configs,[row],['upgrade'],'intel',{retained:[JSON.stringify(['two','text','CPU','upgrade'])]});
 assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].details[0].after,'【仅文字】');applySourceSync(plan,configs,[row]);assert.equal(configs[0].parts[0].upgrade,'【仅文字】');assert.equal(configs[1].parts[0].upgrade,'手写特殊说明');
 row.addonChoices=[{id:'paid',label:'升级商品',goodsId:'222',priceCents:10000,qty:1,enabled:true}];
 const paid=sourceSyncPlan(configs,[row],['upgrade'],'intel');assert.equal(paid.changes[0].details[0].after,'【+100元升级商品】');
 row.addonChoices=[];row.addonText='';assert.equal(sourceSyncPlan(configs,[row],['upgrade'],'intel').changes.length,0);
});
