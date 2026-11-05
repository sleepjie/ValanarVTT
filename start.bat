@echo off
rem Starts the site (map, wiki, files and the table) and opens it in your browser.
rem Leave this window open while you use it; close it to stop. Everything is saved as you go.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Download the LTS version from https://nodejs.org,
  echo   install it with the default options, then run start.bat again.
  echo.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8642/"
node server\server.js
pause
