@echo off
setlocal
REM MagicClaw Windows launcher — delegates to native PowerShell runtime.
REM Usage: magicclaw.cmd start|stop|status|setup

if "%MAGICCLAW_HOME%"=="" set "MAGICCLAW_HOME=%USERPROFILE%\.magicclaw"

where pwsh >nul 2>&1
if %ERRORLEVEL%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0magicclaw.ps1" %*
  exit /b %ERRORLEVEL%
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0magicclaw.ps1" %*
exit /b %ERRORLEVEL%
