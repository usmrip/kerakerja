@echo off
setlocal
echo ==============================================================================
echo  Tele-vs-CLI Windows Installer
echo ==============================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js belum terpasang di sistem!
    echo Silakan unduh dan pasang Node.js LTS dari https://nodejs.org/
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Pemasangan gagal. Silakan periksa log di atas.
    pause
    exit /b %errorlevel%
)

echo.
echo Pemasangan selesai dengan sukses!
pause
endlocal
set "_TELE_BIN=%LOCALAPPDATA%\tele-vs-cli\bin"
echo "%PATH%" | findstr /i /c:"%_TELE_BIN%" >nul
if %errorlevel% neq 0 (
    set "PATH=%PATH%;%_TELE_BIN%"
)
set "_TELE_BIN="
