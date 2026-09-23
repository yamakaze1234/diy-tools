import test from 'node:test';
import assert from 'node:assert/strict';
import {findPartUsage,usageGroups,replacementPlan,replacementDiff,upgradeDescriptionPlan,applyReplacement,exportEntries} from '../global-batch.js';

test('批量配件加购描述只改选中链接的逐项说明，保留手动加购和实际配置',()=>{
 const base={slot:'CPU',sourceId:'s',goodsId:'10',name:'旧 CPU',qty:1,upgrade:'旧说明'};
 const configs=['a','b'].map(id=>({id,productId:id,product:'链接'+id,name:'配置'+id,parts:[structuredClone(base)],actualParts:[structuredClone(base)],addons:[{text:'手动加购'}]}));
 const plan=upgradeDescriptionPlan(configs,'id:10',['a'],'新说明');
 assert.equal(plan.changes.length,1);applyReplacement(plan,configs);
 assert.equal(configs[0].parts[0].upgrade,'新说明');assert.equal(configs[1].parts[0].upgrade,'旧说明');
 assert.equal(configs[0].actualParts[0].upgrade,'旧说明');assert.deepEqual(configs[0].addons,[{text:'手动加购'}]);
});

test('全局替换预览同时列出展示配件和实际配置，应用结果一致',()=>{
 const old={slot:'CPU',sourceId:'old',goodsId:'10',name:'旧 CPU',qty:2};
 const configs=[{id:'c',productId:'p',product:'链接',name:'配置',parts:[old],actualParts:[structuredClone(old)],addons:[]}];
 const row={sourceId:'new',goodsId:'20',name:'新 CPU'};
 const plan=replacementPlan(configs,'id:10',['p'],row,null);
 assert.match(replacementDiff(plan),/展示配件 · CPU/);
 assert.match(replacementDiff(plan),/实际配置 · CPU/);
 applyReplacement(plan,configs);
 assert.equal(configs[0].parts[0].goodsId,'20');
 assert.equal(configs[0].actualParts[0].goodsId,'20');
});
const configs=()=>[0,1,2].map(i=>({id:'c'+i,productId:i===2?'b':'a',product:i===2?'链接B':'链接A',spu:i===2?'999999999999999999':'888888888888888888',name:'配置'+(i===2?1:i+1),price:6000,addons:[],parts:[{slot:'内存',goodsId:i===1?'11':'10',name:'旧配件',qty:2,posterVisible:false}]}));
const row={sourceId:'new',goodsId:'20',name:'新配件',erp:30,tax:40};
test('global usage exact ID across products, replacement only selected product and retains quantities',()=>{const cs=configs();assert.equal(findPartUsage(cs,'旧配件').length,2);assert.equal(usageGroups(cs,'id:10').length,2);const plan=replacementPlan(cs,'id:10',['a'],row,null);assert.equal(plan.changes.length,1);applyReplacement(plan,cs);assert.equal(cs[0].parts[0].qty,2);assert.equal(cs[0].parts[0].posterVisible,false);assert.equal(cs[0].price,6000);assert.equal(cs[1].parts[0].goodsId,'11');assert.equal(cs[2].parts[0].goodsId,'10');});
test('stale replacement blocks whole batch and deleted configs excluded',()=>{const cs=configs(),plan=replacementPlan(cs,'id:10',['a','b'],row,4);cs[2].price=7000;assert.throws(()=>applyReplacement(plan,cs));assert.equal(cs[0].parts[0].goodsId,'10');cs[2].deletedAt='now';assert.equal(usageGroups(cs,'id:10').length,1);});
test('export all configs of affected links twice with distinct paths and full SPU',()=>{const cs=configs(),entries=exportEntries(cs,['a']);assert.equal(entries.length,4);assert.equal(new Set(entries.map(e=>e.name)).size,4);assert.ok(entries[0].name.endsWith('/配置清单图/888888888888888888_配置1.png'));assert.equal(entries[1].config.layout,'square');assert.equal(entries[2].config.id,'c1');cs[0].spu='';assert.throws(()=>exportEntries(cs,['a']));});
