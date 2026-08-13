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
    $currentDriveRoot = [System.IO.Path]::GetPathRoot($applicationPath)
    if (-not (Normalize-PartyPasteRootedPath -Path $currentDriveRoot).Equals($currentDriveRoot, [StringComparison]::Ordinal)) {
        throw 'Drive-root normalization removed the root separator.'
    }
    if (-not (Test-PathWithinDirectory -Path (Join-Path $currentDriveRoot 'child') -Directory $currentDriveRoot)) {
        throw 'Drive-root containment did not recognize a child path.'
    }
    $uncRoot = '\\server\share\'
    if (-not (Normalize-PartyPasteRootedPath -Path $uncRoot).Equals($uncRoot, [StringComparison]::Ordinal)) {
        throw 'UNC-share-root normalization removed the share root separator.'
    }
    if (-not (Test-PathWithinDirectory -Path '\\server\share\child' -Directory $uncRoot)) {
        throw 'UNC-share-root containment did not recognize a child path.'
    }
    $extendedDriveRoot = "\\?\$currentDriveRoot"
    if (-not (Normalize-PartyPasteRootedPath -Path $extendedDriveRoot).Equals($extendedDriveRoot, [StringComparison]::Ordinal)) {
        throw 'Extended drive-root normalization removed the root separator.'
    }
    $volumeRoots = @(
        '\\?\Volume{00000000-0000-0000-0000-000000000000}\',
        '\\?\volume{00000000-0000-0000-0000-000000000000}\',
        '\\?\VoLuMe{00000000-0000-0000-0000-000000000000}\'
    )
    foreach ($volumeRoot in $volumeRoots) {
        if (-not (Normalize-PartyPasteRootedPath -Path $volumeRoot).Equals($volumeRoot, [StringComparison]::Ordinal)) {
            throw "Volume-GUID-root normalization removed the root separator: $volumeRoot"
        }
        if (-not (Test-PathWithinDirectory -Path ($volumeRoot + 'child') -Directory $volumeRoot)) {
            throw "Volume-GUID-root containment did not recognize a child path: $volumeRoot"
        }
    }

    Test-PartyPastePeIdentity -Path $applicationPath -ExpectedMachine 0x8664 -ExpectedSubsystem 2 -ExpectedVersion $contract.Version -Label 'Portable application fixture'
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

    $driveRootSourceHash = (Get-FileHash -LiteralPath $applicationPath -Algorithm SHA256).Hash
    Assert-Throws -Name 'drive-root output contains application input' -Action {
        & $packageScript -ApplicationExecutable $applicationPath -NsisInstaller $installerPath -OutputDirectory $currentDriveRoot
    }
    if (-not (Test-Path -LiteralPath $applicationPath -PathType Leaf) -or
        (Get-FileHash -LiteralPath $applicationPath -Algorithm SHA256).Hash -cne $driveRootSourceHash) {
        throw 'Drive-root guard did not reject before cleanup or preserve the source byte-for-byte.'
    }

    $junctionTarget = Join-Path $testRoot 'junction-target'
    [System.IO.Directory]::CreateDirectory($junctionTarget) | Out-Null
    $junctionSource = Join-Path $junctionTarget $contract.InstallerName
    Copy-Item -LiteralPath $applicationPath -Destination $junctionSource
    $junctionSourceHash = (Get-FileHash -LiteralPath $junctionSource -Algorithm SHA256).Hash
    $junctionOutput = Join-Path $testRoot 'junction-output'
    New-Item -ItemType Junction -Path $junctionOutput -Target $junctionTarget | Out-Null
    Assert-Throws -Name 'junction input/output alias' -Action {
        & $packageScript -ApplicationExecutable $junctionSource -NsisInstaller $installerPath -OutputDirectory $junctionOutput
    }
    if (-not (Test-Path -LiteralPath $junctionSource -PathType Leaf) -or
        (Get-FileHash -LiteralPath $junctionSource -Algorithm SHA256).Hash -cne $junctionSourceHash) {
        throw 'Junction alias guard did not preserve the source byte-for-byte.'
    }

    $symlinkTarget = Join-Path $testRoot 'symlink-target'
    [System.IO.Directory]::CreateDirectory($symlinkTarget) | Out-Null
    $symlinkSource = Join-Path $symlinkTarget $contract.InstallerName
    Copy-Item -LiteralPath $applicationPath -Destination $symlinkSource
    $symlinkSourceHash = (Get-FileHash -LiteralPath $symlinkSource -Algorithm SHA256).Hash
    $symlinkOutput = Join-Path $testRoot 'symlink-output'
    try {
        New-Item -ItemType SymbolicLink -Path $symlinkOutput -Target $symlinkTarget -ErrorAction Stop | Out-Null
        Assert-Throws -Name 'symlink input/output alias' -Action {
            & $packageScript -ApplicationExecutable $symlinkSource -NsisInstaller $installerPath -OutputDirectory $symlinkOutput
        }
        if (-not (Test-Path -LiteralPath $symlinkSource -PathType Leaf) -or
            (Get-FileHash -LiteralPath $symlinkSource -Algorithm SHA256).Hash -cne $symlinkSourceHash) {
            throw 'Symlink alias guard did not preserve the source byte-for-byte.'
        }
    }
    catch [System.UnauthorizedAccessException] {
        Write-Output 'SKIP: directory symlink creation denied by Windows privileges.'
    }

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

    $lowercaseSet = Copy-ArtifactSet -Name 'lowercase-filename'
    $portableOriginal = Join-Path $lowercaseSet $contract.PortableName
    $portableIntermediate = Join-Path $lowercaseSet 'portable-case-intermediate.zip'
    $portableLowercase = Join-Path $lowercaseSet $contract.PortableName.ToLowerInvariant()
    Move-Item -LiteralPath $portableOriginal -Destination $portableIntermediate
    Move-Item -LiteralPath $portableIntermediate -Destination $portableLowercase
    Assert-Throws -Name 'hashing lowercase filename variant' -Action { & $hashScript -OutputDirectory $lowercaseSet }
    Assert-Throws -Name 'verifying lowercase filename variant' -Action { & $verifyScript -OutputDirectory $lowercaseSet }

    $uppercaseSet = Copy-ArtifactSet -Name 'uppercase-extension'
    $installerOriginal = Join-Path $uppercaseSet $contract.InstallerName
    $installerIntermediate = Join-Path $uppercaseSet 'installer-case-intermediate.exe'
    $installerUppercase = Join-Path $uppercaseSet ($contract.InstallerName.Substring(0, $contract.InstallerName.Length - 4) + '.EXE')
    Move-Item -LiteralPath $installerOriginal -Destination $installerIntermediate
    Move-Item -LiteralPath $installerIntermediate -Destination $installerUppercase
    Assert-Throws -Name 'hashing uppercase extension variant' -Action { & $hashScript -OutputDirectory $uppercaseSet }
    Assert-Throws -Name 'verifying uppercase extension variant' -Action { & $verifyScript -OutputDirectory $uppercaseSet }

    $uppercaseHashSet = Copy-ArtifactSet -Name 'uppercase-manifest-hash'
    $uppercaseHashManifest = Join-Path $uppercaseHashSet $contract.ManifestName
    $uppercaseHashText = [System.IO.File]::ReadAllText($uppercaseHashManifest, [Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($uppercaseHashManifest, $uppercaseHashText.Substring(0, 64).ToUpperInvariant() + $uppercaseHashText.Substring(64), [Text.UTF8Encoding]::new($false))
    Assert-Throws -Name 'uppercase manifest hash' -Action { & $verifyScript -OutputDirectory $uppercaseHashSet }

    $uppercaseNameSet = Copy-ArtifactSet -Name 'uppercase-manifest-name'
    $uppercaseNameManifest = Join-Path $uppercaseNameSet $contract.ManifestName
    $uppercaseNameText = [System.IO.File]::ReadAllText($uppercaseNameManifest, [Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($uppercaseNameManifest, $uppercaseNameText.Replace('PartyPaste_', 'PARTYPASTE_'), [Text.UTF8Encoding]::new($false))
    Assert-Throws -Name 'uppercase manifest artifact name' -Action { & $verifyScript -OutputDirectory $uppercaseNameSet }

    Write-Output 'Packaging negative tests passed: roots, identity, machine, version, signature, notices, direct/reparse aliases, Cargo metadata, manifest, casing, and exact artifact set.'
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
