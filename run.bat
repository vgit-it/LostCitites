@echo off
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo Node.js / npm was not found. Install it from https://nodejs.org and try again.
    pause
    exit /b 1
)

echo Installing dependencies...
call npm install
if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
)

echo Starting the game server and client...
echo Table:  http://localhost:5173/table
echo Phone:  http://localhost:5173/play  (or scan the QR shown on the table)
call npm run dev

pause
