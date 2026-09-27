import {actualParts,ensureActualParts} from './actual-parts.js';
import {clone,slots} from './core.js';
import {replaceSourcePart} from './source.js';
import {findPartUsage,replacementPlan,validateReplacement} from './global-batch.js';
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

const targetFields=scope=>{
 const fields=['parts','actualParts'].filter(field=>scope[field]);
 if(!fields.length)throw Error('请至少勾选展示配件或实际配置');
 return fields;
};
export function scopedPartUsage(configs,query,scope){
 const fields=targetFields(scope);
 return findPartUsage(configs.map(c=>({...c,parts:fields.flatMap(field=>field==='parts'?c.parts:actualParts(c))})),query);
}
export function linkPartsPlan(configs,{scope={parts:true,actualParts:true},mode='replace',partKey,row,slot,qty=null}){
 const fields=targetFields(scope),changes=new Map(),productIds=[...new Set(configs.map(c=>c.productId))],byId=new Map(configs.map(c=>[c.id,c]));
 for(const field of fields){
  // Field plans only edit parts/addons; full snapshots are captured once when merging.
  const inputs=configs.map(c=>({id:c.id,productId:c.productId,product:c.product,spu:c.spu,shopId:c.shopId,name:c.name,deletedAt:c.deletedAt,parts:field==='parts'?c.parts:actualParts(c),addons:c.addons}));
  const plan=mode==='add'?additionPlan(inputs,null,row,slot,qty):replacementPlan(inputs,partKey,productIds,row,qty);
  for(const change of plan.changes){
   const original=byId.get(change.id);
   if(!changes.has(change.id)){const after=clone(original);ensureActualParts(after);changes.set(change.id,{...change,before:clone(original),after});}
   const merged=changes.get(change.id);merged.after[field]=change.after.parts;
   if(field==='parts')merged.after.addons=change.after.addons;
  }
 }
 return {changes:[...changes.values()],productIds,replacement:clone(row),scope:{...scope}};
}
export function linkPartsDiff(plan){
 return plan.changes.map(c=>c.product+' / '+c.name+'\n'+targetFields(plan.scope).flatMap(field=>{
  const before=field==='parts'?c.before.parts:actualParts(c.before);
  return c.after[field].flatMap(p=>{const old=before.find(o=>o.slot===p.slot);return JSON.stringify(old)===JSON.stringify(p)?[]:[`${field==='parts'?'展示配件':'实际配置'} · ${p.slot}：${old?.name||'空'} ×${old?.qty||0} → ${p.name} ×${p.qty}`];});
 }).join('\n')).join('\n\n');
}

// Build on copies so a later invalid rule cannot partially modify live data.
export function linkPartsBatchPlan(configs,{scope={parts:true,actualParts:true},rules=[]}){
 targetFields(scope);
 if(!rules.length)throw Error('请至少添加一条修改规则');
 const originals=configs.filter(c=>!c.deletedAt),working=clone(originals),results=[];
 if(!working.length)throw Error('请选择需要修改的配置');
 for(const [index,rule] of rules.entries()){
  try{
   if(!['replace','add'].includes(rule.mode))throw Error('请选择操作');
   if(rule.mode==='replace'&&!rule.partKey)throw Error('请选择原配件');
   if(!rule.row||rule.row.deletedAt)throw Error('请选择有效的新配件');
   if(working.some(c=>rule.row.shopId&&c.shopId!==rule.row.shopId))throw Error('请选择当前店铺的配件');
   const step=linkPartsPlan(working,{...rule,scope});
   const byId=new Map(step.changes.map(c=>[c.id,c.after]));
   for(let i=0;i<working.length;i++)if(byId.has(working[i].id))working[i]=byId.get(working[i].id);
   results.push({mode:rule.mode,count:step.changes.length,name:rule.row.name});
  }catch(error){throw Error(`第 ${index+1} 条规则：${error.message}`);}
 }
 const changes=working.flatMap((after,i)=>JSON.stringify(after)===JSON.stringify(originals[i])?[]:[{id:after.id,name:after.name,product:after.product,before:clone(originals[i]),after}]);
 return {scope:{...scope},changes,productIds:[...new Set(originals.map(c=>c.productId))],replacements:rules.map(r=>clone(r.row)),rules:results,overview:working.map((after,i)=>({id:after.id,name:after.name,product:after.product,before:clone(originals[i]),after}))};
}

