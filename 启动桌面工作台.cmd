@echo off
setlocal
set "WORKBENCH_PWSH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"
if not exist "%WORKBENCH_PWSH%" set "WORKBENCH_PWSH=pwsh.exe"
"%WORKBENCH_PWSH%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0python-desktop\start.ps1"
if errorlevel 1 pause
