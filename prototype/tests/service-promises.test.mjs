import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SERVICE_TEXT,LEGACY_SERVICE_TEXT,defaultServiceText,saveServiceDefault} from '../service-promises.js';
import {blankConfig,serviceModule} from '../core.js';
import {normalizeWorkspaceState} from '../shops.js';
import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';

test('shop defaults survive normalization and sync projection, including intentionally blank text',()=>{
 let state=normalizeWorkspaceState({configs:[]});
 saveServiceDefault(state,'intel','英特尔专属');saveServiceDefault(state,'jonsbo','');
 state=normalizeWorkspaceState(applyWorkspace(state,projectWorkspace(state)));
 assert.equal(defaultServiceText(state,'intel'),'英特尔专属');
 assert.equal(defaultServiceText(state,'jonsbo'),'');
 assert.equal(defaultServiceText(state,'gigabyte'),DEFAULT_SERVICE_TEXT);
});
test('optional update preserves custom text, styling, other shops and deleted configs',()=>{
 const config=(id,text,shopId='intel')=>({id,shopId,modules:[{...serviceModule(shopId,'light'),text,visible:false,size:25}]});
 const state={configs:[config('a',DEFAULT_SERVICE_TEXT),config('b',LEGACY_SERVICE_TEXT),config('c','自定义'),config('d',DEFAULT_SERVICE_TEXT,'jonsbo'),{...config('e',DEFAULT_SERVICE_TEXT),deletedAt:'2026-09-20'}]};
 assert.deepEqual(saveServiceDefault(state,'intel',DEFAULT_SERVICE_TEXT),[]);
 assert.deepEqual(saveServiceDefault(state,'intel','新文案',true),['a','b']);
 assert.equal(state.configs[0].modules[0].size,25);assert.equal(state.configs[0].modules[0].visible,false);
 assert.equal(state.configs[2].modules[0].text,'自定义');
 assert.equal(state.configs[3].modules[0].text,DEFAULT_SERVICE_TEXT);
 assert.equal(state.configs[4].modules[0].text,DEFAULT_SERVICE_TEXT);
});
test('blank configurations use target default even when inheriting appearance',()=>{
 const ref=blankConfig(null,{id:'p',shopId:'intel'},'参考','旧文案');
 assert.equal(blankConfig(ref,{id:'p',shopId:'intel'},'新配置','新文案').modules.find(m=>m.type==='service').text,'新文案');
 assert.equal(ref.modules.find(m=>m.type==='service').text,'旧文案');
 assert.equal(blankConfig(null,{id:'p',shopId:'jonsbo'},'空文案','').modules.find(m=>m.type==='service').text,'');
});
