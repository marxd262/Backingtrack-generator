# SPEC_PHASE2 – Sampler und Import-Pipeline für SFZ-Libraries

Stand: 2026-11-14, Branch `feat/sound-v2`. Vorher lesen: `SOUND_CONTEXT.md` (Karte der Audio-Engine und Änderungslog Klang v2) und `SAMPLE_SOURCES.md` (Libraries, Lizenz-Regeln). Diese Spec ersetzt MuseScore_General schrittweise durch bessere Samples. Sie baut **keine** Artikulations-Regeln (das ist Phase 3), bereitet den Sampler aber darauf vor.

## Regeln

- Kein Build, keine Runtime-Abhängigkeit. `ffmpeg` nur im Import-Skript (wie heute bei `scripts/extract-samples.mjs`).
- Die Synth-Stimmen und `src/ui/` bleiben unberührt. Neue Stimmen erscheinen automatisch im Stimmen-LCD, sobald sie in `core/voices.js` stehen.
- Ein Schritt = ein Commit, `npm test` und `npm run test:e2e` grün. Jede neue Stimme bekommt ein A/B-Paar gegen die alte (`scripts/render-step.mjs`, neuer Eintrag in `STEPS`), der Nutzer urteilt nach Gehör. Nie behaupten, dass etwas besser klingt.
- Die alten Packs (Format 1) laden und klingen unverändert weiter, bis der Nutzer eine Stimme ausdrücklich ablöst.

## Reihenfolge der Libraries

| # | Library | Lizenz | Warum an dieser Stelle |
|---|---|---|---|
| 1 | Growlybass (`sfzinstruments/karoryfer.growlybass`, Mapping `growlybass_clean.sfz`) | CC0 1.0 | Einfachstes SFZ (flache `<group>`/`<region>`), 14 Töne × 4 Anschlagstufen × 4 Round-Robins. Testet die ganze Pipeline. |
| 2 | Emilyguitar (`sfzinstruments/karoryfer.emilyguitar`, `emily_basic.sfz`) | CC0 1.0 | Wie 1, dazu Release-Samples (`trigger=release`, 4 RR) und Geräusche (Tasten 90–96, 5 RR). DI-Aufnahme, passt zur Verzerrerkette. |
| 3 | Naked Drums (`sfzinstruments/WilkinsonAudio.NakedDrums`) | CC-BY-4.0 | Größter Gewinn, aber aufwendig: ARIA-SFZ mit `#include`/`#define`, 16 Mikrofonkanäle, FLAC, 1,3 GB. Erst wenn 1 und 2 laufen. |

Geprüft (2026-11-14, aus den Repos gelesen): Dateilisten, Lizenztexte und die genannten Mappings. **Nicht geprüft:** Abtastrate, Bittiefe und Kanalzahl der WAV-Dateien (Header nicht gelesen), die 10 Round-Robins von Naked Drums (stehen nur im README) und dessen Sample-Listen in `Data/file/*.txt`. Der Importer muss diese Werte aus den Dateien lesen, nicht annehmen.

## Teil A – Import-Skript `scripts/import-sfz.mjs`

Aufruf: `node scripts/import-sfz.mjs <ordner-der-library> [pack-id …]`. Die Tabelle `SFZ_PACKS` im Skript beschreibt je Pack: Mapping-Datei, Schicht/Variante, Auswahl (siehe unten), Lizenz. Ausgabe nach `src/assets/samples/` wie bisher.

