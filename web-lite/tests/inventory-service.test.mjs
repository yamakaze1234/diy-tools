import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInventoryService} from '../inventory-service.mjs';
const bundle={warehouses:[{goods_id:'123',库房:'公司大库',商品编码:'SKU123',商品名称:'商品',分库数:10,分库可销数:8,分库待入:0,库存成本:400}],catalog:[{goods_id:'123',商品编码:'SKU123',商品名称:'商品'}]};
test('SQL 复用只读口径，成员缓存隔离、重启恢复，密码不落盘，失败保留上次快照',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'web-lite-inventory-')),authenticate=async token=>{if(!['A','B'].includes(token))throw Error('未登录');return {uid:token,workspaceId:'team',ready:true,name:'成员'+token};};let fail=false;
 const reader=async(settings,password)=>{assert.equal(password,'test-secret');if(fail)throw Error('查询失败');return bundle;};const factory=()=>createInventoryService({directory,authenticate,reader,script:''});let service=factory();const call=(action,data={},user='A',method='POST')=>service({route:'/api/inventory/'+action,method,headers:{authorization:user},data,origin:'https://inventory.example.test'});
 await assert.rejects(()=>call('snapshot',{},'unknown','GET'),/未登录/);const result=await call('sql-preview',{settings:{server:'db',database:'inventory',user:'readonly'},password:'test-secret'});assert.equal(result.snapshot.rows[0].stockAvailable,8);assert.equal(result.snapshot.rows[0].erp,400);assert.equal((await call('snapshot',{},'B','GET')).snapshot,null);for(const f of await readdir(directory))assert.ok(!(await readFile(path.join(directory,f),'utf8')).includes('test-secret'));service=factory();assert.equal((await call('snapshot',{},'A','GET')).snapshot.rows[0].stockAvailable,8);fail=true;await assert.rejects(()=>call('sql-preview',{settings:{server:'db',database:'inventory',user:'readonly'},password:'test-secret'}));assert.equal((await call('snapshot',{},'A','GET')).snapshot.rows[0].erp,400);
 console.log('TEST_CACHE_DIRECTORY '+directory);
});
test('SQL 本机连接程序不接收任何 ERP 脚本回传',async()=>{const service=createInventoryService({directory:'unused',authenticate:async()=>({uid:'A',workspaceId:'team',ready:true})});await assert.rejects(()=>service({route:'/api/erp-bridge/poll',method:'POST',headers:{},data:{}}),/不接收 ERP 脚本回传/);});
