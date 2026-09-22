const group=c=>JSON.stringify([c.shopId||'intel',c.productId||'legacy:'+String(c.spu||c.product||c.id)]);
export function moveConfig(configs,from,to,after=false){
 const source=configs.find(c=>c.id===from),target=configs.find(c=>c.id===to);
 if(!source||!target||source===target||source.deletedAt||target.deletedAt||group(source)!==group(target))return null;
 const rows=configs.filter(c=>!c.deletedAt&&group(c)===group(source));
 const moved=rows.filter(c=>c!==source);moved.splice(moved.indexOf(target)+(after?1:0),0,source);
 if(moved.every((c,i)=>c===rows[i]))return null;
 const members=new Set(rows);let index=0;return configs.map(c=>members.has(c)?{...moved[index],workspaceOrder:index++}:c);
}
export function bindConfigDrag(list,onMove){
 let dragged=null;
 const items=[...list.querySelectorAll('.config-item')];
 const clear=()=>items.forEach(el=>el.classList.remove('config-drop-before','config-drop-after','config-dragging'));
 const valid=el=>dragged&&el!==dragged&&el.closest('.product-group')===dragged.closest('.product-group');
 for(const el of items){
  el.draggable=true;el.title='拖动调整同一商品链接内的配置顺序';
  el.ondragstart=e=>{if(e.target.closest('input,button')){e.preventDefault();return;}dragged=el;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',el.dataset.id);el.classList.add('config-dragging');};
  el.ondragover=e=>{if(!valid(el))return;e.preventDefault();e.dataTransfer.dropEffect='move';clear();dragged.classList.add('config-dragging');const rect=el.getBoundingClientRect();el.classList.add(e.clientY>rect.top+rect.height/2?'config-drop-after':'config-drop-before');const bounds=list.getBoundingClientRect();if(e.clientY<bounds.top+40)list.scrollTop-=18;else if(e.clientY>bounds.bottom-40)list.scrollTop+=18;};
  el.ondragleave=()=>el.classList.remove('config-drop-before','config-drop-after');
  el.ondrop=e=>{if(!valid(el))return;e.preventDefault();const from=dragged.dataset.id,rect=el.getBoundingClientRect(),after=e.clientY>rect.top+rect.height/2;clear();dragged=null;onMove(from,el.dataset.id,after);};
  el.ondragend=()=>{clear();dragged=null;};
 }
}
