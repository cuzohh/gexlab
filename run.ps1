# GexLab v2 Startup Script

Write-Host "Launching GexLab v2 Suite..." -ForegroundColor Cyan

# 1. Start Backend in a new window using cmd for better compatibility
Write-Host "Starting Quant Engine..." -ForegroundColor Yellow
Start-Process cmd -ArgumentList "/k", "cd backend && venv\Scripts\python -m uvicorn main:app --reload"

# 2. Wait for backend to stabilize
Start-Sleep -Seconds 3

# 3. Start Frontend
Write-Host "Starting Dashboard..." -ForegroundColor Green
cd frontend
npm run dev
