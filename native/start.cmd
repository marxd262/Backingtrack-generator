@echo off
rem Double-click: builds what changed, runs the tests, starts the app.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" -Run || pause
