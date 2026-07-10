BeforeAll {
    $serviceLib = Join-Path $PSScriptRoot '..' 'lib' 'magicclaw-service.ps1'
    . $serviceLib

    $script:AppDir = 'C:\Users\test\.magicclaw\app'
    $script:HomeDir = 'C:\Users\test\.magicclaw'
}

Describe 'Join-MagicClawInstallPath' {
    It 'builds Windows install paths consistently on non-Windows runners' {
        Join-MagicClawInstallPath -Root $script:AppDir -ChildSegments @('bin', 'magicclaw.ps1') |
            Should -Be 'C:\Users\test\.magicclaw\app\bin\magicclaw.ps1'
    }
}

Describe 'Test-CommandLineReferencesMagicClawInstall' {
    It 'returns false for generic node entrypoints without install paths' {
        Test-CommandLineReferencesMagicClawInstall `
            -CommandLine 'node dist\main.js' `
            -AppDir $script:AppDir `
            -HomeDir $script:HomeDir | Should -Be $false

        Test-CommandLineReferencesMagicClawInstall `
            -CommandLine 'node web\server.js' `
            -AppDir $script:AppDir `
            -HomeDir $script:HomeDir | Should -Be $false
    }

    It 'returns true when command line references AppDir' {
        Test-CommandLineReferencesMagicClawInstall `
            -CommandLine "node $($script:AppDir)\api\dist\main.js" `
            -AppDir $script:AppDir `
            -HomeDir $script:HomeDir | Should -Be $true
    }

    It 'returns true when command line references HomeDir' {
        Test-CommandLineReferencesMagicClawInstall `
            -CommandLine "type $($script:HomeDir)\run\api.log" `
            -AppDir $script:AppDir `
            -HomeDir $script:HomeDir | Should -Be $true
    }
}

Describe 'Test-CommandLineReferencesLauncherForInstall' {
    It 'matches only launchers under the target AppDir' {
        Test-CommandLineReferencesLauncherForInstall `
            -CommandLine "powershell -File $($script:AppDir)\bin\magicclaw.ps1 update" `
            -AppDir $script:AppDir | Should -Be $true

        Test-CommandLineReferencesLauncherForInstall `
            -CommandLine 'powershell -File D:\other\app\bin\magicclaw.ps1 start' `
            -AppDir $script:AppDir | Should -Be $false

        Test-CommandLineReferencesLauncherForInstall `
            -CommandLine 'powershell -File magicclaw.ps1 update' `
            -AppDir $script:AppDir | Should -Be $false
    }
}

Describe 'Test-ProcessShouldStopForInstall' {
    It 'returns false when process id is in the protected set' {
        $protected = [System.Collections.Generic.HashSet[int]]::new()
        [void]$protected.Add(4242)

        Test-ProcessShouldStopForInstall `
            -ProcessId 4242 `
            -AppDir $script:AppDir `
            -HomeDir $script:HomeDir `
            -ProtectedIds $protected `
            -PidFromFile 4242 | Should -Be $false
    }

    It 'returns true for pid-file match when not protected' {
        $protected = [System.Collections.Generic.HashSet[int]]::new()
        [void]$protected.Add($PID)

        Test-ProcessShouldStopForInstall `
            -ProcessId 9001 `
            -AppDir $script:AppDir `
            -HomeDir $script:HomeDir `
            -ProtectedIds $protected `
            -PidFromFile 9001 | Should -Be $true
    }
}
