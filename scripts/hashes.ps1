[CmdletBinding()]
param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'packaging-common.ps1')
$contract = Get-PartyPastePackageContract -RepoRoot $repoRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot 'outputs\windows-self-use'
}
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $outputPath -PathType Container)) {
    throw "Artifact directory is missing: $outputPath"
}

$expectedNames = @($contract.InstallerName, $contract.PortableName) | Sort-Object
$actualNames = @(Get-ChildItem -LiteralPath $outputPath -File | Where-Object { $_.Name -ne $contract.ManifestName } | Sort-Object Name | ForEach-Object Name)
if (($actualNames -join "`n") -ne ($expectedNames -join "`n")) {
    throw "Expected exactly the current x64 installer and portable ZIP. Actual: $($actualNames -join ', ')."
}

$lines = foreach ($name in $expectedNames) {
    $artifact = Get-Item -LiteralPath (Join-Path $outputPath $name)
    $hash = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($artifact.Name)"
}
$manifestPath = Join-Path $outputPath $contract.ManifestName
[System.IO.File]::WriteAllText(
    $manifestPath,
    (($lines -join "`n") + "`n"),
    [System.Text.UTF8Encoding]::new($false)
)
Write-Output $manifestPath
