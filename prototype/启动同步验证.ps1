param([ValidateSet('A','B')][string]$Account='A',[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$syncPort=if($Account -eq 'A'){4189}else{4192}
$syncDir=Join-Path $PSScriptRoot ".local/sync-device-$Account"
$syncUrl="http://127.0.0.1:$syncPort/sync.html"
$syncNode=(Get-Command node.exe -ErrorAction Stop).Source
if([int](& $syncNode -p 'process.versions.node.split(".")[0]') -lt 24){throw '需要 Node.js 24 或更新版本（本地 SQLite）'}
if(-not(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'vendor/cloudbase.js'))){throw '请先在 prototype 目录运行 npm ci 和 npm run build:sync'}
$syncRunning=$false
try{$response=Invoke-RestMethod "http://127.0.0.1:$syncPort/api/cloud-sync/config" -TimeoutSec 2;$syncRunning=!!$response.csrf}catch{}
if(-not $syncRunning){
 New-Item -ItemType Directory -Force -Path $syncDir | Out-Null
 $previousPort=$env:PORT;$previousData=$env:DATA_DIR
 try{
  $env:PORT=[string]$syncPort;$env:DATA_DIR=$syncDir
  $proc=Start-Process -FilePath $syncNode -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $syncDir 'server.log') -RedirectStandardError (Join-Path $syncDir 'server-error.log') -PassThru
  $proc.Id | Set-Content -LiteralPath (Join-Path $syncDir 'server.pid')
 }finally{$env:PORT=$previousPort;$env:DATA_DIR=$previousData}
 for($attempt=0;$attempt -lt 20;$attempt++){try{$response=Invoke-RestMethod "http://127.0.0.1:$syncPort/api/cloud-sync/config" -TimeoutSec 1;if($response.csrf){$syncRunning=$true;break}}catch{};Start-Sleep -Milliseconds 250}
 if(-not $syncRunning){throw '启动失败，请查看验证目录的 server-error.log'}
}
if(-not $NoBrowser){Start-Process $syncUrl}
Write-Host "同步验证已启动：$syncUrl"
