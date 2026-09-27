export const randomUUID=()=>_uuid();
export const createHash=()=>{let value='';return {update(v){value+=v;return this;},digest(){
 if(value.length<=1000)return _sha256(value);
 const key=_sha256_start();
 for(let i=0;i<value.length;){let end=Math.min(i+1000,value.length);const last=value.charCodeAt(end-1);if(end<value.length&&last>=0xD800&&last<=0xDBFF)end++;
  _sha256_update(key,value.slice(i,end));i=end;}
 return _sha256_finish(key);
}};};
export default {randomUUID,createHash};
