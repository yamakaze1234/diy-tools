import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {modulesDefault,posterModules} from '../core.js';
import {makeZip} from '../zip.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const canvasPath=process.env.CANVAS_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const {createCanvas,Image}=require(canvasPath);
globalThis.document={fonts:{ready:Promise.resolve()},createElement:()=>createCanvas(1,1)};
globalThis.Image=class extends Image {set src(value){super.src=fs.readFileSync(path.join(root,value));}get src(){return super.src;}};
const {renderPoster}=await import('../poster.js');
const out=path.join(root,'verification');fs.mkdirSync(out,{recursive:true});
const seed=JSON.parse(fs.readFileSync(path.join(root,'seed.json'))),rows=[],files=[];
for(const theme of ['light','dark'])for(const layout of ['long','square']){
 const c=structuredClone(seed.configs[0]);c.modules=modulesDefault();c.theme=theme;c.layout=layout;c.benefits=[{text:'福利模块验证：完整保留底部文字',note:''}];c.parts[2].name+=' · 这是一条用于验证自动换行的长配件名称';
 const r=await renderPoster(c,1400);assert.equal(r.overflow,false);assert.ok(r.regions.every(x=>x.bottom<=r.height));
 const pixel=[...r.canvas.getContext('2d').getImageData(0,0,1,1).data];
 if(layout==='square'){assert.equal(r.canvas.width,r.canvas.height);assert.deepEqual(pixel,theme==='dark'?[7,23,46,255]:[255,255,255,255]);assert.equal(r.fit,1);assert.equal(r.padding,false);}else assert.ok(r.canvas.height>r.canvas.width);
 const name=`${theme}_${layout}.png`,bytes=r.canvas.toBuffer('image/png');fs.writeFileSync(path.join(out,name),bytes);files.push({name,bytes});rows.push({theme,layout,width:r.canvas.width,height:r.canvas.height,allModulesInside:r.regions.every(x=>x.bottom<=r.height),corner:pixel,fit:r.fit});
}
const example=structuredClone(seed.configs[0]);example.layout='square';
const original=await renderPoster(example,1400);example.caseTransforms={square:{x:400,y:40,size:190}};
const moved=await renderPoster(example,1400);assert.deepEqual(moved.textRegions,original.textRegions);assert.equal(moved.imageRegion.size,190);
example.textStyles={'part.CPU.name':{color:'#ff7c36',weight:800,fontFamily:'Microsoft YaHei'}};
const styled=await renderPoster(example,1400);assert.equal(styled.textRegions.find(r=>r.key==='part.CPU.name').color,'#ff7c36');assert.equal(styled.textRegions.find(r=>r.key==='part.CPU.name').weight,800);assert.equal(styled.textRegions.find(r=>r.key==='part.主板.name').color,original.textRegions.find(r=>r.key==='part.主板.name').color);
let squareCount=0;for(const config of seed.configs){const r=await renderPoster({...config,layout:'square'},700);assert.equal(r.overflow,false,config.name);assert.ok(r.textRegions.every(t=>t.top+t.height<=700));squareCount++;}
const excessive=structuredClone(example);excessive.parts[0].name='极长配件名'.repeat(1000);const over=await renderPoster(excessive,700);assert.equal(over.overflow,true);
for(const theme of ['light','dark'])for(const layout of ['square','long']){
 const c={...structuredClone(seed.configs[0]),theme,layout,modules:modulesDefault()},r=await renderPoster(c,1400);
 assert.equal(r.overflow,false);if(layout==='long')assert.equal(r.height,917,'常规详情图采用 1:1.31 比例');
 const names=r.textRegions.filter(t=>/^part\..*\.name$/.test(t.key));assert.equal(names.length,c.parts.filter(p=>p.name).length);assert.equal(new Set(names.map(t=>t.x)).size,1);
 for(const qty of r.textRegions.filter(t=>t.key.endsWith('.qty'))){const name=r.textRegions.find(t=>t.key===qty.key.replace(/qty$/,'name'));assert.ok(name.x+name.width<=qty.x,'数量不遮挡型号');}
 fs.writeFileSync(path.join(out,`approved-${layout}-${theme}.png`),r.canvas.toBuffer('image/png'));
 const service=c.modules.find(m=>m.type==='service');service.text='定制服务承诺第一行\n第二行可以继续编辑';service.background='#225544';service.fontFamily='SimHei';
 c.modules.splice(0,0,c.modules.splice(c.modules.indexOf(service),1)[0]);
 const edited=await renderPoster(c,1400);assert.equal(edited.regions[0].id,service.id);const text=edited.textRegions.find(t=>t.key===service.id+'.text');assert.equal(text.fontFamily,'SimHei');assert.ok(text.height>text.size*2);
 service.visible=false;const hidden=await renderPoster(c,1400);assert.ok(!hidden.textRegions.some(t=>t.key===service.id+'.text'));
 assert.equal(posterModules(JSON.parse(JSON.stringify(c))).find(m=>m.type==='service').visible,false);
 c.parts.find(p=>p.slot==='风扇').posterVisible=false;c.palette={accent:'#ffffcc',panel:'#eeffee'};
 const hiddenPart=await renderPoster(c,700);assert.ok(!hiddenPart.textRegions.some(t=>t.key.startsWith('part.风扇.')));assert.equal(hiddenPart.textRegions.find(t=>t.key==='part.内存.qty').color,'#07172e');
}
const payload={fixedSquares:squareCount,imageMovementPreservedText:true,individualTextStyle:true,overflowBlocked:true,engine:'native canvas shim using production poster.js (not browser UI)',checks:rows};fs.writeFileSync(path.join(out,'render-results.json'),JSON.stringify(payload,null,2));files.push({name:'导出清单.json',bytes:Buffer.from(JSON.stringify(payload))});const zip=makeZip(files);fs.writeFileSync(path.join(out,'export-check.zip'),Buffer.from(await zip.arrayBuffer()));console.log(JSON.stringify(payload,null,2));
