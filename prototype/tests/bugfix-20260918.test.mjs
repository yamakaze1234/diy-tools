import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeEditingState} from '../workspace-ui-merge.js';
import {importTemplateConfigs,templateConfigs} from '../core.js';
import {applyWorkspace,projectWorkspace} from '../workspace-records.mjs';
import {richTextLayout} from '../poster-text.js';
test('配件独立库存更新与文字编辑自动合并，同字段和换件冲突保留',()=>{
 const base={configs:[{id:'a',parts:[{slot:'CPU',goodsId:'1',name:'CPU',qty:1,erp:10}]}]},local=structuredClone(base),remote=structuredClone(base);
 local.configs[0].parts[0].name='显示名称';remote.configs[0].parts[0].erp=20;
 const merged=mergeEditingState(base,local,remote);assert.equal(merged.conflict,false);assert.equal(merged.state.configs[0].parts[0].erp,20);assert.equal(merged.state.configs[0].parts[0].name,'显示名称');
 remote.configs[0].parts[0].name='另一名称';assert.equal(mergeEditingState(base,local,remote).conflict,true);
 remote.configs[0].parts[0]={...base.configs[0].parts[0],goodsId:'2'};assert.equal(mergeEditingState(base,local,remote).conflict,true);
});
test('模板按原编号顺序导入，追加已有链接并经云投影往返保持',()=>{
 const configs=[3,1,2].map(n=>({id:'old'+n,name:'配置'+n,workspaceOrder:n,shopId:'intel',productId:'old',parts:[],price:0}));
 const sources=templateConfigs({configs});assert.deepEqual(sources.map(c=>c.name),['配置1','配置2','配置3']);
 const product={id:'new',name:'新链接',shopId:'intel',configs:[{workspaceOrder:50}]};const imported=importTemplateConfigs(sources,product);assert.deepEqual(imported.map(c=>c.workspaceOrder),[51,52,53]);
 const state={configs:imported,templates:[],sourceCatalog:[],costSource:[],caseGallery:[],shopSettings:{}};
 assert.deepEqual(applyWorkspace(state,projectWorkspace(state).reverse()).configs.map(c=>c.name),['配置1','配置2','配置3']);
});
test('局部字号仅应用于选中文字，按 UTF-16 选区处理中文和 emoji',()=>{
 const ctx={measureText:()=>({width:10})},base={size:16,color:'#000000'};
 const lines=richTextLayout(ctx,'升级👍+500',300,base,[{start:4,end:8,style:{size:32,color:'#ff0000'}}],()=> 'font');
 const glyphs=lines.flatMap(l=>l.glyphs);assert.equal(glyphs[2].style.size,16);assert.equal(glyphs[3].style.size,32);assert.equal(glyphs.at(-1).style.color,'#ff0000');
});
