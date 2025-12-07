@echo off
setlocal enabledelayedexpansion

:: Find all .env files
set count=0
for %%f in (.env.*) do (
    set /a count+=1
    set "env[!count!]=%%f"
)

if %count%==0 (
    echo No .env files found in the current directory.
    echo Run init-config first to create one.
    exit /b 1
)

echo Available environment files:
for /l %%i in (1,1,%count%) do (
    echo   %%i. !env[%%i]!
)
echo.

:: Ask user to select an env file
:select
set /p selection="Select environment file [1-%count%]: "
if "%selection%"=="" goto select
set /a check=%selection% 2>nul
if %check% lss 1 goto invalid
if %check% gtr %count% goto invalid
goto valid

:invalid
echo Invalid selection. Please enter a number between 1 and %count%.
goto select

:valid
set "selected_env=!env[%selection%]!"
echo.
echo Using: %selected_env%
echo.

:: Start Caddy to generate certificates
echo Starting Caddy to generate TLS certificates...
docker-compose --env-file "%selected_env%" up -d lixpi-caddy

:: Wait for certificates to be generated
echo Waiting for certificates to be generated...
timeout /t 5 /nobreak >nul

:wait_cert
docker run --rm -v lixpi-lists_caddy-certs:/certs busybox test -f /certs/ca.crt 2>nul
if errorlevel 1 (
    echo Waiting for CA certificate...
    timeout /t 2 /nobreak >nul
    goto wait_cert
)

echo Certificates generated successfully!
echo.

:: Extract CA certificate
echo Extracting CA certificate...
docker run --rm -v lixpi-lists_caddy-certs:/certs busybox cat /certs/ca.crt > ca.crt

:: Install certificate on Windows
echo Installing CA certificate on Windows...
echo This requires administrator privileges.
certutil -addstore -f "ROOT" ca.crt
if errorlevel 1 (
    echo Failed to install certificate.
    echo Please run this script as Administrator.
    exit /b 1
)
echo Certificate installed successfully on Windows
echo.

:: Stop Caddy
echo Stopping Caddy...
docker-compose --env-file "%selected_env%" down

echo.

:: Initialize DynamoDB tables
echo Initializing DynamoDB tables...

:: Start DynamoDB first and wait for it to be healthy
docker-compose --env-file "%selected_env%" up -d lixpi-dynamodb
echo Waiting for DynamoDB to be ready...

:wait_dynamodb
docker inspect lixpi-dynamodb --format="{{.State.Health.Status}}" 2>nul | findstr /C:"healthy" >nul
if errorlevel 1 (
    echo Waiting for DynamoDB...
    timeout /t 2 /nobreak >nul
    goto wait_dynamodb
)
echo DynamoDB is ready!

:: Run pulumi-init and wait for it to complete
docker-compose --env-file "%selected_env%" up lixpi-pulumi-init
set init_exit_code=%errorlevel%

:: Stop DynamoDB
docker-compose --env-file "%selected_env%" down

if %init_exit_code% neq 0 (
    echo Database initialization failed.
    exit /b 1
)

echo.
echo Infrastructure initialization complete!
echo.
echo You can now start the application with: start.bat
