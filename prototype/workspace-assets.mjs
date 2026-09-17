import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
export function createWorkspaceAssets({local,base,getToken,getWorkspace,store}){
 const filename=url=>{const m=/^\/uploads\/([a-f0-9]{64}\.(?:png|jpg))$/.exec(url);if(!m)throw Error('素材路径无效');return m[1];};
 const endpoint=name=>`${base}/v1/storages/object/workbench-assets/${encodeURIComponent(getWorkspace())}/${name}`;
 async function download(url){const name=filename(url),file=path.join(local,'assets',name);try{return await fs.readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!getToken()||!getWorkspace())throw Error('原始图片尚未缓存，请先登录同步');
  const response=await fetch(endpoint(name),{headers:{Authorization:`Bearer ${getToken()}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`原始图片下载失败（${response.status}）`);const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>24*1024*1024||digest(bytes)!==name.split('.')[0])throw Error('原始图片校验失败');await fs.writeFile(file,bytes);return bytes;
 }
 async function uploadAll(state){const urls=new Set();function walk(v){if(typeof v==='string'&&v.startsWith('/uploads/'))urls.add(v);else if(v&&typeof v==='object')for(const x of Object.values(v))walk(x);}walk({configs:state.configs,templates:state.templates,caseGallery:state.caseGallery});
  const done=new Set(store.meta('uploadedAssets')||[]);
  for(const url of urls){const name=filename(url);if(done.has(name))continue;const bytes=await download(url);if(digest(bytes)!==name.split('.')[0])throw Error('原图文件名与内容不一致');
   const response=await fetch(endpoint(name),{method:'POST',headers:{Authorization:`Bearer ${getToken()}`,'Content-Type':name.endsWith('.png')?'image/png':'image/jpeg','x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(60000)});
   if(!response.ok){if(![400,409].includes(response.status))throw Error(`原始图片上传失败（${response.status}）`);const check=await fetch(endpoint(name),{headers:{Authorization:`Bearer ${getToken()}`},signal:AbortSignal.timeout(30000)});if(!check.ok||digest(Buffer.from(await check.arrayBuffer()))!==name.split('.')[0])throw Error('原图上传未确认，请重试');}
   done.add(name);store.setMeta('uploadedAssets',[...done]);
  }
 }
 return {download,uploadAll};
}
