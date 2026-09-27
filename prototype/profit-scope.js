export function mountProfitScope(root,all,selection,esc){
 const groups=new Map();for(const c of all){const key=JSON.stringify([c.shopId,c.productId||c.product||c.id]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
 const rows=[...groups.values()];
 root.innerHTML=`<section class="profit-range-bar"><div class="profit-range-heading"><strong>选择检测范围 <span id="profit-selection-count"></span></strong><div class="profit-range-actions"><button id="profit-all">全选</button><button id="profit-none">清空</button><span aria-hidden="true">｜</span><button id="profit-expand">展开</button><button id="profit-collapse">收起</button></div></div><div class="profit-range-search"><input type="search" id="profit-search" placeholder="搜索链接、SPU 或配置名称" aria-label="搜索检测配置"><label><input type="checkbox" id="profit-only-selected">只看已选</label></div></section><p id="profit-visible-count" class="hint"></p><div class="profit-group-list">${rows.map((items,i)=>`<details class="profit-link" data-profit-group="${i}"><summary><input type="checkbox" data-profit-group-check="${i}" aria-label="选择整条链接 ${esc(items[0].product||'未命名链接')}"><span><strong>${esc(items[0].product||'未命名链接')}</strong><small>SPU ${esc(items[0].spu||'未填写')} · ${items.length} 套配置</small></span><b data-profit-group-count="${i}"></b></summary><div class="profit-config-list">${items.map(c=>`<label><input type="checkbox" data-profit-id="${esc(c.id)}" ${selection.has(c.id)?'checked':''}><span>${esc(c.name||c.id)}</span></label>`).join('')}</div></details>`).join('')}</div>`;
 let applyFilter=()=>{};
 const update=()=>{
  document.querySelector('#profit-selection-count').textContent=`已选 ${selection.size} / ${all.length} 套`;
  rows.forEach((items,i)=>{const count=items.filter(c=>selection.has(c.id)).length,box=root.querySelector(`[data-profit-group-check="${i}"]`);box.checked=count===items.length;box.indeterminate=count>0&&count<items.length;root.querySelector(`[data-profit-group-count="${i}"]`).textContent=`已选 ${count}`;});
  root.querySelectorAll('[data-profit-id]').forEach(box=>box.checked=selection.has(box.dataset.profitId));applyFilter();
 };
 root.querySelectorAll('[data-profit-group-check]').forEach(box=>{box.onclick=e=>e.stopPropagation();box.onchange=()=>{rows[Number(box.dataset.profitGroupCheck)].forEach(c=>box.checked?selection.add(c.id):selection.delete(c.id));update();};});
 root.querySelectorAll('[data-profit-id]').forEach(box=>box.onchange=()=>{box.checked?selection.add(box.dataset.profitId):selection.delete(box.dataset.profitId);update();});
 const filter=()=>{const q=root.querySelector('#profit-search').value.trim().toLowerCase();let count=0;rows.forEach((items,i)=>{const card=root.querySelector(`[data-profit-group="${i}"]`);card.hidden=(root.querySelector('#profit-only-selected').checked&&!items.some(c=>selection.has(c.id)))||!items.some(c=>[c.product,c.spu,c.name].join(' ').toLowerCase().includes(q));if(!card.hidden)count++;});root.querySelector('#profit-visible-count').textContent=`${count} / ${rows.length} 个链接 · 点击链接展开配置，折叠不影响勾选`;};
 applyFilter=filter;root.querySelector('#profit-search').oninput=filter;root.querySelector('#profit-only-selected').onchange=filter;
 root.querySelector('#profit-expand').onclick=()=>root.querySelectorAll('.profit-link:not([hidden])').forEach(card=>card.open=true);
 root.querySelector('#profit-collapse').onclick=()=>root.querySelectorAll('.profit-link').forEach(card=>card.open=false);
 document.querySelector('#profit-all').onclick=()=>{all.forEach(c=>selection.add(c.id));update();};
 document.querySelector('#profit-none').onclick=()=>{selection.clear();update();};
 update();filter();
}
