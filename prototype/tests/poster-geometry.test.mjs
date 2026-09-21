import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleFrame,textFrame,displayedText,resizeRegion} from '../poster-geometry.js';
test('文字变换按模块局部坐标映射，缩放整个模块后命中区域一致',()=>{
 const parent={id:'parts',x:26,top:100,width:648,height:400},text={x:94,top:120,width:200,height:24};
 const frame=displayedText(text,{x:100,y:130,scale:2},parent,{x:40,y:200,width:324,height:200});
 assert.equal(frame.x,77);assert.equal(frame.top,215);assert.equal(frame.width,200);assert.equal(frame.height,24);
 assert.equal(moduleFrame(parent).sx,1);assert.equal(textFrame(text).scale,1);
});
test('四角缩放固定对角，水平拖动可以放大和缩小，不能越出画布',()=>{
 const region={x:100,top:100,width:200,height:100};
 for(const corner of ['nw','ne','sw','se']){
  const west=corner.includes('w'),north=corner.includes('n'),resized=resizeRegion(region,west?-40:40,north?-20:20,corner,700,917);
  assert.equal(resized.width,240);assert.equal(resized.height,120);
  assert.equal(west?resized.x+resized.width:resized.x,west?300:100);
  assert.equal(north?resized.top+resized.height:resized.top,north?200:100);
 }
 assert.ok(resizeRegion(region,-50,0,'se',700,917).width<200);
 const huge=resizeRegion(region,10000,10000,'se',700,917);assert.ok(huge.x+huge.width<=700);assert.ok(huge.top+huge.height<=917);
 const free=resizeRegion(region,40,-20,'se',700,917,false);assert.equal(free.width,240);assert.equal(free.height,80);
});

test('非等比文字兼容旧 scale，四角自由拉伸固定对角',()=>{
 const r={x:100,top:100,width:200,height:100};
 const text=textFrame(r,{scale:2,scaleX:3,scaleY:.5});assert.equal(text.width,600);assert.equal(text.height,50);
 for(const corner of ['nw','ne','sw','se']){
  const w=corner.includes('w'),n=corner.includes('n'),a=resizeRegion(r,w?-40:40,n?20:-20,corner,700,917,false);
  assert.equal(a.width,240);assert.equal(a.height,80);assert.equal(w?a.x+a.width:a.x,w?300:100);assert.equal(n?a.top+a.height:a.top,n?200:100);
 }
});

test('文本框四边只调整对应方向并固定另一侧',()=>{
 const r={x:100,top:100,width:200,height:100};
 assert.deepEqual(resizeRegion(r,40,20,'e',700,917,false),{x:100,top:100,width:240,height:100});
 assert.deepEqual(resizeRegion(r,40,20,'w',700,917,false),{x:140,top:100,width:160,height:100});
 assert.deepEqual(resizeRegion(r,40,20,'n',700,917,false),{x:100,top:120,width:200,height:80});
 assert.deepEqual(resizeRegion(r,40,20,'s',700,917,false),{x:100,top:100,width:200,height:120});
});
