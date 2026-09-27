import {sourceSyncPlan,sourceImageEntries} from './source-sync-data.js';
import {renderPoster} from './poster.js';
import {makeZip} from './zip.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={name:'显示名称',tax:'含税核算单价',upgrade:'逐项升级说明'};
export function mountSourceSync(root,api){
 root.innerHTML=`<h4>更新本店全部差异配置</h4><div class="source-fields">${Object.entries(labels).map(([key,name])=>`<label><input type="checkbox" data-source-field="${key}" checked>${name}</label>`).join('')}</div><p class="hint">扫描本店所有配置与已保存输出源的差异。维护表中的加购描述仅写入对应配件的逐项升级说明，不新增或修改人工“加购与选配”；已有手写内容默认保留，可在预览中选择覆盖。先保存下方配件修改，再预览全部差异。</p><div class="source-export-choice"><span>更新配置图、SKU 图并导出？</span><label><input type="radio" name="source-export" value="no" checked> 否，仅更新配置数据</label><label><input type="radio" name="source-export" value="yes"> 是，生成并导出所选配置</label></div><div class="actions"><button id="source-check">预览本店全部差异</button><button id="source-apply" class="primary" disabled>同步所选差异配置</button><button id="source-export-retry" hidden>重新保存并导出</button></div><div id="source-diff"></div><p data-source-sync-message class="hint" role="status"></p>`;
 const $=s=>root.querySelector(s);let preview=null,plan=null,busy=false,exportConfigs=null,locked=[],groupBy='option',retained=new Set(),selectedLinks=new Set(),visibleGroups=[];
 const message=text=>{$('[data-source-sync-message]').textContent=text;api.message(text);};
 function invalidate(){preview=null;plan=null;$('#source-apply').disabled=true;$('#source-diff').innerHTML='';}
 const dialog=root.closest('dialog');dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 function lock(value){busy=value;if(value){locked=[...dialog.querySelectorAll('input,textarea,select,button')].map(el=>[el,el.disabled]);for(const [el] of locked)el.disabled=true;}else for(const [el,disabled] of locked)if(el.isConnected)el.disabled=disabled;}
 const autoExport=()=>$('input[name=source-export]:checked').value==='yes';
 for(const el of root.querySelectorAll('input'))el.addEventListener('change',invalidate);
 const editable=items=>items.filter(item=>item.detail.field!=='tax');
 const currentItems=()=>preview.changes.filter(c=>selectedLinks.has(c.before.productId)).flatMap(config=>config.details.map(detail=>({config,detail})));
 function syncControl(control,items){const keys=[...new Set(editable(items).map(item=>item.detail.key))],count=keys.filter(key=>retained.has(key)).length;control.checked=keys.length>0&&count===keys.length;control.indeterminate=count>0&&count<keys.length;control.disabled=!keys.length;}
 function selection(){
  const productIds=[...selectedLinks],items=currentItems();
  plan=sourceSyncPlan(preview.changes.map(d=>d.before),preview.sources,preview.fields,preview.shopId,{productIds,retained:[...retained]});
  $('#source-apply').disabled=!plan.changes.length;
  syncControl($('[data-source-retain-all]'),items);
  root.querySelectorAll('[data-source-retain-group]').forEach(el=>syncControl(el,visibleGroups[Number(el.dataset.sourceRetainGroup)].items));
  root.querySelectorAll('[data-source-retain]').forEach(el=>el.checked=retained.has(el.value));
  const kept=new Set(editable(items).filter(item=>retained.has(item.detail.key)).map(item=>item.detail.key)).size;
  message(`已选 ${productIds.length} 个链接，将同步 ${plan.changes.length} 套配置、${plan.changes.reduce((n,d)=>n+d.details.length,0)} 项差异${autoExport()?`，生成并导出 ${plan.changes.length*2} 张图片`:''}。已保留 ${kept} 项原描述；批量保留不影响核算单价。`);
 }
 function setRetained(items,checked){for(const {detail} of editable(items))checked?retained.add(detail.key):retained.delete(detail.key);selection();}
 function renderGroups(){
  const groups=new Map();
  for(const item of currentItems()){
   const d=item.detail,key=groupBy==='link'?item.config.before.productId:JSON.stringify([d.field,d.before??'',d.after??'']);
   if(!groups.has(key))groups.set(key,{items:[]});groups.get(key).items.push(item);
  }
  visibleGroups=[...groups.values()];if(groupBy==='option')visibleGroups.sort((a,b)=>({upgrade:0,name:1,tax:2}[a.items[0].detail.field]??3)-({upgrade:0,name:1,tax:2}[b.items[0].detail.field]??3));
  $('[data-source-groups]').innerHTML=visibleGroups.map((group,index)=>{
   const first=group.items[0],d=first.detail,configs=new Set(group.items.map(i=>i.config.id)),links=new Set(group.items.map(i=>i.config.before.productId));
   const retain=`<label><input type="checkbox" data-source-retain-group="${index}">${groupBy==='link'?'本链接保留全部原描述':'保留此组选项原描述'}</label>`;
   const difference=change=>`<div class="source-option-change"><del>${esc(change.before??'空')}</del><span>→ ${esc(change.after??'空')}</span></div>`;
   if(groupBy==='option')return `<section class="source-link-group source-option-group"><strong>${labels[d.field]} · ${links.size} 个链接 / ${configs.size} 套配置</strong>${difference(d)}${d.field==='tax'?'':retain}<details class="source-diff-item"><summary>查看涉及的 ${configs.size} 套配置，可逐项调整</summary>${group.items.map(({config,detail})=>`<div><strong>${esc(config.product)} · ${esc(config.name)} · ${esc(detail.slot)}</strong>${detail.field==='tax'?'':`<label><input type="checkbox" data-source-retain value="${esc(detail.key)}">保留原描述</label>`}</div>`).join('')}</details></section>`;
   const byConfig=new Map();for(const item of group.items){if(!byConfig.has(item.config.id))byConfig.set(item.config.id,[]);byConfig.get(item.config.id).push(item);}
   return `<section class="source-link-group"><strong>${esc(first.config.product)} · ${configs.size} 套差异配置</strong>${retain}${[...byConfig.values()].map(items=>`<details class="source-diff-item"><summary>${esc(items[0].config.name)}（${items.length} 项）</summary>${items.map(({detail})=>`<div><strong>${esc(detail.slot)} · ${labels[detail.field]}</strong>${difference(detail)}${detail.field==='tax'?'':`<label><input type="checkbox" data-source-retain value="${esc(detail.key)}">保留原描述</label>`}</div>`).join('')}</details>`).join('')}</section>`;
  }).join('')||'<p class="hint">当前范围没有差异。</p>';
  root.querySelectorAll('[data-source-retain]').forEach(el=>el.onchange=()=>{el.checked?retained.add(el.value):retained.delete(el.value);selection();});
  root.querySelectorAll('[data-source-retain-group]').forEach(el=>el.onchange=()=>setRetained(visibleGroups[Number(el.dataset.sourceRetainGroup)].items,el.checked));
  selection();
 }
 $('#source-check').onclick=async()=>{if(busy)return;invalidate();try{
  if(api.isEdited())throw Error('请先保存或重置当前输出源修改，再预览本店全部差异。');await api.flush();
  preview=sourceSyncPlan(api.getConfigs(),api.getRows(),[...root.querySelectorAll('[data-source-field]:checked')].map(el=>el.dataset.sourceField),api.shopId());
  retained=new Set(preview.changes.flatMap(c=>c.details.filter(d=>d.field==='upgrade'&&d.before).map(d=>d.key)));
  const links=new Map(preview.changes.map(c=>[c.before.productId,c.product]));selectedLinks=new Set(links.keys());
  $('#source-diff').innerHTML=`<div class="source-diff-controls"><div class="actions"><label>查看方式 <select data-source-group-by><option value="option">按加购选项 / 相同差异</option><option value="link">按链接</option></select></label><label><input type="checkbox" data-source-retain-all>已选链接全部保留原描述</label></div><details class="source-scope"><summary>选择同步链接（${links.size} 个有差异）</summary><div class="actions"><button data-source-all>全选链接</button><button data-source-none>取消全选</button></div><div class="source-scope-links">${[...links].map(([id,name])=>`<label><input type="checkbox" data-source-link value="${esc(id)}" checked>${esc(name)}</label>`).join('')}</div></details><div class="actions"><button data-source-expand>展开全部配置</button><button data-source-collapse>收起全部配置</button></div></div><div data-source-groups></div>`;
  $('[data-source-group-by]').value=groupBy;$('[data-source-group-by]').onchange=e=>{groupBy=e.target.value;renderGroups();};
  $('[data-source-retain-all]').onchange=e=>setRetained(currentItems(),e.target.checked);
  root.querySelectorAll('[data-source-link]').forEach(el=>el.onchange=()=>{el.checked?selectedLinks.add(el.value):selectedLinks.delete(el.value);renderGroups();});
  for(const [selector,checked] of [['[data-source-all]',true],['[data-source-none]',false]])$(selector).onclick=()=>{root.querySelectorAll('[data-source-link]').forEach(el=>{el.checked=checked;checked?selectedLinks.add(el.value):selectedLinks.delete(el.value);});renderGroups();};
  for(const [selector,open] of [['[data-source-expand]',true],['[data-source-collapse]',false]])$(selector).onclick=()=>root.querySelectorAll('.source-diff-item').forEach(el=>el.open=open);
  renderGroups();if(!preview.changes.length)message('本店所有配置均与输出源一致，无需更新。');
 }catch(e){invalidate();message(e.message);}};
 async function exportAll(){await api.flush();const entries=sourceImageEntries(exportConfigs),files=[],failures=[];for(const [i,entry] of entries.entries()){message(`已同步配置，正在更新图片 ${i+1}/${entries.length}：${entry.config.name}`);try{const result=await renderPoster(entry.config,1400);if(result.overflow)throw Error('图片内容超出，请调整模块或字号');const blob=await new Promise(resolve=>result.canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('图片生成失败');await api.saveImage(entry.config,result.canvas);files.push({name:entry.name,bytes:new Uint8Array(await blob.arrayBuffer())});}catch(e){failures.push({name:entry.name,error:e.message});}}if(!files.length)throw Error('图片全部生成失败：'+failures.map(f=>f.error).join('；'));const report={createdAt:new Date().toISOString(),expected:entries.length,success:files.map(f=>f.name),failures};files.push({name:'导出结果.json',bytes:new TextEncoder().encode(JSON.stringify(report,null,2))});api.download(makeZip(files),`本店输出源更新图片_${Date.now()}.zip`);message(`已同步 ${exportConfigs.length} 套配置，导出 ${report.success.length}/${entries.length} 张图片${failures.length?`，失败 ${failures.length} 张，详情见导出结果.json，可重试。`:'，配置图与 SKU 图已全部更新。'}`);}
 $('#source-apply').onclick=async()=>{if(busy||!plan)return;const approved=plan,auto=autoExport();exportConfigs=null;try{if(api.isEdited())throw Error('输出源有新修改，请先保存并重新预览');lock(true);await api.apply(approved);exportConfigs=api.getConfigs().filter(c=>approved.changes.some(d=>d.id===c.id)).map(c=>structuredClone(c));plan=null;if(auto)await exportAll();else message(`已同步 ${approved.changes.length} 套配置，未生成或导出图片。`);$('#source-export-retry').hidden=!auto;}catch(e){message('操作未完成：'+e.message);if(exportConfigs)$('#source-export-retry').hidden=false;}finally{lock(false);invalidate();}};
 $('#source-export-retry').onclick=async()=>{if(busy||!exportConfigs)return;try{lock(true);await exportAll();}catch(e){message(e.message);}finally{lock(false);invalidate();}};
 return {invalidate};
}