1. **SFZ lesen.** Header `<control> <global> <master> <group> <region>` mit Vererbung nach unten, `//`-Kommentare, `#include "…"`, `#define $NAME wert` mit Ersetzung, `default_path`, Pfade mit `\` oder `/`. Opcodes, die ausgewertet werden: `sample`, `key`, `lokey`, `hikey`, `pitch_keycenter`, `lovel`, `hivel`, `lorand`, `hirand`, `seq_length`, `seq_position`, `trigger`, `rt_decay`, `volume`, `tune`, `transpose`, `ampeg_release`, `group`, `off_by`, `off_time`, `loop_mode`, `loop_start`, `loop_end`. Alles andere wird ignoriert und am Ende einmal als Liste ausgegeben (`amp_velcurve_*`, `bend_*`, `amp_random`, `locc*`/`hicc*` usw.). `sample=*silence` überspringen.
2. **Round-Robins erkennen.** Regionen mit gleichem Tasten- und Anschlagbereich und gleichem `trigger` bilden eine Gruppe; ihre Reihenfolge nach `lorand` (oder `seq_position`) ergibt `rr: [index, anzahl]`.
3. **Auswählen** (je Pack in `SFZ_PACKS`): `keys` (Tastenbereich), `velLayers` (welche der vorhandenen Stufen), `roundRobins` (Anzahl), `maxSeconds` (Kürzen mit 30 ms Ausblendung), `releases` (ja/nein), `art` (Zuordnung Taste oder Datei-Muster → Artikulationsname; nur Namen aus `SPEC_PHASE3.md` Abschnitt 2, z. B. `dead`, `palmMute`, `chuck`. Welche Emily-Taste 90–96 was ist, aus dem SFZ lesen; Geräusche ohne passenden Namen bleiben draußen, bis Phase 3 einen Namen dafür hat). Startwerte: Bass 4 Stufen × 2 RR, 3 s; Gitarre 3 Stufen (p, mf, f) × 2 RR, 4 s, Releases ja.
4. **Aufbereiten mit ffmpeg:** dekodieren, auf 44,1 kHz, 16 Bit; mono bleibt mono, Stereo bleibt Stereo. Kein Normalisieren je Sample (die Lautheitsverhältnisse der Library bleiben), `volume` wandert in `attenuationDb`.
5. **Schreiben:** `<id>.json` (Format 2) und `<id>.flac.bin` (alle Samples als einzelne FLAC-Dateien hintereinander). Dazu `LICENSE-<pack>.md` aus der LICENSE-Datei der Library; bei CC-BY zusätzlich Urheber, Titel, Lizenz-URL und Quelle (Pflichtangaben, Abschnitt 3(a) der Lizenz).
6. **Zusammenfassung ausgeben:** Samples, Zonen, MB, ignorierte Opcodes. **Zielgröße je Pack: höchstens 12 MB**; darüber bricht das Skript mit Hinweis ab (Auswahl verkleinern).

**Format 2** (`meta.version: 2`; fehlt das Feld, ist es Format 1 und wird wie heute geladen):

```json
{ "id": "bass-growly", "version": 2, "source": "Growlybass (Karoryfer)", "license": "CC0-1.0",
  "samples": [{ "offset": 0, "bytes": 51234, "frames": 132300, "rate": 44100, "channels": 1, "loopStart": 0, "loopEnd": 0 }],
  "zones": [{ "keyLo": 33, "keyHi": 38, "velLo": 0, "velHi": 60, "sample": 0, "rootKey": 37, "tuneCents": 0, "loop": false,
              "attenuationDb": 0, "attack": 0, "hold": 0, "decay": 0, "release": 0.3, "sustainDb": 0,
              "rr": [0, 2], "trigger": "attack", "rtDecay": 0, "group": 0, "offBy": 0, "offTime": 0, "art": null }] }
