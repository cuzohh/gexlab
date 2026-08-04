@echo off
setlocal
title GEXLab V3 ^| Market Context Engine
color 0F

for /F "delims=" %%E in ('echo prompt $E^| cmd') do set "ESC=%%E"
set "CYAN=%ESC%[38;2;56;189;248m"
set "BLUE=%ESC%[38;2;99;102;241m"
set "PURPLE=%ESC%[38;2;168;85;247m"
set "PINK=%ESC%[38;2;236;72;153m"
set "EMERALD=%ESC%[38;2;52;211;153m"
set "AMBER=%ESC%[38;2;251;191;36m"
set "MUTED=%ESC%[38;2;148;163;184m"
set "DARK=%ESC%[38;2;71;85;105m"
set "WHITE=%ESC%[38;2;248;250;252m"
set "RESET=%ESC%[0m"

cd /d "%~dp0"
cls

echo.
echo   %CYAN%  ______   _______   _  _      _         _______   _______  %RESET%
echo   %CYAN% / ___  \ (  ____ \ ( \/ )    ( \       (  ___  ) (  ____ \ %RESET%
echo   %BLUE%/ /   \  \^| (    \/  \  /     ^| (       ^| (   ) ^| ^| (    \/ %RESET%
echo   %BLUE%^| ^|    ) ^|^| (__       \/      ^| ^|       ^| (___) ^| ^| (__     %RESET%   %WHITE%G E X L A B%RESET%  %EMERALD%v3.0.0%RESET%
echo   %PURPLE%^| ^|    ^| ^|^|  __)      /\      ^| ^|       ^|  ___  ^| ^|  __ \   %RESET%   %MUTED%------------------------------------%RESET%
echo   %PURPLE%^| ^|    ) ^|^| (        /  \     ^| ^|       ^| (   ) ^| ^| (  \ \  %RESET%   %AMBER%* QUANTITATIVE ENGINE %RESET%
echo   %PINK%\ \___/  /^| (____/\ / /\ \    ^| (____/\ ^| )   ( ^| ^| (___) ) %RESET%   %CYAN%* REAL-TIME GAMMA STRUCTURE %RESET%
echo   %PINK% \______/ (_______/ \_/  \_\  (_______/ ^|/     \^| (______/  %RESET%   %EMERALD%* FORECAST ^& REVERSAL ZONES %RESET%
echo.
echo   %MUTED%------------------------------------------------------------------------------------%RESET%
echo.
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
