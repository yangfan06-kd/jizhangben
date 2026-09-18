[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,
    [string]$Image = "jizhangben-app"
)

$ErrorActionPreference = "Stop"
$resolvedBackupPath = [System.IO.Path]::GetFullPath($BackupPath)
if (-not (Test-Path -LiteralPath $resolvedBackupPath -PathType Leaf)) {
    throw "Backup file not found: $resolvedBackupPath"
}

$backupDirectory = Split-Path -Parent $resolvedBackupPath
$backupFileName = Split-Path -Leaf $resolvedBackupPath
$tag = Get-Date -Format "yyyyMMddHHmmss"
$tempVolume = "jizhangben-restore-check-$tag"
$helperName = ".restore-helper-$tag.py"
$helperPath = Join-Path $backupDirectory $helperName

$helperCode = @'
import json
import shutil
import sqlite3
import sys

source = "/backup/" + sys.argv[1]
database = "/data/jizhangben.db"
shutil.copy2(source, database)
connection = sqlite3.connect(database)
result = {
    "integrity": connection.execute("PRAGMA integrity_check").fetchone()[0],
    "schema": connection.execute("SELECT max(version) FROM schema_migrations").fetchone()[0],
    "users": connection.execute("SELECT count(*) FROM users").fetchone()[0],
    "books": connection.execute("SELECT count(*) FROM books").fetchone()[0],
    "records": connection.execute("SELECT count(*) FROM records").fetchone()[0],
}
connection.close()
if result["integrity"] != "ok":
    raise SystemExit("restore integrity check failed: " + str(result["integrity"]))
print(json.dumps(result, ensure_ascii=False, sort_keys=True))
'@

Set-Content -LiteralPath $helperPath -Value $helperCode -Encoding utf8
try {
    docker volume create $tempVolume | Out-Null
    & docker run --rm --user 0 `
        -v "${tempVolume}:/data" `
        -v "${backupDirectory}:/backup:ro" `
        $Image python "/backup/$helperName" $backupFileName

    if ($LASTEXITCODE -ne 0) {
        throw "Restore verification failed"
    }
    Write-Output "restore_verification=passed"
} finally {
    docker volume rm $tempVolume 2>$null | Out-Null
    if (Test-Path -LiteralPath $helperPath) {
        Remove-Item -LiteralPath $helperPath -Force
    }
}
