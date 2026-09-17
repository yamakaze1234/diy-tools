import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreConfigOrder} from '../config-order.js';
import {projectWorkspace,applyWorkspace} from '../workspace-records.mjs';
test('同步按明确顺序还原，随机ID和配置10不影响顺序',()=>{
 const configs=Array.from({length:20},(_,i)=>({id:String(20-i).padStart(2,'0'),shopId:'intel',productId:'p',name:'配置'+(i+1),price:0,parts:[],wpsImport:{lineStart:i*19+1}}));
 const state={configs,templates:[],sourceCatalog:[],costSource:[],caseGallery:[],shopSettings:{}};
 const records=projectWorkspace(state).sort((a,b)=>a.id.localeCompare(b.id));
 assert.deepEqual(applyWorkspace({...state,configs:[]},records).configs.map(c=>c.id),configs.map(c=>c.id));
 assert.deepEqual(restoreConfigOrder([...configs].reverse()).map(c=>c.id),configs.map(c=>c.id));
 const legacy=records.map(r=>{const data=structuredClone(r.data);delete data.workspaceOrder;delete data.wpsImport;return {...r,data};});
 assert.deepEqual(applyWorkspace({...state,configs:[]},legacy).configs.map(c=>c.id),configs.map(c=>c.id));
});
