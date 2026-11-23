@echo off
rem Double-click: builds what changed and runs all tests of native/ (several minutes). It does not start the app: start.cmd does that.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
pause
