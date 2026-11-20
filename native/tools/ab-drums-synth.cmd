@echo off
rem A/B set for listening: the synth kit and the synth percussion, each alone, dry: the kit in a verse, a fill into a crashed chorus and a
rem stop, at the neutral sound and each of its six knobs at 0 and 1; the percussion mixed, and its bongos, claves and cowbell; per case the
rem web app (<name>-web.wav) and the core (<name>-nativ.wav). One step: builds the core if btg_render is missing, renders, serves the A/B page.
cd /d "%~dp0..\.."
if not exist native\build\core\Release\btg_render.exe powershell -NoProfile -ExecutionPolicy Bypass -File native\build.ps1 -NoApp
node native\tools\sound-compare.mjs native\tools\sound-cases\kits-synth.json .superpowers\audio-ab\drums-synth
node native\tools\ab-page.mjs --serve .superpowers\audio-ab\drums-synth
