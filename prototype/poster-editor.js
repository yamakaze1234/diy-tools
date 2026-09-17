import {getImage} from './poster.js';
import {posterImageRegion} from './poster-images.js';
const $=s=>document.querySelector(s);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const presets=['#132b50','#0068e8','#57bdff','#ffffff','#07172e','#ff7c36','#12b8b0'];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const inside=(r,p)=>r&&p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.top&&p.y<=r.top+r.height;
export function bindPosterEditor(api){
 let result=null,selected=null,configId=null,drag=null,refresh=false,moveFrame=null,pendingPoint=null,layerOptions='';
 let saved=[];try{saved=JSON.parse(localStorage.getItem('diy-poster-colors-v1')||'[]').filter(c=>/^#[0-9a-f]{6}$/i.test(c)).slice(0,24);}catch{}
 const stage=$('#poster-stage'),box=$('#poster-selection'),inspector=$('#poster-inspector');
 const currentLayer=()=>api.current()?.posterImages?.find(layer=>'poster-image:'+layer.id===selected);
 const currentRegion=()=>selected==='case-image'?result?.imageRegion:result?.addedImageRegions?.find(r=>r.key===selected)||result?.textRegions.find(r=>r.key===selected);
 const isImage=()=>selected==='case-image'||!!currentLayer();
 function outline(){const r=currentRegion();box.classList.toggle('hidden',!r);if(!r)return;Object.assign(box.style,{left:r.x/result.base*100+'%',top:r.top/result.height*100+'%',width:r.width/result.base*100+'%',height:r.height/result.height*100+'%'});$('#case-resize-handle').classList.toggle('hidden',!isImage());box.classList.toggle('image-selection',isImage());}
 function select(key){selected=key;$('#poster-image-select').value=currentLayer()?key:'';paint();outline();}
 function changeStyle(key,value){const c=api.current();c.textStyles??={};c.textStyles[selected]??={};c.textStyles[selected][key]=value;api.changed('调整预览文字样式');}
 function swatches(){return [...new Set([...presets,...saved])].map(c=>`<button type="button" class="color-swatch" data-swatch="${c}" style="--swatch:${c}" aria-label="使用颜色 ${c}" title="${c}"></button>`).join('');}
 function paint(){const r=currentRegion();inspector.classList.toggle('hidden',!r);if(!r)return;
  if(selected==='case-image'){
   inspector.innerHTML=`<div class="inspector-title"><strong>机箱图片</strong><button id="inspector-close" aria-label="收起编辑">×</button></div><p class="hint">拖动图片移动，拖动右下角方块缩放；其他文字位置保持不变。</p><label class="field">图片大小 <span id="case-size-value">${Math.round(r.size)} px</span><input id="case-size" type="range" min="45" max="400" value="${r.size}"></label><div class="inspector-grid"><label class="field">水平位置<input id="case-x" type="number" min="0" value="${Math.round(r.x)}"></label><label class="field">垂直位置<input id="case-y" type="number" min="0" value="${Math.round(r.top)}"></label></div><button id="case-reset">重置位置与大小</button>`;
   const edit=values=>{const old=result.imageRegion;setImage({...old,y:old.top,...values});};
   for(const id of ['case-size','case-x','case-y']){$('#'+id).onpointerdown=api.checkpoint;$('#'+id).onfocus=api.checkpoint;$('#'+id).oninput=e=>{if(e.target.value==='')return;const key=id==='case-size'?'size':id.slice(5);edit({[key]:Number(e.target.value)});};}
   $('#case-reset').onclick=()=>{api.checkpoint();const c=api.current();if(c.caseTransforms)delete c.caseTransforms[c.layout];refresh=true;api.changed('重置机箱图位置');};
  }else if(currentLayer()){
   const layer=currentLayer();
   inspector.innerHTML=`<div class="inspector-title"><strong>添加的图片</strong><button id="inspector-close" aria-label="收起编辑">×</button></div><p class="hint">${esc(layer.name)} · 拖动图片移动，拖动右下角方块等比例缩放。</p><label class="field">图片宽度 <span id="poster-image-size-value">${Math.round(r.width)} × ${Math.round(r.height)} px</span><input id="poster-image-size" type="range" min="${r.minWidth}" max="${r.maxWidth}" step="any" value="${r.width}"></label><div class="inspector-grid"><label class="field">水平位置<input id="poster-image-x" type="number" min="0" max="${result.base-r.width}" value="${Math.round(r.x)}"></label><label class="field">垂直位置<input id="poster-image-y" type="number" min="0" max="${result.height-r.height}" value="${Math.round(r.top)}"></label></div><div class="row-tools"><button id="poster-image-front">置于顶层</button><button id="poster-image-remove">移除图片</button></div>`;
   for(const [id,key] of [['poster-image-size','width'],['poster-image-x','x'],['poster-image-y','y']]){const input=$('#'+id);input.onpointerdown=api.checkpoint;input.onfocus=api.checkpoint;input.oninput=()=>{if(input.value===''||!Number.isFinite(Number(input.value)))return;const region=currentRegion();setAddedImage({x:region.x,y:region.top,width:region.width,[key]:Number(input.value)});};input.onblur=()=>{const current=currentLayer();if(!current)return;const region=posterImageRegion(current,api.current().layout,result.base,result.height);input.value=Math.round(key==='y'?region.top:region[key]);};}
   $('#poster-image-front').onclick=()=>{const layers=api.current().posterImages;if(layers.at(-1)===layer)return;api.checkpoint();layers.splice(layers.indexOf(layer),1);layers.push(layer);api.changed('图片置于顶层');};
   $('#poster-image-remove').onclick=()=>{api.checkpoint();const c=api.current();c.posterImages=c.posterImages.filter(item=>item.id!==layer.id);selected=null;paint();outline();api.changed('移除添加的图片');};
  }else{
   const c=api.current(),module=c.modules?.find(m=>m.id===r.moduleId),s=c.textStyles?.[selected]||{},size=s.size||Math.round(r.size/(result.density||1));
   inspector.innerHTML=`<div class="inspector-title"><strong>${esc(r.label)}</strong><button id="inspector-close" aria-label="收起编辑">×</button></div>${module?.type==='service'?`<label class="field">服务承诺文字<textarea id="service-text">${esc(module.text||'')}</textarea></label><label class="field">背景色<input id="service-background" type="color" value="${module.background||'#173e76'}"></label>`:''}<div class="inspector-grid"><label class="field">字体<select id="text-font">${['Microsoft YaHei','SimHei','SimSun','Segoe UI'].map(f=>`<option ${(s.fontFamily||r.fontFamily)===f?'selected':''}>${f}</option>`).join('')}</select></label><label class="field">字号<input id="text-size" type="number" min="8" max="72" value="${size}"></label><label class="field">字重<select id="text-weight">${[400,500,600,700,800].map(w=>`<option value="${w}" ${(s.weight||r.weight)===w?'selected':''}>${w===400?'常规':w===700?'加粗':w}</option>`).join('')}</select></label><label class="field">文字颜色<input id="text-color" type="color" value="${esc(s.color||r.color)}"></label></div><div class="row-tools"><label><input id="text-italic" type="checkbox" ${(s.italic??r.italic)?'checked':''}> 斜体</label><button id="text-reset">恢复模块样式</button></div><div class="color-presets" aria-label="预选及保存的颜色">${swatches()}</div><button id="save-text-color">保存当前颜色</button><small class="hint">颜色保存在本机浏览器，可跨配置使用。</small>`;
   if(module?.type==='service'){for(const [id,key] of [['service-text','text'],['service-background','background']]){const el=$('#'+id);el.onfocus=api.checkpoint;el.oninput=()=>{module[key]=el.value;api.changed('编辑服务承诺');};}}
   const fields={'text-font':'fontFamily','text-size':'size','text-weight':'weight','text-color':'color','text-italic':'italic'};
   for(const [id,key] of Object.entries(fields)){const el=$('#'+id);el.onfocus=api.checkpoint;el.oninput=()=>{if(key==='size'&&el.value==='')return;const v=key==='italic'?el.checked:key==='size'?clamp(Number(el.value),8,72):key==='weight'?Number(el.value):el.value;changeStyle(key,v);};}
   inspector.querySelectorAll('[data-swatch]').forEach(b=>b.onclick=()=>{api.checkpoint();$('#text-color').value=b.dataset.swatch;changeStyle('color',b.dataset.swatch);});
   $('#text-reset').onclick=()=>{api.checkpoint();if(c.textStyles)delete c.textStyles[selected];refresh=true;api.changed('恢复文字模块样式');};
   $('#save-text-color').onclick=()=>{const color=$('#text-color').value;if(!saved.includes(color))saved.push(color);saved=saved.slice(-24);try{localStorage.setItem('diy-poster-colors-v1',JSON.stringify(saved));paint();api.toast('颜色已保存');}catch{api.toast('浏览器未允许保存颜色');}};
  }
  $('#inspector-close').onclick=()=>{selected=null;paint();outline();};
 }
 function setImage(value){const size=clamp(value.size,45,400),x=clamp(value.x,0,result.base-size),y=clamp(value.y,0,result.height-size),c=api.current();c.caseTransforms??={};c.caseTransforms[c.layout]={x,y,size};if($('#case-size-value'))$('#case-size-value').textContent=Math.round(size)+' px';for(const [id,v] of [['case-size',size],['case-x',x],['case-y',y]])if($('#'+id)&&document.activeElement!==$('#'+id))$('#'+id).value=Math.round(v);(api.imageChanged||api.changed)('移动或缩放机箱图');}
 function setAddedImage(value){const layer=currentLayer();if(!layer)return;const c=api.current(),r=posterImageRegion(layer,c.layout,result.base,result.height,value);layer.transforms??={};layer.transforms[c.layout]={x:r.x,y:r.top,width:r.width};if($('#poster-image-size-value'))$('#poster-image-size-value').textContent=`${Math.round(r.width)} × ${Math.round(r.height)} px`;for(const [id,v] of [['poster-image-size',r.width],['poster-image-x',r.x],['poster-image-y',r.top]])if($('#'+id)&&document.activeElement!==$('#'+id))$('#'+id).value=Math.round(v);if($('#poster-image-x'))$('#poster-image-x').max=result.base-r.width;if($('#poster-image-y'))$('#poster-image-y').max=result.height-r.height;(api.imageChanged||api.changed)('移动或缩放添加的图片');}
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
 function point(e){const rect=$('#poster').getBoundingClientRect();return{x:(e.clientX-rect.left)/rect.width*result.base,y:(e.clientY-rect.top)/rect.height*result.height};}
 stage.onpointerdown=e=>{if(!result||e.button!==0)return;const p=point(e),resize=!!e.target.closest('#case-resize-handle'),image=resize&&isImage()?currentRegion():[...(result.addedImageRegions||[])].reverse().find(r=>inside(r,p))||(inside(result.imageRegion,p)?result.imageRegion:null);if(image){select(image.key);api.checkpoint();drag={start:p,region:{...image},resize};stage.focus({preventScroll:true});stage.setPointerCapture(e.pointerId);e.preventDefault();return;}const hit=[...result.textRegions].reverse().find(r=>inside(r,p));if(hit){select(hit.key);e.preventDefault();}else{selected=null;paint();outline();}};
 function applyMove(){moveFrame=null;const p=pendingPoint;pendingPoint=null;if(!drag||!result||!p)return;const dx=p.x-drag.start.x,dy=p.y-drag.start.y,r=drag.region;if(r.key==='case-image')setImage(drag.resize?{x:r.x,y:r.top,size:r.size+Math.max(dx,dy)}:{x:r.x+dx,y:r.top+dy,size:r.size});else{const ratio=r.height/r.width,delta=(dx+dy*ratio)/(1+ratio*ratio);setAddedImage(drag.resize?{x:r.x,y:r.top,width:r.width+delta}:{x:r.x+dx,y:r.top+dy,width:r.width});}}
 stage.onpointermove=e=>{if(!drag||!result)return;pendingPoint=point(e);if(moveFrame===null)moveFrame=requestAnimationFrame(applyMove);};
 const finish=e=>{if(moveFrame!==null)cancelAnimationFrame(moveFrame);applyMove();drag=null;if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);};stage.onpointerup=finish;stage.onpointercancel=finish;
 stage.onkeydown=e=>{if(!isImage()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();api.checkpoint();const r=currentRegion(),step=e.shiftKey?10:2;if(!r)return;const value={x:r.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),y:r.top+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0),size:r.size,width:r.width};if(selected==='case-image')setImage(value);else setAddedImage(value);};
 function cancelMove(){if(moveFrame!==null)cancelAnimationFrame(moveFrame);moveFrame=null;pendingPoint=null;drag=null;}
 return{render(next){result=next;if(configId!==api.current()?.id){selected=null;cancelMove();configId=api.current()?.id;paint();}if(selected&&!currentRegion()){selected=null;paint();}if(refresh){refresh=false;paint();}const layers=api.current()?.posterImages||[];$('#poster-layer-control').classList.toggle('hidden',!layers.length);const options='<option value="">选择添加的图片</option>'+[...layers].reverse().map((layer,i)=>`<option value="poster-image:${esc(layer.id)}">${i===0?'最上层 · ':''}${esc(layer.name)}</option>`).join('');if(options!==layerOptions){$('#poster-image-select').innerHTML=options;layerOptions=options;}$('#poster-image-select').value=currentLayer()?selected:'';outline();},clear(){selected=null;cancelMove();paint();outline();}};
}
