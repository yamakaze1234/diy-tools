import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {cloudTransport} from '../prototype/cloud-transport.mjs';
import {createInventoryService} from './inventory-service.mjs';
const port=Number(process.env.PORT||4196),host='127.0.0.1';
const publicOrigin=`http://127.0.0.1:${port}`;
const raw=await readFile(new URL('./.env.local',import.meta.url),'utf8').catch(()=>''),line=raw.split(/\r?\n/).find(l=>l.startsWith('CLOUDBASE_PUBLIC_CONFIG='));
const config=line?JSON.parse(line.slice('CLOUDBASE_PUBLIC_CONFIG='.length)):null;
const directory=path.resolve(process.env.INVENTORY_CACHE_DIR||fileURLToPath(new URL('./local-cache/inventory/',import.meta.url)));
const inventory=createInventoryService({directory,authenticate:async header=>{if(!config||!header?.startsWith('Bearer '))throw Error('请先登录工作台成员账号');const token=header.slice(7);const result=await cloudTransport(config,()=>token)({protocolVersion:2,action:'session.get',requestId:crypto.randomUUID(),payload:{}});if(!result.ok)throw Error('成员登录验证失败');return result;}});
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>50000000)throw Error('请求数据过大');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,publicOrigin);
 if(req.headers.host!==`127.0.0.1:${port}`)return json(res,403,{error:'仅允许本机访问'});
 if(url.pathname.startsWith('/api/')){if(req.headers.origin&&req.headers.origin!==publicOrigin)return json(res,403,{error:'来源不匹配'});if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'来源不匹配'});const result=await inventory({route:url.pathname,method:req.method,headers:req.headers,data:req.method==='POST'?await body(req):{}});return json(res,200,result);}
 const target=url.pathname==='/'?'index.html':url.pathname==='/index.html'?'index.html':url.pathname==='/cloud.html'?'cloud.html':null;
 if(req.method!=='GET'||!target){res.writeHead(404);res.end('Not found');return;}
 const html=await readFile(new URL('./dist/'+target,import.meta.url));const connect=target==='cloud.html'&&config?`'self' https://${config.envId}.api.tcloudbasegateway.com https://${config.envId}.${config.region}.tcb-api.tencentcloudapi.com https://tcb-api.tencentcloudapi.com https://tcb-auth.tencentcloudapi.com`:"'none'";
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src ${connect}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`});res.end(html);
 }catch(error){json(res,400,{error:error.message||'库存服务请求失败'});}
}).listen(port,host,()=>console.log(`Web workbench: ${publicOrigin}`));