```

`offset`/`bytes` zeigen in die `.flac.bin`. Felder ohne Bedeutung bekommen die Werte oben. Für Naked Drums kommt `"mic": "close" | "room"` dazu (siehe Teil C).

## Teil B – Sampler (`src/audio/voices/`)

| Fähigkeit | Wo | Verhalten |
|---|---|---|
| Format 2 laden | `sampler.js` `loadPack`, `buffersFor` | `.flac.bin` holen, je Sample `ctx.decodeAudioData(slice)`; das Dekodieren gehört zum Ladevorgang (`watchPack` meldet erst danach `ready`), `buffersFor` bleibt synchron. Stereo-Puffer, wenn `channels: 2`. |
| Round-Robin | `sample-zones.js` neue `pickZones(zones, midi, vel, trigger, art)` → alle passenden Zonen; `sampler.js` wählt mit dem Seed-Zufall der Stimme (`deps.rng`) eine davon, **nie dieselbe zweimal hintereinander je Taste** | Ersetzt `layerSpread` aus Schritt 5 für Format-2-Packs (dort auf 0 setzen); `humanCents`/`humanDb` bleiben. |
| Release-Samples | `sampler.js` `playNote` | Am Notenende zusätzlich eine Zone mit `trigger: "release"` starten, Pegel `−rtDecay · gehaltene Sekunden` dB; nur wenn die Stimme den Feinwert `release` > 0 hat (Faktor auf den Pegel). |
| Choke-Gruppen | `sample-hits.js` | `group`/`offBy` aus der Zone: ein neuer Schlag würgt laufende Schläge ab, deren `group` seinem `offBy` entspricht, mit `offTime` (Standard 12 ms). Die feste Hi-Hat-Regel (`openHat`) bleibt für Format 1. |
| Artikulation | `sample.js` (nur Notenschichten) | Hat das Ereignis `art` und gibt es zur Taste Zonen mit diesem `art`, spielen diese **ohne** die gerechnete Variante; sonst die normalen Zonen (`art: null`) mit der gerechneten Variante aus `sampler.js` (`SPEC_PHASE3.md` Abschnitt 7). Schlagzeug hat keine `art`-Zonen: Schlagarten sind Schlagnamen (`HIT_KEYS`), `flam` und `choke` am Schlag werden gerechnet. Das Feld kommt schon aus `core/microtiming.js` an. Mehr nicht: welche Note welche Artikulation bekommt, ist Phase 3. |
| Stereo | `sampler.js` | Nichts weiter nötig: die Panorama-Stufe in `synth.js` (`balance`) behält die Breite von Stereo-Eingängen. |

Nicht bauen: Überblenden zwischen Anschlagstufen, Keyswitches, CC-Steuerung, Pitch-Bend aus dem SFZ.

## Teil C – Naked Drums (erst nach 1 und 2)

- Je Schlag werden die Mikrofonkanäle beim Import zu **zwei** Samples gemischt: `close` (Direkt-Mikrofone und Overheads, stereo) und `room` (Close Room und Far Rooms, stereo). Beide sind eigene Zonen mit gleichem `rr`, sie werden immer als Paar gewählt.
- `room` bekommt einen eigenen Feinwert `roomMic` (0–2, Standard 1) in `tunables.js`. Der gerechnete Raum aus Schritt 3 bleibt; ob dessen Sendeanteil für dieses Kit sinken soll, entscheidet der Nutzer am A/B.
- Tastenbelegung: die Namen aus `HIT_KEYS.drums` auf die Tasten aus `Data/keymap.txt` der Library abbilden (im Skript als Tabelle, nach dem Lesen der Datei). Die Schlagnamen aus Phase 3 (`ride`, `rideBell`, `hatHalf`, `hatPedal`, `sideStick`, `rimshot`) werden mit abgebildet, soweit die Library sie hat; sie sind Tasten, keine `art`-Zonen. Hi-Hat-Choke kommt aus `group`/`off_by` (in `Data/group/hats_di.txt`: Gruppen 200–203).
- Auswahl zum Start: 3 Anschlagstufen × 4 Round-Robins je Schlag, Crash auf 2,5 s gekürzt wie heute. Wenn 12 MB nicht reichen, zuerst Round-Robins der Toms verringern.
- CC-BY: Namensnennung zusätzlich an einer sichtbaren Stelle der App. Das ist eine UI-Änderung und braucht die Freigabe des Nutzers.

## Einbindung je neuer Stimme

1. Variante in `core/voices.js` (`VOICES[schicht].sample.variants`) und Pack-ID nach `pack-id.js` (`<schicht>-<variante>`), Übersetzungen in `i18n/de.js` und `en.js`.
2. Feinwerte in `tunables.js`: `level` wie bisher gemessen (RMS der Schicht allein gegen den Synth, Ziel 0,98–1,02; Verfahren steht dort im Kommentar), dazu die passenden Gruppen (`BASS_HUMAN`, `REALISM`, `STRUM`, `KIT_HUMAN`).
3. Tests: `tests/core/voices-impl.test.js` und `sample-packs.test.js` erwarten zu jeder Variante ein Pack und `level`; `voices-sample-sound.spec.js` prüft Tonhöhe und Pegel je Variante (Einträge ergänzen). Neu: ein Test, dass zwei gleiche Noten hintereinander verschiedene Samples spielen, und einer, dass ein Format-1-Pack bitgleich wie vorher klingt.
4. A/B gegen die bisherige Stimme rendern, Messwerte nennen, **STOPP**, Urteil abwarten, Änderungslog in `SOUND_CONTEXT.md` ergänzen.

## Vor dem ersten Commit zu klären

- **FLAC im Browser:** `decodeAudioData` mit FLAC in Chromium per Playwright-Test belegen; Firefox und Safari muss der Nutzer von Hand prüfen. Scheitert einer, bleibt das Format rohes 16-Bit-PCM (`.pcm`, bei Stereo abwechselnd L/R) und die Zielgröße je Pack steigt auf 25 MB.
- **Download:** Die Libraries liegen nicht im Repo. Der Nutzer lädt sie herunter oder gibt das Herunterladen frei („Neue Samples nur nach Rückfrage“).
- **Größe gesamt:** heute 47,9 MB für 25 Packs; mit drei neuen Packs zu je 12 MB bleibt die Seite weit unter 1 GB.
