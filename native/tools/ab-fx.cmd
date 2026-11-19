@echo off
rem A/B set for listening: the layer effects one by one (distortion stages, vibrato, chorus, the psych band dry); per case the web app
rem (<name>-web.wav) and the core (<name>-nativ.wav). One step: builds the core if btg_render is missing, renders, serves the A/B page.
cd /d "%~dp0..\.."
if not exist native\build\core\Release\btg_render.exe powershell -NoProfile -ExecutionPolicy Bypass -File native\build.ps1 -NoApp
node native\tools\sound-compare.mjs native\tools\sound-cases\fx.json .superpowers\audio-ab\fx
node native\tools\sound-compare.mjs native\tools\sound-cases\mod.json .superpowers\audio-ab\fx
node native\tools\ab-page.mjs --serve .superpowers\audio-ab\fx
