# Übergabe Samples wechseln (Phase 2 und 4), Stand 2026-11-16

Auftrag: MuseScore_General schrittweise durch weitergebbare Sample-Libraries ersetzen, Klangbild „kleine Band im Raum“. Der Auftragstext des Nutzers liegt nicht im Repo; die Regeln stehen unten in Abschnitt 6. Zuerst lesen: dieses Dokument, dann `SPEC_PHASE2.md`, `SAMPLE_SOURCES.md`, das Änderungslog in `SOUND_CONTEXT.md` (Einträge „Samples, Schritt …“), `docs/interface.md` (Absatz „Format 2“), `CREDITS.md`.

## 1. Stand

- Branch `feat/samples` (von `develop`), **nicht gepusht**. Commits: `28602b8` Schritt 1 (Importer `scripts/import-sfz.mjs`, Format 2 im Sampler, Tests, Werkzeuge), `397df30` Schritt 2 (Muldjord als zusätzliches Kit `drums/sample/muldjord`, Feinwerte `velCurve`/`roomMic`/`kitPan`, `CREDITS.md`, Credits-Seite `src/ui/credits.html` mit Taste in der Kopfleiste der Startseite).
- **Schritt 3 freigegeben (2026-11-16): Naked Drums ist das Standard-Kit** (Stimmen-ID `drums/sample/standard` bleibt; auch das Rimshot-Kit spielt es, mit dem Side-Stick als Snare). Auf Wunsch des Nutzers bleibt das alte MuseScore-Kit als **Legacy Drums** (`drums/sample/legacy`, Pack `drums-standard`, wird **nicht** gelöscht). Geändert: `pack-id.js` (`drums-standard` und `drums-rimshot` → `drums-naked`), `tunables.js` (`kitV2(level, velCurve)` für alle Format-2-Kits; Standard und Rimshot `level` 2,5, `velCurve` 0,5), `sample-hits.js` (Rimshot-Übersetzung für Format 2; Choke als Liste `chokes`), `scripts/import-sfz.mjs` (Eintrag `drums-naked`; stumme Regionen zählen für Choke; `chokes` statt `group`; Lizenztext mit LF), `CREDITS.md` und `credits.html` (Naked), Tests (`import-sfz`, `voices-impl`, `voices-sample-sound`: Referenz des alten Standard-Kits entfernt), Test-Packs neu (`chokes`), `drums-muldjord.json` neu gebaut (nur `chokes` statt `group`, Audio gleich).
- Naked ist eingecheckt (`drums-naked.json`, `.flac`, `LICENSE-drums-naked.md`). Neu bauen: `node scripts/import-sfz.mjs C:\dev\samples-raw\naked-drums drums-naked`.
- Außerhalb des Repos: Rohdaten `C:\dev\samples-raw\muldjord` und `C:\dev\samples-raw\naked-drums` (git clones von `sfzinstruments/…`); Arbeitsbaum `../bt-develop` (`git worktree add --detach ../bt-develop develop`) als Seite A aller A/B-Proben und für `render-check.mjs`.
- Tests zuletzt (2026-11-16, mit Naked und Legacy Drums): siehe Commit-Nachricht des Schritts 3.

## 2. Entscheidungen des Nutzers

