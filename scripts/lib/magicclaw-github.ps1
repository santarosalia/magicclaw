# GitHub release resolution for MagicClaw installers/launchers.
# Dot-source this file; do not run standalone.

function Get-MagicClawGitHubRequestHeaders {
    $headers = @{
        Accept       = 'application/vnd.github+json'
        'User-Agent' = 'magicclaw-installer'
    }

    if ($env:GITHUB_TOKEN) {
        $headers.Authorization = "Bearer $env:GITHUB_TOKEN"
    }

    return $headers
}

function Resolve-MagicClawGitHubAbsoluteUri {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUri,

        [Parameter(Mandatory = $true)]
        [string]$Reference
    )

    if ([string]::IsNullOrWhiteSpace($Reference)) {
        return $null
    }

    if ($Reference -match '^https?://') {
        return $Reference
    }

    try {
        return (New-Object System.Uri([Uri]$BaseUri, $Reference)).AbsoluteUri
    }
    catch {
        return $null
    }
}

function Get-MagicClawReleaseTagFromUrl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    if ([string]::IsNullOrWhiteSpace($Url)) {
        return $null
    }

    $decoded = [Uri]::UnescapeDataString($Url)
    if ($decoded -match '/releases/tag/([^/?#]+)') {
        return $Matches[1]
    }
    if ($decoded -match '/releases/download/([^/]+)/') {
        return $Matches[1]
    }

    return $null
}

function Get-MagicClawReleaseTagFromHtml {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Html
    )

    if ($Html -match '/releases/tag/([^"?#]+)') {
        return [Uri]::UnescapeDataString($Matches[1])
    }

    return $null
}

function Get-MagicClawReleaseTagViaHttpRedirectChain {
    param(
        [Parameter(Mandatory = $true)]
        [string]$StartUri
    )

    $uri = $StartUri

    for ($hop = 0; $hop -lt 10; $hop++) {
        $tag = Get-MagicClawReleaseTagFromUrl -Url $uri
        if ($tag) {
            return $tag
        }

        $location = $null

        foreach ($method in @('HEAD', 'GET')) {
            try {
                $request = [System.Net.HttpWebRequest]::Create($uri)
                $request.Method = $method
                $request.AllowAutoRedirect = $false
                $request.UserAgent = 'magicclaw-installer'
                if ($env:GITHUB_TOKEN) {
                    $request.Headers.Add('Authorization', "Bearer $env:GITHUB_TOKEN")
                }

                $response = $request.GetResponse()
                $location = $response.Headers['Location']
                if (-not $location -and $response.ResponseUri) {
                    $location = $response.ResponseUri.AbsoluteUri
                }
                $response.Close()
                if ($location) {
                    break
                }
            }
            catch {
                $webResponse = $_.Exception.Response
                if ($webResponse) {
                    $location = $webResponse.Headers['Location']
                    if (-not $location -and $webResponse.ResponseUri) {
                        $location = $webResponse.ResponseUri.AbsoluteUri
                    }
                    $webResponse.Close()
                    if ($location) {
                        break
                    }
                }
            }
        }

        if ($location -is [array]) {
            $location = $location[0]
        }

        $nextUri = Resolve-MagicClawGitHubAbsoluteUri -BaseUri $uri -Reference $location
        if (-not $nextUri -or $nextUri -eq $uri) {
            break
        }

        $uri = $nextUri
    }

    return Get-MagicClawReleaseTagFromUrl -Url $uri
}

function Get-MagicClawReleaseTagViaInvokeWebRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$StartUri
    )

    $headers = @{
        'User-Agent' = 'magicclaw-installer'
    }
    if ($env:GITHUB_TOKEN) {
        $headers.Authorization = "Bearer $env:GITHUB_TOKEN"
    }

    try {
        $response = Invoke-WebRequest -Uri $StartUri -Headers $headers -MaximumRedirection 10 -UseBasicParsing -ErrorAction Stop
        if ($response.BaseResponse -and $response.BaseResponse.ResponseUri) {
            $tag = Get-MagicClawReleaseTagFromUrl -Url $response.BaseResponse.ResponseUri.AbsoluteUri
            if ($tag) {
                return $tag
            }
        }

        return Get-MagicClawReleaseTagFromHtml -Html $response.Content
    }
    catch {
        $webResponse = $_.Exception.Response
        if ($webResponse -and $webResponse.ResponseUri) {
            $tag = Get-MagicClawReleaseTagFromUrl -Url $webResponse.ResponseUri.AbsoluteUri
            if ($tag) {
                return $tag
            }
        }
    }

    return $null
}

