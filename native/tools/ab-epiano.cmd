@echo off
rem A/B set for listening: the FM e-piano on the chords alone (neutral, brightness, length and tremolo at their ends, dry); per case the
rem web app (<name>-web.wav) and the core (<name>-nativ.wav). One step: builds the core if btg_render is missing, renders, serves the A/B page.
cd /d "%~dp0..\.."
if not exist native\build\core\Release\btg_render.exe powershell -NoProfile -ExecutionPolicy Bypass -File native\build.ps1 -NoApp
node native\tools\sound-compare.mjs native\tools\sound-cases\epiano.json .superpowers\audio-ab\epiano
node native\tools\ab-page.mjs --serve .superpowers\audio-ab\epiano
