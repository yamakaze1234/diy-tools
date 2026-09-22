import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleDropIndex} from '../module-drag.js';
test('模块插入位置区分前后，向下拖动补偿移除位置',()=>{
 const reorder=(from,target,after)=>{const rows=['a','b','c','d'];rows.splice(moduleDropIndex(from,target,after),0,rows.splice(from,1)[0]);return rows.join('');};
 assert.equal(reorder(0,2,false),'bacd');assert.equal(reorder(0,2,true),'bcad');
 assert.equal(reorder(3,0,false),'dabc');assert.equal(reorder(3,0,true),'adbc');
 assert.equal(reorder(1,1,false),'abcd');assert.equal(reorder(1,1,true),'abcd');
});
