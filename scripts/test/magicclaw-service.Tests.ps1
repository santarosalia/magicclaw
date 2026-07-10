BeforeAll {
    $serviceLib = Join-Path $PSScriptRoot '..' 'lib' 'magicclaw-service.ps1'
    . $serviceLib
}

Describe 'Test-CommandLineReferencesMagicClawInstall' {
    $appDir = 'C:\Users\test\.magicclaw\app'
    $homeDir = 'C:\Users\test\.magicclaw'

    It 'returns false for generic node entrypoints without install paths' {
        Test-CommandLineReferencesMagicClawInstall `
            -CommandLine 'node dist\main.js' `
            -AppDir $appDir `
            -HomeDir $homeDir | Should -Be $false

        Test-CommandLineReferencesMagicClawInstall `
            -CommandLine 'node web\server.js' `
            -AppDir $appDir `
            -HomeDir $homeDir | Should -Be $false
    }

    It 'returns true when command line references AppDir' {
        Test-CommandLineReferencesMagicClawInstall `
            -CommandLine "node $appDir\api\dist\main.js" `
            -AppDir $appDir `
            -HomeDir $homeDir | Should -Be $true
    }

    It 'returns true when command line references HomeDir' {
        Test-CommandLineReferencesMagicClawInstall `
            -CommandLine "type $homeDir\run\api.log" `
            -AppDir $appDir `
            -HomeDir $homeDir | Should -Be $true
    }
}

Describe 'Test-CommandLineReferencesLauncherForInstall' {
    $appDir = 'C:\Users\test\.magicclaw\app'

    It 'matches only launchers under the target AppDir' {
        Test-CommandLineReferencesLauncherForInstall `
            -CommandLine "powershell -File $appDir\bin\magicclaw.ps1 update" `
            -AppDir $appDir | Should -Be $true

        Test-CommandLineReferencesLauncherForInstall `
            -CommandLine 'powershell -File D:\other\app\bin\magicclaw.ps1 start' `
            -AppDir $appDir | Should -Be $false

        Test-CommandLineReferencesLauncherForInstall `
            -CommandLine 'powershell -File magicclaw.ps1 update' `
            -AppDir $appDir | Should -Be $false
    }
}

Describe 'Test-ProcessShouldStopForInstall' {
    $appDir = 'C:\Users\test\.magicclaw\app'
    $homeDir = 'C:\Users\test\.magicclaw'

    It 'returns false when process id is in the protected set' {
        $protected = [System.Collections.Generic.HashSet[int]]::new()
        [void]$protected.Add(4242)

        Test-ProcessShouldStopForInstall `
            -ProcessId 4242 `
            -AppDir $appDir `
            -HomeDir $homeDir `
            -ProtectedIds $protected `
            -PidFromFile 4242 | Should -Be $false
    }

    It 'returns true for pid-file match when not protected' {
        $protected = [System.Collections.Generic.HashSet[int]]::new()
        [void]$protected.Add($PID)

        Test-ProcessShouldStopForInstall `
            -ProcessId 9001 `
            -AppDir $appDir `
            -HomeDir $homeDir `
            -ProtectedIds $protected `
            -PidFromFile 9001 | Should -Be $true
    }
}
