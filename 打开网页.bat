@echo off
cd /d "%~dp0"
echo NovellaArena  http://127.0.0.1:8765/
echo Close this window to stop the server.
start "" /b cmd /c "timeout /t 1 /nobreak >nul & start http://127.0.0.1:8765/"
py -3 -m http.server 8765
if errorlevel 1 python -m http.server 8765
if errorlevel 1 (
  echo Python was not found.
  pause
)
