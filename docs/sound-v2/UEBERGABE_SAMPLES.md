# Übergabe Samples wechseln (Phase 2 und 4) – pausiert, Stand 2026-11-16

Der Sample-Wechsel ist pausiert; als Nächstes wird die App nach JUCE portiert. Referenzstand für die Portierung: Tag `port-base` auf `develop`. Die Einzelschritte stehen auf dem Branch `feat/samples` (Tag `samples-steps`, Branch bleibt). Das Pack-Format beschreibt `docs/PACK_FORMAT.md`; die Messwerte und Urteile je Schritt stehen im Änderungslog von `SOUND_CONTEXT.md` (Einträge „Samples, Schritt …“).

## 1. Stand

| Teil | Stand | Wo |
|---|---|---|
| Pipeline (Import, A/B, Pegel, Prüfung) | fertig, eingecheckt | `scripts/import-sfz.mjs`, `render-full.mjs`, `render-check.mjs`, `style-voices-level.mjs`, `fit-kit.mjs`, `diagnose-kit.mjs`, `pitch-check.mjs`, `pitch-pack.mjs`, `bass-vel.mjs`, `inspect-zones.mjs`, `inspect-region.mjs`, `stereo-width.mjs` |
| Sampler Format 2 (FLAC, Cache API, Round-Robins, Anschlagkurve, Release-Samples, `art`-Zonen, Raum-Mikrofon, Choke-Listen, `stopTime`) | fertig, eingecheckt | `src/audio/voices/sampler.js`, `sample-zones.js`, `sample.js`, `sample-hits.js` |
| **Naked Drums** = Standard- und Rimshot-Kit | freigegeben, eingecheckt, Standard | `src/assets/samples/drums-naked.*` |
| **Muldjord** = zusätzliches „Rock-Kit mit Raum“ | freigegeben, eingecheckt | `src/assets/samples/drums-muldjord.*` |
| **Legacy Drums** = früheres MuseScore-Standard-Kit | auf Wunsch des Nutzers wählbar | Pack `drums-standard` |
| Namensnennung | eingecheckt | `CREDITS.md`, `src/ui/credits.html` (Taste „Credits“ auf der Startseite), `LICENSE-*.md` je Pack |
| **E-Bass** | angefangen, **nicht aktiv** | Code eingecheckt, Packs nur lokal (Abschnitt 3) |

Mit Standardeinstellungen klingt `develop` wie nach dem Drum-Schritt (Render-Vergleich gegen `5fce5bb`, siehe Änderungslog). Der Bass ändert den Standardklang nicht: Finger-, Pick- und Kontrabass spielen weiter die MuseScore-Packs.

## 2. Entscheidungen des Nutzers (gelten weiter)

- FLAC (16 Bit, 44,1 kHz); Cache API, kein Service Worker; Grenzen je Pack 12 MB FLAC und 80 MB dekodiert, Startwahl höchstens 30 MB / 250 MB.
- Schlagzeug mit getrenntem Raum-Mikrofon (`roomMic`); der Raum in den Samples ist gewollt („klingt nach Proberaum, passt zusammen“).
- Stimmen-IDs: gleiche Instrumentenart behält ihre ID, neue Instrumente bekommen neue. Ersetzte MuseScore-Packs fallen nach dem Urteil weg, außer der Nutzer will ein Instrument behalten („Es kommt aufs Instrument an; bei den Instrumenten, die ich behalten will, werde ich dich informieren“); dann bleibt es als „Legacy …“ (wie das Kit).
- IRs (Cab-Impulsantworten) grundsätzlich unterstützen; die IR bleibt eine eigene Datei, die zur Laufzeit gefaltet wird.
- Credits-Seite mit Link auf der Startseite.
- Safari kann der Nutzer nicht testen; das WebKit von Playwright hat unter Windows kein Web Audio. FLAC in Safari ist ungeprüft (für JUCE ohne Belang).

## 3. Angefangener E-Bass