- Format FLAC (16 Bit, 44,1 kHz). Safari kann der Nutzer nicht testen; das Playwright-WebKit unter Windows hat **kein Web Audio** (Tests werden dort übersprungen). Safari bleibt ungeprüft.
- Cache API in `loadPack`, kein Service Worker. Grenzen je Pack 12 MB FLAC und 80 MB dekodiert; Startwahl höchstens 30 MB / 250 MB.
- Schlagzeug „doppelt“: Direkt und Raum als getrennte Stereo-Samples (Feinwert `roomMic`).
- Muldjord als **zusätzliches** Kit; freigegeben 2026-11-16 („im Live-Hören klingt es gut, im richtigen Tool passt es“). Der Raum in den Samples ist gewollt („klingt nach Proberaum, passt zusammen“).
- Stimmen-IDs: gleiche Instrumentenart behält ihre ID, neue Instrumente bekommen neue IDs (von mir entschieden, Nutzer: „du bist da frei“).
- „Die alten Packs können raus“: gelesen als „ein ersetztes Pack wird nach dem A/B-Urteil gelöscht, kein Entwickler-Schalter“. Die Rückfrage, ob alle MuseScore-Packs sofort raus sollen, ist unbeantwortet; bis dahin nur ersetzte Packs löschen.
- IRs (Cab-Impulsantworten) grundsätzlich unterstützen; die IR bleibt eine eigene Datei und wird zur Laufzeit gefaltet (dann betrifft CC-BY-SA nur die IR-Datei). Lizenz von Zach Weeks noch selbst prüfen.
- Namensnennung: Credits-Seite mit Link auf der Startseite (gebaut, Taste „Credits“ in der Kopfleiste) und `CREDITS.md`; `tests/core/credits.test.js` verlangt zu jeder `LICENSE-*.md` einen Eintrag in beiden.
- Reihenfolge: Drums (Muldjord, Naked), dann E-Bass (Growlybass oder Fashionbass; welche ID, nach rohen Hörproben), E-Gitarre DI (Emily) mit Box/IR, Keys (Wurlitzer und Klavier mit neuen IDs), Kontrabass, Akustikgitarre, Lead.

## 3. Naked Drums (Schritt 3)

