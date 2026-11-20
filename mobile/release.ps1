param(
  [Parameter(Mandatory = $true)][string]$VersionName,
  [switch]$SkipDeploy,
  # Shown in the in-app update prompt on the phone; keep it one short, user-facing sentence.
  [string]$UpdateNotes = "本次更新包含体验改进与问题修复，覆盖安装即可，账目和设置都会保留。"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if ($VersionName -notmatch '^\d+\.\d+$') {
  throw "VersionName must look like 2.10 (digits dot digits)."
}

$gradlePath = Join-Path $repoRoot "android\app\build.gradle"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$gradle = [System.IO.File]::ReadAllText($gradlePath, [System.Text.Encoding]::UTF8)

$oldCodeText = [regex]::Match($gradle, 'versionCode\s+(\d+)').Groups[1].Value
$oldName = [regex]::Match($gradle, 'versionName\s+"([^"]+)"').Groups[1].Value
if (-not $oldCodeText) { throw "Cannot find versionCode in build.gradle" }
$oldCode = [int]$oldCodeText

if ([version]$VersionName -le [version]$oldName) {
  throw "New version $VersionName must be greater than current $oldName. Android rejects same-or-lower versions."
}

$newCode = $oldCode + 1
Write-Output ("Version: " + $oldName + " (" + $oldCode + ") -> " + $VersionName + " (" + $newCode + ")")

$gradle = [regex]::Replace($gradle, 'versionCode\s+\d+', "versionCode $newCode")
$gradle = [regex]::Replace($gradle, 'versionName\s+"[^"]+"', ('versionName "' + $VersionName + '"'))
[System.IO.File]::WriteAllText($gradlePath, $gradle, $utf8)

Write-Output "Building signed offline APK..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-offline-release.ps1")
if ($LASTEXITCODE -ne 0) {
  throw "Build failed. build.gradle has already been bumped to $VersionName ($newCode); revert it if you do not want that."
}

$apk = Join-Path $repoRoot ("releases\jizhangben-offline-v" + $VersionName + "-release.apk")
if (-not (Test-Path -LiteralPath $apk)) {
  throw "Build reported success but $apk is missing."
}

$downloadDir = Join-Path $repoRoot "site\download"
if (-not (Test-Path -LiteralPath $downloadDir)) {
  $null = New-Item -ItemType Directory -Force -Path $downloadDir
}
Get-ChildItem -LiteralPath $downloadDir -Filter "*.apk" -File | Remove-Item -Force
$siteApk = Join-Path $downloadDir ("jizhangben-v" + $VersionName + ".apk")
Copy-Item -LiteralPath $apk -Destination $siteApk -Force
$sizeMb = [math]::Round((Get-Item -LiteralPath $siteApk).Length / 1MB, 1)
Write-Output ("Site APK: site/download/jizhangben-v" + $VersionName + ".apk (" + $sizeMb + " MB)")

# Update the landing page: download href, download filename, version label, size label.
$indexPath = Join-Path $repoRoot "site\index.html"
$html = [System.IO.File]::ReadAllText($indexPath, [System.Text.Encoding]::UTF8)

$html = [regex]::Replace($html, 'href="download/jizhangben-v\d+\.\d+\.apk"', ('href="download/jizhangben-v' + $VersionName + '.apk"'))
$html = [regex]::Replace($html, 'download="([^"]*)v\d+\.\d+\.apk"', ('download="${1}v' + $VersionName + '.apk"'))
$html = [regex]::Replace($html, '<span>v\d+\.\d+</span>', ('<span>v' + $VersionName + '</span>'))
$html = [regex]::Replace($html, '<span>[\d.]+ MB</span>', ('<span>' + $sizeMb + ' MB</span>'))

[System.IO.File]::WriteAllText($indexPath, $html, $utf8)
Write-Output "Landing page updated (href, filename, version label, size label)."

# --- In-app update manifest: describe the APK that was actually copied, not gradle ---
$apkCode = $newCode
$apkName = $VersionName
$buildToolsRoot = Join-Path (Split-Path -Parent $repoRoot) "android-tools\sdk\build-tools"
$aapt2 = $null
if (Test-Path -LiteralPath $buildToolsRoot) {
  $aapt2 = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "aapt2.exe") } |
    Sort-Object { try { [version]$_.Name } catch { [version]"0.0.0" } } -Descending |
    Select-Object -First 1 |
    ForEach-Object { Join-Path $_.FullName "aapt2.exe" }
}

