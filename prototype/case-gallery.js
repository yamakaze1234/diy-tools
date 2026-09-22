import {rememberImage} from './image-cache.js';
import {galleryFields,galleryPath,filterGallery,galleryUsage} from './case-gallery-data.js';

export function openCaseGallery(api,{pick=false,append=false}={}){
 const {openDialog,closeDialog,esc,toast,getRows,getConfigs,saveRows,uploadImage,useImage,operator}=api;
 openDialog(pick?(append?'从机箱图库添加图片':'选择机箱图片'):'机箱图库',`<div class="gallery-toolbar"><label class="gallery-search"><span>搜索图库</span><input id="gallery-search" type="search" placeholder="品牌、型号、颜色、版本或图片名称" aria-label="搜索机箱图片"></label><button id="gallery-trash">回收站</button><button id="gallery-new" class="primary">＋ 新增图片</button></div><p class="hint gallery-note">三店共用 · 按品牌 / 型号 / 颜色 / 版本分类${pick?(append?' · 选图后添加为独立图片，可拖动和缩放':' · 选图后保留当前配置的位置和大小'):''}</p><div class="gallery-layout"><nav id="gallery-tree" aria-label="机箱图片分类"></nav><section class="gallery-results"><div id="gallery-count" role="status"></div><div id="gallery-grid"></div><div class="source-pagination"><button id="gallery-prev">上一页</button><span id="gallery-page"></span><button id="gallery-next">下一页</button></div></section><aside id="gallery-detail"></aside></div><p id="gallery-status" class="hint" role="status"></p>`);
 const dialog=document.querySelector('#dialog'),root=document.querySelector('#gallery-grid'),$=selector=>dialog.querySelector(selector);
 dialog.classList.add('case-gallery-dialog');let page=0;const pageSize=36;let path=[],query='',trash=false,selected=null,draft=null,file=null,previewUrl=null,busy=false;const expanded=new Set();
 const controller=new AbortController();
 const release=()=>{if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();},{signal:controller.signal});
 dialog.addEventListener('close',()=>{release();dialog.classList.remove('case-gallery-dialog');controller.abort();},{once:true,signal:controller.signal});
 const live=()=>root.isConnected&&dialog.open;
 const report=message=>{if(live())$('#gallery-status').textContent=message;};
 const lock=value=>{busy=value;if(live())dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=value);};
 const run=async action=>{if(busy)return;lock(true);try{await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));await action();}catch(error){report(error.message);toast(error.message);}finally{busy=false;dialog.querySelector('.close').disabled=false;if(live())lock(false);}};
 const resetDraft=()=>{release();draft=null;file=null;};
 const getSelected=()=>getRows().find(row=>row.id===selected);
 function renderTree(){
  const rows=filterGallery(getRows(),{query,deleted:trash}),tree=$('#gallery-tree');tree.replaceChildren();
  const all=document.createElement('button');all.textContent=`${trash?'全部回收图片':'全部图片'} · ${rows.length}`;all.className=path.length?'':'active';all.onclick=()=>{path=[];page=0;render();};tree.append(all);
  function branch(parent,items,depth,ancestors){
   if(depth===4)return;const groups=new Map();for(const row of items){const value=galleryPath(row)[depth];if(!groups.has(value))groups.set(value,[]);groups.get(value).push(row);}
   for(const [label,children] of [...groups].sort(([a],[b])=>a.localeCompare(b,'zh-CN'))){
    const next=[...ancestors,label],key=JSON.stringify(next),details=document.createElement('details'),summary=document.createElement('summary'),button=document.createElement('button');details.open=expanded.has(key)||next.every((part,i)=>path[i]===part);let built=false;const populate=()=>{if(!built){built=true;branch(details,children,depth+1,next);}};details.ontoggle=()=>{if(details.open){expanded.add(key);populate();}else expanded.delete(key);};
    button.textContent=`${label} · ${children.length}`;button.classList.toggle('active',JSON.stringify(path)===key);button.onclick=()=>{path=next;page=0;render();};summary.append(button);details.append(summary);if(details.open)populate();parent.append(details);
   }
  }branch(tree,rows,0,[]);
 }
 function renderGrid(){
  const usage=new Map();for(const c of getConfigs())if(!c.deletedAt)usage.set(c.caseImage,(usage.get(c.caseImage)||0)+1);const rows=filterGallery(getRows(),{query,path,deleted:trash});$('#gallery-count').textContent=`${path.length?path.join(' / '):trash?'回收站':'全部机箱图片'} · ${rows.length} 张`;
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.max(0,Math.min(page,pages-1));$('#gallery-page').textContent=`${page+1} / ${pages}`;$('#gallery-prev').disabled=page===0;$('#gallery-next').disabled=page===pages-1;
  root.innerHTML=rows.length?rows.slice(page*pageSize,(page+1)*pageSize).map(row=>`<article class="gallery-card ${selected===row.id?'selected':''}"><button class="gallery-card-open" data-gallery-open="${esc(row.id)}" aria-label="查看 ${esc(row.name)}"><img src="${esc(row.url)}" alt="${esc(row.name)}" loading="lazy" decoding="async"><strong>${esc(row.name)}</strong><small>${esc(galleryPath(row).join(' / '))}</small></button><div class="gallery-card-footer"><span>${(usage.get(row.url)||0)} 套配置使用</span>${pick&&!trash?`<button class="primary" data-gallery-use="${esc(row.id)}">使用图片</button>`:''}</div></article>`).join(''):`<div class="gallery-empty"><strong>${query?'没有找到匹配图片':trash?'回收站为空':'这个分类还没有图片'}</strong><p>${query?'试试其他型号、颜色或版本关键词。':'点击右上角“新增图片”，上传后供三店选用。'}</p></div>`;
  root.querySelectorAll('[data-gallery-open]').forEach(button=>button.onclick=()=>{resetDraft();selected=button.dataset.galleryOpen;root.querySelectorAll(".gallery-card").forEach(card=>card.classList.toggle("selected",card.querySelector("[data-gallery-open]").dataset.galleryOpen===selected));renderDetail();});
  root.querySelectorAll('[data-gallery-use]').forEach(button=>button.onclick=()=>choose(button.dataset.galleryUse));
 }
 async function choose(id){await run(async()=>{const row=getRows().find(item=>item.id===id);if(!row||row.deletedAt)throw Error('图片已删除，请重新选择');const card=[...root.querySelectorAll('[data-gallery-open]')].find(button=>button.dataset.galleryOpen===id),image=card?.querySelector('img');if(image)rememberImage(row.url,image);report('正在更换图片…');await useImage(row);if(live())closeDialog();toast(append?'图片已添加，可拖动和缩放':'机箱图已更换，原位置和大小已保留');});}
 function renderDetail(){
  const pane=$('#gallery-detail'),row=getSelected();
  if(draft){
   pane.innerHTML=`<h3>${draft.id?'编辑图片资料':'新增机箱图片'}</h3><p class="hint">分类分别填写，方便多级查找。</p>${!draft.id?'<label class="field">上传图片<input id="gallery-file" type="file" accept="image/png,image/jpeg"></label><small class="hint">PNG / JPG，最大 24MB</small>':''}<img id="gallery-upload-preview" class="gallery-detail-image ${draft.url||previewUrl?'':'hidden'}" alt="待保存图片预览" ${draft.url||previewUrl?`src="${esc(previewUrl||draft.url)}"`:''}><label class="field">图片名称<input id="gallery-name" maxlength="160" value="${esc(draft.name||'')}" placeholder="例如：X400CG 黑色进阶主图"></label>${galleryFields.map((field,i)=>`<label class="field">${['品牌','型号','颜色','版本'][i]}<input data-gallery-field="${field}" maxlength="80" value="${esc(draft[field]||'')}" placeholder="${['乔思伯','X400CG','黑色 / 白色','进阶 / 豪华 / 通用'][i]}" list="gallery-values-${field}"><datalist id="gallery-values-${field}">${[...new Set(getRows().filter(r=>!r.deletedAt).map(r=>r[field]).filter(Boolean))].map(value=>`<option value="${esc(value)}"></option>`).join('')}</datalist></label>`).join('')}<div class="gallery-detail-actions"><button id="gallery-save" class="primary">保存图片</button><button id="gallery-cancel">取消</button></div>`;
   if($('#gallery-file'))$('#gallery-file').onchange=event=>{file=event.target.files[0]||null;release();if(file){previewUrl=URL.createObjectURL(file);$('#gallery-upload-preview').src=previewUrl;$('#gallery-upload-preview').classList.remove('hidden');if(!$('#gallery-name').value)$('#gallery-name').value=file.name.replace(/\.[^.]+$/,'');}else $('#gallery-upload-preview').classList.add('hidden');};
   $('#gallery-cancel').onclick=()=>{resetDraft();renderDetail();};
   $('#gallery-save').onclick=()=>run(async()=>{
    const name=$('#gallery-name').value.trim(),metadata=Object.fromEntries([...pane.querySelectorAll('[data-gallery-field]')].map(input=>[input.dataset.galleryField,input.value.trim()]));
    if(!name)throw Error('请填写图片名称');if(!metadata.brand||!metadata.model||!metadata.color||!metadata.edition)throw Error('请填写品牌、型号、颜色和版本；无区分的版本可填“通用”');
    if(!draft.id&&!file)throw Error('请选择一张机箱图片');
    report(draft.id?'正在保存图片资料…':'正在读取并保存图片…');
    const editing=!!draft.id,url=draft.url||await uploadImage(file),at=new Date().toISOString(),entry={...draft,...metadata,id:draft.id||crypto.randomUUID(),name,url,createdAt:draft.createdAt||at,updatedAt:at,operator:operator()};
    const next=structuredClone(getRows()),index=next.findIndex(r=>r.id===entry.id);if(index<0)next.push(entry);else next[index]=entry;
    draft=entry;await saveRows(next,`${editing?'编辑':'新增'}机箱图库图片：${name}`);if(!live())return;resetDraft();selected=entry.id;trash=false;query='';$('#gallery-search').value='';path=galleryPath(entry);page=0;render();report('图片已保存，可在更换机箱图时搜索选用。');
   });return;
  }
  if(!row){pane.innerHTML='<div class="gallery-empty"><strong>图片资料</strong><p>点击图片查看分类和使用情况，或新增机箱图片。</p></div>';return;}
  const uses=galleryUsage(row,getConfigs());pane.innerHTML=`<img class="gallery-detail-image" src="${esc(row.url)}" alt="${esc(row.name)}"><h3>${esc(row.name)}</h3><p class="gallery-path">${esc(galleryPath(row).join(' / '))}</p><p class="hint">维护人：${esc(row.operator||'已有素材')}<br>${row.updatedAt?esc(new Date(row.updatedAt).toLocaleString('zh-CN')):'从现有配置收录'}</p><details class="gallery-usage"><summary>${uses.length} 套配置使用此图片</summary>${uses.slice(0,30).map(c=>`<p>${esc(c.shop||c.shopId||'')} · ${esc(c.product||'')} / ${esc(c.name)}</p>`).join('')}${uses.length>30?'<p>其余配置继续保留引用。</p>':''}</details><div class="gallery-detail-actions">${row.deletedAt?'<button id="gallery-restore" class="primary">恢复图片</button>':`${pick?'<button id="gallery-pick" class="primary">使用这张图片</button>':''}<button id="gallery-edit">编辑资料</button><button id="gallery-delete" class="danger">删除图片</button>`}</div><div id="gallery-delete-confirm"></div>`;
  if($('#gallery-edit'))$('#gallery-edit').onclick=()=>{draft=structuredClone(row);renderDetail();};
  if($('#gallery-pick'))$('#gallery-pick').onclick=()=>choose(row.id);
  async function setDeleted(deleted){await run(async()=>{const rows=structuredClone(getRows()),target=rows.find(r=>r.id===row.id);if(!target)throw Error('图片记录已变化，请重新打开图库');if(deleted)target.deletedAt=new Date().toISOString();else delete target.deletedAt;target.updatedAt=new Date().toISOString();target.operator=operator();await saveRows(rows,`${deleted?'删除':'恢复'}机箱图库图片：${row.name}`);if(live()){selected=null;render();report(deleted?'图片已移入回收站，已有配置仍可正常显示。':'图片已恢复，可在图库搜索选用。');}});}
  if($('#gallery-restore'))$('#gallery-restore').onclick=()=>setDeleted(false);
  if($('#gallery-delete'))$('#gallery-delete').onclick=()=>{$('#gallery-delete-confirm').innerHTML=`<div class="gallery-confirm"><strong>将这张图片移入回收站？</strong><p>已有配置和模板仍保留原图，可随时恢复。</p><button id="gallery-delete-yes" class="danger">确认移入回收站</button><button id="gallery-delete-no">取消</button></div>`;$('#gallery-delete-yes').onclick=()=>setDeleted(true);$('#gallery-delete-no').onclick=()=>$('#gallery-delete-confirm').replaceChildren();};
 }
 function render(){if(!live())return;if(draft&&$('#gallery-name')){draft.name=$('#gallery-name').value;for(const input of dialog.querySelectorAll('[data-gallery-field]'))draft[input.dataset.galleryField]=input.value;}$('#gallery-trash').textContent=trash?'返回图库':'回收站';renderTree();renderGrid();renderDetail();}
 $('#gallery-search').oninput=event=>{query=event.target.value;path=[];page=0;renderTree();renderGrid();};
 $('#gallery-trash').onclick=()=>{resetDraft();trash=!trash;path=[];page=0;selected=null;render();};
 $('#gallery-new').onclick=()=>{resetDraft();selected=null;draft=Object.fromEntries(galleryFields.map((field,i)=>[field,path[i]==='待分类'?'':path[i]||'']));renderDetail();$('#gallery-name').focus();};
 $('#gallery-prev').onclick=()=>{page--;renderGrid();};$('#gallery-next').onclick=()=>{page++;renderGrid();};
 render();$('#gallery-search').focus();
}
