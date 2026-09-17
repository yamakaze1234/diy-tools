import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestedName} from '../legacy-names.js';

const config=gpu=>({name:'配置1',version:'进阶版',parts:[
 {slot:'CPU',goodsId:'1',name:'Intel i9-14900KF',qty:1},
 {slot:'显卡',goodsId:'2',name:gpu,qty:1},
 {slot:'内存',goodsId:'3',name:'32GB',qty:1},
 {slot:'硬盘',goodsId:'4',name:'1TB',qty:1},
]});

test('5090DV2 与 5090D 的两种简称均保留 D，普通 5090 不受影响',()=>{
 for(const name of ['技嘉 RTX 5090DV2 24GB','RTX 5090 D V2 24GB','5090DV2','rtx5090dv2','RTX 5090D 32GB']){
  assert.equal(suggestedName(config(name)),'配置1：14900KF+5090D+32G+1T丨进阶版');
  assert.equal(suggestedName(config(name),'default'),'配置1：14900KF丨RTX 5090D 进阶版');
 }
 assert.equal(suggestedName(config('RTX 5090 32GB')),'配置1：14900KF+5090+32G+1T丨进阶版');
 assert.match(suggestedName(config('RTX 5060Ti 16GB')),/5060Ti 16G/);
 assert.match(suggestedName(config('RTX 5080 16GB')),/\+5080\+/);
});
