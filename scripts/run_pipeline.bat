@echo off
rem S:\10_CodeBase\02_Websites\NoteAuto\run_pipeline.bat
rem This batch script starts the backend server in background, runs python CLI pipeline, and kills the server on exit.

echo Starting NoteAuto backend server in background...
start /b node server.js > server_silent.log 2>&1

rem Give the server 3 seconds to spin up
timeout /t 3 /nobreak > nul

echo.
echo Launching NoteAuto Python CLI Pipeline...
python pipeline.py

echo.
echo Stopping NoteAuto backend server...
taskkill /f /im node.exe > nul 2>&1
echo Done.
pause
