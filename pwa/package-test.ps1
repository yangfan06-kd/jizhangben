# 只压缩允许发布的 site；审阅信息、服务器模板和真实备份不进入 ZIP。
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $taskRoot
try {
    $resultText = & node pwa/prepare-test-package.cjs
    if ($LASTEXITCODE -ne 0) { throw '测试部署副本准备失败，未生成压缩包。' }
    $result = ($resultText -join "`n") | ConvertFrom-Json
    $packageDir = [IO.Path]::GetFullPath($result.output)
    $expectedParent = [IO.Path]::GetFullPath((Join-Path $taskRoot 'output/pwa-test-packages')) + [IO.Path]::DirectorySeparatorChar
    if (-not $packageDir.StartsWith($expectedParent, [StringComparison]::OrdinalIgnoreCase)) { throw '部署包路径超出指定目录。' }
    $site = Join-Path $packageDir 'site'
    $receipt = Get-Content -LiteralPath (Join-Path $packageDir 'review.json') -Raw | ConvertFrom-Json
    $archive = Join-Path $packageDir 'site.zip'
    $temporary = Join-Path $packageDir ('site-' + [Guid]::NewGuid().ToString('N') + '.zip')
    function Test-Archive([string]$file) {
        $zip = [IO.Compression.ZipFile]::OpenRead($file)
        try {
            if ($zip.Entries.Count -ne $receipt.files.Count) { throw '压缩包文件数量不符。' }
            $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            foreach ($entry in $zip.Entries) {
                if (-not $seen.Add($entry.FullName)) { throw '压缩包存在重复文件。' }
                $match = @($receipt.files | Where-Object { $_.file -ceq $entry.FullName })
                if ($match.Count -ne 1) { throw ('压缩包含有未允许文件：' + $entry.FullName) }
                $stream = $entry.Open()
                $algorithm = [Security.Cryptography.SHA256]::Create()
                try { $hash = [Convert]::ToHexString($algorithm.ComputeHash($stream)).ToLowerInvariant() }
                finally { $stream.Dispose(); $algorithm.Dispose() }
                if ($hash -cne $match[0].sha256 -or $entry.Length -ne $match[0].size) { throw ('压缩包资源摘要不符：' + $entry.FullName) }
            }
        } finally { $zip.Dispose() }
    }
    try {
        if (Test-Path -LiteralPath $archive) { Test-Archive $archive }
        else {
            [IO.Compression.ZipFile]::CreateFromDirectory($site, $temporary)
            Test-Archive $temporary
            Move-Item -LiteralPath $temporary -Destination $archive
        }
    } finally {
        # temporary 为已检查 packageDir 内本次生成的 GUID 文件；无递归删除。
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
    $zipHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath (Join-Path $packageDir 'site.zip.sha256') -Value ($zipHash + '  site.zip') -Encoding utf8NoBOM
    [pscustomobject]@{ archive = $archive; files = $receipt.files.Count; sha256 = $zipHash; deployed = $false } | ConvertTo-Json
} finally { Pop-Location }
