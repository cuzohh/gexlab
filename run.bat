@echo off
echo Launching GexLab v2 Suite...

:: 1. Start Backend
echo Starting Quant Engine...
start cmd /k "cd backend && venv\Scripts\python -m uvicorn main:app --reload"

:: 2. Start Frontend
echo Starting Dashboard...
cd frontend
npm run dev
