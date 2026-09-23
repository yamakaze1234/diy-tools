import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPosterStyle,modulesDefault} from '../core.js';
import {additionPlan} from '../link-parts.js';
import {replacementPlan,applyReplacement} from '../global-batch.js';

const config=id=>({id,shopId:'intel',productId:id,product:'链接'+id,name:id,parts:[{slot:'CPU',name:'旧 CPU',goodsId:'100',qty:1}],actualParts:[{slot:'CPU',name:'实际 CPU',goodsId:'200',qty:2}],modules:modulesDefault(),addons:[],benefits:[],caseImage:id+'.png',price:1234});
test('全部格式复制两种版式框尺寸、模块布局和图片变换，保留目标内容与独有模块',()=>{
 const source=config('source'),target=config('target');
 source.textStyles={'header.shop':{text:'源标题',width:300,x:20,hidden:false,ranges:[{start:0,end:2,style:{size:32,color:'#ff0000',weight:800}}]}};
 target.textStyles={'header.shop':{text:'目标标题',size:22,ranges:[{start:0,end:3,style:{size:9,color:'#000000'}}]},'unique.text':{text:'保留内容',size:18}};
 target.modules.push({id:'unique',type:'custom',text:'独有模块'});
 source.textTransforms={square:{'header.shop':{x:50,y:40,boxWidth:280,boxHeight:80,scaleX:1,scaleY:1}},long:{'header.shop':{x:30,y:20,boxWidth:450}}};
 source.moduleTransforms={square:{header:{x:30,y:30,width:600,height:150}}};target.moduleTransforms={square:{unique:{x:10,y:500}}};
 source.freeCanvasLayouts={square:{base:700,height:700,density:1}};source.caseTransforms={square:{x:500,y:20,size:150}};source.caseVisible=false;
 source.posterImages=[{id:'source-layer',url:'source-extra.png',name:'新增图片',naturalWidth:200,naturalHeight:120,transforms:{square:{x:40,y:300,width:100,height:60}}}];target.posterImages=[{id:'target-layer',url:'target-extra.png',transforms:{}}];
 const content=structuredClone(target);applyPosterStyle(source,target);
 assert.deepEqual(target.textTransforms,source.textTransforms);assert.deepEqual(target.moduleTransforms.square.header,source.moduleTransforms.square.header);assert.equal(target.moduleTransforms.square.unique.y,500);
 assert.deepEqual(target.caseTransforms,source.caseTransforms);assert.equal(target.caseVisible,false);assert.deepEqual(target.freeCanvasLayouts,source.freeCanvasLayouts);
 assert.equal(target.textStyles['header.shop'].text,'目标标题');assert.deepEqual(target.textStyles['header.shop'].ranges,source.textStyles['header.shop'].ranges);assert.equal(target.textStyles['unique.text'].size,18);
 for(const key of ['parts','actualParts','addons','benefits','caseImage','price'])assert.deepEqual(target[key],content[key]);
 assert.equal(target.posterImages[0].url,'target-extra.png');assert.deepEqual(target.posterImages[0].transforms,{});
 assert.deepEqual(target.posterImages[1],source.posterImages[0]);
 applyPosterStyle(source,target);assert.equal(target.posterImages.length,2);
 target.posterImages[1].transforms.square.x=200;assert.equal(source.posterImages[0].transforms.square.x,40);
 target.textTransforms.square['header.shop'].boxWidth=900;assert.equal(source.textTransforms.square['header.shop'].boxWidth,280);
});
test('全部格式同步多张新增图片的素材和顺序，相同素材更新位置且不清空目标独有图片',()=>{
 const source=config('source'),target=config('target');
 source.posterImages=[
  {id:'new-a',url:'/uploads/a.png',name:'A',naturalWidth:300,naturalHeight:100,transforms:{long:{x:20,y:30,width:150,height:50}}},
  {id:'new-b',url:'/uploads/b.png',name:'B',naturalWidth:100,naturalHeight:200,transforms:{square:{x:40,y:50,width:80,height:160}}},
 ];
 target.posterImages=[
  {id:'only-target',url:'/uploads/target.png',transforms:{}},
  {id:'old-a',url:'/uploads/a.png',name:'旧 A',naturalWidth:300,naturalHeight:100,transforms:{long:{x:0,y:0}}},
 ];
 applyPosterStyle(source,target);
 assert.deepEqual(target.posterImages.map(layer=>layer.url),['/uploads/target.png','/uploads/a.png','/uploads/b.png']);
 assert.equal(target.posterImages[1].id,'old-a');
 assert.deepEqual(target.posterImages[1].transforms,source.posterImages[0].transforms);
 assert.deepEqual(target.posterImages[2],source.posterImages[1]);
 applyPosterStyle(source,target);
 assert.equal(target.posterImages.length,3);
 const colorsOnly=config('colors');applyPosterStyle(source,colorsOnly,{colors:true,format:false});assert.equal(colorsOnly.posterImages,undefined);
 const chassisOnly=config('chassis');applyPosterStyle(source,chassisOnly,{colors:false,format:false,images:true});assert.equal(chassisOnly.posterImages,undefined);
});
test('模块 ID 不同时按模块类型映射文字与位置，清除旧布局后仍保留独有模块',()=>{
 const source=config('s'),target=config('t');source.modules[0].id='source-header';target.modules[0].id='target-header';
 source.textStyles={'source-header.shop':{size:31}};source.textTransforms={long:{'source-header.shop':{boxWidth:350}}};source.moduleTransforms={long:{'source-header':{x:50}}};
 applyPosterStyle(source,target);assert.equal(target.textStyles['target-header.shop'].size,31);assert.equal(target.textTransforms.long['target-header.shop'].boxWidth,350);assert.equal(target.moduleTransforms.long['target-header'].x,50);
 delete source.textTransforms;delete source.moduleTransforms;applyPosterStyle(source,target);assert.equal(target.textTransforms,undefined);assert.equal(target.moduleTransforms,undefined);
});
test('只改颜色保留框几何与局部字号，只改格式保留局部颜色',()=>{
 const source=config('s'),target=config('t');source.textStyles={'header.shop':{ranges:[{start:0,end:1,style:{size:40,color:'#ff0000'}}]}};target.textStyles={'header.shop':{ranges:[{start:0,end:1,style:{size:20,color:'#00ff00'}}]}};target.textTransforms={square:{'header.shop':{boxWidth:200}}};
 applyPosterStyle(source,target,{colors:true,format:false});assert.equal(target.textTransforms.square['header.shop'].boxWidth,200);assert.deepEqual(target.textStyles['header.shop'].ranges.map(r=>r.style),[{size:20},{color:'#ff0000'}]);
 applyPosterStyle(source,target,{colors:false,format:true});assert.deepEqual(target.textStyles['header.shop'].ranges.map(r=>r.style),[{color:'#ff0000'},{size:40}]);
});
test('按勾选配置跨链接替换和添加只改选中行，保留未勾选配置',()=>{
 const all=[config('a'),config('b'),config('c')],before=structuredClone(all),selected=all.filter(c=>c.id!=='b'),replacement={shopId:'intel',sourceId:'new',goodsId:'300',name:'新 CPU'};
 const plan=replacementPlan(selected,'id:100',selected.map(c=>c.productId),replacement,3);applyReplacement(plan,all);assert.deepEqual(all[1],before[1]);assert.deepEqual([all[0],all[2]].map(c=>c.parts[0].qty),[3,3]);
 const addition=additionPlan(selected,null,replacement,'风扇',6);applyReplacement(addition,all);assert.deepEqual(all[1],before[1]);assert.equal(all[0].parts.at(-1).qty,6);assert.equal(all[2].parts.at(-1).qty,6);
});
