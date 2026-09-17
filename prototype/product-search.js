const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountProductSearch(root,{getRows,idKey='goodsId',selected='',label='选择商品',placeholder='输入商品名称或 ERP ID',inputId,describe=r=>r.goodsId?'ERP ID '+r.goodsId:'',onChange=()=>{},showEmpty=false,emptySelection='尚未选择商品'}){
 let value=String(selected||'');
 root.classList.add('product-search');root.innerHTML=`<label class="field">${esc(label)}<input ${inputId?`id="${esc(inputId)}"`:''} data-product-query type="search" placeholder="${esc(placeholder)}" autocomplete="off"></label><div class="product-picked" data-product-picked></div><div class="product-results" data-product-results aria-label="${esc(label)}搜索结果"></div><small data-product-count class="hint" role="status"></small>`;
 const input=root.querySelector('[data-product-query]'),results=root.querySelector('[data-product-results]'),picked=root.querySelector('[data-product-picked]'),count=root.querySelector('[data-product-count]');
 const selectedRow=()=>getRows().find(r=>String(r[idKey])===value);
 function paint(){const rows=getRows().filter(r=>!r.deletedAt),query=input.value.trim().toLowerCase(),tokens=query.split(/\s+/).filter(Boolean),row=selectedRow();
  picked.innerHTML=`<span>${value?row?`已选：${esc(row.name)} · ${esc(describe(row))}`:`原关联 ${esc(value)}（未找到）`:esc(emptySelection)}</span>${value?'<button type="button" data-product-clear>清除选择</button>':''}`;
  picked.querySelector('[data-product-clear]')?.addEventListener('click',()=>{value='';input.value='';paint();onChange(null);input.focus();});
  if(!query&&!showEmpty){results.innerHTML='';count.textContent='输入后直接显示匹配商品，点击一项选中。';return;}
  const matches=rows.filter(r=>tokens.every(t=>[r.name,r.goodsId,describe(r)].join(' ').toLowerCase().includes(t))).sort((a,b)=>Number(String(b.goodsId)===query)-Number(String(a.goodsId)===query));
  results.innerHTML=matches.slice(0,50).map(r=>`<button type="button" class="product-result ${String(r[idKey])===value?'selected':''}" data-product-id="${esc(r[idKey])}" aria-pressed="${String(r[idKey])===value}"><strong>${esc(r.name)}</strong><small>${esc(describe(r))}</small></button>`).join('');
  count.textContent=matches.length?`找到 ${matches.length} 项${matches.length>50?'，当前显示前 50 项，请补充关键词缩小范围':''}`:'没有匹配商品，请更换名称或 ID。';
  for(const button of results.querySelectorAll('[data-product-id]'))button.onclick=()=>{const row=getRows().find(r=>String(r[idKey])===button.dataset.productId&&!r.deletedAt);if(!row)return;value=String(row[idKey]);paint();onChange(row);};
 }
 input.oninput=()=>{value='';paint();onChange(null);};
 input.onkeydown=e=>{if(e.isComposing)return;if(e.key==='ArrowDown'){e.preventDefault();results.querySelector('button')?.focus();}else if(e.key==='Enter'){e.preventDefault();const buttons=results.querySelectorAll('button');if(buttons.length===1)buttons[0].click();}};
 results.onkeydown=e=>{if(!['ArrowDown','ArrowUp'].includes(e.key))return;const buttons=[...results.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);e.preventDefault();buttons[Math.max(0,Math.min(buttons.length-1,i+(e.key==='ArrowDown'?1:-1)))]?.focus();};
 paint();return {value:()=>value,row:selectedRow,query:()=>input.value,refresh:paint};
}
