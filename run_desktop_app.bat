@echo off
cd /d %~dp0

if not exist "frontend\dist" (
    echo Building frontend bundle...
    call npm run desktop:build:frontend
    if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
)

echo Starting GEXLAB desktop shell...
call npx electron .
