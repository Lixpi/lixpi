:: Shared ".env.* picker" subroutine used by start.bat and set-env.bat.
:: Call it (not run it directly) from a script that already has
:: `setlocal enabledelayedexpansion` active:
::
::   call "%~dp0scripts\partials\select-env-file.bat" :select_env_file
::   if errorlevel 1 exit /b 1
::   echo Using: %selected_env%
::
:: Leaves the chosen filename in %selected_env% and returns 0, or prints an
:: error and returns 1 if no .env.* files exist.

:select_env_file
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

:select_env_file_prompt
set /p selection="Select environment file [1-%count%]: "
if "%selection%"=="" goto select_env_file_prompt
set /a check=%selection% 2>nul
if %check% lss 1 goto select_env_file_invalid
if %check% gtr %count% goto select_env_file_invalid
goto select_env_file_valid

:select_env_file_invalid
echo Invalid selection. Please enter a number between 1 and %count%.
goto select_env_file_prompt

:select_env_file_valid
set "selected_env=!env[%selection%]!"
exit /b 0
