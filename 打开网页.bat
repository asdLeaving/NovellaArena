@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if not errorlevel 1 (
  py -3 -c "import http.server" >nul 2>&1
  if not errorlevel 1 (
    py -3 tools\serve.py --open
    goto :done
  )
)
where python >nul 2>&1
if not errorlevel 1 (
  python -c "import http.server" >nul 2>&1
  if not errorlevel 1 (
    python tools\serve.py --open
    goto :done
  )
)
set "ARENA_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%ARENA_PYTHON%" (
  "%ARENA_PYTHON%" tools\serve.py --open
  goto :done
)
echo Python 3 is required to preview this folder locally.
pause
exit /b 1
:done
if errorlevel 1 pause
