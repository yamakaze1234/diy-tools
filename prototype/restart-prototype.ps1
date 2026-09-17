param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$prototypeRoot = $PSScriptRoot
$prototypeUrl = 'http://127.0.0.1:4178'
$prototypeLocal = Join-Path $prototypeRoot '.local'
if ($CheckOnly) {
    foreach ($prototypeScript in @('restart-prototype.ps1', 'start-prototype.ps1')) {
        $prototypeTokens = $null
        $prototypeErrors = $null
        [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $prototypeRoot $prototypeScript), [ref]$prototypeTokens, [ref]$prototypeErrors) | Out-Null
        if ($prototypeErrors.Count) { throw ($prototypeErrors | Out-String) }
    }
    Write-Host '启动入口检查通过：批处理、PowerShell 和脚本路径正常。未重启服务。'
    exit 0
}
Write-Host '正在核对数据并重启工作台…'
$prototypeConnection = Get-NetTCPConnection -LocalPort 4178 -State Listen -ErrorAction SilentlyContinue
if ($prototypeConnection) {
    $prototypeState = Invoke-RestMethod "$prototypeUrl/api/state" -TimeoutSec 3
    $prototypeProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($prototypeConnection.OwningProcess)"
    if (-not $prototypeState.configs -or $prototypeProcess.Name -ne 'node.exe' -or $prototypeProcess.CommandLine -notmatch '(?:prototype[/\\])?server\.mjs') {
        throw '4178 端口不是已识别的工作台服务，未停止任何进程。'
    }
    $prototypeDisk = Get-Content -LiteralPath (Join-Path $prototypeLocal 'state.json') -Raw | ConvertFrom-Json
    if ($prototypeDisk.revision -ne $prototypeState.revision -or ($prototypeDisk.configs.id -join '|') -ne ($prototypeState.configs.id -join '|')) {
        throw '服务数据与此目录不一致，未停止任何进程。'
    }
    $prototypeBackup = Join-Path $prototypeLocal ('before-restart-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
    Copy-Item -LiteralPath (Join-Path $prototypeLocal 'state.json') -Destination $prototypeBackup
    Write-Host "数据已备份：$prototypeBackup"
    Stop-Process -Id $prototypeConnection.OwningProcess
}
& (Join-Path $prototypeRoot 'start-prototype.ps1')
Write-Host '服务已重新启动。原有浏览器页面可刷新继续使用。'
