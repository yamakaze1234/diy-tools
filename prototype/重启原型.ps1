param([switch]$CheckOnly)
& (Join-Path $PSScriptRoot 'restart-prototype.ps1') -CheckOnly:$CheckOnly
