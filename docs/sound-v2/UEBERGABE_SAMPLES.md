# Übergabe Samples wechseln (Phase 2 und 4), Stand 2026-11-16

Auftrag: MuseScore_General schrittweise durch weitergebbare Sample-Libraries ersetzen, Klangbild „kleine Band im Raum“. Der Auftragstext des Nutzers (Regeln, Schritte 0 bis n) liegt nicht im Repo; die Regeln stehen unten in Abschnitt 6. Zuerst lesen: dieses Dokument, dann `SPEC_PHASE2.md`, `SAMPLE_SOURCES.md`, das Änderungslog in `SOUND_CONTEXT.md` (letzter Eintrag „Samples, Schritt 1“), `docs/interface.md` (Absatz „Format 2“).

## 1. Stand

- Branch `feat/samples` (von `develop`), **nicht gepusht**. Committet: `28602b8` (Schritt 1: Importer `scripts/import-sfz.mjs`, Format 2 im Sampler, Tests, Werkzeuge).
- **Muldjord freigegeben und eingecheckt (2026-11-16)** samt Stimme, `CREDITS.md` und Credits-Seite; der folgende Punkt beschreibt, was damals dazugehörte: Muldjord als Stimme `drums/sample/muldjord` und alles dazu. Geänderte Dateien: `src/core/voices.js` (Variante), `src/audio/voices/index.js` (`kits(…, 'muldjord')`), `tunables.js` (`drums/sample/muldjord`), `src/i18n/de.js`/`en.js` (Name), `src/audio/synth.js` (Feinwert `kitPan`: 0 schaltet die Lage je Schlag ab, fehlt = an), `sample-hits.js` (Feinwert `velCurve`), `scripts/import-sfz.mjs` (`trimDb`), `scripts/render-full.mjs` (`--voice`, `--tuning`, Abbruch bei nicht geladenem Pack), Tests (`voices-impl`, `voices-sample-sound`, `voices-ui`, `import-sfz`: feste Kit-Listen, Format-2-Kits ohne `layerSpread`/`choke`, Pack-Prüfung für `SFZ_PACKS`).
- Packs liegen bis zur Freigabe nur lokal (`.git/info/exclude`); Muldjord ist eingecheckt. Neu bauen: `node scripts/import-sfz.mjs C:\dev\samples-raw\muldjord drums-muldjord`.
- Außerhalb des Repos: Rohdaten `C:\dev\samples-raw\muldjord` (git clone von `sfzinstruments/DrumGizmo.MuldjordKit`, 672 MB); Arbeitsbaum `../bt-develop` (`git worktree add --detach ../bt-develop develop`) als Seite A aller A/B-Proben und für `render-check.mjs`.
- Tests zuletzt (2026-11-16, mit Muldjord als Stimme, nicht committet): `npm test` 742 grün, `npx playwright test` 686 grün, 4 übersprungen (WebKit ohne Web Audio). Ein Fehler davor (Crash von Muldjord 3,9 dB unter den anderen Kits) ist behoben: `trimDb.crash` 3, `level` 1,9.

## 2. Entscheidungen des Nutzers

- Format FLAC (16 Bit, 44,1 kHz). Safari kann der Nutzer nicht testen; das Playwright-WebKit unter Windows hat **kein Web Audio** (Tests werden dort übersprungen). Safari bleibt ungeprüft.
- Cache API in `loadPack`, kein Service Worker. Grenzen je Pack 12 MB FLAC und 80 MB dekodiert; Startwahl höchstens 30 MB / 250 MB.
- Schlagzeug „doppelt“: Direkt und Raum als getrennte Stereo-Samples (Feinwert `roomMic`).
- Muldjord als **zusätzliches** Kit (neue Stimmen-ID), nicht als Ersatz.
- Stimmen-IDs: Ich durfte entscheiden. Gleiche Instrumentenart behält ihre ID (z. B. Naked Drums ersetzt `drums/sample/standard`), neue Instrumente bekommen neue IDs.
- „Die alten Packs können raus“: von mir gelesen als „ein ersetztes Pack wird nach dem A/B-Urteil gelöscht, kein Entwickler-Schalter“. **Rückfrage offen**, ob stattdessen alle MuseScore-Packs sofort raus sollen (dann hätten Pads, Lead, Brushes, Jazz- und 808-Kit keinen Sample-Klang mehr). Bis zur Antwort nichts löschen.
- IRs (Cab-Impulsantworten) grundsätzlich unterstützen und verwenden; die IR bleibt eine eigene Datei und wird zur Laufzeit gefaltet (dann betrifft CC-BY-SA nur die IR-Datei). Lizenz von Zach Weeks noch selbst prüfen.
- Namensnennung: eine Credits-Seite, erreichbar über einen Link auf der Startseite (UI-Änderung, Nutzer tendiert dazu; vor dem Bauen kurz bestätigen lassen). Bauen mit dem ersten CC-BY-Pack, das eingecheckt wird; MuseScore und FreePats mit aufnehmen. Dazu `CREDITS.md` im Repo (je Pack: Name, Autor, Lizenz, Link, was verändert wurde).
- Reihenfolge: Drums zuerst (Muldjord als Test der Pipeline, dann Naked Drums), dann E-Bass (Growlybass oder Fashionbass; welche ID, nach rohen Hörproben), E-Gitarre DI (Emily) mit Box, Keys (Wurlitzer und Klavier mit neuen IDs), Kontrabass, Akustikgitarre, Lead.

