@echo off
rem A/B set for listening: the tonewheel organ on the chords alone (the four presets in a verse and a chorus, the Leslie off, slow and fast,
rem drive 0 and 1, no swell, no click, no percussion, and behind the chords' chorus, distortion and vibrato, dry); per case the web app
rem (<name>-web.wav) and the core (<name>-nativ.wav). One step: builds the core if btg_render is missing, renders, serves the A/B page.
cd /d "%~dp0..\.."
if not exist native\build\core\Release\btg_render.exe powershell -NoProfile -ExecutionPolicy Bypass -File native\build.ps1 -NoApp
node native\tools\sound-compare.mjs native\tools\sound-cases\organ.json .superpowers\audio-ab\organ
node native\tools\ab-page.mjs --serve .superpowers\audio-ab\organ
