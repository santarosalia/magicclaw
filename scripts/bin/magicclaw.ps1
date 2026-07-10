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
$LibDir = Join-Path (Split-Path $ScriptDir -Parent) 'lib'
foreach ($libFile in @('magicclaw-github.ps1', 'magicclaw-service.ps1')) {
    $libPath = Join-Path $LibDir $libFile
    if (-not (Test-Path -LiteralPath $libPath)) {
        throw "Missing launcher library: $libPath (re-run the installer)"
    }
    . $libPath
}

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

    $ports = Get-MagicClawPortsFromEnvFile -HomeDir $MagicClawHome
    if (-not $env:PORT) { $env:PORT = [string]$ports.Api }
    if (-not $env:WEB_ORIGIN) { $env:WEB_ORIGIN = "http://localhost:$($ports.Web)" }
    if (-not $env:NEXT_PUBLIC_API_URL) { $env:NEXT_PUBLIC_API_URL = "http://localhost:$($env:PORT)" }
    if (-not $env:HOSTNAME) { $env:HOSTNAME = '127.0.0.1' }

    Import-DotEnv (Join-Path $MagicClawHome '.env')

    $ports = Get-MagicClawPortsFromEnvFile -HomeDir $MagicClawHome
    if (-not $env:PORT) { $env:PORT = [string]$ports.Api }
    if (-not $env:WEB_ORIGIN) { $env:WEB_ORIGIN = "http://localhost:$($ports.Web)" }

    Set-SqliteNodeOptions
}

