import {rememberImage} from './image-cache.js';

export async function uploadImage(file,request){
 if(file.size>24*1024*1024)throw Error('图片请小于 24MB');
 if(!['image/png','image/jpeg'].includes(file.type))throw Error('请选择 PNG 或 JPG 图片');
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.decoding='async';image.src=url;
  try{await image.decode();}catch{throw Error('无法读取图片，请选择有效的 PNG 或 JPG');}
  if(!image.naturalWidth||!image.naturalHeight)throw Error('图片尺寸无效');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('读取图片失败'));reader.readAsDataURL(file);});
  const uploaded=await request('/api/asset',{method:'POST',body:JSON.stringify({base64:data.split(',')[1]})});
  rememberImage(uploaded.url,image);return uploaded.url;
 }finally{URL.revokeObjectURL(url);}
}
