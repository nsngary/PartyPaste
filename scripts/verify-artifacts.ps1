[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [scriptblock]$SignatureStatusProvider = { param($Path) (Get-AuthenticodeSignature -LiteralPath $Path).Status.ToString() }
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'packaging-common.ps1')
$contract = Get-PartyPastePackageContract -RepoRoot $repoRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot 'outputs\windows-self-use'
}
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$version = $contract.Version

$expectedNames = @(
    $contract.PortableName,
    $contract.InstallerName,
    $contract.ManifestName
) | Sort-Object
$actualNames = @(Get-ChildItem -LiteralPath $outputPath -File | Sort-Object Name | ForEach-Object Name)
if (-not ($actualNames -join "`n").Equals(($expectedNames -join "`n"), [StringComparison]::Ordinal)) {
    throw "Artifacts are missing or mislabeled. Expected: $($expectedNames -join ', '). Actual: $($actualNames -join ', ')."
}

$installerPath = Join-Path $outputPath $contract.InstallerName
# Tauri's NSIS launcher is an x86 PE (0x014C) that installs the x64 PartyPaste payload.
Test-PartyPastePeIdentity -Path $installerPath -ExpectedMachine 0x014C -ExpectedSubsystem 2 -ExpectedVersion $version -Label 'NSIS installer'
if ((& $SignatureStatusProvider $installerPath) -cne 'NotSigned') {
    throw 'Installer is not an unsigned local build.'
}

$manifestPath = Join-Path $outputPath $contract.ManifestName
$manifestText = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8)
$manifestParts = @($manifestText.Split("`n"))
if ($manifestText.Contains("`r") -or $manifestParts.Count -ne 3 -or $manifestParts[2] -ne '' -or
    $manifestParts[0] -cnotmatch '^[0-9a-f]{64}  [^\r\n]+$' -or
    $manifestParts[1] -cnotmatch '^[0-9a-f]{64}  [^\r\n]+$') {
    throw 'SHA256SUMS.txt must contain exactly two nonempty LF-terminated artifact lines.'
}
$manifestLines = @($manifestParts[0], $manifestParts[1])
$manifestArtifactNames = @()
foreach ($line in $manifestLines) {
    if ($line -cnotmatch '^([0-9a-f]{64})  (PartyPaste_.+_windows-x64-(?:setup|portable)-unsigned-local\.(?:exe|zip))$') {
        throw "Malformed SHA-256 manifest entry: $line"
    }
    $expectedHash = $Matches[1]
    $artifactName = $Matches[2]
    $manifestArtifactNames += $artifactName
    $artifactPath = Join-Path $outputPath $artifactName
    $actualHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not $actualHash.Equals($expectedHash, [StringComparison]::Ordinal)) {
        throw "SHA-256 mismatch for $artifactName."
    }
}
$expectedHashedNames = @(
    $contract.PortableName,
    $contract.InstallerName
) | Sort-Object
$sortedManifestArtifactNames = @($manifestArtifactNames | Sort-Object)
if (-not ($sortedManifestArtifactNames -join "`n").Equals(($expectedHashedNames -join "`n"), [StringComparison]::Ordinal)) {
    throw 'SHA256SUMS.txt does not cover each expected artifact exactly once.'
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$portablePath = Join-Path $outputPath $contract.PortableName
$archive = [System.IO.Compression.ZipFile]::OpenRead($portablePath)
$portableTempPath = Join-Path ([System.IO.Path]::GetTempPath()) ("partypaste-verify-{0}.exe" -f [Guid]::NewGuid().ToString('N'))
try {
    $entryNames = @($archive.Entries | ForEach-Object FullName | Sort-Object)
    $expectedEntries = @('BUILD-NOTICE.txt', 'data/', 'partypaste.portable', 'PartyPaste.exe', 'THIRD_PARTY_NOTICES.md') | Sort-Object
    if (-not ($entryNames -join "`n").Equals(($expectedEntries -join "`n"), [StringComparison]::Ordinal)) {
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
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($portableExe, $portableTempPath, $true)
    Test-PartyPastePeIdentity -Path $portableTempPath -ExpectedMachine 0x8664 -ExpectedSubsystem 2 -ExpectedVersion $version -Label 'Portable application'
    if ((& $SignatureStatusProvider $portableTempPath) -cne 'NotSigned') {
        throw 'Portable application is not an unsigned local build.'
    }
    $noticeStream = $notices.Open()
    try {
        $noticeMemory = [System.IO.MemoryStream]::new()
        $noticeStream.CopyTo($noticeMemory)
        $noticeBytes = $noticeMemory.ToArray()
    } finally {
        if ($null -ne $noticeMemory) { $noticeMemory.Dispose() }
        $noticeStream.Dispose()
    }
    $sourceNoticeBytes = [System.IO.File]::ReadAllBytes((Join-Path $repoRoot 'THIRD_PARTY_NOTICES.md'))
    if (-not [System.Linq.Enumerable]::SequenceEqual([byte[]]$noticeBytes, [byte[]]$sourceNoticeBytes)) {
        throw 'Portable third-party notices do not exactly match the repository source.'
    }
    $buildNoticeStream = $buildNotice.Open()
    try {
        $buildNoticeMemory = [System.IO.MemoryStream]::new()
        $buildNoticeStream.CopyTo($buildNoticeMemory)
        $buildNoticeBytes = $buildNoticeMemory.ToArray()
    } finally {
        if ($null -ne $buildNoticeMemory) { $buildNoticeMemory.Dispose() }
        $buildNoticeStream.Dispose()
    }
    $expectedBuildNoticeBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($contract.BuildNotice)
    if (-not [System.Linq.Enumerable]::SequenceEqual([byte[]]$buildNoticeBytes, [byte[]]$expectedBuildNoticeBytes)) {
        throw 'Portable build labeling is malformed.'
    }
}
finally {
    $archive.Dispose()
    if (Test-Path -LiteralPath $portableTempPath) { Remove-Item -LiteralPath $portableTempPath -Force }
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
