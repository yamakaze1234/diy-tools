import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcesFor} from '../shops.js';
import {replaceSourcePart} from '../source.js';
test('part choice ranks shop optimized descriptions first and keeps SQL prices separate from names',()=>{
 const state={sourceCatalog:[{sourceId:'original',shopId:'intel',goodsId:'123',name:'ERP 原名',originalName:'ERP 原名'},{sourceId:'optimized',shopId:'intel',goodsId:'123',name:'精选显卡 · 三风扇',originalName:'ERP 原名'},{sourceId:'other',shopId:'jonsbo',goodsId:'123',name:'别店描述'}],costSource:[{goodsId:'123',name:'ERP 新原名',erp:220,tax:230,stockAvailable:6}]};
 const rows=sourcesFor(state,'intel');assert.deepEqual(rows.filter(r=>!r.specialComponent).map(r=>r.sourceId),['optimized','original']);assert.equal(rows[0].erp,220);assert.equal(rows[0].name,'精选显卡 · 三风扇');const config={parts:[{slot:'显卡',goodsId:'',name:'',qty:1}],addons:[]};replaceSourcePart(config,0,rows[0]);assert.equal(config.parts[0].name,'精选显卡 · 三风扇');assert.equal(config.parts[0].goodsId,'123');assert.equal(config.parts[0].tax,230);assert.equal(config.parts[0].stockAvailable,6);assert.equal(state.sourceCatalog[0].name,'ERP 原名');
});
