# MagicClaw launcher for Windows (PowerShell).
#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command = 'help',

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($env:MAGICCLAW_INSTALL_DIR) {
    $AppRoot = [IO.Path]::GetFullPath($env:MAGICCLAW_INSTALL_DIR)
}
else {
    $AppRoot = (Resolve-Path (Join-Path $ScriptDir '..')).Path
}

$MagicClawHome = if ($env:MAGICCLAW_HOME) { $env:MAGICCLAW_HOME } else { Join-Path $env:USERPROFILE '.magicclaw' }
$MagicClawHome = [IO.Path]::GetFullPath($MagicClawHome)
$RunDir = Join-Path $MagicClawHome 'run'
$ApiPidFile = Join-Path $RunDir 'api.pid'
$WebPidFile = Join-Path $RunDir 'web.pid'
$ApiLog = Join-Path $RunDir 'api.log'
$WebLog = Join-Path $RunDir 'web.log'
$VersionFile = Join-Path $AppRoot 'VERSION'
$DefaultPort = 4000
$DefaultWebPort = 3000
$GitHubRepo = if ($env:MAGICCLAW_GITHUB_REPO) { $env:MAGICCLAW_GITHUB_REPO } else { 'santarosalia/magicclaw' }

function Write-Info([string]$Text) { Write-Host $Text }
function Write-Ok([string]$Text) { Write-Host $Text -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host $Text -ForegroundColor Yellow }
function Write-Err([string]$Text) { Write-Host $Text -ForegroundColor Red }

function Import-DotEnv {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) {
            continue
        }

        $eq = $trimmed.IndexOf('=')
        if ($eq -lt 1) {
            continue
        }

        $key = $trimmed.Substring(0, $eq).Trim()
        $value = $trimmed.Substring($eq + 1).Trim()
        if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
}

function Initialize-Env {
    New-Item -ItemType Directory -Force -Path $MagicClawHome, $RunDir | Out-Null
    $env:MAGICCLAW_HOME = $MagicClawHome

    if (-not $env:PORT) { $env:PORT = [string]$DefaultPort }
    if (-not $env:WEB_ORIGIN) { $env:WEB_ORIGIN = "http://localhost:$DefaultWebPort" }
    if (-not $env:NEXT_PUBLIC_API_URL) { $env:NEXT_PUBLIC_API_URL = "http://localhost:$($env:PORT)" }
    if (-not $env:HOSTNAME) { $env:HOSTNAME = '127.0.0.1' }

    Import-DotEnv (Join-Path $MagicClawHome '.env')
}

function Get-NodeMajorVersion {
    param([string]$NodeBin)

    $versionText = & $NodeBin --version 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $versionText) {
        return 0
    }

    if ($versionText -match '^v?(\d+)\.') {
        return [int]$Matches[1]
    }

    return 0
}

function Test-NodeFts5 {
    param([string]$NodeBin)

    # Avoid node -e on Windows PowerShell: semicolons/quotes in -e scripts are parsed by PS itself.
    $probeFile = Join-Path $env:TEMP ("magicclaw-fts5-probe-$([guid]::NewGuid().ToString('n')).cjs")
    try {
        @'
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(":memory:");
db.exec("CREATE VIRTUAL TABLE _probe USING fts5(x)");
db.exec("DROP TABLE _probe");
'@ | Set-Content -LiteralPath $probeFile -Encoding UTF8

        & $NodeBin $probeFile 1>$null 2>$null
        return $LASTEXITCODE -eq 0
    }
    finally {
        Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
    }
}

function Resolve-Node {
    $candidates = @()
    $pathNode = Get-Command node -ErrorAction SilentlyContinue
    if ($pathNode) {
        $candidates += $pathNode.Source
    }

    $bundledNode = Join-Path $AppRoot 'node\bin\node.exe'
    if (Test-Path -LiteralPath $bundledNode) {
        $candidates += $bundledNode
    }

    $usable = @()
    foreach ($candidate in $candidates) {
        if ((Get-NodeMajorVersion $candidate) -ge 22) {
            $usable += $candidate
        }
    }

    if ($usable.Count -eq 0) {
        throw 'Node.js 22+ not found. Install Node or re-run the installer.'
    }

    foreach ($candidate in $usable) {
        if (Test-NodeFts5 $candidate) {
            return $candidate
        }
    }

    Write-Warn 'Warning: no Node build with SQLite FTS5 found; session search may use LIKE fallback'
    return $usable[0]
}