if (-not $aapt2) {
  Write-Warning ("aapt2 not found under " + $buildToolsRoot + "; falling back to the gradle version values.")
} else {
  # aapt2 writing to stderr must not abort the release under $ErrorActionPreference = Stop.
  $savedErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $badging = (& $aapt2 dump badging $siteApk 2>&1 | Out-String)
    $badgingExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedErrorAction
  }
  $badgingMatch = [regex]::Match($badging, "versionCode='(\d+)' versionName='([^']+)'")
  if ($badgingExit -ne 0 -or -not $badgingMatch.Success) {
    Write-Warning ("aapt2 could not read " + $siteApk + " (exit " + $badgingExit + "); falling back to the gradle version values.")
  } else {
    $apkCode = [int]$badgingMatch.Groups[1].Value
    $apkName = $badgingMatch.Groups[2].Value
    Write-Output ("APK manifest: versionCode=" + $apkCode + " versionName=" + $apkName)
    if ($apkCode -ne $newCode -or $apkName -ne $VersionName) {
      throw ("APK version mismatch: expected " + $VersionName + " (" + $newCode + ") but " + $siteApk + " reports " + $apkName + " (" + $apkCode + "). Stopped before writing version.json or deploying.")
    }
  }
}

# Written unconditionally (also with -SkipDeploy) so the manifest can be inspected locally.
$versionJsonPath = Join-Path $repoRoot "site\version.json"
$apkRelativePath = "download/jizhangben-v" + $VersionName + ".apk"
& (Join-Path $PSScriptRoot "site-version.ps1") -VersionCode $apkCode -VersionName $apkName -Notes $UpdateNotes -ApkFile $apkRelativePath -OutputPath $versionJsonPath
Write-Output "Update manifest written: site/version.json"

if ($SkipDeploy) {
  Write-Output "SkipDeploy is set: nothing was uploaded (site/version.json stays local until the next deploy)."
} else {
  Write-Output "Deploying to Cloudflare Pages..."
  & npx --yes wrangler@latest pages deploy site --project-name=jizhangben-download --branch=main --commit-dirty=true
  if ($LASTEXITCODE -ne 0) {
    throw "Deploy failed. The build, the page and site/version.json are already updated locally; run the wrangler command again when the network is fine."
  }
  Write-Output "Live: https://jizhangben-download.pages.dev/"

  # Best effort: a network failure is only a warning, but a stale versionCode means the
  # site is offering a different APK than the one the prompt points at.
  $liveVersion = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $liveUrl = "https://jizhangben-download.pages.dev/version.json?t=" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    try {
      $liveVersion = Invoke-RestMethod -Uri $liveUrl -TimeoutSec 15 -UseBasicParsing
      # Invoke-RestMethod hands back a raw string when the response has no JSON content type.
      if ($liveVersion -is [string]) { $liveVersion = $liveVersion | ConvertFrom-Json }
      if ([int]$liveVersion.versionCode -eq $apkCode) { break }
      Write-Warning ("Live version.json reports versionCode " + $liveVersion.versionCode + ", expected " + $apkCode + " (attempt " + $attempt + "/3).")
    } catch {
      $liveVersion = $null
      Write-Warning ("Could not fetch " + $liveUrl + " (attempt " + $attempt + "/3): " + $_.Exception.Message)
    }
    if ($attempt -lt 3) { Start-Sleep -Seconds 5 }
  }
  if ($null -eq $liveVersion) {
    Write-Warning "Could not verify the live version.json (network error). The deploy succeeded; check https://jizhangben-download.pages.dev/version.json manually."
  } elseif ([int]$liveVersion.versionCode -ne $apkCode) {
    throw ("Live version.json versionCode is " + $liveVersion.versionCode + " but this release is " + $apkCode + ". The site is serving a stale update manifest.")
  } else {
    Write-Output ("Live version.json OK: versionCode=" + $liveVersion.versionCode + " versionName=" + $liveVersion.versionName)
  }
}

Write-Output ""
Write-Output "Checklist:"
Write-Output "  1. Install the new APK on your own phone before telling anyone else."
Write-Output "  2. Existing users only need to download and install over the old version; data is kept."
Write-Output "  3. In-app update prompts start with this release: anyone on v2.09 or older must install this APK manually once."
Write-Output "  4. site/version.json is generated from the copied APK; never edit it by hand."
Write-Output "  5. Never edit versionCode by hand in a way that makes it go backwards."
