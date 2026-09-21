import {parseStandardProduct,planStandardProduct,exportStandardProduct,standardId} from './product-standard.js';
import {slots} from './core.js';
import {actualParts} from './actual-parts.js';
import {DEFAULT_ERP_SHOP_IDS} from './shops.js';
const $=s=>document.querySelector(s);
let dialogGeneration=0;

export function openStandardProduct(api){
 const {esc,product,shop,openDialog,toast}=api,p=product(),generation=++dialogGeneration;
 if(!p)return toast('请先选择或新建一个商品链接');
 const settings=api.state().shopSettings[p.shopId]||{};
 let payload=null,plan=null,slotChoices={},configChoices={},timer=null,watching=null;
 openDialog('商品同步',`<p class="hint"><strong>${esc(shop().name)} · ${esc(p.name)}</strong><br>ERP 查询和 JSON 导入都先预览，再确认更新当前链接。</p>
 <div class="standard-fields"><label class="field">ERP 店铺 ID<input id="standard-shop" inputmode="numeric" value="${esc(settings.erpShopId||DEFAULT_ERP_SHOP_IDS[p.shopId]||'')}" placeholder="填写 ERP 中此店铺的 ID"></label><label class="field">商品 SPU<input id="standard-spu" inputmode="numeric" value="${esc(p.spu)}" ${p.spu?'readonly':''} placeholder="填写要查询的商品 SPU"></label></div>
 <label class="field">ERP 登录账号姓名<input id="standard-account" maxlength="100" value="${esc(localStorage.getItem('diy-erp-product-account')||'')}" placeholder="与 ERP 顶栏显示的姓名一致"></label>
 <div class="actions"><button id="standard-query" class="primary">ERP 刷新并查询</button><button id="standard-result" hidden>查看上次查询结果</button><button id="standard-cancel" hidden>取消等待</button></div>
 <p class="hint">点击后会从平台刷新该 SPU 到 ERP，并查询上架 SKU 及套餐明细。此步骤不会改动工作台配置。</p>
 <details><summary>连接 ERP 的方法</summary><ol class="hint"><li><a href="/workbench-erp.user.js" target="_blank">安装或更新工作台连接脚本（0.2.0）</a>。</li><li>在浏览器登录 ERP，点击右下角“工作台同步”按钮，填写 ERP 顶栏的账号姓名。</li><li>保持 ERP 页面打开，再点击上方“ERP 刷新并查询”。商品查询不要求打开分库库存。</li></ol></details>
 <details id="standard-json-tools"><summary>标准 JSON 导入 / 导出</summary><p class="hint">兼容商品标准 PR #13。导出本链接中已填写 SKU 的配置；未填写 SKU 的展示页不导出。</p><label class="field">选择 JSON 文件<input id="standard-file" type="file" accept=".json,application/json"></label><label class="field">或粘贴 JSON<textarea id="standard-json" rows="5" spellcheck="false" placeholder="粘贴包含店铺、SPU 和 SKU 的 JSON"></textarea></label><div class="actions"><button id="standard-import">预览导入</button><button id="standard-export">导出标准 JSON</button></div></details>
 <p id="standard-status" class="hint" role="status" aria-live="polite"></p><div id="standard-preview"></div>`);
 const alive=()=>generation===dialogGeneration&&!!$('#standard-status')&&$('#dialog').open;
 const message=t=>{if(alive())$('#standard-status').textContent=t;};
 const shopId=()=>{const id=standardId($('#standard-shop').value,'ERP 店铺 ID');const current=api.state().shopSettings[p.shopId];if(current.erpShopId&&current.erpShopId!==id)throw Error('请先在店铺设置中修改 ERP 店铺对应关系');return id;};
 const request=(path,body)=>api.request('/api/product-sync/'+path,body?{method:'POST',body:JSON.stringify(body)}:{});
 function preview(prices=false){
  if(!payload||!alive())return;
  try{
   plan=planStandardProduct(payload,api.state(),p,{erpShopId:shopId(),slots:slotChoices,configs:configChoices,prices});
   const needs=plan.needs.length;
   $('#standard-preview').innerHTML=`<hr><h3>确认商品变更</h3><p>${esc(plan.data.店铺||'ERP 店铺')}（${esc(plan.data.店铺ID)}） · SPU ${esc(plan.data.SPU编码)}<br>${esc(plan.data.SPU名称||'')} · 更新 ${plan.updated} 套，新增 ${plan.added} 套</p>
   <label><input id="standard-prices" type="checkbox" ${prices?'checked':''}> 同时更新价格：到手价 = SKU 价格 − 本店优惠券 ¥${esc(api.state().shopSettings[p.shopId].coupon)}</label>
   <p class="hint">已有配置更新名称、SKU 资料和有明细的实际配置；图片配件、样式、加购和自定义简称保留。新增配置使用本店默认样式。SKU 库存是网店库存。</p>
   ${plan.bindings.length?`<div class="standard-warning"><strong>本链接有未填写 SKU 的配置，请确认对应关系</strong>${plan.bindings.map(b=>`<label class="field">${esc(b.name)} · SKU ${esc(b.skuId)}<select data-standard-config="${esc(b.skuId)}"><option value="">请选择已有配置，或新增</option><option value="new">新增一套配置</option>${b.choices.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>`).join('')}</div>`:''}
   ${Object.keys(configChoices).length?'<button id="standard-reset-configs">重新选择 SKU 对应配置</button>':''}
   ${needs?`<div class="standard-warning"><strong>请为 ${needs} 个未识别配件选择位置</strong>${plan.needs.map(n=>`<label class="field">${esc(n.name)} · ID ${esc(n.goods_id)}<select data-standard-slot="${esc(n.goods_id)}"><option value="">请选择配件位置</option>${slots.map(s=>`<option>${esc(s)}</option>`).join('')}</select></label>`).join('')}</div>`:''}
   ${Object.keys(slotChoices).length?'<button id="standard-reset-slots">重新选择配件位置</button>':''}
   <div class="standard-rows">${plan.rows.map(row=>{const previous=api.state().configs.find(c=>c.id===row.existingId);return `<details class="standard-row"><summary><strong>${esc(row.name)}</strong><small>${row.existingId?'更新':'新增'} · SKU ${esc(row.skuId)} · ${row.parts.length?row.parts.length+' 种实际配件':'无配件明细'} · 网店库存 ${esc(row.sku.SKU库存??'未知')}${prices?' · 到手价 '+esc(previous?.price??0)+' → '+esc(row.price):''}</small></summary><p class="hint">原配置名：${esc(previous?.name||'新增配置')}<br>ERP 商品 ID：${esc(row.sku.goods_id||'未关联')}<br>原实际配件：${esc(previous?actualParts(previous).filter(p=>p.goodsId||p.name).map(p=>`${p.name} × ${p.qty}（${p.goodsId||'无 ID'}）`).join('；'):'无')}</p>${row.parts.length?'<p><strong>确认后使用以下实际配件：</strong></p>':''}${row.parts.map(part=>`<p>${esc(part.slot||'待选择位置')}：${esc(part.name)} × ${part.qty}<small> · ID ${esc(part.goodsId)}</small></p>`).join('')}</details>`;}).join('')}</div>
   ${plan.warnings.map(w=>`<p class="hint">${esc(w)}</p>`).join('')}${plan.errors.map(e=>`<p class="standard-warning">${esc(e)}</p>`).join('')}
   <div class="actions"><button id="standard-apply" class="primary" ${needs||plan.errors.length||plan.bindings.length?'disabled':''}>确认更新当前链接</button></div>`;
   $('#standard-prices').onchange=e=>preview(e.target.checked);
   document.querySelectorAll('[data-standard-slot]').forEach(el=>el.onchange=()=>{slotChoices[el.dataset.standardSlot]=el.value;preview(prices);});
   document.querySelectorAll('[data-standard-config]').forEach(el=>el.onchange=()=>{configChoices[el.dataset.standardConfig]=el.value;preview(prices);});
   if($('#standard-reset-configs'))$('#standard-reset-configs').onclick=()=>{configChoices={};preview(prices);};
   if($('#standard-reset-slots'))$('#standard-reset-slots').onclick=()=>{slotChoices={};preview(prices);};
   $('#standard-apply').onclick=async()=>{try{$('#standard-apply').disabled=true;await api.apply(plan,p);if(alive())api.closeDialog();toast(`商品已更新：${plan.updated} 套更新，${plan.added} 套新增`);}catch(e){message(e.message);if(alive())$('#standard-apply').disabled=false;}};
   message(needs?'补齐配件位置后即可确认。':'请核对下方内容，确认后更新工作台。');
  }catch(e){plan=null;$('#standard-preview').innerHTML='';message(e.message);}
 }
 function receive(result){payload=null;plan=null;$('#standard-preview').innerHTML='';payload=parseStandardProduct(result);slotChoices={};configChoices={};preview();}
 async function poll(){
  if(!alive())return;
  try{
   const status=await request('status');if(!alive())return;
   const job=status.job,active=job&&['waiting','running'].includes(job.status);
   $('#standard-query').disabled=!!active;$('#standard-cancel').hidden=!active;
   if(active){watching=job.id;message(`${job.progress} · ERP 店铺 ${job.erpShopId} / SPU ${job.spu}`);timer=setTimeout(poll,1500);}
   else if(job?.status==='complete'){
    const matching=job.erpShopId===$('#standard-shop').value.trim()&&job.spu===$('#standard-spu').value.trim();
    if(matching&&watching===job.id){watching=null;receive(job.result);}
    else if(matching){$('#standard-result').hidden=false;$('#standard-result').onclick=()=>{try{receive(job.result);}catch(e){message(e.message);}};}
   }else if(job?.status==='failed')message(job.error);
   else if(job?.status==='cancelled')message(job.progress);
  }catch(e){message(e.message);if(alive())$('#standard-query').disabled=false;}
 }
 $('#standard-query').onclick=async()=>{
  try{
   const erpShopId=shopId(),spu=standardId($('#standard-spu').value,'SPU'),account=$('#standard-account').value.trim();
   if(!account)throw Error('请填写 ERP 顶栏显示的账号姓名');
   if(p.spu&&p.spu!==spu)throw Error('SPU 与当前链接不一致');
   await api.flush();if(!alive())return;
   $('#standard-query').disabled=true;payload=null;plan=null;$('#standard-preview').innerHTML='';$('#standard-result').hidden=true;
   const result=await request('start',{erpShopId,spu,account});localStorage.setItem('diy-erp-product-account',account);watching=result.job.id;clearTimeout(timer);poll();
  }catch(e){message(e.message);if(alive())$('#standard-query').disabled=false;}
 };
 $('#standard-cancel').onclick=async()=>{try{await request('cancel',{});clearTimeout(timer);poll();}catch(e){message(e.message);}};
 $('#standard-import').onclick=()=>{try{receive($('#standard-json').value);}catch(e){message(e.message);}};
 $('#standard-json').oninput=()=>{payload=null;plan=null;$('#standard-preview').innerHTML='';message('内容已修改，请重新预览');};
 $('#standard-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5*1024*1024)throw Error('JSON 文件请小于 5MB');const text=await file.text();if(!alive())return;$('#standard-json').value=text;receive(text);}catch(e){message(e.message);}};
 $('#standard-export').onclick=()=>{try{const result=exportStandardProduct(api.state(),p,{erpShopId:shopId()});api.download(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),`${p.name.replace(/[<>:"/\\|?*]/g,'_')}-商品标准.json`);message('标准 JSON 已导出');}catch(e){message(e.message);}};
 $('#standard-shop').oninput=()=>{if(payload)preview($('#standard-prices')?.checked);};
 poll();
}
