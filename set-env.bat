@echo off
setlocal enabledelayedexpansion

:: Points the .env symlink at a chosen .env.* file, so Docker Compose
:: (which only auto-loads a file literally named .env) picks it up without
:: needing --env-file passed explicitly. Run from the repo root: set-env.bat
::
:: Safe to run repeatedly: if .env already exists as a symlink (created by
:: a previous run of this script), it's replaced with no conflict. If .env
:: exists as a real file (not a symlink), this refuses to touch it.
::
:: Creating a symlink on Windows requires either Developer Mode enabled
:: (Windows 10+, Settings > Update & Security > For developers) or running
:: this script as Administrator.

call "%~dp0scripts\partials\select-env-file.bat" :select_env_file
if errorlevel 1 exit /b 1

echo.
echo Using: %selected_env%
echo.

if exist ".env" (
    dir /a:l ".env" >nul 2>&1
    if errorlevel 1 (
        echo .env already exists and is not a symlink created by this script.
        echo Remove or rename it manually, then re-run this script.
        exit /b 1
    )
    del ".env"
)

mklink ".env" "%selected_env%" >nul
if errorlevel 1 (
    echo Failed to create symlink. On Windows, creating symlinks requires
    echo either Developer Mode enabled or running this script as Administrator.
    exit /b 1
)

echo .env -^> %selected_env%
