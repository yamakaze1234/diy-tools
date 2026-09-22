import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceSourcePart} from '../source.js';

test('编辑选件将已启用的加购文案填入对应升级说明，清理重复绑定项并保留独立加购',()=>{
 const config={parts:[{slot:'CPU',sourceId:'old',upgrade:'旧说明',qty:1},{slot:'内存',upgrade:'内存说明'}],addons:[{sourceId:'old',text:'旧绑定'},{sourceId:'new',text:'重复绑定'},{text:'独立加购'}]};
 const row={sourceId:'new',goodsId:'47523',name:'CPU',addonChoices:[{id:'a',enabled:true,label:'升级14600KF',goodsId:'47523',priceCents:9900,qty:1},{id:'b',enabled:false,label:'隐藏项',goodsId:'',qty:1},{id:'c',enabled:true,label:'五年质保',goodsId:'',qty:1}]};
 const before=structuredClone(row);
 replaceSourcePart(config,0,row,{addonPlacement:'upgrade'});
 assert.equal(config.parts[0].upgrade,'【+99元升级14600KF】五年质保');
 assert.equal(config.parts[1].upgrade,'内存说明');assert.deepEqual(config.addons,[{text:'独立加购'}]);assert.deepEqual(row,before);
 replaceSourcePart(config,0,{sourceId:'plain',goodsId:'2',name:'无升级配件'},{addonPlacement:'upgrade'});
 assert.equal(config.parts[0].upgrade,'');assert.deepEqual(config.addons,[{text:'独立加购'}]);
});

test('旧式纯文字加购同样进入升级说明，选件后不新增独立加购',()=>{
 const config={parts:[{slot:'CPU'}],addons:[]};
 replaceSourcePart(config,0,{sourceId:'s',goodsId:'1',name:'CPU',addonText:'+99升级'},{addonPlacement:'upgrade'});
 assert.equal(config.parts[0].upgrade,'+99升级');assert.deepEqual(config.addons,[]);
});
