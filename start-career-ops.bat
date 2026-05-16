@echo off
REM start-career-ops.bat - double-clickable launcher for Windows
REM
REM Double-click this file in File Explorer. A terminal opens in this
REM repo's folder and starts Claude Code with career-ops loaded.

setlocal
cd /d "%~dp0"

cls
echo career-ops
echo ==========
echo Folder: %CD%
echo.

where claude >nul 2>&1
if errorlevel 1 (
    echo Claude Code is not installed ^(no "claude" command found on PATH^).
    echo.
    echo Install it from: https://docs.claude.com/claude-code
    echo.
    echo After install, close and re-open this launcher.
    echo.
    pause
    exit /b 1
)

if not exist "cv.md" goto :firstrun
if not exist "config\profile.yml" goto :firstrun
goto :launch

:firstrun
echo Looks like this is your first session ^(cv.md or profile.yml missing^).
echo Running setup first...
echo.
powershell -ExecutionPolicy Bypass -File bootstrap.ps1
echo.
echo Now launching Claude Code. When it opens, say:
echo   "I'm new to career-ops. Walk me through setup using AGENTS.md."
echo.
pause

:launch
claude
