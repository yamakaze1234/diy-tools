import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const app=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
const saveCode=app.slice(app.indexOf('async function save(){'),app.indexOf('let imageTimer,imageJob=null;'));
const conflictCode=app.slice(app.indexOf('function openConflict('),app.indexOf('function updateHeading('));

test('冲突弹窗关闭后再次保存可重新打开，草稿不变且不发送保存请求',async()=>{
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
 const state={configs:[{id:'new',name:'未保存配置'}]};let opens=0,requests=0;
 const context={conflict:true,dirty:true,state,$,esc:String,backup(){},
  openDialog(title,html){opens++;$('#dialog').open=true;$('#dialog').title=title;$('#dialog').html=html;},
  request(){requests++;throw Error('不应发送请求');}};
 vm.runInNewContext(saveCode+'\n'+conflictCode+'\nglobalThis.runSave=save;',context);
 for(let i=0;i<2;i++){
  $('#dialog').open=false;
  await assert.rejects(context.runSave(),e=>e.status===409);
  assert.equal($('#dialog').open,true);
  assert.equal(typeof $('#conflict-backup').onclick,'function');
  assert.equal(typeof $('#conflict-compare').onclick,'function');
  assert.equal(typeof $('#conflict-reload').onclick,'function');
 }
 assert.equal(opens,2);assert.equal(requests,0);assert.equal(context.dirty,true);
 assert.deepEqual(context.state,{configs:[{id:'new',name:'未保存配置'}]});
});
