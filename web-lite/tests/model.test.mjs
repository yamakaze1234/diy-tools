import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,calculate,instantiateTemplate,replaceFromTemplate,templateDiff,validateConfig,copy} from '../model.mjs';

test('复用本地工作台公式：售价、店铺券、分期费及两种利润',()=>{
 const s=createDemo(),c=s.configs[1];let t=calculate(c,s.catalog,200);
 assert.deepEqual([t.erp,t.tax,t.listPrice,t.erpProfit,t.taxProfit,t.capacity],[6600,6450,7699,749.02,691,12]);
 t=calculate({...c,installment:24},s.catalog,200);assert.equal(t.fee,749.9);assert.equal(t.erpProfit,-.88);assert.equal(t.taxProfit,-58.9);
});
test('空成本与未绑定 ID 不得按零成本显示利润，数值零是真实成本',()=>{
 const s=createDemo();const c=copy(s.configs[1]);c.actualParts[0].goodsId='不存在';let t=calculate(c,s.catalog,200);assert.equal(t.erpProfit,null);assert.equal(t.taxProfit,null);assert.equal(t.capacity,null);
 const cpu=s.catalog[0];c.actualParts[0].goodsId=cpu.goodsId;cpu.erp=0;cpu.tax=null;t=calculate(c,s.catalog,200);assert.equal(t.erpProfit,2249.02);assert.equal(t.taxProfit,null);
 t=calculate({...c,actualParts:[]},s.catalog,200);assert.equal(t.erpProfit,null);assert.equal(t.capacity,null);
});
test('重复商品合并需求后计算可配台数，错误数量阻止利润与保存',()=>{
 const s=createDemo(),c=copy(s.configs[1]);c.actualParts.push({...c.actualParts[5],qty:2});assert.equal(calculate(c,s.catalog).capacity,4);
 c.actualParts[0].qty=1.5;assert.equal(calculate(c,s.catalog).erpProfit,null);assert.throws(()=>validateConfig(c),/正整数/);
});
test('从模板添加创建独立副本、清空 SKU，不改变源模板及展示字段',()=>{
 const s=createDemo(),source=s.templates[0].configs[0];source.skuId='1234567890123456789';source.modules=[{id:'poster',text:'保留样式'}];const before=copy(source);
 const c=instantiateTemplate(source,'new-product','配置6');assert.notEqual(c.id,source.id);assert.equal(c.productId,'new-product');assert.equal(c.skuId,'');assert.notEqual(c.actualParts[0].lineId,source.actualParts[0].lineId);c.actualParts[0].qty=5;assert.deepEqual(source,before);assert.deepEqual(c.modules,source.modules);
});
test('套用替换只更新实际配件，保留链接、SKU、价格、分期与图片字段',()=>{
 const s=createDemo(),target=copy(s.configs[1]),source=s.configs[2];target.skuId='1234567890123456789';target.installment=12;target.poster={image:'do-not-touch'};
 const result=replaceFromTemplate(target,source);for(const key of ['id','productId','skuId','price','installment','parts','poster'])assert.deepEqual(result[key],target[key]);assert.equal(result.actualParts[0].goodsId,source.actualParts[0].goodsId);assert.equal(templateDiff(target,source).length,2);
});
test('仅实际配置参与核算；到手价缺失时利润为空',()=>{const s=createDemo(),c=s.configs[1];c.parts[0].erp=999999;assert.equal(calculate(c,s.catalog).erp,6600);c.price=null;assert.equal(calculate(c,s.catalog).erpProfit,null);assert.throws(()=>validateConfig(c),/到手价/);});
