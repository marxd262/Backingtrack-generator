@echo off
rem A/B set for listening: the string model on the bass and on the chords alone (neutral, and each knob of the voice at its ends: bass sub and
rem roundness at 0.5 and 1, pluck and cutoff, chords brightness and length at 0 and 1, dry); per case the web app (<name>-web.wav) and the core
rem (<name>-nativ.wav). One step: builds the core if btg_render is missing, renders, serves the A/B page.
cd /d "%~dp0..\.."
if not exist native\build\core\Release\btg_render.exe powershell -NoProfile -ExecutionPolicy Bypass -File native\build.ps1 -NoApp
node native\tools\sound-compare.mjs native\tools\sound-cases\string.json .superpowers\audio-ab\string
node native\tools\ab-page.mjs --serve .superpowers\audio-ab\string
