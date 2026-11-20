@echo off
rem A/B set for listening: the classic synth on bass, chords, pad and lead, each layer alone, dry: neutral, and each knob of its voice at
rem 0 and 1 (a knob whose neutral value is 0, bass sub and roundness, chords chorus and tremolo, pad shimmer: at 0.5 and 1); and the nine bands
rem with every layer on its synth voice, dry (Task 23); per case the web app (<name>-web.wav) and the core (<name>-nativ.wav). One step: builds
rem the core if btg_render is missing, renders, serves the A/B page.
cd /d "%~dp0..\.."
if not exist native\build\core\Release\btg_render.exe powershell -NoProfile -ExecutionPolicy Bypass -File native\build.ps1 -NoApp
node native\tools\sound-compare.mjs native\tools\sound-cases\classic.json .superpowers\audio-ab\synth
node native\tools\sound-compare.mjs native\tools\sound-cases\band-synth.json .superpowers\audio-ab\synth
node native\tools\ab-page.mjs --serve .superpowers\audio-ab\synth
