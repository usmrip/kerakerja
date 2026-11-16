@echo off
setlocal
echo ==============================================================================
echo  Tele-vs-CLI Windows Uninstaller
echo ==============================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Pencopotan gagal. Silakan periksa log di atas.
    pause
    exit /b %errorlevel%
)

echo.
echo Pencopotan selesai dengan sukses!
pause
endlocal
