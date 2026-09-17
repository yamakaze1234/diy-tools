import {displayUpgrade,doubleMemoryUpgrade} from './memory-upgrade.js';
import {wrapText,posterModules,posterParts,posterPalette} from './core.js';
import {suggestedName} from './legacy-names.js';
import {shopById,shopPalette,shopAddonColors} from './shops.js';
import {posterImageRegion} from './poster-images.js';
const images=new Map();
export async function getImage(url){if(!url)return null;if(!images.has(url))images.set(url,new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>{images.delete(url);reject(Error('图片载入失败，请重新选择素材'));};i.src=url;}));return images.get(url);}
const bound=(value,min,max)=>Math.max(min,Math.min(max,value));
const hasText=value=>!!String(value??'').trim();
const partTitle=p=>String(p.name||'').trimEnd()+(Number(p.qty)>1?` ×${p.qty}`:'');
const entryContent=entry=>typeof entry==='string'?hasText(entry):hasText(entry?.text)||hasText(entry?.note);
function moduleEntries(c,m){return (m.type==='addons'?c.addons:m.type==='benefits'?c.benefits:[{text:m.text||'',note:''}])?.map((entry,index)=>({entry,index})).filter(({entry})=>entryContent(entry))||[];}
export async function renderPoster(c,width=1400,{interactive=false}={}){
 await document.fonts.ready;
 const image=c.caseVisible===false?null:await getImage(c.caseImage),base=700,square=c.layout==='square',dark=c.theme==='dark';
 const shop=shopById(c.shopId),colors={...(c.shopId?shopPalette(c.shopId,c.theme):posterPalette(c.theme)),...c.palette};
 const brandLogo=shop.brandLogo?await getImage(shop.brandLogo.src):null;
 const measure=document.createElement('canvas').getContext('2d');
 const font=s=>`${s.italic?'italic ':''}${s.weight} ${s.size}px "${s.fontFamily}",sans-serif`;
 const parts=posterParts(c).filter(p=>hasText(p.name));
 const visible=posterModules(c).filter(m=>m.visible&&(m.type==='parts'?parts.length:m.type==='footer'?hasText(c.footer):m.type==='service'?hasText(m.text):['addons','benefits','custom'].includes(m.type)?moduleEntries(c,m).length:true));
 // Extra room belongs mostly inside content rows, not in a large gap above the footer.
 const rowUnits=visible.reduce((sum,m)=>sum+(m.type==='parts'?parts.length*2:m.type==='service'?2:['addons','benefits','custom'].includes(m.type)?2*Math.ceil(moduleEntries(c,m).length/(m.type==='custom'?1:2)):0),0);
 const stretchUnits=rowUnits+Math.max(0,visible.length-1);
 function layout(density,stretch=0){
  const pad=26,content=base-pad*2,ops=[],regions=[],textRegions=[];
  let y=pad,imageDefault=null;
  const space=v=>v*(square?.42*density:.5);
  function spec(key,size,weight,color){const custom=c.textStyles?.[key]||{};return{size:Math.max(8,(Number(custom.size)||size)*(square?density:1)),weight:Number(custom.weight)||weight,color:custom.color||color,fontFamily:custom.fontFamily||c.fontFamily||'Microsoft YaHei',italic:!!custom.italic};}
  function block(key,label,moduleId,value,x,top,max,size,weight,color,lineHeight=1.32,centered=false){
   const s=spec(key,size,weight,color);measure.font=font(s);const lines=wrapText(measure,value,max),lh=s.size*lineHeight,height=lines.length*lh;
   const inkWidth=Math.min(max,Math.max(20,...lines.map(t=>measure.measureText(t).width)));
   textRegions.push({key,label,moduleId,x,top,width:inkWidth,height,...s});
   ops.push(ctx=>{ctx.save();ctx.font=font(s);ctx.fillStyle=s.color;if(centered)ctx.textBaseline='middle';lines.forEach((line,i)=>ctx.fillText(line,x,top+i*lh+(centered?lh/2:0)));ctx.restore();});
   return height;
  }
  function line(top){ops.push(ctx=>{ctx.strokeStyle=colors.line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad,top);ctx.lineTo(base-pad,top);ctx.stroke();});}
  for(const [mi,m] of visible.entries()){
   const start=y,size=Number(m.size)*(square?.86:1),weight=Number(m.weight)||400,color=m.color||colors.text,gap=space(Number(m.gap)||0)+(mi<visible.length-1?stretch:0);
   if(m.type==='header'){
    const reserved=square?112:138,titleWidth=content-(image?reserved+22:0);
    const brandTop=y,brandHeight=block('header.brand','品牌标识',m.id,c.brandText||shop.brandText,pad,y,titleWidth,square?23:28,700,colors.accent);
    if(brandLogo){
     // Tint the transparent logo at paint time, preserving the original header space.
     ops.pop();const logoRegion=textRegions.pop();
     const [sx,sy,sw,sh]=shop.brandLogo.crop||[0,0,brandLogo.width,brandLogo.height],logoWidth=Math.min(titleWidth,(brandHeight-5)*sw/sh),logoHeight=logoWidth*sh/sw;
     textRegions.push({...logoRegion,label:'品牌 Logo',width:logoWidth,height:logoHeight,color:c.textStyles?.['header.brand']?.color||(dark?'#ffffff':'#111111')});
     ops.push(ctx=>{const mark=document.createElement('canvas');mark.width=sw;mark.height=sh;const ink=mark.getContext('2d');ink.drawImage(brandLogo,sx,sy,sw,sh,0,0,sw,sh);ink.globalCompositeOperation='source-in';ink.fillStyle=c.textStyles?.['header.brand']?.color||(dark?'#ffffff':'#111111');ink.fillRect(0,0,sw,sh);ctx.drawImage(mark,pad,brandTop,logoWidth,logoHeight);});
    }
    y+=brandHeight+space(3);
    y+=block('header.shop','店铺标题',m.id,c.shop||shop.name,pad,y,titleWidth,size,weight,color)+space(6);
    y+=block('header.version','配置名称与版本',m.id,`${c.name} · ${c.version}`,pad,y,titleWidth,square?14:18,600,color)+space(4);
    const subtitle=c.posterSubtitle??suggestedName(c,'compact').split('：').slice(1).join('：').split('丨')[0];
    if(subtitle)y+=block('header.subtitle','配置摘要',m.id,subtitle,pad,y,titleWidth,square?13:16,500,colors.accent);
    if(image){imageDefault={x:base-pad-reserved,y:start,size:reserved};y=Math.max(y,start+(square?94:130));}
    y+=gap;
   }else if(m.type==='parts'){
    y+=block(`${m.id}.title`,'配件清单标题',m.id,m.title,pad,y,content,square?15:18,700,colors.accent)+space(7);line(y);y+=space(10);
    const inset=12,categoryWidth=68,nameX=pad+categoryWidth,fullWidth=content-categoryWidth-inset;
    // One common model size follows the longest name, with a readable floor;
    // exceptional long names wrap instead of shrinking the entire poster indefinitely.
    const requested=Number(m.size)*(square?.88:1);
    let nameScale=1;
    for(const p of parts){const s=spec(`part.${p.slot}.name`,requested,weight,color);measure.font=font(s);const longest=Math.max(...partTitle(p).split('\n').map(t=>measure.measureText(t).width));nameScale=Math.min(nameScale,fullWidth/Math.max(1,longest));}
    nameScale=bound(nameScale,.88,1);
    for(const p of parts){
     const top=y,opStart=ops.length,key=`part.${p.slot}`,label=p.slot.startsWith('配件')?'配件':p.slot,inner=5+stretch;
     const available=fullWidth;
     let h=block(key+'.name',`${p.slot} 型号`,m.id,partTitle(p),nameX,top+inner,available,requested*nameScale,weight,color,1.25,true);
     if(c.showWarranty&&p.warranty&&p.warranty!=='0')h+=block(key+'.warranty',`${p.slot} 质保`,m.id,p.warranty,nameX,top+inner+h,available,square?10:12,400,colors.muted,1.32,true);
     if(c.showUpgrades&&displayUpgrade(p)){h+=space(3);h+=block(key+'.upgrade',`${p.slot} 升级说明`,m.id,displayUpgrade(p),nameX,top+inner+h,available,Number(c.upgradeSize||14)*(square?.76:.88),Number(c.upgradeWeight||400),doubleMemoryUpgrade(p)?(dark?'#ffcc66':'#b54708'):c.upgradeColor||colors.accent,1.25,true);}
     const labelSize=spec(key+'.label',square?13:16,600,colors.accent);
     measure.font=font(labelSize);
     const labelHeight=wrapText(measure,label,categoryWidth-inset-10).length*labelSize.size*1.32;
     const rowHeight=Math.max(h,labelHeight)+inner*2;
     block(key+'.label',`${p.slot} 分类`,m.id,label,pad+inset,top+(rowHeight-labelHeight)/2,categoryWidth-inset-10,square?13:16,600,colors.accent,1.32,true);
     ops.splice(opStart,0,ctx=>{ctx.fillStyle=colors.panel;ctx.beginPath();ctx.roundRect(pad,top,content,rowHeight,12);ctx.fill();ctx.strokeStyle=colors.line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(nameX-13,top+inner);ctx.lineTo(nameX-13,top+rowHeight-inner);ctx.stroke();});
     y+=rowHeight+space(8);
    }y+=gap;
   }else if(m.type==='service'){
    if(!String(m.text||'').trim())continue;
    const s=spec(`${m.id}.text`,Number(m.size)*(square?.9:1),weight,m.color||'#ffffff');
    if(!c.textStyles?.[`${m.id}.text`]?.fontFamily&&m.fontFamily)s.fontFamily=m.fontFamily;
    measure.font=font(s);const lines=wrapText(measure,m.text,content-28),lh=s.size*1.35,inner=(square?7:9)+stretch,height=lines.length*lh+inner*2,top=y;
    textRegions.push({key:`${m.id}.text`,label:'服务承诺文字',moduleId:m.id,x:pad+14,top:top+inner,width:content-28,height:lines.length*lh,...s});
    ops.push(ctx=>{ctx.fillStyle=m.background||'#173e76';ctx.beginPath();ctx.roundRect(pad,top,content,height,10);ctx.fill();ctx.save();ctx.font=font(s);ctx.fillStyle=s.color;ctx.textAlign='center';lines.forEach((text,i)=>ctx.fillText(text,base/2,top+inner+i*lh));ctx.restore();});
    y+=height+gap;
   }else if(['addons','benefits','custom'].includes(m.type)){
    const entries=moduleEntries(c,m);
    if(!entries?.length)continue;
    const blockStart=y,opStart=ops.length,inner=square?9:8;
    const addon=m.type==='addons'?shopAddonColors(c.shopId,c.theme):null,moduleText=m.color||addon?.text||color,moduleMuted=addon?.muted||colors.muted;
    y+=inner;y+=block(`${m.id}.title`,`${m.title} 标题`,m.id,m.title,pad+inner,y,content-inner*2,square?13:16,700,m.color||addon?.title||color)+space(7);
    const columns=m.type!=='custom'&&entries.length>1?2:1,colGap=16,colWidth=(content-inner*2-colGap*(columns-1))/columns;
    for(let i=0;i<entries.length;i+=columns){let rowHeight=0;y+=stretch;
     for(let col=0;col<columns&&i+col<entries.length;col++){
      const {index,entry}=entries[i+col],text=typeof entry==='string'?entry:entry.text,note=typeof entry==='string'?'':entry.note,x=pad+inner+col*(colWidth+colGap);
      let h=block(`${m.id}.${index}.text`,`${m.title} ${index+1}`,m.id,text,x,y,colWidth,size,weight,moduleText);
      if(note)h+=block(`${m.id}.${index}.note`,`${m.title} ${index+1} 说明`,m.id,note,x,y+h,colWidth,square?9:12,400,moduleMuted);
      rowHeight=Math.max(rowHeight,h);
     }y+=rowHeight+space(7)+stretch;
    }
    y+=inner/2;const blockH=y-blockStart;ops.splice(opStart,0,ctx=>{ctx.fillStyle=addon?.bg||colors.panel;ctx.beginPath();ctx.roundRect(pad,blockStart,content,blockH,square?12:16);ctx.fill();});y+=gap;
   }else if(m.type==='footer'){
    y+=block(`${m.id}.text`,'页脚说明',m.id,c.footer||'',pad,y,content,size,weight,m.color||colors.muted,1.4)+gap;
   }
   regions.push({id:m.id,top:start,bottom:y});
  }
  return{needed:Math.ceil(y+pad),ops,regions,textRegions,imageDefault,density};
 }
 let result=layout(1);
 if(square)for(let n=1;result.needed>base&&n<=10;n++)result=layout(1-n*.035);
 const height=square?base:Math.max(Math.round(base*1.31),result.needed),overflow=square&&result.needed>base;
 if(!overflow&&stretchUnits&&height>result.needed)result=layout(result.density,(height-result.needed)/stretchUnits);
 const canvas=document.createElement('canvas');canvas.width=Number(width);canvas.height=Math.ceil(height*width/base);
 if(canvas.height>22000)throw Error('图片过长，请减少模块或选择较小导出宽度');
 const ctx=canvas.getContext('2d');ctx.scale(width/base,width/base);ctx.fillStyle=colors.bg;ctx.fillRect(0,0,base,height);ctx.textBaseline='top';for(const op of result.ops)op(ctx);
 // Keep the expensive text/layout render while moving images in the editor.
 const background=interactive?document.createElement('canvas'):null;
 if(background){background.width=canvas.width;background.height=canvas.height;background.getContext('2d').drawImage(canvas,0,0);}
 const layerImages=new Map(await Promise.all((c.posterImages||[]).map(async layer=>[layer.url,await getImage(layer.url)])));
 const output={canvas,overflow,needed:result.needed,height,regions:result.regions,textRegions:result.textRegions,imageRegion:null,addedImageRegions:[],base,padding:false,fit:1,offsetX:0,offsetY:0,density:result.density};
 function drawImages(config){
 if(background){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(background,0,0);ctx.restore();}
 let imageRegion=null;
 if(image&&result.imageDefault){
  const custom=config.caseTransforms?.[config.layout]||{},size=bound(Number(custom.size)||result.imageDefault.size,45,Math.min(base,height));
  const x=bound(Number.isFinite(custom.x)?custom.x:result.imageDefault.x,0,base-size),top=bound(Number.isFinite(custom.y)?custom.y:result.imageDefault.y,0,height-size);
  imageRegion={key:'case-image',x,top,width:size,height:size,size};
  const ratio=Math.min(size/image.width,size/image.height),w=image.width*ratio,h=image.height*ratio;ctx.drawImage(image,x+(size-w)/2,top+(size-h)/2,w,h);
 }
 const addedImageRegions=[];
 // Additional images are painted last; the end of the array is the top layer.
 for(const layer of config.posterImages||[]){
  const added=layerImages.get(layer.url);if(!added)throw Error('添加的图片缺少素材，请移除后重新添加');
  const region=posterImageRegion(layer,config.layout,base,height);
  ctx.drawImage(added,region.x,region.top,region.width,region.height);addedImageRegions.push(region);
 }
 output.imageRegion=imageRegion;output.addedImageRegions=addedImageRegions;return output;
 }
 if(interactive)output.redrawImages=drawImages;
 return drawImages(c);
}
