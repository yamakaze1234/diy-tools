import {sourceSyncPlan,sourceImageEntries} from './source-sync-data.js';
import {renderPoster} from './poster.js';
import {makeZip} from './zip.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={name:'显示名称',tax:'含税核算单价',addon:'加购文案'};
export function mountSourceSync(root,api){
 root.innerHTML=`<h4>更新本店全部差异配置</h4><div class="source-fields">${Object.entries(labels).map(([key,name])=>`<label><input type="checkbox" data-source-field="${key}" checked>${name}</label>`).join('')}</div><p class="hint">扫描本店所有配置与已保存输出源的差异。先保存下方配件修改，再预览全部差异。</p><div class="source-export-choice"><span>更新配置图、SKU 图并导出？</span><label><input type="radio" name="source-export" value="no" checked> 否，仅更新配置数据</label><label><input type="radio" name="source-export" value="yes"> 是，生成并导出所选配置</label></div><div class="actions"><button id="source-check">预览本店全部差异</button><button id="source-apply" class="primary" disabled>同步所选差异配置</button><button id="source-export-retry" hidden>重新保存并导出</button></div><div id="source-diff"></div><p data-source-sync-message class="hint" role="status"></p>`;
 const $=s=>root.querySelector(s);let preview=null,plan=null,busy=false,exportConfigs=null,locked=[];
 const message=text=>{$('[data-source-sync-message]').textContent=text;api.message(text);};
 function invalidate(){preview=null;plan=null;$('#source-apply').disabled=true;$('#source-diff').innerHTML='';}
 const dialog=root.closest('dialog');dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 function lock(value){busy=value;if(value){locked=[...dialog.querySelectorAll('input,textarea,select,button')].map(el=>[el,el.disabled]);for(const [el] of locked)el.disabled=true;}else for(const [el,disabled] of locked)if(el.isConnected)el.disabled=disabled;}
 const autoExport=()=>$('input[name=source-export]:checked').value==='yes';
 for(const el of root.querySelectorAll('input'))el.addEventListener('change',invalidate);
 function selection(){
  const productIds=[...root.querySelectorAll('[data-source-link]:checked')].map(el=>el.value);
  const retained=[...root.querySelectorAll('[data-source-retain]:checked')].map(el=>el.value);
  plan=sourceSyncPlan(preview.changes.map(d=>d.before),preview.sources,preview.fields,preview.shopId,{productIds,retained});
  $('#source-apply').disabled=!plan.changes.length;
  message(`已选 ${productIds.length} 个链接，将同步 ${plan.changes.length} 套配置、${plan.changes.reduce((n,d)=>n+d.details.length,0)} 项差异${autoExport()?`，生成并导出 ${plan.changes.length*2} 张图片`:''}。勾选“保留原描述”可跳过该项。`);
 }
 $('#source-check').onclick=async()=>{if(busy)return;invalidate();try{
  if(api.isEdited())throw Error('请先保存或重置当前输出源修改，再预览本店全部差异。');await api.flush();
  preview=sourceSyncPlan(api.getConfigs(),api.getRows(),[...root.querySelectorAll('[data-source-field]:checked')].map(el=>el.dataset.sourceField),api.shopId());
  const groups=new Map();for(const d of preview.changes){const id=d.before.productId;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(d);}
  $('#source-diff').innerHTML=`<div class="actions"><button data-source-all>全选链接</button><button data-source-none>取消全选</button></div>`+[...groups].map(([id,items])=>`<section class="source-link-group"><label><input type="checkbox" data-source-link value="${esc(id)}" checked><strong>${esc(items[0].product)}</strong> · ${items.length} 套差异配置</label>${items.map(d=>`<details class="source-diff-item"><summary>${esc(d.name)}（${d.details.length} 项）</summary>${d.details.map(c=>`<div><strong>${esc(c.slot)} · ${labels[c.field]}</strong><del>${esc(c.before??'空')}</del><span>→ ${esc(c.after??'空')}</span>${c.field==='tax'?'':`<label><input type="checkbox" data-source-retain value="${esc(c.key)}">保留原描述</label>`}</div>`).join('')}</details>`).join('')}</section>`).join('');
  root.querySelectorAll('[data-source-link],[data-source-retain]').forEach(el=>el.onchange=selection);
  for(const [selector,checked] of [['[data-source-all]',true],['[data-source-none]',false]])$(selector).onclick=()=>{root.querySelectorAll('[data-source-link]').forEach(el=>el.checked=checked);selection();};
  selection();if(!preview.changes.length)message('本店所有配置均与输出源一致，无需更新。');
 }catch(e){invalidate();message(e.message);}};
 async function exportAll(){await api.flush();const entries=sourceImageEntries(exportConfigs),files=[],failures=[];for(const [i,entry] of entries.entries()){message(`已同步配置，正在更新图片 ${i+1}/${entries.length}：${entry.config.name}`);try{const result=await renderPoster(entry.config,1400);if(result.overflow)throw Error('图片内容超出，请调整模块或字号');const blob=await new Promise(resolve=>result.canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('图片生成失败');await api.saveImage(entry.config,result.canvas);files.push({name:entry.name,bytes:new Uint8Array(await blob.arrayBuffer())});}catch(e){failures.push({name:entry.name,error:e.message});}}if(!files.length)throw Error('图片全部生成失败：'+failures.map(f=>f.error).join('；'));const report={createdAt:new Date().toISOString(),expected:entries.length,success:files.map(f=>f.name),failures};files.push({name:'导出结果.json',bytes:new TextEncoder().encode(JSON.stringify(report,null,2))});api.download(makeZip(files),`本店输出源更新图片_${Date.now()}.zip`);message(`已同步 ${exportConfigs.length} 套配置，导出 ${report.success.length}/${entries.length} 张图片${failures.length?`，失败 ${failures.length} 张，详情见导出结果.json，可重试。`:'，配置图与 SKU 图已全部更新。'}`);}
 $('#source-apply').onclick=async()=>{if(busy||!plan)return;const approved=plan,auto=autoExport();exportConfigs=null;try{if(api.isEdited())throw Error('输出源有新修改，请先保存并重新预览');lock(true);await api.apply(approved);exportConfigs=api.getConfigs().filter(c=>approved.changes.some(d=>d.id===c.id)).map(c=>structuredClone(c));plan=null;if(auto)await exportAll();else message(`已同步 ${approved.changes.length} 套配置，未生成或导出图片。`);$('#source-export-retry').hidden=!auto;}catch(e){message('操作未完成：'+e.message);if(exportConfigs)$('#source-export-retry').hidden=false;}finally{lock(false);invalidate();}};
 $('#source-export-retry').onclick=async()=>{if(busy||!exportConfigs)return;try{lock(true);await exportAll();}catch(e){message(e.message);}finally{lock(false);invalidate();}};
 return {invalidate};
}