- Pack `drums-naked`: 13 Schläge (Kick, Snare 1, Side-Stick, Hi-Hat geschlossen/halboffen/offen/getreten, Toms 10"/13"/16", Crash 1, Ride mit Glocke), 90 Zonen, 180 Samples (Direkt = Direktmikrofone, Overheads, China/Wide OH; Raum = Close Room, Far Rooms, Mid-Side), 200,8 s stereo, 11,55 MB FLAC, dekodiert etwa 71 MB. Gespiegelt (Mapping aus Sicht des Schlagzeugers). Crash +6 dB (lag 6,2 dB unter den anderen Kits). Kein Rimshot im Kit (fällt auf die Snare zurück).
- Choke aus dem Mapping (über stumme Regionen): geschlossene Hi-Hat würgt halboffene und offene ab, halboffene die offene, das Pedal alle drei.
- Gemessen: mit `level` 1,2 allein 4,7–6,8 dB unter dem MuseScore-Kit; mit 2,4 noch 0,0–1,1 dB darunter, darum 2,5. `velCurve` 0,5: Pegel bei vel 0,2–0,8 im Mittel 1,5 dB vom MuseScore-Kit (mit 1: 6,4 dB; `node .superpowers/fit-kit.mjs drums-naked`).
- Hörprobe (A = MuseScore-Standard-Kit aus `../bt-develop`, B = Naked): `naked-solo`, `naked-full`. Urteil 2026-11-16: „das alte finde ich gar nicht schlecht im Vergleich; lass das alte als Legacy Drums in der Liste“ → Naked Standard, MuseScore-Kit als Legacy Drums.
- Ungehört: `hatHalf` und `hatPedal` klingen mit diesem Kit zum ersten Mal echt; die Phase-3-Regeln setzen sie (Rock-Refrain bleibt geschlossen, Urteil 2026-11-14).

## 4. Budget

| Pack | FLAC | dekodiert | Status |
|---|---|---|---|
| drums-muldjord (86 Zonen, 175 s stereo) | 8,6 MB | ≈ 62 MB | eingecheckt |
| drums-naked (90 Zonen, 201 s stereo) | 11,6 MB | ≈ 71 MB | eingecheckt |

MuseScore-Packs: 24 Packs, 46 MB (`drums-standard` bleibt als Legacy Drums). Startwahl (Funk) mit Naked: etwa 11,6 + 1,3 + 2,8 + 2,8 + 0,6 + 0,3 ≈ 19 MB.

## 5. Nächste Schritte

1. E-Bass: Growlybass (`sfzinstruments/karoryfer.growlybass`, CC0, Staccato- und Release-Samples) und Fashionbass (CC0, gedämpfte Töne je Saite als `dead`); rohe Hörproben, dann entscheidet der Nutzer, welche ID (`finger` oder `pick`) ersetzt wird. Growlybass legt die tiefe E-Saite vermutlich eine Oktave über den Klang (Taste 40 wie bei der Gitarre): Grundton messen. Der Importer für Töne (`keys`, `releases`, `art`) ist nur mit Testdaten geprüft.
2. E-Gitarre Emily mit IR (Faltung hinter der Stimme), Keys, Kontrabass, Akustik, Lead.
3. Nach dem Urteil zu Naked: ersetzte MuseScore-Stimmen könnten wie das Kit als „Legacy“ bleiben statt gelöscht zu werden; vor dem nächsten Ersatz kurz fragen.

## 6. Arbeitsregeln (aus dem Auftrag)

- Nur Lizenzen mit erlaubter Weitergabe (CC0, PD, MIT, CC-BY, CC-BY-SA mit Bedacht; kein NC, kein GPL bei Samples, nichts ohne klare Lizenz). LICENSE-Datei jeder Library selbst prüfen. Je Pack `LICENSE-<id>.md` (schreibt der Importer) und ein Eintrag in `CREDITS.md` und `credits.html`.
- Rohdateien nach `C:\dev\samples-raw\<library>\`, nie ins Repo. Packs erst nach Freigabe einchecken, bis dahin `.git/info/exclude`. Kein Git LFS. Pages höchstens 1 GB.
- MuseScore nicht entfernen, solange nicht alle Instrumente ersetzt und freigegeben sind (Phase 5); ersetzte Packs fallen nach ihrem Urteil weg (siehe 2).
- A/B je Schritt: ganze Tracks mit Songform, stereo, A = alt (Arbeitsbaum `../bt-develop`), B = neu, gleiche Lautheit (`render-full.mjs` gleicht an), im Einzelinstrument (`--solo`) und im ganzen Track.
- Synth-Stimmen und UI nicht ändern, außer der minimalen Anbindung neuer Stimmen.
- Ein Schritt pro Commit; vor jedem Commit `npm test` und `npx playwright test --reporter=dot`, Ausgabe in eine Datei, Exit-Code ausgeben. Nach jedem Schritt höchstens 10 Zeilen Bericht (was, worauf hören, Pegel/Größe vorher/nachher, Pfade), dann STOPP. Zweimal am selben Problem gescheitert: stoppen, Optionen nennen. Nicht pushen ohne OK. Antworten Deutsch, Commits Englisch.
- Weiter gelten aus `FABLE_PHASE1.md`: „Du kannst nicht hören“ (Messwerte, Urteil des Nutzers), „Regeln gegen Leerlauf“.

## 7. Stolpersteine

- Dateien mit Backslashes oder Template-Strings nicht über `node - <<'EOF'`-Heredocs bearbeiten (zweimal gescheitert): Edit-Werkzeug nehmen.
- `git mv -k` auf eine nicht verfolgte Datei tut nichts und meldet keinen Fehler: `mv`.
- Der Begrenzer frisst Pegel: nach jeder `level`-Änderung neu messen. `trimDb` kann den Pack-Faktor ändern (die Ausgabe nennt ihn), dann `level` nachziehen.
- `render-full.mjs --pack` lenkt nur das Pack um, Feinwerte bleiben die der alten Stimme; für registrierte Stimmen `--voice`. Fehlt ein Pack, bricht das Skript ab.
- ARIA-Mappings: mehrere `#define` je Zeile, längster Präfix gewinnt; Mikrofon-Pegel an Controller-Startwerten mit Kurven (Naked: Hi-Hat- und Ride-Mikrofon absichtlich auf 0,1); `phase=invert`; Choke-Gruppen je Mikrofon eigens nummeriert und teils über stumme Regionen (`sample=*silence`); Trigger-Kanal im Standard-Mix (Muldjord, weggelassen); Panorama aus Sicht des Schlagzeugers (gespiegelt); Naked nennt das Mid-Side-Mikrofon bei Trommeln `MS_`, bei Becken `MidSide_`; die Hauptdatei nutzt `Data/keymap.txt`, nicht die GM-Belegung.
- Der Offline-Render ist nicht bitgenau wiederholbar (bis −85 dB); `render-check.mjs` vergleicht mit 2e-4.
- Zwei Playwright-Läufe direkt hintereinander scheitern manchmal mit „connection refused“: wiederholen. Hintergrundläufe überleben keinen Neustart.
