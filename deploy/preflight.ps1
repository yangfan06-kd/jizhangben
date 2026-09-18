[CmdletBinding()]
param(
    [string]$EnvFile = (Join-Path $PSScriptRoot ".env"),
    [switch]$SkipDns
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot "docker-compose.yml"
$caddyFile = Join-Path $PSScriptRoot "Caddyfile.example"

$resolvedEnvFile = [System.IO.Path]::GetFullPath($EnvFile)
if (-not (Test-Path -LiteralPath $resolvedEnvFile -PathType Leaf)) {
    throw "Production env file not found: $resolvedEnvFile"
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $resolvedEnvFile) {
    $trimmed = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {
        continue
    }
    $parts = $trimmed -split "=", 2
    if ($parts.Count -ne 2) {
        throw "Invalid env line: $trimmed"
    }
    $key = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    $values[$key] = $value
}

function Get-RequiredValue([string]$Name) {
    if (-not $values.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace($values[$Name])) {
        throw "Missing required production setting: $Name"
    }
    return $values[$Name]
}

$domain = Get-RequiredValue "JIZHANGBEN_DOMAIN"
$cors = Get-RequiredValue "JIZHANGBEN_CORS_ORIGINS"
$sameSite = Get-RequiredValue "JIZHANGBEN_SESSION_SAMESITE"
$secure = Get-RequiredValue "JIZHANGBEN_SESSION_SECURE"
$fallback = Get-RequiredValue "JIZHANGBEN_ALLOW_DEV_FALLBACK"
$bind = Get-RequiredValue "JIZHANGBEN_BIND"
$port = Get-RequiredValue "JIZHANGBEN_PORT"

if ($domain -match "[/:\s]" -or $domain -match "example\.com$" -or $domain -match "\.example$") {
    throw "JIZHANGBEN_DOMAIN must be a real hostname without scheme or path"
}
if ([uri]::CheckHostName($domain) -ne [System.UriHostNameType]::Dns) {
    throw "JIZHANGBEN_DOMAIN is not a DNS hostname: $domain"
}
if (-not (($cors -split ",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -eq "http://localhost" })) {
    throw "JIZHANGBEN_CORS_ORIGINS must allow the Capacitor http://localhost origin"
}
if ($cors -split "," | Where-Object { $_.Trim() -eq "*" }) {
    throw "JIZHANGBEN_CORS_ORIGINS must not use a wildcard"
}
if ($sameSite.ToLowerInvariant() -ne "none" -or $secure -ne "1") {
    throw "Production sessions require JIZHANGBEN_SESSION_SAMESITE=none and JIZHANGBEN_SESSION_SECURE=1"
}
if ($fallback -ne "0") {
    throw "JIZHANGBEN_ALLOW_DEV_FALLBACK must be 0 in production"
}
if ($bind -ne "127.0.0.1") {
    throw "JIZHANGBEN_BIND must be 127.0.0.1 when Caddy is the public entrypoint"
}
if ($port -notmatch "^[0-9]+$") {
    throw "JIZHANGBEN_PORT must be numeric: $port"
}

Push-Location $repoRoot
try {
    & docker compose --env-file $resolvedEnvFile -f $composeFile config --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose production configuration is invalid"
    }

    $previousApiUrl = $env:JIZHANGBEN_API_BASE_URL
    try {
        $env:JIZHANGBEN_API_BASE_URL = "https://$domain/api"
        & node (Join-Path $repoRoot "mobile\validate-api-url.cjs")
        if ($LASTEXITCODE -ne 0) {
            throw "Production API URL validation failed"
        }
    } finally {
        $env:JIZHANGBEN_API_BASE_URL = $previousApiUrl
    }

    if (Get-Command caddy -ErrorAction SilentlyContinue) {
        $previousDomain = $env:JIZHANGBEN_DOMAIN
        try {
            $env:JIZHANGBEN_DOMAIN = $domain
            & caddy validate --config $caddyFile
            if ($LASTEXITCODE -ne 0) {
                throw "Caddy configuration validation failed"
            }
        } finally {
            $env:JIZHANGBEN_DOMAIN = $previousDomain
        }
        Write-Output "caddy_check=passed"
    } else {
        Write-Output "caddy_check=skipped (caddy is not installed on this machine)"
    }

    if ($SkipDns) {
        Write-Output "dns_check=skipped"
    } else {
        Resolve-DnsName -Name $domain -Type A -ErrorAction Stop | Out-Null
        Write-Output "dns_check=passed"
    }
    Write-Output "compose_check=passed"
    Write-Output "api_url_check=passed"
    Write-Output "production_preflight=passed"
} finally {
    Pop-Location
}
