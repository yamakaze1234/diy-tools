// Only handles initiate dragging; inputs and text selection retain normal behavior.
export function mountPartSort(root, move) {
 const rows=[...root.querySelectorAll('[data-sort-part]')];
 let from=null;
 const clear=()=>rows.forEach(row=>row.classList.remove('part-dragging','part-drop-before','part-drop-after'));
 rows.forEach((row,index)=>{
  const handle=row.querySelector('[data-part-drag]');
  handle.ondragstart=event=>{
   if(handle.disabled){event.preventDefault();return;}
   from=index;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index));
   event.dataTransfer.setDragImage(row,20,20);row.classList.add('part-dragging');
  };
  handle.ondragend=()=>{from=null;clear();};
  const destination=event=>index+(event.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2?1:0);
  row.ondragover=event=>{
   if(from===null||handle.disabled)return;
   event.preventDefault();event.dataTransfer.dropEffect='move';
   rows.forEach(item=>item.classList.remove('part-drop-before','part-drop-after'));
   row.classList.add(destination(event)===index?'part-drop-before':'part-drop-after');
  };
  row.ondrop=event=>{
   if(from===null||handle.disabled)return;
   event.preventDefault();event.stopPropagation();
   const source=from,boundary=destination(event),to=boundary-(boundary>source?1:0);
   from=null;clear();if(source!==to)move(source,to);
  };
  handle.onkeydown=event=>{
   if(!['ArrowUp','ArrowDown'].includes(event.key))return;
   event.preventDefault();const to=index+(event.key==='ArrowUp'?-1:1);
   if(to<0||to>=rows.length)return;move(index,to);
   root.querySelectorAll('[data-part-drag]')[to]?.focus();
  };
 });
}
