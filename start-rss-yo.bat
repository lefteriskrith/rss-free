@echo off
cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js first, then run npm install.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

start "" "http://localhost:5173"
echo RSS Yo is starting at http://localhost:5173
echo Keep this window open while using the app. Close it to stop the server.
call npm run dev
