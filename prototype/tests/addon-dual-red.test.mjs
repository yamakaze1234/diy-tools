import test from 'node:test';
import assert from 'node:assert/strict';
import {addonCheck} from '../addon-data.js';
import {addonStatusHtml} from '../addon-ui.js';
const a={text:'升级',sourceId:'old',goodsId:'new',priceCents:99900,qty:1},originals=[{sourceId:'old',goodsId:'old',erp:1400,tax:1400}];
test('两项同时红色才提醒，核算优先；截图中的 ERP -101、核算 +99 不提醒',()=>{
 for(const [erp,tax,severity,alert] of [[2500,2300,'ok',false],[2300,2500,'warning',false],[2500,2420,'warning',false],[2420,2500,'warning',false],[2449,2449,'danger',true],[2448.99,2449,'warning',false],[2500,null,'pending',false],[null,2500,'warning',false]]){
  const costs=[{goodsId:'new',erp,tax}],result=addonCheck(a,costs,originals),html=addonStatusHtml(a,costs,originals);assert.equal(result.severity,severity,JSON.stringify({erp,tax}));assert.equal(result.needsAdjustment,alert);assert.equal(html.includes('需要重新调整加购描述'),alert);assert.ok(html.indexOf('核算：')<html.indexOf('ERP：'));assert.equal((html.match(/需要重新调整加购描述/g)||[]).length,Number(alert));
 }
 const r=addonCheck(a,[{goodsId:'new',erp:2500,tax:2300}],originals);assert.deepEqual(r.fields.map(f=>[f.diffCents,f.severity]),[[-10100,'danger'],[9900,'ok']]);
});
