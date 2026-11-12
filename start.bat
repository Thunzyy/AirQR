@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
set "WEB_DIR=%ROOT_DIR%apps\web"
set "WEB_DIST=%WEB_DIR%\dist"
set "SYNC_DIR=%ROOT_DIR%services\sync-server"
set "ENV_FILE=%ROOT_DIR%.env"

set "WEB_PORT=5173"
set "SYNC_PORT=8081"
set "WS_PORT="
set "AIRQR_TLS_CERT="
set "AIRQR_TLS_KEY="
set "AIRQR_BOOTSTRAP_USERNAME="
set "AIRQR_BOOTSTRAP_PASSWORD="

if exist "%ENV_FILE%" call :load_env "%ENV_FILE%"
if defined AIRQR_WEB_PORT set "WEB_PORT=%AIRQR_WEB_PORT%"
if defined AIRQR_SYNC_PORT set "SYNC_PORT=%AIRQR_SYNC_PORT%"
if defined AIRQR_WS_PORT set "WS_PORT=%AIRQR_WS_PORT%"
if not defined WS_PORT set "WS_PORT=%SYNC_PORT%"

set "MODE=prod"
set "TRANSPORT=auto"
set "ACTION=run"
set "EXTRA_SYNC_ARGS="
set "LOCAL_TRUSTED_PROXY_ARGS= --trusted-proxy 127.0.0.1/32 --trusted-proxy ::1/128"

:parse_args
if "%~1"=="" goto :after_parse
if "%~1"=="--" (
  shift
  goto :collect_extra
)
if /I "%~1"=="-dev" set "MODE=dev" & shift & goto :parse_args
if /I "%~1"=="dev" set "MODE=dev" & shift & goto :parse_args
if /I "%~1"=="-prod" set "MODE=prod" & shift & goto :parse_args
if /I "%~1"=="prod" set "MODE=prod" & shift & goto :parse_args
if /I "%~1"=="-http" set "TRANSPORT=http" & shift & goto :parse_args
if /I "%~1"=="-https" set "TRANSPORT=https" & shift & goto :parse_args
if /I "%~1"=="-stop" set "ACTION=stop" & shift & goto :parse_args
if /I "%~1"=="stop" set "ACTION=stop" & shift & goto :parse_args
if /I "%~1"=="-restart" set "ACTION=restart" & shift & goto :parse_args
if /I "%~1"=="restart" set "ACTION=restart" & shift & goto :parse_args
if /I "%~1"=="help" goto :help
if /I "%~1"=="-help" goto :help
if /I "%~1"=="--help" goto :help
if /I "%~1"=="-h" goto :help

echo [ERROR] Unknown argument: %~1
echo.
goto :usage

:collect_extra
if "%~1"=="" goto :after_parse
set "EXTRA_SYNC_ARGS=!EXTRA_SYNC_ARGS! %1"
shift
goto :collect_extra

:after_parse
if /I "%ACTION%"=="stop" (
  call :stop_services
  echo [OK] Services stopped.
  exit /b 0
)

if /I "%ACTION%"=="restart" (
  echo [INFO] Restart: stopping existing services first...
  call :stop_services
)

if /I "%MODE%"=="dev" (
  call :run_dev
  exit /b %ERRORLEVEL%
)

if /I "%MODE%"=="prod" (
  call :run_prod
  exit /b %ERRORLEVEL%
)

echo [ERROR] Unknown mode: %MODE%
echo.
goto :usage

:usage
echo AirQR launcher
echo.
echo Usage:
echo   start.bat                        ^(default: -prod -http^)
echo   start.bat -dev  [-http ^| -https] [-- extra sync-server args]
echo   start.bat -prod [-http ^| -https] [-- extra sync-server args]
echo   start.bat -stop
echo   start.bat -dev -restart
echo   start.bat -help
echo.
echo Examples:
echo   start.bat -dev -http
echo   start.bat -dev -https
echo   start.bat -prod -http
echo   start.bat -prod -https -- --verbose
echo.
exit /b 1

