@echo off
rem Double-click to download the latest version of the editor from GitHub.
rem Keep this file ASCII-only: the messages are printed by scripts\update.mjs.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22.13 or later from https://nodejs.org
  pause
  exit /b 1
)
node "%~dp0scripts\update.mjs"
pause
