// ==UserScript==
// @name         DIY 工作台库存与 ERP 成本同步
// @namespace    local.diy.workbench
// @version      0.2.1
// @description  按工作台指令读取库存成本，或刷新指定店铺 SPU 的网店商品并查询明细
// @match        https://cqzs.3cerp.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      127.0.0.1
// @noframes
// @run-at       document-idle
// ==/UserScript==
(function(){
 'use strict';
 // Pagination, stock semantics and identity checks adapted from
 // 后台库存监控/inventory-erp.user.js 0.4.0; original monitor is not modified.
 async function collectPages(fetchPage){let rows=[],expected=null;for(let page=0;page<500;page++){const result=await fetchPage(page);if(!result||result.result===false||result.success===false||result.st!==undefined&&result.st!==0)throw Error('ERP 未返回有效库存');const data=result.data||result.rows||result.list,total=Number(result.total);if(!Array.isArray(data)||result.total===undefined||!Number.isInteger(total)||total<0)throw Error('库存分页数据不完整');if(expected===null)expected=total;if(expected!==total)throw Error('分页期间总数变化，请重试');rows.push(...data);if(rows.length===expected)return rows;if(!data.length||rows.length>expected)throw Error('库存分页数量不一致');}throw Error('分页超过上限');}
 function numeric(value,label){if(value===null)return null;if(value===undefined||typeof value==='string'&&!value.trim()||!['number','string'].includes(typeof value)||!Number.isFinite(Number(value)))throw Error(label+'字段缺失或无效');return Number(value);}
 function normalizeRows(rows,costField){const seen=new Set();return rows.map(row=>{const goodsId=String(row.goods_id||'');if(!/^\d{1,20}$/.test(goodsId)||goodsId==='0'||seen.has(goodsId))throw Error('商品 ID 缺失或重复');seen.add(goodsId);const name=String(row.b_c_name||'').trim();if(!name)throw Error('商品名称缺失');const erp=numeric(row[costField],'ERP 成本');if(erp!==null&&erp<0)throw Error('ERP 成本为负数');return{goodsId,name,stockAvailable:numeric(row.n_stock_able,'可销库存'),erp};});}
 // Product endpoints and field mapping follow CoreHub/pypkgs PR 13 (b550c733).
 function productId(value,label,nullable=false){
  if(nullable&&(value===null||value===undefined||value===''))return null;
  if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error(label+' 已失去编码精度');
  const id=String(value??'').trim().replace(/^(\d+)\.0$/,'$1');
  if(!/^\d{1,30}$/.test(id)||/^0+$/.test(id))throw Error(label+' 无效');return id;
 }
 function productNumber(v,label){if(v==null)return null;return numeric(v,label);}
 function productResponse(result){
  if(!result||typeof result!=='object'||Array.isArray(result)||result.result===false||result.success===false||result.st!==undefined&&result.st!==0)throw Error('ERP 商品接口返回失败，原配置已保留');
  return result;
 }
 async function collectProduct(request,job,progress=async()=>{}){
  productId(job.erpShopId,'店铺 ID');productId(job.spu,'SPU');
  await progress('正在从平台刷新此 SPU 到 ERP');
  productResponse(await request('/pages/net/downNetGoods.htm',{shopId:job.erpShopId,spuIds:job.spu,syncType:'spuId'},true));
  const raw=await collectPages(async page=>{
   await progress(`正在查询商品第 ${page+1} 页`);
   return request('/pages/net/getNetGoodsList.htm',{pageIndex:String(page),pageSize:'2000',shop_id:job.erpShopId,c_status:'',is_res:'-1',beginDate:'',endDate:'',search_date_key:'search_sku_date',search_name_key:'search_spu_name',search_name_value:'',search_code_key:'search_spu_code',search_code_value:job.spu,search_delivery_templet_id:'',search_depot_id:'',search_data_source:'',search_net_stock_sync:''});
  });
  if(raw.length>500)throw Error('商品 SKU 超过 500，请缩小查询范围');
  const seen=new Set();
  for(const row of raw){if(productId(row.shop_id,'返回店铺 ID')!==job.erpShopId||productId(row.product_id,'返回 SPU')!==job.spu)throw Error('ERP 返回了其他店铺或 SPU，已停止');const id=productId(row.sku_id,'SKU');if(seen.has(id))throw Error('ERP 分页返回重复 SKU，请重试');seen.add(id);}
  const rows=raw.filter(r=>r.c_status==='上架');if(!rows.length)return {SKU:{}};
  const first=rows[0],result={店铺ID:job.erpShopId,店铺:first.shop_name??null,数据来源:first.c_data_source??null,状态:'上架',网店类别:first.category_name??null,SPU编码:job.spu,SPU名称:first.c_title??null,备注:first.c_remark??null,SKU:{}};
  const details=new Map();
  for(const row of rows){
   const id=productId(row.sku_id,'SKU'),goods=productId(row.goods_id,'ERP 商品 ID',true);
   if(goods&&!details.has(goods)){
    await progress(`正在查询套餐明细 ${details.size+1}`);
    const response=productResponse(await request('/pages/goods/searchGoodsDetail.htm',{onlyComponent:'-1',goodsId:goods}));
    if(!Array.isArray(response.data))throw Error('ERP 未返回有效的套餐明细');
    if(response.data.length>200)throw Error('套餐明细超过 200 行');
    details.set(goods,response.data.map(p=>({goods_id:productId(p.goods_id,'配件 ID'),n:productNumber(p.n,'配件数量'),商品名称:p.c_name??null,简称:p.c_model??null})));
   }
   result.SKU[id]={SKU名称:row.sku_name??null,SKU价格:productNumber(row.d_sku_price,'SKU价格'),SKU库存:productNumber(row.sku_num,'SKU库存'),SKU更新时间:row.update_time?.replace(' ','T')??null,goods_id:goods,商品名称:row.goods_name??null,图片网址:row.c_pic_url??null,商品网址:row.c_detail_url??null,关联更新时间:row.t_res?.replace(' ','T')??null,SKU明细:details.get(goods)||[]};
  }
  return result;
 }
 if(typeof module==='object'&&module.exports){module.exports={collectPages,normalizeRows,collectProduct};return;}
 if(window.top!==window.self)return;
 const pageWindow=typeof unsafeWindow!=='undefined'?unsafeWindow:window;
 const clientId=crypto.randomUUID();let busy=false;
 const badge=document.createElement('button');badge.textContent='工作台同步：点击连接';Object.assign(badge.style,{position:'fixed',right:'18px',bottom:'80px',zIndex:2147483000,padding:'10px 14px',border:'1px solid #8bbef7',borderRadius:'8px',background:'#edf5ff',color:'#164570',cursor:'pointer'});document.body.append(badge);
 function frames(win=pageWindow,depth=0){const out=[win];if(depth<6)for(const f of win.document.querySelectorAll('iframe'))try{if(f.contentWindow.document)out.push(...frames(f.contentWindow,depth+1));}catch{}return out;}
 function warehouse(){const values=[];for(const win of frames()){for(const select of win.document.querySelectorAll('select')){const option=select.selectedOptions?.[0];if(option?.textContent.trim()==='公司大库'&&/^\d+$/.test(option.value))values.push(option.value);}if(win.mini)for(const id of ['depot_id','depotIds','depotId'])try{const control=win.mini.get(id);if(control&&control.getText().trim()==='公司大库'&&/^\d+$/.test(String(control.getValue())))values.push(String(control.getValue()));}catch{}}const unique=[...new Set(values)];if(unique.length!==1)throw Error('请打开分库库存并选择公司大库');return unique[0];}
 function accountVisible(name){const header=document.querySelector('.topNav')||document.querySelector('.navbar');return !!header&&[...header.querySelectorAll('a,span')].some(el=>el.getClientRects().length&&el.innerText.trim()===name);}
 function costColumns(){const cols=[];const text=value=>{const div=document.createElement('div');div.innerHTML=String(value||'');return div.textContent.replace(/\s+/g,'').trim();};for(const win of frames()){if(!win.mini)continue;for(const el of win.document.querySelectorAll('.mini-datagrid'))try{const grid=win.mini.get(el.id);if(!grid?.getColumns)continue;const flatten=items=>items.flatMap(c=>c.columns?flatten(c.columns):[c]);const columns=flatten(grid.getColumns());if(!columns.some(c=>c.field==='n_stock_able'))continue;for(const c of columns){const header=text(c.header);if(c.field&&/成本/.test(header)&&!/金额|总|合计/.test(header))cols.push({field:c.field,header});}}catch{}}return [...new Map(cols.map(c=>[c.field,c])).values()];}
 function configure(runTick=true){try{const depotId=warehouse();const account=prompt('请输入 ERP 顶栏显示的账号姓名（不是密码）');if(!account)return;if(!accountVisible(account.trim()))throw Error('ERP 顶栏未找到此账号');const columns=costColumns();if(!columns.length)throw Error('未识别到成本单价列，请在分库库存显示成本列后再连接');let index=0;if(columns.length>1){const value=prompt('选择 ERP 成本单价列编号：\n'+columns.map((c,i)=>`${i+1}. ${c.header}`).join('\n'));if(value===null)return;index=Number(value)-1;if(!Number.isInteger(index)||!columns[index])throw Error('列编号无效');}GM_setValue('diy_connection',{account:account.trim(),depotId,costField:columns[index].field,costHeader:columns[index].header});badge.textContent='工作台同步：已设置，等待连接';if(runTick!==false)tick();}catch(e){alert(e.message);}}
 function configureProduct(){const account=prompt('连接商品查询：请输入 ERP 顶栏显示的账号姓名（不是密码）',GM_getValue('diy_product_account',''));if(!account)return;if(!accountVisible(account.trim()))return alert('ERP 顶栏未找到此账号，请先登录并核对');GM_setValue('diy_product_account',account.trim());badge.textContent='工作台商品查询：已设置';tick();}
 badge.onclick=configureProduct;GM_registerMenuCommand('连接商品查询',configureProduct);GM_registerMenuCommand('连接库存与成本同步',configure);
 // Static web clients use the same verified collector without a localhost server.
 async function exportWebSnapshot(){
  if(busy)return alert('正在采集，请稍后再试');
  let config=GM_getValue('diy_connection',null);if(!config){configure(false);config=GM_getValue('diy_connection',null);}if(!config)return;
  busy=true;
  const verify=()=>{if(warehouse()!==config.depotId||!accountVisible(config.account))throw Error('账号或仓库不匹配，已停止导出');const columns=costColumns();if(!columns.some(c=>c.field===config.costField&&c.header===config.costHeader))throw Error('成本列发生变化，请重新连接');};
  try{verify();const raw=await collectPages(async page=>{verify();badge.textContent=`网页版库存：读取第 ${page+1} 页`;const body=new URLSearchParams({filter:'',depotIds:config.depotId,b_stock:'0',search_category:'',search_out_stock:'0',search_zero_stock:'0',pageSize:'2000',pageIndex:String(page),sortField:'',sortOrder:''});const result=await fetch('/pages/stock/searchDeoptStockList.htm',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},body,signal:AbortSignal.timeout(30000)});verify();if(!result.ok||result.redirected||!result.headers.get('content-type')?.includes('json'))throw Error('ERP 登录失效或库存请求失败');return result.json();});
   const rows=normalizeRows(raw,config.costField);verify();if(!rows.length)throw Error('ERP 返回空数据，未导出');
   const snapshot={format:'diy-erp-snapshot-v1',origin:'https://cqzs.3cerp.com',account:config.account,warehouse:'公司大库',depotId:config.depotId,costField:config.costField,costHeader:config.costHeader,capturedAt:new Date().toISOString(),complete:true,total:rows.length,rows};
   const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='ERP库存快照-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);badge.textContent=`已导出 ${rows.length} 条，请在网页版 ERP 同步中导入`;
  }catch(e){alert(e.message);badge.textContent='网页版库存：'+e.message;}finally{busy=false;}
 }
 GM_registerMenuCommand('导出轻量网页版库存快照',exportWebSnapshot);
 const webExport=document.createElement('button');webExport.textContent='导出网页版库存';Object.assign(webExport.style,{position:'fixed',right:'18px',bottom:'35px',zIndex:2147483000,padding:'10px 14px',border:'1px solid #8bbef7',borderRadius:'8px',background:'#edf5ff',color:'#164570',cursor:'pointer'});webExport.onclick=exportWebSnapshot;document.body.append(webExport);
 function local(path,data){return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'POST',url:'http://127.0.0.1:4178/api/erp-bridge/'+path,headers:{'Content-Type':'application/json','X-DIY-Collector':'workbench-erp-v1'},data:JSON.stringify(data),timeout:25000,onload:r=>{try{const j=JSON.parse(r.responseText);if(r.status!==200)throw Error(j.error||'工作台连接失败');resolve(j);}catch(e){reject(e);}},onerror:()=>reject(Error('请启动本机配置工作台')),ontimeout:()=>reject(Error('工作台连接超时'))}));}
 async function tickProduct(){
  const account=GM_getValue('diy_product_account','')||GM_getValue('diy_connection',null)?.account;
  if(!account)return false;
  let job;const identity={clientId,account};
  const verify=()=>{if(!accountVisible(account))throw Error('ERP 登录账号已变化，请重新连接商品查询');};
  try{
   verify();job=(await local('product-poll',identity)).job;if(!job){badge.textContent='工作台商品查询：已连接';return false;}
   const credentials={...identity,jobId:job.id,token:job.token};
   const result=await collectProduct(async(path,params,form=false)=>{
    verify();const encoded=new URLSearchParams(params);
    const response=await fetch(path+(form?'':'?'+encoded),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},...(form?{body:encoded}:{}),signal:AbortSignal.timeout(45000)});
    verify();if(!response.ok||response.redirected)throw Error('ERP 登录失效或商品查询失败');
    try{return await response.json();}catch{throw Error('ERP 未返回 JSON，请检查登录或接口权限');}
   },job,async progress=>{verify();badge.textContent='工作台商品查询：'+progress;await local('product-progress',{...credentials,progress});});
   verify();await local('product-result',{...credentials,result});badge.textContent='商品查询完成，请返回工作台预览';return true;
  }catch(e){badge.textContent='工作台商品查询：'+e.message;if(job)await local('product-error',{...identity,jobId:job.id,token:job.token,error:e.message}).catch(()=>{});return true;}
 }
 async function tick(){if(busy)return;busy=true;let identity,job;try{if(await tickProduct())return;const config=GM_getValue('diy_connection',null);if(!config)return;if(warehouse()!==config.depotId||!accountVisible(config.account))throw Error('账号或仓库不匹配，请重新核对');identity={clientId,account:config.account,warehouse:'公司大库',depotId:config.depotId};const response=await local('poll',identity);job=response.job;if(!job){badge.textContent='工作台同步：已连接';return;}const columns=costColumns();if(!columns.some(c=>c.field===config.costField&&c.header===config.costHeader))throw Error('成本列发生变化，请重新连接');const credentials={...identity,jobId:job.id,token:job.token};const raw=await collectPages(async page=>{if(warehouse()!==config.depotId||!accountVisible(config.account))throw Error('采集期间账号或仓库变化');badge.textContent=`工作台同步：读取第 ${page+1} 页`;await local('progress',{...credentials,progress:`正在读取第 ${page+1} 页`});const body=new URLSearchParams({filter:'',depotIds:config.depotId,b_stock:'0',search_category:'',search_out_stock:'0',search_zero_stock:'0',pageSize:'2000',pageIndex:String(page),sortField:'',sortOrder:''});const result=await fetch('/pages/stock/searchDeoptStockList.htm',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},body,signal:AbortSignal.timeout(30000)});if(!result.ok||result.redirected||!result.headers.get('content-type')?.includes('json'))throw Error('ERP 登录失效或库存请求失败');return result.json();});const rows=normalizeRows(raw,config.costField);if(warehouse()!==config.depotId||!accountVisible(config.account))throw Error('采集期间账号或仓库变化');await local('snapshot',{...credentials,complete:true,total:rows.length,costField:config.costField,rows});badge.textContent=`工作台同步：成功 ${rows.length} 条`;}catch(e){badge.textContent='工作台同步：'+e.message;if(identity&&job)await local('error',{...identity,jobId:job.id,token:job.token,error:e.message}).catch(()=>{});}finally{busy=false;}}
 setInterval(tick,5000);tick();
})();
