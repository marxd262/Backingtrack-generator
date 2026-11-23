@echo off
rem Double-click: builds what changed and starts the app. It runs no tests: run_tests.cmd does that.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" -Run -NoTests || pause
