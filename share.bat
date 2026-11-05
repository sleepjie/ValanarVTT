@echo off
rem Gives the site a temporary public https address so players outside your home network can join.
rem Needs Cloudflare's free cloudflared tool (no account needed). Run start.bat first.
cd /d "%~dp0"
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo   cloudflared is not installed. In a command prompt, run:
  echo       winget install --id Cloudflare.cloudflared
  echo   then close this window and run share.bat again.
  echo.
  pause
  exit /b 1
)
echo.
echo   Look below for a line ending in .trycloudflare.com: that is the site's address for this session.
echo   Paste it into Table ^> Players ^> Where players connect so new invite links use it.
echo   It changes every time you run this. For a permanent address, see docs\HOSTING.md.
echo.
cloudflared tunnel --url http://localhost:8642
pause
