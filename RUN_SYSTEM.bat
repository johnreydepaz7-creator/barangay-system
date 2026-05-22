@echo off
setlocal EnableExtensions

REM ============================================================
REM Barangay Management System - Portable One Click Launcher
REM This BAT can be placed/executed from any drive/folder path.
REM It always runs the project from the folder where this BAT file exists.
REM ============================================================

set "APP_DIR=%~dp0"
set "APP_URL=http://localhost:3000/"
set "APP_PORT=3000"

title Barangay Management System - One Click Launcher

pushd "%APP_DIR%" >nul 2>nul
if errorlevel 1 (
  echo ERROR: Cannot open the project folder:
  echo %APP_DIR%
  echo.
  pause
  exit /b 1
)

echo ============================================
echo   Barangay Management System Launcher
echo ============================================
echo.
echo Project folder:
echo %CD%
echo.

if not exist "server.js" (
  echo ERROR: server.js was not found.
  echo This launcher must stay inside the main project folder.
  echo.
  pause
  popd >nul 2>nul
  exit /b 1
)

if not exist "package.json" (
  echo ERROR: package.json was not found.
  echo This launcher must stay inside the main project folder.
  echo.
  pause
  popd >nul 2>nul
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not added to PATH.
  echo Please install Node.js first, then double-click this file again.
  echo.
  pause
  popd >nul 2>nul
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not installed or not added to PATH.
  echo Please install Node.js first, then double-click this file again.
  echo.
  pause
  popd >nul 2>nul
  exit /b 1
)

echo Checking if the system is already running...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $client = New-Object Net.Sockets.TcpClient; $client.Connect('127.0.0.1',%APP_PORT%); $client.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto OPEN_BROWSER

if not exist "node_modules\express" (
  echo Dependencies were not found.
  echo Installing dependencies now. This is only needed on the first run.
  echo.
  set "NPM_CONFIG_REGISTRY=https://registry.npmjs.org/"
  call npm config set registry https://registry.npmjs.org/ >nul 2>nul
  call npm config delete proxy >nul 2>nul
  call npm config delete https-proxy >nul 2>nul
  call npm install --registry=https://registry.npmjs.org/ --no-audit --fund=false
  if errorlevel 1 (
    echo.
    echo npm install failed. Please check your internet connection and the error above.
    echo.
    pause
    popd >nul 2>nul
    exit /b 1
  )
) else (
  echo Dependencies found. Skipping npm install.
)

echo.
echo Starting the server in a new window...
start "Barangay Management System Server" cmd /k "pushd ""%APP_DIR%"" && npm start"

echo Waiting for the server to become ready...
for /l %%i in (1,1,60) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $client = New-Object Net.Sockets.TcpClient; $client.Connect('127.0.0.1',%APP_PORT%); $client.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto OPEN_BROWSER
  timeout /t 1 /nobreak >nul
)

echo.
echo The server did not respond on port %APP_PORT% yet.
echo Check the server window for errors, then open this manually:
echo %APP_URL%
echo.
pause
popd >nul 2>nul
exit /b 1

:OPEN_BROWSER
echo.
echo Opening the system in your default browser...
start "" "%APP_URL%"
echo.
echo Done. You may close this launcher window.
timeout /t 3 /nobreak >nul
popd >nul 2>nul
exit /b 0
