@echo off
rem Puts the site on your rented server (Ubuntu), updates it, and moves your world between this PC and the server.
rem
rem   1  Quick: only the files changed since the last update (code, pages, icons, new tiles). Seconds, not minutes.
rem      The server keeps its own world, campaigns and accounts. Files deleted here stay on the server (use 6 for that).
rem   6  The whole site's code and map tiles, the old way (also the first time, and after deleting files).
rem   2  Code, tiles and THIS PC's world (map, wiki, files, calendar): replaces those on the server.
rem      Campaigns and accounts on the server stay as they are. Use this after working on your world here.
rem   3  Everything on this PC, campaigns and accounts too: replaces all of the server's data.
rem   4  Bring the server's data down to this PC (this PC's old copy is kept beside it).
rem   5  Give the site its own domain name (e.g. example.com), or go back to the free sslip.io address.
rem      Point the domain's DNS at the server first. The server remembers it; later updates keep it.
rem
rem The server keeps a backup of its data before anything replaces it (/opt/valanar/backups, the last 20).
rem The first time it asks for the server's root password once; after that this PC has a key and goes straight in.
setlocal EnableExtensions
cd /d "%~dp0"
title Go live

set "CFG=%~dp0go_live.cfg"
set "IP="
if exist "%CFG%" set /p IP=<"%CFG%"
if not defined IP set /p IP=Server IP address: 
if not defined IP goto :eof
echo Server: %IP%   (delete go_live.cfg to use a different one)

rem --- this PC's key, so the password is only needed once -------------------
set "KEY=%USERPROFILE%\.ssh\id_ed25519"
if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"
if not exist "%KEY%" ssh-keygen -q -t ed25519 -N "" -f "%KEY%"
set SSHOPT=-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -i "%KEY%"
ssh %SSHOPT% -o BatchMode=yes -o ConnectTimeout=15 root@%IP% exit >nul 2>&1
if not errorlevel 1 goto :keyok
echo.
echo This PC needs letting in to the server, once.
echo Type the server's root password when it asks and press Enter.
echo NOTHING SHOWS WHILE YOU TYPE IT - that's normal. You can paste it with a right-click.
echo.
set /p PUB=<"%KEY%.pub"
ssh -o StrictHostKeyChecking=accept-new -o PubkeyAuthentication=no root@%IP% "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '%PUB%' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
if errorlevel 1 goto :failed
ssh %SSHOPT% -o BatchMode=yes -o ConnectTimeout=15 root@%IP% exit >nul 2>&1
if errorlevel 1 goto :failed
echo Done: no more passwords from now on.
:keyok
> "%CFG%" echo %IP%

echo.
echo What should happen?
echo   1  Quick update: only what changed since the last update
echo   2  Update, and send THIS PC's world: map, wiki, files, calendar (campaigns and accounts on the server stay)
echo   3  Update, and send EVERYTHING on this PC, campaigns and accounts too
echo   4  Bring the server's data down to this PC
echo   5  Update, and use a domain name (or go back to the free address)
echo   6  Full update of the code and map tiles (slow: everything, like the first time)
echo (The very first time, anything sends it all.)
set "MODE=1"
set /p MODE=Choose 1, 2, 3, 4, 5 or 6 [1]: 
if "%MODE%"=="4" goto :pull
if "%MODE%"=="1" goto :quick
if "%MODE%"=="6" set "MODE=1"
set "DOMARG="
if "%MODE%"=="5" goto :domain
if not "%MODE%"=="1" if not "%MODE%"=="2" if not "%MODE%"=="3" goto :eof
goto :pack

:domain
echo.
echo Its DNS must already point at %IP% (an A record for the name, and one for www).
echo Type the domain, e.g. example.com - or type sslip to go back to the free address.
set /p DOMARG=Domain: 
if not defined DOMARG goto :eof
set "MODE=1"

