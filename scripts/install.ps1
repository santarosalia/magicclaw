# ============================================================================
# MagicClaw Installer (Windows PowerShell)
# ============================================================================
# Downloads a prebuilt release bundle and installs the magicclaw CLI.
#
# Usage:
#   irm https://github.com/santarosalia/magicclaw/releases/latest/download/install.ps1 | iex
#
# Or with options (save first, then run):
#   irm ... -OutFile install.ps1
#   .\install.ps1 -Version v0.1.0 -SkipSetup
#
# Piped install with env vars:
#   $env:MAGICCLAW_VERSION = 'v0.1.0'; irm ... | iex
# ============================================================================

#Requires -Version 5.1

[CmdletBinding()]
param(
    [Alias('v')]
    [string]$Version,

    [string]$Dir,

    [string]$MagicClawHome,

    [switch]$SkipSetup,

    [switch]$NonInteractive,

    [switch]$Help
)

$ErrorActionPreference = 'Stop'

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}
catch {
    # Best effort for older PowerShell; requests below will surface a clear error if TLS negotiation fails.
}

$GitHubRepo = if ($env:MAGICCLAW_GITHUB_REPO) { $env:MAGICCLAW_GITHUB_REPO } else { 'santarosalia/magicclaw' }

if (-not $Version -and $env:MAGICCLAW_VERSION) { $Version = $env:MAGICCLAW_VERSION }
if (-not $MagicClawHome -and $env:MAGICCLAW_HOME) { $MagicClawHome = $env:MAGICCLAW_HOME }
if (-not $MagicClawHome) { $MagicClawHome = Join-Path $env:USERPROFILE '.magicclaw' }
if (-not $Dir) { $Dir = Join-Path $MagicClawHome 'app' }

if ($env:MAGICCLAW_SKIP_SETUP -eq '1') { $SkipSetup = $true }
if ($env:MAGICCLAW_NON_INTERACTIVE -eq '1') { $NonInteractive = $true }

if (-not $PSBoundParameters.ContainsKey('NonInteractive')) {
    try {
        $NonInteractive = [Console]::IsInputRedirected
    }
    catch {
        $NonInteractive = $true
    }
}

$BinDir = Join-Path $env:USERPROFILE '.local\bin'
$ShimPath = Join-Path $BinDir 'magicclaw.cmd'

function Write-Banner {
    Write-Host ''
    Write-Host '___  ___               _         _____  _                  ' -ForegroundColor Blue
    Write-Host '|  \/  |              (_)       /  __ \| |                 ' -ForegroundColor Blue
    Write-Host '| .  . |  __ _   __ _  _   ___  | /  \/| |  __ _ __      __' -ForegroundColor Blue
    Write-Host '| |\/| | / _` | / _` || | / __| | |    | | / _` |\ \ /\ / /' -ForegroundColor Blue
    Write-Host '| |  | || (_| || (_| || || (__  | \__/\| || (_| | \ V  V / ' -ForegroundColor Blue
    Write-Host '\_|  |_/ \__,_| \__, ||_| \___|  \____/|_| \__,_|  \_/\_/  ' -ForegroundColor Blue
    Write-Host '                 __/ |                                      ' -ForegroundColor Blue
    Write-Host '                |___/                                       ' -ForegroundColor Blue
    Write-Host ''
    Write-Host 'Magic Claw installer (Windows)'
    Write-Host ''
}

function Show-Help {
    @"
MagicClaw installer (Windows PowerShell)

Usage:
  irm https://github.com/santarosalia/magicclaw/releases/latest/download/install.ps1 | iex

Options:
  -Version, -v TAG       Install specific release tag (e.g. v0.1.0)
  -Dir PATH              Install application files (default: %USERPROFILE%\.magicclaw\app)
  -MagicClawHome DIR     Data home directory (default: %USERPROFILE%\.magicclaw)
  -SkipSetup             Skip magicclaw setup (.env initialization)
  -NonInteractive        Never prompt
  -Help                  Show this help

Environment (for piped install):
  MAGICCLAW_VERSION
  MAGICCLAW_HOME
  MAGICCLAW_SKIP_SETUP=1
  MAGICCLAW_NON_INTERACTIVE=1
  MAGICCLAW_GITHUB_REPO
"@
}

