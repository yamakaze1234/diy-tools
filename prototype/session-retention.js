export const LOGIN_RETENTION_MS=7*24*60*60*1000;
const key='diy-login-retained-until';
export function loginRetention(storage=localStorage,now=()=>Date.now()){
 return {
  valid(){const expiry=Number(storage.getItem(key));return Number.isFinite(expiry)&&expiry>now()&&expiry<=now()+LOGIN_RETENTION_MS;},
  until(){return Number(storage.getItem(key))||0;},
  remember(){storage.setItem(key,String(now()+LOGIN_RETENTION_MS));},
  clear(){storage.removeItem(key);},
 };
}
