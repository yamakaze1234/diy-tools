import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createSqlCredentials} from '../sql-credentials.mjs';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'diy-sql-credentials-test-'));
const settings={server:'synthetic-host',database:'synthetic-db',user:'synthetic-reader',port:1433,encrypt:true,trustServerCertificate:true};
const password='SYNTHETIC_ONLY_中文_$`"_password';
const key=crypto.createHash('sha256').update('synthetic-test-key').digest();
const encrypt=text=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);};
const decrypt=bytes=>{const cipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');};
const fixture=async()=>{const local=await fs.mkdtemp(path.join(root,'case-'));return{local,store:createSqlCredentials({local,encrypt,decrypt})};};
const fileFor=(local,member)=>path.join(local,'sql-credentials',crypto.createHash('sha256').update(member).digest('hex')+'.json');

test('SQL credentials encrypt all connection details, survive restart and isolate members',async()=>{
 const {local,store}=await fixture();
 assert.deepEqual(await store.read('member-a'),{settings:null,password:'',saved:false});
 await store.save('member-a',{settings,password});
 const disk=await fs.readFile(fileFor(local,'member-a'),'utf8');
 for(const secret of [password,settings.server,settings.database,settings.user,'member-a'])assert.ok(!disk.includes(secret));
 const fresh=createSqlCredentials({local,encrypt,decrypt});
 assert.deepEqual(await fresh.read('member-a'),{settings,password,saved:true});
 assert.equal((await fresh.read('member-b')).saved,false);
 await fresh.save('member-b',{settings:{...settings,user:'synthetic-second'},password:'second-synthetic'});
 await fresh.clear('member-a');
 assert.equal((await fresh.read('member-b')).password,'second-synthetic');
 assert.deepEqual(await fresh.read('member-a'),{settings:null,password:'',saved:false});
 const tombstone=JSON.parse(await fs.readFile(fileFor(local,'member-a'),'utf8'));
 assert.equal(tombstone.saved,false);assert.equal(tombstone.ciphertext,undefined);
 assert.deepEqual((await fs.readdir(local)).sort(),['sql-credentials']);
 assert.equal((await fs.readdir(path.join(local,'sql-credentials'))).length,2);
});

test('SQL credential encryption and decryption failures preserve the previous save and sanitize errors',async()=>{
 const {local,store}=await fixture();await store.save('member',{settings,password});
 const original=await fs.readFile(fileFor(local,'member'),'utf8');
 for(const overrides of [{encrypt:()=>{throw Error(password);}},{decrypt:()=>{throw Error(password);}},{decrypt:()=>JSON.stringify({password})}]){
  const failed=createSqlCredentials({local,encrypt,decrypt,...overrides});
  await assert.rejects(()=>failed.save('member',{settings,password:'replacement'}),error=>error.code==='SQL_CREDENTIALS_SAVE'&&!JSON.stringify(error).includes(password)&&!error.message.includes(password));
  assert.equal(await fs.readFile(fileFor(local,'member'),'utf8'),original);
 }
 assert.equal((await store.read('member')).password,password);
 const failed=createSqlCredentials({local,encrypt,decrypt:()=>{throw Error(password);}});
 await assert.rejects(()=>failed.read('member'),error=>error.code==='SQL_CREDENTIALS_READ'&&!error.message.includes(password));
 assert.equal(await fs.readFile(fileFor(local,'member'),'utf8'),original);
});

test('SQL credential store rejects invalid fields and tampered cross-account payloads',async()=>{
 const {local,store}=await fixture();await store.save('a',{settings,password});
 for(const invalid of [{settings,password:''},{settings:{...settings,port:99999},password},{settings:{...settings,user:''},password},{settings,password:'x'.repeat(1025)}])await assert.rejects(()=>store.save('a',invalid),{code:'SQL_CREDENTIALS_SAVE'});
 assert.equal((await store.read('a')).password,password);
 assert.equal((await store.read('../')).saved,false); // IDs are hashed, never used as paths.
 assert.throws(()=>store.read(''),/需要登录/);
});

test('SQL credential store validates envelope size, ownership and ciphertext integrity',async()=>{
 const {local,store}=await fixture();await store.save('a',{settings,password});
 const a=fileFor(local,'a'),b=fileFor(local,'b'),value=JSON.parse(await fs.readFile(a,'utf8'));
 value.owner=crypto.createHash('sha256').update('b').digest('hex');await fs.writeFile(b,JSON.stringify(value));
 await assert.rejects(()=>store.read('b'),{code:'SQL_CREDENTIALS_READ'});
 value.owner=crypto.createHash('sha256').update('a').digest('hex');value.ciphertext='invalid!';await fs.writeFile(a,JSON.stringify(value));
 await assert.rejects(()=>store.read('a'),{code:'SQL_CREDENTIALS_READ'});
 await fs.writeFile(a,'x'.repeat(65537));await assert.rejects(()=>store.read('a'),{code:'SQL_CREDENTIALS_READ'});
 await store.clear('a');assert.equal((await store.read('a')).saved,false);
});

test('SQL credential operations serialize across instances, including clear after save',async()=>{
 const {local,store}=await fixture(),other=createSqlCredentials({local,encrypt,decrypt});
 await Promise.all([store.save('a',{settings,password}),other.save('a',{settings,password:'replacement'}),store.clear('a')]);
 assert.equal((await other.read('a')).saved,false);
 assert.deepEqual(await fs.readdir(path.join(local,'sql-credentials')),[path.basename(fileFor(local,'a'))]);
});

test('Windows DPAPI roundtrip saves only encrypted synthetic data', {skip:process.platform!=='win32'},async()=>{
 const {local}=await fixture(),store=createSqlCredentials({local});
 await store.save('synthetic-member',{settings,password});
 const data=await fs.readFile(fileFor(local,'synthetic-member'),'utf8');assert.ok(!data.includes(password));assert.ok(!data.includes(settings.user));
 assert.equal(JSON.parse(data).protection,'windows-dpapi-current-user-v1');
 assert.deepEqual(await createSqlCredentials({local}).read('synthetic-member'),{settings,password,saved:true});
 await store.clear('synthetic-member');assert.equal((await store.read('synthetic-member')).saved,false);
});

after(async()=>{
 // Preserve the user's recycle-bin policy for temporary synthetic fixtures.
 if(process.platform!=='win32')return;
 await new Promise((resolve,reject)=>{
  const child=spawn('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Add-Type -AssemblyName Microsoft.VisualBasic; $target=[Console]::In.ReadToEnd(); [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($target,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"],{windowsHide:true,stdio:['pipe','ignore','ignore']});
  child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Unable to recycle synthetic test folder')));child.stdin.on('error',reject);child.stdin.end(root);
 });
});
