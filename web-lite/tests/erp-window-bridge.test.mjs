import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveErpWindow} from '../erp-window-bridge.mjs';

function fixture(){
 let listener,tick,request,active=true,received=0,cleared=false;
 const popup={closed:false,postMessage(data,origin){request={data,origin};}};
 const host={open:()=>popup,addEventListener:(_,fn)=>{listener=fn;},removeEventListener:()=>{listener=null;},setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{cleared=true;}};
 const stop=receiveErpWindow({host,isActive:()=>active,onStatus:()=>{},onSnapshot:()=>{received++;}});
 tick();
 return {popup,stop,tick,send:patch=>listener?.({source:popup,origin:request.origin,data:{type:'diy-erp-result',token:request.data.token,snapshot:{}},...patch}),deactivate:()=>{active=false;},get received(){return received;},get cleared(){return cleared;}};
}
test('accept only paired ERP window, origin and token; stop after one snapshot',()=>{
 const f=fixture();f.send({source:{}});f.send({origin:'https://example.com'});f.send({data:{type:'diy-erp-result',token:'wrong'}});assert.equal(f.received,0);
 f.send();f.send();assert.equal(f.received,1);assert.equal(f.cleared,true);
});
test('closed popup and inactive dialog stop receiving',()=>{
 for(const reason of ['popup','dialog']){const f=fixture();if(reason==='popup')f.popup.closed=true;else f.deactivate();f.tick();f.send();assert.equal(f.received,0);assert.equal(f.cleared,true);}
});
test('blocked popup removes listener',()=>{
 let removed=false;assert.throws(()=>receiveErpWindow({host:{addEventListener(){},removeEventListener(){removed=true;},clearInterval(){},open(){return null;}},isActive:()=>true,onStatus(){},onSnapshot(){}}),/拦截/);assert.equal(removed,true);
});