- Rohdaten: `C:\dev\samples-raw\growlybass` (Karoryfer Growlybass) und `C:\dev\samples-raw\fashionbass` (Karoryfer Fashionbass), beide CC0 (LICENSE geprüft).
- Gebaute Packs, **nicht eingecheckt**: `C:\dev\samples-raw\built-packs\` mit `bass-growly.json`, `bass-growly.887823e10a.flac` (5,4 MB, 123 Zonen), `LICENSE-bass-growly.md`, `bass-fashion.json`, `bass-fashion.ff02b5519e.flac` (6,2 MB, 110 Zonen), `LICENSE-bass-fashion.md`. Neu bauen: `node scripts/import-sfz.mjs C:\dev\samples-raw\growlybass bass-growly` bzw. `…\fashionbass bass-fashion` (schreibt nach `src/assets/samples`, dort per `.git/info/exclude` ausgeschlossen).
- Eingecheckter Code dazu: Einträge `bass-growly` und `bass-fashion` in `SFZ_PACKS` (keiner Stimme zugeordnet), `transpose` (Growlybass ist eine Oktave zu hoch gemappt, gemessen), Stufengrenzen als Liste (`select` mit `[[61, 96], 2]`: f und ff des Growlybass als eine Stufe), Sampler-Parameter `stopTime`. **Entwickler-Schalter:** hören nur über `render-full.mjs --pack bass-finger=bass-growly,bass-pick=bass-growly` (dafür das Pack nach `src/assets/samples` kopieren); keine Stimme benutzt die Packs.
- Urteile: erste Probe „Growly klingt an sich schön plucky, aber als wären zwei Instrumente gleichzeitig aufgenommen“ (Ursache gemessen: die Bass-Töne um vel 0,95 lagen genau auf der Grenze zweier Stufen mit verschiedenen Aufnahmen, `bass-vel.mjs`; behoben durch das Zusammenlegen); „Fashion wirkt gut, aber kurze Noten klingen harsch, abgehackt, künstlich“ (ein Drittel der Bass-Töne ist staccato, Fashion hat keine Staccato-Samples, der Sampler schnitt nach 30 ms ab). **Zweite Probe ungehört** (`bass-growly2-*`: Stufen zusammen, Release-Samples an; `bass-fashion2-*`: `stopTime` 0,12 s, Release-Samples an; neu rendern wie oben mit `--tuning`, dafür müssen `stopTime` und `release` als Feinwerte der Stimme eingetragen sein).
- Was fehlt: Zuordnung der Bässe zu `finger` und `pick` (Urteil); Feinwerte `release` und `stopTime` an den Bass-Stimmen (der Test „jeder Feinwert ändert die Ausgabe“ braucht dafür Noten mit Staccato bzw. ein Format-2-Pack); Pegel (mit den alten Werten 1–4 dB leiser, stark vom Stil abhängig; der Regler muss über 8 gehen) und Anschlagkurve für Töne; gedämpfte Saiten des Fashionbass als `dead`; Credits, Tests, A/B, Freigabe. Danach die MuseScore-Bässe löschen, außer der Nutzer will sie behalten.

## 4. Lizenzlage je Library (selbst geprüft, wo nicht anders gesagt)

| Library | Lizenz | Stand |
|---|---|---|
| MuseScore_General (FluidR3 u. a.) | MIT (Urhebervermerke müssen mit) | im Repo, Format 1 |
| FreePats FSBS E-Gitarre | CC0 | im Repo, Format 1 |
| MuldjordKit (Lars Muldjord, SFZ kinwie) | CC-BY 4.0 | im Repo, Credits |
| Naked Drums (Wilkinson Audio, SFZ kinwie) | CC-BY 4.0 | im Repo, Credits |
| Growlybass, Fashionbass, Emilyguitar, Meatbass, D. Smolken Double Bass (Karoryfer) | CC0 | Bässe gebaut, nicht im Repo; Rest nicht geladen |
| Greg Sullivan E-Pianos (Wurlitzer EP200, CP80, Pianet T) | CC-BY 3.0 | geprüft, nicht geladen |
| Salamander Grand Piano | CC-BY 3.0 | geprüft, nicht geladen |
| Splendid Grand Piano (AKAI) | gemeinfrei laut README, keine LICENSE-Datei | fraglich |
| jRhodes3c / jRhodes3d | CC-BY-NC(-SA) | **nicht verwenden** |
| Ovation Guitar, Damien's Funky Guitar | keine Lizenzangabe | **nicht verwenden** |
| Zach Weeks Cab-IRs | CC-BY-SA 4.0 laut Katalog | ungeprüft; nur als eigene Datei verwenden |

## 5. Stolpersteine

- ARIA-Mappings (kinwie): mehrere `#define` je Zeile, längster definierter Name gewinnt; Mikrofon-Pegel und Panorama an Controller-Startwerten mit Kurven (Naked: Hi-Hat- und Ride-Mikrofon absichtlich auf 0,1); `phase=invert` am unteren Snare-Mikrofon; Choke-Gruppen je Mikrofon eigens nummeriert, bei Naked über stumme Regionen (`sample=*silence`); Trigger-Kanal im Standard-Mix (Muldjord, weggelassen); Panorama aus Sicht des Schlagzeugers (gespiegelt); Naked nennt Mid-Side bei Trommeln `MS_`, bei Becken `MidSide_`; Naked nutzt `Data/keymap.txt`, nicht die GM-Belegung.
- Karoryfer: Mappings können um eine Oktave verschoben sein (Growlybass); vier Anschlagstufen mit hörbar verschiedenen Aufnahmen; liegt das Spiel auf einer Stufengrenze, wechselt der Klang zufällig.
- Pegel: der Begrenzer frisst Anhebungen; nach jeder `level`-Änderung neu messen. `trimDb` kann den Pack-Faktor ändern. Neue Packs immer im ganzen Mix angleichen, sonst „geht das Instrument unter“ (erste Muldjord-Probe).
- Die Crashs aller Kits sind auf ±3 dB gleich laut (Test); Kits mit Becken nur über Overheads brauchen `trimDb.crash`.
- `render-full.mjs --pack` lenkt nur das Pack um, die Feinwerte bleiben die der alten Stimme; für registrierte Stimmen `--voice`. Fehlt ein Pack, bricht das Skript ab.
- Der Offline-Render ist nicht bitgenau wiederholbar (bis −85 dB); `render-check.mjs` vergleicht mit 2e-4.
- Git Bash: keine langen Heredocs mit Backslashes oder Template-Strings zum Bearbeiten von Dateien (zweimal gescheitert); `git mv -k` auf nicht verfolgte Dateien tut nichts.
- Zwei Playwright-Läufe direkt hintereinander scheitern manchmal mit „connection refused“: wiederholen. Hintergrundläufe überleben keinen Neustart.

## 6. Nach der Pause

1. Bass: zweite Probe hören lassen, Zuordnung `finger`/`pick`, Feinwerte, Freigabe (Abschnitt 3).
2. E-Gitarre DI (Emilyguitar, CC0) mit IR-Faltung; Keys (Wurlitzer, Klavier, neue IDs); Kontrabass (Meatbass oder D. Smolken); Akustikgitarre (Lizenzlage dünn, FreePats prüfen); Lead.
3. In der JUCE-Version: Packs nach `docs/PACK_FORMAT.md` lesen; Format 1 wird gebraucht, solange MuseScore-Packs aktiv sind; Namensnennung (CC-BY) auch in der nativen App.
4. Arbeitsregeln des Auftrags gelten weiter: nur weitergebbare Lizenzen, Rohdaten nach `C:\dev\samples-raw\`, Packs erst nach Freigabe einchecken, A/B ganzer Songs mit gleicher Lautheit, ein Schritt pro Commit mit `npm test` und `npx playwright test`, höchstens 10 Zeilen Bericht, dann STOPP.