:help
echo AirQR launcher
echo.
echo Usage:
echo   start.bat                        ^(default: -prod -http^)
echo   start.bat -dev  [-http ^| -https] [-- extra sync-server args]
echo   start.bat -prod [-http ^| -https] [-- extra sync-server args]
echo   start.bat -stop
echo   start.bat -dev -restart
echo   start.bat -help
echo.
echo Notes:
echo   - -https requires a certificate and key.
echo   - Cert discovery order:
echo       1. AIRQR_TLS_CERT / AIRQR_TLS_KEY from .env
echo       2. services\sync-server\cert.pem + key.pem
echo       3. root localhost+2.pem + key
echo   - Extra sync-server args must be passed after --
echo.
exit /b 0

:run_dev
title AirQR - Dev
echo.
echo     _    _      ___  ____
echo    / \  (_)_ __/ _ \^|  _ \
echo   / _ \ ^| ^| '__^| ^| ^| ^| ^|_) ^|
echo  / ___ \^| ^| ^|  ^| ^|_^| ^|  _ ^<
echo /_/   \_\_^|_^|   \__\_\_^| \_\
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo [ERROR] Node.js is not installed.
  echo Install Node.js from https://nodejs.org/
  exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set "NODE_VERSION=%%i"
echo [OK] Node.js !NODE_VERSION! detected

where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo [WARN] Python is not installed. Sync server will not start.
  set "NO_SYNC=1"
) else (
  for /f "tokens=*" %%i in ('python --version 2^^^>^^^&1') do set "PYTHON_VERSION=%%i"
  echo [OK] !PYTHON_VERSION! detected
  set "NO_SYNC=0"
)

if "!NO_SYNC!"=="0" (
  call :resolve_transport dev
  if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
)

cd /d "%WEB_DIR%"
if not exist "node_modules" (
  echo [INFO] Installing npm dependencies...
  call npm install
  if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install failed.
    exit /b 1
  )
)

if "!NO_SYNC!"=="0" if exist "%SYNC_DIR%\requirements.txt" (
  echo [INFO] Installing Python dependencies - best effort...
  pip install -q -r "%SYNC_DIR%\requirements.txt" 2>nul
)

echo.
echo ============================================
echo   Starting AirQR services
echo ============================================
echo.

call :stop_services

if "!NO_SYNC!"=="0" (
  set "VITE_SYNC_SERVER_URL=!SYNC_SCHEME!://127.0.0.1:%SYNC_PORT%"
  if "%WS_PORT%"=="%SYNC_PORT%" (
    set "VITE_SYNC_EVENTS_WS_TARGET="
    set "VITE_SYNC_WS_URL="
  ) else (
    set "VITE_SYNC_EVENTS_WS_TARGET=!WS_SCHEME!://127.0.0.1:%WS_PORT%"
    set "VITE_SYNC_WS_URL=!VITE_SYNC_EVENTS_WS_TARGET!"
  )

  if "!SYNC_TLS!"=="1" (
    if "%WS_PORT%"=="%SYNC_PORT%" (
      echo [START] Sync server ^(unified internal listener^): !SYNC_SCHEME!/!WS_SCHEME! %SYNC_PORT%...
    ) else (
      echo [START] Sync server ^(split internal listeners^): API %SYNC_PORT%, WS %WS_PORT%...
    )
    start "AirQR Sync Server" /min python "%SYNC_DIR%\server.py" --port %SYNC_PORT% --ws-port %WS_PORT% --host 0.0.0.0%LOCAL_TRUSTED_PROXY_ARGS% --tls-cert "%TLS_CERT%" --tls-key "%TLS_KEY%"%EXTRA_SYNC_ARGS%
  ) else (
    if "%WS_PORT%"=="%SYNC_PORT%" (
      echo [START] Sync server ^(unified internal listener^): !SYNC_SCHEME!/!WS_SCHEME! %SYNC_PORT%...
    ) else (
      echo [START] Sync server ^(split internal listeners^): API %SYNC_PORT%, WS %WS_PORT%...
    )
    start "AirQR Sync Server" /min python "%SYNC_DIR%\server.py" --port %SYNC_PORT% --ws-port %WS_PORT% --host 0.0.0.0%LOCAL_TRUSTED_PROXY_ARGS%%EXTRA_SYNC_ARGS%
  )
  timeout /t 2 /nobreak >nul
)

