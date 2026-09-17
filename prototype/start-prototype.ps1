$ErrorActionPreference = 'Stop'
$prototypeRoot = $PSScriptRoot
$prototypeUrl = 'http://127.0.0.1:4178'
$prototypeRunning = $false
try {
    $prototypeState = Invoke-RestMethod "$prototypeUrl/api/state" -TimeoutSec 2
    $prototypeRunning = $null -ne $prototypeState.configs
} catch { }
if (-not $prototypeRunning) {
    $prototypeNode = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $prototypeNode) {
        $prototypeNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    }
    if (-not (Test-Path -LiteralPath $prototypeNode)) { throw '未找到 Node.js。请安装 Node.js 后重新启动。' }
    $prototypeLocal = Join-Path $prototypeRoot '.local'
    New-Item -ItemType Directory -Path $prototypeLocal -Force | Out-Null
    $prototypeProcess = Start-Process -FilePath $prototypeNode -ArgumentList 'server.mjs' -WorkingDirectory $prototypeRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $prototypeLocal 'server.log') -RedirectStandardError (Join-Path $prototypeLocal 'server-error.log') -PassThru
    $prototypeProcess.Id | Set-Content -LiteralPath (Join-Path $prototypeLocal 'server.pid')
    for ($prototypeAttempt = 0; $prototypeAttempt -lt 20; $prototypeAttempt++) {
        try { $prototypeState = Invoke-RestMethod "$prototypeUrl/api/state" -TimeoutSec 1; $prototypeRunning = $null -ne $prototypeState.configs; if ($prototypeRunning) { break } } catch { }
        Start-Sleep -Milliseconds 250
    }
    if (-not $prototypeRunning) { throw '启动失败，请查看 .local/server-error.log。' }
}
Start-Process $prototypeUrl
Write-Output "工作台已启动：$prototypeUrl"
