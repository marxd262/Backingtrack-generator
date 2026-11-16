# Sample-Packs: Format und Wiedergabe

Stand 2026-11-16 (Branch `feat/samples`, Tag `port-base`). Dieses Dokument beschreibt die Sample-Packs der App so, dass eine native Umsetzung (JUCE) sie ohne den JavaScript-Code lesen und gleich abspielen kann. Maßgeblich ist der Code: Laden `src/audio/voices/sampler.js` (`loadPack`, `buffersFor`, `playNote`), Zonenwahl `sample-zones.js`, Töne `sample.js`, Schläge `sample-hits.js`, Pack je Stimme `pack-id.js`, Feinwerte `tunables.js`. Wo dieses Dokument und der Code abweichen, gilt der Code.

## 1. Dateien

Alle Packs liegen in `src/assets/samples/`. Ein Pack heißt nach seiner Pack-ID (`<schicht>-<name>`, z. B. `bass-finger`, `drums-naked`).

| Format | Dateien | Audio |
|---|---|---|
| 1 (MuseScore, FreePats; `scripts/extract-samples.mjs`) | `<id>.json`, `<id>.pcm` | rohes PCM, 16 Bit signed little endian, **mono**, alle Samples hintereinander, **jedes in seiner eigenen Abtastrate** (`samples[k].rate`, 22 050 bis 48 000 Hz) |
| 2 (SFZ-Libraries; `scripts/import-sfz.mjs`) | `<id>.json`, `<id>.<hash>.flac` (Name steht in `meta.file`) | eine FLAC-Datei, 16 Bit, **44 100 Hz** (`meta.rate`), mono oder stereo (`meta.channels`), alle Samples hintereinander, ohne Lücken |

Erkennen: `meta.version === 2` ist Format 2, fehlt das Feld, ist es Format 1. Der Hash im FLAC-Namen (10 Hex-Zeichen aus SHA-256 des Inhalts) macht die Datei unveränderlich; ein neu gebautes Pack bekommt einen neuen Namen.

Lizenzdateien: Format 2 `LICENSE-<id>.md` je Pack (Kopf mit Urheber, Quelle, Lizenz, Änderungen; dahinter der Lizenztext der Library). Format 1: `LICENSE-MuseScore_General.md` (alle MuseScore-Packs) und `LICENSE-Freepats-FSBS.md` (`chords-freepats`, `chords-freepatsjazz`). Übersicht: `CREDITS.md` im Repo-Stamm und die Seite `src/ui/credits.html`. CC-BY verlangt die Namensnennung auch in der nativen App.

## 2. Welche Stimme spielt welches Pack

Stimmen heißen `<schicht>/<stimme>/<variante>` (Register `src/core/voices.js`). Sample-Stimmen haben die Stimme `sample`; ihr Pack ist `<schicht>-<variante>`, außer in dieser Tabelle (`pack-id.js`, `SHARED`):

| Stimme | Pack | Bemerkung |
|---|---|---|
| `drums/sample/standard` | `drums-naked` | Naked Drums, Format 2 (seit 2026-11-16) |
| `drums/sample/rimshot` | `drums-naked` | dasselbe Kit; die Snare spielt den Side-Stick (Abschnitt 6) |
| `drums/sample/legacy` | `drums-standard` | „Legacy Drums“: das frühere MuseScore-Standard-Kit, Format 1 |
| `lead/sample/guitar` | `chords-freepats` | Lead-Gitarre auf den Samples der Akkord-Gitarre |

Alle übrigen Packs sind Format 1 (MuseScore, FreePats) außer `drums-muldjord` (Format 2).

## 3. JSON

### Format 1

```json
{ "id": "bass-finger", "source": "MuseScore_General", "gm": 33, "name": "Fingered Bass",
  "samples": [{ "offset": 0, "frames": 84656, "rate": 22050, "loopStart": 84046, "loopEnd": 84581 }],
  "zones": [{ "keyLo": 0, "keyHi": 127, "velLo": 0, "velHi": 127, "sample": 0, "rootKey": 40, "tuneCents": 0, "loop": true,
              "attenuationDb": 0, "attack": 0, "hold": 0, "decay": 0, "release": 0.2, "sustainDb": 0 }] }
```

- `samples[k].offset`: **Bytes** in der `.pcm` (gerade Zahl), `frames`: Anzahl der Abtastwerte, `rate`: Abtastrate dieses Samples, `loopStart`/`loopEnd`: Frames relativ zum Sample-Anfang. Gültig nur, wenn `offset + 2·frames` ≤ Dateigröße.
- Wert = int16 / 32768.

### Format 2