echo [START] Web frontend ^(port %WEB_PORT%^)...
echo.
echo ============================================
echo   URLs:
echo   - Frontend: https://localhost:%WEB_PORT%
echo   - Browser sync origin: https://localhost:%WEB_PORT%/api/... ^(via Vite proxy^)
if "!NO_SYNC!"=="0" (
  if "%WS_PORT%"=="%SYNC_PORT%" (
    echo   - Unified internal sync: !SYNC_SCHEME!://localhost:%SYNC_PORT% ^(+ !WS_SCHEME! /api/v1/ws/...^)
  ) else (
    echo   - Internal sync API: !SYNC_SCHEME!://localhost:%SYNC_PORT%
    echo   - Internal sync WS: !WS_SCHEME!://localhost:%WS_PORT%
  )
)
echo ============================================
echo.
echo Press Ctrl+C to stop.
echo.

cd /d "%WEB_DIR%"
call npm run dev

echo.
echo [STOP] Stopping services...
call :stop_services
echo [STOP] All services stopped.
exit /b 0

:run_prod
title AirQR - Prod Local
if not exist "%WEB_DIST%\index.html" (
  echo [ERROR] Build web introuvable: %WEB_DIST%\index.html
  echo [INFO] Executez: cd apps\web ^&^& npm run build
  exit /b 1
)

where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo [ERROR] Python non trouve.
  exit /b 1
)

call :resolve_transport prod
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo.
echo     _    _      ___  ____
echo    / \  (_)_ __/ _ \^|  _ \
echo   / _ \ ^| ^| '__^| ^| ^| ^| ^|_) ^|
echo  / ___ \^| ^| ^|  ^| ^|_^| ^|  _ ^<
echo /_/   \_\_^|_^|   \__\_\_^| \_\
echo.

echo [INFO] Stopping existing services on internal ports %SYNC_PORT%/%WS_PORT%...
call :stop_services

echo [START] AirQR Web prod locale
echo [START] URL: !SYNC_SCHEME!://localhost:%SYNC_PORT%
echo [START] Unified listener: !SYNC_SCHEME!/!WS_SCHEME! on %SYNC_PORT%

if "!SYNC_TLS!"=="1" (
  python "%SYNC_DIR%\server.py" ^
    --host 0.0.0.0 ^
    --port %SYNC_PORT% ^
    --ws-port %SYNC_PORT% ^
    --trusted-proxy 127.0.0.1/32 ^
    --trusted-proxy ::1/128 ^
    --tls-cert "%TLS_CERT%" ^
    --tls-key "%TLS_KEY%" ^
    --storage-dir "%SYNC_DIR%\storage" ^
    --users-file "%SYNC_DIR%\users.json" ^
    --static-dir "%WEB_DIST%"%EXTRA_SYNC_ARGS%
) else (
  python "%SYNC_DIR%\server.py" ^
    --host 0.0.0.0 ^
    --port %SYNC_PORT% ^
    --ws-port %SYNC_PORT% ^
    --trusted-proxy 127.0.0.1/32 ^
    --trusted-proxy ::1/128 ^
    --storage-dir "%SYNC_DIR%\storage" ^
    --users-file "%SYNC_DIR%\users.json" ^
    --static-dir "%WEB_DIST%"%EXTRA_SYNC_ARGS%
)
exit /b %ERRORLEVEL%

:resolve_transport
set "RUN_MODE=%~1"
call :resolve_tls_files
set "SYNC_TLS=0"
set "SYNC_SCHEME=http"
set "WS_SCHEME=ws"

