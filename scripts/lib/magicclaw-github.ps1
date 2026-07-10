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

function Get-MagicClawReleaseAssetUrlCandidates {
    param(
        [Parameter(Mandatory = $true)]
        [string]$GitHubRepo,

        [Parameter(Mandatory = $true)]
        [string]$ReleaseTag,

        [Parameter(Mandatory = $true)]
        [string]$FileName
    )

    return @(
        "https://github.com/$GitHubRepo/releases/download/$ReleaseTag/$FileName",
        "https://raw.githubusercontent.com/$GitHubRepo/$ReleaseTag/scripts/lib/$FileName"
    )
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

    if (-not $ReleaseTag) {
        throw "Could not locate $fileName locally and no release tag was provided for download."
    }

    $tmp = Join-Path $env:TEMP ("magicclaw-$ModuleName-" + [guid]::NewGuid().ToString('n') + '.ps1')
    $errors = @()
    $urls = Get-MagicClawReleaseAssetUrlCandidates -GitHubRepo $GitHubRepo -ReleaseTag $ReleaseTag -FileName $fileName

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

        throw "Could not download $fileName for $ReleaseTag.`n$($errors -join [Environment]::NewLine)"
    }
    finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Get-MagicClawLatestReleaseTagFromRedirect {
    param(
        [Parameter(Mandatory = $true)]
        [string]$GitHubRepo
    )

    $uri = "https://github.com/$GitHubRepo/releases/latest"

    foreach ($method in @('HEAD', 'GET')) {
        $location = $null

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
        }
        catch {
            $webResponse = $_.Exception.Response
            if ($webResponse) {
                $location = $webResponse.Headers['Location']
                $webResponse.Close()
            }
        }

        if ($location -is [array]) {
            $location = $location[0]
        }

        if ($location -and $location -match '/releases/tag/([^/?#]+)') {
            return [Uri]::UnescapeDataString($Matches[1])
        }
    }

    return $null
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

    $tag = Get-MagicClawLatestReleaseTagFromRedirect -GitHubRepo $GitHubRepo
    if ($tag) {
        return $tag
    }

    $apiUrl = "https://api.github.com/repos/$GitHubRepo/releases/latest"
    $headers = Get-MagicClawGitHubRequestHeaders

    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Headers $headers -Method Get -ErrorAction Stop
    }
    catch {
        throw "Could not resolve latest release via redirect or GitHub API. Specify -Version vX.Y.Z or set GITHUB_TOKEN.`n$($_.Exception.Message)"
    }

    if (-not $response.tag_name) {
        throw 'Could not resolve latest release: GitHub API response did not include tag_name.'
    }

    return $response.tag_name
}
