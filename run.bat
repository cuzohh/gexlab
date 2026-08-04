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
set "ACCENT=%ESC%[38;2;99;179;237m"
set "RESET=%ESC%[0m"

cd /d "%~dp0"
cls

echo.
echo   %MAP%  ____   _____  __  __   _        _     ____  %RESET%
echo   %MAP% / ___^| ^| ____^| \ \/ /  ^| ^|      / \   ^|  _ \ %RESET%   %INK%G E X L A B%RESET%  %ACCENT%v3.0%RESET%
echo   %MAP%^| ^|  _  ^|  _^|    \  /   ^| ^|     / _ \  ^| ^|_) ^|%RESET%   %MUTED%QUANTITATIVE MARKET CONTEXT%RESET%
echo   %MAP%^| ^|_^| ^| ^| ^|___   /  \   ^| ^|___ / ___ \ ^|  _ ^< %RESET%   %GOOD%* Options Structure ^& Volatility%RESET%
echo   %MAP% \____^| ^|_____^| /_/\_\  ^|_____^|/_/ \_\ ^|____/%RESET%   %WARN%* Forecast ^& Reversal Engine%RESET%
echo.
echo   %MUTED%   +------------------------------------------------------------+%RESET%
echo   %MUTED%   ^|%RESET% %GOOD%  [+] CALL WALL%RESET%   %MAP%========== 21,450 ==========%RESET% %GOOD%+14.2k GEX%RESET% %MUTED%^|%RESET%
echo   %MUTED%   ^|%RESET% %MUTED%      ^|         ^|                             ^|      ^|%RESET%
echo   %MUTED%   ^|%RESET% %GOOD%    +---+       ^|       +---+                 ^|      ^|%RESET%
echo   %MUTED%   ^|%RESET% %GOOD%    ^|   ^|       ^|       ^|   ^|  [SPOT 21,280]  ^|      ^|%RESET%
echo   %MUTED%   ^|%RESET% %WARN%    ^|   ^|     +---+     ^|   ^|  ------------  ^|      ^|%RESET%
echo   %MUTED%   ^|%RESET% %WARN%    +---+     ^|   ^|     +---+                 ^|      ^|%RESET%
echo   %MUTED%   ^|%RESET% %MUTED%      ^|       +---+       ^|                             ^|      ^|%RESET%
echo   %MUTED%   ^|%RESET% %WARN%  [-] PUT WALL%RESET%    %MAP%========== 21,100 ==========%RESET% %WARN%-18.6k GEX%RESET% %MUTED%^|%RESET%
echo   %MUTED%   +------------------------------------------------------------+%RESET%
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

rem This launcher used to run the development server, which compiles each page
rem the first time it is opened. That compile blocks the navigation that asked
rem for it: moving to Reversal took 17 seconds and to Engine 40, during which
rem the click appeared to do nothing and the workspace could not be left. The
rem same navigations take well under a fifth of a second against a build. The
rem build is done once here, up front, where waiting is expected.
echo         %MUTED%Building workspace (first run takes longest)...%RESET%
call npm run build >nul 2>nul
if errorlevel 1 (
    echo.
    echo         %WARN%Build failed. Showing the error:%RESET%
    echo.
    call npm run build
    pause
    exit /b 1
)
echo         %GOOD%Workspace built%RESET%
echo.
echo   %MUTED%------------------------------------------------------------%RESET%
echo   %MAP%http://localhost:3000%RESET%
echo   %MUTED%Keep this window open. Press Ctrl+C to stop GEXLab.%RESET%
echo.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "$url='http://localhost:3000'; for ($attempt=0; $attempt -lt 60; $attempt++) { try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1 | Out-Null; Start-Process $url; break } catch { Start-Sleep -Milliseconds 500 } }"

call npm start

if errorlevel 1 (
    echo.
    echo   %WARN%GEXLab stopped with an error.%RESET%
    pause
)

endlocal
