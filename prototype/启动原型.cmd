@echo off
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-prototype.ps1"
if errorlevel 1 (
  echo.
  echo Failed to start. See the error above.
  pause
  exit /b 1
)
exit /b 0
