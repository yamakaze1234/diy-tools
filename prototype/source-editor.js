import {componentStockHtml} from './component-stock-view.js';
import {sourceExportRows,sourceExportWorkbook} from './source-export.js';
import {shopById} from './shops.js';
import {isSpecialComponent,normalizeSpecialComponent} from './special-components.js';
import {mountSourceSync} from './source-sync-ui.js';
import {mountShopAddons} from './shop-addon-ui.js';
import {excludedComponent} from './component-policy.js';
import {clone} from './core.js';
import {sourceAddon,sourceAddonFields,validateAddon,addonCheck,sourceAddonOptions,addonChecks} from './addon-data.js';
import {addonStatusHtml} from './addon-ui.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const labels={name:'显示名称',tax:'含税核算单价',addon:'加购文案'};

export function openSourceEditor(liveApi){
 const pending=new Map();
 const overlay=rows=>{const result=rows.map(r=>pending.has(r.sourceId)?clone(pending.get(r.sourceId).row):r);for(const {row} of pending.values())if(!result.some(r=>r.sourceId===row.sourceId)&&row.shopId===liveApi.shopId())result.push(clone(row));return result;};
 const api={...liveApi,getRows:()=>overlay(liveApi.getRows()).filter(r=>r.shopId===liveApi.shopId()),getAllRows:()=>overlay(liveApi.getAllRows())};
 let selectionBaseline=new Map();

 let selectedId=null,page=0,draft=null,preview=null,busy=false,showDeleted=false,specialOnly=false,addonFields,sourceSync;
 api.openDialog('本店输出源维护',`<div class="source-batch-bar"><strong id="source-pending">暂无待保存修改</strong><button id="source-save-all" class="primary">保存全部更改</button><button id="source-discard-all">放弃全部更改</button><p class="hint">切换商品会保留修改；全部编辑完成后统一保存到本机。</p></div><section id="source-sync-top" class="source-sync-top"></section><p class="hint">显示名称属于当前店铺；加购集中展示三店，勾选要修改的店铺；含税核算单价按 ERP ID 与三店共用。核算价格为单件价，加购文案不计入整机成本。</p><div class="source-toolbar"><input id="source-search" type="search" placeholder="搜索显示名称、ERP ID 或加购文案" aria-label="搜索输出源"><button id="source-export" title="导出本店全部在用输出源，不受搜索或分页限制，包含当前未保存内容">导出本店表格</button><button id="source-addon-check">一键检查加购差价</button><button id="source-deleted">已删除</button><button id="source-special-list">特殊配件</button><button id="source-new">＋ 新增配件</button></div><div id="source-addon-report"></div><div class="source-workspace"><div class="source-list-panel"><div id="source-count" class="hint"></div><div id="source-list"></div><div class="source-pagination"><button id="source-prev">上一页</button><span id="source-page"></span><button id="source-next">下一页</button></div></div><div id="source-detail"><p class="hint">从左侧选择需要维护的配件。</p></div></div><div id="source-message" role="status" class="hint"></div>`);
 $('#dialog').classList.add('source-dialog');
 const message=text=>$('#source-message').textContent=text;
 sourceSync=mountSourceSync($('#source-sync-top'),{getRows:api.getRows,getConfigs:api.getConfigs,shopId:api.shopId,isEdited:()=>pending.size>0||!!draft&&isEdited(),flush:api.flush,apply:api.applySync,saveImage:api.saveImage,download:api.download,message});
 const filtered=()=>{const q=$('#source-search').value.trim().toLowerCase();return api.getRows().filter(r=>!!r.deletedAt===showDeleted&&(!specialOnly||isSpecialComponent(r))&&[r.name,r.goodsId,r.addonText].join(' ').toLowerCase().includes(q));};
 function list(){const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/24));page=Math.min(page,pages-1);$('#source-count').textContent=`共 ${api.getRows().filter(r=>!r.deletedAt).length} 条在用，匹配 ${rows.length} 条`;$('#source-list').innerHTML=rows.slice(page*24,page*24+24).map(r=>`<button class="source-item ${r.sourceId===selectedId?'active':''}" data-source-id="${esc(r.sourceId)}"><strong>${esc(r.name)}${pending.has(r.sourceId)?' · 待保存':''}</strong><small>${isSpecialComponent(r)?'特殊配件 · 无 goodsId':'ID '+esc(r.goodsId)} · 核算 ${r.tax==null?'待填':'¥'+Number(r.tax).toFixed(2)}</small>${componentStockHtml(r,api.getCosts())}</button>`).join('')||'<p class="hint">没有匹配项。</p>';$('#source-page').textContent=`${page+1} / ${pages}`;$('#source-prev').disabled=page===0;$('#source-next').disabled=page===pages-1;$$('[data-source-id]').forEach(b=>b.onclick=()=>{if(busy)return;if(!stageCurrent())return;select(api.getRows().find(r=>r.sourceId===b.dataset.sourceId));});}
 function isEdited(){try{return draft&&!draft.deletedAt&&(addonFields.isDirty()||JSON.stringify(read(false))!==JSON.stringify(draft));}catch{return true;}}
 function updatePending(){const n=pending.size+(draft&&isEdited()&&!pending.has(draft.sourceId)?1:0);$('#source-pending').textContent=n?`待保存 ${n} 条输出源（含勾选店铺）`:'暂无待保存修改';}
 function invalidate(){preview=null;sourceSync?.invalidate();if(draft&&addonFields)updatePending();}
 function stageCurrent(){
  if(!draft||!isEdited())return true;
  try{
   const row={...read(),shopId:api.shopId()},related=addonFields.changes();
   const put=value=>{const existing=pending.get(value.sourceId),before=existing?existing.before:selectionBaseline.get(value.sourceId)||null;pending.set(value.sourceId,{before:clone(before),row:clone(value)});};
   put(row);
   for(const change of related){if(change.sourceId===row.sourceId)continue;const original=api.getAllRows().find(r=>r.sourceId===change.sourceId);put({...original,...sourceAddonFields(change.addon)});}
   updatePending();return true;
  }catch(e){message(e.message+'；请修正当前商品后再切换或保存。');return false;}
 }
 async function saveAll(){
  if(busy)throw Error('正在保存，请完成后再关闭。');
  if(!stageCurrent())throw Error('当前商品尚未通过校验');
  if(!pending.size){message('没有待保存修改。');return;}
  busy=true;$('#source-save-all').disabled=true;const detail=$('#source-detail');detail.inert=true;
  try{
   const result=await liveApi.applyBatch([...pending.values()].map(clone));
   pending.clear();if(!$('#source-detail'))return;
   const selected=api.getRows().find(r=>r.sourceId===draft?.sourceId);if(selected)select(selected);else list();
   updatePending();message(`已一次保存 ${result.count} 条输出源及加购修改${result.configIds.length?'，并更新 '+result.configIds.length+' 套配置的共用核算价':''}。配置中的名称和加购文案可在上方预览差异后更新。`);
  }catch(e){if($('#source-message'))message('保存失败，修改仍保留：'+e.message);throw e;}
  finally{busy=false;detail.inert=false;if($('#source-save-all'))$('#source-save-all').disabled=false;}
 }

 function read(validate=true){const addon=addonFields.read(false);let row={...clone(draft),...sourceAddonFields(addon),specialComponent:$('#source-special').checked,goodsId:$('#source-id').value.trim(),name:$('#source-name').value.trim(),tax:$('#source-tax').value===''?null:Number($('#source-tax').value)};row=normalizeSpecialComponent(row);if(validate){if(!isSpecialComponent(row)&&addon.text.trim())validateAddon(addon,{required:true,costs:api.getCosts()});if(!isSpecialComponent(row)&&!/^\d+$/.test(row.goodsId))throw Error('请填写准确的数字 ERP ID');if(!row.name)throw Error('请填写产品显示名称');if(excludedComponent(row)||api.getCosts().some(r=>r.goodsId===row.goodsId&&excludedComponent(r)))throw Error('带 * 或 *! 标记的配件不可加入输出源');if(row.tax!==null&&(!Number.isFinite(row.tax)||row.tax<0||!/^\d+(\.\d{1,2})?$/.test($('#source-tax').value)))throw Error('核算单价须为非负金额，最多两位小数');if(!isSpecialComponent(row)&&!selectedId&&api.getRows().some(r=>r.goodsId===row.goodsId&&r.sourceId!==row.sourceId))throw Error('该 ERP ID 已存在，请搜索后编辑对应记录');}return row;}
 function select(row){addonFields=null;selectionBaseline=new Map([...liveApi.getAllRows(),...liveApi.getRows()].map(r=>[r.sourceId,clone(r)]));selectedId=api.getRows().some(r=>r.sourceId===row.sourceId)?row.sourceId:null;draft=normalizeSpecialComponent({...clone(row),goodsId:row.goodsId||'',name:row.name||'',tax:row.tax??null,upgrade:row.upgrade||'',specialComponent:isSpecialComponent(row),...sourceAddonFields(sourceAddon(row))});invalidate();if(row.deletedAt){$('#source-detail').innerHTML=`<h3>${esc(row.name)}</h3><p class="hint">此输出源已删除。已有配置和成本源保留，恢复后可重新选用。</p><button id="source-restore" class="primary">恢复输出源</button>`;$('#source-restore').onclick=()=>toggleDeleted(row,false);list();return;}const references=api.getConfigs().filter(c=>!c.deletedAt&&c.parts.some(p=>p.sourceId===row.sourceId)).length;
 $('#source-detail').innerHTML=`<div class="source-detail-heading"><h3>${selectedId?'编辑配件资料':'新增输出源配件'}</h3><span>${references} 套本店配置引用</span></div><label class="field"><span><input id="source-special" type="checkbox" ${isSpecialComponent(row)?'checked':''} ${selectedId?'disabled':''}>特殊配件（无 goodsId，成本及维护表导出为 0）</span></label><div class="inline-grid"><label class="field">ERP ID<input id="source-id" value="${esc(row.goodsId)}" ${selectedId||isSpecialComponent(row)?'readonly':''} inputmode="numeric"></label><label class="field">ERP 单价（只读缓存）<input readonly value="${row.erp==null?'暂无':Number(row.erp).toFixed(2)}"></label></div><div id="source-stock">${componentStockHtml(row,api.getCosts())}</div><label class="field">本店产品显示名称<textarea id="source-name" rows="2">${esc(row.name)}</textarea></label><label class="field">三店共用含税核算单价<input id="source-tax" ${isSpecialComponent(row)?'readonly':''} type="number" min="0" step=".01" value="${row.tax??''}" placeholder="留空表示待核算"></label><section class="source-addon-editor" ${isSpecialComponent(row)?'hidden':''}><h4>三店加购</h4><div id="source-addon-fields"></div></section><small class="hint">更新时间：${row.updatedAt?new Date(row.updatedAt).toLocaleString():'尚未人工维护'}</small><div class="source-save-actions"><button id="source-reset">重置修改</button><button id="source-save" class="primary">保存全部更改</button></div><div class="source-bottom-actions"><button id="source-delete" class="danger" ${selectedId?'':'disabled'}>删除输出源</button></div>`;
 addonFields=isSpecialComponent(row)?{read:()=>sourceAddon(draft),isDirty:()=>false,changes:()=>[],refresh:()=>{}}:mountShopAddons($('#source-addon-fields'),{original:{...draft,shopId:draft.shopId||api.shopId()},getRows:api.getAllRows,getCosts:api.getCosts,getOriginal:()=>({...draft,goodsId:$('#source-id').value.trim(),tax:$('#source-tax').value===''?null:Number($('#source-tax').value)}),onChange:invalidate});
 $('#source-special').onchange=()=>{const value=read(false);if(!isSpecialComponent(value)){value.erp=null;value.tax=null;}select(value);};
 $('#source-delete').onclick=()=>{if(confirm(`删除“${row.name}”？已有配置和成本源保留，可以从“已删除”中恢复。`))return toggleDeleted(row,true);};
 $('#source-save').onclick=()=>saveAll().catch(()=>{});
 $('#source-reset').onclick=()=>{select(selectedId?api.getRows().find(r=>r.sourceId===selectedId):{sourceId:crypto.randomUUID(),goodsId:'',name:'',specialComponent:specialOnly,erp:specialOnly?0:null,tax:specialOnly?0:null,warranty:specialOnly?'':'质保',upgrade:'',addonText:'',addonNote:''});message('已重置未保存的修改');};
 $$('#source-detail input[id^="source-"],#source-detail textarea[id^="source-"],#source-detail select[id^="source-"]').forEach(el=>el.oninput=()=>{invalidate();addonFields.refresh();$('#source-stock').innerHTML=componentStockHtml({...draft,goodsId:$('#source-id').value.trim()},api.getCosts());});
 list();updatePending();}
 async function toggleDeleted(row,deleted){if(busy)return;if(pending.size||isEdited()){message('请先保存全部更改或放弃全部更改，再删除或恢复输出源。');return;}busy=true;try{await api.setDeleted(row.sourceId,deleted);if(!$('#source-detail'))return;draft=null;selectedId=null;showDeleted=false;$('#source-deleted').textContent='已删除';const first=filtered()[0];if(first)select(first);else{$('#source-detail').innerHTML='<p class="hint">暂无输出源，可新增或从“已删除”恢复。</p>';list();}message(deleted?'输出源已删除，已有配置保留。':'输出源已恢复。');}catch(e){if($('#source-message'))message(e.message);}finally{busy=false;}}
 $('#source-export').onclick=()=>{
  if(busy)return;const button=$('#source-export');button.disabled=true;
  try{
   const rows=api.getRows().map(clone);
   // Read the visible editor as a draft without saving or validating unrelated cost/addon fields.
   if(draft&&!showDeleted){const row={...clone(draft),...sourceAddonFields(addonFields.read(false)),shopId:api.shopId(),goodsId:$('#source-id')?.value.trim()??draft.goodsId,name:$('#source-name')?.value??draft.name,specialComponent:$('#source-special')?.checked??draft.specialComponent};const index=rows.findIndex(r=>r.sourceId===row.sourceId);if(index>=0)rows[index]=row;else if(row.name?.trim()||row.goodsId?.trim())rows.push(row);}
   const values=sourceExportRows(rows,api.getCosts(),api.shopId());if(!values.length)throw Error('本店没有可导出的在用输出源');
   const now=new Date(),stamp=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('')+'_'+[now.getHours(),now.getMinutes(),now.getSeconds()].map(v=>String(v).padStart(2,'0')).join('');
   api.download(sourceExportWorkbook(values),`${shopById(api.shopId()).name}_输出源_${stamp}.xlsx`);
   message(`已导出本店全部 ${values.length} 条在用输出源，列顺序：goodsid（ERP ID）、ERP名称、展示名称、升级项（本店加购描述）。${pending.size||draft&&isEdited()?'包含当前未保存内容，导出不会自动保存更改。':''}`);
  }catch(e){message('导出失败：'+e.message);}finally{button.disabled=false;}
 };
 $('#source-addon-check').onclick=()=>{if(busy||!stageCurrent())return;const rows=api.getRows().filter(r=>!r.deletedAt),checks=rows.flatMap(row=>sourceAddonOptions(row).flatMap(addonChecks).filter(a=>a.text?.trim()).map(addon=>({row,addon,result:addonCheck(addon,api.getCosts(),[row])}))),counts=checks.reduce((a,x)=>(a[x.result.severity]=(a[x.result.severity]||0)+1,a),{});$('#source-addon-report').innerHTML=`<p class="hint">共 ${checks.length} 项加购：需要调整 ${counts.danger||0}，核算负差价（未同时红色）${counts.warning||0}，核算待补充 ${counts.pending||0}，核算正常 ${counts.ok||0}。</p>`+checks.sort((a,b)=>({danger:0,warning:1,pending:2,ok:3}[a.result.severity]-{danger:0,warning:1,pending:2,ok:3}[b.result.severity])).map(({row,addon})=>`<div class="addon-audit-row"><strong>${esc(row.name)}</strong><p>${esc(addon.text)}</p>${addonStatusHtml(addon,api.getCosts(),[row])}<button data-addon-source="${esc(row.sourceId)}">编辑此加购</button></div>`).join('');$$('[data-addon-source]').forEach(b=>b.onclick=()=>{if(!stageCurrent())return;showDeleted=false;$('#source-deleted').textContent='已删除';select(api.getRows().find(r=>r.sourceId===b.dataset.addonSource));$('#source-detail').scrollIntoView({block:'start'});});};
 $('#source-deleted').onclick=()=>{if(busy)return;if(!stageCurrent())return;showDeleted=!showDeleted;page=0;draft=null;selectedId=null;$('#source-deleted').textContent=showDeleted?'返回在用':'已删除';const first=filtered()[0];if(first)select(first);else{$('#source-detail').innerHTML='<p class="hint">没有记录。</p>';list();}};
 $('#source-special-list').onclick=()=>{if(busy)return;if(!stageCurrent())return;specialOnly=!specialOnly;$('#source-special-list').textContent=specialOnly?'全部配件':'特殊配件';$('#source-search').value='';page=0;draft=null;selectedId=null;const first=filtered()[0];if(first)select(first);else{$('#source-detail').innerHTML='<p class="hint">点击新增配件，创建特殊配件。</p>';list();}};
 $('#source-search').oninput=()=>{page=0;list();};$('#source-prev').onclick=()=>{page--;list();};$('#source-next').onclick=()=>{page++;list();};$('#source-new').onclick=()=>{if(busy)return;if(!stageCurrent())return;showDeleted=false;$('#source-deleted').textContent='已删除';select({sourceId:crypto.randomUUID(),goodsId:'',name:'',specialComponent:specialOnly,erp:specialOnly?0:null,tax:specialOnly?0:null,warranty:specialOnly?'':'质保',upgrade:'',addonText:'',addonNote:''});};
 $('#source-save-all').onclick=()=>saveAll().catch(()=>{});
 $('#source-discard-all').onclick=()=>{if(busy)return;if((pending.size||draft&&isEdited())&&!confirm('放弃本次所有尚未保存的输出源和加购修改？'))return;pending.clear();draft=null;selectedId=null;addonFields=null;const first=filtered()[0];if(first)select(first);else{$('#source-detail').innerHTML='<p class="hint">从左侧选择配件。</p>';list();updatePending();}message('已放弃本次未保存修改。');};
 const dialog=$('#dialog'),controller=new AbortController(),options={signal:controller.signal};
 const hasPending=()=>pending.size>0||!!draft&&isEdited();
 const guard=e=>{if(busy||hasPending()){e.preventDefault();message(busy?'正在保存，请稍候。':'还有未保存修改，请先“保存全部更改”，或选择“放弃全部更改”。');}};
 dialog.addEventListener('cancel',guard,options);dialog.querySelector('form').addEventListener('submit',guard,options);
 const editor={hasPending,save:saveAll};window.workbenchSourceEditor=editor;
 dialog.addEventListener('close',()=>{controller.abort();if(window.workbenchSourceEditor===editor)delete window.workbenchSourceEditor;},{once:true});
 list();if(filtered().length)select(filtered()[0]);
}
