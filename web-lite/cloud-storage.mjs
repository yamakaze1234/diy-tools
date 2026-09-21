// Large immutable workspace snapshots and small, frequent draft edits share
// one atomic revision guard. Auxiliary array keys cannot collide with user keys.
export function openCloudStorage(indexedDB=globalThis.indexedDB){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('diy-web-lite-cloud',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('workspaces');
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(Error('数据库升级被旧页面占用，请关闭旧的云端页后刷新'));
  request.onsuccess=()=>{
   const db=request.result;db.onversionchange=()=>db.close();
   function write(key,value,expectedRevision,draftOnly){return new Promise((done,fail)=>{
    const tx=db.transaction('workspaces','readwrite'),store=tx.objectStore('workspaces');let reason;
    const apply=revision=>{if(revision!==expectedRevision){reason=Error('另一窗口已修改工作区，请导出当前副本后刷新');tx.abort();return;}
     if(draftOnly)store.put({revision:value.revision,drafts:value.drafts},[key,'drafts']);
     else{store.put(value,key);store.delete([key,'drafts']);}
     store.put(value.revision,[key,'revision']);
    };
    const version=store.get([key,'revision']);version.onsuccess=()=>{if(version.result!==undefined)apply(version.result);else{const base=store.get(key);base.onsuccess=()=>apply(base.result?.revision||0);}};
    tx.oncomplete=()=>done();tx.onabort=tx.onerror=()=>fail(reason||tx.error||Error('浏览器数据库保存失败'));
   });}
   resolve({
    get(key){return new Promise((done,fail)=>{const tx=db.transaction('workspaces','readonly'),store=tx.objectStore('workspaces'),base=store.get(key),draft=store.get([key,'drafts']);tx.oncomplete=()=>done(base.result?{...base.result,...(draft.result||{})}:null);tx.onabort=tx.onerror=()=>fail(tx.error||Error('浏览器数据库读取失败'));});},
    put:(key,value,expectedRevision)=>write(key,value,expectedRevision,false),
    putDrafts:(key,value,expectedRevision)=>write(key,value,expectedRevision,true),
    close(){db.close();}
   });
  };
 });
}
