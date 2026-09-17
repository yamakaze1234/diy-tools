import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGallery,validateGallery,filterGallery,galleryUsage,useGalleryImage,isGalleryUrl} from '../case-gallery-data.js';
import {normalizeWorkspaceState} from '../shops.js';

const row={id:'case-1',name:'X400CG 黑色进阶主图',url:'/uploads/abc.png',brand:'乔思伯',model:'X400CG',color:'黑色',edition:'进阶'};
test('老配置与模板相同素材只收录一次；回收图片刷新不重新加入可选图库',()=>{
 const configs=[{caseImage:row.url,parts:[{slot:'机箱',name:'原有机箱'}]},{caseImage:row.url}];
 const first=normalizeGallery(undefined,configs,[{config:{caseImage:'/assets/case.png'}}]);assert.equal(first.length,2);assert.equal(first[0].name,'原有机箱');
 first[0].deletedAt=new Date().toISOString();const reloaded=normalizeGallery(first,configs);assert.deepEqual(reloaded,first);assert.equal(filterGallery(reloaded).length,1);
});
test('分类和多关键词搜索联用，回收图片不会出现在选择列表',()=>{
 const rows=[row,{...row,id:'white',color:'白色',name:'X400CG 白色豪华',edition:'豪华'},{...row,id:'deleted',deletedAt:new Date().toISOString()}];
 assert.deepEqual(filterGallery(rows,{query:'乔思伯 X400cg 黑色',path:['乔思伯','X400CG']}).map(r=>r.id),['case-1']);
 assert.deepEqual(filterGallery(rows,{deleted:true}).map(r=>r.id),['deleted']);
});
test('选择图库图片仅改变图片地址，保留各配置样式、配件及长方图位置',()=>{
 const c={caseImage:'/assets/old.png',caseTransforms:{long:{x:11,y:22,size:180},square:{x:33,y:44,size:100}},caseVisible:false,textStyles:{'part.内存.name':{color:'#0088ff',weight:700}},parts:[{slot:'机箱',goodsId:'123',qty:1}]},before=structuredClone(c);
 useGalleryImage(c,row);assert.deepEqual(c,{...before,caseImage:row.url});assert.throws(()=>useGalleryImage(c,{...row,deletedAt:new Date().toISOString()}),/不可用/);
 assert.equal(galleryUsage(row,[c,{...c,deletedAt:'2026-09-16'}]).length,1);
});
test('图库拒绝脚本地址、路径逃逸和重复 ID',()=>{
 for(const url of ['javascript:alert(1)','https://example.com/a.png','/uploads/../state.png','/uploads/%2e%2e/a.png'])assert.equal(isGalleryUrl(url),false);
 assert.throws(()=>validateGallery([row,{...row}]),/无效/);assert.throws(()=>validateGallery([{...row,url:'/uploads/../state.png'}]),/无效/);
});
test('图库回收状态与分类经保存、恢复和三店归一化保留',()=>{
 const r={...row,deletedAt:new Date().toISOString()};const state={configs:[],templates:[],sourceCatalog:[],caseGallery:[r]};
 const restored=normalizeWorkspaceState(JSON.parse(JSON.stringify(state)),[]);assert.deepEqual(restored.caseGallery,[r]);
});
