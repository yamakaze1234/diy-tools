// Layout migration is presentation-only. Preserve the previous square editor state
// so introducing the approved SKU header never destroys saved detail coordinates.
export function normalizePosterDesign(config){
 if(config.posterDesignVersion===1)return config;
 const previous={};
 for(const key of ['freeCanvasLayouts','textTransforms','moduleTransforms','caseTransforms']){
  if(config[key]?.square){previous[key]=structuredClone(config[key].square);delete config[key].square;}
 }
 if(Object.keys(previous).length)config.previousSquareLayout??=previous;
 config.skuMode??='dedicated';
 config.posterDesignVersion=1;
 return config;
}

export function paddedSquare(canvas,width){
 const square=document.createElement('canvas');square.width=square.height=width;
 const ctx=square.getContext('2d'),scale=Math.min(width/canvas.width,width/canvas.height);
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,width);
 const w=canvas.width*scale,h=canvas.height*scale;
 ctx.drawImage(canvas,(width-w)/2,(width-h)/2,w,h);
 return square;
}

// Square typography is independent from detail typography; editor writes still
// target the live configuration rather than a disposable rendering clone.
export function posterEditorConfig(config){
 if(!config||config.layout!=='square')return config;
 return new Proxy(config,{
  get(target,key){return key==='textStyles'?target.skuTextStyles:Reflect.get(target,key);},
  set(target,key,value){return Reflect.set(target,key==='textStyles'?'skuTextStyles':key,value);}
 });
}
