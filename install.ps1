$ErrorActionPreference = "Stop"

# KeraKerja Installer for Windows (PowerShell)
# Usage:
#   Local:  powershell -ExecutionPolicy Bypass -File .\install.ps1
#   Remote: irm https://raw.githubusercontent.com/usmrip/kerakerja/main/install.ps1 | iex

$RepoUrl = "https://github.com/usmrip/kerakerja.git"
$InstallDir = Join-Path $env:LOCALAPPDATA "kerakerja\app"

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host " KeraKerja Installer (Windows)" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan

# 1. Periksa Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue

if (-not $nodeCmd) {
    Write-Host "[WARN] Node.js belum terdeteksi di sistem!" -ForegroundColor Yellow
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        Write-Host "[INFO] Mencoba menginstal Node.js LTS via winget..." -ForegroundColor Yellow
        winget install OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    }

    if (-not $nodeCmd) {
        Write-Host "[ERROR] Silakan pasang Node.js LTS (>= 18.0.0) dari https://nodejs.org/" -ForegroundColor Red
        Exit 1
    }
}

$nodeVerStr = (node -v).Trim().TrimStart('v')
$majorVer = [int]($nodeVerStr.Split('.')[0])
Write-Host "[OK] Versi Node.js terdeteksi : v$nodeVerStr" -ForegroundColor Green

if ($majorVer -lt 18) {
    Write-Host "[ERROR] Versi Node.js (v$nodeVerStr) terlalu lama! Diperlukan minimal Node.js v18.0.0." -ForegroundColor Red
    Exit 1
}

# 2. Tentukan Direktori (Lokal atau Clone Git)
$localScriptDir = $PSScriptRoot
if ($localScriptDir -and (Test-Path (Join-Path $localScriptDir "bin\kerakerja.js"))) {
    $TargetDir = $localScriptDir
    Write-Host "[OK] Menggunakan direktori lokal : $TargetDir" -ForegroundColor Green
} else {
    $TargetDir = $InstallDir
    Write-Host "[OK] Direktori target pemasangan : $TargetDir" -ForegroundColor Green
    if (Test-Path (Join-Path $TargetDir ".git")) {
        Write-Host "Memperbarui repositori yang sudah ada..." -ForegroundColor Yellow
        Push-Location $TargetDir
        try { git pull origin main } catch {}
        Pop-Location
    } else {
        Write-Host "Mengunduh KeraKerja dari GitHub..." -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
        git clone $RepoUrl $TargetDir
    }
}

# 3. Jalankan Universal Node Installer
Push-Location $TargetDir
try {
    node scripts/install.js
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Pemasangan CLI gagal (exit code $LASTEXITCODE)." -ForegroundColor Red
        Exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

# 4. Pastikan PATH di sesi PowerShell saat ini langsung aktif (tanpa perlu buka terminal baru)
$BinDir = Join-Path $env:LOCALAPPDATA "kerakerja\bin"
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if (-not $userPath) { $userPath = "" }
$userEntries = $userPath.Split(';') | Where-Object { $_.Trim() -ne "" }
if ($userEntries -notcontains $BinDir) {
    $newUserPath = (@($userEntries) + $BinDir) -join ';'
    [System.Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    $userPath = $newUserPath
}
$machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$env:Path = (@($machinePath, $userPath) | Where-Object { $_ -and $_.Trim() -ne "" }) -join ';'
Write-Host "[INFO] Perintah 'kerakerja' sekarang aktif di sesi ini. Coba ketik: kerakerja --help" -ForegroundColor Cyan
