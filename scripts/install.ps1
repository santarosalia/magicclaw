# ============================================================================
# MagicClaw Installer (Windows PowerShell)
# ============================================================================
# Downloads a prebuilt release bundle and installs the magicclaw CLI.
# Service stop/swap helpers live in scripts/lib/magicclaw-service.ps1.
#
# Usage:
#   irm https://github.com/santarosalia/magicclaw/releases/latest/download/install.ps1 | iex
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

function Get-InstallScriptSearchRoots {
    $roots = @()
    if ($PSScriptRoot) {
        $roots += $PSScriptRoot
    }
    if ($MyInvocation.MyCommand.Path) {
        $roots += (Split-Path $MyInvocation.MyCommand.Path -Parent)
    }
    return @($roots | Select-Object -Unique)
}

function Import-MagicClawPowerShellModule {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ModuleName,

        [Parameter(Mandatory = $true)]
        [string]$GitHubRepo,

        [string]$ReleaseTag,

        [string[]]$SearchRoots = @()
    )

    $fileName = "$ModuleName.ps1"
    foreach ($root in $SearchRoots) {
        if (-not $root) {
            continue
        }

        foreach ($candidate in @(
                (Join-Path $root $fileName),
                (Join-Path (Join-Path $root 'lib') $fileName)
            )) {
            if (Test-Path -LiteralPath $candidate) {
                . $candidate
                return
            }
        }
    }

    $tmp = Join-Path $env:TEMP ("magicclaw-$ModuleName-" + [guid]::NewGuid().ToString('n') + '.ps1')
    $errors = @()
    $urls = @(
        "https://github.com/$GitHubRepo/releases/latest/download/$fileName"
    )
    if ($ReleaseTag) {
        $urls += @(
            "https://github.com/$GitHubRepo/releases/download/$ReleaseTag/$fileName",
            "https://raw.githubusercontent.com/$GitHubRepo/$ReleaseTag/scripts/lib/$fileName"
        )
    }
    $urls += "https://raw.githubusercontent.com/$GitHubRepo/main/scripts/lib/$fileName"
    $urls = @($urls | Select-Object -Unique)

    try {
        foreach ($url in $urls) {
            try {
                Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -ErrorAction Stop
                . $tmp
                return
            }
            catch {
                $errors += "$url -> $($_.Exception.Message)"
            }
        }

        throw "Could not download $fileName.`n$($errors -join [Environment]::NewLine)"
    }
    finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Initialize-InstallModules {
    param([string]$ReleaseTag)

    $roots = Get-InstallScriptSearchRoots

    if (-not (Get-Command Get-MagicClawLatestReleaseTag -ErrorAction SilentlyContinue)) {
        $githubLoaded = $false
        foreach ($root in $roots) {
            foreach ($candidate in @(
                    (Join-Path $root 'magicclaw-github.ps1'),
                    (Join-Path $root 'lib\magicclaw-github.ps1')
                )) {
                if (Test-Path -LiteralPath $candidate) {
                    . $candidate
                    $githubLoaded = $true
                    break
                }
            }
            if ($githubLoaded) {
                break
            }
        }

        if (-not $githubLoaded) {
            Import-MagicClawPowerShellModule `
                -ModuleName 'magicclaw-github' `
                -GitHubRepo $GitHubRepo `
                -ReleaseTag $ReleaseTag `
                -SearchRoots $roots
        }
    }

    if (-not (Get-Command Swap-InstallDirectory -ErrorAction SilentlyContinue)) {
        $serviceLoaded = $false
        foreach ($root in $roots) {
            foreach ($candidate in @(
                    (Join-Path $root 'magicclaw-service.ps1'),
                    (Join-Path $root 'lib\magicclaw-service.ps1')
                )) {
                if (Test-Path -LiteralPath $candidate) {
                    . $candidate
                    $serviceLoaded = $true
                    break
                }
            }
            if ($serviceLoaded) {
                break
            }
        }

        if (-not $serviceLoaded) {
            Import-MagicClawPowerShellModule `
                -ModuleName 'magicclaw-service' `
                -GitHubRepo $GitHubRepo `
                -ReleaseTag $ReleaseTag `
                -SearchRoots $roots
        }
    }
}

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
  GITHUB_TOKEN            Optional — raises GitHub API rate limits
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

function Stop-ExistingInstallIfNeeded {
    if (-not (Test-ExistingMagicClawInstall -AppDir $Dir -HomeDir $MagicClawHome)) {
        return
    }

    Invoke-MagicClawServiceStop `
        -HomeDir $MagicClawHome `
        -AppDir $Dir `
        -StopViaLauncher { Invoke-MagicClawLauncher -AppInstallDir $Dir stop }
}

function Install-ReleaseBundle {
    param(
        [string]$Platform,
        [string]$ReleaseVersion
    )

    $verPlain = $ReleaseVersion -replace '^v', ''
    $asset = "magicclaw-$verPlain-$Platform.tar.gz"

    Write-Host "Downloading $asset..." -ForegroundColor Blue

    $tmpdir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("magicclaw-install-" + [guid]::NewGuid().ToString('n')))
    $archive = Join-Path $tmpdir.FullName 'bundle.tar.gz'
    $parentDir = Split-Path $Dir -Parent
    $stagingDir = Join-Path $parentDir ("app.staging-" + [guid]::NewGuid().ToString('n'))

    try {
        Invoke-MagicClawReleaseDownload `
            -GitHubRepo $GitHubRepo `
            -ReleaseTag $ReleaseVersion `
            -FileName $asset `
            -DestinationPath $archive

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

        Stop-ExistingInstallIfNeeded
        Swap-InstallDirectory `
            -TargetDir $Dir `
            -SourceDir $extractDir `
            -HomeDir $MagicClawHome `
            -AppDir $Dir `
            -BeforeRetry ${function:Stop-ExistingInstallIfNeeded}
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
    }

    $bashMagicClawHome = $MagicClawHome -replace '\\', '/'

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

    try {
        $newPath = if ($segments.Count -gt 0) { ($segments + $BinDir) -join ';' } else { $BinDir }
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        if ($env:Path -notmatch [regex]::Escape($BinDir)) {
            $env:Path = "$env:Path;$BinDir"
        }
        Write-Host 'Added to user PATH. Restart your terminal to apply everywhere.' -ForegroundColor Green
    }
    catch {
        Write-Host "Could not update user PATH (policy or permissions). Add manually: $BinDir" -ForegroundColor Yellow
    }
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

    Initialize-InstallModules -ReleaseTag $Version

    $platform = Get-MagicClawPlatform
    $releaseVersion = Get-MagicClawLatestReleaseTag -GitHubRepo $GitHubRepo -Version $Version
    $ports = Get-MagicClawPortsFromEnvFile -HomeDir $MagicClawHome

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
    Write-Host "  Start-Process http://localhost:$($ports.Web)"
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
