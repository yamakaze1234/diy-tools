export const randomUUID=()=>_uuid();
export const createHash=()=>{let value='';return {update(v){value+=v;return this;},digest(){return _sha256(value);}};};
export default {randomUUID,createHash};
