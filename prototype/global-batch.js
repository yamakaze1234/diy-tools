import {mountProductSearch} from './product-search.js';
import {clone,productGroups} from './core.js';
import {replaceSourcePart} from './source.js';
import {actualParts,syncActualParts} from './actual-parts.js';
import {renderPoster} from './poster.js';
import {makeZip} from './zip.js';
import {saveImageFolder} from './folder-export.js';

const key=p=>String(p.goodsId||'').trim()&&String(p.goodsId)!=='0'?`id:${p.goodsId}`:`name:${p.name}`;
export function partUsageSummary(configs,query='',slot=''){
 const tokens=query.trim().toLowerCase().split(/\s+/).filter(Boolean),groups=new Map();
 for(const c of configs.filter(c=>!c.deletedAt))for(const p of c.parts||[]){
  if(!p.name||slot&&p.slot!==slot)continue;
  const haystack=[p.name,p.goodsId,p.slot,c.product,c.spu,c.name].join(' ').toLowerCase();
  if(!tokens.every(token=>haystack.includes(token)))continue;
  const id=key(p);if(!groups.has(id))groups.set(id,{key:id,name:p.name,goodsId:p.goodsId,slots:new Set(),configs:new Set(),products:new Set(),occurrences:[]});
  const item=groups.get(id);item.slots.add(p.slot);item.configs.add(c.id);item.products.add(c.productId);item.occurrences.push({configId:c.id,slot:p.slot});
 }
 return [...groups.values()].map(item=>({key:item.key,name:item.name,goodsId:item.goodsId,slots:[...item.slots],count:item.configs.size,linkCount:item.products.size,occurrences:item.occurrences})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-CN'));
}
const matchesUpgrade=(part,query)=>String(part.upgrade||'').toLowerCase().includes(query.trim().toLowerCase());
export function findPartUsage(configs,query,descriptionQuery=''){
 const q=query.trim().toLowerCase(),found=new Map();if(!q&&!descriptionQuery.trim())return [];
 for(const c of configs.filter(c=>!c.deletedAt))for(const p of c.parts){if(!p.name||![p.name,p.goodsId].some(v=>String(v||'').toLowerCase().includes(q))||!matchesUpgrade(p,descriptionQuery))continue;const k=key(p);if(!found.has(k))found.set(k,{key:k,goodsId:p.goodsId,name:p.name,ids:new Set()});found.get(k).ids.add(c.id);}
 return [...found.values()].map(r=>({...r,count:r.ids.size,ids:undefined}));
}
const inUsageScope=(config,part,occurrences)=>!occurrences||occurrences.some(item=>item.configId===config.id&&item.slot===part.slot);
export function usageGroups(configs,partKey,descriptionQuery='',occurrences=null){return productGroups(configs.filter(c=>!c.deletedAt)).map(g=>({...g,matches:g.configs.filter(c=>c.parts.some(p=>key(p)===partKey&&matchesUpgrade(p,descriptionQuery)&&inUsageScope(c,p,occurrences)))})).filter(g=>g.matches.length);}
export function replacementPlan(configs,partKey,productIds,replacement,qty,occurrences=null){
 if(!replacement||replacement.deletedAt)throw Error('请选择新的配件');if(qty!==null&&(!Number.isInteger(qty)||qty<1))throw Error('数量必须是正整数，留空则保留原数量');
 const groups=usageGroups(configs,partKey,'',occurrences).filter(g=>productIds.includes(g.id)),changes=[];
 for(const g of groups)for(const c of g.matches){const after=clone(c);for(let i=0;i<after.parts.length;i++)if(key(after.parts[i])===partKey&&inUsageScope(c,after.parts[i],occurrences)){replaceSourcePart(after,i,replacement);if(qty!==null)after.parts[i].qty=qty;}syncActualParts(after,c.parts);if(JSON.stringify(c)!==JSON.stringify(after))changes.push({id:c.id,productId:g.id,name:c.name,product:g.name,before:clone(c),after});}
 return {changes,productIds:groups.map(g=>g.id),replacement:clone(replacement),partKey};
}
export function validateReplacement(plan,configs){
 const byId=new Map(configs.map(c=>[c.id,c]));
 return plan.changes.map(change=>{const c=byId.get(change.id);if(!c||JSON.stringify(c)!==JSON.stringify(change.before))throw Error('配置已变化，请重新预览');return c;});
}
export function applyReplacement(plan,configs){
 const targets=validateReplacement(plan,configs);
 targets.forEach((c,i)=>Object.assign(c,clone(plan.changes[i].after)));return targets.map(c=>c.id);
}
export function upgradeDescriptionPlan(configs,partKey,productIds,description,descriptionQuery=''){
 if(!partKey)throw Error('请选择原配件');
 const groups=usageGroups(configs,partKey,descriptionQuery).filter(g=>productIds.includes(g.id)),changes=[];
 for(const g of groups)for(const c of g.matches){
  const after=clone(c);
  for(const part of after.parts)if(key(part)===partKey&&matchesUpgrade(part,descriptionQuery))part.upgrade=description;
  if(JSON.stringify(c)!==JSON.stringify(after))changes.push({id:c.id,productId:g.id,name:c.name,product:g.name,before:clone(c),after});
 }
 return {changes,partKey,productIds:groups.map(g=>g.id),description};
}
export function openUpgradeDescriptionBatch(api){
 const {openDialog,apply,esc}=api;
 const getConfigs=()=>api.getConfigs().filter(c=>!c.deletedAt&&(!api.productId||($('#upgrade-batch-scope').value==='selected'?(api.getSelectedIds?.()||[]).includes(c.id):c.productId===api.productId)));
 const descriptionQuery=()=>$('#upgrade-batch-description-query').value;
 openDialog(api.productId?'批量修改加购描述':'批量修改全店加购说明',`${api.productId?'<label class="field">修改范围<select id="upgrade-batch-scope"><option value="link">当前链接全部配置</option><option value="selected">勾选配置（本店，可跨链接）</option></select></label>':''}<p class="hint">按配件或加购描述查找，只修改范围内符合搜索条件的逐项升级说明。手动添加的“加购与选配”、实际配置和输出源均保留。</p><label class="field">查找原配件<input id="upgrade-batch-query" placeholder="输入配件名称或 ERP ID"></label><label class="field">只搜索加购描述<input id="upgrade-batch-description-query" placeholder="输入逐项升级说明关键词，可单独搜索"></label><div id="upgrade-batch-candidates" class="global-list"></div><div id="upgrade-batch-work" class="hidden"><div id="upgrade-batch-links" class="global-list"></div><label class="field">新的配件加购描述<textarea id="upgrade-batch-text" rows="3" placeholder="留空可清除所选配件的说明"></textarea></label><div class="actions"><button id="upgrade-batch-preview">预览修改</button><button id="upgrade-batch-apply" class="primary" disabled>应用修改</button></div><pre id="upgrade-batch-diff"></pre></div><p id="upgrade-batch-status" role="status"></p>`);
 const $=s=>document.querySelector(s);let partKey='',plan=null,busy=false;
 const invalidate=()=>{plan=null;$('#upgrade-batch-apply').disabled=true;$('#upgrade-batch-diff').textContent='';};
 $('#upgrade-batch-query').oninput=()=>{invalidate();$('#upgrade-batch-work').classList.add('hidden');const rows=findPartUsage(getConfigs(),$('#upgrade-batch-query').value,descriptionQuery());$('#upgrade-batch-candidates').innerHTML=rows.slice(0,80).map((r,i)=>`<button data-upgrade-part="${i}"><strong>${esc(r.name)}</strong><small>ERP ID ${esc(r.goodsId||'无')} · ${r.count} 套配置</small></button>`).join('');$('#upgrade-batch-status').textContent=rows.length?'选择要修改描述的原配件':'没有匹配配件';document.querySelectorAll('[data-upgrade-part]').forEach(button=>button.onclick=()=>{const row=rows[Number(button.dataset.upgradePart)];partKey=row.key;const groups=usageGroups(getConfigs(),partKey,descriptionQuery());$('#upgrade-batch-candidates').innerHTML=`<p class="hint">原配件：${esc(row.name)} · ${esc(row.goodsId||'无 ERP ID')}</p>`;$('#upgrade-batch-links').innerHTML=groups.map(g=>`<label><input type="checkbox" data-upgrade-link value="${esc(g.id)}" checked><span><strong>${esc(g.name)}</strong><small>${g.matches.length} 套命中：${esc(g.matches.map(c=>c.name).join('、'))}</small></span></label>`).join('');$('#upgrade-batch-work').classList.remove('hidden');$('#upgrade-batch-status').textContent=`已找到 ${groups.length} 个链接`;document.querySelectorAll('[data-upgrade-link]').forEach(input=>input.onchange=invalidate);});};
 $('#upgrade-batch-description-query').oninput=$('#upgrade-batch-query').oninput;
 if(api.productId)$('#upgrade-batch-scope').onchange=$('#upgrade-batch-query').oninput;
 $('#upgrade-batch-text').oninput=invalidate;
 $('#upgrade-batch-preview').onclick=()=>{try{plan=upgradeDescriptionPlan(getConfigs(),partKey,[...document.querySelectorAll('[data-upgrade-link]:checked')].map(input=>input.value),$('#upgrade-batch-text').value,descriptionQuery());$('#upgrade-batch-diff').textContent=plan.changes.map(change=>{const lines=change.before.parts.filter(part=>key(part)===partKey&&matchesUpgrade(part,descriptionQuery())).map(part=>`${part.slot}：${part.upgrade||'（空）'} → ${plan.description||'（空）'}`);return `${change.product} / ${change.name}\n${lines.join('\n')}`;}).join('\n\n');$('#upgrade-batch-apply').disabled=!plan.changes.length;$('#upgrade-batch-status').textContent=`将修改 ${plan.changes.length} 套配置`; }catch(e){invalidate();$('#upgrade-batch-status').textContent=e.message;}};
 $('#upgrade-batch-apply').onclick=async()=>{if(!plan||busy)return;const approved=plan;try{busy=true;$('#upgrade-batch-apply').disabled=true;validateReplacement(approved,getConfigs());await apply(approved);$('#upgrade-batch-status').textContent=`已保存 ${approved.changes.length} 套配置`;plan=null;}catch(e){$('#upgrade-batch-status').textContent=e.message;}finally{busy=false;}};
}
export function replacementDiff(plan){
 return plan.changes.map(change=>{
  const rows=[];
  for(const before of change.before.parts.filter(part=>key(part)===plan.partKey)){
   const after=change.after.parts.find(part=>part.slot===before.slot);
   if(JSON.stringify(before)===JSON.stringify(after))continue;
   rows.push(`展示配件 · ${before.slot}：${before.name} ×${before.qty} → ${after.name} ×${after.qty}`);
   const actualBefore=actualParts(change.before).find(part=>part.slot===before.slot);
   const actualAfter=actualParts(change.after).find(part=>part.slot===before.slot);
   if(JSON.stringify(actualBefore)!==JSON.stringify(actualAfter))rows.push(`实际配置 · ${before.slot}：${actualBefore?.name||'空'} ×${actualBefore?.qty||0} → ${actualAfter?.name||'空'} ×${actualAfter?.qty||0}`);
  }
  if(JSON.stringify(change.before.addons)!==JSON.stringify(change.after.addons))rows.push('关联加购：'+((change.before.addons||[]).map(a=>a.text).join('；')||'无')+' → '+((change.after.addons||[]).map(a=>a.text).join('；')||'无'));
  return `${change.product} / ${change.name}\n${rows.join('\n')}`;
 }).join('\n\n');
}
const safe=s=>String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,90)||'未命名';
export function exportEntries(configs,productIds){
 const groups=productGroups(configs.filter(c=>!c.deletedAt)).filter(g=>productIds.includes(g.id)),entries=[],folders=new Set(),paths=new Set();
 for(const g of groups){if(g.configs.some(c=>!/^\d+$/.test(c.spu||'')))throw Error(`“${g.name}”缺少有效 SPU，请先补齐，或取消自动导出`);let folder=safe(`${g.configs[0].spu}_${g.name}`),base=folder,n=1;while(folders.has(folder))folder=`${base}_${++n}`;folders.add(folder);
  g.configs.forEach((c,i)=>{const number=/^配置\s*([\d一二三四五六七八九十百]+)$/.exec(c.name||'');const label=number?`配置${number[1]}`:`配置${i+1}`;for(const [layout,dir] of [['long','配置清单图'],['square','SKU图']]){const name=`${folder}/${dir}/${safe(c.spu+'_'+label)}.png`;if(paths.has(name))throw Error(`“${g.name}”存在重复配置编号，请先修改配置名称`);paths.add(name);entries.push({name,config:{...clone(c),layout}});}});
 }return entries;
}

