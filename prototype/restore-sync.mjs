import fs from 'node:fs/promises';
import path from 'node:path';
import {SyncStore} from './local-store/sync-store.mjs';
import {validateWorkspaceRecord} from './workspace-validation.mjs';
const [backupPath,targetDir]=process.argv.slice(2);
if(!backupPath||!targetDir)throw Error('用法：node restore-sync.mjs <备份.json> <新的数据目录>');
const backup=JSON.parse(await fs.readFile(path.resolve(backupPath),'utf8'));
const protocolVersion=JSON.parse(backup.content).protocolVersion||1;
const local=path.resolve(targetDir),file=path.join(local,protocolVersion===2?'workspace.sqlite':'sync-lab.sqlite');
try{await fs.access(file);throw Error('目标已有同步库，请选择新的目录');}catch(e){if(e.code!=='ENOENT')throw e;}
try{await fs.access(path.join(local,'state.json'));throw Error('目标已有业务数据，请选择新的目录');}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.mkdir(local,{recursive:true});const store=new SyncStore(file,{protocolVersion,...(protocolVersion===2?{validate:validateWorkspaceRecord}:{})});
try{store.restore(backup);console.log(JSON.stringify({restored:true,dataDir:local,...store.status()},null,2));}finally{store.close();}
