[CmdletBinding()]
param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot 'outputs\windows-self-use'
}
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $outputPath -PathType Container)) {
    throw "Artifact directory is missing: $outputPath"
}

$artifacts = @(
    Get-ChildItem -LiteralPath $outputPath -File |
        Where-Object { $_.Name -match '^PartyPaste_.+_windows-x64-(setup|portable)-unsigned-local\.(exe|zip)$' } |
        Sort-Object -Property Name
)
if ($artifacts.Count -ne 2) {
    throw "Expected exactly one unsigned local installer and one portable ZIP; found $($artifacts.Count)."
}

$lines = foreach ($artifact in $artifacts) {
    $hash = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($artifact.Name)"
}
$manifestPath = Join-Path $outputPath 'SHA256SUMS.txt'
[System.IO.File]::WriteAllText(
    $manifestPath,
    (($lines -join "`n") + "`n"),
    [System.Text.UTF8Encoding]::new($false)
)
Write-Output $manifestPath
