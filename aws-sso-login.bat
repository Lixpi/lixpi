@echo off
setlocal enabledelayedexpansion

:: Signs in to AWS SSO for a chosen .env.* stage. Run from the repo root: aws-sso-login.bat
::
:: The login runs inside the lixpi-pulumi container because that's the only
:: container with the AWS CLI. The SSO token cache lands in the shared aws-config
:: volume mounted at /root/.aws, so every other container (api, nex, web-ui)
:: picks up the refreshed credentials without logging in again.
::
:: Device-code flow is used because the container has no browser: the CLI prints
:: a URL and a code, and you approve it in the browser on your host.

call "%~dp0scripts\partials\select-env-file.bat" :select_env_file
if errorlevel 1 exit /b 1

echo.
echo Using: %selected_env%
echo.

set "aws_profile="
for /f "usebackq tokens=1,* delims==" %%a in ("%selected_env%") do (
    if /i "%%a"=="AWS_PROFILE" set "aws_profile=%%b"
)

:: Strip surrounding quotes and trailing whitespace the env file may carry.
set "aws_profile=%aws_profile:"=%"
set "aws_profile=%aws_profile:'=%"
for /l %%i in (1,1,32) do if "!aws_profile:~-1!"==" " set "aws_profile=!aws_profile:~0,-1!"

if "%aws_profile%"=="" (
    echo AWS_PROFILE is not set in %selected_env%.
    echo Add it, or re-run the setup wizard to configure an AWS SSO profile.
    exit /b 1
)

if not exist ".aws\config" (
    echo No .aws\config found in the repo root.
    echo Copy .aws\config.example and fill in your sso-session and profiles first.
    exit /b 1
)

echo Signing in to AWS SSO as profile '%aws_profile%'...
echo A URL and a verification code will be printed below. Open the URL on this machine and approve the code.
echo.

docker compose --env-file "%selected_env%" --profile deploy run --rm --no-deps lixpi-pulumi -c "aws sso login --profile '%aws_profile%' --use-device-code"
if errorlevel 1 (
    echo.
    echo AWS SSO login failed.
    exit /b 1
)

echo.
echo Signed in as '%aws_profile%'. The token is cached in the shared aws-config volume.
echo.
echo Restart running containers to pick up the refreshed credentials.