function Set-SqliteNodeOptions {
    $flag = '--disable-warning=ExperimentalWarning'
    $existing = [Environment]::GetEnvironmentVariable('NODE_OPTIONS', 'Process')
    if ([string]::IsNullOrWhiteSpace($existing)) {
        [Environment]::SetEnvironmentVariable('NODE_OPTIONS', $flag, 'Process')
        $env:NODE_OPTIONS = $flag
        return
    }

    if ($existing -split '\s+' | Where-Object { $_ -eq $flag }) {
        $env:NODE_OPTIONS = $existing
        return
    }

    $merged = "$existing $flag"
    [Environment]::SetEnvironmentVariable('NODE_OPTIONS', $merged, 'Process')
    $env:NODE_OPTIONS = $merged
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

function Write-Utf8FileNoBom {
    param(
        [string]$Path,
        [string]$Content
    )

    $encoding = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Test-NodeFts5 {
    param([string]$NodeBin)

    # Avoid node -e on Windows PowerShell: semicolons/quotes in -e scripts are parsed by PS itself.
    $probeFile = Join-Path $env:TEMP ("magicclaw-fts5-probe-$([guid]::NewGuid().ToString('n')).cjs")
    try {
        $probeScript = @'
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(":memory:");
db.exec("CREATE VIRTUAL TABLE _probe USING fts5(x)");
db.exec("DROP TABLE _probe");
'@
        Write-Utf8FileNoBom -Path $probeFile -Content $probeScript

        $prevNodeOptions = $env:NODE_OPTIONS
        Set-SqliteNodeOptions
        & $NodeBin $probeFile 1>$null 2>$null
        $ok = $LASTEXITCODE -eq 0
        if ($null -eq $prevNodeOptions) {
            Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
            [Environment]::SetEnvironmentVariable('NODE_OPTIONS', $null, 'Process')
        }
        else {
            $env:NODE_OPTIONS = $prevNodeOptions
            [Environment]::SetEnvironmentVariable('NODE_OPTIONS', $prevNodeOptions, 'Process')
        }
        return $ok
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

function Sync-RuntimeEnvironment {
    param([hashtable]$Extra = @{})

    $env:MAGICCLAW_HOME = $MagicClawHome
    $ports = Get-MagicClawPortsFromEnvFile -HomeDir $MagicClawHome
    if (-not $env:PORT) { $env:PORT = [string]$ports.Api }
    if (-not $env:WEB_ORIGIN) { $env:WEB_ORIGIN = "http://localhost:$($ports.Web)" }
    if (-not $env:NEXT_PUBLIC_API_URL) { $env:NEXT_PUBLIC_API_URL = "http://localhost:$($env:PORT)" }
    if (-not $env:HOSTNAME) { $env:HOSTNAME = '127.0.0.1' }
    Set-SqliteNodeOptions

    foreach ($key in $Extra.Keys) {
        Set-Item -Path "Env:$key" -Value ([string]$Extra[$key])
    }
}

function Test-ApiHealth {
    param(
        [int]$Port,
        [int]$ProcessId,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($ProcessId -gt 0 -and -not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            return $false
        }

        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return $true
            }
        }
        catch {
            # API still booting
        }

        Start-Sleep -Milliseconds 500
    }

    return $false
}

function Test-WebHealth {
    param(
        [int]$Port,
        [int]$ProcessId,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($ProcessId -gt 0 -and -not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            return $false
        }

        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        }
        catch {
            # Web still booting
        }

        Start-Sleep -Milliseconds 500
    }

    return $false
}

function Get-ErrorLogPath {
    param([string]$LogFile)
    return "$LogFile.err"
}

function Format-ProcessArguments {
    param([string[]]$ArgumentList)

    if (-not $ArgumentList -or $ArgumentList.Count -eq 0) {
        return ''
    }

    return ($ArgumentList | ForEach-Object {
        $arg = [string]$_
        if ($arg -match '[\s"]') {
            '"' + ($arg -replace '"', '""') + '"'
        }
        else {
            $arg
        }
    }) -join ' '
}

function Write-LogSessionMarker {
    param(
        [string]$Name,
        [string[]]$Paths
    )

    $marker = "===== $Name started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ====="
    foreach ($path in $Paths) {
        $parent = Split-Path $path -Parent
        if ($parent -and -not (Test-Path -LiteralPath $parent)) {
            New-Item -ItemType Directory -Force -Path $parent | Out-Null
        }

        if (-not (Test-Path -LiteralPath $path)) {
            New-Item -ItemType File -Force -Path $path | Out-Null
        }

        # Use cmd append — works while `magicclaw logs` is reading the same file.
        $cmd = "echo.>>`"$path`" & echo $marker>>`"$path`""
        cmd.exe /d /c $cmd 1>$null 2>$null
    }
}

function Follow-LogFiles {
    param([string[]]$Paths)

    $offsets = @{}
    foreach ($path in $Paths) {
        if (Test-Path -LiteralPath $path) {
            Get-Content -LiteralPath $path -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
            $offsets[$path] = (Get-Item -LiteralPath $path).Length
        }
        else {
            $offsets[$path] = 0
        }
    }

    while ($true) {
        foreach ($path in $Paths) {
            if (-not (Test-Path -LiteralPath $path)) {
                continue
            }

            $length = (Get-Item -LiteralPath $path).Length
            if ($length -lt $offsets[$path]) {
                $offsets[$path] = 0
            }

            if ($length -le $offsets[$path]) {
                continue
            }

            $stream = $null
            $reader = $null
            try {
                $stream = [IO.File]::Open(
                    $path,
                    [IO.FileMode]::Open,
                    [IO.FileAccess]::Read,
                    [IO.FileShare]::ReadWrite
                )
                $stream.Seek($offsets[$path], [IO.SeekOrigin]::Begin) | Out-Null
                $reader = New-Object IO.StreamReader($stream)
                while (-not $reader.EndOfStream) {
                    Write-Host $reader.ReadLine()
                }
                $offsets[$path] = $stream.Position
            }
            finally {
                if ($reader) { $reader.Dispose() }
                if ($stream) { $stream.Dispose() }
            }
        }

        Start-Sleep -Milliseconds 400
    }
}

function Resolve-LaunchArguments {
    param(
        [string]$WorkingDirectory,
        [string[]]$ArgumentList
    )

    $resolved = @()
    foreach ($arg in $ArgumentList) {
        if ([string]::IsNullOrWhiteSpace($arg)) {
            continue
        }

        if ($arg.StartsWith('-')) {
            $resolved += $arg
            continue
        }

        if ([IO.Path]::IsPathRooted($arg)) {
            $resolved += $arg
        }
        else {
            $resolved += (Join-Path $WorkingDirectory $arg)
        }
    }

    return $resolved
}

function Get-ConfiguredPorts {
    return Get-MagicClawPortsFromEnvFile -HomeDir $MagicClawHome
}

function Stop-PortListener {
    param(
        [int]$Port,
        [string]$Name
    )

    if ($Port -le 0) {
        return
    }

    $listenerPid = Get-ListenerProcessIdOnPort -Port $Port
    if ($listenerPid -le 0) {
        return
    }

    $pidFile = if ($Name -eq 'API') { $ApiPidFile } else { $WebPidFile }
    $pidFromFile = Read-PidFileValue -PidFile $pidFile

    if (-not (Test-ProcessIsMagicClawManaged -ProcessId $listenerPid -AppDir $AppRoot -HomeDir $MagicClawHome -PidFromFile $pidFromFile)) {
        throw "Port $Port is already in use by pid $listenerPid (not a MagicClaw process). Stop that process or change the port in ~/.magicclaw/.env"
    }

    Write-Warn "Port $Port already in use by MagicClaw pid $listenerPid — stopping $Name before restart"
    Stop-ProcessTreeGracefully -ProcessId $listenerPid
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
        [string]$LogFile,
        [scriptblock]$ReadyCheck,
        [int]$ListenPort = 0
    )

    if (Test-ProcessRunning $PidFile) {
        $existing = (Get-Content -LiteralPath $PidFile -Raw).Trim()
        Write-Warn "$Name already running (pid $existing)"
        return
    }

    if ($ListenPort -gt 0) {
        Stop-PortListener -Port $ListenPort -Name $Name
    }

    $errorLog = Get-ErrorLogPath $LogFile
    New-Item -ItemType Directory -Force -Path (Split-Path $LogFile -Parent) | Out-Null
    Write-LogSessionMarker -Name $Name -Paths @($LogFile, $errorLog)

    $saved = @{}
    foreach ($key in $Environment.Keys) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    }

    Sync-RuntimeEnvironment -Extra $Environment

    $launchArgs = Resolve-LaunchArguments -WorkingDirectory $WorkingDirectory -ArgumentList $ArgumentList

    try {
        # Append redirect via cmd keeps logs readable while `magicclaw logs` is open
        # and avoids exclusive file locks from Start-Process -RedirectStandardOutput.
        $argString = Format-ProcessArguments -ArgumentList $launchArgs
        $launch = "cd /d `"$WorkingDirectory`" && `"$NodeBin`" $argString 1>>`"$LogFile`" 2>>`"$errorLog`""
        $process = Start-Process -FilePath 'cmd.exe' `
            -ArgumentList @('/c', $launch) `
            -PassThru `
            -WindowStyle Hidden

        $ready = $false
        if ($ReadyCheck) {
            $ready = [bool](& $ReadyCheck $process.Id)
        }
        else {
            Start-Sleep -Milliseconds 750
            $ready = -not $process.HasExited
        }

        if (-not $ready -or $process.HasExited) {
            if (-not $process.HasExited) {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            }
            $logLines = Read-ProcessLogs -LogFile $LogFile
            $details = if ($logLines.Count -gt 0) { "`n$($logLines -join "`n")" } else { '' }
            throw "$Name failed to start (exit $($process.ExitCode)).$details"
        }

        $processId = $process.Id
        if ($ListenPort -gt 0) {
            $listenerPid = Get-ListenerProcessIdOnPort -Port $ListenPort
            if ($listenerPid -gt 0) {
                $processId = $listenerPid
            }
            else {
                Write-Warn "$Name is healthy but listener pid on port $ListenPort was not found; using wrapper pid $($process.Id)"
            }
        }

        Set-Content -LiteralPath $PidFile -Value $processId -Encoding ascii
        Write-Ok "$Name started (pid $processId)"
    }
    finally {
        foreach ($key in $saved.Keys) {
            if ($null -eq $saved[$key]) {
                [Environment]::SetEnvironmentVariable($key, $null, 'Process')
                Remove-Item "Env:$key" -ErrorAction SilentlyContinue
            }
            else {
                [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process')
                Set-Item -Path "Env:$key" -Value $saved[$key]
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
    Stop-ProcessTreeGracefully -ProcessId $processId

    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Ok "$Name stopped"
}

function Stop-AllMagicClawServices {
    Initialize-Env
    Invoke-Stop

    $ports = Get-ConfiguredPorts
    $apiPid = Read-PidFileValue -PidFile $ApiPidFile
    $webPid = Read-PidFileValue -PidFile $WebPidFile

    foreach ($entry in @(
            @{ Name = 'API'; Port = [int]$env:PORT; Pid = $apiPid },
            @{ Name = 'Web'; Port = $ports.Web; Pid = $webPid }
        )) {
        $listenerPid = Get-ListenerProcessIdOnPort -Port $entry.Port
        if ($listenerPid -le 0) {
            continue
        }

        Stop-MagicClawManagedProcess `
            -ProcessId $listenerPid `
            -Label "$($entry.Name) listener on port $($entry.Port)" `
            -AppDir $AppRoot `
            -HomeDir $MagicClawHome `
            -PidFromFile $entry.Pid `
            -WriteStatus { param($Text) Write-Warn $Text }
    }

    [void](Wait-ForMagicClawPortsFree -HomeDir $MagicClawHome)
}

function Invoke-Start {
    Initialize-Env
    $node = Resolve-Node
    $webServer = Find-WebServer
    $webDir = Split-Path $webServer -Parent
    $webWorkDir = Split-Path (Split-Path $webDir -Parent) -Parent
    $apiDir = Join-Path $AppRoot 'api'
    $apiEntry = Join-Path $apiDir 'dist\main.js'
    if (-not (Test-Path -LiteralPath $apiEntry)) {
        throw "API entry not found: $apiEntry"
    }

    $webEntry = Join-Path $webWorkDir 'apps\web\server.js'
    if (-not (Test-Path -LiteralPath $webEntry)) {
        $webEntry = $webServer
    }

    $apiPort = [int]$env:PORT
    $webPort = (Get-ConfiguredPorts).Web

    Write-Info "Starting MagicClaw API on port $apiPort..."
    Start-MagicClawProcess -Name 'API' `
        -NodeBin $node `
        -WorkingDirectory $apiDir `
        -ArgumentList @((Join-Path $apiDir 'dist\main.js')) `
        -PidFile $ApiPidFile `
        -LogFile $ApiLog `
        -ListenPort $apiPort `
        -ReadyCheck {
            param($ProcessId)
            Test-ApiHealth -Port $apiPort -ProcessId $ProcessId
        }

    Write-Info "Starting MagicClaw Web on port $webPort..."
    Start-MagicClawProcess -Name 'Web' `
        -NodeBin $node `
        -WorkingDirectory $webWorkDir `
        -ArgumentList @($webEntry) `
        -Environment @{ PORT = [string]$webPort; HOSTNAME = '127.0.0.1' } `
        -PidFile $WebPidFile `
        -LogFile $WebLog `
        -ListenPort $webPort `
        -ReadyCheck {
            param($ProcessId)
            Test-WebHealth -Port $webPort -ProcessId $ProcessId
        }

    Write-Host ''
    Write-Info 'MagicClaw is running:'
    Write-Info "  Web UI:  http://localhost:$webPort"
    Write-Info "  API:     http://localhost:$apiPort"
    Write-Info '  Logs:    magicclaw logs'
}

function Invoke-Stop {
    Initialize-Env
    Stop-MagicClawProcess -Name 'API' -PidFile $ApiPidFile
    Stop-MagicClawProcess -Name 'Web' -PidFile $WebPidFile
}

function Show-StoppedLogHints {
    param(
        [string]$Name,
        [string]$LogFile,
        [bool]$Running
    )

    if ($Running) {
        return
    }

    $logLines = Read-ProcessLogs -LogFile $LogFile -Tail 8
    if ($logLines.Count -eq 0) {
        Write-Warn "  $Name log: $LogFile (empty — run: magicclaw start)"
        return
    }

    Write-Warn "  Recent $Name log:"
    foreach ($line in $logLines) {
        Write-Host "    $line"
    }
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

    $apiRunning = Test-ProcessRunning $ApiPidFile
    if ($apiRunning) {
        $pidValue = (Get-Content -LiteralPath $ApiPidFile -Raw).Trim()
        Write-Host "  API:  " -NoNewline
        Write-Ok "running (pid $pidValue, port $($env:PORT))"
    }
    else {
        Write-Host '  API:  ' -NoNewline
        Write-Err 'stopped'
        Show-StoppedLogHints -Name 'API' -LogFile $ApiLog -Running:$false
    }

    $webPort = (Get-ConfiguredPorts).Web
    $webRunning = Test-ProcessRunning $WebPidFile
    if ($webRunning) {
        $pidValue = (Get-Content -LiteralPath $WebPidFile -Raw).Trim()
        Write-Host '  Web:  ' -NoNewline
        Write-Ok "running (pid $pidValue, port $webPort)"
    }
    else {
        Write-Host '  Web:  ' -NoNewline
        Write-Err 'stopped'
        Show-StoppedLogHints -Name 'Web' -LogFile $WebLog -Running:$false
    }
}

function Invoke-Logs {
    param([string]$Target = 'all')

    Initialize-Env
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    Write-Info 'Following logs (Ctrl+C to stop — servers keep running)'

    $paths = @()
    switch ($Target) {
        'api' {
            if (-not (Test-Path -LiteralPath $ApiLog)) { New-Item -ItemType File -Path $ApiLog | Out-Null }
            $paths = @($ApiLog, (Get-ErrorLogPath $ApiLog)) | Where-Object { Test-Path -LiteralPath $_ }
        }
        'web' {
            if (-not (Test-Path -LiteralPath $WebLog)) { New-Item -ItemType File -Path $WebLog | Out-Null }
            $paths = @($WebLog, (Get-ErrorLogPath $WebLog)) | Where-Object { Test-Path -LiteralPath $_ }
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
        }
    }

    try {
        Follow-LogFiles -Paths $paths
    }
    catch [System.Management.Automation.PipelineStoppedException] {
        # Ctrl+C while tailing logs
    }
    finally {
        Write-Host ''
        Write-Info 'Log follow stopped.'
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

# Web UI port (default 3000)
# WEB_PORT=3000

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

function Invoke-Update {
    param([string]$Version)

    Initialize-Env

    if (-not $Version) {
        $Version = Get-MagicClawLatestReleaseTag -GitHubRepo $GitHubRepo
    }

    $verPlain = $Version -replace '^v', ''
    $asset = "magicclaw-$verPlain-windows-x64.tar.gz"
    $url = "https://github.com/$GitHubRepo/releases/download/$Version/$asset"

    Write-Info "Updating MagicClaw to $Version (windows-x64)..."

    $tmpdir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("magicclaw-update-" + [guid]::NewGuid().ToString('n')))
    $archive = Join-Path $tmpdir.FullName 'bundle.tar.gz'
    $stagingDir = Join-Path (Split-Path $AppRoot -Parent) ("app.staging-" + [guid]::NewGuid().ToString('n'))

    try {
        Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
        New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
        & tar -xzf $archive -C $stagingDir
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to extract $asset"
        }

        $extractDir = $stagingDir
        $nested = Join-Path $stagingDir 'magicclaw'
        if (Test-Path -LiteralPath $nested) {
            $extractDir = $nested
        }

        Stop-AllMagicClawServices
        Swap-InstallDirectory `
            -TargetDir $AppRoot `
            -SourceDir $extractDir `
            -HomeDir $MagicClawHome `
            -AppDir $AppRoot `
            -BeforeRetry { Stop-AllMagicClawServices } `
            -WriteStatus { param($Text) Write-Warn $Text }
        Write-Ok "Updated to $Version"
        Write-Info 'Run: magicclaw start'
    }
    finally {
        if (Test-Path -LiteralPath $tmpdir.FullName) {
            Remove-Item -LiteralPath $tmpdir.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $stagingDir) {
            Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
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
        'update' { Invoke-Update -Version $(if ($Rest -and $Rest.Count -gt 0) { $Rest[0] }) }
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
