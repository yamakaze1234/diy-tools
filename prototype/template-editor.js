import {mountPartSort} from './part-sort.js';
import {validateTemplateDraft,templateConfigLabel} from './template-library.js';
import {templateConfigs,slots,totals,erpUnitCost} from './core.js';
import {ensureActualParts,syncActualParts} from './actual-parts.js';
import {replaceSourcePart} from './source.js';
import {mountProductSearch} from './product-search.js';
import {copyPartPayload,pastePartPayload} from './part-transfer.js';
import {isSpecialComponent} from './special-components.js';
import {doubleMemoryUpgrade,displayUpgrade,memoryUpgradeKey} from './memory-upgrade.js';

const clone=value=>structuredClone(value);
const imageSize=url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve([image.naturalWidth,image.naturalHeight]);image.onerror=()=>reject(Error('图片无法读取'));image.src=url;});

export function openTemplateEditor({template,shopId,blank,current,catalog,gallery,openDialog,closeDialog,toast,esc,uploadImage,commit}){
 const draft=template?{...clone(template),configs:clone(templateConfigs(template))}:{id:crypto.randomUUID(),shopId,name:'',createdAt:new Date().toISOString(),configs:[blank()]};
 for(const config of draft.configs){config.parts??=[];ensureActualParts(config);config.addons??=[];config.modules??=[];}
 const dialog=document.querySelector('#dialog'),sessionId=crypto.randomUUID();
 const rows=()=>draft.configs;
 const isCurrent=()=>dialog.open&&dialog.dataset.templateEditorSession===sessionId&&!!dialog.querySelector('#template-editor-name');
 const sourceRows=catalog.filter(row=>row.shopId===shopId);
 const moduleNames={header:'标题与机箱',parts:'配件清单',addons:'加购与选配',benefits:'专属福利',service:'服务承诺',footer:'页脚说明',custom:'自定义文字'};
 let active=0,tab='parts',copiedPart=null,saving=false,pendingImageJobs=0;
 const config=()=>rows()[active];
 const partRows=(field)=>{
  const list=config()[field],actual=field==='actualParts';
  return '<p class="hint">'+(actual?'实际配置用于成本和库存；修改这里不会回写展示配件。':'展示配件用于配置图；选择来源或修改数量会同步该项到实际配置。拖动配件名称下方的 ⠿ 手柄调整图片顺序。')+'</p><div class="template-part-list">'+list.map((part,index)=>{
   const source=sourceRows.find(row=>row.sourceId===part.sourceId&&row.goodsId===part.goodsId);
   return '<div '+(actual?'':'data-sort-part ')+'class="template-part-row '+(!actual&&part.posterVisible===false?'poster-hidden-part':'')+'" data-template-part-row="'+index+'"><strong class="part-label">'+esc(part.slot||'未选部位')+(actual?'':'<button type="button" class="part-drag-handle" data-part-drag draggable="true" aria-label="拖动排序'+esc(part.slot)+'" title="拖动调整顺序，也可聚焦后按上下方向键">⠿</button>')+'</strong><div class="part-model"><div data-template-part-search="'+index+'"><input type="search" aria-label="'+esc(part.slot||'配件')+'配件搜索" placeholder="搜索配件名称或 ERP ID" autocomplete="off" value="'+esc(actual?part.name:source?.name||part.name||'')+'"></div>'+(actual?'':'<label class="display-name-field">展示名称<input data-template-display-name="'+index+'" maxlength="200" placeholder="'+esc(part.name||'')+'" value="'+esc(part.displayName||'')+'"></label>')+'<small>ID '+esc(part.goodsId||'未绑定')+'</small><div class="part-transfer"><button type="button" data-template-copy-part="'+index+'">复制配件</button><button type="button" data-template-paste-part="'+index+'" '+(copiedPart?.shopId===shopId?'':'disabled')+'>粘贴替换</button>'+'</div></div><label class="template-qty">数量<input data-template-qty="'+index+'" type="number" min="1" step="1" value="'+esc(part.qty??1)+'"></label>'+(actual?'':'<label class="poster-part-toggle"><input data-template-visible="'+index+'" type="checkbox" '+(part.posterVisible===false?'':'checked')+'>显示</label>')+'<button type="button" data-template-remove-part="'+index+'" aria-label="移除'+esc(part.slot)+'">×</button></div>';
  }).join('')+'</div><button type="button" data-template-add-part class="wide">＋ 添加配件</button>';
 };
 const tabContent=()=>{
  const c=config();
  if(tab==='parts'||tab==='actual')return partRows(tab==='parts'?'parts':'actualParts');
  if(tab==='addons')return '<section class="editor-section"><h3>逐项升级说明</h3>'+c.parts.map((part,index)=>'<label>'+esc(part.slot)+'<input data-template-upgrade="'+index+'" value="'+esc(displayUpgrade(part))+'" class="'+(doubleMemoryUpgrade(part)?'memory-upgrade-warning':'')+'" placeholder="例如：+199 元升级…">'+(doubleMemoryUpgrade(part)?'<small class="memory-upgrade-warning">当前内存已为 2 条，双条升级默认不展示，可手动选择。</small><select data-template-memory-upgrade="'+index+'"><option value="">不展示此升级</option><option value="use" '+(displayUpgrade(part)?'selected':'')+'>'+esc(part.upgrade)+'</option></select>':'')+'</label>').join('')+'</section><section class="editor-section"><h3>加购与选配</h3>'+(c.addons||[]).map((addon,index)=>'<div class="template-edit-addon"><input data-template-addon="'+index+'" data-template-addon-field="text" value="'+esc(addon.text||'')+'" placeholder="加购描述"><input data-template-addon="'+index+'" data-template-addon-field="note" value="'+esc(addon.note||'')+'" placeholder="备注"><button type="button" data-template-remove-addon="'+index+'">移除</button></div>').join('')+'<button type="button" data-template-add-addon>＋ 添加加购</button></section>';
  if(tab==='modules'){
   const modules='<section class="editor-section"><h3>图片模块文案</h3>'+(c.modules||[]).map((module,index)=>'<div class="template-edit-module"><label><input data-template-module-visible="'+index+'" type="checkbox" '+(module.visible===false?'':'checked')+'>显示 '+esc(moduleNames[module.type]||module.title||'文字模块')+'</label><input data-template-module="'+index+'" data-template-module-field="title" value="'+esc(module.title||'')+'" placeholder="标题"><textarea data-template-module="'+index+'" data-template-module-field="text" placeholder="文案">'+esc(module.text||'')+'</textarea></div>').join('')+'</section>';
   const options=gallery.map(row=>'<option value="'+esc(row.url)+'">'+esc(row.name||row.url)+'</option>').join('');
   const images='<div class="template-edit-fields"><label>机箱图片路径<input data-template-config="'+active+'" data-template-field="caseImage" value="'+esc(c.caseImage||'')+'" placeholder="可从图库选或上传"></label><button type="button" data-template-clear-case>清空机箱图片</button><label>从机箱图库选择<select data-template-gallery-case><option value="">选择图片</option>'+options+'</select></label><label>上传机箱图片<input type="file" accept="image/png,image/jpeg" data-template-upload-case></label></div><div class="template-edit-images"><h4>添加的图片图层</h4>'+(c.posterImages||[]).map((image,index)=>'<div class="template-edit-image"><span>'+esc(image.name||image.url)+'</span><button type="button" data-template-remove-image="'+index+'">移除</button></div>').join('')+'<label>从机箱图库添加<select data-template-gallery-layer><option value="">选择图片</option>'+options+'</select></label><label>上传图片图层<input type="file" accept="image/png,image/jpeg" data-template-upload-layer></label></div><label class="field">页脚说明<textarea data-template-config="'+active+'" data-template-field="footer">'+esc(c.footer||'')+'</textarea></label>';
   return modules+images;
  }
  const money=value=>Number(value||0).toLocaleString('zh-CN',{maximumFractionDigits:2});
  const t=totals(c),taxMissing=c.actualParts.some(part=>!isSpecialComponent(part)&&(part.name||part.goodsId)&&part.tax==null),costs='<section class="template-costs"><h3>实际配置成本</h3><p class="hint">与正常配置使用相同的核算口径；仅查看，成本请在三店共用成本源维护。</p>'+(t.erpFallback||t.erpUnresolved?'<p class="erp-price-warning">ERP价格未识别，请核算货源情况和价格。</p>':'')+'<table class="cost-table"><thead><tr><th>配件</th><th>ERP 单价</th><th>含税单价</th><th>数量</th></tr></thead><tbody>'+c.actualParts.map(part=>{const unit=erpUnitCost(part),special=isSpecialComponent(part);return '<tr><td>'+esc(part.slot)+'</td><td>'+(special?'特殊配件 · ¥0':unit.cents===null?'待补成本':'¥'+money(unit.cents/100)+(unit.fallback?'（核算成本代入）':''))+'</td><td>'+(special?'¥0':part.tax==null?'待填':'¥'+money(part.tax))+'</td><td>'+esc(part.qty)+'</td></tr>';}).join('')+'</tbody></table><div class="summary-grid"><div><small>含税总成本 + 到手价 × 4% + 100</small><strong>'+(taxMissing?'待填含税价':'¥'+money(t.basis))+'</strong></div><div><small>EXCEL 利润（分期费另计）</small><strong>'+(taxMissing?'待填含税价':'¥'+money(t.taxProfit))+'</strong></div><div><small>ERP 利润（分期费另计）</small><strong>'+(t.erpProfit===null?'待补成本':'¥'+money(t.erpProfit))+'</strong></div><div><small>ERP 未识别 / 待核算行</small><strong>'+t.missing+'</strong></div></div></section>';
  return costs+'<div class="template-edit-fields"><label>售价<input data-template-config="'+active+'" data-template-field="price" type="number" min="0" step="0.01" value="'+esc(c.price??0)+'"></label></div>';
 };
 const cancel=event=>{if(saving&&isCurrent())event.preventDefault();};
 dialog.addEventListener('cancel',cancel);
 dialog.addEventListener('close',()=>{dialog.removeEventListener('cancel',cancel);dialog.classList.remove('template-editor-dialog');},{once:true});
 const startImageJob=()=>{pendingImageJobs++;dialog.querySelector('#template-editor-save').disabled=true;};
 const finishImageJob=()=>{pendingImageJobs--;if(isCurrent()&&!saving&&pendingImageJobs===0)dialog.querySelector('#template-editor-save').disabled=false;};
 const redraw=()=>{
  if(active>=rows().length)active=rows().length-1;
  const c=config();
  openDialog(template?'编辑主机模板':'新增主机模板','<div class="template-edit"><label class="field">模板名称<input id="template-editor-name" value="'+esc(draft.name)+'" placeholder="输入模板名称"></label><div class="template-edit-workspace"><nav class="template-config-nav" aria-label="模板配置">'+rows().map((item,index)=>'<button type="button" data-template-config-select="'+index+'" class="'+(index===active?'active':'')+'">'+esc(templateConfigLabel(item))+'</button>').join('')+'<div class="template-edit-toolbar"><button type="button" id="template-editor-add-blank">＋ 空白配置</button><button type="button" id="template-editor-add-current" '+(current()?'':'disabled')+'>复制当前配置</button></div></nav><div class="template-edit-main"><div class="template-edit-heading"><strong>'+esc(templateConfigLabel(c))+'</strong><button type="button" data-template-remove-config '+(rows().length===1?'disabled':'')+'>移除本套</button></div><div class="template-edit-fields"><label>配置名<input data-template-config="'+active+'" data-template-field="name" value="'+esc(c.name||'')+'"></label><label>版本<input data-template-config="'+active+'" data-template-field="version" value="'+esc(c.version||'')+'"></label><label>售价<input data-template-config="'+active+'" data-template-field="price" type="number" min="0" step="0.01" value="'+esc(c.price??0)+'"></label></div><div class="tabs template-edit-tabs" role="tablist">'+[['parts','展示配件'],['actual','实际配置'],['addons','加购与选配'],['modules','图片模块'],['costs','成本核算']].map(([key,label])=>'<button type="button" role="tab" data-template-tab="'+key+'" aria-selected="'+(tab===key)+'" class="'+(tab===key?'active':'')+'">'+label+'</button>').join('')+'</div><div id="template-editor-parts" class="editor">'+tabContent()+'</div></div></div><div class="actions"><button type="button" id="template-editor-save" class="primary">保存模板</button></div></div>');
  dialog.dataset.templateEditorSession=sessionId;dialog.classList.add('template-editor-dialog');
  const root=dialog.querySelector('.template-edit'),query=selector=>root.querySelector(selector),all=selector=>[...root.querySelectorAll(selector)];
  query('#template-editor-save').disabled=saving||pendingImageJobs>0;
  query('#template-editor-name').oninput=event=>draft.name=event.target.value;
  all('[data-template-config]').forEach(input=>input.oninput=()=>{const field=input.dataset.templateField;c[field]=field==='price'?Number(input.value):input.value;});
  all('[data-template-config-select]').forEach(button=>button.onclick=()=>{active=Number(button.dataset.templateConfigSelect);redraw();});
  all('[data-template-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.templateTab;redraw();});
  query('[data-template-remove-config]').onclick=()=>{rows().splice(active,1);redraw();};
  query('#template-editor-add-blank').onclick=()=>{const fresh=blank();fresh.parts??=[];ensureActualParts(fresh);fresh.addons??=[];fresh.modules??=[];rows().push(fresh);active=rows().length-1;tab='parts';redraw();};
  query('#template-editor-add-current').onclick=()=>{const source=current();if(!source)return;const copy=clone(source);copy.id=crypto.randomUUID();copy.shopId=shopId;ensureActualParts(copy);rows().push(copy);active=rows().length-1;tab='parts';redraw();};
  if(tab==='parts'||tab==='actual'){
   const actual=tab==='actual',field=actual?'actualParts':'parts',parts=c[field];
   const sync=before=>{if(!actual)syncActualParts(c,before);};
   all('[data-template-part-search]').forEach(holder=>mountProductSearch(holder,{deferred:true,stableRows:true,getRows:()=>sourceRows,getCosts:()=>[],idKey:'sourceId',inputElement:holder.querySelector('input'),label:'搜索配件',placeholder:'输入名称或 ERP ID，点击结果替换',emptySelection:'',describe:row=>'ERP ID '+(row.goodsId||'未绑定'),onChange:row=>{if(!row)return;try{const index=Number(holder.dataset.templatePartSearch),before=clone(c.parts),target=actual?{...c,parts:c.actualParts,addons:[]}:c;replaceSourcePart(target,index,row);sync(before);redraw();}catch(error){toast(error.message);}}}));
   all('[data-template-display-name]').forEach(input=>input.onchange=()=>{const part=parts[Number(input.dataset.templateDisplayName)],name=input.value.trim();if(!name||name===part.name)delete part.displayName;else part.displayName=name;});
   all('[data-template-qty]').forEach(input=>input.oninput=()=>{const qty=Number(input.value);if(!Number.isInteger(qty)||qty<1){input.setCustomValidity('数量必须是正整数');return;}input.setCustomValidity('');const before=clone(c.parts);parts[Number(input.dataset.templateQty)].qty=qty;sync(before);});
   all('[data-template-visible]').forEach(input=>input.onchange=()=>{parts[Number(input.dataset.templateVisible)].posterVisible=input.checked;});
   all('[data-template-copy-part]').forEach(button=>button.onclick=()=>{const target=actual?{...c,parts:c.actualParts,addons:[]}:c;copiedPart=copyPartPayload(target,Number(button.dataset.templateCopyPart));redraw();toast('已复制配件，可切换配置后粘贴替换');});
   all('[data-template-paste-part]').forEach(button=>button.onclick=()=>{try{const index=Number(button.dataset.templatePastePart),before=clone(c.parts),target=clone(actual?{...c,parts:c.actualParts,addons:[]}:c);pastePartPayload(target,index,copiedPart,sourceRows);if(actual)c.actualParts=target.parts;else{c.parts=target.parts;c.addons=target.addons;}sync(before);redraw();}catch(error){toast(error.message);}});
   if(!actual)mountPartSort(query('#template-editor-parts'),(from,to)=>{parts.splice(to,0,parts.splice(from,1)[0]);redraw();});
   all('[data-template-remove-part]').forEach(button=>button.onclick=()=>{const before=clone(c.parts);parts.splice(Number(button.dataset.templateRemovePart),1);sync(before);redraw();});
   query('[data-template-add-part]').onclick=()=>{const slot=slots.find(name=>!parts.some(part=>part.slot===name));if(!slot)return toast('14 个 ERP 槽位已用完');const before=clone(c.parts);parts.push({slot,name:'',goodsId:'',qty:1,erp:null,tax:null,upgrade:''});sync(before);redraw();};
  }else if(tab==='addons'){
   all('[data-template-upgrade]').forEach(input=>input.oninput=()=>{const part=c.parts[Number(input.dataset.templateUpgrade)];part.upgrade=input.value;part.memoryUpgradeConfirmed=memoryUpgradeKey(part);});
   all('[data-template-memory-upgrade]').forEach(select=>select.onchange=()=>{const part=c.parts[Number(select.dataset.templateMemoryUpgrade)];if(select.value==='use')part.memoryUpgradeConfirmed=memoryUpgradeKey(part);else delete part.memoryUpgradeConfirmed;redraw();});
   all('[data-template-addon]').forEach(input=>input.oninput=()=>{c.addons[Number(input.dataset.templateAddon)][input.dataset.templateAddonField]=input.value;});
   all('[data-template-remove-addon]').forEach(button=>button.onclick=()=>{c.addons.splice(Number(button.dataset.templateRemoveAddon),1);redraw();});
   query('[data-template-add-addon]').onclick=()=>{c.addons.push({text:'',note:''});redraw();};
  }else if(tab==='modules'){
   all('[data-template-module]').forEach(input=>input.oninput=()=>{c.modules[Number(input.dataset.templateModule)][input.dataset.templateModuleField]=input.value;});
   all('[data-template-module-visible]').forEach(input=>input.onchange=()=>{c.modules[Number(input.dataset.templateModuleVisible)].visible=input.checked;});
   query('[data-template-clear-case]').onclick=()=>{c.caseImage='';redraw();};
   query('[data-template-gallery-case]').onchange=event=>{if(!event.target.value)return;c.caseImage=event.target.value;redraw();};
   query('[data-template-gallery-layer]').onchange=async event=>{const url=event.target.value,row=gallery.find(item=>item.url===url);if(!row)return;startImageJob();try{const size=await imageSize(url);if(!isCurrent()||!rows().includes(c))return;c.posterImages??=[];c.posterImages.push({id:crypto.randomUUID(),url,name:row.name||'图库图片',naturalWidth:size[0],naturalHeight:size[1],transforms:{}});redraw();}catch(error){if(isCurrent())toast(error.message);}finally{finishImageJob();}};
   query('[data-template-upload-case]').onchange=async event=>{const file=event.target.files?.[0];if(!file)return;startImageJob();try{const url=await uploadImage(file);if(!isCurrent()||!rows().includes(c))return;c.caseImage=url;redraw();}catch(error){if(isCurrent())toast(error.message);}finally{finishImageJob();}};
   query('[data-template-upload-layer]').onchange=async event=>{const file=event.target.files?.[0];if(!file)return;startImageJob();try{const url=await uploadImage(file),size=await imageSize(url);if(!isCurrent()||!rows().includes(c))return;c.posterImages??=[];c.posterImages.push({id:crypto.randomUUID(),url,name:file.name,naturalWidth:size[0],naturalHeight:size[1],transforms:{}});redraw();}catch(error){if(isCurrent())toast(error.message);}finally{finishImageJob();}};
   all('[data-template-remove-image]').forEach(button=>button.onclick=()=>{c.posterImages.splice(Number(button.dataset.templateRemoveImage),1);redraw();});
  }
  query('#template-editor-save').onclick=async()=>{
   if(saving)return;if(pendingImageJobs)return toast('图片正在处理中，请稍后保存');
   const invalid=root.querySelector('input:invalid');if(invalid){invalid.reportValidity();return;}
   const controls=[...dialog.querySelectorAll('input,textarea,select,button')],previous=controls.map(control=>control.disabled),button=query('#template-editor-save');
   saving=true;controls.forEach(control=>control.disabled=true);button.textContent='正在保存…';
   try{const valid=validateTemplateDraft(draft.name,rows(),shopId);draft.name=valid.name;await commit(draft);if(isCurrent())closeDialog();toast('模板“'+draft.name+'”已保存');}
   catch(error){if(isCurrent())toast(error.message);}
   finally{saving=false;controls.forEach((control,index)=>{if(control.isConnected)control.disabled=previous[index];});if(button.isConnected)button.textContent='保存模板';}
  };
 };
 redraw();
}
