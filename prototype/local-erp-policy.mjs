import {equal,mergeRecord} from '../shared/sync/protocol.mjs';
export const localErpFields=['erp','stockAvailable','stockUpdatedAt','stockSource','erpUpdatedAt','erpImportedAt','erpMissing','erpUnknown','erpName','localInventoryOnly'];
const fields=new Set(localErpFields);
export const keepCloudType=type=>!['erp_chunk','erp_snapshot'].includes(type);
export function stripLocalErp(value){
 if(Array.isArray(value))return value.map(stripLocalErp);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.has(key)).map(([key,v])=>[key,stripLocalErp(v)]));
}
export const localErpPolicy={keep:keepCloudType,clean:stripLocalErp};
// Retain an immutable local backup before retiring old ERP uploads. Never
// rewrite an already minted mutation's payload under the same mutation ID.
export function migrateLocalErp(store){
 if(store.meta('localErpPolicy')===1)return;
 store.transaction(()=>{
  if(store.list().length)store.backup();
  for(const r of store.list()){
   if(!keepCloudType(r.type)){store.db.prepare('DELETE FROM outbox WHERE type=? AND id=?').run(r.type,r.id);store.db.prepare('DELETE FROM records WHERE type=? AND id=?').run(r.type,r.id);continue;}
   const base=stripLocalErp(r.base),draft=stripLocalErp(r.draft);let conflict=r.conflict?stripLocalErp(r.conflict):null;
   if(conflict?.remote){const merged=mergeRecord(base,draft,conflict.remote.data);if(!merged.fields.length){store.db.prepare('UPDATE records SET base=?,draft=?,version=?,conflict=NULL WHERE type=? AND id=?').run(JSON.stringify(conflict.remote.data),JSON.stringify(merged.value),conflict.remote.version,r.type,r.id);conflict=null;}else{conflict.fields=merged.fields;store.db.prepare('UPDATE records SET base=?,draft=?,conflict=? WHERE type=? AND id=?').run(JSON.stringify(base),JSON.stringify(draft),JSON.stringify(conflict),r.type,r.id);}}
   else store.db.prepare('UPDATE records SET base=?,draft=?,conflict=? WHERE type=? AND id=?').run(JSON.stringify(base),JSON.stringify(draft),conflict?JSON.stringify(conflict):null,r.type,r.id);
  }
  for(const o of store.db.prepare('SELECT * FROM outbox').all()){const request=JSON.parse(o.request);if(!equal(request.payload.after,stripLocalErp(request.payload.after)))store.db.prepare('DELETE FROM outbox WHERE mutation_id=?').run(o.mutation_id);}
  store.setMeta('localErpPolicy',1);
 });
}
