import {requireWorkspaceLogin} from './workspace-auth.js';
// Waiting for user input must not keep Electron's initial loadURL pending.
async function start(){
 try{
  await requireWorkspaceLogin();
  await import('./app.js');
  document.body.classList.remove('login-required');
 }catch(error){document.querySelector('#login-message').textContent=error.message;}
}
start();
