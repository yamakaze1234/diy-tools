const {app,BrowserWindow,dialog,shell}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
app.setName('DIYWorkbench');
app.setAppUserModelId('local.diy.workbench');
if(process.env.DIY_WORKBENCH_USER_DATA)app.setPath('userData',process.env.DIY_WORKBENCH_USER_DATA);
if(!app.requestSingleInstanceLock()){app.quit();}else{
 let window,backend,allowClose=false,closing=false,stopping=false;
 app.on('second-instance',()=>{if(window){window.restore();window.show();window.focus();}});
 app.whenReady().then(async()=>{
  const dataDir=process.env.DIY_WORKBENCH_DATA_DIR||path.join(app.getPath('userData'),'data');await fs.mkdir(dataDir,{recursive:true});
  const runtimeFile=path.join(app.getPath('userData'),'desktop-runtime.json');let rememberedPort;try{rememberedPort=JSON.parse(await fs.readFile(runtimeFile,'utf8')).port;}catch{}
  process.env.DATA_DIR=dataDir;process.env.PORT=process.env.DIY_WORKBENCH_PORT||(Number.isInteger(rememberedPort)&&rememberedPort>1024?String(rememberedPort):'4179');process.env.WORKBENCH_PORT_FALLBACK='1';
  backend=await import(pathToFileURL(path.join(__dirname,'prototype/server.mjs')).href);const port=await backend.ready,url=`http://127.0.0.1:${port}`;await fs.writeFile(runtimeFile,JSON.stringify({port}));
  window=new BrowserWindow({width:1600,height:1000,minWidth:1100,minHeight:720,title:'DIY 配置工作台',icon:path.join(__dirname,'prototype/assets/workbench-icon-v1.ico'),show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});window.removeMenu();
  window.webContents.session.webRequest.onHeadersReceived((details,callback)=>{const headers={...details.responseHeaders};if(details.url.startsWith(url+'/'))headers['Content-Security-Policy']=["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.tcloudbasegateway.com https://*.tcloudbase.com https://*.cloudbase.net https://*.tencentcloudapi.com; object-src 'none'; base-uri 'self'; frame-src 'none'"];callback({responseHeaders:headers});});
  window.webContents.session.setPermissionRequestHandler((_contents,permission,callback)=>callback(permission==='clipboard-sanitized-write'));
  window.webContents.on('will-navigate',(e,target)=>{if(new URL(target).origin!==url)e.preventDefault();});
  window.webContents.setWindowOpenHandler(({url:target})=>{if(/^https?:\/\//.test(target))shell.openExternal(target);return {action:'deny'};});
  window.on('close',event=>{if(allowClose)return;event.preventDefault();if(closing)return;closing=true;window.webContents.executeJavaScript('window.workbenchBeforeQuit ? window.workbenchBeforeQuit() : Promise.resolve()').then(()=>{allowClose=true;window.close();}).catch(error=>dialog.showErrorBox('配置尚未保存',error.message+'。请处理后再关闭工作台。')).finally(()=>{closing=false;});});
  await window.loadURL(url);window.show();if(process.env.DIY_WORKBENCH_TEST)console.log('WORKBENCH_DESKTOP_READY '+url);
 }).catch(error=>{dialog.showErrorBox('工作台启动失败',error.message);app.quit();});
 app.on('before-quit',event=>{if(window&&!window.isDestroyed()&&!allowClose){event.preventDefault();window.close();}});
 app.on('window-all-closed',async()=>{if(stopping)return;stopping=true;try{if(backend?.serverHandle.listening)await backend.closeServer();}finally{app.quit();}});
}
