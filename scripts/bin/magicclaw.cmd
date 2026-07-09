@echo off
setlocal
REM MagicClaw Windows launcher (Git Bash or install.ps1 recommended for full CLI).
REM Usage: magicclaw.cmd start|stop|status|setup

for %%I in ("%~dp0..") do set "APP_ROOT=%%~fI"
if "%MAGICCLAW_HOME%"=="" set "MAGICCLAW_HOME=%USERPROFILE%\.magicclaw"
set "MAGICCLAW_HOME=%MAGICCLAW_HOME:\=/%"
set "MC_LAUNCHER=%APP_ROOT:\=/%/bin/magicclaw"

where bash >nul 2>&1
if %ERRORLEVEL%==0 (
  bash "%MC_LAUNCHER%" %*
  exit /b %ERRORLEVEL%
)

echo MagicClaw requires Git Bash. Install Git for Windows or re-run install.ps1.
echo Install: irm https://github.com/santarosalia/magicclaw/releases/latest/download/install.ps1 ^| iex
exit /b 1
