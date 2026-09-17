$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. (Join-Path $PSScriptRoot "android-env.ps1")

$adb = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
$apk = Join-Path $repoRoot "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path -LiteralPath $apk)) {
  throw "Debug APK not found. Run npm run app:build:debug first."
}

$deviceLines = @(& $adb devices | Select-String "^\S+\s+device$")
if ($deviceLines.Count -eq 0) {
  throw "No authorized Android device found. Enable USB debugging, connect the phone, and accept the computer authorization prompt."
}
if ($deviceLines.Count -gt 1) {
  throw "Multiple Android devices found. Keep one device connected and retry."
}

$reverseOutput = @(& $adb reverse tcp:8000 tcp:8000 2>&1)
if ($LASTEXITCODE -ne 0) {
  throw ("Unable to create USB forwarding for port 8000: " + ($reverseOutput -join " "))
}

& $adb install -r $apk
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
Write-Output ("Installed: " + $apk)
