import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePosterDesign} from '../poster-design.js';
import {applyPosterStyle} from '../core.js';

test('SKU 迁移备份旧方图布局，详情位置与业务内容保持不变，重复载入稳定',()=>{
 const c={parts:[{slot:'CPU',name:'测试型号'}],freeCanvasLayouts:{square:{base:624,height:624},long:{base:668,height:830}},caseTransforms:{long:{x:460,y:44,width:172}},textTransforms:{square:{'header.shop':{x:10}},long:{'part.内存.name':{x:108,y:424}}}};
 const old=structuredClone(c);normalizePosterDesign(c);
 assert.deepEqual(c.freeCanvasLayouts.long,old.freeCanvasLayouts.long);
 assert.deepEqual(c.caseTransforms,old.caseTransforms);
 assert.deepEqual(c.textTransforms.long,old.textTransforms.long);
 assert.deepEqual(c.parts,old.parts);
 assert.deepEqual(c.previousSquareLayout.freeCanvasLayouts,old.freeCanvasLayouts.square);
 assert.equal(c.freeCanvasLayouts.square,undefined);
 const next=structuredClone(c);normalizePosterDesign(c);assert.deepEqual(c,next);
});

test('复制图片样式携带 SKU 模式但不替换配件内容',()=>{
 const source={layout:'square',skuMode:'padded',posterDesignVersion:1,parts:[{slot:'CPU',name:'来源'}],modules:[]};
 const target={layout:'long',parts:[{slot:'CPU',name:'目标'}],modules:[]};
 applyPosterStyle(source,target);assert.equal(target.skuMode,'padded');assert.equal(target.posterDesignVersion,1);assert.equal(target.parts[0].name,'目标');
});
