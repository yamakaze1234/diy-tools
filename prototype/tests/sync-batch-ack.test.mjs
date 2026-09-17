import test from 'node:test';
import assert from 'node:assert/strict';
import {SyncStore} from '../local-store/sync-store.mjs';
import {validateWorkspaceRecord} from '../workspace-validation.mjs';
test('批次回执单事务提交，失败整批回滚并保留原提交 ID',t=>{const s=new SyncStore(':memory:',{protocolVersion:2,validate:validateWorkspaceRecord});t.after(()=>s.close());for(const id of ['intel','jonsbo'])s.edit('settings',id,{couponCents:0});const batch=s.nextBatch(),results=batch.map(r=>({ok:true,record:{version:1,data:r.payload.after}}));let count=0;const original=s.transaction.bind(s);s.transaction=fn=>{count++;return original(fn);};assert.throws(()=>s.acknowledgeBatch(batch,[results[0],{ok:false,message:'暂时失败'}]),/暂时失败/);assert.equal(s.status().uncertain,2);assert.deepEqual(s.nextBatch(),batch);count=0;s.acknowledgeBatch(batch,results);assert.equal(count,1);assert.equal(s.status().pending,0);assert.equal(s.status().uncertain,0);});
