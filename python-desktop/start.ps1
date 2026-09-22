param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$releaseRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'release'
$pythonApp = Get-ChildItem -LiteralPath $releaseRoot -Directory -Filter 'python-*' |
    ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Directory -Filter 'DIY配置工作台-*' } |
    ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -File -Filter 'DIY配置工作台-*.exe' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $pythonApp) { throw '未找到 Python 桌面版，请先运行 python-desktop/build.py 打包。' }
if ($CheckOnly) { [pscustomobject]@{Backend='Python';Executable=$pythonApp.FullName;WorkingDirectory=$pythonApp.DirectoryName} | ConvertTo-Json; return }
$launchInfo = [Diagnostics.ProcessStartInfo]::new()
$launchInfo.FileName = $pythonApp.FullName
$launchInfo.WorkingDirectory = $pythonApp.DirectoryName
$launchInfo.UseShellExecute = $false
[Diagnostics.Process]::Start($launchInfo) | Out-Null
