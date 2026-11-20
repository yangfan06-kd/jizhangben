$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. (Join-Path $PSScriptRoot "android-env.ps1")

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "android\gradlew.bat"))) {
  throw "Android project not found. Run npx cap add android first."
}

$keystoreProps = Join-Path $repoRoot "android\keystore.properties"
if (-not (Test-Path -LiteralPath $keystoreProps)) {
  throw "android\keystore.properties is missing. Configure the release signing key first."
}

$previousOfflineMode = $env:JIZHANGBEN_OFFLINE_MODE
try {
  # Offline build has no backend, so skip the release API URL preflight.
  $env:JIZHANGBEN_OFFLINE_MODE = "1"

  # Use "cap copy" instead of "cap sync": "cap copy" only refreshes web assets and
  # leaves the native plugin folders alone. "cap sync" also runs the plugin update
  # step, which deletes and rewrites capacitor-cordova-android-plugins; that is
  # unnecessary here because the plugin set has not changed.
  & npm run app:sync
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  & npx cap copy android
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  if ($null -eq $previousOfflineMode) {
    Remove-Item Env:JIZHANGBEN_OFFLINE_MODE -ErrorAction SilentlyContinue
  } else {
    $env:JIZHANGBEN_OFFLINE_MODE = $previousOfflineMode
  }
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
$apk = Get-ChildItem -LiteralPath $releaseDir -Filter "*.apk" -File |
  Where-Object { $_.Name -notlike "*unsigned*" } |
  Select-Object -First 1
if (-not $apk) {
  throw "Gradle finished but no signed release APK was found in $releaseDir"
}

$gradleFile = Join-Path $repoRoot "android\app\build.gradle"
$gradleText = Get-Content -LiteralPath $gradleFile -Raw
$versionName = [regex]::Match($gradleText, 'versionName\s+"([^"]+)"').Groups[1].Value
$releasesDir = Join-Path $repoRoot "releases"
$null = New-Item -ItemType Directory -Force -Path $releasesDir
$target = Join-Path $releasesDir ("jizhangben-offline-v" + $versionName + "-release.apk")
Copy-Item -LiteralPath $apk.FullName -Destination $target -Force

$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $stream = [System.IO.File]::OpenRead($target)
  try {
    $hash = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
  } finally {
    $stream.Dispose()
  }
} finally {
  $sha256.Dispose()
}

$file = Get-Item -LiteralPath $target
Write-Output ("Signed offline APK: " + $file.FullName)
Write-Output ("Version: " + $versionName)
Write-Output ("Size: " + $file.Length + " bytes (" + [math]::Round($file.Length / 1MB, 2) + " MB)")
Write-Output ("SHA-256: " + $hash)
