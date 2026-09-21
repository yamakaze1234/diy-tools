import {actualParts} from './actual-parts.js';
import {checkInventory,componentStock,stockReplacementPlan,validateStockReplacement,inventoryThreshold} from './inventory-check-data.js';
import {mountProductSearch} from './product-search.js';
import {inventoryLinks} from './inventory-export.js';
import {sourceImageEntries} from './source-sync-data.js';
import {isSpecialComponent} from './special-components.js';
import {addonSummary} from './addon-data.js';
import {renderPoster} from './poster.js';
import {makeZip} from './zip.js';

const labels={out:'无库存',low:'低库存',unknown:'库存未知',ok:'库存充足'};
export function openInventoryCheck(api){
 const {openDialog,esc,getConfigs,getCosts,getCatalog,shop,save,download}=api;
 let threshold=5;try{threshold=inventoryThreshold(localStorage.getItem('diy-stock-threshold')??5);}catch{}
 openDialog('检查链接库存',`<p class="hint">${esc(shop.name)} · 检查本机最近一次 ERP 库存，特殊配件不参与检查；图片中隐藏的普通配件仍检查。库存未知不视为无库存。如需最新数据，请先使用顶部 ERP同步。</p><div class="stock-check-toolbar"><label class="field">低库存阈值（≤）<input id="stock-threshold" type="number" min="0" max="100000000" step="1" value="${threshold}"></label><button id="stock-scan" class="primary">重新检查</button></div><p id="stock-summary" class="hint"></p><div id="stock-results"></div><section id="stock-work" hidden><h3 id="stock-edit-title"></h3><div class="actions"><button id="stock-select-all">全选对应链接</button><button id="stock-select-none">取消全选</button></div><div id="stock-links" class="global-list"></div><div id="stock-picker"></div><p class="hint">保留原配件数量；替换时同步处理绑定的加购描述，独立加购保留。请核对下方变化后应用。</p><div class="source-fields"><span>保存后导出所选链接全部配置：</span><label><input type="checkbox" data-stock-layout="long">配置图</label><label><input type="checkbox" data-stock-layout="square">SKU 图</label></div><div class="actions"><button id="stock-preview">预览替换</button><button id="stock-apply" class="primary" disabled>应用并保存</button><button id="stock-retry" hidden>重新保存并导出</button></div><div id="stock-diff"></div></section><p id="stock-message" class="hint" role="status" aria-live="polite"></p>`);
 const dialog=document.querySelector('#dialog'),root=document.querySelector('#dialog-body'),$=s=>root.querySelector(s);dialog.classList.add('stock-check-dialog');
 let report=null,issue=null,plan=null,picker=null,busy=false,retry=null,locks=[];
 const message=text=>{if(root.isConnected)$('#stock-message').textContent=text;};
 const invalidate=()=>{plan=null;$('#stock-apply').disabled=true;$('#stock-diff').innerHTML='';};
 const layouts=()=>[...root.querySelectorAll('[data-stock-layout]:checked')].map(el=>el.dataset.stockLayout);
 const picked=()=>[...root.querySelectorAll('[data-stock-link]:checked')].map(el=>el.value);
 function lock(value){busy=value;if(value){locks=[...dialog.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);locks.forEach(([el])=>el.disabled=true);}else locks.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});}
 const controller=new AbortController();dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();},{signal:controller.signal});dialog.addEventListener('close',()=>controller.abort(),{once:true});
 const date=value=>value?new Date(value).toLocaleString():'未记录时间';
 const describe=row=>isSpecialComponent(row)?'特殊配件 · 不检查库存':(()=>{const s=componentStock(row.goodsId,getCosts(),report?.threshold??threshold);return `ID ${row.goodsId} · ${labels[s.status]}${s.value===null?'':` ${s.value}`} · ${date(s.updatedAt)}`;})();
 function drawReport(){
  const actionable=report.issues.filter(r=>r.status!=='unknown'),unknown=report.issues.filter(r=>r.status==='unknown');
  $('#stock-summary').textContent=`检查 ${report.linkCount} 个链接、${report.configCount} 套配置；无库存 ${actionable.filter(r=>r.status==='out').length} 种，低库存 ${actionable.filter(r=>r.status==='low').length} 种，未知 ${unknown.length} 种；忽略 ${report.skippedSpecial} 处特殊配件。`;
  const card=(row,i)=>`<article class="stock-issue"><div class="stock-issue-heading"><div><strong class="stock-${row.status}">${labels[row.status]}${row.value===null?'':' · '+row.value}</strong><h4>${esc(row.name)}</h4><small>goodsId ${esc(row.goodsId||'未绑定')} · 库存时间：${esc(date(row.updatedAt))}${row.reason?' · '+esc(row.reason):''}</small></div>${row.status==='unknown'?'':`<button data-stock-edit="${i}">勾选链接并替换</button>`}</div><div class="stock-occurrences">${row.sources.map(s=>`<div><span><strong>${esc(s.product)}</strong> · ${esc(s.config)} · ${esc(s.slot)} ×${s.qty}<small>SPU ${esc(s.spu||'未填写')}</small></span><button data-stock-locate="${esc(s.configId)}">定位配置</button></div>`).join('')}</div></article>`;
  $('#stock-results').innerHTML=actionable.map(row=>card(row,report.issues.indexOf(row))).join('')||'<p class="hint">本次未发现低库存或无库存配件。</p>';
  if(unknown.length)$('#stock-results').innerHTML+=`<details class="stock-unknown"><summary>库存未知（${unknown.length} 种）· 展开查看</summary>${unknown.map(row=>card(row,report.issues.indexOf(row))).join('')}</details>`;
  root.querySelectorAll('[data-stock-locate]').forEach(b=>b.onclick=()=>api.locate(b.dataset.stockLocate));
  root.querySelectorAll('[data-stock-edit]').forEach(b=>b.onclick=()=>edit(report.issues[Number(b.dataset.stockEdit)]));
 }
 async function scan(){if(busy)return;try{threshold=inventoryThreshold($('#stock-threshold').value);lock(true);await save();report=checkInventory(getConfigs(),getCosts(),shop.id,threshold);try{localStorage.setItem('diy-stock-threshold',String(threshold));}catch{}issue=null;retry=null;invalidate();$('#stock-work').hidden=true;drawReport();message('检查完成。展开对应链接定位配置，或勾选链接替换缺货配件。');}catch(e){message(e.message);}finally{lock(false);$('#stock-apply').disabled=true;}}
 function edit(row){if(busy)return;issue=row;retry=null;invalidate();$('#stock-work').hidden=false;$('#stock-retry').hidden=true;$('#stock-edit-title').textContent=`替换：${row.name} · ${labels[row.status]} ${row.value}`;
  const groups=new Map();for(const s of row.sources){if(!groups.has(s.productId))groups.set(s.productId,[]);groups.get(s.productId).push(s);}
  $('#stock-links').innerHTML=[...groups].map(([id,items])=>`<label><input type="checkbox" data-stock-link value="${esc(id)}"><span><strong>${esc(items[0].product)}</strong><small>SPU ${esc(items[0].spu||'未填写')} · ${esc([...new Set(items.map(s=>s.config))].join('、'))}</small></span></label>`).join('');
  root.querySelectorAll('[data-stock-link]').forEach(el=>el.onchange=invalidate);
  picker=mountProductSearch($('#stock-picker'),{getRows:getCatalog,idKey:'sourceId',label:'选择替换配件',inputId:'stock-new-query',describe,onChange:invalidate});
  $('#stock-work').scrollIntoView({block:'start'});message('勾选要修改的链接，再选择新配件并预览。');
 }
 $('#stock-scan').onclick=scan;$('#stock-threshold').oninput=()=>{report=null;issue=null;invalidate();$('#stock-results').innerHTML='';$('#stock-work').hidden=true;$('#stock-summary').textContent='阈值已修改，请重新检查。';};
 $('#stock-select-all').onclick=()=>{root.querySelectorAll('[data-stock-link]').forEach(el=>el.checked=true);invalidate();};$('#stock-select-none').onclick=()=>{root.querySelectorAll('[data-stock-link]').forEach(el=>el.checked=false);invalidate();};root.querySelectorAll('[data-stock-layout]').forEach(el=>el.onchange=invalidate);
 $('#stock-preview').onclick=()=>{try{
  plan=stockReplacementPlan(getConfigs(),getCosts(),getCatalog(),report,issue.key,picked(),picker.value());
  $('#stock-diff').innerHTML=plan.changes.map(c=>`<details class="stock-change" open><summary>${esc(c.product)} / ${esc(c.name)}</summary>${actualParts(c.before).flatMap((p,i)=>JSON.stringify(p)!==JSON.stringify(actualParts(c.after)[i])?[`<p>${esc(p.slot)}：${esc(p.name)}（${esc(p.goodsId||'特殊配件')}）×${p.qty} → ${esc(actualParts(c.after)[i].name)}（${esc(actualParts(c.after)[i].goodsId||'特殊配件')}）×${actualParts(c.after)[i].qty}</p>`]:[]).join('')}<p>加购原内容：${esc(c.before.addons.map(addonSummary).join('；')||'无')}</p><p>加购新内容：${esc(c.after.addons.map(addonSummary).join('；')||'无')}</p></details>`).join('');
  $('#stock-apply').disabled=false;message(`将修改 ${plan.productIds.length} 个链接、${plan.changes.length} 套配置。新配件：${describe(plan.replacement)}。${layouts().length?'保存后导出所选链接全部配置的'+layouts().map(l=>l==='long'?'配置图':'SKU 图').join('、')+'。':''}`);
 }catch(e){invalidate();message(e.message);}};
 async function exportImages(saved){
  if(!saved.layouts.length)return;
  const configs=inventoryLinks(getConfigs(),shop.id).filter(g=>saved.productIds.includes(g.id)).flatMap(g=>g.configs);
  const entries=sourceImageEntries(configs).filter(e=>saved.layouts.includes(e.config.layout)),files=[],failures=[];
  for(const [i,entry] of entries.entries()){message(`修改已保存，正在生成 ${i+1}/${entries.length}：${entry.config.name}`);try{const result=await renderPoster(entry.config,1400);if(result.overflow)throw Error('内容超出画布，请调整版式');const blob=await new Promise(resolve=>result.canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('图片生成失败');files.push({name:entry.name,bytes:new Uint8Array(await blob.arrayBuffer())});}catch(e){failures.push({name:entry.name,error:e.message});}}
  if(!files.length)throw Error('没有成功生成图片：'+failures.map(f=>f.error).join('；'));
  const summary={createdAt:new Date().toISOString(),expected:entries.length,success:files.map(f=>f.name),failures};files.push({name:'导出结果.json',bytes:new TextEncoder().encode(JSON.stringify(summary,null,2))});download(makeZip(files),`库存替换配置图_${Date.now()}.zip`);message(`修改已保存，导出 ${summary.success.length}/${entries.length} 张图片${failures.length?'；失败项见 ZIP 内导出结果.json，可重试。':'。'}`);
 }
 $('#stock-apply').onclick=async()=>{if(busy||!plan)return;const approved=plan;try{validateStockReplacement(approved,getConfigs(),getCosts(),getCatalog());lock(true);retry={productIds:approved.productIds,layouts:layouts()};await api.apply(approved);plan=null;await exportImages(retry);if(!retry.layouts.length)message(`已保存 ${approved.changes.length} 套配置的配件与绑定加购修改。`);report=checkInventory(getConfigs(),getCosts(),shop.id,threshold);drawReport();$('#stock-retry').hidden=false;}catch(e){message('操作未完成：'+e.message);if(retry)$('#stock-retry').hidden=false;}finally{lock(false);invalidate();}};
 $('#stock-retry').onclick=async()=>{if(busy||!retry)return;try{lock(true);await save();await exportImages(retry);if(!retry.layouts.length)message('修改已保存。');}catch(e){message(e.message);}finally{lock(false);}};
 scan();
}
