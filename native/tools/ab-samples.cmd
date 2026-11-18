@echo off
rem A/B set for listening: one track per style, all six layers, dry; per style the web app (<name>-web.wav) and the core (<name>-nativ.wav).
rem One step: builds the core if btg_render is missing, renders, opens the A/B page (index.html, written by sound-compare.mjs).
cd /d "%~dp0..\.."
if not exist native\build\core\Release\btg_render.exe powershell -NoProfile -ExecutionPolicy Bypass -File native\build.ps1 -NoApp
node native\tools\sound-compare.mjs native\tools\sound-cases\band.json .superpowers\audio-ab\samples
start "" ".superpowers\audio-ab\samples\index.html"
