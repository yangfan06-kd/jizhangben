$repoRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path (Split-Path -Parent $repoRoot) "android-tools"
$sdkRoot = Join-Path $toolsRoot "sdk"
$jdkRoot = Join-Path $toolsRoot "jdk21"
$jdk = Get-ChildItem -LiteralPath $jdkRoot -Directory -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $jdk) {
  throw "找不到 G:\project\android-tools\jdk21 下的 JDK 目录"
}
if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot "platforms\android-36\android.jar"))) {
  throw "找不到 Android API 36 SDK：$sdkRoot"
}

$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_USER_HOME = Join-Path $toolsRoot "android-user-home"
$env:GRADLE_USER_HOME = Join-Path $toolsRoot "gradle-home"
$null = New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME, $env:GRADLE_USER_HOME
$env:Path = "$env:JAVA_HOME\bin;$sdkRoot\platform-tools;$sdkRoot\cmdline-tools\latest\bin;$env:Path"

$javaVersion = (Get-Content -LiteralPath (Join-Path $env:JAVA_HOME "release") | Select-String "^JAVA_VERSION=" | Select-Object -First 1).Line
Write-Output ("Android environment ready: " + $javaVersion)
Write-Output ("SDK: " + $env:ANDROID_HOME)
Write-Output ("Android user cache: " + $env:ANDROID_USER_HOME)
Write-Output ("Gradle cache: " + $env:GRADLE_USER_HOME)
