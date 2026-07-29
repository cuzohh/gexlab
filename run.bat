@echo off
setlocal
title GEXLab V3 ^| Market Context
color 0F

for /F "delims=" %%E in ('echo prompt $E^| cmd') do set "ESC=%%E"
set "INK=%ESC%[38;2;233;231;224m"
set "MUTED=%ESC%[38;2;144;153;146m"
set "MAP=%ESC%[38;2;136;180;200m"
set "GOOD=%ESC%[38;2;120;183;167m"
set "WARN=%ESC%[38;2;208;169;93m"
set "RESET=%ESC%[0m"

cd /d "%~dp0"
cls

echo.
echo   %MAP%      ^|   ^|  ^|%RESET%
echo   %MAP%      ^| ^| ^| ^|%RESET%   %INK%G E X L A B%RESET%  %MUTED%/ V3%RESET%
echo   %MAP%      ^|^|   ^|^|%RESET%   %MUTED%MARKET CONTEXT, CLEARLY MAPPED%RESET%
echo.
echo   %MUTED%------------------------------------------------------------%RESET%
echo.
echo   %MUTED%[01]%RESET%  %INK%Runtime check%RESET%

where npm >nul 2>nul
if errorlevel 1 (
    echo.
    echo         %WARN%Node.js and npm were not found.%RESET%
    echo         %MUTED%Install Node.js, then run this launcher again.%RESET%
    echo.
    pause
    exit /b 1
)

echo         %GOOD%Node.js ready%RESET%
echo.
echo   %MUTED%[02]%RESET%  %INK%Dependencies%RESET%

if not exist "node_modules\" (
    echo         %WARN%Installing first-run packages...%RESET%
    call npm install
    if errorlevel 1 (
        echo.
        echo         %WARN%Dependency installation failed.%RESET%
        pause
        exit /b 1
    )
) else (
    echo         %GOOD%Packages ready%RESET%
)

echo.
echo   %MUTED%[03]%RESET%  %INK%Interface%RESET%
echo         %GOOD%Starting local workspace%RESET%
echo.
echo   %MUTED%------------------------------------------------------------%RESET%
echo   %MAP%http://localhost:3000%RESET%
echo   %MUTED%Keep this window open. Press Ctrl+C to stop GEXLab.%RESET%
echo.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "$url='http://localhost:3000'; for ($attempt=0; $attempt -lt 60; $attempt++) { try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1 | Out-Null; Start-Process $url; break } catch { Start-Sleep -Milliseconds 500 } }"

call npm run dev

if errorlevel 1 (
    echo.
    echo   %WARN%GEXLab stopped with an error.%RESET%
    pause
)

endlocal
