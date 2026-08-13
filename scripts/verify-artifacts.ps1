[CmdletBinding()]
param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot 'outputs\windows-self-use'
}
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$tauri = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$cargoText = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\Cargo.toml') -Raw
$cargoVersionMatch = [regex]::Match($cargoText, '(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"')
if (-not $cargoVersionMatch.Success) {
    throw 'Cargo package version metadata is malformed.'
}
$versions = @(
    @([string]$package.version, [string]$tauri.version, $cargoVersionMatch.Groups[1].Value) |
        Select-Object -Unique
)
if ($versions.Count -ne 1 -or $versions[0] -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
    throw "Package version metadata is malformed or inconsistent: $($versions -join ', ')"
}
$version = $versions[0]

$expectedNames = @(
    "PartyPaste_${version}_windows-x64-portable-unsigned-local.zip",
    "PartyPaste_${version}_windows-x64-setup-unsigned-local.exe",
    'SHA256SUMS.txt'
) | Sort-Object
$actualNames = @(Get-ChildItem -LiteralPath $outputPath -File | Sort-Object Name | ForEach-Object Name)
if (($actualNames -join "`n") -ne ($expectedNames -join "`n")) {
    throw "Artifacts are missing or mislabeled. Expected: $($expectedNames -join ', '). Actual: $($actualNames -join ', ')."
}

$installerPath = Join-Path $outputPath "PartyPaste_${version}_windows-x64-setup-unsigned-local.exe"
$installerHeader = [System.IO.File]::ReadAllBytes($installerPath)
if ($installerHeader.Length -lt 2 -or $installerHeader[0] -ne 0x4d -or $installerHeader[1] -ne 0x5a) {
    throw 'Installer is not a valid Windows executable.'
}
$installerSignature = Get-AuthenticodeSignature -LiteralPath $installerPath
if ($installerSignature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
    throw "Installer is not an unsigned local build: $($installerSignature.Status)."
}

$manifestPath = Join-Path $outputPath 'SHA256SUMS.txt'
$manifestLines = @(Get-Content -LiteralPath $manifestPath | Where-Object { $_ -ne '' })
if ($manifestLines.Count -ne 2) {
    throw 'SHA256SUMS.txt must contain exactly two artifact hashes.'
}
$manifestArtifactNames = @()
foreach ($line in $manifestLines) {
    if ($line -notmatch '^([0-9a-f]{64})  (PartyPaste_.+_windows-x64-(?:setup|portable)-unsigned-local\.(?:exe|zip))$') {
        throw "Malformed SHA-256 manifest entry: $line"
    }
    $expectedHash = $Matches[1]
    $artifactName = $Matches[2]
    $manifestArtifactNames += $artifactName
    $artifactPath = Join-Path $outputPath $artifactName
    $actualHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "SHA-256 mismatch for $artifactName."
    }
}
$expectedHashedNames = @(
    "PartyPaste_${version}_windows-x64-portable-unsigned-local.zip",
    "PartyPaste_${version}_windows-x64-setup-unsigned-local.exe"
) | Sort-Object
$sortedManifestArtifactNames = @($manifestArtifactNames | Sort-Object)
if (($sortedManifestArtifactNames -join "`n") -ne ($expectedHashedNames -join "`n")) {
    throw 'SHA256SUMS.txt does not cover each expected artifact exactly once.'
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$portablePath = Join-Path $outputPath "PartyPaste_${version}_windows-x64-portable-unsigned-local.zip"
$archive = [System.IO.Compression.ZipFile]::OpenRead($portablePath)
try {
    $entryNames = @($archive.Entries | ForEach-Object FullName | Sort-Object)
    $expectedEntries = @('BUILD-NOTICE.txt', 'data/', 'partypaste.portable', 'PartyPaste.exe', 'THIRD_PARTY_NOTICES.md') | Sort-Object
    if (($entryNames -join "`n") -ne ($expectedEntries -join "`n")) {
        throw "Portable ZIP contents are missing or unexpected: $($entryNames -join ', ')"
    }
    $marker = $archive.GetEntry('partypaste.portable')
    $dataDirectory = $archive.GetEntry('data/')
    $notices = $archive.GetEntry('THIRD_PARTY_NOTICES.md')
    $buildNotice = $archive.GetEntry('BUILD-NOTICE.txt')
    if ($null -eq $marker -or $marker.Length -ne 0 -or $null -eq $dataDirectory -or $dataDirectory.Length -ne 0) {
        throw 'Portable marker or empty data directory is malformed.'
    }
    if ($null -eq $notices -or $notices.Length -eq 0 -or $null -eq $buildNotice -or $buildNotice.Length -eq 0) {
        throw 'Portable notices are missing or empty.'
    }
    $portableExe = $archive.GetEntry('PartyPaste.exe')
    $portableStream = $portableExe.Open()
    try {
        $portableHeader = [byte[]]::new(2)
        $read = $portableStream.Read($portableHeader, 0, 2)
    }
    finally {
        $portableStream.Dispose()
    }
    if ($read -ne 2 -or $portableHeader[0] -ne 0x4d -or $portableHeader[1] -ne 0x5a) {
        throw 'Portable executable is not a valid Windows executable.'
    }
    $reader = [System.IO.StreamReader]::new($buildNotice.Open(), [System.Text.Encoding]::UTF8, $true)
    try { $noticeText = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($noticeText -notmatch 'Unsigned local self-use build' -or $noticeText -notmatch 'updates are deferred') {
        throw 'Portable build labeling is malformed.'
    }
}
finally {
    $archive.Dispose()
}

$trackedFiles = @(git -C $repoRoot ls-files)
if ($LASTEXITCODE -ne 0) {
    throw 'Could not inspect tracked files for committed secrets.'
}
$forbiddenTracked = @($trackedFiles | Where-Object {
    $_ -match '(^|/)(work/release-secrets|outputs|artifacts|data)(/|$)' -or
    $_ -match '(?i)\.(key|p12|pfx|pem)$' -or
    $_ -match '(?i)(partypaste\.db(?:-.+)?|\.log)$'
})
if ($forbiddenTracked.Count -gt 0) {
    throw "Committed secret or user artifact detected: $($forbiddenTracked -join ', ')"
}

$unexpectedReleaseMetadata = @(Get-ChildItem -LiteralPath $outputPath -File | Where-Object {
    $_.Extension -eq '.sig' -or $_.Name -eq 'latest.json' -or $_.Name -match '(?i)updater'
})
if ($unexpectedReleaseMetadata.Count -gt 0) {
    throw 'Updater signatures or metadata must not be present in a deferred self-use build.'
}

Write-Output "Verified unsigned local PartyPaste $version installer and portable ZIP."
