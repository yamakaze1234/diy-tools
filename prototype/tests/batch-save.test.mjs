import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBatchSources} from '../batch-save.js';

test('flushed source edits invalidate both link and global batch previews',()=>{
 const chosen={sourceId:'new',goodsId:'123',name:'原来源',tax:42};
 const catalog=[{...chosen}];
 assert.doesNotThrow(()=>validateBatchSources({replacements:[chosen]},catalog));
 assert.doesNotThrow(()=>validateBatchSources({replacement:chosen},catalog));
 for(const plan of [{replacements:[chosen]},{replacement:chosen}]){
  assert.throws(()=>validateBatchSources(plan,[{...chosen,tax:43}]),/重新预览/);
  assert.throws(()=>validateBatchSources(plan,[]),/重新预览/);
 }
});
