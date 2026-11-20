# Writes the in-app update manifest (site/version.json) for the download site.
#
# The Android shell fetches https://jizhangben-download.pages.dev/version.json
# across origins and compares its versionCode with the installed APK. So this
# manifest must describe the APK that was actually copied into site/download/,
# not just the values written in build.gradle.
#
# Standalone check (does not publish anything):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\mobile\site-version.ps1 `
#     -VersionCode 111 -VersionName 2.10 -Notes "In-app update prompt." `
#     -ApkFile "download/jizhangben-v2.10.apk" -OutputPath "$env:TEMP\version.json"
#
# The normal release flow calls this script with & from mobile/release.ps1, so
# the Chinese -Notes text stays in-process and is never re-encoded by a new shell.

param(
  [Parameter(Mandatory = $true)][int]$VersionCode,
  [Parameter(Mandatory = $true)][string]$VersionName,
  [Parameter(Mandatory = $true)][string]$Notes,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$ApkFile = "",
  [string]$PublishedAt = ""
)

$ErrorActionPreference = "Stop"

if ($VersionCode -lt 1) {
  throw "VersionCode must be a positive integer, got $VersionCode."
}
if ($VersionName -notmatch '^\d+\.\d+$') {
  throw "VersionName must look like 2.10 (digits dot digits), got '$VersionName'."
}
$trimmedNotes = $Notes.Trim()
if ($trimmedNotes.Length -eq 0) {
  throw "Notes must be a non-empty string."
}

if ([string]::IsNullOrWhiteSpace($PublishedAt)) {
  $PublishedAt = (Get-Date).ToUniversalTime().ToString(
    "yyyy-MM-ddTHH:mm:ssZ",
    [System.Globalization.CultureInfo]::InvariantCulture)
}
if ($PublishedAt -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$') {
  throw "PublishedAt must be UTC ISO 8601 like 2026-11-20T12:00:00Z, got '$PublishedAt'."
}

# versionCode / versionName / notes are read by the app; the rest is for humans.
$manifest = [ordered]@{
  versionCode = $VersionCode
  versionName = $VersionName
  notes       = $trimmedNotes
  publishedAt = $PublishedAt
}
if (-not [string]::IsNullOrWhiteSpace($ApkFile)) {
  $manifest["apk"] = $ApkFile.Trim().Replace("\", "/")
}

# Normalise to LF and end with exactly one newline so the deployed file is stable
# regardless of which PowerShell version generated it.
$json = (($manifest | ConvertTo-Json -Depth 4) -replace "`r`n", "`n").TrimEnd() + "`n"

$fullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $fullOutputPath
if ($outputDir -and -not (Test-Path -LiteralPath $outputDir)) {
  $null = New-Item -ItemType Directory -Force -Path $outputDir
}

# UTF-8 without BOM: a BOM makes JSON.parse fail in the app's WebView.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($fullOutputPath, $json, $utf8NoBom)

Write-Output ("Wrote " + $fullOutputPath + " (versionCode=" + $VersionCode + ", versionName=" + $VersionName + ")")
