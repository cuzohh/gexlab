@echo off
cd %~dp0frontend

echo Installing NPM dependencies...
call npm install

echo Starting Vite React Frontend...
call npm run dev
