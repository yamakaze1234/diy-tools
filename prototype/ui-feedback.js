// Error containers may be filled asynchronously; whitespace is not an error.
export function observeEmptyErrors(root){
 const update=()=>{
  for(const node of root.querySelectorAll('.error')){
   const empty=!node.textContent.trim()&&!node.querySelector('input,button,a,img');
   if(node.classList.contains('is-empty-error')!==empty)node.classList.toggle('is-empty-error',empty);
  }
 };
 const observer=new MutationObserver(update);
 observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});
 update();return ()=>observer.disconnect();
}
