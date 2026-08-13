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
$packageScript = Join-Path $PSScriptRoot 'package-portable.ps1'
$hashScript = Join-Path $PSScriptRoot 'hashes.ps1'
$verifyScript = Join-Path $PSScriptRoot 'verify-artifacts.ps1'
$applicationPath = Join-Path $repoRoot 'src-tauri\target\release\partypaste.exe'
$installerPath = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis\PartyPaste_$($contract.Version)_x64-setup.exe"
$testRoot = Join-Path $repoRoot ("work\task13-packaging-tests-{0}" -f [Guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($testRoot) | Out-Null

function Assert-Throws {
    param([Parameter(Mandatory)] [scriptblock]$Action, [Parameter(Mandatory)] [string]$Name)
    try { & $Action; throw "Expected failure was not raised: $Name" }
    catch {
        if ($_.Exception.Message -eq "Expected failure was not raised: $Name") { throw }
    }
}

function Copy-ArtifactSet {
    param([Parameter(Mandatory)] [string]$Name)
    $destination = Join-Path $testRoot $Name
    Copy-Item -LiteralPath $outputPath -Destination $destination -Recurse
    $destination
}

function Set-ZipEntryBytes {
    param(
        [Parameter(Mandatory)] [string]$ZipPath,
        [Parameter(Mandatory)] [string]$EntryName,
        [Parameter(Mandatory)] [byte[]]$Bytes
    )
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $existing = $archive.GetEntry($EntryName)
        if ($null -eq $existing) { throw "Missing ZIP entry fixture: $EntryName" }
        $existing.Delete()
        $replacement = $archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $stream = $replacement.Open()
        try { $stream.Write($Bytes, 0, $Bytes.Length) } finally { $stream.Dispose() }
    }
    finally { $archive.Dispose() }
}

try {
    Test-PartyPastePeIdentity -Path $applicationPath -ExpectedMachine 0x8664 -ExpectedVersion $contract.Version -Label 'Portable application fixture'
    Test-PartyPastePeIdentity -Path $installerPath -ExpectedMachine 0x014C -ExpectedVersion $contract.Version -Label 'NSIS installer fixture'
    if ((ConvertTo-PartyPasteWindowsVersion '0.1.0') -ne '0.1.0.0') { throw 'Three-part Windows version normalization failed.' }

    $unrelatedPe = Join-Path $testRoot 'PartyPaste.exe'
    Copy-Item -LiteralPath (Join-Path $env:WINDIR 'System32\notepad.exe') -Destination $unrelatedPe
    Assert-Throws -Name 'renamed unrelated PE identity' -Action {
        Test-PartyPastePeIdentity -Path $unrelatedPe -ExpectedMachine 0x8664 -ExpectedVersion $contract.Version -Label 'Unrelated fixture'
    }
    Assert-Throws -Name 'wrong PE machine' -Action {
        Test-PartyPastePeIdentity -Path $installerPath -ExpectedMachine 0x8664 -ExpectedVersion $contract.Version -Label 'Wrong-machine fixture'
    }
    Assert-Throws -Name 'wrong PE version' -Action {
        Test-PartyPastePeIdentity -Path $applicationPath -ExpectedMachine 0x8664 -ExpectedVersion '9.9.9' -Label 'Wrong-version fixture'
    }

    $metadataRoot = Join-Path $testRoot 'cargo-section-fixture'
    [System.IO.Directory]::CreateDirectory((Join-Path $metadataRoot 'src-tauri')) | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $metadataRoot 'package.json'), '{"version":"0.1.0"}')
    [System.IO.File]::WriteAllText((Join-Path $metadataRoot 'src-tauri\tauri.conf.json'), '{"version":"0.1.0"}')
    [System.IO.File]::WriteAllText((Join-Path $metadataRoot 'src-tauri\Cargo.toml'), "[package]`nname = `"fixture`"`n`n[dependencies]`nversion = `"0.1.0`"`n")
    Assert-Throws -Name 'dependency version cannot substitute for package version' -Action {
        Get-PartyPastePackageContract -RepoRoot $metadataRoot | Out-Null
    }

    $applicationAlias = Join-Path $testRoot 'application-alias'
    [System.IO.Directory]::CreateDirectory($applicationAlias) | Out-Null
    $aliasedApplication = Join-Path $applicationAlias 'PartyPaste_9.9.9_windows-x64-setup-unsigned-local.exe'
    Copy-Item -LiteralPath $applicationPath -Destination $aliasedApplication
    Assert-Throws -Name 'application input/output alias' -Action {
        & $packageScript -ApplicationExecutable $aliasedApplication -NsisInstaller $installerPath -OutputDirectory $applicationAlias
    }
    if (-not (Test-Path -LiteralPath $aliasedApplication -PathType Leaf)) { throw 'Aliased application input was deleted.' }

    $installerAlias = Join-Path $testRoot 'installer-alias'
    [System.IO.Directory]::CreateDirectory($installerAlias) | Out-Null
    $aliasedInstaller = Join-Path $installerAlias $contract.InstallerName
    Copy-Item -LiteralPath $installerPath -Destination $aliasedInstaller
    Assert-Throws -Name 'installer input/output alias' -Action {
        & $packageScript -ApplicationExecutable $applicationPath -NsisInstaller $aliasedInstaller -OutputDirectory $installerAlias
    }
    if (-not (Test-Path -LiteralPath $aliasedInstaller -PathType Leaf)) { throw 'Aliased installer input was deleted.' }

    Assert-Throws -Name 'signed portable application' -Action {
        & $verifyScript -OutputDirectory $outputPath -SignatureStatusProvider {
            param($Path)
            if ($Path -like '*partypaste-verify-*') { 'Valid' } else { 'NotSigned' }
        }
    }
    Assert-Throws -Name 'signed installer' -Action {
        & $verifyScript -OutputDirectory $outputPath -SignatureStatusProvider {
            param($Path)
            if ($Path -like '*setup-unsigned-local.exe') { 'Valid' } else { 'NotSigned' }
        }
    }

    $noticeSet = Copy-ArtifactSet -Name 'wrong-notices'
    Set-ZipEntryBytes -ZipPath (Join-Path $noticeSet $contract.PortableName) -EntryName 'THIRD_PARTY_NOTICES.md' -Bytes ([Text.Encoding]::UTF8.GetBytes('wrong notices'))
    & $hashScript -OutputDirectory $noticeSet | Out-Null
    Assert-Throws -Name 'wrong third-party notices' -Action { & $verifyScript -OutputDirectory $noticeSet }

    $buildNoticeSet = Copy-ArtifactSet -Name 'wrong-build-notice'
    Set-ZipEntryBytes -ZipPath (Join-Path $buildNoticeSet $contract.PortableName) -EntryName 'BUILD-NOTICE.txt' -Bytes ([Text.Encoding]::UTF8.GetBytes("Unsigned local self-use build.`nOnline updates are deferred."))
    & $hashScript -OutputDirectory $buildNoticeSet | Out-Null
    Assert-Throws -Name 'wrong build notice bytes' -Action { & $verifyScript -OutputDirectory $buildNoticeSet }

    $manifestSet = Copy-ArtifactSet -Name 'blank-manifest-line'
    [System.IO.File]::AppendAllText((Join-Path $manifestSet $contract.ManifestName), "`n", [Text.UTF8Encoding]::new($false))
    Assert-Throws -Name 'blank manifest line' -Action { & $verifyScript -OutputDirectory $manifestSet }

    $extraArtifactSet = Copy-ArtifactSet -Name 'extra-artifact'
    [System.IO.File]::WriteAllBytes((Join-Path $extraArtifactSet 'PartyPaste_9.9.9_windows-x64-portable-unsigned-local.zip'), [byte[]](1, 2, 3))
    Assert-Throws -Name 'hashing extra artifact' -Action { & $hashScript -OutputDirectory $extraArtifactSet }

    Write-Output 'Packaging negative tests passed: identity, machine, version, signature, notices, aliases, Cargo metadata, manifest, and exact artifact set.'
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
        $resolvedWorkRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'work'))
        if (-not (Test-PathWithinDirectory -Path $resolvedTestRoot -Directory $resolvedWorkRoot)) {
            throw "Refusing to clean test path outside work: $resolvedTestRoot"
        }
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
