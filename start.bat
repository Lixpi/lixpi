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
    echo Run the setup wizard first to create one.
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

:: Start the application
echo Starting application...
docker-compose --env-file "%selected_env%" --profile main up
