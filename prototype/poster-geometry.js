const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function snapRegion(region,others,base,height,tolerance=6){
 const value={...region},guides=[];
 for(const [axis,size,limit] of [['x','width',base],['top','height',height]]){
  const anchors=[0,limit/2,limit,...others.flatMap(r=>[r[axis],r[axis]+r[size]/2,r[axis]+r[size]])];
  let best=null;
  for(const anchor of anchors)for(const offset of [0,region[size]/2,region[size]]){
   const delta=anchor-region[axis]-offset,pos=region[axis]+delta;
   if(pos<0||pos+region[size]>limit||Math.abs(delta)>tolerance)continue;
   if(!best||Math.abs(delta)<Math.abs(best.delta))best={delta,anchor};
  }
  if(best){value[axis]+=best.delta;guides.push({axis:axis==='x'?'x':'y',position:best.anchor});}
 }
 return {value,guides};
}
export function moduleFrame(region,transform={}){
 const x=finite(transform.x,region.x),top=finite(transform.y,region.top),width=Number.isFinite(transform.width)?Math.max(40,transform.width):region.width,height=Number.isFinite(transform.height)?Math.max(20,transform.height):region.height;
 return {...region,x,top,width,height,bottom:top+height,sx:width/region.width,sy:height/region.height};
}
export function textFrame(region,transform={}){
 const scale=clamp(finite(transform.scale,1),.1,12),scaleX=clamp(finite(transform.scaleX,scale),.1,12),scaleY=clamp(finite(transform.scaleY,scale),.1,12);
 return {...region,x:finite(transform.x,region.x),top:finite(transform.y,region.top),width:region.width*scaleX,height:region.height*scaleY,scale,scaleX,scaleY};
}
export function displayedText(region,textTransform,moduleRegion,moduleTransform){
 const local=textFrame(region,textTransform),parent=moduleFrame(moduleRegion,moduleTransform);
 return {...local,x:parent.x+(local.x-moduleRegion.x)*parent.sx,top:parent.top+(local.top-moduleRegion.top)*parent.sy,width:local.width*parent.sx,height:local.height*parent.sy,local,parent,moduleOrigin:moduleRegion};
}
export function resizeRegion(region,dx,dy,corner,base,height,uniform=true){
 const west=corner.includes('w'),north=corner.includes('n'),ax=west?region.x+region.width:region.x,ay=north?region.top+region.height:region.top;
 const minW=region.key==='case-image'?45:region.key?.startsWith('module:')?40:region.minWidth||12,minH=region.key==='case-image'?45:region.key?.startsWith('module:')?20:region.minHeight||12;
 const horizontal=corner.includes('w')||corner.includes('e'),vertical=corner.includes('n')||corner.includes('s');
 let width=horizontal?Math.max(minW,region.width+(west?-dx:dx)):region.width,h=vertical?Math.max(minH,region.height+(north?-dy:dy)):region.height;
 const maxW=Math.max(minW,west?ax:base-ax),maxH=Math.max(minH,north?ay:height-ay);
 if(uniform){const scale=Math.min(maxW/region.width,maxH/region.height,Math.max(minW/region.width,minH/region.height,1+((west?-dx:dx)*region.width+(north?-dy:dy)*region.height)/(region.width**2+region.height**2)));width=region.width*scale;h=region.height*scale;}
 else {width=Math.min(width,maxW);h=Math.min(h,maxH);}
 return {x:west?ax-width:ax,top:north?ay-h:ay,width,height:h};
}