function Get-MagicClawPlatform {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if (-not $arch -and $env:PROCESSOR_ARCHITEW6432) {
        $arch = $env:PROCESSOR_ARCHITEW6432
    }

    if ($arch -match 'ARM64') {
        throw 'Windows ARM64 is not supported yet. Use 64-bit Windows or WSL.'
    }
    if ($arch -notmatch 'AMD64|x86_64') {
        throw "Unsupported architecture: $arch"
    }

    return 'windows-x64'
}

function Invoke-MagicClawLauncher {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppInstallDir,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$LauncherArgs
    )

    $launcher = Join-Path $AppInstallDir 'bin\magicclaw.ps1'
    if (-not (Test-Path -LiteralPath $launcher)) {
        throw "magicclaw.ps1 not found at $launcher"
    }

    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) {
        & $pwsh.Source -NoProfile -ExecutionPolicy Bypass -File $launcher @LauncherArgs
        return
    }

    & powershell -NoProfile -ExecutionPolicy Bypass -File $launcher @LauncherArgs
}

function Test-Prerequisites {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js 22+ is required. Install from https://nodejs.org/ and re-run.'
    }

    $versionText = & node --version 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $versionText) {
        throw 'Node.js 22+ is required. Install from https://nodejs.org/ and re-run.'
    }

    $major = 0
    if ($versionText -match '^v?(\d+)\.') {
        $major = [int]$Matches[1]
    }
    if ($major -lt 22) {
        $ver = & node -v
        throw "Node.js 22+ required (found $ver)"
    }

    if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
        throw 'tar is required (included in Windows 10 1803+). Update Windows or install Git for Windows.'
    }
}

function Get-ReleaseVersion {
    if ($Version) {
        return $Version
    }

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

    if ($location -and $location -match '/releases/latest/?$') {
        throw "Could not resolve latest release because GitHub did not redirect to a tag. Specify -Version vX.Y.Z"
    }

    if (-not $location) {
        throw "Could not resolve latest release. Specify -Version vX.Y.Z"
    }

    throw "Could not parse latest release redirect: $location"
}

function Get-MagicClawPortsFromEnv {
    param([string]$HomeDir)

    $apiPort = 4000
    $envFile = Join-Path $HomeDir '.env'
    if (Test-Path -LiteralPath $envFile) {
        foreach ($line in Get-Content -LiteralPath $envFile) {
            if ($line -match '^\s*PORT\s*=\s*(\d+)') {
                $apiPort = [int]$Matches[1]
            }
        }
    }

    return @{
        Api = $apiPort
        Web = 3000
    }
}

function Get-ListenerProcessIdOnPort {
    param([int]$Port)

    if ($Port -le 0) {
        return 0
    }

    try {
        $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) {
            return [int]$listeners[0].OwningProcess
        }
    }
    catch {
    }

    try {
        $rows = netstat -ano | Select-String -Pattern 'LISTENING' | Select-String -Pattern ":$Port\s"
        foreach ($row in $rows) {
            if ($row.Line -match '\s(\d+)\s*$') {
                return [int]$Matches[1]
            }
        }
    }
    catch {
    }

    return 0
}

function Get-ProcessCommandLine {
    param([int]$ProcessId)

    if ($ProcessId -le 0) {
        return $null
    }

    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if ($proc) {
        return $proc.CommandLine
    }

    return $null
}

