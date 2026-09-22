const clone=v=>structuredClone(v);
// JSON receipts may reorder object keys; that is not a business edit.
const same=(a,b)=>{
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));
 const keys=o=>Object.keys(o).filter(k=>o[k]!==undefined);
 return keys(a).length===keys(b).length&&keys(a).every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
};
const withoutNewLineId=(base,row)=>{const value={...row};if(base.lineId==null)delete value.lineId;return value;};
const collections={configs:'id',templates:'id',sourceCatalog:'sourceId',costSource:'goodsId',caseGallery:'id'};
export function sameEditingState(a,b){return [...Object.keys(collections),'shopSettings'].every(key=>same(a[key],b[key]));}
export function mergeEditingState(base,local,remote){
 const result=clone(remote);let conflict=false;
 const merge=(b,l,r)=>{
  if(same(l,b))return clone(r);if(same(r,b)||same(l,r))return clone(l);
  if(b&&l&&r&&typeof b==='object'&&typeof l==='object'&&typeof r==='object'&&!Array.isArray(l)&&!Array.isArray(r)){
   if('goodsId' in b&&(l.goodsId!==b.goodsId||r.goodsId!==b.goodsId)&&!same(withoutNewLineId(b,l),withoutNewLineId(b,b))&&!same(withoutNewLineId(b,r),withoutNewLineId(b,b))){conflict=true;return clone(l);}
   const v={};for(const k of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){const value=merge(b[k],l[k],r[k]);if(value!==undefined)v[k]=value;}return v;
  }
  if(Array.isArray(b)&&Array.isArray(l)&&Array.isArray(r)){
   const key=['id','lineId','slot','sourceId','goodsId'].find(k=>[b,l,r].every(rows=>rows.every(row=>row&&typeof row==='object'&&row[k]!=null)&&new Set(rows.map(row=>row[k])).size===rows.length));
   if(key){const bm=new Map(b.map(v=>[v[key],v])),lm=new Map(l.map(v=>[v[key],v])),rm=new Map(r.map(v=>[v[key],v]));return [...new Set([...rm.keys(),...lm.keys(),...bm.keys()])].map(id=>merge(bm.get(id),lm.get(id),rm.get(id))).filter(Boolean);}
  }
  conflict=true;return clone(l);
 };
 for(const [name,key] of Object.entries(collections)){const b=new Map((base[name]||[]).map(r=>[r[key],r])),l=new Map((local[name]||[]).map(r=>[r[key],r])),r=new Map((remote[name]||[]).map(r=>[r[key],r]));result[name]=[...new Set([...r.keys(),...l.keys(),...b.keys()])].map(id=>merge(b.get(id),l.get(id),r.get(id))).filter(Boolean);}
 result.shopSettings=merge(base.shopSettings,local.shopSettings,remote.shopSettings);return {state:result,conflict};
}