```json
{ "id": "drums-naked", "version": 2, "source": "Naked Drums (SFZ)", "author": "Wilkinson Audio (Aufnahme), kinwie (SFZ-Mapping)",
  "license": "CC-BY-4.0", "url": "https://github.com/sfzinstruments/WilkinsonAudio.NakedDrums",
  "file": "drums-naked.9a740407a6.flac", "rate": 44100, "channels": 2,
  "keys": { "kick": 36, "snare": 38, "hat": 42 },
  "samples": [{ "offset": 0, "frames": 35280, "rate": 44100, "loopStart": 0, "loopEnd": 0 }],
  "zones": [{ "keyLo": 42, "keyHi": 42, "velLo": 1, "velHi": 43, "sample": 62, "rootKey": 42, "tuneCents": 0, "loop": false,
              "attenuationDb": 0, "attack": 0, "hold": 0, "decay": 0, "release": 0.04, "sustainDb": 0,
              "velGain": [0.0101, 0.1235], "room": 63, "chokes": [5, 6], "offBy": 4, "offTime": 0.2 }] }
```

- `samples[k].offset`: **Frames** in der dekodierten FLAC-Datei; Samples liegen lückenlos (`offset[k] = offset[k-1] + frames[k-1]`). Die dekodierte Länge muss mindestens `offset + frames` des letzten Samples sein, Kanäle und Rate müssen `channels` und `rate` entsprechen, sonst ist das Pack ungültig.
- `license` ist eine SPDX-Kennung, `source`, `author`, `url` die Pflichtangaben für die Namensnennung.
- `keys` (nur Schlag-Packs): Schlagname → Taste der Zonen (Abschnitt 6).

### Zonenfelder

| Feld | Bedeutung |
|---|---|
| `keyLo`, `keyHi`, `velLo`, `velHi` | MIDI-Tasten- und Anschlagbereich (0–127, beide Grenzen gehören dazu) |
| `sample` | Index in `samples` |
| `rootKey`, `tuneCents` | Taste, auf der das Sample unverändert klingt; Feinstimmung in Cent |
| `loop` | Schleife zwischen `loopStart` und `loopEnd` des Samples (nur Format 1) |
| `attenuationDb` | Dämpfung in dB, negative Werte zählen als 0 (nie Anhebung) |
| `attack`, `hold`, `decay` (s), `sustainDb` (Dämpfung in dB), `release` (s) | Hüllkurve wie SoundFont 2 |
| `velGain` | Format 2: Pegelfaktor am unteren und oberen Ende des Anschlagbereichs (Anschlagkurve der Library) |
| `trigger: "release"`, `rtDecay` | Format 2: Release-Sample (am Notenende), Abnahme in dB je gehaltener Sekunde |
| `art` | Format 2: eigene Samples für eine Artikulation (Namen aus `docs/sound-v2/SPEC_PHASE3.md`, Abschnitt 2, z. B. `staccato`, `dead`) |
| `room` | Format 2, Schläge: Index des Raum-Samples, das zusammen mit `sample` klingt |
| `chokes`, `offBy`, `offTime` | Format 2, Schläge: Nummern der Schläge, die dieser abwürgt; eigene Nummer, unter der er abgewürgt wird; Abklingzeit (s) |

Fehlende Felder haben keine Wirkung (Format 1 kennt die Format-2-Felder nicht).

## 4. Zonenwahl

1. Anschlag `vel` (0..1, ungültig = 1) → `v = round(clamp(vel, 0, 1) · 127)`.
2. Kandidaten: alle Zonen außer Release-Zonen; hat die Note eine Artikulation `art` und gibt es Zonen mit diesem `art`, nur diese, sonst nur Zonen ohne `art`.
3. Wertung je Zone als Tripel, lexikografisch kleiner ist besser: Abstand der Taste zum Bereich `[keyLo, keyHi]` (0 wenn darin), Abstand von `v` zu `[velLo, velHi]`, Breite `keyHi − keyLo`.
4. Format 1: die erste Zone mit der besten Wertung. Format 2: alle Zonen mit der besten Wertung sind **Round-Robins**; gewählt wird zufällig (Zufallsquelle der Stimme, seedbar), aber nie dieselbe Zone wie beim letzten Mal unter demselben Schlüssel (Taste und Artikulation; je Stimme gemerkt). Bei nur einer Zone keine Zufallsziehung.

## 5. Wiedergabe einer Note

