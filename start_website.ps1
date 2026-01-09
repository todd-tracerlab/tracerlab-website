# TracerLab Website Local Server
# This script starts a local web server for the TracerLab website

Write-Host "Starting TracerLab website locally..." -ForegroundColor Green
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "website\index.html")) {
    Write-Host "Error: website\index.html not found!" -ForegroundColor Red
    Write-Host "Please run this script from the TracerLab project root directory." -ForegroundColor Yellow
    Write-Host "Current directory: $(Get-Location)" -ForegroundColor Gray
    Read-Host "Press Enter to exit"
    exit 1
}

# Serve from root directory so images with ../ paths work correctly
Write-Host "Serving from root directory to fix image paths..." -ForegroundColor Cyan

Write-Host "Serving website from: $(Get-Location)" -ForegroundColor Cyan
Write-Host "Website files in: $(Get-Location)\website" -ForegroundColor Cyan
Write-Host ""
Write-Host "The website will be available at:" -ForegroundColor Yellow
Write-Host "  http://localhost:8080" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

# Start the Python HTTP server from root directory
try {
    python -m http.server 8080
}
catch {
    Write-Host "Error starting Python server. Make sure Python is installed and in your PATH." -ForegroundColor Red
    Write-Host "You can also try opening index.html directly in your browser." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
}
