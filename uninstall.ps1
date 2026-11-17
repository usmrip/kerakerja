# KeraKerja Uninstaller for Windows (PowerShell)
# Usage:
#   Local:  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 [-Yes] [-Purge] [-DryRun]
#   Remote: irm https://raw.githubusercontent.com/usmrip/tele-vs-cli/main/uninstall.ps1 | iex

param(
    [switch]$Purge,
    [switch]$Yes,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$BaseDir = Join-Path $env:LOCALAPPDATA "kerakerja"
$InstallDir = Join-Path $BaseDir "app"
$BinDir = Join-Path $BaseDir "bin"

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host " KeraKerja Uninstaller (Windows)" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan

$localScriptDir = $PSScriptRoot
if ($localScriptDir -and (Test-Path (Join-Path $localScriptDir "scripts\uninstall.js"))) {
    $TargetDir = $localScriptDir
    Write-Host "[OK] Menggunakan direktori lokal : $TargetDir" -ForegroundColor Green
} else {
    $TargetDir = $InstallDir
    Write-Host "[OK] Direktori target instalasi  : $TargetDir" -ForegroundColor Green
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeUninstaller = Join-Path $TargetDir "scripts\uninstall.js"

if ($nodeCmd -and (Test-Path $nodeUninstaller)) {
    $nodeArgs = @($nodeUninstaller)
    if ($Yes -or (-not $localScriptDir)) { $nodeArgs += "--yes" }
    if ($Purge) { $nodeArgs += "--purge" }
    if ($DryRun) { $nodeArgs += "--dry-run" }

    Push-Location $env:TEMP
    try {
        & node @nodeArgs
    } finally {
        Pop-Location
    }
    Exit $LASTEXITCODE
}

Write-Host "[WARN] Node.js atau scripts/uninstall.js tidak ditemukan, menjalankan pembersihan fallback..." -ForegroundColor Yellow

if ($DryRun) {
    Write-Host "[dry-run] Akan menghapus Task Scheduler KeraKerjaWorker, '$BinDir', dan '$InstallDir'." -ForegroundColor Yellow
    Exit 0
}

foreach ($svc in @("KeraKerjaWorker", "TeleVsCliWorker")) {
    try {
        schtasks /query /tn $svc 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            schtasks /delete /tn $svc /f | Out-Null
            Write-Host "[OK] Windows Task Scheduler '$svc' dihapus." -ForegroundColor Green
        }
    } catch {}
}

foreach ($d in @($BinDir, (Join-Path $env:LOCALAPPDATA "tele-vs-cli\bin"))) {
    if (Test-Path $d) {
        Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
        Write-Host "[OK] Direktori launcher dihapus: $d" -ForegroundColor Green
    }
}

$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath) {
    $normKerakerja = $BinDir.TrimEnd('\', '/').ToLowerInvariant()
    $normLegacy = (Join-Path $env:LOCALAPPDATA "tele-vs-cli\bin").TrimEnd('\', '/').ToLowerInvariant()
    $parts = $currentPath -split ';' | Where-Object {
        $v = $_.Trim().TrimEnd('\', '/').ToLowerInvariant()
        $_ -and ($v -ne $normKerakerja) -and ($v -ne $normLegacy)
    }
    $newPath = $parts -join ';'
    if ($newPath -ne $currentPath) {
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Host "[OK] Entri PATH dihapus." -ForegroundColor Green
    }
}

foreach ($appD in @($InstallDir, (Join-Path $env:LOCALAPPDATA "tele-vs-cli\app"))) {
    if (Test-Path $appD) {
        Push-Location $env:TEMP
        try {
            Remove-Item -Recurse -Force $appD -ErrorAction SilentlyContinue
            Write-Host "[OK] Direktori instalasi dihapus: $appD" -ForegroundColor Green
        } finally {
            Pop-Location
        }
    }
}

foreach ($b in @($BaseDir, (Join-Path $env:LOCALAPPDATA "tele-vs-cli"))) {
    if (Test-Path $b) {
        $remaining = Get-ChildItem $b -Force -ErrorAction SilentlyContinue
        if ($Purge -or (-not $remaining)) {
            Remove-Item -Recurse -Force $b -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "[OK] KeraKerja Berhasil Dicopot!" -ForegroundColor Green
Write-Host "==============================================================================" -ForegroundColor Cyan
