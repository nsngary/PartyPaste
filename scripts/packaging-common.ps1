Set-StrictMode -Version Latest

$script:PartyPasteBuildNotice = "Unsigned local self-use build.`nOnline updates are deferred.`n"

function Get-PartyPastePackageContract {
    param([Parameter(Mandatory)] [string]$RepoRoot)

    $package = Get-Content -LiteralPath (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json
    $tauri = Get-Content -LiteralPath (Join-Path $RepoRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
    $cargoText = Get-Content -LiteralPath (Join-Path $RepoRoot 'src-tauri\Cargo.toml') -Raw
    $packageSection = [regex]::Match($cargoText, '(?ms)^\[package\]\s*\r?\n(?<body>.*?)(?=^\[|\z)')
    if (-not $packageSection.Success) { throw 'Cargo [package] metadata is malformed.' }
    $cargoVersion = [regex]::Match($packageSection.Groups['body'].Value, '(?m)^version\s*=\s*"(?<version>[^"]+)"\s*$')
    if (-not $cargoVersion.Success) { throw 'Cargo [package] version metadata is malformed.' }

    $versions = @(
        @([string]$package.version, [string]$tauri.version, $cargoVersion.Groups['version'].Value) |
            Select-Object -Unique
    )
    if ($versions.Count -ne 1 -or $versions[0] -notmatch '^\d+\.\d+\.\d+$') {
        throw "Package version metadata is malformed or inconsistent: $($versions -join ', ')"
    }
    $version = $versions[0]
    [pscustomobject]@{
        Version = $version
        InstallerName = "PartyPaste_${version}_windows-x64-setup-unsigned-local.exe"
        PortableName = "PartyPaste_${version}_windows-x64-portable-unsigned-local.zip"
        ManifestName = 'SHA256SUMS.txt'
        BuildNotice = $script:PartyPasteBuildNotice
    }
}

function ConvertTo-PartyPasteWindowsVersion {
    param([Parameter(Mandatory)] [string]$Version)
    if ($Version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') {
        throw "Windows file version is malformed: $Version"
    }
    $parsed = [Version]$Version
    $revision = if ($parsed.Revision -lt 0) { 0 } else { $parsed.Revision }
    "$($parsed.Major).$($parsed.Minor).$($parsed.Build).$revision"
}

function Get-PeMachine {
    param([Parameter(Mandatory)] [string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    $reader = [System.IO.BinaryReader]::new($stream)
    try {
        if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5A4D) { throw "Not a PE file: $Path" }
        $stream.Position = 0x3C
        $peOffset = $reader.ReadInt32()
        if ($peOffset -lt 0 -or $peOffset + 6 -gt $stream.Length) { throw "Malformed PE header: $Path" }
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw "Missing PE signature: $Path" }
        $reader.ReadUInt16()
    }
    finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

function Test-PartyPastePeIdentity {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [UInt16]$ExpectedMachine,
        [Parameter(Mandatory)] [string]$ExpectedVersion,
        [Parameter(Mandatory)] [string]$Label
    )
    $machine = Get-PeMachine -Path $Path
    if ($machine -ne $ExpectedMachine) {
        throw ('{0} PE machine is 0x{1:X4}; expected 0x{2:X4}.' -f $Label, $machine, $ExpectedMachine)
    }

    $info = (Get-Item -LiteralPath $Path).VersionInfo
    $identityFields = @($info.ProductName, $info.FileDescription, $info.InternalName) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    if ($identityFields.Count -eq 0 -or @($identityFields | Where-Object { $_ -ne 'PartyPaste' }).Count -gt 0) {
        throw "$Label does not identify PartyPaste in its Windows version metadata."
    }
    $expectedNormalized = ConvertTo-PartyPasteWindowsVersion -Version $ExpectedVersion
    foreach ($field in @('ProductVersion', 'FileVersion')) {
        $actual = [string]$info.$field
        if ((ConvertTo-PartyPasteWindowsVersion -Version $actual) -ne $expectedNormalized) {
            throw "$Label $field is $actual; expected $ExpectedVersion."
        }
    }
}

function Test-PathWithinDirectory {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Directory
    )
    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $fullDirectory = [System.IO.Path]::GetFullPath($Directory).TrimEnd('\', '/')
    $fullPath.Equals($fullDirectory, [StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($fullDirectory + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}