## 3. Muldjord: Urteile und offene Probe

- Erste Probe (A = MuseScore-Standard-Kit, B = Muldjord mit Pegel des Standard-Kits): „klingt völlig anders; einzeln klingt A besser; im Mix wirkt B besser, aber die Drums gehen im Mix sehr unter“. Danach: „Muldjord klingt mehr nach in einem Raum, der Vorgänger einzeln betrachtet klinisch; einzeln klingt B etwas billiger, im Mix mehr nach Proberaum und zusammenpassend.“ → Der Raum ist gewollt, das Problem war der Pegel.
- Gemessen (`.superpowers/diagnose-kit.mjs`): B allein 2,7–3,6 dB leiser; B dunkler (4–10 kHz −2,7 dB, über 10 kHz −6,4 dB, 300–1000 Hz +3,4 dB gegen A); leise Schläge viel leiser (Hi-Hat bei vel 0,2: −27 dB gegen −14 dB im Standard-Kit); Raum gegen Direkt: Kick +0,1, Toms bis +4,3, Snare −3,2, Hi-Hat −10 dB.
- Daraufhin (nicht committet): `level` 1,9, `velCurve` 0,8 (Pegel bei vel 0,2–0,8 im Mittel 1,7 statt 2,4 dB vom Standard-Kit; `.superpowers/fit-kit.mjs`), `kitPan` 0, Crash +3 dB im Pack.
- **Hörprobe gerendert, Urteil offen** (`.superpowers/audio-ab/muldjord2-solo.html`, `muldjord2-full.html`, `muldjord3-solo.html`, `muldjord3-full.html`; neu rendern mit `node scripts/render-full.mjs ../bt-develop --voice drums=sample/muldjord [--solo drums] --name muldjord2-…`, Variante C mit `--tuning '{"drums/sample/muldjord":{"roomMic":0.5}}'`): B = Pegel und Anschlag angeglichen, Raum voll; C = dazu halber Raum (Gegenprobe). Gemessen: B allein 0,0 bis 0,4 dB unter A (vorher 2,7 bis 3,6), im Mix gleich laut; C allein 1,4 bis 1,8 dB unter A; Seite/Mitte allein A −8,8, B −6,3, C −7,5 dB, im Mix A −12,0, B −11,0, C −11,9 dB (`node .superpowers/stereo-width.mjs <wav>`).
- Nach Freigabe von Muldjord: Pack einchecken, `CREDITS.md`, Credits-Seite (Bestätigung), Änderungslog, ein Commit. „SnareRest“ (Taste 37) als Side-Stick ist ungehört; das Kit hat keine getretene und keine halboffene Hi-Hat (fallen auf geschlossene/offene zurück).

## 4. Budget

| Pack | FLAC | dekodiert | Status |
|---|---|---|---|
| drums-muldjord (86 Zonen, 175 s stereo) | 8,6 MB | ≈ 62 MB | lokal, nicht freigegeben |

MuseScore-Packs unverändert: 24 Packs, 46 MB.

## 5. Nächste Schritte

1. Offene Probe aus 3 rendern, Bericht, Urteil abwarten.
2. Naked Drums (`sfzinstruments/WilkinsonAudio.NakedDrums`, CC-BY-4.0, 1,3 GB, gleicher Mapper wie Muldjord): ersetzt `drums/sample/standard` (betrifft die Stile funk, psych, rock, hardrock, poppunk und über das geteilte Pack das Kit `rimshot`/Reggae: dort muss die Snare auf Taste 37 bleiben, `pack.meta.keys` überschreibt heute die Tastenkarte der Variante). Keymap aus `User/Naked Drums GM keymap.txt`: Side-Stick 37, Ride 51, Glocke 53, Hi-Hat getreten 44, halboffen 56, offen 46; kein Rimshot. Hi-Hat mit Keyswitch-Modi (`sw_last`/`sw_default`, der Importer nimmt `sw_default`). Mit 12 MB und Direkt + Raum wird es eng: zuerst Round-Robins der Toms senken. Danach Pegel, `velCurve`, Crash-Abgleich wie bei Muldjord; altes Pack nach dem Urteil löschen.
3. Für Ton-Instrumente ist der Importer gebaut, aber nur mit Testdaten geprüft (`tests/e2e/fixtures/make-sample-fixtures.mjs`): Notenbereich (`keys`), Release-Samples (`releases`, Feinwert `release` an der Stimme), `art`-Muster. Growlybass legt die tiefe E-Saite vermutlich eine Oktave über den Klang (Taste 40 wie bei der Gitarre): Grundton messen.

