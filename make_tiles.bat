@echo off
setlocal
title Map tiler
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem  Cuts the world map PNG into Leaflet tiles in the "tiles" folder next to
rem  this file, then opens index.html.
rem
rem  To tile a different image, drag that PNG onto this file.
rem
rem  It asks whether this is the main map or another version of it (the world
rem  at another time, for a campaign): a version goes into maps\<name>\ and
rem  leaves the main map alone. Send it to the server with go_live.bat (1), then
rem  pick it in the table: World map scene > A new version of the map > Picture.
rem
rem  If the PNG has a transparent sea, the viewer draws its animated sea
rem  underneath, and the land mask (data\land.js) is rebuilt from the
rem  transparency so the sea and the borders layer follow the coastline.
rem ---------------------------------------------------------------------------

set "SRC=%~dp0world.png"
if not "%~1"=="" set "SRC=%~1"

rem  Tile format. .webp[Q=90] is small and looks the same as the source.
rem  Use .png for lossless tiles (several times larger on disk).
set "SUFFIX=.webp[Q=90]"

set "VIPS_URL=https://github.com/libvips/build-win64-mxe/releases/download/v8.18.7/vips-dev-x64-web-8.18.7.zip"

if not exist "%SRC%" goto :nosrc

rem --- the main map, or a version of it -----------------------------------------
echo.
echo Is this the main world map, or another version of it (the world at another time)?
:askver
set "VER="
set /p VER=Press Enter for the main map, or type a short name for the version (e.g. year300): 
set "OUT=tiles"
set "INFOFILE=mapinfo.js"
set "LANDFILE=data\land.js"
if not defined VER goto :verok
echo %VER%| findstr /r /x "[A-Za-z0-9_-]*" >nul
if errorlevel 1 (
  echo Use only letters, numbers, - and _ in the name.
  goto :askver
)
set "OUT=maps\%VER%\tiles"
set "INFOFILE=maps\%VER%\mapinfo.js"
set "LANDFILE=maps\%VER%\land.js"
if not exist "maps\%VER%" mkdir "maps\%VER%"
:verok

rem --- find libvips, or download it into tools\ the first time ---------------
set "VIPSBIN="
for /d %%D in (tools\vips-dev-*) do set "VIPSBIN=%%~fD\bin"
if defined VIPSBIN goto :havevips

echo Downloading libvips, the image tiler, about 11 MB, into the tools folder...
if not exist tools mkdir tools
curl -L --fail -o "tools\vips.zip" "%VIPS_URL%"
if errorlevel 1 goto :nodownload
tar -xf "tools\vips.zip" -C tools
if errorlevel 1 goto :nodownload
del "tools\vips.zip"
for /d %%D in (tools\vips-dev-*) do set "VIPSBIN=%%~fD\bin"

:havevips
if not exist "%VIPSBIN%\vips.exe" goto :nodownload

rem --- image size and whether it has transparency ----------------------------
rem  (the doubled quotes are needed when for /f runs a quoted program with quoted arguments)
for /f "usebackq delims=" %%A in (`""%VIPSBIN%\vipsheader.exe" -f width "%SRC%""`) do set "IMGW=%%A"
for /f "usebackq delims=" %%A in (`""%VIPSBIN%\vipsheader.exe" -f height "%SRC%""`) do set "IMGH=%%A"
for /f "usebackq delims=" %%A in (`""%VIPSBIN%\vipsheader.exe" -f bands "%SRC%""`) do set "BANDS=%%A"
set "TRANSPARENT=false"
if "%BANDS%"=="4" set "TRANSPARENT=true"
if "%BANDS%"=="2" set "TRANSPARENT=true"
echo.
echo Map image: %IMGW% x %IMGH%, %BANDS% bands.
if "%TRANSPARENT%"=="true" echo It has transparency, so the animated sea will show through.

rem --- clear out tiles from a previous run -----------------------------------
if not exist "%OUT%" goto :tile
echo.
echo The existing tiles in "%OUT%" will be replaced.
echo Close this window to cancel.
pause
rmdir /s /q "%OUT%"

:tile
echo.
echo Tiling "%SRC%"
echo This takes a few minutes. Leave this window open.
echo.
"%VIPSBIN%\vips.exe" --vips-progress dzsave "%SRC%" "%OUT%" --layout google --suffix %SUFFIX% --background 0 --skip-blanks 0
if errorlevel 1 goto :failed

rem --- record the image size for index.html ----------------------------------
for /f "delims=[" %%E in ("%SUFFIX%") do set "EXT=%%E"
> "%INFOFILE%" echo window.MAP_INFO = { width: %IMGW%, height: %IMGH%, ext: "%EXT%", transparent: %TRANSPARENT% };

if not "%TRANSPARENT%"=="true" goto :done

rem --- land mask from the transparency: 1 pixel per 8, into data\land.js (or the version's land.js) ---
echo.
echo Making the land mask from the transparency...
set /a ALPHA=%BANDS%-1
"%VIPSBIN%\vips.exe" shrink "%SRC%" "tools\land_small.v" 8 8
if errorlevel 1 goto :nomask
"%VIPSBIN%\vips.exe" extract_band "tools\land_small.v" "tools\land.png" %ALPHA%
if errorlevel 1 goto :nomask
powershell -NoProfile -ExecutionPolicy Bypass -Command "$b = [Convert]::ToBase64String([IO.File]::ReadAllBytes('%~dp0tools\land.png')); [IO.File]::WriteAllText('%~dp0%LANDFILE%', '// Land mask written by make_tiles.bat from the map''s transparency: 1 pixel per 8 map pixels, white = land.' + [char]10 + 'window.VALANAR_LAND = { scale: 8, src: ''data:image/png;base64,' + $b + ''' };' + [char]10)"
if errorlevel 1 goto :nomask
del "tools\land_small.v" "tools\land.png"
echo Land mask written to %LANDFILE%.
goto :done

:nomask
echo.
echo Could not make the land mask. The tiles are fine; the sea and the borders
echo layer keep using the old data\land.js.

:done
echo.
if defined VER goto :doneversion
echo Done. Opening the map.
echo Reload the site in your browser to see the new map.
goto :end
:doneversion
echo Done: the picture "%VER%" is in maps\%VER%.
echo Send it to the server with go_live.bat (choice 1). Then in the table: Scenes,
echo World map scene, "A new version of the map", and pick it as the picture.
goto :end

:nosrc
echo Could not find the map image:
echo   "%SRC%"
echo Edit the SRC line near the top of this file, or drag the PNG onto this file.
goto :end

:nodownload
echo.
echo Could not download or unpack libvips.
echo Download this zip yourself and unzip it into the tools folder, then run this again:
echo   %VIPS_URL%
goto :end

:failed
echo.
echo Tiling failed. The message above says why.

:end
echo.
pause
