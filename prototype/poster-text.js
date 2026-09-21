// UTF-16 offsets match textarea selectionStart/selectionEnd.
export function richTextLayout(ctx,value,max,base,ranges,font){
 const lines=[];let line=[],width=0,height=base.size*1.32,offset=0;
 const flush=()=>{lines.push({glyphs:line,width,height});line=[];width=0;height=base.size*1.32;};
 for(const ch of String(value??'')){
  const style={...base};for(const range of ranges||[])if(offset>=range.start&&offset<range.end)Object.assign(style,range.style);
  offset+=ch.length;style.size=Math.max(8,Math.min(72,Number(style.size)||base.size));
  if(ch==='\n'){flush();continue;}ctx.font=font(style);const w=ctx.measureText(ch).width;
  if(line.length&&width+w>max)flush();line.push({ch,x:width,style});width+=w;height=Math.max(height,style.size*1.32);
 }flush();return lines;
}
