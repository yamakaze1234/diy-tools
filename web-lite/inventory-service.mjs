import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {readSqlBundle,normalizeSqlBundle,sqlSettings} from '../prototype/sql-source.mjs';
import {validateWebSnapshot} from './erp-data.mjs';
// Local SQL connector only. ERP userscript data never passes through this service.
export function createInventoryService({directory,authenticate,reader=readSqlBundle,now=()=>Date.now()}){
 const activeSql=new Set();
 const owner=member=>crypto.createHash('sha256').update(JSON.stringify([member.workspaceId,member.uid])).digest('hex');
 const load=async id=>{try{return validateWebSnapshot(JSON.parse(await readFile(path.join(directory,id+'.json'),'utf8')));}catch(e){if(e.code==='ENOENT')return null;throw Error('库存缓存无法读取，原文件保留');}};
 const save=async(id,snapshot)=>{validateWebSnapshot(snapshot);await mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,id+'.json'),temp=file+'.pending';await writeFile(temp,JSON.stringify(snapshot),{mode:0o600});await rename(temp,file);};
 return async({route,method,headers,data})=>{
  if(!route.startsWith('/api/inventory/'))throw Error('本机连接程序仅提供 SQL 库存读取，不接收 ERP 脚本回传');
  const member=await authenticate(headers.authorization);if(!member?.uid||!member.workspaceId||!member.ready)throw Error('请使用正式工作台成员账号登录');const id=owner(member),action=route.slice('/api/inventory/'.length);
  if(action==='snapshot'&&method==='GET')return {snapshot:await load(id)};
  if(action==='sql-preview'&&method==='POST'){
   if(activeSql.has(id))throw Error('SQL 正在读取，请等待完成');
   activeSql.add(id);try{const settings=sqlSettings(data.settings),bundle=await reader(settings,data.password);data.password='';const rows=normalizeSqlBundle(bundle).map(({goodsId,name,erp,stockAvailable})=>({goodsId,name,erp,stockAvailable}));const snapshot={format:'diy-erp-snapshot-v1',source:'company-sql',origin:'https://cqzs.3cerp.com',account:member.name||member.memberId||member.uid,warehouse:'公司大库',depotId:'0',costField:'库存成本',costHeader:'库存成本',sqlSource:{server:settings.server,port:settings.port,database:settings.database},capturedAt:new Date(now()).toISOString(),complete:true,total:rows.length,rows};validateWebSnapshot(snapshot);await save(id,snapshot);return {snapshot};}finally{data.password='';activeSql.delete(id);}
  }
  throw Error('不支持的库存操作');
 };
}
