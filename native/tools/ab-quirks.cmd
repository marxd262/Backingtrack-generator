@echo off
rem A/B set for one decision: the core with the ways Chromium starts a tone inside its blocks of 128 frames (<name>-mit.wav, today's sound,
rem the web app's) and without them (<name>-ohne.wav): oscillators (the e-piano's first block, the phase advance between frames) and noise
rem hits and the string voices read between frames, then both in two whole bands as the app plays them; LIESMICH.txt and the page say what
rem each pair shows, with the figures. One step: builds the core if a tool is missing, renders, serves the A/B page. ab-quirks.mjs stops
rem with a message when a tool is older than its sources (then native\build.ps1 -NoApp) or when a switch did nothing.
cd /d "%~dp0..\.."
if not exist native\build\core\Release\btg_render.exe powershell -NoProfile -ExecutionPolicy Bypass -File native\build.ps1 -NoApp
if not exist native\build\core\Release\btg_fx.exe powershell -NoProfile -ExecutionPolicy Bypass -File native\build.ps1 -NoApp
node native\tools\ab-quirks.mjs .superpowers\audio-ab\quirks
if errorlevel 1 pause & exit /b 1
node native\tools\ab-page.mjs --serve .superpowers\audio-ab\quirks
