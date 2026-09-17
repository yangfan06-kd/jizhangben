$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. (Join-Path $PSScriptRoot "android-env.ps1")

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "android\gradlew.bat"))) {
  throw "找不到 Android 原生工程，请先执行 npx cap add android"
}

npm run app:sync-capacitor
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Push-Location (Join-Path $repoRoot "android")
try {
  & .\gradlew.bat assembleDebug --no-daemon
  $buildExit = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($buildExit -ne 0) {
  exit $buildExit
}

$apk = Join-Path $repoRoot "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path -LiteralPath $apk)) {
  throw "Gradle 完成但没有找到 APK：$apk"
}

$file = Get-Item -LiteralPath $apk
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $stream = [System.IO.File]::OpenRead($apk)
  try {
    $hash = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
  } finally {
    $stream.Dispose()
  }
} finally {
  $sha256.Dispose()
}
Write-Output ("Debug APK: " + $file.FullName)
Write-Output ("Size: " + $file.Length + " bytes")
Write-Output ("SHA-256: " + $hash)
