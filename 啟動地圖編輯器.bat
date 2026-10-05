@echo off
rem Double-click to start the map editor. Drag a project folder onto this file to open that project.
rem Keep this file ASCII-only: the messages are printed by scripts\launch-editor.mjs.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22.13 or later from https://nodejs.org
  pause
  exit /b 1
)
node "%~dp0scripts\launch-editor.mjs" %*
if errorlevel 1 pause
