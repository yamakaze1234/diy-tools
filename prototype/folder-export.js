export async function saveImageFolder(files,name){
 const bridge=globalThis.pywebview?.api?.export_image_folder;
 if(!bridge)return null;
 const entries=await Promise.all(files.map(async file=>({name:file.name,base64:await new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('读取导出图片失败'));reader.readAsDataURL(new Blob([file.bytes]));
 })})));
 return bridge({name:name.replace(/\.zip$/i,''),files:entries});
}
