import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ordinaryConfigs,legacyTemplateConfigs,validateTemplateDraft,migrateSavedTemplates,editableTemplateLibrary} from '../template-library.js';

const config=(id,shopId='intel')=>({id,shopId,name:'配置',price:0,parts:[{slot:'CPU',qty:1}],actualParts:[{slot:'CPU',qty:1}],modules:[],addons:[]});

test('legacy 主机模板保留原记录但不混入普通列表',()=>{
 const ordinary=config('ordinary'),legacy={...config('legacy'),productCategory:'主机模板'};
 assert.deepEqual(ordinaryConfigs([ordinary,legacy]).map(row=>row.id),['ordinary']);
 assert.deepEqual(legacyTemplateConfigs([ordinary,legacy]).map(row=>row.id),['legacy']);
 assert.equal(legacy.productCategory,'主机模板');
});

test('模板草稿校验店铺、数量、价格和重复 ID',()=>{
 assert.equal(validateTemplateDraft(' 新模板 ',[config('a')],'intel').name,'新模板');
 assert.throws(()=>validateTemplateDraft('x',[config('a'),config('a')],'intel'),/重复/);
 assert.throws(()=>validateTemplateDraft('x',[config('a','gigabyte')],'intel'),/其他店铺/);
 assert.throws(()=>validateTemplateDraft('x',[{...config('a'),price:NaN}],'intel'),/售价/);
 assert.throws(()=>validateTemplateDraft('x',[{...config('a'),parts:[{qty:0}]}],'intel'),/正整数/);
});

test('saved templates migrate once, preserve edits and deletion, and remain isolated by shop',()=>{
 const source={...config('source'),productId:'normal',product:'普通链接',productCategory:'普通',spu:'123',skuId:'456',caseTransforms:{long:{scale:1.3}}};
 const state={configs:[source],templates:[{id:'t',name:'保存的模板',shopId:'intel',configs:[source]},{id:'other',name:'他店',shopId:'gigabyte',configs:[config('other','gigabyte')]}]};
 const [copy]=migrateSavedTemplates(state,'intel');
 assert.equal(copy.productCategory,'主机模板');assert.notEqual(copy.id,source.id);assert.equal(copy.skuId,'');assert.deepEqual(copy.caseTransforms,source.caseTransforms);
 assert.equal(source.productCategory,'普通');assert.equal(state.templates[1].editorProductId,undefined);
 copy.name='已编辑';assert.equal(editableTemplateLibrary(state,'intel')[0].configs[0].name,'已编辑');
 assert.deepEqual(migrateSavedTemplates(state,'intel'),[]);
 copy.deletedAt=new Date().toISOString();assert.ok(editableTemplateLibrary(state,'intel')[0].deletedAt);
 assert.deepEqual(migrateSavedTemplates(state,'intel'),[]);
 state.configs=state.configs.filter(c=>c.id!==copy.id);assert.deepEqual(migrateSavedTemplates(state,'intel'),[],'Purged templates never resurrect from the archive');
});

test('template migration markers and edited config content survive sync serialization',()=>{
 const state={configs:[],templates:[{id:'saved',name:'模板',shopId:'intel',configs:[config('source')]}],sourceCatalog:[],costSource:[],caseGallery:[],shopSettings:{}};
 const [copy]=migrateSavedTemplates(state,'intel');copy.name='编辑后';
 const receipt=applyWorkspace(state,projectWorkspace(state));
 assert.equal(receipt.templates[0].editorProductId,copy.productId);
 assert.equal(editableTemplateLibrary(receipt,'intel')[0].configs[0].name,'编辑后');
 assert.deepEqual(migrateSavedTemplates(receipt,'intel'),[]);
});