function Find-WebServer {
    $candidates = @(
        (Join-Path $AppRoot 'web\apps\web\server.js'),
        (Join-Path $AppRoot 'web\server.js')
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw "Next.js standalone server.js not found under $(Join-Path $AppRoot 'web')"
}

function Test-ProcessRunning {
    param([string]$PidFile)

    if (-not (Test-Path -LiteralPath $PidFile)) {
        return $false
    }

    $pidText = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    if (-not $pidText) {
        return $false
    }

    $processId = 0
    if (-not [int]::TryParse($pidText, [ref]$processId)) {
        return $false
    }

    return $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)
}

function Get-ErrorLogPath {
    param([string]$LogFile)
    return "$LogFile.err"
}

function Read-ProcessLogs {
    param(
        [string]$LogFile,
        [int]$Tail = 40
    )

    $paths = @($LogFile, (Get-ErrorLogPath $LogFile)) | Where-Object { Test-Path -LiteralPath $_ }
    if ($paths.Count -eq 0) {
        return @()
    }

    return Get-Content -LiteralPath $paths -Tail $Tail -ErrorAction SilentlyContinue
}

function Start-MagicClawProcess {
    param(
        [string]$Name,
        [string]$NodeBin,
        [string]$WorkingDirectory,
        [string[]]$ArgumentList,
        [hashtable]$Environment = @{},
        [string]$PidFile,
        [string]$LogFile
    )

    if (Test-ProcessRunning $PidFile) {
        $existing = (Get-Content -LiteralPath $PidFile -Raw).Trim()
        Write-Warn "$Name already running (pid $existing)"
        return
    }

    $errorLog = Get-ErrorLogPath $LogFile
    New-Item -ItemType Directory -Force -Path (Split-Path $LogFile -Parent) | Out-Null
    foreach ($path in @($LogFile, $errorLog)) {
        if (-not (Test-Path -LiteralPath $path)) {
            New-Item -ItemType File -Force -Path $path | Out-Null
        }
        else {
            Clear-Content -LiteralPath $path
        }
    }

    $saved = @{}
    foreach ($key in $Environment.Keys) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], 'Process')
    }

    try {
        # Start-Process cannot redirect stdout and stderr to the same file.
        $process = Start-Process -FilePath $NodeBin `
            -ArgumentList $ArgumentList `
            -WorkingDirectory $WorkingDirectory `
            -RedirectStandardOutput $LogFile `
            -RedirectStandardError $errorLog `
            -PassThru `
            -WindowStyle Hidden

        Start-Sleep -Milliseconds 750
        if ($process.HasExited) {
            $logLines = Read-ProcessLogs -LogFile $LogFile
            $details = if ($logLines.Count -gt 0) { "`n$($logLines -join "`n")" } else { '' }
            throw "$Name failed to start (exit $($process.ExitCode)).$details"
        }

        Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ascii
        Write-Ok "$Name started (pid $($process.Id))"
    }
    finally {
        foreach ($key in $saved.Keys) {
            if ($null -eq $saved[$key]) {
                [Environment]::SetEnvironmentVariable($key, $null, 'Process')
            }
            else {
                [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process')
            }
        }
    }
}

function Stop-MagicClawProcess {
    param(
        [string]$Name,
        [string]$PidFile
    )

    if (-not (Test-ProcessRunning $PidFile)) {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        Write-Info "$Name is not running"
        return
    }

    $processId = [int]((Get-Content -LiteralPath $PidFile -Raw).Trim())
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
        $process.CloseMainWindow() | Out-Null
        if (-not $process.WaitForExit(5000)) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }

    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Ok "$Name stopped"
}

function Invoke-Start {
    Initialize-Env
    $node = Resolve-Node
    $webServer = Find-WebServer
    $webDir = Split-Path $webServer -Parent
    $webWorkDir = Split-Path (Split-Path $webDir -Parent) -Parent

    Write-Info "Starting MagicClaw API on port $($env:PORT)..."
    Start-MagicClawProcess -Name 'API' `
        -NodeBin $node `
        -WorkingDirectory (Join-Path $AppRoot 'api') `
        -ArgumentList @('dist/main.js') `
        -PidFile $ApiPidFile `
        -LogFile $ApiLog

    Write-Info "Starting MagicClaw Web on port $DefaultWebPort..."
    Start-MagicClawProcess -Name 'Web' `
        -NodeBin $node `
        -WorkingDirectory $webWorkDir `
        -ArgumentList @($webServer) `
        -Environment @{ PORT = [string]$DefaultWebPort; HOSTNAME = '127.0.0.1' } `
        -PidFile $WebPidFile `
        -LogFile $WebLog

    Write-Host ''
    Write-Info 'MagicClaw is running:'
    Write-Info "  Web UI:  http://localhost:$DefaultWebPort"
    Write-Info "  API:     http://localhost:$($env:PORT)"
    Write-Info '  Logs:    magicclaw logs'
}

function Invoke-Stop {
    Initialize-Env
    Stop-MagicClawProcess -Name 'API' -PidFile $ApiPidFile
    Stop-MagicClawProcess -Name 'Web' -PidFile $WebPidFile
}

function Invoke-Status {
    Initialize-Env

    $version = 'unknown'
    if (Test-Path -LiteralPath $VersionFile) {
        $version = (Get-Content -LiteralPath $VersionFile -Raw).Trim()
    }

    Write-Info "MagicClaw $version"
    Write-Info "  Home: $MagicClawHome"
    Write-Info "  App:  $AppRoot"

    if (Test-ProcessRunning $ApiPidFile) {
        $pidValue = (Get-Content -LiteralPath $ApiPidFile -Raw).Trim()
        Write-Host "  API:  " -NoNewline
        Write-Ok "running (pid $pidValue, port $($env:PORT))"
    }
    else {
        Write-Host '  API:  ' -NoNewline
        Write-Err 'stopped'
    }

    if (Test-ProcessRunning $WebPidFile) {
        $pidValue = (Get-Content -LiteralPath $WebPidFile -Raw).Trim()
        Write-Host '  Web:  ' -NoNewline
        Write-Ok "running (pid $pidValue, port $DefaultWebPort)"
    }
    else {
        Write-Host '  Web:  ' -NoNewline
        Write-Err 'stopped'
    }
}

function Invoke-Logs {
    param([string]$Target = 'all')

    Initialize-Env
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

    switch ($Target) {
        'api' {
            if (-not (Test-Path -LiteralPath $ApiLog)) { New-Item -ItemType File -Path $ApiLog | Out-Null }
            $paths = @($ApiLog, (Get-ErrorLogPath $ApiLog)) | Where-Object { Test-Path -LiteralPath $_ }
            Get-Content -LiteralPath $paths -Tail 20 -Wait
        }
        'web' {
            if (-not (Test-Path -LiteralPath $WebLog)) { New-Item -ItemType File -Path $WebLog | Out-Null }
            $paths = @($WebLog, (Get-ErrorLogPath $WebLog)) | Where-Object { Test-Path -LiteralPath $_ }
            Get-Content -LiteralPath $paths -Tail 20 -Wait
        }
        default {
            if (-not (Test-Path -LiteralPath $ApiLog)) { New-Item -ItemType File -Path $ApiLog | Out-Null }
            if (-not (Test-Path -LiteralPath $WebLog)) { New-Item -ItemType File -Path $WebLog | Out-Null }
            $paths = @(
                $ApiLog,
                (Get-ErrorLogPath $ApiLog),
                $WebLog,
                (Get-ErrorLogPath $WebLog)
            ) | Where-Object { Test-Path -LiteralPath $_ }
            Get-Content -LiteralPath $paths -Tail 20 -Wait
        }
    }
}

function Invoke-Setup {
    Initialize-Env

    foreach ($dir in @('skills', 'memories')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $MagicClawHome $dir) | Out-Null
    }

    $envFile = Join-Path $MagicClawHome '.env'
    if (-not (Test-Path -LiteralPath $envFile)) {
        $example = Join-Path $AppRoot 'share\env.example'
        if (Test-Path -LiteralPath $example) {
            Copy-Item -LiteralPath $example -Destination $envFile
        }
        else {
            @'
# MagicClaw configuration
OPENAI_API_KEY=

# API server port (default 4000)
# PORT=4000

# Web UI port is fixed at 3000 by the launcher

# CORS origin for API (default http://localhost:3000)
# WEB_ORIGIN=http://localhost:3000

# Mem0 Platform (optional)
# MEM0_API_KEY=m0-...
'@ | Set-Content -LiteralPath $envFile -Encoding UTF8
        }
        Write-Info "Created $envFile"
    }

    $content = Get-Content -LiteralPath $envFile -Raw
    if ($content -notmatch '(?m)^OPENAI_API_KEY=.+') {
        if ([Console]::IsInputRedirected) {
            Write-Warn "OPENAI_API_KEY not set — edit $envFile before chatting"
        }
        else {
            $key = Read-Host 'Enter OPENAI_API_KEY (required for chat)'
            if ($key) {
                if ($content -match '(?m)^OPENAI_API_KEY=') {
                    $content = [regex]::Replace($content, '(?m)^OPENAI_API_KEY=.*', "OPENAI_API_KEY=$key")
                }
                else {
                    $content = $content.TrimEnd() + "`nOPENAI_API_KEY=$key`n"
                }
                Set-Content -LiteralPath $envFile -Value $content -Encoding UTF8 -NoNewline
                Write-Ok 'OPENAI_API_KEY saved'
            }
            else {
                Write-Warn "OPENAI_API_KEY not set — edit $envFile before chatting"
            }
        }
    }

    Write-Host ''
    Write-Info 'Setup complete. Run: magicclaw start'
}

function Get-LatestReleaseTag {
    $uri = "https://github.com/$GitHubRepo/releases/latest"
    $location = $null

    try {
        $request = [System.Net.HttpWebRequest]::Create($uri)
        $request.Method = 'HEAD'
        $request.AllowAutoRedirect = $false
        $response = $request.GetResponse()
        $location = $response.Headers['Location']
        if (-not $location -and $response.ResponseUri) {
            $location = $response.ResponseUri.AbsoluteUri
        }
        $response.Close()
    }
    catch {
        $webResponse = $_.Exception.Response
        if ($webResponse) {
            $location = $webResponse.Headers['Location']
            $webResponse.Close()
        }
    }

    if ($location -and $location -match '/releases/tag/([^/?#]+)') {
        return [Uri]::UnescapeDataString($Matches[1])
    }

    throw 'Could not resolve latest release. Specify a version tag.'
}

function Invoke-Update {
    param([string]$Version)

    Initialize-Env

    if (-not $Version) {
        $Version = Get-LatestReleaseTag
    }

    $verPlain = $Version -replace '^v', ''
    $asset = "magicclaw-$verPlain-windows-x64.tar.gz"
    $url = "https://github.com/$GitHubRepo/releases/download/$Version/$asset"

    Write-Info "Updating MagicClaw to $Version (windows-x64)..."
    try { Invoke-Stop } catch { }

    $tmpdir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("magicclaw-update-" + [guid]::NewGuid().ToString('n')))
    $archive = Join-Path $tmpdir.FullName 'bundle.tar.gz'

    try {
        Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
        & tar -xzf $archive -C $tmpdir.FullName
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to extract $asset"
        }

        $extractDir = $tmpdir.FullName
        $nested = Join-Path $tmpdir.FullName 'magicclaw'
        if (Test-Path -LiteralPath $nested) {
            $extractDir = $nested
        }

        foreach ($name in @('api', 'web', 'share', 'bin', 'lib')) {
            $target = Join-Path $AppRoot $name
            if (Test-Path -LiteralPath $target) {
                Remove-Item -LiteralPath $target -Recurse -Force
            }
        }

        Copy-Item -LiteralPath (Join-Path $extractDir '*') -Destination $AppRoot -Recurse -Force
        Write-Ok "Updated to $Version"
        Write-Info 'Run: magicclaw start'
    }
    finally {
        if (Test-Path -LiteralPath $tmpdir.FullName) {
            Remove-Item -LiteralPath $tmpdir.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Show-Help {
    @"
MagicClaw — AI agent with MCP server management

Usage: magicclaw <command> [options]

Commands:
  start          Start API and Web servers
  stop           Stop running servers
  status         Show version and process status
  setup          Initialize ~/.magicclaw and configure .env
  update [ver]   Download and install latest release (or specific version tag)
  logs [api|web] Tail server logs (default: both)

Environment:
  MAGICCLAW_HOME   Data directory (default: %USERPROFILE%\.magicclaw)
  PORT             API port (default: 4000)
"@
}

try {
    switch ($Command) {
        'start' { Invoke-Start }
        'stop' { Invoke-Stop }
        'status' { Invoke-Status }
        'setup' { Invoke-Setup }
        'update' { Invoke-Update -Version $Rest[0] }
        'logs' { Invoke-Logs -Target $(if ($Rest.Count -gt 0) { $Rest[0] } else { 'all' }) }
        'help' { Show-Help }
        '--help' { Show-Help }
        '-h' { Show-Help }
        default {
            Write-Err "Unknown command: $Command"
            Show-Help
            exit 1
        }
    }
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}
