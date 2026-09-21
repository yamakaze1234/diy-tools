import {modelCanvasWidth,posterColumns} from './poster-width.js';
import {moduleFrame,textFrame,displayedText} from './poster-geometry.js';
import {richTextLayout} from './poster-text.js';
import {displayUpgrade,doubleMemoryUpgrade} from './memory-upgrade.js';
import {wrapText,posterModules,posterParts,posterPalette} from './core.js';
import {suggestedName} from './legacy-names.js';
import {shopById,shopPalette,shopAddonColors,shopServiceTextColor,shopServiceColor} from './shops.js';
import {posterImageRegion} from './poster-images.js';
const images=new Map();
export async function getImage(url){if(!url)return null;if(!images.has(url))images.set(url,new Promise((resolve,reject)=>{const i=new Image(),timer=setTimeout(()=>{images.delete(url);i.onload=i.onerror=null;reject(Error('图片载入超时，请重试或更换素材'));},15000);i.onload=()=>{clearTimeout(timer);while(images.size>24)images.delete(images.keys().next().value);resolve(i);};i.onerror=()=>{clearTimeout(timer);images.delete(url);reject(Error('图片载入失败，请重新选择素材'));};i.src=url;}));return images.get(url);}
const bound=(value,min,max)=>Math.max(min,Math.min(max,value));
const hasText=value=>!!String(value??'').trim();
const partTitle=p=>String(p.name||'').trimEnd()+(Number(p.qty)>1?` ×${p.qty}`:'');
const entryContent=entry=>typeof entry==='string'?hasText(entry):hasText(entry?.text)||hasText(entry?.note);
function moduleEntries(c,m){return (m.type==='addons'?c.addons:m.type==='benefits'?c.benefits:[{text:m.text||'',note:''}])?.map((entry,index)=>({entry,index})).filter(({entry})=>entryContent(entry))||[];}
export async function renderPoster(c,width=1400,{interactive=false}={}){
 await document.fonts.ready;
 const image=c.caseVisible===false?null:await getImage(c.caseImage),square=c.layout==='square',dark=c.theme==='dark';
 const fixed=c.freeCanvasLayouts?.[c.layout],mobile=fixed?.compact??(square&&!fixed),autoWidth=fixed?(fixed.autoWidth??(mobile&&c.autoWidth!==false)):c.autoWidth!==false;
 const tightRows=fixed?fixed.tightRows===true:autoWidth;
 const unifiedPanel=fixed?fixed.unifiedPanel===true:true;
 const centeredHeader=mobile&&(fixed?fixed.centeredHeader===true:true);
 const titleUnderLogo=centeredHeader&&(!fixed||fixed.titleUnderLogo===true);
 let base=fixed?.base||700;
 const shop=shopById(c.shopId),colors={...(c.shopId?shopPalette(c.shopId,c.theme):posterPalette(c.theme)),...c.palette};
 const brandLogo=shop.brandLogo?await getImage(shop.brandLogo.src):null;
 const measure=document.createElement('canvas').getContext('2d');
 if(autoWidth&&!fixed)base=modelCanvasWidth(measure,c,{tightRows,unifiedPanel});
 const font=s=>`${s.italic?'italic ':''}${s.weight} ${s.size}px "${s.fontFamily}",sans-serif`;
 const parts=posterParts(c).filter(p=>hasText(p.name));
 const visible=posterModules(c).filter(m=>m.visible&&(m.type==='parts'?parts.length:m.type==='footer'?hasText(c.footer):m.type==='service'?hasText(m.text):['addons','benefits','custom'].includes(m.type)?moduleEntries(c,m).length:true));
 // Extra room belongs mostly inside content rows, not in a large gap above the footer.
 const rowUnits=visible.reduce((sum,m)=>sum+(m.type==='parts'?parts.length*2:m.type==='service'?2:['addons','benefits','custom'].includes(m.type)?2*Math.ceil(moduleEntries(c,m).length/(m.type==='custom'?1:2)):0),0);
 const stretchUnits=rowUnits+Math.max(0,visible.length-1);
 let drawingConfig=c;
 function layout(density,stretch=0){
  const pad=unifiedPanel?32:tightRows?16:26,content=base-pad*2,ops=[],regions=[],textRegions=[];
  let y=pad,imageDefault=null,relocatedTitle=null;
  const space=v=>v*(square?.42*density:.5);
  function spec(key,size,weight,color){const custom=c.textStyles?.[key]||{};return{styleSize:Number(custom.size)||size,size:Math.max(8,(Number(custom.size)||size)*((centeredHeader&&key.startsWith('header.')||titleUnderLogo&&visible.some(m=>m.type==='parts'&&key===`${m.id}.title`))?1:unifiedPanel&&visible.some(m=>m.type==='footer'&&key===`${m.id}.text`)?1:tightRows&&/^part\..*\.label$/.test(key)?1:autoWidth&&/^part\..*\.name$/.test(key)?1:autoWidth&&/^part\..*\.upgrade$/.test(key)?Math.max(.8,density):unifiedPanel&&visible.some(m=>m.type==='addons'&&key.startsWith(m.id+'.'))?Math.max(.9,density):unifiedPanel&&key.endsWith('.text')&&visible.some(m=>m.type==='service'&&key===`${m.id}.text`)?Math.max(.9,density):square?density:1)),weight:Number(custom.weight)||weight,color:custom.color||color,fontFamily:custom.fontFamily||visible.find(m=>m.type==='service'&&key===`${m.id}.text`)?.fontFamily||c.fontFamily||'Microsoft YaHei',italic:!!custom.italic};}
  function addText(region,paint){
   textRegions.push(region);
   ops.push(ctx=>{const frame=textFrame(region,drawingConfig.textTransforms?.[drawingConfig.layout]?.[region.key]);ctx.save();ctx.translate(frame.x,frame.top);ctx.scale(frame.scaleX,frame.scaleY);ctx.translate(-region.x,-region.top);paint(ctx);ctx.restore();});
  }
  function block(key,label,moduleId,value,x,top,max,size,weight,color,lineHeight=1.32,centered=false,align='left'){
   const custom=c.textStyles?.[key]||{};if(custom.hidden)return 0;
   value=custom.text??value;x=Number.isFinite(custom.x)?custom.x:x;top=Number.isFinite(custom.y)?custom.y:top;max=Number.isFinite(custom.width)?Math.max(20,custom.width):max;
   const s=spec(key,size,weight,color),transform=c.textTransforms?.[c.layout]?.[key]||{};
   const boxWidth=Number.isFinite(transform.boxWidth)?Math.max(20,transform.boxWidth):null;
   const boxHeight=Number.isFinite(transform.boxHeight)?Math.max(12,transform.boxHeight):0;
   const flowMax=max;max=boxWidth??max;
   if(custom.ranges?.length){
    const lines=richTextLayout(measure,value,max,s,custom.ranges,font),height=Math.max(boxHeight,lines.reduce((n,l)=>n+l.height,0)),inkWidth=boxWidth??Math.max(20,...lines.map(l=>l.width)),flowHeight=boxWidth!==null?richTextLayout(measure,value,flowMax,s,custom.ranges,font).reduce((n,l)=>n+l.height,0):lines.reduce((n,l)=>n+l.height,0);if(align==='center')x+=(max-inkWidth)/2;
    addText({key,label,moduleId,value:String(value??''),x,top,width:inkWidth,height,lineCount:lines.length,...s},ctx=>{ctx.save();let y=top;for(const line of lines){for(const glyph of line.glyphs){ctx.font=font(glyph.style);ctx.fillStyle=glyph.style.color;ctx.fillText(glyph.ch,x+glyph.x+(align==='center'?(inkWidth-line.width)/2:0),y);}y+=line.height;}ctx.restore();});return flowHeight;
   }
   measure.font=font(s);const lines=wrapText(measure,value,max),lh=s.size*lineHeight,height=Math.max(boxHeight,lines.length*lh),flowHeight=wrapText(measure,value,flowMax).length*lh;
   const inkWidth=boxWidth??Math.min(max,Math.max(20,...lines.map(t=>measure.measureText(t).width)));
   if(align==='center')x+=(max-inkWidth)/2;
   addText({key,label,moduleId,value:String(value??''),x,top,width:inkWidth,height,lineCount:lines.length,...s},ctx=>{ctx.save();ctx.font=font(s);ctx.fillStyle=s.color;if(centered)ctx.textBaseline='middle';if(align==='center')ctx.textAlign='center';lines.forEach((line,i)=>ctx.fillText(line,x+(align==='center'?inkWidth/2:0),top+i*lh+(centered?lh/2:0)));ctx.restore();});
   return flowHeight;
  }
  function line(top){ops.push(ctx=>{ctx.strokeStyle=colors.line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad,top);ctx.lineTo(base-pad,top);ctx.stroke();});}
  for(const [mi,m] of visible.entries()){
   const opStartModule=ops.length,textStartModule=textRegions.length;
   const start=y,size=Number(m.size)*(unifiedPanel&&m.type==='header'?(square?1:1.24):square?.86:1),weight=Number(m.weight)||400,color=m.color||colors.text,gap=space(Number(m.gap)||0)+(mi<visible.length-1?stretch:0);
   if(m.type==='header'){
    const reserved=unifiedPanel?(square?128:180):square?112:138,titleWidth=content-(image?reserved+22:0);
    const brandWidth=centeredHeader?(unifiedPanel?156:120):titleWidth,brandValue=c.brandText||shop.brandText;
    let brandSize=centeredHeader?(unifiedPanel?44:36):square?23:unifiedPanel?44:28;
    if(unifiedPanel&&!c.textStyles?.['header.brand']?.size){measure.font=font(spec('header.brand',brandSize,700,colors.accent));brandSize*=Math.min(1,brandWidth/Math.max(1,measure.measureText(brandValue).width));}
    const brandTop=y,brandHeight=block('header.brand','品牌标识',m.id,brandValue,pad,y,brandWidth,brandSize,700,colors.accent);
    if(brandLogo){
     // Tint the transparent logo at paint time, preserving the original header space.
     ops.pop();const logoRegion=textRegions.pop();
     const [sx,sy,sw,sh]=shop.brandLogo.crop||[0,0,brandLogo.width,brandLogo.height],logoWidth=Math.min(unifiedPanel?(centeredHeader?156:180):titleWidth,(brandHeight-5)*sw/sh),logoHeight=logoWidth*sh/sw;
     let mark;
     addText({...logoRegion,label:'品牌 Logo',isLogo:true,width:logoWidth,height:logoHeight,color:c.textStyles?.['header.brand']?.color||(dark?'#ffffff':'#111111')},ctx=>{if(!mark){mark=document.createElement('canvas');mark.width=sw;mark.height=sh;const ink=mark.getContext('2d');ink.drawImage(brandLogo,sx,sy,sw,sh,0,0,sw,sh);ink.globalCompositeOperation='source-in';ink.fillStyle=c.textStyles?.['header.brand']?.color||(dark?'#ffffff':'#111111');ink.fillRect(0,0,sw,sh);}ctx.drawImage(mark,pad,brandTop,logoWidth,logoHeight);});
    }
    if(centeredHeader){
     const brandEdge=pad+Math.max(unifiedPanel?156:96,textRegions.at(-1)?.width||0)+12,right=base-pad-(image?reserved+14:0);
     // Keep all three heading lines centered on the canvas, regardless of logo width.
     const halfWidth=Math.max(50,Math.min(base/2-brandEdge,right-base/2));
     const left=unifiedPanel?base/2-halfWidth:brandEdge,max=unifiedPanel?halfWidth*2:Math.max(100,right-left);
     y=start;y+=block('header.shop','店铺标题',m.id,c.shop||shop.name,left,y,max,size,weight,color,1.2,false,'center')+space(6);
     if(c.posterFields?.name!==false||c.posterFields?.version!==false)y+=block('header.version','配置名称与版本',m.id,[c.posterFields?.name===false?'':c.name,c.posterFields?.version===false?'':c.version].filter(Boolean).join(' · '),left,y,max,unifiedPanel?20:18,700,color,1.25,false,'center')+space(4);
     const subtitle=c.posterFields?.subtitle===false?'':c.posterSubtitle??(c.shortNameAuto===false?c.shortName:suggestedName(c,'compact').split('：').slice(1).join('：').split('丨')[0]);
     if(subtitle)y+=block('header.subtitle','配置摘要',m.id,subtitle,left,y,max,unifiedPanel?16:15,500,colors.accent,1.25,false,'center');
     y=Math.max(y,start+brandHeight);
    }else{
    y+=brandHeight+space(3);
    y+=block('header.shop','店铺标题',m.id,c.shop||shop.name,pad,y,titleWidth,size,weight,color)+space(6);
    if(c.posterFields?.name!==false||c.posterFields?.version!==false)y+=block('header.version','配置名称与版本',m.id,[c.posterFields?.name===false?'':c.name,c.posterFields?.version===false?'':c.version].filter(Boolean).join(' · '),pad,y,titleWidth,square?14:unifiedPanel?21:18,600,color)+space(4);
    const subtitle=c.posterFields?.subtitle===false?'':c.posterSubtitle??(c.shortNameAuto===false?c.shortName:suggestedName(c,'compact').split('：').slice(1).join('：').split('丨')[0]);
    if(subtitle)y+=block('header.subtitle','配置摘要',m.id,subtitle,pad,y,titleWidth,square?13:unifiedPanel?19:16,500,colors.accent);
    }
    if(image){
     // Saved reference frames: square 710px canvas, detail 668px canvas.
     // Keep their right inset as automatic model width changes; explicit edits still override below.
     imageDefault=unifiedPanel
      ?square?{x:base-180.9256399972098,y:start-32,size:128}:{x:base-216.4765625,y:start,size:172}
      :{x:base-pad-reserved,y:start,size:reserved};
     y=Math.max(y,start+(unifiedPanel?(square?106:170):square?94:130));
    }
    const partsModule=visible.find(item=>item.type==='parts');
    if(titleUnderLogo&&partsModule&&visible.indexOf(partsModule)>mi){
     const titleSize=unifiedPanel?22:24;
     const titleY=unifiedPanel?Math.max(start+brandHeight+8,y+gap+10-titleSize*1.25-5):Math.max(start+brandHeight+18,start+94-titleSize*1.25);
     const titleHeight=block(`${partsModule.id}.title`,'配件清单标题',m.id,partsModule.title,pad,titleY,110,titleSize,700,colors.accent,1.25);
     relocatedTitle=partsModule.id;y=Math.max(y,titleY+titleHeight-gap-5);
    }
    y+=gap;
   }else if(m.type==='parts'){
    y+=mobile?10:0;
    if(relocatedTitle!==m.id)y+=block(`${m.id}.title`,'配件清单标题',m.id,m.title,pad+(mobile?12:0),y,content-(mobile?24:0),square?15:unifiedPanel?22:18,700,colors.accent)+space(7);if(!unifiedPanel)line(y);y+=space(10);
    const panelTop=relocatedTitle===m.id?start:y;
    const {inset,categoryWidth,rightInset,labelGap}=posterColumns(c,{tightRows,unifiedPanel,compact:mobile});
    const nameX=pad+categoryWidth,fullWidth=content-categoryWidth-rightInset;
    // One common model size follows the longest name, with a readable floor;
    // exceptional long names wrap instead of shrinking the entire poster indefinitely.
    const requested=Number(m.size)*(autoWidth&&square?.9:square?.88:1);
    let nameScale=mobile&&!autoWidth?1.2:1;
    for(const p of parts){if(mobile&&c.textStyles?.[`part.${p.slot}.name`]?.size)continue;const s=spec(`part.${p.slot}.name`,requested,weight,color);measure.font=font(s);const longest=Math.max(...partTitle(p).split('\n').map(t=>measure.measureText(t).width));nameScale=Math.min(nameScale,fullWidth*(mobile?.98:1)/Math.max(1,longest));}
    nameScale=bound(nameScale,.88,mobile&&!autoWidth?1.2:1);
    for(const p of parts){
     const top=y,opStart=ops.length,key=`part.${p.slot}`,label=p.slot.startsWith('配件')?'配件':p.slot,inner=(unifiedPanel?(square?1:7):mobile?2:5)+stretch;
     const available=fullWidth;
     let h=block(key+'.name',`${p.slot} 型号`,m.id,partTitle(p),nameX,top+inner,available,requested*nameScale,weight,color,1.25,true);
     if(c.showWarranty&&p.warranty&&p.warranty!=='0')h+=block(key+'.warranty',`${p.slot} 质保`,m.id,p.warranty,nameX,top+inner+h,available,square?10:12,400,colors.muted,1.32,true);
     if(c.showUpgrades&&displayUpgrade(p)){h+=space(3);h+=block(key+'.upgrade',`${p.slot} 升级说明`,m.id,displayUpgrade(p),nameX,top+inner+h,available,Number(c.upgradeSize||(unifiedPanel?16:14))*(unifiedPanel?(square?.9:1):mobile?.95:square?.76:.88),Number(c.upgradeWeight||400),doubleMemoryUpgrade(p)?(dark?'#ffcc66':'#b54708'):c.upgradeColor||colors.accent,1.25,true);}
     const labelBase=unifiedPanel?requested*nameScale:tightRows?Math.min(18,requested*nameScale):square?13:16;
     const labelSize=spec(key+'.label',labelBase,unifiedPanel?700:tightRows?400:600,colors.accent);
     measure.font=font(labelSize);
     const labelHeight=wrapText(measure,label,categoryWidth-inset-labelGap).length*labelSize.size*(unifiedPanel||tightRows?1.25:1.32);
     const rowHeight=Math.max(h,labelHeight)+inner*2;
     const nameSize=spec(key+'.name',requested*nameScale,weight,color).size;
     const labelTop=unifiedPanel?top+(rowHeight-labelHeight)/2:tightRows?top+inner+(nameSize-labelSize.size)*1.25/2:top+(rowHeight-labelHeight)/2;
     block(key+'.label',`${p.slot} 分类`,m.id,label,pad+inset,labelTop,categoryWidth-inset-labelGap,labelBase,unifiedPanel?700:tightRows?400:600,colors.accent,unifiedPanel||tightRows?1.25:1.32,true,unifiedPanel?'center':'left');
     if(!mobile&&!unifiedPanel)ops.splice(opStart,0,ctx=>{ctx.fillStyle=colors.panel;ctx.beginPath();ctx.roundRect(pad,top,content,rowHeight,12);ctx.fill();if(!tightRows){ctx.strokeStyle=colors.line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(nameX-13,top+inner);ctx.lineTo(nameX-13,top+rowHeight-inner);ctx.stroke();}});
     y+=rowHeight+space(mobile?7:8);
    }
    const panelBottom=y;y+=unifiedPanel?Math.max(8,gap):gap;
    if(mobile||unifiedPanel){const panelY=unifiedPanel?panelTop:start,panelHeight=(unifiedPanel?panelBottom:y)-panelY;ops.splice(opStartModule,0,ctx=>{ctx.fillStyle=colors.panel;ctx.beginPath();ctx.roundRect(pad,panelY,content,panelHeight,unifiedPanel?10:12);ctx.fill();});}
   }else if(m.type==='service'){
    if(!String(m.text||'').trim())continue;
    const s=spec(`${m.id}.text`,Number(m.size)*(square?.9:1),weight,m.color||shopServiceTextColor(c.shopId,c.theme));
    if(!c.textStyles?.[`${m.id}.text`]?.fontFamily&&m.fontFamily)s.fontFamily=m.fontFamily;
    measure.font=font(s);const lines=wrapText(measure,m.text,content-28),lh=s.size*1.35,inner=(mobile?4:square?7:9)+stretch,height=lines.length*lh+inner*2,top=y;
    const custom=c.textStyles?.[`${m.id}.text`];
    if(c.textTransforms?.[c.layout]?.[`${m.id}.text`]?.boxWidth!==undefined||c.textTransforms?.[c.layout]?.[`${m.id}.text`]?.boxHeight!==undefined||custom&&(custom.text!==undefined||custom.ranges?.length||custom.x!==undefined||custom.y!==undefined||custom.width!==undefined)){
     const at=ops.length;const h=block(`${m.id}.text`,'服务承诺文字',m.id,m.text,pad+14,top+inner,content-28,Number(m.size)*(square?.9:1),weight,m.color||shopServiceTextColor(c.shopId,c.theme),1.35,unifiedPanel,unifiedPanel?'center':'left');
     ops.splice(at,0,ctx=>{ctx.fillStyle=m.background||shopServiceColor(c.shopId,c.theme);ctx.beginPath();ctx.roundRect(pad,top,content,h+inner*2,10);ctx.fill();});
     y+=h+inner*2+gap;
    }else{
    ops.push(ctx=>{ctx.fillStyle=m.background||shopServiceColor(c.shopId,c.theme);ctx.beginPath();ctx.roundRect(pad,top,content,height,10);ctx.fill();});
    addText({key:`${m.id}.text`,label:'服务承诺文字',value:String(m.text||''),moduleId:m.id,x:pad+14,top:top+inner,width:content-28,height:lines.length*lh,...s},ctx=>{ctx.save();ctx.font=font(s);ctx.fillStyle=s.color;ctx.textAlign='center';if(unifiedPanel)ctx.textBaseline='middle';lines.forEach((text,i)=>ctx.fillText(text,base/2,top+inner+(i+(unifiedPanel?.5:0))*lh));ctx.restore();});
    y+=height+gap;
    }
   }else if(['addons','benefits','custom'].includes(m.type)){
    const entries=moduleEntries(c,m);
    if(!entries?.length)continue;
    const blockStart=y,opStart=ops.length,inner=unifiedPanel?12:square?9:8;
    const addon=m.type==='addons'?shopAddonColors(c.shopId,c.theme):null,moduleText=m.color||(unifiedPanel&&m.type==='addons'&&!addon?colors.accent:addon?.text)||color,moduleMuted=unifiedPanel&&m.type==='addons'&&!addon?colors.accent:addon?.muted||colors.muted;
    y+=inner;y+=block(`${m.id}.title`,`${m.title} 标题`,m.id,m.title,pad+inner,y,content-inner*2,unifiedPanel?(square?19:22):square?13:16,700,m.color||(unifiedPanel&&m.type==='addons'&&!addon?colors.accent:addon?.title)||color)+space(7);
    const columns=m.type!=='custom'&&entries.length>1?2:1,colGap=16,colWidth=(content-inner*2-colGap*(columns-1))/columns;
    for(let i=0;i<entries.length;i+=columns){let rowHeight=0;y+=stretch;
     for(let col=0;col<columns&&i+col<entries.length;col++){
      const {index,entry}=entries[i+col],text=typeof entry==='string'?entry:entry.text,note=typeof entry==='string'?'':entry.note,x=pad+inner+col*(colWidth+colGap);
      let h=block(`${m.id}.${index}.text`,`${m.title} ${index+1}`,m.id,text,x,y,colWidth,size,weight,moduleText);
      if(note)h+=block(`${m.id}.${index}.note`,`${m.title} ${index+1} 说明`,m.id,note,x,y+h,colWidth,square?9:12,400,moduleMuted);
      rowHeight=Math.max(rowHeight,h);
     }y+=rowHeight+space(7)+stretch;
    }
    y+=inner/2;const blockH=y-blockStart;ops.splice(opStart,0,ctx=>{ctx.fillStyle=addon?.bg||colors.panel;ctx.beginPath();ctx.roundRect(pad,blockStart,content,blockH,unifiedPanel?10:square?12:16);ctx.fill();});y+=gap;
   }else if(m.type==='footer'){
    y+=block(`${m.id}.text`,'页脚说明',m.id,c.footer||'',pad,y,content,unifiedPanel?Math.max(14,size):size,weight,m.color||colors.muted,1.4)+gap;
   }
   const region={id:m.id,key:'module:'+m.id,label:m.title||m.type,x:pad,top:start,width:content,height:Math.max(1,y-start),bottom:y};
   const moduleOps=ops.splice(opStartModule);
   ops.push(ctx=>{const frame=moduleFrame(region,drawingConfig.moduleTransforms?.[drawingConfig.layout]?.[m.id]);ctx.save();ctx.translate(frame.x,frame.top);ctx.scale(frame.sx,frame.sy);ctx.translate(-region.x,-region.top);moduleOps.forEach(op=>op(ctx));ctx.restore();});
   regions.push(region);
  }
  return{needed:Math.ceil(Math.max(y,...regions.map(r=>moduleFrame(r,c.moduleTransforms?.[c.layout]?.[r.id]).bottom),...textRegions.map(r=>r.top+r.height))+pad),ops,regions,textRegions,imageDefault,density,stretch};
 }
 let result=fixed?layout(fixed.density||1,fixed.stretch||0):layout(1);
 if(!fixed&&square)for(let n=1;result.needed>base&&n<=10;n++)result=layout(1-n*.035);
 // Very tall descriptions may need more square space than the longest model alone.
 if(autoWidth&&square&&!fixed&&result.needed>base){for(let n=0;result.needed>base&&n<12;n++){base=Math.ceil(Math.max(base+12,result.needed));result=layout(result.density);}}
 const height=square?base:fixed?.height||(autoWidth?result.needed:Math.max(Math.round(base*1.31),result.needed)),overflow=!fixed&&square&&result.needed>base;
 if(!fixed&&!overflow&&stretchUnits&&height>result.needed)result=layout(result.density,(height-result.needed)/stretchUnits);
 const canvas=document.createElement('canvas');canvas.width=Number(width);canvas.height=Math.ceil(height*width/base);
 if(canvas.height>22000)throw Error('图片过长，请减少模块或选择较小导出宽度');
 const ctx=canvas.getContext('2d');ctx.scale(width/base,width/base);ctx.fillStyle=colors.bg;ctx.fillRect(0,0,base,height);ctx.textBaseline='top';
 // Keep the expensive text/layout render while moving images in the editor.
 const background=interactive?document.createElement('canvas'):null;
 if(background){background.width=canvas.width;background.height=canvas.height;background.getContext('2d').drawImage(canvas,0,0);}
 const layerImages=new Map(await Promise.all((c.posterImages||[]).map(async layer=>[layer.url,await getImage(layer.url)])));
 const output={canvas,overflow,needed:result.needed,height,regions:result.regions,textRegions:result.textRegions,imageRegion:null,addedImageRegions:[],base,autoWidth,tightRows,unifiedPanel,compact:mobile,centeredHeader,titleUnderLogo,padding:false,fit:1,offsetX:0,offsetY:0,density:result.density,stretch:result.stretch};
 function drawImages(config){
 if(background){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(background,0,0);ctx.restore();}
 let imageRegion=null;
 if(image&&result.imageDefault){
  const custom=config.caseTransforms?.[config.layout]||{},size=bound(Number(custom.size)||result.imageDefault.size,45,Math.min(base,height));
  const width=bound(Number(custom.width)||size,45,base),frameHeight=bound(Number(custom.height)||size,45,height);
  const x=bound(Number.isFinite(custom.x)?custom.x:result.imageDefault.x,0,base-width),top=bound(Number.isFinite(custom.y)?custom.y:result.imageDefault.y,0,height-frameHeight);
  imageRegion={key:'case-image',x,top,width,height:frameHeight,size};
  const ratio=Math.min(size/image.width,size/image.height),w=image.width*ratio*width/size,h=image.height*ratio*frameHeight/size;ctx.drawImage(image,x+(width-w)/2,top+(frameHeight-h)/2,w,h);
 }
 const addedImageRegions=[];
 // Additional images are painted last; the end of the array is the top layer.
 for(const layer of config.posterImages||[]){
  const added=layerImages.get(layer.url);if(!added)throw Error('添加的图片缺少素材，请移除后重新添加');
  const region=posterImageRegion(layer,config.layout,base,height);
  ctx.drawImage(added,region.x,region.top,region.width,region.height);addedImageRegions.push(region);
 }
 // Mask the complete composition, including images moved over the outer edge.
 // Transparent PNG corners keep the same silhouette in preview and export.
 ctx.save();ctx.setTransform(width/base,0,0,width/base,0,0);
 ctx.globalCompositeOperation='destination-in';ctx.fillStyle='#000';
 ctx.beginPath();ctx.roundRect(0,0,base,height,18);ctx.fill();ctx.restore();
 output.imageRegion=imageRegion;output.addedImageRegions=addedImageRegions;return output;
 }
 function drawLayout(config){
  drawingConfig=config;ctx.save();ctx.setTransform(width/base,0,0,width/base,0,0);ctx.fillStyle=colors.bg;ctx.fillRect(0,0,base,height);ctx.textBaseline='top';for(const op of result.ops)op(ctx);ctx.restore();
  if(background){const bg=background.getContext('2d');bg.clearRect(0,0,background.width,background.height);bg.drawImage(canvas,0,0);}
  output.regions=result.regions.map(r=>moduleFrame(r,config.moduleTransforms?.[config.layout]?.[r.id]));
  output.textRegions=result.textRegions.map(r=>displayedText(r,config.textTransforms?.[config.layout]?.[r.key],result.regions.find(m=>m.id===r.moduleId),config.moduleTransforms?.[config.layout]?.[r.moduleId]));
  if(config.freeCanvasLayouts?.[config.layout]){const bounds=[...output.regions,...output.textRegions];output.overflow=bounds.some(r=>r.x<-.5||r.top<-.5||r.x+r.width>base+.5||r.top+r.height>height+.5);output.needed=Math.max(height,...bounds.map(r=>r.top+r.height));}
  return drawImages(config);
 }
 if(interactive){output.redrawImages=drawImages;output.redrawLayout=drawLayout;}
 return drawLayout(c);
}
