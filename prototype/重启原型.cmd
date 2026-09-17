@echo off
setlocal
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell 7 was not found. Please install it and try again.
  pause
  exit /b 1
)
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-prototype.ps1" %*
if errorlevel 1 (
  echo Restart failed. See the error above.
  pause
  exit /b 1
)
exit /b 0
