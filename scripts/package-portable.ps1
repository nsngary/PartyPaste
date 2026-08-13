[CmdletBinding()]
param(
    [string]$SourceExe,
    [string]$NsisInstaller,
    [string]$OutputDirectory,
    [string]$Version
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$tauriConfigPath = Join-Path $repoRoot 'src-tauri\tauri.conf.json'
$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = [string]$tauriConfig.version
}
if ($Version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
    throw "Invalid package version: $Version"
}

if ([string]::IsNullOrWhiteSpace($SourceExe)) {
    $SourceExe = Join-Path $repoRoot 'src-tauri\target\release\partypaste.exe'
}
if ([string]::IsNullOrWhiteSpace($NsisInstaller)) {
    $NsisInstaller = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis\PartyPaste_${Version}_x64-setup.exe"
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot 'outputs\windows-self-use'
}

$sourceExePath = [System.IO.Path]::GetFullPath($SourceExe)
$nsisInstallerPath = [System.IO.Path]::GetFullPath($NsisInstaller)
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$noticesPath = Join-Path $repoRoot 'THIRD_PARTY_NOTICES.md'

foreach ($required in @($sourceExePath, $nsisInstallerPath, $noticesPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required packaging input is missing: $required"
    }
}

[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
$portableName = "PartyPaste_${Version}_windows-x64-portable-unsigned-local.zip"
$installerName = "PartyPaste_${Version}_windows-x64-setup-unsigned-local.exe"
$portablePath = Join-Path $outputPath $portableName
$installerPath = Join-Path $outputPath $installerName

Get-ChildItem -LiteralPath $outputPath -File | Where-Object {
    $_.Name -match '^PartyPaste_.+_windows-x64-(setup|portable)-unsigned-local\.(exe|zip)$' -or
    $_.Name -eq 'SHA256SUMS.txt'
} | Remove-Item -Force

foreach ($target in @($portablePath, $installerPath)) {
    if (Test-Path -LiteralPath $target) { throw "Could not clear stale artifact: $target" }
}

Copy-Item -LiteralPath $nsisInstallerPath -Destination $installerPath

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open(
    $portablePath,
    [System.IO.Compression.ZipArchiveMode]::Create
)
$fixedTimestamp = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)

function Add-ZipBytes {
    param(
        [Parameter(Mandatory)] [System.IO.Compression.ZipArchive]$Archive,
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [byte[]]$Bytes
    )
    $entry = $Archive.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $fixedTimestamp
    $stream = $entry.Open()
    try {
        $stream.Write($Bytes, 0, $Bytes.Length)
    }
    finally {
        $stream.Dispose()
    }
}

try {
    Add-ZipBytes -Archive $archive -Name 'PartyPaste.exe' -Bytes ([System.IO.File]::ReadAllBytes($sourceExePath))
    Add-ZipBytes -Archive $archive -Name 'partypaste.portable' -Bytes ([byte[]]::new(0))
    Add-ZipBytes -Archive $archive -Name 'THIRD_PARTY_NOTICES.md' -Bytes ([System.IO.File]::ReadAllBytes($noticesPath))
    Add-ZipBytes -Archive $archive -Name 'BUILD-NOTICE.txt' -Bytes ([System.Text.UTF8Encoding]::new($false).GetBytes("Unsigned local self-use build.`nOnline updates are deferred.`n"))
    $dataEntry = $archive.CreateEntry('data/', [System.IO.Compression.CompressionLevel]::NoCompression)
    $dataEntry.LastWriteTime = $fixedTimestamp
}
finally {
    $archive.Dispose()
}

Write-Output $installerPath
Write-Output $portablePath
