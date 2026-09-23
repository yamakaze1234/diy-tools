const ERP_ORIGIN='https://cqzs.3cerp.com';
export function receiveErpWindow({onSnapshot,onStatus,isActive,host=window}){
 const token=crypto.randomUUID();let popup,interval,finished=false;
 const stop=()=>{finished=true;host.removeEventListener('message',receive);host.clearInterval(interval);};
 const receive=event=>{
  if(finished||!isActive()||event.origin!==ERP_ORIGIN||event.source!==popup||event.data?.token!==token||event.data?.type!=='diy-erp-result')return;
  try{onSnapshot(event.data.snapshot);stop();}catch(error){onStatus(error.message);}
 };
 host.addEventListener('message',receive);
 popup=host.open(ERP_ORIGIN+'/','_blank');
 if(!popup){stop();throw Error('浏览器拦截了 ERP 窗口，请允许弹出窗口后重试');}
 const expires=Date.now()+20*60*1000;
 interval=host.setInterval(()=>{
  if(!isActive()||popup.closed||Date.now()>expires){stop();if(isActive())onStatus('本次接收已结束，需要时重新打开 ERP 接收窗口');return;}
  popup.postMessage({type:'diy-erp-connect',token},ERP_ORIGIN);
 },1000);
 onStatus('已打开 ERP。进入分库库存，核对公司大库后点击“发送到工作台”；保持本窗口打开。');
 return stop;
}
