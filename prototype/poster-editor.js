import {captureTextFormat,applyTextFormat} from './poster-format.js';
import {resizeRegion,snapRegion} from './poster-geometry.js';
import {getImage} from './poster.js';
import {posterImageRegion} from './poster-images.js';
const $=s=>document.querySelector(s);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const presets=['#132b50','#0068e8','#57bdff','#ffffff','#07172e','#ff7c36','#12b8b0'];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const inside=(r,p)=>r&&p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.top&&p.y<=r.top+r.height;
export function bindPosterEditor(api){
 let result=null,selected=null,configId=null,drag=null,refresh=false,moveFrame=null,pendingPoint=null,layerOptions='',textSelection=null,objectOptions='',spaceHeld=false;
 let saved=[];try{saved=JSON.parse(localStorage.getItem('diy-poster-colors-v1')||'[]').filter(c=>/^#[0-9a-f]{6}$/i.test(c)).slice(0,24);}catch{}
 const stage=$('#poster-stage'),box=$('#poster-selection'),inspector=$('#poster-inspector');
 let copiedFormat=null;const guideLayer=document.createElement('div');guideLayer.className='poster-guides';stage.append(guideLayer);
 const showGuides=guides=>{guideLayer.replaceChildren(...guides.map(g=>{const line=document.createElement('i');line.className='poster-guide-'+g.axis;line.style[g.axis==='x'?'left':'top']=g.position/(g.axis==='x'?result.base:result.height)*100+'%';return line;}));};
 const textRegion=()=>result?.textRegions.find(r=>r.key===selected);
 $('#poster-format-copy').onclick=()=>{const r=textRegion();if(!r)return api.toast('请先选中要复制格式的文字');copiedFormat=captureTextFormat(api.current(),r,result.density||1);$('#poster-format-paste').disabled=false;api.toast('已复制文字格式，选中目标文字后点击应用格式');};
 $('#poster-format-paste').onclick=()=>{if(!copiedFormat)return;const r=textRegion();if(!r)return api.toast('请选择目标文字');api.checkpoint();applyTextFormat(api.current(),selected,copiedFormat);refresh=true;api.changed('格式刷应用文字样式');};
 const currentLayer=()=>api.current()?.posterImages?.find(layer=>'poster-image:'+layer.id===selected);
 const currentRegion=()=>selected?.startsWith('module:')?result?.regions.find(r=>r.key===selected):selected==='case-image'?result?.imageRegion:result?.addedImageRegions?.find(r=>r.key===selected)||result?.textRegions.find(r=>r.key===selected);
 const isImage=()=>selected==='case-image'||!!currentLayer();
 function outline(){const r=currentRegion();box.classList.toggle('hidden',!r);if(!r)return;Object.assign(box.style,{left:r.x/result.base*100+'%',top:r.top/result.height*100+'%',width:r.width/result.base*100+'%',height:r.height/result.height*100+'%'});box.classList.toggle('text-selection',r.value!==undefined&&!r.isLogo&&!isImage()&&!selected?.startsWith('module:'));box.classList.toggle('image-selection',isImage());box.classList.toggle('module-selection',selected?.startsWith('module:'));$('#poster-selection-label').textContent=r.label||(selected==='case-image'?'机箱图片':currentLayer()?.name||'图片');}
 function select(key){textSelection=null;selected=key;if(key)$('#poster-pick-mode').value=key.startsWith('module:')?'modules':'objects';$('#poster-object-select').value=key||'';$('#poster-image-select').value=currentLayer()?key:'';paint();outline();}
 function changeStyle(key,value){const c=api.current();c.textStyles??={};c.textStyles[selected]??={};if(textSelection&&['size','weight','color','fontFamily','italic'].includes(key)){c.textStyles[selected].ranges??=[];c.textStyles[selected].ranges.push({...textSelection,style:{[key]:value}});}else c.textStyles[selected][key]=value;api.changed('调整预览文字样式');}
 function swatches(){return [...new Set([...presets,...saved])].map(c=>`<button type="button" class="color-swatch" data-swatch="${c}" style="--swatch:${c}" aria-label="使用颜色 ${c}" title="${c}"></button>`).join('');}
 function paint(){const r=currentRegion();inspector.classList.toggle('hidden',!r);if(!r)return;
  if(selected?.startsWith('module:')){
   inspector.innerHTML=`<div class="inspector-title"><strong>${esc(r.label)} · 整个模块</strong><button id="inspector-close" aria-label="收起编辑">×</button></div><p class="hint">拖动移动整个模块；拖动角点等比例缩放，按住 Shift 可分别调整宽高。</p><div class="inspector-grid">${[['x','水平位置',r.x],['y','垂直位置',r.top],['width','宽度',r.width],['height','高度',r.height]].map(([key,label,value])=>`<label class="field">${label}<input data-free-module="${key}" type="number" value="${Math.round(value)}"></label>`).join('')}</div><button id="free-module-reset">恢复模块位置与大小</button>`;
   inspector.querySelectorAll('[data-free-module]').forEach(input=>{input.onfocus=api.checkpoint;input.oninput=()=>{if(input.value===''||!Number.isFinite(Number(input.value)))return;const current=currentRegion();setModule({x:current.x,top:current.top,width:current.width,height:current.height,[input.dataset.freeModule==='y'?'top':input.dataset.freeModule]:Number(input.value)});};});
   $('#free-module-reset').onclick=()=>{api.checkpoint();delete api.current().moduleTransforms?.[api.current().layout]?.[r.id];refresh=true;api.changed('恢复模块位置与大小');};
  }else if(selected==='case-image'){
   inspector.innerHTML=`<div class="inspector-title"><strong>机箱图片</strong><button id="inspector-close" aria-label="收起编辑">×</button></div><p class="hint">拖动图片移动，拖动四角等比例缩放，按住 Shift 可分别调整宽高；其他文字位置保持不变。</p><label class="field">图片大小 <span id="case-size-value">${Math.round(r.width)} × ${Math.round(r.height)} px</span><input id="case-size" type="range" min="45" max="${Math.min(result.base,result.height)}" value="${r.size}"></label><div class="inspector-grid"><label class="field">水平位置<input id="case-x" type="number" min="0" value="${Math.round(r.x)}"></label><label class="field">垂直位置<input id="case-y" type="number" min="0" value="${Math.round(r.top)}"></label></div><button id="case-reset">重置位置与大小</button>`;
   const edit=values=>{const old=result.imageRegion;setImage({...old,y:old.top,...values,...(values.size?{width:old.width*values.size/old.size,height:old.height*values.size/old.size}:{})});};
   for(const id of ['case-size','case-x','case-y']){$('#'+id).onpointerdown=api.checkpoint;$('#'+id).onfocus=api.checkpoint;$('#'+id).oninput=e=>{if(e.target.value==='')return;const key=id==='case-size'?'size':id.slice(5);edit({[key]:Number(e.target.value)});};}
   $('#case-reset').onclick=()=>{api.checkpoint();const c=api.current();if(c.caseTransforms)delete c.caseTransforms[c.layout];refresh=true;api.changed('重置机箱图位置');};
  }else if(currentLayer()){
   const layer=currentLayer();
   inspector.innerHTML=`<div class="inspector-title"><strong>添加的图片</strong><button id="inspector-close" aria-label="收起编辑">×</button></div><p class="hint">${esc(layer.name)} · 拖动图片移动，拖动四角等比例缩放，按住 Shift 可分别调整宽高。</p><label class="field">图片宽度 <span id="poster-image-size-value">${Math.round(r.width)} × ${Math.round(r.height)} px</span><input id="poster-image-size" type="range" min="${r.minWidth}" max="${r.maxWidth}" step="any" value="${r.width}"></label><div class="inspector-grid"><label class="field">水平位置<input id="poster-image-x" type="number" min="0" max="${result.base-r.width}" value="${Math.round(r.x)}"></label><label class="field">垂直位置<input id="poster-image-y" type="number" min="0" max="${result.height-r.height}" value="${Math.round(r.top)}"></label></div><div class="row-tools"><button id="poster-image-front">置于顶层</button><button id="poster-image-remove">移除图片</button></div>`;
   for(const [id,key] of [['poster-image-size','width'],['poster-image-x','x'],['poster-image-y','y']]){const input=$('#'+id);input.onpointerdown=api.checkpoint;input.onfocus=api.checkpoint;input.oninput=()=>{if(input.value===''||!Number.isFinite(Number(input.value)))return;const region=currentRegion();setAddedImage({x:region.x,y:region.top,width:region.width,height:region.height,[key]:Number(input.value)});};input.onblur=()=>{const current=currentLayer();if(!current)return;const region=posterImageRegion(current,api.current().layout,result.base,result.height);input.value=Math.round(key==='y'?region.top:region[key]);};}
   $('#poster-image-front').onclick=()=>{const layers=api.current().posterImages;if(layers.at(-1)===layer)return;api.checkpoint();layers.splice(layers.indexOf(layer),1);layers.push(layer);api.changed('图片置于顶层');};
   $('#poster-image-remove').onclick=()=>{api.checkpoint();const c=api.current();c.posterImages=c.posterImages.filter(item=>item.id!==layer.id);selected=null;paint();outline();api.changed('移除添加的图片');};
  }else{
   const c=api.current(),module=c.modules?.find(m=>m.id===r.moduleId),s=c.textStyles?.[selected]||{},size=s.size||Math.round(r.styleSize??r.size/(result.density||1));
   inspector.innerHTML=`<div class="inspector-title"><strong>${esc(r.label)}</strong><button id="inspector-close" aria-label="收起编辑">×</button></div>${module?.type==='service'?`<label class="field">服务承诺文字<textarea id="service-text">${esc(module.text||'')}</textarea></label><label class="field">背景色<input id="service-background" type="color" value="${module.background||'#173e76'}"></label>`:''}<div class="inspector-grid"><label class="field">字体<select id="text-font">${['Microsoft YaHei','SimHei','SimSun','Segoe UI'].map(f=>`<option ${(s.fontFamily||r.fontFamily)===f?'selected':''}>${f}</option>`).join('')}</select></label><label class="field">字号<input id="text-size" type="number" min="8" max="72" value="${size}"></label><label class="field">字重<select id="text-weight">${[400,500,600,700,800].map(w=>`<option value="${w}" ${(s.weight||r.weight)===w?'selected':''}>${w===400?'常规':w===700?'加粗':w}</option>`).join('')}</select></label><label class="field">文字颜色<input id="text-color" type="color" value="${esc(s.color||r.color)}"></label></div><div class="row-tools"><label><input id="text-italic" type="checkbox" ${(s.italic??r.italic)?'checked':''}> 斜体</label><button id="text-reset">恢复模块样式</button></div><div class="color-presets" aria-label="预选及保存的颜色">${swatches()}</div><button id="save-text-color">保存当前颜色</button><small class="hint">颜色保存在本机浏览器，可跨配置使用。</small>`;
   if(r.value!==undefined){
    const controls=document.createElement('div');controls.innerHTML=`<p class="hint">拖动方框移动文字；拉动四边或四角调整文本框，字号保持不变。文字自动换行，高度不足时自动撑开。</p><label class="field">文字内容（选中其中一段再改字号或颜色）<textarea id="poster-text-content">${esc(r.value)}</textarea></label><small id="text-range-status" class="hint">当前修改整段文字</small><div class="inspector-grid">${[['x','水平位置',r.x],['y','垂直位置',r.top],['width','文本框宽度',r.width],['height','文本框高度',r.height]].map(([key,label,value])=>`<label class="field">${label}<input data-text-position="${key}" type="number" value="${Math.round(value)}"></label>`).join('')}</div>`;
    inspector.querySelector('.inspector-title').after(controls);const input=$('#poster-text-content');input.onfocus=api.checkpoint;
    input.onselect=()=>{textSelection=input.selectionEnd>input.selectionStart?{start:input.selectionStart,end:input.selectionEnd}:null;$('#text-range-status').textContent=textSelection?'正在修改选中文字':'当前修改整段文字';};
    input.oninput=()=>{textSelection=null;c.textStyles??={};c.textStyles[selected]??={};c.textStyles[selected].text=input.value;delete c.textStyles[selected].ranges;api.changed('编辑图片文字');};
    controls.querySelectorAll('[data-text-position]').forEach(input=>{input.onfocus=api.checkpoint;input.oninput=()=>{if(input.value!==''&&Number.isFinite(Number(input.value))){const key=input.dataset.textPosition;if(key==='width'||key==='height'){const r=currentRegion();setTextBox({...r,[key]:Number(input.value)},r);}else{const r=currentRegion();setText({x:r.x,top:r.top,width:r.width,height:r.height,[key==='y'?'top':'x']:Number(input.value)},r);}};};});
   }
   const moduleRegion=result.regions.find(item=>item.id===r.moduleId);
   if(moduleRegion){const controls=document.createElement('details');controls.innerHTML=`<summary>所在模块的位置与大小</summary><div class="inspector-grid">${[['x','模块水平位置',moduleRegion.x],['y','模块垂直位置',moduleRegion.top],['width','模块宽度',moduleRegion.width],['height','模块高度',moduleRegion.height]].map(([key,label,value])=>`<label class="field">${label}<input data-module-position="${key}" type="number" value="${Math.round(value)}"></label>`).join('')}</div><button id="module-position-reset">恢复模块布局</button>`;inspector.append(controls);
    controls.querySelectorAll('input').forEach(input=>{input.onfocus=api.checkpoint;input.oninput=()=>{if(input.value===''||!Number.isFinite(Number(input.value)))return;c.moduleTransforms??={};c.moduleTransforms[c.layout]??={};c.moduleTransforms[c.layout][r.moduleId]??={};c.moduleTransforms[c.layout][r.moduleId][input.dataset.modulePosition]=Number(input.value);api.changed('调整模块位置与大小');};});
    $('#module-position-reset').onclick=()=>{api.checkpoint();delete c.moduleTransforms?.[c.layout]?.[r.moduleId];refresh=true;api.changed('恢复模块布局');};
   }
   if(module?.type==='service'){for(const [id,key] of [['service-text','text'],['service-background','background']]){const el=$('#'+id);el.onfocus=api.checkpoint;el.oninput=()=>{module[key]=el.value;api.changed('编辑服务承诺');};}}
   const fields={'text-font':'fontFamily','text-size':'size','text-weight':'weight','text-color':'color','text-italic':'italic'};
   for(const [id,key] of Object.entries(fields)){const el=$('#'+id);el.onfocus=api.checkpoint;el.oninput=()=>{if(key==='size'&&el.value==='')return;const v=key==='italic'?el.checked:key==='size'?clamp(Number(el.value),8,72):key==='weight'?Number(el.value):el.value;changeStyle(key,v);};}
   inspector.querySelectorAll('[data-swatch]').forEach(b=>b.onclick=()=>{api.checkpoint();$('#text-color').value=b.dataset.swatch;changeStyle('color',b.dataset.swatch);});
   $('#text-reset').onclick=()=>{api.checkpoint();if(c.textStyles)delete c.textStyles[selected];delete c.textTransforms?.[c.layout]?.[selected];refresh=true;api.changed('恢复文字模块样式');};
   $('#save-text-color').onclick=()=>{const color=$('#text-color').value;if(!saved.includes(color))saved.push(color);saved=saved.slice(-24);try{localStorage.setItem('diy-poster-colors-v1',JSON.stringify(saved));paint();api.toast('颜色已保存');}catch{api.toast('浏览器未允许保存颜色');}};
  }
  $('#inspector-close').onclick=()=>{selected=null;paint();outline();};
 }
 function setImage(value){const size=clamp(value.size||result.imageRegion.size,45,Math.min(result.base,result.height)),width=clamp(value.width||size,45,result.base),height=clamp(value.height||size,45,result.height),x=clamp(value.x,0,result.base-width),y=clamp(value.y,0,result.height-height),c=api.current();c.caseTransforms??={};c.caseTransforms[c.layout]={x,y,size,width,height};if($('#case-size-value'))$('#case-size-value').textContent=Math.round(width)+' × '+Math.round(height)+' px';for(const [id,v] of [['case-size',size],['case-x',x],['case-y',y]])if($('#'+id)&&document.activeElement!==$('#'+id))$('#'+id).value=Math.round(v);(api.imageChanged||api.changed)('移动或缩放机箱图');}
 function setAddedImage(value){const layer=currentLayer();if(!layer)return;const c=api.current(),r=posterImageRegion(layer,c.layout,result.base,result.height,value);layer.transforms??={};layer.transforms[c.layout]={x:r.x,y:r.top,width:r.width,height:r.height};if($('#poster-image-size-value'))$('#poster-image-size-value').textContent=`${Math.round(r.width)} × ${Math.round(r.height)} px`;for(const [id,v] of [['poster-image-size',r.width],['poster-image-x',r.x],['poster-image-y',r.top]])if($('#'+id)&&document.activeElement!==$('#'+id))$('#'+id).value=Math.round(v);if($('#poster-image-x'))$('#poster-image-x').max=result.base-r.width;if($('#poster-image-y'))$('#poster-image-y').max=result.height-r.height;(api.imageChanged||api.changed)('移动或缩放添加的图片');}
 $('#poster-add-image').onclick=()=>{
  const target=api.current();if(!target)return;
  api.openDialog('添加图片','<p class="hint">添加为独立图片，可拖动、缩放，不替换当前机箱图。本地可一次选择多张。</p><div class="actions"><button id="poster-image-local" class="primary">从本地导入</button><button id="poster-image-gallery">从机箱图库选择</button></div>');
  $('#poster-image-local').onclick=()=>{api.closeDialog();$('#poster-image-file').click();};
  $('#poster-image-gallery').onclick=()=>api.pickGallery(async row=>{
   const image=await getImage(row.url);if(!image)throw Error('图片无法载入');if(api.current()!==target)throw Error('当前配置已变化，请重新添加');
   api.checkpoint();target.posterImages??=[];const layer={id:crypto.randomUUID(),url:row.url,name:row.name,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,transforms:{}};target.posterImages.push(layer);selected='poster-image:'+layer.id;refresh=true;api.changed('从机箱图库添加图片');
  });
 };
 $('#poster-image-file').onchange=async e=>{
  const files=[...e.target.files],c=api.current();e.target.value='';if(!files.length||!c)return;
  const button=$('#poster-add-image');button.disabled=true;button.textContent='添加中…';
  try{
   const layers=[],failed=[];
   for(const file of files){try{const url=await api.uploadImage(file),image=await getImage(url);layers.push({id:crypto.randomUUID(),url,name:file.name,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,transforms:{}});}catch(error){failed.push(`${file.name}：${error.message}`);}}
   if(api.current()!==c){api.toast('当前配置已切换或撤销，请在需要的配置中重新添加图片');return;}
   if(layers.length){api.checkpoint();c.posterImages??=[];c.posterImages.push(...layers);selected='poster-image:'+layers.at(-1).id;refresh=true;api.changed('添加图片');}
   api.toast([layers.length?`已添加 ${layers.length} 张图片，位于最上层，可拖动和缩放`:'',...failed].filter(Boolean).join('；'));
  }finally{button.disabled=false;button.textContent='添加图片';}
 };
 $('#poster-image-select').onchange=e=>{select(e.target.value||null);stage.focus({preventScroll:true});};
 function freezeLayout(){const c=api.current();c.freeCanvasLayouts??={};c.freeCanvasLayouts[c.layout]??={height:result.height,density:result.density,stretch:result.stretch||0,base:result.base,autoWidth:result.autoWidth,tightRows:result.tightRows,unifiedPanel:result.unifiedPanel,compact:result.compact,centeredHeader:result.centeredHeader,titleUnderLogo:result.titleUnderLogo};}
 function setModule(value){const c=api.current(),r=currentRegion();if(!r)return;freezeLayout();const width=clamp(value.width,40,result.base),height=clamp(value.height,20,result.height);c.moduleTransforms??={};c.moduleTransforms[c.layout]??={};c.moduleTransforms[c.layout][r.id]={x:clamp(value.x,0,result.base-width),y:clamp(value.top,0,result.height-height),width,height};(api.transformChanged||api.changed)('移动或缩放整个模块');}
 function setText(value,origin=currentRegion()){
  if(!origin?.parent)return;freezeLayout();const c=api.current(),parent=origin.parent,baseModule=origin.moduleOrigin;
  const scaleX=clamp(origin.local.scaleX*value.width/origin.width,.1,12),scaleY=clamp(origin.local.scaleY*value.height/origin.height,.1,12),width=origin.width*scaleX/origin.local.scaleX,height=origin.height*scaleY/origin.local.scaleY;
  const x=clamp(value.x,0,Math.max(0,result.base-width)),top=clamp(value.top,0,Math.max(0,result.height-height));
  c.textTransforms??={};c.textTransforms[c.layout]??={};c.textTransforms[c.layout][selected]={...c.textTransforms[c.layout][selected],x:baseModule.x+(x-parent.x)/parent.sx,y:baseModule.top+(top-parent.top)/parent.sy,scaleX,scaleY};
  (api.transformChanged||api.changed)('移动或缩放文字');
 }
 function setTextBox(value,origin=currentRegion()){
  if(!origin?.parent||origin.isLogo)return;freezeLayout();const c=api.current(),parent=origin.parent,baseModule=origin.moduleOrigin;
  const width=clamp(value.width,20,result.base),height=clamp(value.height,12,result.height),x=clamp(value.x,0,result.base-width),top=clamp(value.top,0,result.height-height);
  c.textTransforms??={};c.textTransforms[c.layout]??={};
  c.textTransforms[c.layout][selected]={...c.textTransforms[c.layout][selected],x:baseModule.x+(x-parent.x)/parent.sx,y:baseModule.top+(top-parent.top)/parent.sy,scaleX:origin.local.scaleX,scaleY:origin.local.scaleY,boxWidth:width/parent.sx/origin.local.scaleX,boxHeight:height/parent.sy/origin.local.scaleY};
  api.changed('调整文本框大小与换行');
 }
 $('#poster-undo').onclick=()=>$('#undo').click();$('#poster-redo').onclick=()=>$('#redo').click();
 $('#poster-auto-layout').onclick=()=>{api.checkpoint();const c=api.current();delete c.textTransforms?.[c.layout];delete c.moduleTransforms?.[c.layout];delete c.freeCanvasLayouts?.[c.layout];delete c.caseTransforms?.[c.layout];for(const style of Object.values(c.textStyles||{})){delete style.x;delete style.y;delete style.width;}selected=null;refresh=true;paint();outline();api.changed('恢复文字、模块与机箱自动排版');};
 const scroll=$('#preview-scroll');
 const zoom=()=>{const value=$('#poster-zoom').value;stage.style.width=value==='fit'?'100%':`${700*Number(value)/100}px`;stage.style.maxWidth=value==='fit'?'700px':'none';};
 $('#poster-zoom').onchange=zoom;zoom();
 scroll.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();const values=[50,75,100,125,150,200],current=$('#poster-zoom').value;let index=current==='fit'?2:values.indexOf(Number(current));index=clamp(index+(e.deltaY<0?1:-1),0,values.length-1);$('#poster-zoom').value=values[index];zoom();},{passive:false});
 $('#poster-pick-mode').onchange=()=>{select(null);};
 $('#poster-object-select').onchange=e=>{select(e.target.value||null);stage.focus({preventScroll:true});};
 function point(e){const rect=$('#poster').getBoundingClientRect();return{x:(e.clientX-rect.left)/rect.width*result.base,y:(e.clientY-rect.top)/rect.height*result.height};}
 stage.onpointerdown=e=>{
  if(!result||![0,1].includes(e.button))return;
  if(e.button===1||spaceHeld){drag={pan:true,start:{x:e.clientX,y:e.clientY},left:scroll.scrollLeft,top:scroll.scrollTop};}
  else{
   const p=point(e),corner=e.target.closest('[data-resize]')?.dataset.resize;
   const hit=corner?currentRegion():inside(currentRegion(),p)?currentRegion():$('#poster-pick-mode').value==='modules'?[...result.regions].reverse().find(r=>inside(r,p)):[...(result.addedImageRegions||[])].reverse().find(r=>inside(r,p))||(inside(result.imageRegion,p)?result.imageRegion:null)||[...result.textRegions].reverse().find(r=>inside(r,p));
   if(!hit){select(null);return;}select(hit.key);api.checkpoint();const rect=$('#poster').getBoundingClientRect();
   drag={start:{x:e.clientX,y:e.clientY},region:structuredClone(hit),corner,factor:result.base/rect.width};
  }
  stage.focus({preventScroll:true});stage.setPointerCapture(e.pointerId);stage.classList.add('is-dragging');e.preventDefault();
 };
 function applyMove(){moveFrame=null;const p=pendingPoint;pendingPoint=null;if(!drag||!result||!p)return;
  if(drag.pan){scroll.scrollLeft=drag.left-(p.x-drag.start.x);scroll.scrollTop=drag.top-(p.y-drag.start.y);return;}
  const dx=(p.x-drag.start.x)*drag.factor,dy=(p.y-drag.start.y)*drag.factor,r=drag.region;
  if(Math.abs(dx)+Math.abs(dy)<.5&&!drag.moved)return;drag.moved=true;
  const textBox=r.value!==undefined&&!r.isLogo&&!r.key.startsWith('module:');
  let value=drag.corner?resizeRegion(r,dx,dy,drag.corner,result.base,result.height,!textBox&&!p.shift):{...r,x:r.x+dx,top:r.top+dy};
  if(!drag.corner&&$('#poster-snap').checked){const peers=r.key.startsWith('module:')?result.regions:[...result.textRegions,...result.addedImageRegions,...(result.imageRegion?[result.imageRegion]:[])];const snapped=snapRegion(value,peers.filter(item=>item.key!==r.key),result.base,result.height,6*drag.factor);value=snapped.value;showGuides(snapped.guides);}else showGuides([]);
  if(r.key==='case-image')setImage({x:value.x,y:value.top,size:r.size,width:value.width,height:value.height});
  else if(r.key.startsWith('poster-image:'))setAddedImage({x:value.x,y:value.top,width:value.width,height:value.height});
  else if(r.key.startsWith('module:'))setModule(value);else if(drag.corner&&textBox)setTextBox(value,r);else setText(value,r);
 }
 stage.onpointermove=e=>{if(!drag||!result)return;pendingPoint={x:e.clientX,y:e.clientY,shift:e.shiftKey};if(moveFrame===null)moveFrame=requestAnimationFrame(applyMove);};
 const finish=e=>{if(moveFrame!==null)cancelAnimationFrame(moveFrame);applyMove();const wasDrag=drag;drag=null;showGuides([]);stage.classList.remove('is-dragging');if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);if(wasDrag&&!wasDrag.pan)paint();};stage.onpointerup=finish;stage.onpointercancel=finish;
 stage.onkeydown=e=>{
  if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();((e.key.toLowerCase()==='y'||e.shiftKey)?$('#redo'):$('#undo')).click();return;}
  if(e.code==='Space'){spaceHeld=true;e.preventDefault();return;}
  if(e.key==='Escape'&&selected){select(null);e.stopPropagation();return;}
  if(!selected||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
  e.preventDefault();api.checkpoint();const r=currentRegion(),step=e.shiftKey?10:1;if(!r)return;
  const value={...r,x:r.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),top:r.top+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)};
  if(selected==='case-image')setImage({...value,y:value.top,size:r.size});else if(currentLayer())setAddedImage({...value,y:value.top});else if(selected.startsWith('module:'))setModule(value);else setText(value,r);paint();
 };
 window.addEventListener('keyup',e=>{if(e.code==='Space')spaceHeld=false;});window.addEventListener('blur',()=>{spaceHeld=false;cancelMove();});
 function cancelMove(){if(moveFrame!==null)cancelAnimationFrame(moveFrame);moveFrame=null;pendingPoint=null;drag=null;showGuides([]);stage.classList.remove('is-dragging');}
 return{render(next){result=next;if(configId!==api.current()?.id){selected=null;cancelMove();configId=api.current()?.id;paint();}if(selected&&!currentRegion()){selected=null;paint();}if(refresh){refresh=false;paint();}const layers=api.current()?.posterImages||[];$('#poster-layer-control').classList.toggle('hidden',!layers.length);const options='<option value="">选择添加的图片</option>'+[...layers].reverse().map((layer,i)=>`<option value="poster-image:${esc(layer.id)}">${i===0?'最上层 · ':''}${esc(layer.name)}</option>`).join('');if(options!==layerOptions){$('#poster-image-select').innerHTML=options;layerOptions=options;}$('#poster-image-select').value=currentLayer()?selected:'';
 const objects=[...next.textRegions,...(next.imageRegion?[{...next.imageRegion,label:'机箱图片'}]:[]),...next.addedImageRegions.map(r=>({...r,label:layers.find(l=>l.id===r.id)?.name||'图片'})),...next.regions.map(r=>({...r,label:'整个模块 · '+r.label}))];
 const menu='<option value="">选择画布对象</option>'+objects.map(r=>`<option value="${esc(r.key)}">${esc(r.label)}</option>`).join('');if(menu!==objectOptions){$('#poster-object-select').innerHTML=menu;objectOptions=menu;}$('#poster-object-select').value=selected||'';outline();},clear(){selected=null;cancelMove();paint();outline();}};
}
