# ==============================================================================
# Tele-vs-CLI Installer for Windows (PowerShell)
# Usage:
#   Local:  powershell -ExecutionPolicy Bypass -File .\install.ps1
#   Remote: irm https://raw.githubusercontent.com/usmrip/tele-vs-cli/main/install.ps1 | iex
# ==============================================================================

$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/usmrip/tele-vs-cli.git"
$InstallDir = Join-Path $env:LOCALAPPDATA "tele-vs-cli\app"

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "🚀 Tele-vs-CLI Installer (Windows)" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan

# 1. Periksa Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue

if (-not $nodeCmd) {
    Write-Host "⚠️ Node.js belum terdeteksi di sistem!" -ForegroundColor Yellow
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        Write-Host "💡 Mencoba menginstal Node.js LTS via winget..." -ForegroundColor Yellow
        winget install OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    }

    if (-not $nodeCmd) {
        Write-Host "❌ Silakan pasang Node.js LTS (>= 18.0.0) dari https://nodejs.org/" -ForegroundColor Red
        Exit 1
    }
}

$nodeVerStr = (node -v).Trim().TrimStart('v')
$majorVer = [int]($nodeVerStr.Split('.')[0])
Write-Host "📌 Versi Node.js terdeteksi : v$nodeVerStr" -ForegroundColor Green

if ($majorVer -lt 18) {
    Write-Host "❌ Versi Node.js (v$nodeVerStr) terlalu lama! Diperlukan minimal Node.js v18.0.0." -ForegroundColor Red
    Exit 1
}

# 2. Tentukan Direktori (Lokal atau Clone Git)
$localScriptDir = $PSScriptRoot
if ($localScriptDir -and (Test-Path (Join-Path $localScriptDir "bin\tele.js"))) {
    $TargetDir = $localScriptDir
    Write-Host "📌 Menggunakan direktori lokal : $TargetDir" -ForegroundColor Green
} else {
    $TargetDir = $InstallDir
    Write-Host "📌 Direktori target pemasangan : $TargetDir" -ForegroundColor Green
    if (Test-Path (Join-Path $TargetDir ".git")) {
        Write-Host "Memperbarui repositori yang sudah ada..." -ForegroundColor Yellow
        Push-Location $TargetDir
        try { git pull origin main } catch {}
        Pop-Location
    } else {
        Write-Host "Mengunduh Tele-vs-CLI dari GitHub..." -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
        git clone $RepoUrl $TargetDir
    }
}

# 3. Jalankan Universal Node Installer
Push-Location $TargetDir
try {
    node scripts/install.js
} finally {
    Pop-Location
}
