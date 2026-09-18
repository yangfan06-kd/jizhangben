[CmdletBinding()]
param(
    [string]$VolumeName = "jizhangben_jizhangben-data",
    [string]$OutputDirectory,
    [string]$Image = "jizhangben-app"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) "backups"
}

$resolvedOutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$null = New-Item -ItemType Directory -Path $resolvedOutputDirectory -Force
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fileName = "jizhangben-$timestamp.db"
$backupPath = Join-Path $resolvedOutputDirectory $fileName

& docker volume inspect $VolumeName *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker volume not found: $VolumeName"
}

$backupCode = @'
import hashlib
import sqlite3
import sys

destination = "/backup/" + sys.argv[1]
source = sqlite3.connect("file:/data/jizhangben.db?mode=ro", uri=True)
target = sqlite3.connect(destination)
source.backup(target)
integrity = target.execute("PRAGMA integrity_check").fetchone()[0]
schema = target.execute("SELECT max(version) FROM schema_migrations").fetchone()[0]
target.close()
source.close()
if integrity != "ok":
    raise SystemExit("backup integrity check failed: " + str(integrity))
with open(destination, "rb") as stream:
    digest = hashlib.sha256(stream.read()).hexdigest().upper()
print("schema=" + str(schema))
print("sha256=" + digest)
'@

$helperPath = Join-Path $resolvedOutputDirectory "backup-helper.py"
Set-Content -LiteralPath $helperPath -Value $backupCode -Encoding utf8
try {
    & docker run --rm --user 0 `
        -v "${VolumeName}:/data:ro" `
        -v "${resolvedOutputDirectory}:/backup" `
        $Image python /backup/backup-helper.py $fileName

    if ($LASTEXITCODE -ne 0) {
        if (Test-Path -LiteralPath $backupPath) {
            Remove-Item -LiteralPath $backupPath -Force
        }
        throw "Docker volume backup failed"
    }
} finally {
    if (Test-Path -LiteralPath $helperPath) {
        Remove-Item -LiteralPath $helperPath -Force
    }
}

$backupSize = (Get-Item -LiteralPath $backupPath).Length
Write-Output ("backup_file=" + $backupPath)
Write-Output ("backup_bytes=" + $backupSize)
