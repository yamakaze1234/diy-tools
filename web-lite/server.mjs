import http from 'node:http';
import {readFile} from 'node:fs/promises';
const port=Number(process.env.PORT||4196);
http.createServer(async(req,res)=>{
 const target=req.url==='/'?'index.html':req.url==='/index.html'?'index.html':req.url==='/cloud.html'?'cloud.html':null;
 if(req.method!=='GET'||!target){res.writeHead(404);res.end('Not found');return;}
 try{
  const html=await readFile(new URL('./dist/'+target,import.meta.url));
  const cfg=JSON.parse(await readFile(new URL('./dist/cloud-public.json',import.meta.url),'utf8').catch(()=> 'null'));
  const connect=target==='cloud.html'&&cfg?`https://${cfg.envId}.api.tcloudbasegateway.com https://${cfg.envId}.${cfg.region}.tcb-api.tencentcloudapi.com https://tcb-api.tencentcloudapi.com https://tcb-auth.tencentcloudapi.com` : "'none'";
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src ${connect}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`});res.end(html);
 }catch{res.writeHead(500);res.end('Build the web app first.');}
}).listen(port,'127.0.0.1',()=>console.log(`Web workbench: http://127.0.0.1:${port}`));
