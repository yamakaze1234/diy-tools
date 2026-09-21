import {clone,slots} from './core.js';
import {replaceSourcePart} from './source.js';
import {findPartUsage,replacementPlan} from './global-batch.js';
import {mountProductSearch} from './product-search.js';

export function additionPlan(configs,productId,row,slot,qty){
 if(!row||row.deletedAt)throw Error('请选择有效的新配件');
 if(!slots.includes(slot))throw Error('请选择配件槽位');
 if(!Number.isInteger(qty)||qty<1)throw Error('数量必须是正整数');
 const targets=configs.filter(c=>!c.deletedAt&&(productId===null||c.productId===productId));
 if(targets.some(c=>row.shopId&&c.shopId!==row.shopId))throw Error('请选择当前店铺的配件');
 const occupied=targets.filter(c=>c.parts.some(p=>p.slot===slot&&(p.name||p.goodsId)));
 if(occupied.length)throw Error(`${occupied.map(c=>c.name).join('、')} 的 ${slot} 已有配件，请使用查找替换或选择空槽位`);
 return {productIds:[...new Set(targets.map(c=>c.productId))],replacement:clone(row),changes:targets.map(c=>{
  const after=clone(c);let i=after.parts.findIndex(p=>p.slot===slot);
  if(i<0){i=after.parts.length;after.parts.push({slot});}
  replaceSourcePart(after,i,row);after.parts[i].qty=qty;
  return {id:c.id,name:c.name,product:c.product,before:clone(c),after};
 })};
}

export function openLinkParts(api){
 const {product,openDialog,esc,getConfigs,getCatalog,apply,toast}=api;
 openDialog('链接内配件批量修改',`<p class="hint">${esc(product.name)} · 先选择修改范围，再预览差异并应用。</p><label class="field">修改范围<select id="link-part-scope"><option value="link">当前链接全部配置</option><option value="selected">按左侧勾选配置修改（本店，可跨链接）</option></select></label><p id="link-part-scope-summary" class="hint"></p><label class="field">操作<select id="link-part-mode"><option value="replace">查找替换配件</option><option value="add">一键添加配件</option></select></label><div id="link-part-old"><label class="field">查找原配件<input id="link-part-query" placeholder="配件名称或 ERP ID"></label><select id="link-part-match" aria-label="原配件"><option value="">请选择原配件</option></select></div><div id="link-part-new"></div><label id="link-part-slot-field" class="field hidden">添加到槽位<select id="link-part-slot">${slots.map(s=>`<option>${s}</option>`).join('')}</select></label><label class="field">数量（替换时留空保留原数量）<input id="link-part-qty" type="number" min="1" step="1"></label><div class="actions"><button id="link-part-preview">预览修改</button><button id="link-part-apply" class="primary" disabled>应用到本链接</button></div><pre id="link-part-diff" style="white-space:pre-wrap"></pre><p id="link-part-status" role="status"></p>`);
 const $=s=>document.querySelector(s);let plan=null,busy=false;
 const configs=()=>getConfigs().filter(c=>!c.deletedAt&&($('#link-part-scope').value==='selected'?(api.getSelectedIds?.()||[]).includes(c.id):c.productId===product.id));
 const scopeSummary=()=>{const rows=configs();$('#link-part-scope-summary').textContent=rows.length?`范围内 ${rows.length} 套：`+rows.map(c=>`${c.product} / ${c.name}`).join('、'):'尚未勾选配置，请先在左侧勾选';$('#link-part-apply').textContent=$('#link-part-scope').value==='selected'?'应用到勾选配置':'应用到本链接';};
 const invalidate=()=>{plan=null;$('#link-part-apply').disabled=true;$('#link-part-diff').textContent='';};
 const picker=mountProductSearch($('#link-part-new'),{getRows:getCatalog,idKey:'sourceId',label:'选择新配件',inputId:'link-part-new-query',describe:r=>'ERP ID '+r.goodsId,onChange:invalidate});
 $('#link-part-query').oninput=()=>{invalidate();$('#link-part-match').innerHTML='<option value="">请选择原配件</option>'+findPartUsage(configs(),$('#link-part-query').value).map(r=>`<option value="${esc(r.key)}">${esc(r.name)} · ${r.count} 套配置</option>`).join('');};
 $('#link-part-scope').onchange=()=>{invalidate();scopeSummary();$('#link-part-query').oninput();};scopeSummary();
 $('#link-part-mode').onchange=()=>{invalidate();const add=$('#link-part-mode').value==='add';$('#link-part-old').classList.toggle('hidden',add);$('#link-part-slot-field').classList.toggle('hidden',!add);$('#link-part-qty').value=add?'1':'';};
 for(const id of ['link-part-match','link-part-slot','link-part-qty'])$('#'+id).oninput=invalidate;
 $('#link-part-preview').onclick=()=>{try{
  const add=$('#link-part-mode').value==='add',qty=$('#link-part-qty').value,targets=configs();
  if(!targets.length)throw Error('请先勾选需要修改的配置');
  if(!add&&!$('#link-part-match').value)throw Error('请选择原配件');
  plan=add?additionPlan(targets,null,picker.row(),$('#link-part-slot').value,Number(qty)):replacementPlan(targets,$('#link-part-match').value,[...new Set(targets.map(c=>c.productId))],picker.row(),qty===''?null:Number(qty));
  plan.scopeIds=targets.map(c=>c.id).sort();plan.scopeType=$('#link-part-scope').value;
  $('#link-part-diff').textContent=plan.changes.map(c=>c.product+' / '+c.name+'\n'+c.after.parts.flatMap(p=>{const old=c.before.parts.find(o=>o.slot===p.slot);return JSON.stringify(old)===JSON.stringify(p)?[]:[`${p.slot}：${old?.name||'空'} ×${old?.qty||0} → ${p.name} ×${p.qty}`];}).join('\n')).join('\n\n');
  $('#link-part-status').textContent=`将修改 ${plan.changes.length} 套配置，绑定加购随新配件更新。`;$('#link-part-apply').disabled=!plan.changes.length;
 }catch(e){invalidate();$('#link-part-status').textContent=e.message;}};
 $('#link-part-apply').onclick=async()=>{if(!plan||busy)return;busy=true;const button=$('#link-part-apply');button.disabled=true;try{
  if(JSON.stringify(configs().map(c=>c.id).sort())!==JSON.stringify(plan.scopeIds))throw Error('勾选范围已变化，请重新预览');
  const row=getCatalog().find(r=>r.sourceId===plan.replacement.sourceId);
  if(JSON.stringify(row)!==JSON.stringify(plan.replacement))throw Error('配件资料已变化，请重新预览');
  await apply(plan);toast('所选范围内配件已统一修改并保存');api.closeDialog();
 }catch(e){$('#link-part-status').textContent=e.message;invalidate();}finally{busy=false;}};
}
