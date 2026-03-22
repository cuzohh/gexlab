@echo off
cd /d %~dp0backend

echo Setting up Python environment...
if not exist "venv" (
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

echo.
echo Starting FastAPI Backend on http://localhost:8000 ...
echo.
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
pause
