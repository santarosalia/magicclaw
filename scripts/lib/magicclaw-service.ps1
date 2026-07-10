# MagicClaw Windows service/process helpers.
# Dot-source from install.ps1 or bin/magicclaw.ps1 — not standalone.

function Get-MagicClawPortsFromEnvFile {
    param([string]$HomeDir)

    $apiPort = 4000
    $webPort = 3000
    $envFile = Join-Path $HomeDir '.env'

    if (-not (Test-Path -LiteralPath $envFile)) {
        return @{ Api = $apiPort; Web = $webPort }
    }

    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*PORT\s*=\s*(\d+)') {
            $apiPort = [int]$Matches[1]
        }
        elseif ($line -match '^\s*WEB_PORT\s*=\s*(\d+)') {
            $webPort = [int]$Matches[1]
        }
        elseif ($line -match '^\s*WEB_ORIGIN\s*=\s*https?://[^:]+:(\d+)') {
            $webPort = [int]$Matches[1]
        }
    }

    return @{
        Api = $apiPort
        Web = $webPort
    }
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

function Get-MagicClawKnownEntryPaths {
    param(
        [string]$AppDir,
        [string]$HomeDir
    )

    $paths = @(
        (Join-Path $AppDir 'api\dist\main.js')
        (Join-Path $AppDir 'web\apps\web\server.js')
        (Join-Path $AppDir 'web\server.js')
        (Join-Path $AppDir 'bin\magicclaw.ps1')
        (Join-Path $AppDir 'bin\magicclaw.cmd')
        (Join-Path $HomeDir 'run\api.pid')
        (Join-Path $HomeDir 'run\web.pid')
        (Join-Path $HomeDir 'run\api.log')
        (Join-Path $HomeDir 'run\web.log')
    )

    return @($paths | ForEach-Object { $_.TrimEnd('\') } | Where-Object { $_ })
}

function Test-CommandLineReferencesMagicClawInstall {
    param(
        [string]$CommandLine,
        [string]$AppDir,
        [string]$HomeDir
    )

    if (-not $CommandLine) {
        return $false
    }

    foreach ($needle in @($AppDir.TrimEnd('\'), $HomeDir.TrimEnd('\'))) {
        if ($needle -and $CommandLine -like "*$needle*") {
            return $true
        }
    }

    foreach ($entryPath in (Get-MagicClawKnownEntryPaths -AppDir $AppDir -HomeDir $HomeDir)) {
        if ($CommandLine -like "*$entryPath*") {
            return $true
        }
    }

    return $false
}

function Test-ProcessIsMagicClawManaged {
    param(
        [int]$ProcessId,
        [string]$AppDir,
        [string]$HomeDir,
        [int]$PidFromFile = 0
    )

    if ($ProcessId -le 0) {
        return $false
    }

    if ($PidFromFile -gt 0 -and $PidFromFile -eq $ProcessId) {
        return $true
    }

    $commandLine = Get-ProcessCommandLine -ProcessId $ProcessId
    if (Test-CommandLineReferencesMagicClawInstall -CommandLine $commandLine -AppDir $AppDir -HomeDir $HomeDir) {
        return $true
    }

    $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue).ParentProcessId
    while ($parentId -gt 0) {
        $parentLine = Get-ProcessCommandLine -ProcessId $parentId
        if (Test-CommandLineReferencesMagicClawInstall -CommandLine $parentLine -AppDir $AppDir -HomeDir $HomeDir) {
            return $true
        }
        $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue).ParentProcessId
    }

    return $false
}

function Stop-ProcessTreeGracefully {
    param(
        [int]$ProcessId,
        [int]$GraceSeconds = 8
    )

    if ($ProcessId -le 0) {
        return
    }

    try {
        Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
    }
    catch {
    }

    $deadline = (Get-Date).AddSeconds($GraceSeconds)
    while ((Get-Date) -lt $deadline) {
        $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if (-not $proc) {
            return
        }
        Start-Sleep -Milliseconds 400
    }

    & taskkill.exe /T /PID $ProcessId 2>$null | Out-Null
    Start-Sleep -Milliseconds 400

    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($proc) {
        & taskkill.exe /F /T /PID $ProcessId 2>$null | Out-Null
        Start-Sleep -Milliseconds 400
    }
}

function Stop-MagicClawManagedProcess {
    param(
        [int]$ProcessId,
        [string]$Label,
        [string]$AppDir,
        [string]$HomeDir,
        [int]$PidFromFile = 0,
        [scriptblock]$WriteStatus = { param($Text) Write-Host $Text -ForegroundColor Yellow }
    )

    if ($ProcessId -le 0) {
        return
    }

    if (-not (Test-ProcessIsMagicClawManaged -ProcessId $ProcessId -AppDir $AppDir -HomeDir $HomeDir -PidFromFile $PidFromFile)) {
        & $WriteStatus "Skipping $Label (pid $ProcessId) — not owned by this MagicClaw install"
        return
    }

    & $WriteStatus "Stopping $Label (pid $ProcessId)..."
    Stop-ProcessTreeGracefully -ProcessId $ProcessId
}

function Stop-ProcessesFromPidFiles {
    param(
        [string]$HomeDir,
        [string]$AppDir,
        [scriptblock]$WriteStatus = { param($Text) Write-Host $Text -ForegroundColor Yellow }
    )

    $runDir = Join-Path $HomeDir 'run'
    foreach ($entry in @(
            @{ Name = 'API'; File = Join-Path $runDir 'api.pid' },
            @{ Name = 'Web'; File = Join-Path $runDir 'web.pid' }
        )) {
        $pidFromFile = Read-PidFileValue -PidFile $entry.File
        if ($pidFromFile -le 0) {
            continue
        }

        Stop-MagicClawManagedProcess `
            -ProcessId $pidFromFile `
            -Label "$($entry.Name) (pid file)" `
            -AppDir $AppDir `
            -HomeDir $HomeDir `
            -PidFromFile $pidFromFile `
            -WriteStatus $WriteStatus

        Remove-Item -LiteralPath $entry.File -Force -ErrorAction SilentlyContinue
    }
}

function Wait-ForMagicClawPortsFree {
    param(
        [string]$HomeDir,
        [int]$TimeoutSeconds = 20
    )

    $ports = Get-MagicClawPortsFromEnvFile -HomeDir $HomeDir
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $apiBusy = (Get-ListenerProcessIdOnPort -Port $ports.Api) -gt 0
        $webBusy = (Get-ListenerProcessIdOnPort -Port $ports.Web) -gt 0
        if (-not $apiBusy -and -not $webBusy) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }

    return $false
}

function Invoke-MagicClawServiceStop {
    param(
        [string]$HomeDir,
        [string]$AppDir,
        [scriptblock]$StopViaLauncher,
        [scriptblock]$WriteStatus = { param($Text) Write-Host $Text -ForegroundColor Yellow }
    )

    $launcher = Join-Path $AppDir 'bin\magicclaw.ps1'
    if ($StopViaLauncher -and (Test-Path -LiteralPath $launcher)) {
        try {
            & $WriteStatus 'Stopping running MagicClaw services via launcher...'
            & $StopViaLauncher
        }
        catch {
            # Fall back to pid-file cleanup below.
        }
    }

    Stop-ProcessesFromPidFiles -HomeDir $HomeDir -AppDir $AppDir -WriteStatus $WriteStatus
    [void](Wait-ForMagicClawPortsFree -HomeDir $HomeDir)
}

function Restore-InstallDirectoryFromBackup {
    param(
        [string]$TargetDir,
        [string]$BackupPath
    )

    if (-not $BackupPath -or -not (Test-Path -LiteralPath $BackupPath)) {
        return
    }

    if (Test-Path -LiteralPath $TargetDir) {
        Remove-Item -LiteralPath $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Rename-Item -LiteralPath $BackupPath -NewName (Split-Path $TargetDir -Leaf) -ErrorAction SilentlyContinue
}

function Swap-InstallDirectory {
    param(
        [string]$TargetDir,
        [string]$SourceDir,
        [string]$HomeDir,
        [string]$AppDir,
        [scriptblock]$BeforeRetry,
        [scriptblock]$WriteStatus = { param($Text) Write-Host $Text -ForegroundColor Yellow },
        [int]$MaxAttempts = 5
    )

    $parentDir = Split-Path $TargetDir -Parent
    $leaf = Split-Path $TargetDir -Leaf
    $backupPath = $null

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            if (Test-Path -LiteralPath $TargetDir) {
                $backupName = "$leaf.old.$(Get-Date -Format 'yyyyMMddHHmmss')"
                $backupPath = Join-Path $parentDir $backupName
                Rename-Item -LiteralPath $TargetDir -NewName $backupName -ErrorAction Stop
                Move-Item -LiteralPath $SourceDir -Destination $TargetDir -ErrorAction Stop
            }
            else {
                New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
                Move-Item -LiteralPath $SourceDir -Destination $TargetDir -ErrorAction Stop
            }

            if ($backupPath -and (Test-Path -LiteralPath $backupPath)) {
                Remove-Item -LiteralPath $backupPath -Recurse -Force -ErrorAction SilentlyContinue
            }

            return
        }
        catch {
            if ($backupPath -and (Test-Path -LiteralPath $backupPath) -and -not (Test-Path -LiteralPath $TargetDir)) {
                Restore-InstallDirectoryFromBackup -TargetDir $TargetDir -BackupPath $backupPath
            }

            if ($attempt -ge $MaxAttempts) {
                throw "Could not replace install files under $TargetDir. Run 'magicclaw stop' and retry.`n$($_.Exception.Message)"
            }

            & $WriteStatus "Install files are locked; stopping services and retrying ($attempt/$MaxAttempts)..."
            if ($BeforeRetry) {
                & $BeforeRetry
            }
            Start-Sleep -Seconds 2
        }
    }
}
