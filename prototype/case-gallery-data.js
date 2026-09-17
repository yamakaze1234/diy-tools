// Gallery entries own metadata; configurations keep their original image URL.
export const galleryFields=['brand','model','color','edition'];
export function isGalleryUrl(url){return typeof url==='string'&&/^\/(?:uploads|assets)\/[\w\-./\u4e00-\u9fff ]+\.(?:png|jpe?g)$/i.test(url)&&!url.split('/').some(p=>p==='.'||p==='..');}
export function validateGallery(rows){
 if(!Array.isArray(rows)||rows.length>3000)throw Error('机箱图库格式不正确（最多 3000 张）');
 const ids=new Set();for(const row of rows){
  if(!row||typeof row.id!=='string'||!row.id||row.id.length>100||ids.has(row.id)||!isGalleryUrl(row.url)||typeof row.name!=='string'||!row.name.trim()||row.name.length>160)throw Error('机箱图片名称、ID 或地址无效');
  for(const field of galleryFields)if(typeof row[field]!=='string'||row[field].length>80)throw Error('机箱图片分类无效');
  if(row.deletedAt!=null&&(typeof row.deletedAt!=='string'||!Number.isFinite(Date.parse(row.deletedAt))))throw Error('机箱图片回收时间无效');
  ids.add(row.id);
 }return rows;
}
export function galleryPath(row){return galleryFields.map((field,i)=>row[field]?.trim()||(i===3?'通用':'待分类'));}
export function filterGallery(rows,{query='',path=[],deleted=false}={}){
 const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 return rows.filter(row=>!!row.deletedAt===deleted&&path.every((part,i)=>galleryPath(row)[i]===part)&&words.every(word=>[row.name,...galleryPath(row)].join(' ').toLocaleLowerCase().includes(word)));
}
export function normalizeGallery(rows,configs=[],templates=[]){
 const result=structuredClone(rows||[]);validateGallery(result);const urls=new Set(result.map(row=>row.url)),ids=new Set(result.map(row=>row.id));
 const all=[...configs,...templates.flatMap(t=>t.configs||[t.config].filter(Boolean))];
 for(const config of all){const url=config.caseImage;if(!isGalleryUrl(url)||urls.has(url))continue;let n=result.length+1;while(ids.has(`legacy-case-${n}`))n++;
  const row={id:`legacy-case-${n}`,url,name:config.parts?.find(p=>p.slot==='机箱')?.name?.slice(0,160)||`已有机箱图片 ${n}`,brand:'',model:'',color:'',edition:'',createdAt:null,updatedAt:null};
  result.push(row);urls.add(url);ids.add(row.id);
 }return result;
}
export function galleryUsage(row,configs){return configs.filter(c=>!c.deletedAt&&c.caseImage===row.url);}
export function useGalleryImage(config,row){if(!row||row.deletedAt||!isGalleryUrl(row.url))throw Error('图片不可用，请从图库重新选择');config.caseImage=row.url;}
