@echo off
rem A/B set for listening: one track per style, all six layers, with reverb, room, echo and the sum (glue and limiter), and the funk band at 20 and 400 bpm;
rem per case the web app (<name>-web.wav) and the core (<name>-nativ.wav). One step: builds the core if btg_render is missing, renders, serves the
rem A/B page (ab-page.mjs) on 127.0.0.1 and opens the browser; Ctrl+C or closing the window stops it.
cd /d "%~dp0..\.."
if not exist native\build\core\Release\btg_render.exe powershell -NoProfile -ExecutionPolicy Bypass -File native\build.ps1 -NoApp
node native\tools\sound-compare.mjs native\tools\sound-cases\mix.json .superpowers\audio-ab\mix
node native\tools\ab-page.mjs --serve .superpowers\audio-ab\mix