function Test-ProcessUsesMagicClawPaths {
    param(
        [int]$ProcessId,
        [string]$AppDir,
        [string]$HomeDir
    )

    if ($ProcessId -le 0) {
        return $false
    }

    $commandLine = Get-ProcessCommandLine -ProcessId $ProcessId
    if (-not $commandLine) {
        return $false
    }

    $needles = @(
        $AppDir.TrimEnd('\')
        $HomeDir.TrimEnd('\')
    ) | Where-Object { $_ }

    foreach ($needle in $needles) {
        if ($commandLine -like "*$needle*") {
            return $true
        }
    }

    return $false
}

function Test-ExistingMagicClawInstall {
    param(
        [string]$AppDir,
        [string]$HomeDir
    )

    if (Test-Path -LiteralPath (Join-Path $AppDir 'bin\magicclaw.ps1')) {
        return $true
    }

    if (Test-Path -LiteralPath (Join-Path $AppDir 'VERSION')) {
        return $true
    }

    $runDir = Join-Path $HomeDir 'run'
    foreach ($name in @('api.pid', 'web.pid')) {
        if (Test-Path -LiteralPath (Join-Path $runDir $name)) {
            return $true
        }
    }

    return $false
}

function Stop-ProcessTree {
    param([int]$ProcessId)

    if ($ProcessId -le 0) {
        return
    }

    & taskkill.exe /F /T /PID $ProcessId 2>$null | Out-Null
    Start-Sleep -Milliseconds 400
}

function Read-PidFileValue {
    param([string]$PidFile)

    if (-not (Test-Path -LiteralPath $PidFile)) {
        return 0
    }

    $pidText = (Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($pidText -match '^\d+$') {
        return [int]$pidText
    }

    return 0
}

function Test-NodeLooksLikeMagicClawEntry {
    param([string]$CommandLine)

    if (-not $CommandLine) {
        return $false
    }

    return $CommandLine -match 'dist[\\/]main\.js' `
        -or $CommandLine -match 'apps[\\/]web[\\/]server\.js' `
        -or $CommandLine -match '[\\/]magicclaw[\\/]app[\\/]'
}

function Test-ProcessIsMagicClawManaged {
    param(
        [int]$ProcessId,
        [string]$AppDir,
        [string]$HomeDir,
        [int]$PidFromFile = 0,
        [int]$ServicePort = 0
    )

    if ($ProcessId -le 0) {
        return $false
    }

    if ($PidFromFile -gt 0 -and $PidFromFile -eq $ProcessId) {
        return $true
    }

    if (Test-ProcessUsesMagicClawPaths -ProcessId $ProcessId -AppDir $AppDir -HomeDir $HomeDir) {
        return $true
    }

    if (Test-NodeLooksLikeMagicClawEntry -CommandLine (Get-ProcessCommandLine -ProcessId $ProcessId)) {
        return $true
    }

    $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue).ParentProcessId
    while ($parentId -gt 0) {
        $parentLine = Get-ProcessCommandLine -ProcessId $parentId
        foreach ($needle in @($AppDir.TrimEnd('\'), $HomeDir.TrimEnd('\'))) {
            if ($needle -and $parentLine -like "*$needle*") {
                return $true
            }
        }
        $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue).ParentProcessId
    }

    if ($ServicePort -gt 0 -and (Test-ExistingMagicClawInstall -AppDir $AppDir -HomeDir $HomeDir)) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
        if ($proc -and $proc.Name -ieq 'node.exe' -and (Get-ListenerProcessIdOnPort -Port $ServicePort) -eq $ProcessId) {
            return $true
        }
    }

    return $false
}

function Stop-MagicClawManagedProcess {
    param(
        [int]$ProcessId,
        [string]$Label,
        [string]$AppDir,
        [string]$HomeDir,
        [int]$PidFromFile = 0,
        [int]$ServicePort = 0
    )

    if ($ProcessId -le 0) {
        return
    }

    if (-not (Test-ProcessIsMagicClawManaged -ProcessId $ProcessId -AppDir $AppDir -HomeDir $HomeDir -PidFromFile $PidFromFile -ServicePort $ServicePort)) {
        Write-Host "Skipping $Label (pid $ProcessId) — not owned by this MagicClaw install" -ForegroundColor Yellow
        return
    }

    Write-Host "Stopping $Label (pid $ProcessId)..." -ForegroundColor Yellow
    Stop-ProcessTree -ProcessId $ProcessId
}

function Stop-ProcessesUsingInstallPath {
    param([string]$AppDir)

    if (-not $AppDir) {
        return
    }

    $needle = $AppDir.TrimEnd('\')
    foreach ($name in @('node.exe', 'cmd.exe')) {
        Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -like "*$needle*" } |
            ForEach-Object {
                Write-Host "Stopping $($_.Name) pid $($_.ProcessId) using install files..." -ForegroundColor Yellow
                Stop-ProcessTree -ProcessId $_.ProcessId
            }
    }
}

function Stop-MagicClawServicesForInstall {
    param(
        [string]$HomeDir,
        [string]$AppDir
    )

    if (-not (Test-ExistingMagicClawInstall -AppDir $AppDir -HomeDir $HomeDir)) {
        return
    }

    $launcher = Join-Path $AppDir 'bin\magicclaw.ps1'
    if (Test-Path -LiteralPath $launcher) {
        try {
            Write-Host 'Stopping running MagicClaw services...' -ForegroundColor Yellow
            Invoke-MagicClawLauncher -AppInstallDir $AppDir stop | Out-Null
        }
        catch {
            # Fall back to scoped pid/port cleanup below.
        }
    }

    $ports = Get-MagicClawPortsFromEnv -HomeDir $HomeDir
    $runDir = Join-Path $HomeDir 'run'
    $apiPidFile = Join-Path $runDir 'api.pid'
    $webPidFile = Join-Path $runDir 'web.pid'
    $savedPids = @{
        API = Read-PidFileValue -PidFile $apiPidFile
        Web = Read-PidFileValue -PidFile $webPidFile
    }

    foreach ($entry in @(
            @{ Name = 'API'; File = $apiPidFile; Pid = $savedPids.API }
            @{ Name = 'Web'; File = $webPidFile; Pid = $savedPids.Web }
        )) {
        if ($entry.Pid -gt 0) {
            Stop-MagicClawManagedProcess `
                -ProcessId $entry.Pid `
                -Label "$($entry.Name) (pid file)" `
                -AppDir $AppDir `
                -HomeDir $HomeDir `
                -PidFromFile $entry.Pid
        }

        Remove-Item -LiteralPath $entry.File -Force -ErrorAction SilentlyContinue
    }

    foreach ($portEntry in @(
            @{ Name = 'API'; Port = $ports.Api; Pid = $savedPids.API }
            @{ Name = 'Web'; Port = $ports.Web; Pid = $savedPids.Web }
        )) {
        $listenerPid = Get-ListenerProcessIdOnPort -Port $portEntry.Port
        Stop-MagicClawManagedProcess `
            -ProcessId $listenerPid `
            -Label "$($portEntry.Name) listener on port $($portEntry.Port)" `
            -AppDir $AppDir `
            -HomeDir $HomeDir `
            -PidFromFile $portEntry.Pid `
            -ServicePort $portEntry.Port
    }

    Stop-ProcessesUsingInstallPath -AppDir $AppDir
    Wait-ForMagicClawPortsFree -HomeDir $HomeDir
}

function Wait-ForMagicClawPortsFree {
    param(
        [string]$HomeDir,
        [int]$TimeoutSeconds = 20
    )

    $ports = Get-MagicClawPortsFromEnv -HomeDir $HomeDir
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $apiBusy = (Get-ListenerProcessIdOnPort -Port $ports.Api) -gt 0
        $webBusy = (Get-ListenerProcessIdOnPort -Port $ports.Web) -gt 0
        if (-not $apiBusy -and -not $webBusy) {
            return
        }
        Start-Sleep -Milliseconds 500
    }
}

function Swap-InstallDirectory {
    param(
        [string]$TargetDir,
        [string]$SourceDir,
        [string]$HomeDir,
        [string]$AppDir,
        [int]$MaxAttempts = 5
    )

    $parentDir = Split-Path $TargetDir -Parent
    $leaf = Split-Path $TargetDir -Leaf

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            if (Test-Path -LiteralPath $TargetDir) {
                $backupName = "$leaf.old.$(Get-Date -Format 'yyyyMMddHHmmss')"
                Rename-Item -LiteralPath $TargetDir -NewName $backupName -ErrorAction Stop
                Move-Item -LiteralPath $SourceDir -Destination $TargetDir -ErrorAction Stop
                $backupPath = Join-Path $parentDir $backupName
                Remove-Item -LiteralPath $backupPath -Recurse -Force -ErrorAction SilentlyContinue
            }
            else {
                New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
                Move-Item -LiteralPath $SourceDir -Destination $TargetDir -ErrorAction Stop
            }

            return
        }
        catch {
            if ($attempt -ge $MaxAttempts) {
                throw "Could not replace install files under $TargetDir. Run 'magicclaw stop' and retry.`n$($_.Exception.Message)"
            }

            Write-Host "Install files are locked; stopping services and retrying ($attempt/$MaxAttempts)..." -ForegroundColor Yellow
            Stop-MagicClawServicesForInstall -HomeDir $HomeDir -AppDir $AppDir
            Start-Sleep -Seconds 2
        }
    }
}

function Install-ReleaseBundle {
    param(
        [string]$Platform,
        [string]$ReleaseVersion
    )

    $verPlain = $ReleaseVersion -replace '^v', ''
    $asset = "magicclaw-$verPlain-$Platform.tar.gz"
    $url = "https://github.com/$GitHubRepo/releases/download/$ReleaseVersion/$asset"

    Write-Host "Downloading $asset..." -ForegroundColor Blue

    $tmpdir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("magicclaw-install-" + [guid]::NewGuid().ToString('n')))
    $archive = Join-Path $tmpdir.FullName 'bundle.tar.gz'
    $parentDir = Split-Path $Dir -Parent
    $stagingDir = Join-Path $parentDir ("app.staging-" + [guid]::NewGuid().ToString('n'))

    try {
        try {
            Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
        }
        catch {
            throw "Download failed: $url`nCheck that release $ReleaseVersion exists for platform $Platform"
        }

        Write-Host "Installing to $Dir..." -ForegroundColor Blue

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

        Stop-MagicClawServicesForInstall -HomeDir $MagicClawHome -AppDir $Dir
        Swap-InstallDirectory -TargetDir $Dir -SourceDir $extractDir -HomeDir $MagicClawHome -AppDir $Dir
    }
    finally {
        if ($tmpdir -and (Test-Path $tmpdir.FullName)) {
            Remove-Item -LiteralPath $tmpdir.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $stagingDir) {
            Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Install-Shim {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppInstallDir
    )

    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

    $resolvedAppRoot = $AppInstallDir
    try {
        $resolvedAppRoot = (Convert-Path -LiteralPath $AppInstallDir)
    }
    catch {
        # Convert-Path can fail on some UNC/edge paths; keep the provided path.
    }

    $bashMagicClawHome = $MagicClawHome -replace '\\', '/'

    # Delegate to the bundle's native PowerShell launcher via magicclaw.cmd.
    @"
@echo off
setlocal
if "%MAGICCLAW_HOME%"=="" set "MAGICCLAW_HOME=$bashMagicClawHome"
set "MAGICCLAW_INSTALL_DIR=$($resolvedAppRoot -replace '\\', '/')"
call "$resolvedAppRoot\bin\magicclaw.cmd" %*
"@ | Set-Content -LiteralPath $ShimPath -Encoding ASCII

    Write-Host "Installed CLI shim: $ShimPath" -ForegroundColor Green
}

function Ensure-UserPath {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $segments = @()
    if ($userPath) {
        $segments = $userPath -split ';' | Where-Object { $_ -and $_.Trim() }
    }

    $normalizedBin = $BinDir.TrimEnd('\')
    $alreadyPresent = $false
    foreach ($segment in $segments) {
        if ($segment.TrimEnd('\').Equals($normalizedBin, [StringComparison]::OrdinalIgnoreCase)) {
            $alreadyPresent = $true
            break
        }
    }

    if ($alreadyPresent) {
        return
    }

    Write-Host "$BinDir is not in PATH" -ForegroundColor Yellow

    if ($NonInteractive) {
        Write-Host "Add to your user PATH: $BinDir"
        return
    }

    $reply = Read-Host "Add $BinDir to user PATH? [Y/n]"
    if ($reply -and $reply -notmatch '^[Yy]') {
        return
    }

    $newPath = if ($segments.Count -gt 0) { ($segments + $BinDir) -join ';' } else { $BinDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    if ($env:Path -notmatch [regex]::Escape($BinDir)) {
        $env:Path = "$env:Path;$BinDir"
    }

    Write-Host 'Added to user PATH. Restart your terminal to apply everywhere.' -ForegroundColor Green
}

function Invoke-MagicClawSetup {
    if ($SkipSetup) {
        return
    }

    $env:MAGICCLAW_HOME = $MagicClawHome
    $env:MAGICCLAW_INSTALL_DIR = $Dir
    Invoke-MagicClawLauncher -AppInstallDir $Dir setup
}

if ($Help) {
    Show-Help
    exit 0
}

try {
    Write-Banner
    Test-Prerequisites

    $platform = Get-MagicClawPlatform
    $releaseVersion = Get-ReleaseVersion

    Write-Host "Platform:  $platform"
    Write-Host "Version:   $releaseVersion"
    Write-Host "Install:   $Dir"
    Write-Host "Data home: $MagicClawHome"
    Write-Host ''

    Install-ReleaseBundle -Platform $platform -ReleaseVersion $releaseVersion
    Install-Shim -AppInstallDir $Dir
    Ensure-UserPath
    Invoke-MagicClawSetup

    Write-Host ''
    Write-Host 'MagicClaw installed successfully!' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Next steps:'
    Write-Host '  magicclaw start     # Start API + Web'
    Write-Host '  Start-Process http://localhost:3000'
    Write-Host ''
    Write-Host 'Other commands:'
    Write-Host '  magicclaw status'
    Write-Host '  magicclaw setup'
    Write-Host '  magicclaw update'
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