- **Tonhöhe:** `rate = 2^(((midi − rootKey)·100 + tuneCents + cents) / 1200)` (`cents`: Zufallsabweichung der Stimme), als Abspielgeschwindigkeit. Format 1 spielt jedes Sample in seiner Rate, Format 2 in 44 100 Hz.
- **Pegel:** `peak = gain · zoneGain(attenuationDb) · velFaktor`. `gain` = Feinwert `level` der Stimme und Humanisierung (Abschnitt 7). `velFaktor`: Format 1 linear `clamp(vel, 0, 1)`; Format 2 linear zwischen `velGain[0]` bei `velLo` und `velGain[1]` bei `velHi` (`x = clamp((vel·127 − velLo)/(velHi − velLo), 0, 1)`).
- **Hüllkurve:** linear von 0 auf `peak` in `max(attack, 3 ms)`, halten `hold`, exponentiell auf `peak · 10^(−sustainDb/20)` in `decay`; am Notenende exponentiell auf 0 in `release`, begrenzt auf 0,04 bis 2 s. Kurze Artikulationen (`staccato`, `choke`, `chuck`) klingen in `stopTime` aus (Standard 0,03 s), `ring` in 2 s. Alle Zeiten der Hüllkurve mal `timeScale` (Klangregler „Länge“/„Einsatz“).
- **Schleife:** nur Format 1 mit `loop: true` und ohne `oneShot`.
- **Release-Sample** (Format 2, nur wenn der Feinwert `release` der Stimme > 0): zur Zeit `t + dur` eine Release-Zone derselben Taste und Stufe (Round-Robin wie oben), ganz abgespielt, Pegel `gain · release · 10^(−rtDecay · dur / 20)`.
- **Gerechnete Artikulationen**, wenn das Pack keine `art`-Zone hat (Slides, Bend, Vibrato, Hammer-on, Dead Note, Palm Mute …): `playNote` in `sampler.js`, Kommentar dort. Hat das Pack eine `art`-Zone, spielt sie ohne die gerechnete Variante (der Vorlauf eines Slides bleibt).

## 6. Schläge (Schlagzeug, Percussion)

- Taste je Schlagname: Format 2 aus `meta.keys`; Format 1 aus der GM-Tabelle `HIT_KEYS` (`sample-hits.js`), beim Kit Rimshot ist die Snare Taste 37. Beim Format 2 übersetzt die Stimme eine abweichende GM-Taste der Variante auf den Schlagnamen, der in GM auf dieser Taste liegt (Rimshot: `snare` spielt `sideStick`).
- Fehlt ein Name im Pack, gilt der Grundschlag (`DRUM_FALLBACK` in `src/core/event-helpers.js`: `sideStick`, `rimshot` → `snare`; `ride`, `rideBell`, `hatPedal` → `hat`; `hatHalf` → `openHat`, nach 0,1 s abgewürgt).
- Jeder Schlag spielt das ganze Sample (Dauer `frames / rate / Abspielgeschwindigkeit`).
- Format 2: Anschlag vor Zonenwahl und Pegel hoch `velCurve` (Feinwert der Stimme); `room` spielt zusätzlich mit Pegel mal Feinwert `roomMic`; Choke: spielt ein Schlag mit `chokes`, werden alle noch klingenden Schläge, deren `offBy` darin steht, mit der Zeitkonstante `offTime / 3` ausgeblendet. Format 1: die geschlossene oder getretene Hi-Hat würgt die offene ab (Zeitkonstante 12 ms).
- `art: "choke"` am Ereignis: der Schlag würgt sich nach `artTime` selbst ab (Crash vor einem Stopp).
- Stereo-Kits (Format 2) haben ihr eigenes Panorama; der Feinwert `kitPan` 0 schaltet die Lage je Schlag in der Mischung ab (`synth.js`).

## 7. Feinwerte der Stimmen (nicht im Pack)

`src/audio/voices/tunables.js`, je Stimme `{ min, max, step, value }`. Für Sample-Stimmen wichtig: `level` (gemessen: RMS gegen die vorige Stimme bzw. den Synth), Natürlichkeit der Gitarren und Bässe (`velExp`, `softHz`, `oneShot`, `humanCents`, `humanDb`), `decay` (zusätzliches Abklingen), `strum`, Entzerrer (`lowDb` …), Kits (`humanCents`, `humanDb`, `layerSpread`, `choke` bei Format 1; `roomMic`, `velCurve`, `kitPan` bei Format 2). Die native Version braucht diese Werte mit; sie sind Teil des Klangs.

## 8. Pegel

Format 1 übernimmt die Samples unverändert (Spitzen meist −1 bis −3 dBFS). Format 2 mischt die Mikrofone nach dem Standard-Mix des Mappings und skaliert das ganze Pack mit **einem** Faktor auf −1 dBFS Spitze (keine Normalisierung je Sample; die Verhältnisse der Library bleiben). Einzelne Schläge können im Importer angehoben werden (`trimDb`, z. B. Crash). Der Pegel einer Stimme in der Mischung ergibt sich aus `level`, eingemessen per Render-Vergleich (`scripts/render-full.mjs`, `scripts/fit-kit.mjs`, `scripts/style-voices-level.mjs`).