:quick
rem only files newer than the last update (go_live.last); the first time there is none, so it sends it all
if not exist go_live.last (
  echo No quick update yet on this PC: sending the whole site this once.
  set "MODE=1"
  goto :pack
)
echo.
echo Packing what changed since the last update...
if exist patch.tgz del patch.tgz
> go_live.next echo next
rem the list: files changed since go_live.last, not the world's data, the big map pictures or this script's own files
powershell -NoProfile -Command "$t=(Get-Item 'go_live.last').LastWriteTime; $root=(Get-Location).Path; Get-ChildItem -Recurse -File | Where-Object { $_.LastWriteTime -gt $t } | ForEach-Object { $_.FullName.Substring($root.Length+1).Replace('\','/') } | Where-Object { $_ -notmatch '^(vtt-data|vtt-data-before-[^/]*|\.git|tools/vips-dev-[^/]*)/' -and $_ -notmatch '^(worldmap[^/]*\.png|[^/]*\.psd|site\.tgz|patch\.tgz|data\.tgz|go_live\.[^/]*|patch\.list)$' } | Set-Content -Encoding ascii patch.list"
if errorlevel 1 goto :failed
set "NFILES=0"
for /f %%N in ('type patch.list ^| find /c /v ""') do set "NFILES=%%N"
if "%NFILES%"=="0" (
  echo Nothing has changed since the last update.
  del patch.list & del go_live.next
  pause
  goto :eof
)
echo Changed since the last update:
type patch.list
tar -czf patch.tgz -T patch.list
if errorlevel 1 goto :failed
echo Uploading %NFILES% file(s)...
scp %SSHOPT% patch.tgz root@%IP%:/root/patch.tgz
if errorlevel 1 goto :failed
ssh %SSHOPT% root@%IP% "set -e; tar -xzf /root/patch.tgz -C /opt/valanar/app; chown -R valanar:valanar /opt/valanar/app; rm -f /root/patch.tgz; systemctl restart valanar"
if errorlevel 1 goto :failed
del patch.tgz & del patch.list
move /y go_live.next go_live.last >nul
echo.
echo All done: the site is updated (refresh the page; Ctrl+F5 if it looks old).
pause
goto :eof

:pack
> go_live.next echo next

echo.
echo Packing the site (the big map PNGs stay here)...
if exist site.tgz del site.tgz
tar -czf site.tgz --exclude=./worldmap*.png --exclude=./*.psd --exclude=./site.tgz --exclude=./data.tgz --exclude=./go_live.* --exclude=./patch.tgz --exclude=./patch.list --exclude=./vtt-data-before-* --exclude=./tools/vips-dev-* --exclude=./vtt-data/sessions.json .
if errorlevel 1 goto :failed
echo Uploading...
scp %SSHOPT% site.tgz root@%IP%:/root/site.tgz
if errorlevel 1 goto :failed
echo Setting up (the first time it asks for an admin name and password for the site)...
ssh -t %SSHOPT% root@%IP% "rm -rf /root/site && mkdir -p /root/site && tar -xzf /root/site.tgz -C /root/site && bash /root/site/deploy/setup-ubuntu.sh %DOMARG%"
if errorlevel 1 goto :failed
if "%MODE%"=="1" goto :done

echo.
if "%MODE%"=="2" echo Sending this PC's world (the server's is backed up first)...
if "%MODE%"=="3" echo Sending everything on this PC (the server's data is backed up first)...
set "WHAT=rsync -a --delete /root/site/vtt-data/site/ /opt/valanar/data/site/"
if "%MODE%"=="3" set "WHAT=rsync -a --delete --exclude config.json --exclude sessions.json /root/site/vtt-data/ /opt/valanar/data/"
ssh %SSHOPT% root@%IP% "set -e; systemctl stop valanar; mkdir -p /opt/valanar/backups; tar -czf /opt/valanar/backups/data-$(date +%%Y%%m%%d-%%H%%M%%S).tgz -C /opt/valanar data; ls -1t /opt/valanar/backups/*.tgz | tail -n +21 | xargs -r rm -f; %WHAT%; chown -R valanar:valanar /opt/valanar/data; systemctl start valanar"
if errorlevel 1 goto :failed

:done
if exist site.tgz del site.tgz
if exist go_live.next move /y go_live.next go_live.last >nul
echo.
echo All done.
pause
goto :eof

:pull
echo.
echo This replaces the vtt-data folder on this PC with the server's (your current one is kept, renamed).
echo Close start_vtt.bat first if it's running.
pause
ssh %SSHOPT% root@%IP% "tar -czf /root/data.tgz --exclude=./sessions.json -C /opt/valanar/data ."
if errorlevel 1 goto :failed
scp %SSHOPT% root@%IP%:/root/data.tgz data.tgz
if errorlevel 1 goto :failed
for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%T"
if exist vtt-data ren vtt-data "vtt-data-before-%STAMP%"
mkdir vtt-data
tar -xzf data.tgz -C vtt-data
if errorlevel 1 goto :failed
if exist "vtt-data-before-%STAMP%\config.json" copy /y "vtt-data-before-%STAMP%\config.json" "vtt-data\config.json" >nul
del data.tgz
echo.
echo Done: this PC now has the server's data. The old copy is in vtt-data-before-%STAMP%.
pause
goto :eof

:failed
echo.
echo Something went wrong: the message above says what.
pause
