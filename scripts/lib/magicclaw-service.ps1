# MagicClaw Windows service/process helpers.
# Dot-source from install.ps1 or bin/magicclaw.ps1 - not standalone.

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

function Join-MagicClawInstallPath {
    param(
        [string]$Root,
        [string[]]$ChildSegments
    )

    if (-not $Root) {
        return ($ChildSegments | ForEach-Object { $_.Trim('\', '/') }) -join '\'
    }

    $normalizedRoot = $Root.TrimEnd('\', '/')
    $childPath = ($ChildSegments | ForEach-Object { $_.Trim('\', '/').TrimStart('\', '/') }) -join '\'
    return "$normalizedRoot\$childPath"
}

function Get-MagicClawKnownEntryPaths {
    param(
        [string]$AppDir,
        [string]$HomeDir
    )

    $paths = @(
        (Join-MagicClawInstallPath -Root $AppDir -ChildSegments @('api', 'dist', 'main.js')),
        (Join-MagicClawInstallPath -Root $AppDir -ChildSegments @('web', 'apps', 'web', 'server.js')),
        (Join-MagicClawInstallPath -Root $AppDir -ChildSegments @('web', 'server.js')),
        (Join-MagicClawInstallPath -Root $AppDir -ChildSegments @('bin', 'magicclaw.ps1')),
        (Join-MagicClawInstallPath -Root $AppDir -ChildSegments @('bin', 'magicclaw.cmd')),
        (Join-MagicClawInstallPath -Root $HomeDir -ChildSegments @('run', 'api.pid')),
        (Join-MagicClawInstallPath -Root $HomeDir -ChildSegments @('run', 'web.pid')),
        (Join-MagicClawInstallPath -Root $HomeDir -ChildSegments @('run', 'api.log')),
        (Join-MagicClawInstallPath -Root $HomeDir -ChildSegments @('run', 'web.log'))
    )

    return @($paths | ForEach-Object { $_.TrimEnd('\', '/') } | Where-Object { $_ })
}

function Test-CommandLineContainsPathFragment {
    param(
        [string]$CommandLine,
        [string]$Fragment
    )

    if (-not $CommandLine -or -not $Fragment) {
        return $false
    }

    $normalizedLine = $CommandLine.ToLowerInvariant().Replace('\', '/')
    $normalizedFragment = $Fragment.ToLowerInvariant().Replace('\', '/').TrimEnd('/')
    return $normalizedLine.Contains($normalizedFragment)
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

    foreach ($needle in @($AppDir.TrimEnd('\', '/'), $HomeDir.TrimEnd('\', '/'))) {
        if (Test-CommandLineContainsPathFragment -CommandLine $CommandLine -Fragment $needle) {
            return $true
        }
    }

    foreach ($entryPath in (Get-MagicClawKnownEntryPaths -AppDir $AppDir -HomeDir $HomeDir)) {
        $belongsToInstall = (Test-CommandLineContainsPathFragment -CommandLine $entryPath -Fragment $AppDir) -or
            (Test-CommandLineContainsPathFragment -CommandLine $entryPath -Fragment $HomeDir)
        if (-not $belongsToInstall) {
            continue
        }

        if (Test-CommandLineContainsPathFragment -CommandLine $CommandLine -Fragment $entryPath) {
            return $true
        }
    }

    return $false
}

function Get-ProtectedInstallProcessIds {
    $protected = [System.Collections.Generic.HashSet[int]]::new()
    $current = $PID

    while ($current -gt 0) {
        [void]$protected.Add($current)
        $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue).ParentProcessId
        if ($parent -le 0 -or $parent -eq $current) {
            break
        }
        $current = $parent
    }

    return $protected
}

function Test-ProcessShouldStopForInstall {
    param(
        [int]$ProcessId,
        [string]$AppDir,
        [string]$HomeDir,
        [System.Collections.Generic.HashSet[int]]$ProtectedIds,
        [int]$PidFromFile = 0
    )

    if ($ProcessId -le 0) {
        return $false
    }

    if ($ProtectedIds -and $ProtectedIds.Contains($ProcessId)) {
        return $false
    }

    return Test-ProcessIsMagicClawManaged -ProcessId $ProcessId -AppDir $AppDir -HomeDir $HomeDir -PidFromFile $PidFromFile
}

function Test-CommandLineReferencesLauncherForInstall {
    param(
        [string]$CommandLine,
        [string]$AppDir
    )

    if (-not $CommandLine -or -not $AppDir) {
        return $false
    }

    $launcherPs1 = Join-MagicClawInstallPath -Root $AppDir -ChildSegments @('bin', 'magicclaw.ps1')
    $launcherCmd = Join-MagicClawInstallPath -Root $AppDir -ChildSegments @('bin', 'magicclaw.cmd')

    return (Test-CommandLineContainsPathFragment -CommandLine $CommandLine -Fragment $launcherPs1) -or
        (Test-CommandLineContainsPathFragment -CommandLine $CommandLine -Fragment $launcherCmd)
}

function Clear-ShellLocationUnderPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetPath
    )

    try {
        $normalizedTarget = $TargetPath.TrimEnd('\')
        $normalizedPrefix = $normalizedTarget + '\'
        $current = (Get-Location).Path
        if ($current -and ($current -eq $normalizedTarget -or $current.StartsWith($normalizedPrefix))) {
            Set-Location -LiteralPath $env:TEMP
        }
    }
    catch {
    }
}

function Stop-MagicClawPortListeners {
    param(
        [string]$HomeDir,
        [string]$AppDir,
        [System.Collections.Generic.HashSet[int]]$ProtectedProcessIds,
        [scriptblock]$WriteStatus
    )

    if (-not $WriteStatus) {
        $WriteStatus = Get-DefaultServiceWriteStatus
    }

    if (-not $ProtectedProcessIds) {
        $ProtectedProcessIds = Get-ProtectedInstallProcessIds
    }

    $ports = Get-MagicClawPortsFromEnvFile -HomeDir $HomeDir
    foreach ($entry in @(
            @{ Name = 'API'; Port = $ports.Api },
            @{ Name = 'Web'; Port = $ports.Web }
        )) {
        $listenerPid = Get-ListenerProcessIdOnPort -Port $entry.Port
        if ($listenerPid -le 0) {
            continue
        }

        if (Test-ProcessShouldStopForInstall -ProcessId $listenerPid -AppDir $AppDir -HomeDir $HomeDir -ProtectedIds $ProtectedProcessIds) {
            & $WriteStatus "Stopping $($entry.Name) listener on port $($entry.Port) (pid $listenerPid)..."
            Stop-ProcessTreeGracefully -ProcessId $listenerPid
        }
        else {
            & $WriteStatus "Skipping $($entry.Name) listener on port $($entry.Port) (pid $listenerPid) - not owned by this MagicClaw install"
        }
    }
}

function Stop-MagicClawNodeProcessesForInstall {
    param(
        [string]$AppDir,
        [string]$HomeDir,
        [System.Collections.Generic.HashSet[int]]$ProtectedProcessIds,
        [scriptblock]$WriteStatus
    )

    if (-not $WriteStatus) {
        $WriteStatus = Get-DefaultServiceWriteStatus
    }

    if (-not $ProtectedProcessIds) {
        $ProtectedProcessIds = Get-ProtectedInstallProcessIds
    }

    $processes = @(
        Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
        Get-CimInstance Win32_Process -Filter "Name='nodejs.exe'" -ErrorAction SilentlyContinue
    ) | Where-Object { $_ }

    foreach ($proc in $processes) {
        $processId = [int]$proc.ProcessId
        if ($processId -le 0) {
            continue
        }

        if (Test-ProcessShouldStopForInstall -ProcessId $processId -AppDir $AppDir -HomeDir $HomeDir -ProtectedIds $ProtectedProcessIds) {
            & $WriteStatus "Stopping MagicClaw node process (pid $processId)..."
            Stop-ProcessTreeGracefully -ProcessId $processId
        }
    }

    foreach ($proc in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -and (Test-CommandLineReferencesLauncherForInstall -CommandLine $_.CommandLine -AppDir $AppDir)
        })) {
        $processId = [int]$proc.ProcessId
        if ($processId -le 0) {
            continue
        }

        if ($ProtectedProcessIds.Contains($processId)) {
            continue
        }

        & $WriteStatus "Stopping MagicClaw launcher shell (pid $processId)..."
        Stop-ProcessTreeGracefully -ProcessId $processId
    }
}

function Stop-MagicClawInstallFileLocks {
    param(
        [string]$AppDir,
        [string]$HomeDir,
        [System.Collections.Generic.HashSet[int]]$ProtectedProcessIds,
        [scriptblock]$WriteStatus
    )

    if (-not $WriteStatus) {
        $WriteStatus = Get-DefaultServiceWriteStatus
    }

    if (-not $ProtectedProcessIds) {
        $ProtectedProcessIds = Get-ProtectedInstallProcessIds
    }

    Clear-ShellLocationUnderPath -TargetPath $AppDir
    Stop-ProcessesFromPidFiles -HomeDir $HomeDir -AppDir $AppDir -ProtectedProcessIds $ProtectedProcessIds -WriteStatus $WriteStatus
    Stop-MagicClawPortListeners -HomeDir $HomeDir -AppDir $AppDir -ProtectedProcessIds $ProtectedProcessIds -WriteStatus $WriteStatus
    Stop-MagicClawNodeProcessesForInstall -AppDir $AppDir -HomeDir $HomeDir -ProtectedProcessIds $ProtectedProcessIds -WriteStatus $WriteStatus
    [void](Wait-ForMagicClawPortsFree -HomeDir $HomeDir -TimeoutSeconds 25)
    Start-Sleep -Milliseconds 800
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

function Get-DefaultServiceWriteStatus {
    return { Write-Host $args[0] -ForegroundColor Yellow }
}

function Stop-MagicClawManagedProcess {
    param(
        [int]$ProcessId,
        [string]$Label,
        [string]$AppDir,
        [string]$HomeDir,
        [int]$PidFromFile = 0,
        [System.Collections.Generic.HashSet[int]]$ProtectedProcessIds,
        [scriptblock]$WriteStatus
    )

    if (-not $WriteStatus) {
        $WriteStatus = Get-DefaultServiceWriteStatus
    }

    if ($ProcessId -le 0) {
        return
    }

    if ($ProtectedProcessIds -and $ProtectedProcessIds.Contains($ProcessId)) {
        & $WriteStatus "Skipping $Label (pid $ProcessId) - protected install session process"
        return
    }

    if (-not (Test-ProcessIsMagicClawManaged -ProcessId $ProcessId -AppDir $AppDir -HomeDir $HomeDir -PidFromFile $PidFromFile)) {
        & $WriteStatus "Skipping $Label (pid $ProcessId) - not owned by this MagicClaw install"
        return
    }

    & $WriteStatus "Stopping $Label (pid $ProcessId)..."
    Stop-ProcessTreeGracefully -ProcessId $ProcessId
}

function Stop-ProcessesFromPidFiles {
    param(
        [string]$HomeDir,
        [string]$AppDir,
        [System.Collections.Generic.HashSet[int]]$ProtectedProcessIds,
        [scriptblock]$WriteStatus
    )

    if (-not $WriteStatus) {
        $WriteStatus = Get-DefaultServiceWriteStatus
    }

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
            -ProtectedProcessIds $ProtectedProcessIds `
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

function Test-MagicClawScriptParsable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }

    $tokens = $null
    $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$parseErrors)
    return ($parseErrors.Count -eq 0)
}

function Invoke-MagicClawServiceStop {
    param(
        [string]$HomeDir,
        [string]$AppDir,
        [scriptblock]$StopViaLauncher,
        [scriptblock]$WriteStatus,
        [switch]$Aggressive
    )

    if (-not $WriteStatus) {
        $WriteStatus = Get-DefaultServiceWriteStatus
    }

    $launcher = Join-Path $AppDir 'bin\magicclaw.ps1'
    if ($StopViaLauncher -and (Test-Path -LiteralPath $launcher) -and (Test-MagicClawScriptParsable -Path $launcher)) {
        try {
            & $WriteStatus 'Stopping running MagicClaw services via launcher...'
            & $StopViaLauncher
        }
        catch {
            # Fall back to pid/port cleanup below.
        }
    }
    elseif ($StopViaLauncher -and (Test-Path -LiteralPath $launcher)) {
        & $WriteStatus 'Skipping launcher stop - installed magicclaw.ps1 has parse errors; using service cleanup...'
    }

    $protectedProcessIds = Get-ProtectedInstallProcessIds

    Stop-ProcessesFromPidFiles -HomeDir $HomeDir -AppDir $AppDir -ProtectedProcessIds $protectedProcessIds -WriteStatus $WriteStatus

    if ($Aggressive) {
        Stop-MagicClawInstallFileLocks -AppDir $AppDir -HomeDir $HomeDir -ProtectedProcessIds $protectedProcessIds -WriteStatus $WriteStatus
        return
    }

    Stop-MagicClawPortListeners -HomeDir $HomeDir -AppDir $AppDir -ProtectedProcessIds $protectedProcessIds -WriteStatus $WriteStatus
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
        [scriptblock]$WriteStatus,
        [int]$MaxAttempts = 5
    )

    if (-not $WriteStatus) {
        $WriteStatus = Get-DefaultServiceWriteStatus
    }

    $parentDir = Split-Path $TargetDir -Parent
    $leaf = Split-Path $TargetDir -Leaf
    $backupPath = $null

    $protectedProcessIds = $null
    if ($AppDir -and $HomeDir) {
        $protectedProcessIds = Get-ProtectedInstallProcessIds
        Clear-ShellLocationUnderPath -TargetPath $TargetDir
        Stop-MagicClawInstallFileLocks -AppDir $AppDir -HomeDir $HomeDir -ProtectedProcessIds $protectedProcessIds -WriteStatus $WriteStatus
    }

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
            if ($AppDir -and $HomeDir) {
                if (-not $protectedProcessIds) {
                    $protectedProcessIds = Get-ProtectedInstallProcessIds
                }
                Stop-MagicClawInstallFileLocks -AppDir $AppDir -HomeDir $HomeDir -ProtectedProcessIds $protectedProcessIds -WriteStatus $WriteStatus
            }
            elseif ($BeforeRetry) {
                & $BeforeRetry
            }
            Start-Sleep -Seconds 2
        }
    }
}
