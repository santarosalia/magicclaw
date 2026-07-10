# GitHub release resolution for MagicClaw installers/launchers.
# Dot-source this file; does not run standalone.

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

        $candidate = Join-Path $root $fileName
        if (Test-Path -LiteralPath $candidate) {
            . $candidate
            return
        }

        $candidate = Join-Path (Join-Path $root 'lib') $fileName
        if (Test-Path -LiteralPath $candidate) {
            . $candidate
            return
        }
    }

    if (-not $ReleaseTag) {
        throw "Could not locate $fileName locally and no release tag was provided for download."
    }

    $tmp = Join-Path $env:TEMP ("magicclaw-$ModuleName-" + [guid]::NewGuid().ToString('n') + '.ps1')
    $url = "https://github.com/$GitHubRepo/releases/download/$ReleaseTag/$fileName"

    try {
        Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -ErrorAction Stop
        . $tmp
    }
    catch {
        throw "Could not download $fileName from $url`n$($_.Exception.Message)"
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
    $location = $null

    try {
        $request = [System.Net.HttpWebRequest]::Create($uri)
        $request.Method = 'HEAD'
        $request.AllowAutoRedirect = $false
        $request.UserAgent = 'magicclaw-installer'
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

    $apiUrl = "https://api.github.com/repos/$GitHubRepo/releases/latest"
    $headers = @{
        Accept       = 'application/vnd.github+json'
        'User-Agent' = 'magicclaw-installer'
    }

    if ($env:GITHUB_TOKEN) {
        $headers.Authorization = "Bearer $env:GITHUB_TOKEN"
    }

    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Headers $headers -Method Get -ErrorAction Stop
    }
    catch {
        $tag = Get-MagicClawLatestReleaseTagFromRedirect -GitHubRepo $GitHubRepo
        if ($tag) {
            return $tag
        }

        throw "Could not resolve latest release via GitHub API or redirect. Specify -Version vX.Y.Z or set GITHUB_TOKEN.`n$($_.Exception.Message)"
    }

    $tag = $response.tag_name
    if (-not $tag) {
        throw 'Could not resolve latest release: GitHub API response did not include tag_name.'
    }

    return $tag
}
