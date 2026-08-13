Set-StrictMode -Version Latest

$script:PartyPasteBuildNotice = "Unsigned local self-use build.`nOnline updates are deferred.`n"

if ($null -eq ('PartyPastePackaging.NativePath' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace PartyPastePackaging {
    public static class NativePath {
        private const uint OpenExisting = 3;
        private const uint BackupSemantics = 0x02000000;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(
            string fileName,
            uint desiredAccess,
            FileShare shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandleW(
            SafeFileHandle file,
            StringBuilder path,
            uint pathLength,
            uint flags);

        public static string Resolve(string path) {
            using (SafeFileHandle handle = CreateFileW(
                path,
                0,
                FileShare.Read | FileShare.Write | FileShare.Delete,
                IntPtr.Zero,
                OpenExisting,
                BackupSemantics,
                IntPtr.Zero)) {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                var buffer = new StringBuilder(512);
                uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
                if (length == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (length >= buffer.Capacity) {
                    buffer = new StringBuilder((int)length + 1);
                    length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
                    if (length == 0 || length >= buffer.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
                }
                string resolved = buffer.ToString();
                if (resolved.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
                    return @"\\" + resolved.Substring(8);
                if (resolved.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase))
                    return resolved.Substring(4);
                return resolved;
            }
        }
    }
}
'@
}

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
    if ($versions.Count -ne 1 -or $versions[0] -cnotmatch '^\d+\.\d+\.\d+$') {
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
    if ($Version -cnotmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') {
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
    if ($identityFields.Count -eq 0 -or @($identityFields | Where-Object { -not $_.Equals('PartyPaste', [StringComparison]::Ordinal) }).Count -gt 0) {
        throw "$Label does not identify PartyPaste in its Windows version metadata."
    }
    $expectedNormalized = ConvertTo-PartyPasteWindowsVersion -Version $ExpectedVersion
    foreach ($field in @('ProductVersion', 'FileVersion')) {
        $actual = [string]$info.$field
        if (-not (ConvertTo-PartyPasteWindowsVersion -Version $actual).Equals($expectedNormalized, [StringComparison]::Ordinal)) {
            throw "$Label $field is $actual; expected $ExpectedVersion."
        }
    }
}

function Resolve-PartyPasteFinalPath {
    param([Parameter(Mandatory)] [string]$Path)
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $fullPath)) { throw "Path does not exist: $fullPath" }
    [PartyPastePackaging.NativePath]::Resolve($fullPath).TrimEnd('\', '/')
}

function Resolve-PartyPasteFinalPathFromExistingAncestor {
    param([Parameter(Mandatory)] [string]$Path)
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $remaining = [System.Collections.Generic.Stack[string]]::new()
    $cursor = $fullPath
    while (-not (Test-Path -LiteralPath $cursor)) {
        $leaf = [System.IO.Path]::GetFileName($cursor.TrimEnd('\', '/'))
        if ([string]::IsNullOrEmpty($leaf)) { throw "No existing ancestor for path: $fullPath" }
        $remaining.Push($leaf)
        $parent = [System.IO.Path]::GetDirectoryName($cursor.TrimEnd('\', '/'))
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $cursor) { throw "No existing ancestor for path: $fullPath" }
        $cursor = $parent
    }
    $resolved = Resolve-PartyPasteFinalPath -Path $cursor
    while ($remaining.Count -gt 0) { $resolved = Join-Path $resolved $remaining.Pop() }
    [System.IO.Path]::GetFullPath($resolved).TrimEnd('\', '/')
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
