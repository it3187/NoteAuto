@echo off
REM NoteAuto Dev Server Launcher
REM Starts backend (Express) + frontend (Vite) concurrently

cd /d "S:\10_CodeBase\02_Websites\NoteAuto"

REM Kill any zombie chrome processes that may lock the profile
taskkill /F /IM chrome.exe >nul 2>&1

REM Clean stale profile locks
del /f /q "data\chrome_profile\SingletonLock" >nul 2>&1
del /f /q "data\chrome_profile\SingletonSocket" >nul 2>&1
del /f /q "data\chrome_profile\SingletonCookie" >nul 2>&1

REM Start dev server
npm run dev
