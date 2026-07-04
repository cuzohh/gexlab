@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoLogo -NoExit -File "%~dp0run.ps1"
