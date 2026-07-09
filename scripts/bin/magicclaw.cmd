@echo off
setlocal
REM MagicClaw Windows launcher (Git Bash or install.ps1 recommended for full CLI).
REM Usage: magicclaw.cmd start|stop|status|setup

set "APP_ROOT=%~dp0.."
set "MAGICCLAW_HOME=%MAGICCLAW_HOME%"
if "%MAGICCLAW_HOME%"=="" set "MAGICCLAW_HOME=%USERPROFILE%\.magicclaw"

where bash >nul 2>&1
if %ERRORLEVEL%==0 (
  bash "%APP_ROOT%\bin\magicclaw" %*
  exit /b %ERRORLEVEL%
)

echo MagicClaw requires Git Bash or PowerShell install.ps1 on Windows.
echo Download: https://github.com/santarosalia/magicclaw/releases/latest
exit /b 1
