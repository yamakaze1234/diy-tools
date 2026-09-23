import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPosterView} from '../poster-view.js';
import {normalizeWorkspaceState} from '../shops.js';

test('统一已有配置的详情/SKU视图及补白模式，保留内容和各版式坐标',()=>{
 const configs=[{id:'a',layout:'long',parts:[{name:'CPU'}],textTransforms:{long:{x:1},square:{x:2}},theme:'dark'}, {id:'b',layout:'square',skuMode:'dedicated'}, {id:'deleted',layout:'long',deletedAt:'2026-09-22'}];
 const before=structuredClone(configs);
 assert.deepEqual(applyPosterView(configs,{layout:'square',skuMode:'padded'}),['a','b']);
 for(const c of configs.slice(0,2)){assert.equal(c.layout,'square');assert.equal(c.skuMode,'padded');}
 assert.deepEqual(configs[0],{...before[0],layout:'square',skuMode:'padded'});
 assert.deepEqual(configs[2],before[2]);
 assert.deepEqual(applyPosterView(configs,{layout:'square',skuMode:'padded'}),[]);
 assert.deepEqual(applyPosterView(configs,{layout:'long',skuMode:'padded'}),['a','b']);
});

test('统一视图设置在重新载入后保留，新增配置遵循同一视图',()=>{
 const state=normalizeWorkspaceState({configs:[],shopSettings:{intel:{coupon:0,posterView:{layout:'square',skuMode:'padded'}}}},[]);
 const view=state.shopSettings.intel.posterView;
 assert.deepEqual(view,{layout:'square',skuMode:'padded'});
 const configs=[{id:'new',layout:'long'}];
 assert.deepEqual(applyPosterView(configs,view),['new']);
 assert.equal(configs[0].layout,'square');
 assert.equal(state.shopSettings.jonsbo.posterView,undefined);
});

test('店铺统一主题保留独立配色和业务数据，重新载入后新增配置遵循选择',async()=>{
 const {applyPosterTheme,shopPalette}=await import('../shops.js');
 const a={id:'a',shopId:'intel',theme:'dark',palette:{...shopPalette('intel','dark'),background:'#123456'},parts:[{name:'CPU'}],modules:[]};
 const b={id:'b',shopId:'intel',theme:'light',palette:shopPalette('intel','light'),modules:[]};
 const deleted={id:'deleted',theme:'dark',deletedAt:'2026-09-23'};
 const configs=[a,b,deleted],parts=structuredClone(a.parts);
 assert.deepEqual(applyPosterTheme(configs,'light'),['a']);
 assert.deepEqual(a.parts,parts);assert.equal(deleted.theme,'dark');
 assert.deepEqual(applyPosterTheme(configs,'light'),[]);
 applyPosterTheme(configs,'dark');assert.equal(a.palette.background,'#123456');
 const state=normalizeWorkspaceState({configs:[],shopSettings:{intel:{coupon:0,posterTheme:'light'}}},[]);
 assert.equal(state.shopSettings.intel.posterTheme,'light');assert.equal(state.shopSettings.jonsbo.posterTheme,undefined);
 const fresh={id:'new',shopId:'intel',theme:'dark',modules:[]};
 applyPosterTheme([fresh],state.shopSettings.intel.posterTheme);assert.equal(fresh.theme,'light');
});
