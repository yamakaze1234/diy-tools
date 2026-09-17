const clone=v=>structuredClone(v),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const collections={configs:'id',templates:'id',sourceCatalog:'sourceId',costSource:'goodsId',caseGallery:'id'};
export function sameEditingState(a,b){return [...Object.keys(collections),'shopSettings'].every(key=>same(a[key],b[key]));}
export function mergeEditingState(base,local,remote){
 const result=clone(remote);let conflict=false;
 const merge=(b,l,r)=>{if(same(l,b))return clone(r);if(same(r,b)||same(l,r))return clone(l);if(!b||!l||!r||Array.isArray(l)){conflict=true;return clone(l);}const v=clone(r);for(const k of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){if(same(l[k],b[k]))continue;if(!same(r[k],b[k])&&!same(r[k],l[k]))conflict=true;if(k in l)v[k]=clone(l[k]);else delete v[k];}return v;};
 for(const [name,key] of Object.entries(collections)){const b=new Map((base[name]||[]).map(r=>[r[key],r])),l=new Map((local[name]||[]).map(r=>[r[key],r])),r=new Map((remote[name]||[]).map(r=>[r[key],r]));result[name]=[...new Set([...r.keys(),...l.keys(),...b.keys()])].map(id=>merge(b.get(id),l.get(id),r.get(id))).filter(Boolean);}
 result.shopSettings=merge(base.shopSettings,local.shopSettings,remote.shopSettings);return {state:result,conflict};
}
