export function mountSourceProductLookup(root,{draft,getCosts,lookupProduct,onChange}){
 const id=root.querySelector('#source-id'),name=root.querySelector('#source-name'),price=root.querySelector('#source-erp-price'),status=root.querySelector('#source-erp-status'),refresh=root.querySelector('#source-erp-refresh');
 let observation=null,revision=0,timer,pending=false,lastId=id.value.trim(),edited=false;
 name.addEventListener('input',()=>{edited=true;});
 const valid=()=>root.isConnected&&id.value.trim()===lastId;
 const show=row=>{
  const value=row?.erp;
  price.value=value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value).toFixed(2):'暂无';
 };
 const apply=(row,fillName)=>{
  show(row);const erpName=row?.erpName||row?.name||'';
  if(fillName&&!edited&&erpName)name.value=erpName;
  onChange();
 };
 async function query(){
  clearTimeout(timer);observation=null;const ticket=++revision,goodsId=id.value.trim();lastId=goodsId;
  if(!/^[1-9]\d{0,19}$/.test(goodsId)){pending=false;show(null);status.textContent='请输入准确的数字 ERP ID';return;}
  pending=true;status.textContent='正在查询 ERP 最新名称和单价…';
  try{
   if(!lookupProduct)throw Error('当前连接不支持实时查询，请先同步 ERP 数据');
   const row=await lookupProduct(goodsId);
   if(ticket!==revision||!valid())return;
   if(row.goodsId!==goodsId)throw Error('ERP 返回的商品 ID 不匹配');
   if(!row.found){apply(null,false);status.textContent='ERP 中未找到此 ID，请核对';return;}
   observation={erp:row.erp??null,erpName:row.name,erpUpdatedAt:row.collectedAt||new Date().toISOString()};apply(row,true);status.textContent=`ERP 已查询 · ${row.collectedAt?new Date(row.collectedAt).toLocaleString():'刚刚'}${row.erp==null?' · 公司大库暂无单价':''}`;
  }catch(error){if(ticket===revision&&valid())status.textContent=`${error.message}。${price.value==='暂无'?'暂无可用单价':'当前显示已同步价格，并非实时价格'}`;}
  finally{if(ticket===revision)pending=false;}
 }
 id.addEventListener('input',()=>{
  ++revision;clearTimeout(timer);pending=false;observation=null;const next=id.value.trim();
  if(next!==lastId){lastId=next;edited=false;name.value='';}
  const cached=getCosts().find(row=>row.goodsId===next);
  apply(cached,true);status.textContent=cached?'已同步数据，等待查询 ERP…':'等待查询 ERP…';
  if(/^[1-9]\d{0,19}$/.test(next)){pending=true;timer=setTimeout(query,350);}else status.textContent='请输入准确的数字 ERP ID';
 });
 refresh.onclick=query;
 // Existing display names are authored content and must survive price refresh.
 show(getCosts().find(row=>row.goodsId===lastId)||draft);
 edited=!!name.value.trim();
 return {observation:()=>observation,isPending:()=>pending,dispose:()=>{++revision;clearTimeout(timer);pending=false;}};
}
