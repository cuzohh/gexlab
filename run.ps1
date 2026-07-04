$ErrorActionPreference = 'SilentlyContinue'
$root = $PSScriptRoot

$host.UI.RawUI.WindowTitle = "GexLab v2"
Clear-Host

Write-Host ""
Write-Host "   ###   ####  #   #  #      ###   ####  " -ForegroundColor DarkYellow
Write-Host "  #      #      # #   #     #   #  #   # " -ForegroundColor DarkYellow
Write-Host "  # ##   ###     #    #     #####  ####  " -ForegroundColor DarkYellow
Write-Host "  #  #   #      # #   #     #   #  #   # " -ForegroundColor DarkYellow
Write-Host "   ###   ####  #   #  #####  #   #  ####  " -ForegroundColor DarkYellow
Write-Host ""
Write-Host "       Gamma Exposure Intelligence  v2" -ForegroundColor Yellow
Write-Host ""
Write-Host "  --------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# Kill stale processes on 8000 / 3000
foreach ($port in 8000, 3000) {
    $lines = netstat -ano | Where-Object { $_ -match ":$port\s" }
    foreach ($line in $lines) {
        $p = ($line -split '\s+')[-1]
        if ($p -match '^\d+$') { taskkill /F /PID $p 2>$null | Out-Null }
    }
}

# Start backend in a minimised window
Write-Host "  [1/2]  Starting backend engine..." -ForegroundColor Gray
$backend = Start-Process -FilePath "cmd" `
    -ArgumentList "/c venv\Scripts\python -m uvicorn main:app" `
    -WorkingDirectory "$root\backend" `
    -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 4

# Open browser once dev server is ready (background job - non-blocking)
$null = Start-Job -ScriptBlock {
    param($url)
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 2
        try {
            $r = Invoke-WebRequest -Uri $url -TimeoutSec 1 -UseBasicParsing
            if ($r.StatusCode -eq 200) { break }
        } catch {}
    }
    Start-Process $url
} -ArgumentList "http://localhost:3000"

# Run frontend inline (blocking) - closing this window stops everything
Write-Host "  [2/2]  Starting dashboard (close this window to stop)..." -ForegroundColor Gray
Write-Host ""

Push-Location "$root\frontend"
try {
    npm run dev
} finally {
    Write-Host ""
    Write-Host "  Shutting down..." -ForegroundColor Yellow

    if ($backend -and $backend.Id) {
        taskkill /T /F /PID $backend.Id 2>$null | Out-Null
    }

    foreach ($port in 8000, 3000) {
        $lines = netstat -ano | Where-Object { $_ -match ":$port\s" }
        foreach ($line in $lines) {
            $p = ($line -split '\s+')[-1]
            if ($p -match '^\d+$') { taskkill /F /PID $p 2>$null | Out-Null }
        }
    }

    Get-Job | Remove-Job -Force
    Pop-Location
    Write-Host "  Done." -ForegroundColor DarkGray
    Start-Sleep -Seconds 2
}
