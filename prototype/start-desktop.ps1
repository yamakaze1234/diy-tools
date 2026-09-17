param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$desktopTemp = 'D:\temp'
$releaseRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'release'
$desktopBuild = Get-ChildItem -LiteralPath $releaseRoot -Filter 'DIY配置工作台-*.exe' -File |
    Where-Object { $_.BaseName -match '^DIY配置工作台-\d+\.\d+\.\d+$' } |
    Sort-Object { [version]($_.BaseName -replace '^DIY配置工作台-', '') } -Descending |
    Select-Object -First 1
if (-not $desktopBuild) { throw 'release 目录中没有找到工作台桌面版。' }
if (-not (Test-Path -LiteralPath 'D:\' -PathType Container)) { throw 'D 盘不可用，无法创建工作台临时目录。' }
[IO.Directory]::CreateDirectory($desktopTemp) | Out-Null

# Only the portable launcher and its child processes inherit these values.
$desktopStart = [Diagnostics.ProcessStartInfo]::new()
$desktopStart.FileName = $desktopBuild.FullName
$desktopStart.WorkingDirectory = $releaseRoot
$desktopStart.UseShellExecute = $false
$desktopStart.Environment['TEMP'] = $desktopTemp
$desktopStart.Environment['TMP'] = $desktopTemp
if ($CheckOnly) {
    [pscustomobject]@{
        Executable = $desktopStart.FileName
        TEMP = $desktopStart.Environment['TEMP']
        TMP = $desktopStart.Environment['TMP']
        UserTEMP = [Environment]::GetEnvironmentVariable('TEMP', 'User')
        UserTMP = [Environment]::GetEnvironmentVariable('TMP', 'User')
    } | ConvertTo-Json
    return
}
[Diagnostics.Process]::Start($desktopStart) | Out-Null