## 9. Aus einer SFZ-Library wird ein Pack

`node scripts/import-sfz.mjs <ordner-der-library> <pack-id> [ausgabeordner]` (Voraussetzung `ffmpeg`). Was je Pack gewählt wird, steht in `SFZ_PACKS` im Skript:

| Feld | Bedeutung |
|---|---|
| `sfz` | Hauptdatei in der Library |
| `title`, `author`, `license`, `licenseUrl`, `url`, `licenseFile` | Angaben für JSON, Lizenzdatei und Credits |
| `channels` | 1 (DI-Instrumente) oder 2 (Schlagzeug mit Raum) |
| `hits` | Schlagzeug: Schlagname → Taste der Library |
| `keys`, `transpose` | Töne: Tastenbereich nach der Verschiebung; Verschiebung in Halbtönen, wenn das Mapping nicht auf der klingenden Tonhöhe liegt (vorher mit `scripts/pitch-check.mjs` messen) |
| `select` | je Name oder `default`: `[Stufen, Round-Robins]`; Stufen als Zahl (gleichmäßig zusammengefasst) oder Liste der Anschläge, an denen eine neue Stufe beginnt |
| `seconds` | höchste Länge je Sample (Zahl oder je Name), gekürzt hinter −60 dB mit Ausblendung |
| `room`, `skip`, `mirror` | Muster für Raum-Mikrofone (eigenes Sample), wegzulassende Kanäle; links und rechts tauschen (die App legt Kits aus Sicht des Publikums) |
| `art`, `releases`, `trimDb` | Muster für Artikulations-Gruppen; Round-Robins der Release-Samples; Pegel einzelner Schläge |

Ablauf im Skript: SFZ lesen (Kopfzeilen mit Vererbung, `#include` relativ zur Hauptdatei, `#define` in Reihenfolge, längster Name gewinnt) → Standardzustand auswerten (Controller auf `set_cc`/`set_hdcc`, Kurven der ARIA-Player, `locc`/`hicc`, Keyswitch auf `sw_default`, `on_locc`-Regionen weg, `phase=invert`, Pegel und Panorama samt Controller-Modulation, Anschlagkurve `amp_velcurve_N`/`amp_veltrack`, stumme Regionen nur für Choke) → Regionen mit gleicher Taste, Stufe, Round-Robin und Trigger mischen (Mikrofone; Direkt und Raum getrennt) → Stufen und Round-Robins auswählen → kürzen → ein Pegelfaktor → 16 Bit → FLAC → JSON, Lizenzdatei. Die Ausgabe nennt Zonen, Stufen, Mikrofone, Größe, Pack-Faktor und nicht ausgewertete Opcodes. Grenze: 12 MB FLAC je Pack (bricht sonst ab).

Prüfliste für eine neue Library: Lizenzdatei der Library selbst lesen (nur CC0, PD, MIT, CC-BY, CC-BY-SA mit Bedacht); Rohdaten nach `C:\dev\samples-raw\<library>\`; Tonhöhe messen (`pitch-check.mjs`, nach dem Bau `pitch-pack.mjs`); Verteilung der Anschläge auf die Stufen prüfen (`bass-vel.mjs`); Pegel und Anschlagkurve einmessen (`fit-kit.mjs`, `render-full.mjs --solo`); A/B ganzer Songs gegen die bisherige Stimme (`render-full.mjs`, Arbeitsbaum des alten Stands als Seite A); Eintrag in `CREDITS.md` und `credits.html`; Tests (`tests/core/import-sfz.test.js`, `credits.test.js`, `voices-impl.test.js`, `tests/e2e/voices-sample-sound.spec.js`).

## 10. Packs heute

| Pack | Format | Stimmen | Größe | Lizenz |
|---|---|---|---|---|
| `drums-naked` | 2, stereo, 90 Zonen | Schlagzeug Standard, Rimshot | 11,5 MB | CC-BY 4.0 |
| `drums-muldjord` | 2, stereo, 86 Zonen | Schlagzeug „Rock-Kit mit Raum“ | 8,6 MB | CC-BY 4.0 |
| 22 MuseScore-Packs (Bass, Akkorde, Pad, Lead, Kits, Percussion; `drums-standard` als Legacy Drums) | 1, mono | übrige Sample-Stimmen | zusammen etwa 28 MB | MIT |
| `chords-freepats`, `chords-freepatsjazz` | 1, mono | E-Gitarre clean/jazz, Lead-Gitarre | 10,9 und 7,8 MB | CC0 |

Nicht im Repo (angefangen, nicht freigegeben): `bass-growly`, `bass-fashion` in `C:\dev\samples-raw\built-packs\` (siehe `docs/sound-v2/UEBERGABE_SAMPLES.md`).