export function linkPartsOverview(plan){
 return (plan.overview||plan.changes).flatMap(c=>targetFields(plan.scope).flatMap(field=>{
  const before=field==='parts'?c.before.parts:actualParts(c.before),after=field==='parts'?c.after.parts:actualParts(c.after);
  return after.map((part,index)=>({id:c.id,product:c.product,name:c.name,field,slot:part.slot,before:before[index]||null,after:part,changed:JSON.stringify(before[index])!==JSON.stringify(part)}));
 }));
}

export function openLinkParts(api){
 const {product,openDialog,esc,getConfigs,getCatalog,apply,toast}=api;
 openDialog('链接内配件批量修改',`<p class="hint">${esc(product.name)} · 可同时添加多条替换和新增规则，按列表顺序执行，统一预览后保存。</p><label class="field">修改范围<select id="link-part-scope"><option value="link">当前链接全部配置</option><option value="selected">按左侧勾选配置修改（本店，可跨链接）</option></select></label><div class="actions" role="group" aria-label="修改内容"><label><input id="link-part-display" type="checkbox" checked> 展示配件</label><label><input id="link-part-actual" type="checkbox" checked> 实际配置</label></div><p id="link-part-scope-summary" class="hint"></p><div id="link-part-rules"></div><div class="actions"><button id="link-part-add-replace">＋ 查找替换</button><button id="link-part-add-new">＋ 新增配件</button></div><div class="link-part-preview-bar actions"><button id="link-part-preview">预览全部修改</button><button id="link-part-apply" class="primary" disabled>应用到本链接</button><label><input id="link-part-show-all" type="checkbox"> 显示全部配件</label></div><p id="link-part-status" role="status" aria-live="polite"></p><div id="link-part-diff"><p class="hint">设置规则后，点击“预览全部修改”查看各配置的修改前后总览。</p></div>`);
 const $=s=>document.querySelector(s);let plan=null,busy=false,serial=0;const rules=[];
 const dialog=$('#link-part-status').closest('dialog'),controller=new AbortController();
 dialog.classList.add('link-parts-dialog');
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();},{signal:controller.signal});
 dialog.addEventListener('close',()=>{dialog.classList.remove('link-parts-dialog');controller.abort();},{once:true,signal:controller.signal});
 const scope=()=>({parts:$('#link-part-display').checked,actualParts:$('#link-part-actual').checked});
 const configs=()=>{const selected=$('#link-part-scope').value==='selected'?new Set(api.getSelectedIds?.()||[]):null;return getConfigs().filter(c=>!c.deletedAt&&(selected?selected.has(c.id):c.productId===product.id));};
 const scopeSummary=()=>{const rows=configs();$('#link-part-scope-summary').textContent=rows.length?`范围内 ${rows.length} 套配置 · ${new Set(rows.map(c=>c.productId)).size} 个链接`:'尚未勾选配置，请先在左侧勾选';$('#link-part-apply').textContent=$('#link-part-scope').value==='selected'?'应用到勾选配置':'应用到本链接';};
 const invalidate=()=>{plan=null;$('#link-part-apply').disabled=true;$('#link-part-diff').innerHTML='<p class="hint">规则已变化，请重新预览全部修改。</p>';$('#link-part-status').textContent='';};
 const renumber=()=>rules.forEach((rule,i)=>{rule.root.querySelector('[data-rule-title]').textContent=`规则 ${i+1}`;});
 const addRule=(mode='replace')=>{
  invalidate();const n=serial++,suffix=n?`-${n+1}`:'',id=name=>`link-part-${name}${suffix}`;
  const root=document.createElement('section');root.className='link-part-rule';root.dataset.rule=String(n);
  root.innerHTML=`<div class="link-part-rule-heading"><strong data-rule-title></strong><button type="button" data-rule-remove>移除</button></div><div class="link-part-rule-grid"><label class="field">操作<select id="${id('mode')}" data-rule-mode><option value="replace">查找替换配件</option><option value="add">新增配件</option></select></label><div id="${id('old')}" data-rule-old><label class="field">查找原配件<input id="${id('query')}" data-rule-query placeholder="配件名称或 ERP ID"></label><select id="${id('match')}" data-rule-match aria-label="原配件"><option value="">请选择原配件</option></select></div><div id="${id('new')}" data-rule-new></div><label id="${id('slot-field')}" class="field hidden" data-rule-slot-field>添加到槽位<select id="${id('slot')}" data-rule-slot>${slots.map(s=>`<option>${s}</option>`).join('')}</select></label><label class="field">数量<input id="${id('qty')}" data-rule-qty type="number" min="1" step="1" placeholder="留空保留原数量"></label></div>`;
  $('#link-part-rules').append(root);
  const local=selector=>root.querySelector(selector);
  const picker=mountProductSearch(local('[data-rule-new]'),{getRows:getCatalog,idKey:'sourceId',label:'选择新配件',inputId:id('new-query'),describe:r=>'ERP ID '+r.goodsId,onChange:row=>{local('[data-product-results]').classList.toggle('hidden',!!row);local('[data-product-count]').classList.toggle('hidden',!!row);invalidate();}});
  const refreshMatches=()=>{const value=local('[data-rule-match]').value;local('[data-rule-match]').innerHTML='<option value="">请选择原配件</option>'+(Object.values(scope()).some(Boolean)?scopedPartUsage(configs(),local('[data-rule-query]').value,scope()):[]).map(r=>`<option value="${esc(r.key)}">${esc(r.name)} · ${r.count} 套配置</option>`).join('');local('[data-rule-match]').value=value;};
  const rule={root,refreshMatches,read:()=>({mode:local('[data-rule-mode]').value,partKey:local('[data-rule-match]').value,row:picker.row(),slot:local('[data-rule-slot]').value,qty:local('[data-rule-qty]').value===''?null:Number(local('[data-rule-qty]').value)})};
  rules.push(rule);renumber();
  local('[data-rule-remove]').onclick=()=>{rules.splice(rules.indexOf(rule),1);root.remove();renumber();invalidate();};
  local('[data-rule-query]').oninput=()=>{invalidate();refreshMatches();};
  local('[data-rule-mode]').onchange=()=>{invalidate();const add=local('[data-rule-mode]').value==='add';local('[data-rule-old]').classList.toggle('hidden',add);local('[data-rule-slot-field]').classList.toggle('hidden',!add);local('[data-rule-qty]').value=add?'1':'';local('[data-rule-qty]').placeholder=add?'新增数量':'留空保留原数量';};
  for(const selector of ['[data-rule-match]','[data-rule-slot]','[data-rule-qty]'])local(selector).oninput=invalidate;
  local('[data-rule-mode]').value=mode;local('[data-rule-mode]').onchange();
 };
 const partText=p=>p&&(p.name||p.goodsId)?`${p.displayName||p.name||'未命名'} ×${p.qty??1}`:'空';
 const renderOverview=()=>{
  if(!plan)return;
  const all=linkPartsOverview(plan),rows=$('#link-part-show-all').checked?all:all.filter(r=>r.changed);
  const summary=`${plan.scopeIds.length} 套配置中 ${plan.changes.length} 套有变化 · ${plan.rules.length} 条规则 · ${all.filter(r=>r.changed).length} 处配件变化`;
  $('#link-part-diff').innerHTML=`<h3>修改结果总览</h3><p class="hint">${summary}</p><div class="link-part-rule-results">${plan.rules.map((r,i)=>`<span>规则 ${i+1} · ${r.mode==='add'?'新增':'替换'} ${esc(r.name)}：${r.count} 套</span>`).join('')}</div>${rows.length?`<div class="link-part-overview-wrap" tabindex="0" aria-label="修改结果总览"><table class="link-part-overview"><thead><tr><th>配置</th><th>修改内容</th><th>槽位</th><th>修改前</th><th>修改后</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.changed?'is-changed':''}"><th scope="row">${esc(r.name)}<small>${esc(r.product)}</small></th><td>${r.field==='parts'?'展示配件':'实际配置'}</td><td>${esc(r.slot)}</td><td>${esc(partText(r.before))}<small>${esc(r.before?.goodsId?'ERP ID '+r.before.goodsId:'')}</small></td><td>${esc(partText(r.after))}<small>${esc(r.after.goodsId?'ERP ID '+r.after.goodsId:'')}${r.changed?' · 已修改':''}</small></td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">没有需要修改的配件。可勾选“显示全部配件”查看当前配置。</p>'}`;
 };
 for(const id of ['link-part-display','link-part-actual','link-part-scope'])$('#'+id).onchange=()=>{invalidate();scopeSummary();rules.forEach(r=>r.refreshMatches());};
 $('#link-part-add-replace').onclick=()=>addRule('replace');$('#link-part-add-new').onclick=()=>addRule('add');
 $('#link-part-show-all').onchange=renderOverview;
 scopeSummary();addRule();
 $('#link-part-preview').onclick=()=>{try{
  const targets=configs();plan=linkPartsBatchPlan(targets,{scope:scope(),rules:rules.map(r=>r.read())});
  plan.scopeIds=targets.map(c=>c.id).sort();plan.scopeType=$('#link-part-scope').value;
  renderOverview();$('#link-part-status').textContent=`将修改 ${plan.changes.length} 套配置，${plan.scope.parts?'维护表加购描述写入逐项升级说明，人工加购保留。':'仅更新实际配置。'}`;$('#link-part-apply').disabled=!plan.changes.length;
  $('#link-part-diff').scrollIntoView({block:'start'});
 }catch(e){invalidate();$('#link-part-status').textContent=e.message;}};
 $('#link-part-apply').onclick=async()=>{if(!plan||busy)return;busy=true;const controls=[...dialog.querySelectorAll('input,select,button')].map(el=>({el,disabled:el.disabled}));controls.forEach(({el})=>el.disabled=true);try{
  $('#link-part-status').textContent=`正在应用并保存 ${plan.changes.length} 套配置，请稍候…`;
  await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  if(JSON.stringify(configs().map(c=>c.id).sort())!==JSON.stringify(plan.scopeIds))throw Error('勾选范围已变化，请重新预览');
  validateReplacement({...plan,changes:plan.overview},configs());
  for(const replacement of plan.replacements){const row=getCatalog().find(r=>r.sourceId===replacement.sourceId);if(JSON.stringify(row)!==JSON.stringify(replacement))throw Error('配件资料已变化，请重新预览');}
  const savedCount=plan.changes.length;await apply(plan);toast('所选范围内配件已统一修改并保存');$('#link-part-status').textContent=`已保存 ${savedCount} 套配置，可继续调整规则并重新预览。`;plan=null;
 }catch(e){if($('#link-part-status')){invalidate();$('#link-part-status').textContent=e.message;}}finally{busy=false;controls.forEach(({el,disabled})=>{if(el.isConnected)el.disabled=disabled;});if(!plan&&$('#link-part-apply'))$('#link-part-apply').disabled=true;}};
}
