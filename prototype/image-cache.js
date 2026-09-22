// Share decoded originals between upload, gallery selection and poster rendering.
const images=new Map();
export function rememberImage(url,image){
 if(!url||!image.complete||!image.naturalWidth||!image.naturalHeight)return false;
 images.delete(url);images.set(url,Promise.resolve(image));
 while(images.size>24)images.delete(images.keys().next().value);
 return true;
}
export async function getImage(url){
 if(!url)return null;
 if(!images.has(url)){
  const pending=new Promise((resolve,reject)=>{
   const image=new Image();image.decoding='async';
   const fail=message=>{clearTimeout(timer);if(images.get(url)===pending)images.delete(url);image.onload=image.onerror=null;reject(Error(message));};
   const timer=setTimeout(()=>fail('图片载入超时，请重试或更换素材'),15000);
   image.onload=()=>{clearTimeout(timer);rememberImage(url,image);resolve(image);};
   image.onerror=()=>fail('图片载入失败，请重新选择素材');image.src=url;
  });
  images.set(url,pending);
 }
 return images.get(url);
}