function Get-MagicClawLatestReleaseTagFromRedirect {
    param(
        [Parameter(Mandatory = $true)]
        [string]$GitHubRepo
    )

    $startUris = @(
        "https://github.com/$GitHubRepo/releases/latest/download/install.ps1",
        "https://github.com/$GitHubRepo/releases/latest"
    )

    foreach ($startUri in $startUris) {
        $tag = Get-MagicClawReleaseTagViaHttpRedirectChain -StartUri $startUri
        if ($tag) {
            return $tag
        }

        $tag = Get-MagicClawReleaseTagViaInvokeWebRequest -StartUri $startUri
        if ($tag) {
            return $tag
        }
    }

    return $null
}

function Get-MagicClawReleaseAssetUrlCandidates {
    param(
        [Parameter(Mandatory = $true)]
        [string]$GitHubRepo,

        [string]$ReleaseTag,

        [Parameter(Mandatory = $true)]
        [string]$FileName
    )

    $urls = @(
        "https://github.com/$GitHubRepo/releases/latest/download/$FileName"
    )

    if ($ReleaseTag) {
        $urls += @(
            "https://github.com/$GitHubRepo/releases/download/$ReleaseTag/$FileName",
            "https://raw.githubusercontent.com/$GitHubRepo/$ReleaseTag/scripts/lib/$FileName"
        )
    }

    $urls += "https://raw.githubusercontent.com/$GitHubRepo/main/scripts/lib/$FileName"

    return @($urls | Select-Object -Unique)
}

function Get-MagicClawPowerShellModulePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ModuleName,

        [Parameter(Mandatory = $true)]
        [string]$GitHubRepo,

        [string]$ReleaseTag,

        [string[]]$SearchRoots = @(),

        [switch]$SkipLocalSearch
    )

    $fileName = "$ModuleName.ps1"

    if (-not $SkipLocalSearch) {
        foreach ($root in $SearchRoots) {
            if (-not $root) {
                continue
            }

            foreach ($candidate in @(
                    (Join-Path $root $fileName),
                    (Join-Path (Join-Path $root 'lib') $fileName)
                )) {
                if (Test-Path -LiteralPath $candidate) {
                    return $candidate
                }
            }
        }
    }

    $tmp = Join-Path $env:TEMP ("magicclaw-$ModuleName-" + [guid]::NewGuid().ToString('n') + '.ps1')
    $errors = @()
    $urls = Get-MagicClawReleaseAssetUrlCandidates -GitHubRepo $GitHubRepo -ReleaseTag $ReleaseTag -FileName $fileName

    foreach ($url in $urls) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -ErrorAction Stop
            return $tmp
        }
        catch {
            $errors += "$url -> $($_.Exception.Message)"
        }
    }

    throw "Could not download $fileName.`n$($errors -join [Environment]::NewLine)"
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

    $path = Get-MagicClawPowerShellModulePath `
        -ModuleName $ModuleName `
        -GitHubRepo $GitHubRepo `
        -ReleaseTag $ReleaseTag `
        -SearchRoots $SearchRoots
    . $path
}

function Invoke-MagicClawReleaseDownload {
    param(
        [Parameter(Mandatory = $true)]
        [string]$GitHubRepo,

        [Parameter(Mandatory = $true)]
        [string]$ReleaseTag,

        [Parameter(Mandatory = $true)]
        [string]$FileName,

        [Parameter(Mandatory = $true)]
        [string]$DestinationPath
    )

    $errors = @()
    $urls = Get-MagicClawReleaseAssetUrlCandidates -GitHubRepo $GitHubRepo -ReleaseTag $ReleaseTag -FileName $FileName

    foreach ($url in $urls) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $DestinationPath -UseBasicParsing -ErrorAction Stop
            return
        }
        catch {
            $errors += "$url -> $($_.Exception.Message)"
        }
    }

    throw "Could not download $FileName for $ReleaseTag.`n$($errors -join [Environment]::NewLine)"
}

function Get-MagicClawLatestReleaseTag {
    param(
        [Parameter(Mandatory = $true)]
        [string]$GitHubRepo,

        [string]$Version
    )

    if ($Version) {
        return $Version
    }

    $errors = @()

    try {
        $tag = Get-MagicClawLatestReleaseTagFromRedirect -GitHubRepo $GitHubRepo
        if ($tag) {
            return $tag
        }
        $errors += 'redirect: no tag found via releases/latest or latest/download/install.ps1'
    }
    catch {
        $errors += "redirect: $($_.Exception.Message)"
    }

    $apiUrl = "https://api.github.com/repos/$GitHubRepo/releases/latest"
    $headers = Get-MagicClawGitHubRequestHeaders

    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Headers $headers -Method Get -ErrorAction Stop
        if ($response.tag_name) {
            return $response.tag_name
        }
        $errors += 'api: response did not include tag_name'
    }
    catch {
        $errors += "api: $($_.Exception.Message)"
    }

    throw @(
        'Could not resolve latest release tag.'
        'Specify -Version vX.Y.Z, set GITHUB_TOKEN, or set MAGICCLAW_VERSION.'
        ($errors -join [Environment]::NewLine)
    ) -join [Environment]::NewLine
}
