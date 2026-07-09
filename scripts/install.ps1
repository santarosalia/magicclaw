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

    try {
        try {
            Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
        }
        catch {
            throw "Download failed: $url`nCheck that release $ReleaseVersion exists for platform $Platform"
        }

        Write-Host "Installing to $Dir..." -ForegroundColor Blue

        if (Test-Path $Dir) {
            Get-ChildItem -LiteralPath $Dir -Force | Remove-Item -Recurse -Force
        }
        else {
            New-Item -ItemType Directory -Force -Path $Dir | Out-Null
        }

        & tar -xzf $archive -C $Dir
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to extract $asset"
        }
    }
    finally {
        if ($tmpdir -and (Test-Path $tmpdir.FullName)) {
            Remove-Item -LiteralPath $tmpdir.FullName -Recurse -Force -ErrorAction SilentlyContinue
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
