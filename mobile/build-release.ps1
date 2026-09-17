$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. (Join-Path $PSScriptRoot "android-env.ps1")

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "android\gradlew.bat"))) {
  throw "Android project not found. Run npx cap add android first."
}

& npm run app:validate:release
if ($LASTEXITCODE -ne 0) {
  throw "Release API URL preflight failed; release build stopped."
}

& npm run app:sync-capacitor
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Push-Location (Join-Path $repoRoot "android")
try {
  & .\gradlew.bat assembleRelease --no-daemon
  $buildExit = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($buildExit -ne 0) {
  exit $buildExit
}

$releaseDir = Join-Path $repoRoot "android\app\build\outputs\apk\release"
$apk = Get-ChildItem -LiteralPath $releaseDir -Filter "*.apk" -File | Select-Object -First 1
if (-not $apk) {
  throw "Gradle finished but no release APK was found: $releaseDir"
}

$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $stream = [System.IO.File]::OpenRead($apk.FullName)
  try {
    $hash = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
  } finally {
    $stream.Dispose()
  }
} finally {
  $sha256.Dispose()
}
Write-Output ("Release APK: " + $apk.FullName)
Write-Output ("Size: " + $apk.Length + " bytes")
Write-Output ("SHA-256: " + $hash)
Write-Output "Note: no signing key is configured. The artifact is normally app-release-unsigned.apk for build validation only; configure signing and generate an AAB before distribution."
