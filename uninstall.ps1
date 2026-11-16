# ==============================================================================
# Tele-vs-CLI Uninstaller for Windows (PowerShell)
# Usage:
#   Local:  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 [-Yes] [-Purge] [-DryRun]
#   Remote: irm https://raw.githubusercontent.com/usmrip/tele-vs-cli/main/uninstall.ps1 | iex
# ==============================================================================

param(
    [switch]$Purge,
    [switch]$Yes,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$BaseDir = Join-Path $env:LOCALAPPDATA "tele-vs-cli"
$InstallDir = Join-Path $BaseDir "app"
$BinDir = Join-Path $BaseDir "bin"

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "🧹 Tele-vs-CLI Uninstaller (Windows)" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan

# 1. Tentukan Direktori Target
$localScriptDir = $PSScriptRoot
if ($localScriptDir -and (Test-Path (Join-Path $localScriptDir "scripts\uninstall.js"))) {
    $TargetDir = $localScriptDir
    Write-Host "📌 Menggunakan direktori lokal : $TargetDir" -ForegroundColor Green
} else {
    $TargetDir = $InstallDir
    Write-Host "📌 Direktori target instalasi  : $TargetDir" -ForegroundColor Green
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeUninstaller = Join-Path $TargetDir "scripts\uninstall.js"

if ($nodeCmd -and (Test-Path $nodeUninstaller)) {
    $nodeArgs = @($nodeUninstaller)
    if ($Yes -or (-not $localScriptDir)) { $nodeArgs += "--yes" }
    if ($Purge) { $nodeArgs += "--purge" }
    if ($DryRun) { $nodeArgs += "--dry-run" }

    # Pindah ke TEMP agar direktori instalasi tidak terkunci saat dihapus
    Push-Location $env:TEMP
    try {
        & node @nodeArgs
    } finally {
        Pop-Location
    }
    Exit $LASTEXITCODE
}

# Fallback jika Node.js atau scripts/uninstall.js tidak tersedia
Write-Host "⚠️ Node.js atau scripts/uninstall.js tidak ditemukan, menjalankan pembersihan fallback..." -ForegroundColor Yellow

if ($DryRun) {
    Write-Host "[dry-run] Akan menghapus Task Scheduler TeleVsCliWorker, '$BinDir', dan '$InstallDir'." -ForegroundColor Yellow
    Exit 0
}

try {
    schtasks /query /tn "TeleVsCliWorker" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        schtasks /delete /tn "TeleVsCliWorker" /f | Out-Null
        Write-Host "✅ Windows Task Scheduler 'TeleVsCliWorker' dihapus." -ForegroundColor Green
    }
} catch {}

if (Test-Path $BinDir) {
    Remove-Item -Recurse -Force $BinDir -ErrorAction SilentlyContinue
    Write-Host "✅ Direktori launcher dihapus: $BinDir" -ForegroundColor Green
}

$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath) {
    $normBin = $BinDir.TrimEnd('\', '/').ToLowerInvariant()
    $parts = $currentPath -split ';' | Where-Object { $_ -and ($_.Trim().TrimEnd('\', '/').ToLowerInvariant() -ne $normBin) }
    $newPath = $parts -join ';'
    if ($newPath -ne $currentPath) {
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Host "✅ '$BinDir' dihapus dari User PATH." -ForegroundColor Green
    }
}

if (Test-Path $InstallDir) {
    Push-Location $env:TEMP
    try {
        Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
        Write-Host "✅ Direktori instalasi dihapus: $InstallDir" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

if (Test-Path $BaseDir) {
    $remaining = Get-ChildItem $BaseDir -Force -ErrorAction SilentlyContinue
    if ($Purge -or (-not $remaining)) {
        Remove-Item -Recurse -Force $BaseDir -ErrorAction SilentlyContinue
    }
}

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "✅ Tele-vs-CLI Berhasil Dicopot!" -ForegroundColor Green
Write-Host "==============================================================================" -ForegroundColor Cyan
