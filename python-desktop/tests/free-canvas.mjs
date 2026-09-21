import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const root=path.resolve('python-desktop');
const {chromium}=createRequire(import.meta.url)(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const directory=await fs.mkdtemp(path.join(root,'.verification/free-canvas-')),data=path.join(directory,'data');
const child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8',path.join(root,'tests/local_first_harness.py'),'--headless','--port','0'],{windowsHide:true,env:{...process.env,DIY_WORKBENCH_DATA_DIR:data,DIY_WORKBENCH_USER_DATA:path.join(directory,'profile')},stdio:['ignore','pipe','pipe']});
let logs='',browser;child.stderr.on('data',b=>logs+=b);
const sdk=`let session=null;export default {init(){return {auth:{onAuthStateChange(){},async signInWithPassword(v){session={access_token:v.username,user:{is_anonymous:false}};return{data:{session}};},async getSession(){return{data:{session}}},async signOut(){session=null;return{}}}}}};`;
const report={checks:[],directory};
try{
 const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Startup timeout '+logs)),20000);child.stdout.on('data',b=>{output+=b;const match=output.match(/WORKBENCH_READY (http:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});child.once('exit',code=>reject(Error('Test backend exited '+code+' '+logs)));});
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',r=>r.abort());
 await page.route('**/vendor/cloudbase.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));

 await page.addInitScript(()=>{window.createdCanvases=0;const create=document.createElement.bind(document);document.createElement=(tag,...args)=>{if(tag==='canvas')window.createdCanvases++;return create(tag,...args);};});
 const login=async()=>{await page.waitForFunction(()=>typeof document.querySelector('#startup-login')?.onsubmit==='function');await page.locator('[name=username]').fill('A');await page.locator('[name=password]').fill('synthetic');await page.locator('#startup-login button').click();await page.waitForFunction(()=>document.querySelector('#add-special-page'));await page.waitForFunction(()=>document.querySelector('#poster').height>500);};
 await page.goto(url);await login();
 const state=async()=>(await page.request.get(url+'/api/state')).json();
 const saved=()=>page.waitForFunction(()=>document.querySelector('#save-status').textContent.startsWith('已保存'));
 const config=async()=>(await state()).configs[0];
 const regions=async c=>page.evaluate(async c=>{const {renderPoster}=await import('/poster.js');const r=await renderPoster(c,700);return {texts:r.textRegions,modules:r.regions,width:r.canvas.width,height:r.canvas.height};},c);
 const initial=await config(),initialRegions=await regions(initial);
 await page.locator('#preview-expand').click();await page.locator('#poster-zoom').selectOption('100');await page.locator('#poster-object-select').selectOption('header.version');
 const move=async(dx,dy,handle=null)=>{const r=await page.locator(handle||'#poster-selection').boundingBox();const x=r.x+(handle?r.width/2:Math.min(20,r.width/2)),y=r.y+(handle?r.height/2:Math.min(10,r.height/2));await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up();};
 await page.evaluate(()=>window.createdCanvases=0);await move(70,35);const dragCanvases=await page.evaluate(()=>window.createdCanvases);assert.equal(dragCanvases,0,'text drag must not allocate canvases');await saved();
 const moved=await config(),movedRegions=await regions(moved),before=initialRegions.texts.find(r=>r.key==='header.version'),after=movedRegions.texts.find(r=>r.key==='header.version');
 assert.ok(Math.abs(after.x-before.x-70)<2);assert.ok(Math.abs(after.top-before.top-35)<2);assert.equal(movedRegions.height,initialRegions.height);const business=parts=>parts.map(p=>[p.slot,p.name,p.goodsId,p.qty,p.erp,p.tax]);assert.deepEqual(business(moved.parts),business(initial.parts));
 const unaffected=rs=>rs.texts.filter(r=>r.key!=='header.version').map(r=>[r.key,r.x,r.top,r.width,r.height]);assert.deepEqual(unaffected(movedRegions),unaffected(initialRegions));report.checks.push('文字拖动实时跟随，周围排版与配件数据不变，拖动不创建画布');
 await move(50,25,'#case-resize-handle');await saved();const resized=await config();assert.ok(resized.textTransforms.long['header.version'].scaleX>1);
 await page.keyboard.down('Shift');await move(35,-5,'#case-resize-handle');await page.keyboard.up('Shift');await saved();const stretched=await config();assert.notEqual(stretched.textTransforms.long['header.version'].scaleX,stretched.textTransforms.long['header.version'].scaleY);await page.locator('#poster-undo').click();await saved();assert.deepEqual((await config()).textTransforms,resized.textTransforms);report.checks.push('Shift 拖动文字四角可非等比拉伸，撤销恢复');await page.locator('#poster-object-select').selectOption('header.version');
 await page.locator('#poster-stage').focus();await page.keyboard.press('ArrowRight');await saved();const nudged=await config();assert.ok(nudged.textTransforms.long['header.version'].x>resized.textTransforms.long['header.version'].x);
 await page.locator('#preview-expand').click();await page.locator('#undo').click();await saved();assert.deepEqual((await config()).textTransforms,resized.textTransforms);await page.locator('#redo').click();await saved();assert.deepEqual((await config()).textTransforms,nudged.textTransforms);report.checks.push('文字四角缩放、方向键微调、撤销和重做');
 await page.locator('#preview-expand').click();await page.locator('#poster-object-select').selectOption('module:parts');assert.equal(await page.locator('#poster-pick-mode').inputValue(),'modules');
 await move(12,25);await saved();const moduleMoved=await config();assert.ok(moduleMoved.moduleTransforms.long.parts.x>26);
 await page.locator('#case-resize-handle').scrollIntoViewIfNeeded();await move(-90,-40,'#case-resize-handle');await saved();const moduleResized=await config();assert.ok(moduleResized.moduleTransforms.long.parts.width<moduleMoved.moduleTransforms.long.parts.width);report.checks.push('整个模块包含文字和底板一起移动、缩放');
 // Zoom changes only the view. At 200%, a 40px pointer movement is 20 canvas units.
 await page.locator('#poster-object-select').selectOption('header.version');await page.locator('#poster-zoom').selectOption('200');await page.locator('#poster-selection').scrollIntoViewIfNeeded();const beforeZoom=await config();const outputSize=await page.locator('#poster').evaluate(c=>[c.width,c.height]);await move(40,0);await saved();const afterZoom=await config();assert.ok(Math.abs(afterZoom.textTransforms.long['header.version'].x-beforeZoom.textTransforms.long['header.version'].x-20)<2);assert.deepEqual(await page.locator('#poster').evaluate(c=>[c.width,c.height]),outputSize);
 await page.locator('#poster-stage').focus();const scrollBefore=await page.locator('#preview-scroll').evaluate(el=>el.scrollLeft);const scrollBox=await page.locator('#preview-scroll').boundingBox();await page.keyboard.down('Space');await page.mouse.move(scrollBox.x+200,scrollBox.y+160);await page.mouse.down();await page.mouse.move(scrollBox.x+130,scrollBox.y+160,{steps:6});await page.mouse.up();await page.keyboard.up('Space');const scrollAfter=await page.locator('#preview-scroll').evaluate(el=>el.scrollLeft);assert.ok(scrollAfter>scrollBefore);report.checks.push('200% 缩放定位准确，不改导出尺寸；空格拖动画布');
 report.render=await page.evaluate(async c=>{const {renderPoster}=await import('/poster.js');const fast=await renderPoster(c,700,{interactive:true});const originalHeight=fast.canvas.height;c.textTransforms.long['header.version'].x+=15;fast.redrawLayout(c);const full=await renderPoster(c,700);const a=fast.canvas.getContext('2d').getImageData(0,0,fast.canvas.width,fast.canvas.height).data,b=full.canvas.getContext('2d').getImageData(0,0,full.canvas.width,full.canvas.height).data;return {pixelsEqual:a.length===b.length&&a.every((v,i)=>v===b[i]),dimensionsStable:originalHeight===full.canvas.height};},afterZoom);assert.equal(report.render.pixelsEqual,true);assert.equal(report.render.dimensionsStable,true);report.checks.push('缓存预览与完整导出像素一致');

 const legacySource=await fs.readFile(path.resolve('release/python-0.3.8-20260918-103721/DIY配置工作台-Python-0.3.8/_internal/web/poster.js'),'utf8');await page.route('**/legacy-poster.js',r=>r.fulfill({contentType:'text/javascript',body:legacySource}));
 report.legacy=await page.evaluate(async initial=>{const current=await import('/poster.js'),old=await import('/legacy-poster.js');const checks=[];for(const shopId of ['intel','jonsbo'])for(const layout of ['long','square']){const c={...structuredClone(initial),shopId,layout};const a=await old.renderPoster(c,700),b=await current.renderPoster(c,700);const x=a.canvas.getContext('2d').getImageData(0,0,a.canvas.width,a.canvas.height).data,y=b.canvas.getContext('2d').getImageData(0,0,b.canvas.width,b.canvas.height).data;checks.push({shopId,layout,pixelsEqual:x.length===y.length&&x.every((v,i)=>v===y[i])});}return checks;},initial);assert.ok(report.legacy.every(r=>r.pixelsEqual),'existing layout must remain pixel-identical');report.checks.push('未使用自由编辑的长图、方图及品牌 Logo 保持原版像素');
 const square=await page.evaluate(async c=>{c.layout='square';const {renderPoster}=await import('/poster.js');const a=await renderPoster(c,700);delete c.textTransforms;delete c.moduleTransforms;delete c.freeCanvasLayouts;const b=await renderPoster(c,700);return {size:[a.canvas.width,a.canvas.height],same:JSON.stringify(a.textRegions)===JSON.stringify(b.textRegions)};},afterZoom);assert.deepEqual(square.size,[700,700]);assert.equal(square.same,true);report.checks.push('长图自由位置不串到方图');
 await page.locator('#poster-zoom').selectOption('fit');await page.locator('#poster-object-select').selectOption('header.version');await page.locator('#preview-scroll').evaluate(el=>{el.scrollLeft=0;el.scrollTop=0;});await page.screenshot({path:path.join(root,'verification/free-canvas-0.3.10.png')});
 await page.reload();await login();assert.deepEqual((await config()).textTransforms,afterZoom.textTransforms);assert.deepEqual((await config()).moduleTransforms,afterZoom.moduleTransforms);report.checks.push('保存并重新登录后文字和模块位置保留');
 // Exercise all four image handles and persistence using a synthetic asset.
 await page.locator('#preview-expand').click();await page.locator('#poster-zoom').selectOption('100');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=200;c.getContext('2d').fillRect(0,0,400,200);return c.toDataURL().split(',')[1];});
 await page.locator('#poster-image-file').setInputFiles({name:'stretch.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.locator('#poster-image-size').waitFor();await saved();
 for(const corner of ['nw','ne','sw','se']){
  const before=(await config()).posterImages[0].transforms.long||{width:220,height:110};
  await page.keyboard.down('Shift');await move(corner.includes('w')?-20:20,0,`[data-resize="${corner}"]`);await page.keyboard.up('Shift');await saved();
  const after=(await config()).posterImages[0].transforms.long;
  assert.ok(Math.abs(after.width-before.width-20)<2);assert.ok(Math.abs(after.height-(before.height||before.width/2))<2);
 }
 const imageBefore=(await config()).posterImages[0].transforms.long;
 await move(20,0,'#case-resize-handle');await saved();const imageAfter=(await config()).posterImages[0].transforms.long;
 assert.ok(Math.abs(imageBefore.width/imageBefore.height-imageAfter.width/imageAfter.height)<.01);
 await page.locator('#poster-image-x').fill('60');await saved();assert.equal((await config()).posterImages[0].transforms.long.height,imageAfter.height);
 const imageSaved=(await config()).posterImages;await page.reload();await login();assert.deepEqual((await config()).posterImages,imageSaved);
 report.checks.push('图片四角 Shift 仅拉宽保持高度，默认缩放保持比例，改位置与重开保留宽高');
 report.imageRender=await page.evaluate(async c=>{const {renderPoster}=await import('/poster.js');c.caseImage=c.posterImages[0].url;c.caseTransforms={long:{x:30,y:180,size:180,width:300,height:90}};const fast=await renderPoster(c,700,{interactive:true});c.caseTransforms.long.width=250;c.posterImages[0].transforms.long.height=160;fast.redrawImages(c);const full=await renderPoster(c,700);const a=fast.canvas.getContext('2d').getImageData(0,0,fast.canvas.width,fast.canvas.height).data,b=full.canvas.getContext('2d').getImageData(0,0,full.canvas.width,full.canvas.height).data;return {equal:a.every((v,i)=>v===b[i]),caseSize:[full.imageRegion.width,full.imageRegion.height]};},await config());
 assert.equal(report.imageRender.equal,true);assert.deepEqual(report.imageRender.caseSize,[250,90]);report.checks.push('机箱图及添加图非等比预览与完整导出像素一致');
 assert.deepEqual(errors,[]);report.dragCanvases=dragCanvases;report.ok=true;console.log(JSON.stringify(report,null,2));
}finally{if(browser)await browser.close();child.kill();await new Promise(resolve=>child.once('exit',resolve));await fs.writeFile(path.join(root,'verification/free-canvas-0.3.10.json'),JSON.stringify(report,null,2));}
