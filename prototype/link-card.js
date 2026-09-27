const colors=[['','默认'],['#e7f0ff','浅蓝'],['#e4f5e9','浅绿'],['#fff2ce','浅黄'],['#ffe8d9','浅橙'],['#fce5ed','浅粉'],['#eee6ff','浅紫'],['#dcf3f5','青色'],['#e9edf2','浅灰']];
export const cardDisplayColor=color=>color;
let closeMenu=null;
export function closeLinkCardMenu(){closeMenu?.();}
export function linkCardHeading(group,{expanded,editing,esc}){
 const raw=String(group.name||''),spu=String(group.spu||'').trim();
 const name=spu&&raw.trimEnd().endsWith(spu)?raw.trimEnd().slice(0,-spu.length).trim()||raw:raw;
 return `<div class="product-select-row compact-link-card"><input type="checkbox" data-group-select="${esc(group.id)}" aria-label="全选链接 ${esc(raw)}"><button class="product-toggle" data-product-toggle="${esc(group.id)}" aria-expanded="${expanded}"><span class="link-arrow">${expanded?'▾':'▸'}</span><span class="link-card-text"><span class="link-card-title"><strong title="${esc(raw)}">${esc(name)}</strong><small>${group.configs.length} 套</small></span><span class="link-card-spu" title="SPU ${esc(spu||'未填写')}">${spu?esc(spu):'未填写 SPU'}</span><span class="link-card-meta"><span class="link-category-chip" title="${esc(group.category||'未分类')}">${esc(group.category||'未分类')}</span>${editing?'<span class="link-editing">编辑中</span>':''}</span></span></button><button class="link-card-more" data-link-menu="${esc(group.id)}" aria-label="${esc(name)}的链接操作" aria-expanded="false" title="链接操作">⋯</button></div>`;
}
export function bindLinkCardMenus(container,{groups,esc,onEdit,onCategory,onColor,onDelete}){
 container.querySelectorAll('[data-link-menu]').forEach(button=>button.onclick=()=>{
  const wasOpen=button.getAttribute('aria-expanded')==='true';closeLinkCardMenu();if(wasOpen)return;
  const group=groups().find(g=>g.id===button.dataset.linkMenu);if(!group)return;
  const menu=document.createElement('div');menu.className='link-card-menu';menu.setAttribute('role','dialog');menu.setAttribute('aria-label','链接操作');
  menu.innerHTML=`<button data-edit-link>编辑链接</button><button data-edit-category>修改分类</button><div class="link-menu-label">卡片配色</div><div class="link-color-picker">${colors.filter(([color])=>color).map(([color,label])=>`<button data-card-color="${color}" aria-label="${label}" title="${label}" aria-pressed="${color===group.cardColor}" style="background:${cardDisplayColor(color)}"></button>`).join('')}</div><button data-reset-color>恢复默认配色</button><button class="link-delete-action" data-delete-link>删除链接（${group.configs.length} 套）</button>`;
  document.body.append(menu);button.setAttribute('aria-expanded','true');
  const controller=new AbortController(),{signal}=controller;
  const close=(focus=false)=>{controller.abort();menu.remove();button.setAttribute('aria-expanded','false');closeMenu=null;if(focus&&button.isConnected)button.focus();};closeMenu=close;
  const rect=button.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(rect.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(8,Math.min(rect.bottom+5,innerHeight-menu.offsetHeight-8))}px`;
  document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target)&&!button.contains(e.target))close();},{signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close(true);}},{signal});
  document.addEventListener('focusin',e=>{if(!menu.contains(e.target)&&e.target!==button)close();},{signal});
  container.addEventListener('scroll',()=>close(),{signal});window.addEventListener('resize',()=>close(),{signal});
  menu.querySelector('[data-edit-link]').onclick=()=>{close();onEdit(group);};menu.querySelector('[data-edit-category]').onclick=()=>{close();onCategory(group);};
  menu.querySelector('[data-delete-link]').onclick=()=>{close();onDelete(group);};
  menu.querySelector('[data-reset-color]').onclick=()=>{close(true);onColor(group,'');};
  menu.querySelectorAll('[data-card-color]').forEach(choice=>choice.onclick=()=>{close(true);onColor(group,choice.dataset.cardColor);});menu.querySelector('button').focus();
 });
}
