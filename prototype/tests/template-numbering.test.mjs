import test from 'node:test';
import assert from 'node:assert/strict';
import {importTemplateConfigs,blankConfig} from '../core.js';

const source=n=>({id:`old-${n}`,name:`配置${n}`,version:'进阶版',parts:[],actualParts:[],addons:[],benefits:[],price:100,caseImage:'/assets/case.png',skuId:'old-sku'});

test('选择跳号模板按导入顺序连续命名，保留版本和内容，不改模板',()=>{
 const sources=[source(1),source(3),source(8)],before=structuredClone(sources);
 const added=importTemplateConfigs(sources,{id:'p',name:'目标商品',configs:[]});
 assert.deepEqual(added.map(c=>c.name),['配置1','配置2','配置3']);
 assert.ok(added.every(c=>c.version==='进阶版'&&c.price===100&&c.caseImage==='/assets/case.png'&&c.skuId===''));
 assert.deepEqual(sources,before);
});

test('已有四套配置后从配置5续编，下一次继续追加，已删除配置不占号',()=>{
 const product={id:'p',name:'目标商品',configs:[1,2,3,4].map(source)};
 product.configs.push({...source(9),deletedAt:'2026-09-22'});
 const before=structuredClone(product.configs),added=importTemplateConfigs([source(8),source(12)],product);
 assert.deepEqual(added.map(c=>c.name),['配置5','配置6']);
 assert.deepEqual(product.configs,before);
 product.configs.push(...added);
 assert.equal(importTemplateConfigs([source(20)],product)[0].name,'配置7');
});

test('新链接空白占位被替换时从配置1开始，已编辑空白配置仍占号',()=>{
 const product={id:'p',name:'新链接',configs:[]};
 const placeholder={...blankConfig(null,product),emptyLinkDraft:true};
 product.configs=[placeholder];
 assert.equal(importTemplateConfigs([source(8)],product)[0].name,'配置1');
 placeholder.price=100;
 assert.equal(importTemplateConfigs([source(8)],product)[0].name,'配置2');
});