export function openGlobalBatch(api){
 const {openDialog,esc,toast,getConfigs,getCatalog,apply,save,download}=api;
 const slots=[...new Set(getConfigs().flatMap(c=>(c.parts||[]).map(p=>p.slot)).filter(Boolean))];
 openDialog('批量修改配件与导图',`<div class="global-entry-bar"><p class="hint">按配件汇总当前店铺。选择配件后，勾选要修改的链接并预览。</p><button id="global-addons">只修改加购描述</button></div><div class="global-search-bar"><input id="global-query" type="search" placeholder="搜索配件名称、ERP ID、链接或 SPU" aria-label="查找原配件"><select id="global-slot" aria-label="按配件部位筛选"><option value="">全部配件部位</option>${slots.map(slot=>`<option>${esc(slot)}</option>`).join('')}</select></div><div id="global-candidates" class="global-usage-list"></div><div id="global-work" class="hidden"><div class="global-entry-bar"><strong id="global-original"></strong><button id="global-back">返回配件汇总</button></div><details id="global-link-details" open><summary>选择影响的链接 <span id="global-summary"></span></summary><label class="global-all"><input id="global-all" type="checkbox" checked> 全选关联链接</label><div id="global-links" class="global-list"></div></details><div id="global-product-search"></div><label class="field">统一数量（留空保留原数量）<input id="global-qty" type="number" min="1" step="1" placeholder="保留原数量"></label><label class="global-export"><input id="global-export" type="checkbox"> 保存后导出所选链接的配置清单图和 SKU 图</label><p class="hint">展示配件与实际配置的对应槽位同步替换。图片按链接及类型分文件夹；桌面版保存到文件夹，网页版下载 ZIP。</p><div class="actions"><button id="global-preview">预览修改</button><button id="global-apply" class="primary" disabled>应用修改</button></div><details id="global-diff-details"><summary>查看修改明细</summary><div id="global-diff" class="hint"></div></details></div><p id="global-status" role="status" class="hint"></p><button id="global-retry" class="hidden">导出刚修改的链接图片</button>`);
 const $=selector=>document.querySelector(selector),root=$('#global-status'),dialog=root.closest('dialog');dialog.classList.add('global-batch-dialog');
 let partKey='',groups=[],plan=null,busy=false,exportIds=null,occurrences=null;
 const controller=new AbortController();dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();},{signal:controller.signal});dialog.addEventListener('close',()=>{controller.abort();dialog.classList.remove('global-batch-dialog');},{once:true,signal:controller.signal});
 const status=message=>{if(root.isConnected)root.textContent=message;};
 const invalidate=()=>{plan=null;$('#global-apply').disabled=true;$('#global-diff').textContent='';};
 const picked=()=>[...dialog.querySelectorAll('[data-global-link]:checked')].map(el=>el.value);
 const updateSummary=()=>{const chosen=groups.filter(group=>picked().includes(group.id));$('#global-summary').textContent=`${chosen.length} 个链接 · ${chosen.reduce((n,g)=>n+g.matches.length,0)} 套命中配置`;$('#global-all').checked=chosen.length===groups.length;$('#global-all').indeterminate=chosen.length>0&&chosen.length<groups.length;invalidate();};
 const selectPart=row=>{
  partKey=row.key;occurrences=row.occurrences;groups=usageGroups(getConfigs(),partKey,'',occurrences);$('#global-candidates').classList.add('hidden');$('#global-work').classList.remove('hidden');$('#global-original').textContent=row.name;
  $('#global-links').innerHTML=groups.map(g=>`<label><input type="checkbox" data-global-link value="${esc(g.id)}" checked><span><strong>${esc(g.name)}</strong><small>SPU ${esc(g.spu||'未填写')} · ${g.matches.length}/${g.configs.length} 套命中</small><details><summary>查看配置</summary>${g.matches.map(c=>`<small>${esc(c.shortName||c.name)}</small>`).join('')}</details></span></label>`).join('');
  dialog.querySelectorAll('[data-global-link]').forEach(el=>el.onchange=updateSummary);updateSummary();status('选择替换配件，核对预览后应用；保存成功后可继续操作。');
 };
 const listParts=()=>{
  if(busy)return;invalidate();$('#global-work').classList.add('hidden');$('#global-candidates').classList.remove('hidden');
  const rows=partUsageSummary(getConfigs(),$('#global-query').value,$('#global-slot').value);
  $('#global-candidates').innerHTML=`<div class="global-usage-head"><span>配件 / ERP ID</span><span>部位</span><span>链接</span><span>配置</span></div>`+rows.slice(0,100).map((row,i)=>`<button type="button" class="global-usage-row" data-global-part="${i}"><span><strong>${esc(row.name)}</strong><small>ERP ID ${esc(row.goodsId||'未绑定')}</small></span><span>${esc(row.slots.join('、'))}</span><span>${row.linkCount}</span><span>${row.count}</span></button>`).join('');
  dialog.querySelectorAll('[data-global-part]').forEach(button=>button.onclick=()=>selectPart(rows[Number(button.dataset.globalPart)]));status(rows.length?`共 ${rows.length} 种配件${rows.length>100?'，显示前 100 项，请搜索缩小范围':''}，点击一行选择影响的链接。`:'没有匹配配件');
 };
 $('#global-query').oninput=listParts;$('#global-slot').onchange=listParts;$('#global-back').onclick=listParts;
 $('#global-addons').onclick=()=>{dialog.classList.remove('global-batch-dialog');api.openUpgrades();};
 $('#global-all').onchange=event=>{dialog.querySelectorAll('[data-global-link]').forEach(el=>el.checked=event.target.checked);updateSummary();};
 const replacementPicker=mountProductSearch($('#global-product-search'),{getRows:getCatalog,idKey:'sourceId',label:'查找新配件',inputId:'global-new-query',describe:row=>'ERP ID '+row.goodsId+' · 核算 '+(row.tax??'待补'),onChange:invalidate});
 for(const id of ['global-qty','global-export'])$('#'+id).onchange=invalidate;
 $('#global-preview').onclick=()=>{try{
  if(!picked().length)throw Error('请至少选择一个链接');
  plan=replacementPlan(getConfigs(),partKey,picked(),replacementPicker.row(),$('#global-qty').value===''?null:Number($('#global-qty').value),occurrences);
  if($('#global-export').checked)exportEntries(getConfigs(),plan.productIds);
  $('#global-diff').textContent=replacementDiff(plan);$('#global-diff-details').open=true;$('#global-apply').disabled=!plan.changes.length;status(`将修改 ${plan.changes.length} 套配置${$('#global-export').checked?`，导出 ${exportEntries(getConfigs(),plan.productIds).length} 张图片`:''}。请核对明细后应用。`);
 }catch(error){invalidate();status(error.message);}};
 const exportImages=async()=>{
  await save();const entries=exportEntries(getConfigs(),exportIds),files=[],failures=[];
  for(const [i,entry] of entries.entries()){
   status(`配置已保存，正在导出 ${i+1}/${entries.length}：${entry.name}`);
   try{const result=await (api.renderImage||renderPoster)(entry.config,1400);if(result.overflow)throw Error('图片内容超出，请调整模块或字号');const blob=await new Promise(resolve=>result.canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('图片生成失败');files.push({name:entry.name,bytes:new Uint8Array(await blob.arrayBuffer())});}catch(error){failures.push({name:entry.name,error:error.message});}
  }
  if(!files.length)throw Error('全部图片生成失败：'+failures.map(f=>f.error).join('；'));
  const count=files.length;files.push({name:'导出清单.json',bytes:new TextEncoder().encode(JSON.stringify({createdAt:new Date().toISOString(),success:files.map(f=>f.name),failures},null,2))});
  const name=`批量修改配置图_${Date.now()}`,folder=await (api.saveFolder||saveImageFolder)(files,name);
  if(folder?.cancelled){status('修改已保存，已取消图片导出。可点击下方按钮重新导出。');return;}
  if(!folder)download(makeZip(files),name+'.zip');
  status(`已保存修改并导出 ${count} 张图片，失败 ${failures.length} 张。${folder?'文件夹：'+folder.directory:'已下载 ZIP。'}${failures.length?'失败详情见导出清单。':''}`);
 };
 let lockedControls=[];
 const lock=value=>{busy=value;if(value){lockedControls=[...dialog.querySelectorAll('input,select,button')].map(el=>({el,disabled:el.disabled}));lockedControls.forEach(({el})=>el.disabled=true);}else{lockedControls.forEach(({el,disabled})=>{if(el.isConnected)el.disabled=disabled;});lockedControls=[];}};
 $('#global-apply').onclick=async()=>{
  if(busy||!plan)return;const approved=plan,auto=$('#global-export').checked;let saved=false;
  try{
   if(JSON.stringify(replacementPicker.row())!==JSON.stringify(approved.replacement))throw Error('新配件资料已变化，请重新预览');
   if(auto)exportEntries(getConfigs(),approved.productIds);validateReplacement(approved,getConfigs());lock(true);status(`正在保存 ${approved.changes.length} 套配置…`);
   await apply(approved);saved=true;exportIds=approved.productIds;plan=null;$('#global-retry').classList.remove('hidden');
   if(auto)await exportImages();else status(`已统一修改并保存 ${approved.changes.length} 套配置。可以继续修改，或导出刚修改的链接图片。`);
  }catch(error){status((saved?'修改已保存，导出未完成：':'修改未完成：')+error.message);toast(error.message);}
  finally{lock(false);if(root.isConnected){plan=null;$('#global-apply').disabled=true;}}
 };
 $('#global-retry').onclick=async()=>{if(busy||!exportIds)return;try{lock(true);await exportImages();}catch(error){status('修改已保存，导出未完成：'+error.message);}finally{lock(false);if(root.isConnected)invalidate();}};
 listParts();
}
