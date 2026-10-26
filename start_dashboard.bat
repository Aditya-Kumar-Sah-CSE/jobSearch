@echo off
title JobHunt AI Dashboard
cd /d "%~dp0"

echo ========================================================
echo   Starting JobHunt AI Web Dashboard...
echo ========================================================

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" server.py
) else (
    python server.py
)

pause
