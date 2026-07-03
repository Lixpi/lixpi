@echo off
setlocal enabledelayedexpansion

:: Run from the repo root: start.bat

call "%~dp0scripts\partials\select-env-file.bat" :select_env_file
if errorlevel 1 exit /b 1

echo.
echo Using: %selected_env%
echo.

:: Start the application
echo Starting application...
docker-compose --env-file "%selected_env%" --profile main up
