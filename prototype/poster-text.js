// UTF-16 offsets match textarea selectionStart/selectionEnd.
export function richTextLayout(ctx,value,max,base,ranges,font,scale=1){
 const lines=[];let line=[],width=0,height=base.size*scale*1.32,offset=0;
 const flush=()=>{lines.push({glyphs:line,width,height});line=[];width=0;height=base.size*scale*1.32;};
 for(const ch of String(value??'')){
  const style={...base};for(const range of ranges||[])if(offset>=range.start&&offset<range.end)Object.assign(style,range.style);
  offset+=ch.length;style.size=Math.max(8,Math.min(72,Number(style.size)||base.size))*scale;
  if(ch==='\n'){flush();continue;}ctx.font=font(style);const w=ctx.measureText(ch).width;
  if(line.length&&width+w>max)flush();line.push({ch,x:width,style});width+=w;height=Math.max(height,style.size*1.32);
 }flush();return lines;
}

// Use the same measured layout for preview and exported canvas.
export function fitTextScale(layout,width,height){
 let low=.01,high=12;
 for(let i=0;i<22;i++){
  const mid=(low+high)/2,lines=layout(mid);
  if(lines.reduce((sum,line)=>sum+line.height,0)<=height&&lines.every(line=>line.width<=width))low=mid;else high=mid;
 }
 return low;
}
