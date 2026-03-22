@echo off
cd /d %~dp0frontend

echo Installing NPM dependencies...
call npm install

echo.
echo Starting Vite React Frontend on http://localhost:3000 ...
echo.
call npx vite --port 3000
pause
