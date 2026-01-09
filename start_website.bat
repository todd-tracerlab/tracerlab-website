@echo off
REM TracerLab Website Local Server
REM This script starts a local web server for the TracerLab website

echo Starting TracerLab website locally...
echo.

REM Check if we're in the right directory
if not exist "website\index.html" (
    echo Error: website\index.html not found!
    echo Please run this script from the TracerLab project root directory.
    echo Current directory: %CD%
    pause
    exit /b 1
)

REM Serve from root directory so images with ../ paths work correctly
echo Serving from root directory to fix image paths...

echo Serving website from: %CD%
echo Website files in: %CD%\website
echo.
echo The website will be available at:
echo   http://localhost:8080
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start the Python HTTP server from root directory
python -m http.server 8080

if errorlevel 1 (
    echo.
    echo Error starting Python server. Make sure Python is installed and in your PATH.
    echo You can also try opening index.html directly in your browser.
    pause
)
