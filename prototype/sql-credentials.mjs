import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {sqlSettings} from './sql-source.mjs';

const MAX_FILE_BYTES=65536;
const queues=new Map();
const EMPTY=()=>({settings:null,password:'',saved:false});
const safeError=action=>Object.assign(new Error({read:'无法读取本机保存的 SQL 连接资料，请重新填写或清除本机保存',save:'无法安全保存 SQL 连接资料，原有保存资料保持不变',clear:'无法清除本机保存的 SQL 连接资料，请稍后重试'}[action]),{code:`SQL_CREDENTIALS_${action.toUpperCase()}`});

// The script is constant. Neither credentials nor encrypted payloads are placed
// in command arguments, environment variables, stderr, or diagnostic errors.
const DPAPI_SCRIPT=`$ErrorActionPreference='Stop'
try {
  Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
  $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
  $bytes=[Convert]::FromBase64String($request.data)
  $entropy=[Text.Encoding]::UTF8.GetBytes('DIY-Workbench:SQL-credentials:v1')
  if ($request.action -eq 'encrypt') {
    $result=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  } elseif ($request.action -eq 'decrypt') {
    $result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  } else { exit 1 }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { exit 1 }`;

function dpapi(action,bytes){
 if(process.platform!=='win32')return Promise.reject(Error('Platform encryption unavailable'));
 return new Promise((resolve,reject)=>{
  const child=spawn('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',DPAPI_SCRIPT],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(Error('Platform encryption unavailable')):resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(true);},15000);
  child.on('error',()=>finish(true));
  child.stdin.on('error',()=>finish(true));
  child.stderr.resume();
  child.stdout.on('data',chunk=>{output+=chunk.toString('ascii');if(output.length>MAX_FILE_BYTES*2){child.kill();finish(true);}});
  child.on('close',code=>{const text=output.trim();if(code!==0||!text||!/^[A-Za-z0-9+/]+={0,2}$/.test(text))return finish(true);const result=Buffer.from(text,'base64');if(result.toString('base64')!==text)return finish(true);finish(false,result);});
  child.stdin.end(JSON.stringify({action,data:bytes.toString('base64')}));
 });
}

function serial(file,operation){
 const task=(queues.get(file)||Promise.resolve()).catch(()=>{}).then(operation);
 queues.set(file,task);
 task.finally(()=>{if(queues.get(file)===task)queues.delete(file);}).catch(()=>{});
 return task;
}

async function electronStorage(){
 const {safeStorage}=await import('electron');
 if(!safeStorage?.isEncryptionAvailable())throw Error('Platform encryption unavailable');
 return safeStorage;
}

/** Local-only credential store. Callers must authenticate memberId before use.
 * encrypt(string) => Buffer; decrypt(Buffer) => string may be injected in tests.
 * Electron uses safeStorage; plain Node uses Windows DPAPI via PowerShell 7.
 * Credentials cannot be recovered by another Windows user or another device.
 */
export function createSqlCredentials({local,encrypt,decrypt}){
 if(typeof local!=='string'||!local)throw Error('Local credential directory required');
 if((encrypt&&!decrypt)||(!encrypt&&decrypt))throw Error('Both encryption functions are required');
 const injected=Boolean(encrypt),desktop=Boolean(process.versions.electron&&process.type==='browser');
 const protection=injected?'injected-v1':desktop?'electron-safe-storage-v1':'windows-dpapi-current-user-v1';
 const protect=encrypt||(desktop?async text=>(await electronStorage()).encryptString(text):(text)=>dpapi('encrypt',Buffer.from(text,'utf8')));
 const unprotect=async(bytes,format=protection)=>{
  if(injected){if(format!=='injected-v1')throw Error('Unexpected encryption format');return decrypt(bytes);}
  if(format==='electron-safe-storage-v1')return (await electronStorage()).decryptString(bytes);
  if(format==='windows-dpapi-current-user-v1')return (await dpapi('decrypt',bytes)).toString('utf8');
  throw Error('Unexpected encryption format');
 };
 const directory=path.join(path.resolve(local),'sql-credentials');
 const identify=memberId=>{
  if(typeof memberId!=='string'||!memberId.trim()||memberId.length>512)throw Error('需要登录后才能使用本机 SQL 连接资料');
  const owner=crypto.createHash('sha256').update(memberId).digest('hex');
  return{owner,file:path.join(directory,`${owner}.json`)};
 };
 const decode=(plain,owner)=>{
  if(typeof plain!=='string'||Buffer.byteLength(plain)>MAX_FILE_BYTES)throw Error('Invalid payload');
  const value=JSON.parse(plain);
  if(value.version!==1||value.owner!==owner||typeof value.password!=='string'||!value.password||value.password.length>1024)throw Error('Invalid payload');
  return{settings:sqlSettings(value.settings),password:value.password,saved:true};
 };
 const write=async(file,value)=>{
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  // A fixed pending file is serialized across store instances in this process.
  // Failed writes leave only an empty tombstone, never a plaintext credential.
  const pending=file+'.pending';let handle;
  try{handle=await fs.open(pending,'w',0o600);await handle.writeFile(JSON.stringify(value),'utf8');await handle.sync();await handle.close();handle=null;await fs.rename(pending,file);}
  catch{if(handle)await handle.close().catch(()=>{});await fs.writeFile(pending,'', {mode:0o600}).catch(()=>{});throw Error('Atomic credential write failed');}
 };
 return{
  read(memberId){const {owner,file}=identify(memberId);return serial(file,async()=>{
   try{
    let stat;try{stat=await fs.stat(file);}catch(error){if(error.code==='ENOENT')return EMPTY();throw error;}
    if(!stat.isFile()||stat.size>MAX_FILE_BYTES)throw Error('Invalid envelope');
    const value=JSON.parse(await fs.readFile(file,'utf8'));
    if(value.version!==1||value.owner!==owner||typeof value.saved!=='boolean')throw Error('Invalid envelope');
    if(!value.saved){if(value.ciphertext!==undefined)throw Error('Invalid tombstone');return EMPTY();}
    if(typeof value.protection!=='string'||typeof value.ciphertext!=='string'||!value.ciphertext)throw Error('Invalid envelope');
    const bytes=Buffer.from(value.ciphertext,'base64');if(bytes.toString('base64')!==value.ciphertext)throw Error('Invalid ciphertext');
    return decode(await unprotect(bytes,value.protection),owner);
   }catch{throw safeError('read');}
  });},
  save(memberId,{settings,password}={}){const {owner,file}=identify(memberId);return serial(file,async()=>{
   try{
    if(typeof password!=='string'||!password||password.length>1024)throw Error('Invalid password');
    const normalized=sqlSettings(settings),plain=JSON.stringify({version:1,owner,settings:normalized,password});
    const ciphertext=await protect(plain);
    if(!Buffer.isBuffer(ciphertext)||!ciphertext.length||ciphertext.length>MAX_FILE_BYTES/2)throw Error('Invalid encryption');
    // Verify recovery before replacing a previous good save. Failed encryption
    // or decryption never changes that file, including on credential rotation.
    const restored=decode(await unprotect(ciphertext),owner);
    if(restored.password!==password||JSON.stringify(restored.settings)!==JSON.stringify(normalized))throw Error('Encryption verification failed');
    await write(file,{version:1,owner,saved:true,protection,ciphertext:ciphertext.toString('base64')});
    return{saved:true};
   }catch{throw safeError('save');}
  });},
  clear(memberId){const {owner,file}=identify(memberId);return serial(file,async()=>{
   try{await write(file,{version:1,owner,saved:false});return{saved:false};}catch{throw safeError('clear');}
  });}
 };
}