if /I "%TRANSPORT%"=="https" (
  call :require_tls_files
  if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
  set "SYNC_TLS=1"
) else if /I "%TRANSPORT%"=="http" (
  set "SYNC_TLS=0"
) else (
  if /I "%RUN_MODE%"=="dev" if defined TLS_CERT if defined TLS_KEY set "SYNC_TLS=1"
)

if "!SYNC_TLS!"=="1" (
  set "SYNC_SCHEME=https"
  set "WS_SCHEME=wss"
)
exit /b 0

:resolve_tls_files
set "TLS_CERT="
set "TLS_KEY="

if defined AIRQR_TLS_CERT if defined AIRQR_TLS_KEY (
  if exist "%AIRQR_TLS_CERT%" if exist "%AIRQR_TLS_KEY%" (
    set "TLS_CERT=%AIRQR_TLS_CERT%"
    set "TLS_KEY=%AIRQR_TLS_KEY%"
    exit /b 0
  )
)

if exist "%SYNC_DIR%\cert.pem" if exist "%SYNC_DIR%\key.pem" (
  set "TLS_CERT=%SYNC_DIR%\cert.pem"
  set "TLS_KEY=%SYNC_DIR%\key.pem"
  exit /b 0
)

if exist "%ROOT_DIR%localhost+2.pem" if exist "%ROOT_DIR%localhost+2-key.pem" (
  set "TLS_CERT=%ROOT_DIR%localhost+2.pem"
  set "TLS_KEY=%ROOT_DIR%localhost+2-key.pem"
)
exit /b 0

:require_tls_files
if defined TLS_CERT if defined TLS_KEY exit /b 0
echo [ERROR] -https requires a certificate and key.
echo [INFO] Configure AIRQR_TLS_CERT / AIRQR_TLS_KEY in .env, or place cert.pem and key.pem in services\sync-server.
echo [INFO] Example:
echo [INFO]   mkcert -install
echo [INFO]   mkcert -cert-file "%SYNC_DIR%\cert.pem" -key-file "%SYNC_DIR%\key.pem" YOUR_LAN_IP localhost 127.0.0.1 ::1
exit /b 1

:stop_services
call :kill_port %WEB_PORT%
call :kill_port %SYNC_PORT%
if not "%WS_PORT%"=="%SYNC_PORT%" call :kill_port %WS_PORT%
exit /b 0

:load_env
for /f "usebackq tokens=1,* delims==" %%A in ("%~1") do (
  set "ENV_KEY=%%~A"
  set "ENV_VAL=%%~B"
  if defined ENV_KEY if not "!ENV_KEY:~0,1!"=="#" (
    if /I "!ENV_KEY!"=="AIRQR_WEB_PORT" set "AIRQR_WEB_PORT=!ENV_VAL!"
    if /I "!ENV_KEY!"=="AIRQR_SYNC_PORT" set "AIRQR_SYNC_PORT=!ENV_VAL!"
    if /I "!ENV_KEY!"=="AIRQR_WS_PORT" set "AIRQR_WS_PORT=!ENV_VAL!"
    if /I "!ENV_KEY!"=="AIRQR_TLS_CERT" set "AIRQR_TLS_CERT=!ENV_VAL!"
    if /I "!ENV_KEY!"=="AIRQR_TLS_KEY" set "AIRQR_TLS_KEY=!ENV_VAL!"
    if /I "!ENV_KEY!"=="AIRQR_BOOTSTRAP_USERNAME" set "AIRQR_BOOTSTRAP_USERNAME=!ENV_VAL!"
    if /I "!ENV_KEY!"=="AIRQR_BOOTSTRAP_PASSWORD" set "AIRQR_BOOTSTRAP_PASSWORD=!ENV_VAL!"
  )
)
exit /b 0

:kill_port
set "PORT=%~1"
if "!PORT!"=="" exit /b 0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":!PORT! " ^| findstr "LISTENING"') do (
  if not "%%P"=="4" (
    echo [STOP] Killing PID %%P on port !PORT!...
    taskkill /PID %%P /T /F >nul 2>&1
  )
)
exit /b 0