## 6. Arbeitsregeln (aus dem Auftrag)

- Nur Lizenzen mit erlaubter Weitergabe (CC0, PD, MIT, CC-BY, CC-BY-SA mit Bedacht; kein NC, kein GPL bei Samples, nichts ohne klare Lizenz). LICENSE-Datei jeder Library selbst prüfen. Je Pack `LICENSE-<id>.md` (schreibt der Importer) und ein Eintrag in `CREDITS.md`.
- Rohdateien nach `C:\dev\samples-raw\<library>\`, nie ins Repo. Packs erst nach Freigabe einchecken (jede eingecheckte Version bleibt für immer in der Geschichte), bis dahin `.git/info/exclude`. Kein Git LFS (Pages liefert es nicht aus). Pages höchstens 1 GB.
- MuseScore nicht entfernen, solange nicht alle Instrumente ersetzt und freigegeben sind (Phase 5); siehe aber die offene Rückfrage in 2.
- A/B je Schritt: ganze Tracks mit Songform, stereo, A = alt (Arbeitsbaum `../bt-develop`), B = neu, gleiche Lautheit (`render-full.mjs` gleicht an), im Einzelinstrument (`--solo`) und im ganzen Track.
- Synth-Stimmen und UI nicht ändern, außer der minimalen Anbindung neuer Stimmen und dem Credits-Link (vorher fragen).
- Ein Schritt pro Commit; vor jedem Commit `npm test` und `npx playwright test --reporter=dot`, Ausgabe in eine Datei, Exit-Code ausgeben (nicht `| tail`). Nach jedem Schritt höchstens 10 Zeilen Bericht (was, worauf hören, Pegel/Größe vorher/nachher, Pfade), dann STOPP. Zweimal am selben Problem gescheitert: stoppen, Optionen nennen. Nicht pushen ohne OK. Antworten Deutsch, Commits Englisch.
- Weiter gelten aus `FABLE_PHASE1.md`: „Du kannst nicht hören“ (nie behaupten, etwas klinge besser; Messwerte, Urteil des Nutzers), „Regeln gegen Leerlauf“.

## 7. Stolpersteine

- `git mv -k` auf eine nicht verfolgte Datei (z. B. aus `.superpowers/`) tut nichts und meldet keinen Fehler: einfaches `mv`.
- Der Begrenzer frisst Pegel: eine Anhebung um x dB ergibt allein weniger als x dB RMS. Nach jeder `level`-Änderung neu messen.
- Eine Pegelkorrektur einzelner Schläge im Importer (`trimDb`) kann den Pack-Faktor ändern (Normalisierung auf die lauteste Spitze) und damit alle anderen Schläge; die Ausgabe nennt den Pack-Faktor, `level` danach nachziehen.
- `render-full.mjs --pack` lenkt nur das Pack um; Feinwerte bleiben die der alten Stimme (z. B. kein `kitPan` 0). Für registrierte Stimmen `--voice` nehmen. Fehlt ein Pack, bricht das Skript ab (sonst spielte still der Synth).
- ARIA-Mappings: mehrere `#define` je Zeile, Namen werden mit dem längsten definierten Präfix ersetzt (`$MIC_$ART`), Mikrofon-Pegel und Panorama hängen an Controller-Startwerten mit Kurven, `phase=invert` am unteren Snare-Mikrofon (sonst Auslöschung), Choke-Gruppen je Mikrofon eigens nummeriert, ein Trigger-Kanal im Standard-Mix (Muldjord: weggelassen), Panorama aus Sicht des Schlagzeugers (gespiegelt).
- Der Offline-Render ist nicht bitgenau wiederholbar (bis −85 dB zwischen zwei Läufen); `render-check.mjs` vergleicht darum mit 2e-4.
- Zwei Playwright-Läufe direkt hintereinander scheitern manchmal mit „connection refused“: wiederholen. Hintergrundläufe überleben keinen Neustart.
