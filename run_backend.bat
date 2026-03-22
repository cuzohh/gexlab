@echo off
cd /d %~dp0backend

echo Setting up Python environment...

if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

echo Activating environment...
call venv\Scripts\activate.bat

echo Checking dependencies...
python -m pip install -r requirements.txt

echo.
echo Starting FastAPI Backend on http://localhost:8000 ...
echo.
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Backend failed to start.
)
pause
