import test from 'node:test';
import assert from 'node:assert/strict';
import {configCapacityMessage,validateConfigCapacity} from '../config-capacity.js';
const rows=(shopId,n)=>Array.from({length:n},(_,i)=>({id:shopId+i,shopId}));
test('三店各8000套独立计数，总24000套可保存',()=>{const configs=['intel','gigabyte','jonsbo'].flatMap(id=>rows(id,8000));assert.equal(validateConfigCapacity(configs),true);assert.match(configCapacityMessage(configs,'intel',1),/8000/);});
test('仅目标店铺超限会阻止新增，旧500套上限不再生效',()=>{const configs=[...rows('intel',8000),...rows('gigabyte',501)];assert.equal(configCapacityMessage(configs,'gigabyte',1),'');assert.match(configCapacityMessage(configs,'intel',1),/本店/);assert.throws(()=>validateConfigCapacity([...configs,{shopId:'intel'}]),/8000/);});
test('删除保留数据不占在用名额，替换空白模板占位按净新增计数',()=>{const configs=[...rows('intel',7999),{id:'old',shopId:'intel',deletedAt:'date'}];assert.equal(configCapacityMessage(configs,'intel',1),'');assert.match(configCapacityMessage(configs,'intel',2),/8000/);assert.equal(configCapacityMessage(rows('intel',8000),'intel',1-1),'');});
