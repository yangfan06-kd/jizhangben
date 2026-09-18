$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$previousOfflineMode = $env:JIZHANGBEN_OFFLINE_MODE
try {
  $env:JIZHANGBEN_OFFLINE_MODE = "1"
  & (Join-Path $PSScriptRoot "build-debug.ps1")
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
