export function moduleDropIndex(from,target,after){
 const insertion=target+(after?1:0);
 return insertion-(from<insertion?1:0);
}
export function bindModuleDrag(root,move){
 const cards=[...root.querySelectorAll('[data-module]')];let dragged=null;
 const clear=()=>cards.forEach(card=>card.classList.remove('module-dragging','module-drop-before','module-drop-after'));
 for(const card of cards){
  const handle=card.querySelector('.drag');
  handle.ondragstart=e=>{dragged=card;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',card.dataset.module);e.dataTransfer.setDragImage(card,20,20);card.classList.add('module-dragging');};
  handle.ondragend=()=>{clear();dragged=null;};
  card.ondragover=e=>{if(!dragged||dragged===card)return;e.preventDefault();e.dataTransfer.dropEffect='move';clear();dragged.classList.add('module-dragging');const rect=card.getBoundingClientRect();card.classList.add(e.clientY>rect.top+rect.height/2?'module-drop-after':'module-drop-before');if(e.clientY>window.innerHeight-70)window.scrollBy(0,24);else if(e.clientY<100)window.scrollBy(0,-24);};
  card.ondragleave=e=>{if(!card.contains(e.relatedTarget))card.classList.remove('module-drop-before','module-drop-after');};
  card.ondrop=e=>{if(!dragged)return;e.preventDefault();const from=cards.indexOf(dragged),target=cards.indexOf(card),rect=card.getBoundingClientRect(),to=moduleDropIndex(from,target,e.clientY>rect.top+rect.height/2);clear();dragged=null;if(from!==to)move(from,to);};
 }
}
