# Schnittstelle des Backingtrack-Generators

## Zweck und Trennung

Der Generator läuft allein (eigene Oberfläche unter `src/ui`). Die Lern-App Interactive Scales benutzt ausschließlich diese Schnittstelle, den Einstieg `src/index.js`. Er lädt auch in reinem Node, ohne Browser-Globals beim Import.

```js
import {
  play, buildEvents, chordTimeline, validateTrack, VALIDATION_CODES, allowedChords, chordOptions, chordName, CHORDS,
  TAG_CATEGORIES, STYLE_PRESETS, DRUM_NAMES, PERCUSSION_NAMES, LAYER_IDS, layerDefaults, jobsFor, isJob, completeJobs, VOICES, t, setLanguage, getLanguage,
} from './src/index.js';
```

## Track (Eingabe)

```json
{
  "key": { "root": "A", "mode": "minor" },
  "bpm": 100,
  "bars": [
    { "chord": { "root": "A", "quality": "min" }, "beats": 4 },
    { "chord": { "root": "D", "quality": "min" }, "beats": 4 }
  ],
  "length": 24,
  "meter": [4, 4],
  "tags": { "drums": ["driving"], "rhythm": ["funky"] },
  "layers": { "drums": true, "bass": true, "chords": true, "pad": true, "lead": true, "percussion": false },
  "jobs": { "lead": "melody", "percussion": "congas" },
  "seed": 1
}
```

| Feld | Pflicht | Standard | Regel |
| --- | --- | --- | --- |
| `key` | ja | - | `root` ist ein Notenname (`C`, `F#`, `Bb`), `mode` ist `minor`, `major` oder `dorian` |
| `bpm` | ja | - | 20 bis 400 |
| `bars` | ja | - | nicht leer; je Eintrag `chord: {root, quality}` und `beats` (ganze Zahl 1 bis 16) |
| `length` | nein | `24` | Anzahl Takte, 1 bis 512; `bars` läuft im Kreis darüber. Mit `form` **abgeleitet**: die Summe der `bars` der Teile (ein abweichender Wert wird überschrieben) |
| `meter` | nein | `[4, 4]` | Taktart `[Zähler, Nenner]`: `[4, 4]`, `[3, 4]`, `[6, 8]`, `[12, 8]` oder `[5, 4]` (Abschnitt "Taktarten, Raster und Grooves"); sie bestimmt das Raster und den Standard-Groove, eine andere Taktart meldet `badMeter`; fehlend oder `null` gilt `[4, 4]` wie bisher |
| `groove` | nein | Standard der Taktart | Groove-ID aus `GROOVES`; ein Groove einer anderen Taktart wird durch den Standard der Taktart ersetzt, eine unbekannte ID meldet `badGroove` |
| `complexity` | nein | `0.5` | Zahl von 0 bis 1 (sonst `badComplexity`); 0,5 und fehlend lassen alles wie es ist |
| `voices` | nein | Standard je Schicht | Wählbare Stimmen: `{ drums, bass, chords, pad, lead, percussion }`, je Schicht eine Stimmen-ID (`'string'`) oder `{ id, variant }` aus `VOICES` (`src/core/voices.js`, aus `src/index.js` exportiert). Fehlt etwas, gilt der heutige Klang `synth` / `classic` (bitgleich); eine gültige Stimme ohne Variante bekommt ihre erste. Unbekannte Schichten, Stimmen oder Varianten melden `badVoice` und lassen `play` werfen wie die anderen Felder; `null` gilt wie fehlend. Stimmen ändern nie den Ereignisstrom, nur den Klang |
| `tags` | nein | `{}` | `{Kategorie: [Schlagwort-IDs]}` (Objekt, je Kategorie ein Array), nur Kategorien und IDs aus `TAG_CATEGORIES`, sonst `badTags`; `null` gilt wie fehlend |
| `timbre` | nein | `{}` | Klangregler: `{Gruppe: {Feld: Zahl 0 bis 1}}` mit den Gruppen und Feldern von `DEFAULT_TIMBRE` (`src/core/timbre.js`: `drums`, `bass`, `chords`, `pad`, `lead`, `master`; der `lead` hat nur die drei Verzerrerfelder, die Percussion keine; die Percussion teilt den Raum-Regler des Schlagzeugs, `drums.room`, also seinen Hall-Sendeweg). Nur die gesetzten Felder zählen; sie liegen **über** dem, was die Schlagworte ergeben, und schlagen sie. Werte außerhalb von 0 bis 1 werden begrenzt; unbekannte Gruppen oder Felder, Nicht-Zahlen und ein Nicht-Objekt werden ohne Fehler ignoriert. Die Felder `fuzz`, `overdrive` und `distortion` gibt es in `bass`, `chords`, `pad` und `lead` (nicht beim Schlagzeug und bei der Percussion, dort werden sie ignoriert): eine Gitarren-Verzerrerkette auf der **ganzen Schicht** (nicht je Ton, die Töne eines Akkords mischen sich in der Kappung), in der Reihenfolge Overdrive (Tube Screamer: Mitten getrieben, Tiefen sauber, weich), Distortion (RAT: Bässe vorher beschnitten, viel Verstärkung, hart), Fuzz (Fuzz Face plus Big Muff: unsymmetrisch, mit Oktavklang und Sputtern, Mittensenke), dahinter eine Lautsprecherbox. Jeder Regler auf 0 schaltet seine Stufe aus; sind alle drei 0, geht das Signal unverändert durch (die Kette wird erst beim ersten Regler über 0 aufgebaut und bleibt dann bis zum Stopp bestehen). Die Verzerrer wirken auch auf schon klingende Töne (anders als die übrigen Klangfelder). Aufbau und Quellen: `docs/superpowers/specs/2026-11-09-guitar-effects-design.md` |
| `variety` | nein | `false` | `true` lässt den Seed (die Variante) mehr verändern: er streut Synkopen, Bass-Bewegung und Swing leicht innerhalb der Schlagwort-Werte, schaltet zusätzliche Muster frei und verschiebt sieben Klangfelder um höchstens ±0,08 (unter `timbre`, das gewinnt). Ohne den Schalter ist der Ereignisstrom bitgleich wie ohne dieses Feld; die eigene Oberfläche setzt ihn auf `true`. Das Klangmodell mit Drift liefert `resolveTrackTimbre(track)`, es braucht dafür den `seed` im Track |
| `layers` | nein | je Schicht ihr `defaultOn` | `drums`, `bass`, `chords`, `pad`, `lead`, `percussion` (`LAYER_IDS`); `false` lässt die Schicht aus dem Strom weg. Standard laut Register (`src/core/layers.js`, `layerDefaults()`): alle `true`, nur `percussion` ist `false`. Der `lead` ist also an, bleibt aber stumm, solange sein Job `off` ist |
| `jobs` | nein | erste Aufgabe je Schicht | Aufgabe je Schicht mit Aufgaben: `{ lead, percussion }`. `lead`: `off` (Standard), `fills`, `arpeggio`, `melody`, `callResponse`; `percussion`: `mixed` (Standard), `shaker`, `tambourine`, `congas`, `bongos`, `claves`, `cowbell` (`jobsFor(schicht)`, `isJob`, `completeJobs`, aus `src/index.js`). Eine Aufgabe bestimmt die **Ereignisse** der Schicht, nicht nur den Klang. Fehlt das Feld, eine Schicht darin oder ist sie `null`, gilt die erste Aufgabe; eine unbekannte Aufgabe oder eine Schicht ohne Aufgaben (etwa `bass`) meldet `badJob`, ein Wert, der kein Objekt ist, ebenso (`layer: '?'`) |
| `form` | nein | fehlt (keine Songform) | Songform: `{ template?, feel?, sections }`. `sections`: 1 bis 64 Teile `{ type, bars, level?, density?, transition?, crash?, locked? }` mit `type` aus `intro`, `verse`, `build`, `chorus`, `break`, `outro`, `bars` ganzzahlig 1 bis 64, `level` in dB relativ zum Refrain (-24 bis 0), `density` -1 bis +1, `transition` aus `none`, `fill`, `roll`, `stop`, `crash` und `locked` Wahrheitswerte; fehlende Werte gelten als Standard des Typs (`TYPE_TABLE` in `src/core/form-types.js`). `feel`: `structure`, `dynamics` (bis 1,3), `pauses`, `randomness`; fehlende Werte: 0,6 / 0,6 / 0,4 / 0,5. Die Gesamtlänge ist die Summe der `bars` (höchstens 512) und ersetzt `length`; die Akkordfolge `bars` beginnt in jedem Teil neu bei ihrem ersten Akkord. Unbekannte Felder werden ignoriert, Ungültiges meldet `badForm` (`params.reason`: `form`, `sections`, `type`, `bars`, `level`, `density`, `transition`, `crash`, `locked`, `feel`, `length`). Fehlt `form` (oder ist `null`), ändert sich nichts gegenüber dem bisherigen Verhalten |
| `seed` | nein | `1` | siehe Seed-Regel |

Weitere Felder (`id`, `title`, `style` ...) stören nicht und werden ignoriert. Ein Track im alten Format von Interactive Scales (`{ id, title, key, bpm, bars }`) ist gültig.

- Akkordarten: die 17 des Registers (Abschnitt "Akkordarten"). Akkordsymbole bleiben international (`B` bleibt `B`, nie das deutsche `H`).
- Jeder Akkord muss zur Tonart gehören: sein Grundton ist eine Stufe der Tonart (diatonisch, in Moll zusätzlich die Dur-Dominante) **und** seine Art darf laut Register auf dieser Stufe stehen (Spalte "erlaubt auf"). Sonst meldet `validateTrack` `chordNotInKey`, eine Art ohne Registereintrag `unknownQuality`. `allowedChords(key)` liefert unverändert nur die Dreiklänge der Stufen; die erlaubten Arten je Grundton liefert `chordOptions(key)`. Dorisch hat keine Zusatzakkorde (A-Dorisch: `Am Bm C D Em F#dim G`).
- `allowedChords` schreibt die Akkorde in der Vorzeichnung der Tonart (D-Moll: `Bb`, E-Moll: `F#dim`); ein Grundton mit `#` oder `b` behält sein Vorzeichen. Geprüft wird nach Tonhöhe, `A#` und `Bb` sind im Track gleichwertig.

## Akkordarten

Das Akkord-Register `CHORDS` (aus `src/index.js`, definiert in `src/core/chords.js`) ist die einzige Quelle für Intervalle, Symbole und die Stufen, auf denen eine Art stehen darf. `chordName({ root, quality })` liefert den Namen (`Am7`, `Cmaj7`, `G7`), `chordOptions(key)` je Grundton der Tonart die erlaubten Arten (`[{ root, qualities }]`, in Moll teilen sich die Moll-Stufe und die Dur-Dominante einen Grundton).

| Art (`quality`) | Symbol | Intervalle (Halbtöne) | erlaubt auf Stufen | Gruppe |
| --- | --- | --- | --- | --- |
| `maj` | (leer) | 0, 4, 7 | Dur | triad |
| `min` | `m` | 0, 3, 7 | Moll | triad |
| `dim` | `dim` | 0, 3, 6 | verm. | triad |
| `aug` | `aug` | 0, 4, 8 | Dur | triad |
| `sus2` | `sus2` | 0, 2, 7 | Dur, Moll | triad |
| `sus4` | `sus4` | 0, 5, 7 | Dur, Moll | triad |
| `power` | `5` | 0, 7 | Dur, Moll, verm. | triad |
| `dom7` | `7` | 0, 4, 7, 10 | Dur | seventh |
| `maj7` | `maj7` | 0, 4, 7, 11 | Dur | seventh |
| `min7` | `m7` | 0, 3, 7, 10 | Moll | seventh |
| `m7b5` | `m7b5` | 0, 3, 6, 10 | verm. | seventh |
| `dim7` | `dim7` | 0, 3, 6, 9 | verm. | seventh |
| `maj6` | `6` | 0, 4, 7, 9 | Dur | extended |
| `min6` | `m6` | 0, 3, 7, 9 | Moll | extended |
| `add9` | `add9` | 0, 4, 7, 14 | Dur | extended |
| `dom9` | `9` | 0, 4, 7, 10, 14 | Dur | extended |
| `min9` | `m9` | 0, 3, 7, 10, 14 | Moll | extended |

Die Grundart einer Stufe ist `maj`, `min` oder `dim` (Dur, Moll, vermindert). Die Dominante steht bei Dur auf der Stufe V, bei Moll ist es die ergänzte Dur-Dominante, bei Dorisch die Dur-Stufe IV. Die Muster nutzen die Intervalle des Akkords: der Bass spielt die Quinte und Septime des Akkords, Stabs und Pad alle seine Töne (ein Powerchord hat nur zwei), Arpeggios die ersten vier Töne zyklisch über die Oktaven (bei `dom9` und `min9` kommt die None darin nicht vor).

**Akkordfarbe** (nur die eigene Oberfläche; `colorProgression` in `src/core/harmony.js`, nicht aus `src/index.js`): schreibt die Arten einer Folge um, `triads` (Dreiklänge), `sevenths` (Septakkorde: Dur `maj7`, Dominante `dom7`, Moll `min7`, vermindert `m7b5`), `extended` (Dur `add9`, Dominante `dom9`, Moll `min9`, vermindert `dim7`) und `power` (Powerchords). Wählt man eine Farbe, während die Folge noch genau die aus Tonart und Variante erzeugte ist, wird sie in der neuen Farbe neu abgeleitet (verlustfrei, auch von `power` aus). Eine von Hand geänderte Folge wird umgefärbt; dabei geht bei `power` die Information über die Stufe verloren, weil `E5` in A-Moll nicht verrät, ob es die Moll-Stufe oder die Dominante war (zurück auf `triads` wird es `Em`).

### So ergänzt man eine Akkordart

1. In `src/core/chords.js` einen Eintrag in `CHORDS` ergänzen: `intervals` (aufsteigend, beginnt mit 0), `symbol` (eindeutig), `base` (`maj`, `min`, `dim` oder `null`), `on` (Grundarten der Stufen, auf denen die Art stehen darf), `group` (`triad`, `seventh`, `extended`), `fifth` (Quinte für den Bass) und optional `short` und `seventh` (der Ton, den der Bass statt der kleinen Septime spielt: die Septime des Akkords, bei Sext-Akkorden die Sexte).
2. Ihren Namen `chord.<id>` in `src/i18n/de.js` und `src/i18n/en.js` ergänzen.
3. `npm test` ausführen: `tests/core/chords.test.js`, `chord-events.test.js` und `i18n.test.js` laufen über alle Arten und melden Unvollständiges; sie schreiben weder die Anzahl noch eine vollständige Liste fest. Prüfung, Muster, Rad, Griffbrett, Namen und die Auswahl in der Oberfläche brauchen keine Änderung. Nur `tests/e2e/chord-picker.spec.js` hält für A-Moll feste Listen der aktiven Chips; erlaubt die neue Art dort eine Stufe, trägt man sie in diesen Listen ein.

## Taktarten, Raster und Grooves

`METERS` und `GROOVES` stehen in `src/core/grooves.js` und werden aus `src/index.js` ausgeführt. **`bpm` zählt die Schläge (den Puls) der Taktart**: bei 4/4, 3/4 und 5/4 Viertel, bei 6/8 und 12/8 punktierte Viertel. Je Takt gilt `Schritte = Schläge * Schritte je Schlag`.

| Taktart | Schläge je Takt | Schritte je Schlag | Raster |
| --- | --- | --- | --- |
| `4/4` | 4 | 4 | Sechzehntel |
| `3/4` | 3 | 4 | Sechzehntel |
| `5/4` | 5 | 4 | Sechzehntel |
| `6/8` | 2 | 3 | Achteltriolen |
| `12/8` | 4 | 3 | Achteltriolen |

`beats` je Takt (1 bis 16) bleibt erlaubt; Takte mit anderer Schlagzahl als die Taktart schneiden die Muster ab oder wiederholen sie. `swing` verschiebt nur im Sechzehntel-Raster; im Triolen-Raster trägt das Raster das Shuffle-Gefühl selbst. Zeiten und `chordTimeline` bleiben `Schläge * 60 / bpm`.

Ein Groove ist ein Datensatz mit Taktart, Fill-Länge (`fillBeats`, Schläge am Abschnittsende) und Mustern je Instrument in Stufen von einfach bis komplex:

| Groove | Name | Taktart | `fillBeats` |
| --- | --- | --- | --- |
| `straight` | Gerade | 4/4 | 2 |
| `latin` | Latin | 4/4 | 2 |
| `waltz` | Walzer | 3/4 | 1 |
| `waltzRock` | Rock-Walzer | 3/4 | 1 |
| `ballad68` | Ballade (6/8) | 6/8 | 1 |
| `rock68` | Rock (6/8) | 6/8 | 1 |
| `shuffle` | Shuffle | 12/8 | 2 |
| `slowBlues` | Langsamer Blues | 12/8 | 2 |
| `fiveFour` | Fünfviertel | 5/4 | 2 |

`straight` ist der bisherige Generator und bitgleich wie vorher. Standard je Taktart: `straight` (4/4), `waltz` (3/4), `ballad68` (6/8), `shuffle` (12/8), `fiveFour` (5/4).

**Komplexität** (`complexity`, 0 bis 1, Standard 0,5) verschiebt die Parameter, die die Stufen der Grooves wählen: `drive` und `bassMovement` um `complexity - 0.5`, `syncopation` um `0.6 * (complexity - 0.5)`, jeweils auf 0 bis 1 begrenzt. Die Schlagworte wirken weiter, der Regler liegt darüber; mehr Komplexität heißt mehr Geisternoten, dichtere Hi-Hat, mehr synkopierte Kicks und mehr Bass-Bewegung.

### So ergänzt man einen Groove

1. In `src/core/grooves.js` einen Eintrag in `GROOVES` ergänzen: `meter`, `fillBeats` und `drums`, `bass`, `chords` nach dem Aufbau des Kommentars dort (Stufen, `thresholds`, Muster im Raster der Taktart, Fills mit `fillBeats * Schritte je Schlag` Einträgen).
2. Seinen Namen `groove.<id>` in `src/i18n/de.js` und `src/i18n/en.js` ergänzen.
3. `npm test` ausführen: `tests/core/grooves.test.js` und `groove-events.test.js` laufen über alle Grooves (Schritte im Zyklus, Hi-Hat-Werte je Schlag, Ereignisse im Takt, Raster, Fills, Namen) und melden Unvollständiges. Die Oberfläche zeigt neue Grooves ihrer Taktart von selbst; nur die Pegelprüfung in `tests/e2e/sound.spec.js` läuft ebenfalls automatisch über alle Grooves.

## Stimmen: Synths und Saitenmodelle

Jede Schicht (`drums`, `bass`, `chords`, `pad`, `lead`, `percussion`) hat wählbare Stimmen in `src/core/voices.js` (`VOICES`, reine Daten). Eine Stimme ist ein Eintrag mit `kind` (`synth`, `model` oder später `sample`; so gruppiert die Oberfläche), `variants` (die erste ist der Standard) und `uses` (die Klangregler, auf die sie hörbar reagiert; Fuzz, Overdrive und Distortion gelten immer, die Verzerrerkette liegt hinter jeder Stimme). Aufgefüllt wird mit `completeVoices(voices)` / `resolveVoices(track)`; der Standard je Instrument ist `synth` / `classic`, der bisherige Klang.

Stand: `drums`: `synth/classic`, `sample/standard`, `sample/brushes`, `sample/rimshot`, `sample/jazz`, `sample/electronic`, `sample/808`; `bass`: `synth/classic`, `string/finger` (E-Bass), `sample/finger`, `sample/pick`, `sample/upright`; `chords`: `synth/classic`, `string/electric` (E-Gitarre clean), `epiano/rhodes` (FM), `sample/guitar`, `sample/epiano`, `sample/organ`, `sample/muted`, `sample/jazz`, `sample/funk`, `sample/steel`, `sample/nylon`, `sample/twelve`, `sample/freepats`, `sample/freepatsjazz`; `pad`: `synth/classic`, `sample/strings`, `sample/warm`; `lead`: `synth/classic`, `sample/flute`, `sample/sax`, `sample/synth`; `percussion`: `synth/classic`, `sample/studio`. Die Stimmen von Schlagzeug und Percussion spielen Schläge (`hit`), die übrigen Töne (`note`); `renderNote` lehnt die Schläge-Schichten ab.

- **Synthese** (`synth`, `epiano`): Web-Audio-Graph je Ton, die Klangregler wirken live auf neue Töne.
- **Saitenmodell** (`string`, `src/audio/string-model.js`, rein und ohne Browser): jeder Ton wird vorab als Puffer aus der Summe seiner abklingenden Obertöne berechnet (modal, mit Zupfposition, Tonabnehmer-Position, Abklingzeit je Oberton, Korpus; nicht als Karplus-Strong-Rückkopplung, siehe Kommentar dort). Die Stimmung ist besser als 0,5 Cent (gemessen mit den Standardwerten: 0,1 Cent über alle Töne von MIDI 24 bis 100), das Rauschen kommt aus dem Seed, ein Render ist reproduzierbar. Akkordtöne werden leicht gestaffelt (Strum).
- **Samples** (`sample`, Art `sample`; `src/audio/voices/sample.js`, `sampler.js`): Aufnahmen aus **MuseScore_General** (MIT-Lizenz; Samples größtenteils aus FluidR3, ebenfalls MIT; Quelle und Urhebervermerke: `src/assets/samples/LICENSE-MuseScore_General.md`). Varianten (GM-Programm in Klammern): Bass `finger` (33 Fingered Bass), `pick` (34 Picked Bass) und `upright` (32 Acoustic Bass); Akkorde `guitar` (27 Clean Guitar), `epiano` (4 Tine Electric Piano), `organ` (16 Drawbar Organ), `muted` (28 Palm Muted Guitar), `jazz` (26 Jazz Guitar) und `funk` (Bank 8, Programm 28 Funk Guitar), `steel` (25 Steel String Guitar), `nylon` (24 Nylon String Guitar) und `twelve` (Bank 8, Programm 25 12-String Guitar), dazu aus den **Freepats FSBS**-Gitarren (CC0, Version 2026-08-07, kleine SF2, Steg-Tonabnehmer; `src/assets/samples/LICENSE-Freepats-FSBS.md`) `freepats` (clean) und `freepatsjazz` (jazz): je 13 Samples für die Tasten 35 bis 86, 44,1 kHz, eine Anschlagstufe, 3 bis 20 s mit natürlichem Ausklingen; Pad `strings` (48 Strings Fast) und `warm` (89 Warm Pad); Lead `flute` (73), `sax` (65 Alto Sax) und `synth` (81 Saw Lead); Schlagzeug-Kits `standard`, `brushes` (Bank 128, Programm 40), `jazz` (32), `electronic` (24) und `808` (25), dazu `rimshot`, das **kein eigenes Pack** hat, sondern das Standard-Kit mit dem Seitenschlag (Taste 37) als Snare; Percussion `studio` (Shaker, Tamburin, Kuhglocke, Bongos, Congas, Claves aus dem Standard-Kit). Die Packs (`src/assets/samples/<schicht>-<variante>.json` und `.pcm`, 25 Stück, zusammen etwa 46 MB, einzeln unter 0,1 bis 2,8 MB, die Freepats-Gitarren 10,4 und 7,4 MB; Schlagzeug und Percussion behalten nur die benutzten Tasten; der Crash, Taste 49 „Crsh 1“ in allen fünf Kits, ist auf 2,5 s gekürzt und fehlt die Taste, bricht der Extraktor ab) werden erst geladen, wenn die Stimme gewählt ist, und je Seite einmal zwischengespeichert. **Bis das Pack bereit ist und wenn das Laden scheitert, spielt der klassische Synth** (kein Aussetzer, kein Fehler). `createInstruments(...)` liefert dazu `whenReady()` (Promise, wartet auf alle Packs der gewählten Stimmen, wirft nie) und `voiceStatus()` (`{ drums, bass, chords, pad, lead, percussion }` je `'none' | 'loading' | 'ready' | 'error'`); der Offline-Render (`renderOffline`, `compareRenders`, `renderNote`) wartet darauf. Ein erneutes Wählen einer Stimme im Fehlerzustand versucht das Laden noch einmal. Die Klangregler wirken als Tiefpass (`cutoff` beim Bass und Pad, `brightness` bei den Akkorden; ab 0,5 durchsichtig) und als Faktor auf Hüllkurvenzeiten (`length`, `attack`). Gitarrenakkorde sind Einzeltöne mit leichter Staffelung (Strum). Die Sample-Gitarre hat einen Entzerrer (Feinwerte `lowDb`, `midDb`, `midHz`, `highDb`, `highHz`, dazu ein Hochpass bei 50 Hz), weil das Preset ungefiltert nasal klingt: Es hat bei 1,6 bis 3,2 kHz so viel Energie wie in den Mitten, Synth und Saitenmodell liegen dort 10 bis 35 dB darunter.

### So baut man die Packs neu

Die `.sf3` liegt **nicht** im Repository (39,9 MB, [MuseScore_General.sf3](https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3)). `node scripts/extract-samples.mjs <MuseScore_General.sf3>` schneidet daraus die Packs (Voraussetzung: `ffmpeg`; er dekodiert die Ogg-Vorbis-Samples zu 16-Bit-PCM, das hält die Laufzeit codec-frei). Ein anderes Instrument oder eine andere Quelle: Eintrag in `PACKS` im Skript (`bank` und `program` des Presets, bei Schlagzeug und Percussion `keys`), Stimme im Register und in `IMPLS` (`src/audio/voices/index.js`), Namen, Feinwerte (`level` nach Messung gegen den Synth, Band 0,7 bis 1,4). Aufruf: `node scripts/extract-samples.mjs <MuseScore_General.sf3> [ausgabeordner]`.

- **Feinwerte** (`src/audio/voices/tunables.js`, `TUNABLES`): je Stimme eine Tabelle `{ Name: { min, max, step, value } }` mit den inneren Werten (Zupfposition, Tonabnehmer, FM-Verhältnis ...). `value` ist der ausgelieferte Standard.
- **Natürlichere Sample-Gitarren** (`chords/sample/` `guitar`, `muted`, `jazz`, `funk`, `steel`, `nylon`, `twelve`, `freepats`, `freepatsjazz`): Feinwerte `velExp` (Anschlagkurve, Pegel = Anschlag hoch velExp, Standard 1,6), `softHz` (Tiefpass bei leisem Anschlag, Standard 3500 Hz bei Anschlag 0,2, 20000 = aus), `oneShot` (1: nie die kurze Endschleife spielen, das Sample klingt an seinem Ende aus), `humanCents` und `humanDb` (Zufallsabweichung je Anschlag, ±2,5 Cent und ±0,8 dB, aus dem Seed der Stimme, ein Render bleibt reproduzierbar); die Clean Guitar hat einen milderen Entzerrer (`lowDb 5`, `midDb -6`, `highDb -4`). Den alten Klang stellen `velExp 1`, `softHz 20000`, `oneShot 0`, `humanCents 0`, `humanDb 0` und die alten Entzerrer- und Pegelwerte wieder her (`legacyTuning` in `scripts/render-ab.mjs`). `node scripts/render-ab.mjs [ausgabeordner]` schreibt je Gitarre einen Akkordlauf vorher/nachher als WAV (die Freepats-Gitarren nur nachher) (Standard `.superpowers/audio-ab/`).

### Stimmenwahl in der Oberfläche

In den Klanggruppen aller sechs Schichten (linke Leiste) wählt ein Dropdown **Stimme** (nach Art gruppiert: Synthese, Samples; die Saitenmodelle sind mit `hidden: true` im Register aus der Auswahl genommen, Track-Feld, `setVoices` und die Hörprobe-Seite kennen sie weiter) und, bei mehreren Varianten, ein Dropdown **Variante** die Stimme (`src/ui/voices-panel.js`). Die Wahl steht in `state.track.voices`, wirkt live über `setVoices` und bleibt bei einem Stilwechsel stehen. Bei Sample-Stimmen zeigt die Gruppe den Ladezustand (lädt, bereit, nicht verfügbar). Regler, die die gewählte Stimme nicht benutzt (Liste `uses` im Register; `usesTimbreField(voices, 'gruppe.feld')` in `src/core/voices.js`, Verzerrer gelten immer), sind ausgegraut.

### So ergänzt man eine Stimme

1. Eintrag in `src/core/voices.js` (`kind`, `variants`, `uses`).
2. Klangerzeugung in `src/audio/voices/` (eine Funktion `(layer, ctx, deps) => (out, t, e) => void`; `deps.params` sind die live aktualisierten abgeleiteten Parameter, `deps.getTimbre()` die rohen Klangregler, `deps.tuned(name)` ein Feinwert, `deps.rng` das Rauschen) und Eintrag in `IMPLS` in `src/audio/voices/index.js`.
3. Feinwerte, falls es welche gibt, in `TUNABLES`; Pegel gegen die Standardstimme angleichen (Band 0,7 bis 1,4 des rms).
4. Namen `voice.<layer>.<id>` und `variant.<layer>.<id>.<variant>` in `de.js` und `en.js`.
5. `npm test`: `tests/core/voices.test.js` und `voices-impl.test.js` prüfen Register, Namen, Umsetzung und Feinwerte.

### Aufgaben in der Oberfläche

In der Gruppe Lead steht ein Dropdown **Lead-Aufgabe**, in der Gruppe Percussion ein Dropdown **Percussion-Part** (`src/ui/jobs-panel.js`, Optionen aus `jobsFor` des Registers, Namen `job.<schicht>.<aufgabe>`). Die Wahl steht in `state.track.jobs`, wirkt live über `setTrack` und bleibt bei einem Stilwechsel stehen.

### Profile (Baum, Teile, Export, Import)

Der Knopf „Profile“ neben dem Mischpult öffnet ein Fenster (`src/ui/profiles.js`). Links steht ein Baum (WAI-ARIA-Baum: ein Tabstopp, Pfeiltasten, Pos1/Ende, Rechts/Links klappt auf und zu), rechts das Feld zur Auswahl. Breit (ab 46 rem Fensterbreite) steht der Baum links (15 bis 20 rem breit, das Fenster höchstens 56 rem), schmal liegen Baum und Feld untereinander (Baum zuerst). Die Zeilen:

- **Aktuelle Sitzung** (Kurzbeschreibung mit „Stil: …“; hier speichert man die Sitzung als Profil und importiert).
- **Werksprofile**: nur lesbar, die 9 Stile aus `STYLE_PRESETS`.
- **Meine Profile**: beliebig verschachtelte Ordner und Profile, im Browser gespeichert; nach Name sortiert, Ordner zuerst, keine manuelle Reihenfolge. Zugeklappte Ordner und die Auswahl gelten nur bis zum Neuladen.

Die „Schnellauswahl“ (Stil-Chips in der Leiste „Klang“) gibt es nicht mehr: ein Stil wird über das Werksprofil geladen. Die Stil-Karten im Popover „Stil“ der Startseite bleiben. Sichtbare Folge: Der Stil der Sitzung (`state.style`) bleibt auch nach eigenen Änderungen an Schlagworten oder Tempo stehen und wird in „Aktuelle Sitzung“ angezeigt; es gibt keine Hervorhebung „Vorlage passt nicht mehr“ mehr.

#### Die 9 Teile eines Profils

Ein Profil hält nur die Teile, die beim Speichern angehakt waren (`PART_IDS`, `src/core/profile-parts.js`). **Fehlt ein Teil, ist er nicht im Profil und wird beim Laden nicht angefasst.** Innerhalb eines Teils heißt ein fehlendes Feld „nicht enthalten“, ein ausdrückliches `null` heißt „Standard“ (Wert zurücksetzen).

| Teil (`parts.…`) | Felder | Bedeutung |
| --- | --- | --- |
| `harmony` | `key` {root, mode}, `scale`, `bars`, `chordColor`, `chordColorFromStyle`, `meter` | Tonart, Akkorde und Taktart |
| `tempo` | `bpm`, `meter` | Tempo; `meter` (optional, z. B. `[4, 4]`) ist die Taktart, in deren Puls `bpm` zählt (`captureParts` schreibt die Taktart der Sitzung) |
| `rhythm` | `groove`, `complexity`, `length` | `groove` (Id) und `complexity` (0 bis 1) sind `null`, wenn die Sitzung den Standard hat; beim Laden wird das Feld dann aus dem Track **entfernt** (Standard-Groove der Taktart, Komplexität 0,5). Fehlt das Feld, bleibt der Wert der Sitzung. `length` ist die Taktzahl |
| `style` | `style` (Id), `tags` | Stil und Schlagworte |
| `sound` | `timbre` | die Regler-Überschreibungen; `{}` setzt alle Regler zurück |
| `voices` | `voices`, `jobs` | Stimmen und Aufgaben je Schicht; `captureParts` hält die vollständige Wahl fest (je Instrument bzw. Schicht mit Aufgaben ein Eintrag, auch der Standard), damit ein Profil mit Standardstimmen eine später gewählte Stimme zurücksetzt |
| `layers` | `layers` | Schichtschalter |
| `mixer` | `mix` | Mischpult-Pegel (je Schicht und `master`, 0 bis 1) |
| `variant` | `seed`, `variety` | Variante (1 bis 9999 in der Oberfläche; Datei: ganze Zahl 0 bis 4294967295) und der Schalter für mehr Abwechslung |

`captureParts(session, ids)` hält die Sitzung `{ track, scale, style, chordColor, chordColorFromStyle, mix }` (die Form von `state`, `src/ui/profile-session.js` liest und schreibt sie) als tiefe Kopie fest. Layout und Sprache gehören nie dazu. Die Auswahl im Fenster hat die Schnellwahlen Alles, Klang (`sound`, `voices`, `mixer`), Rhythmus (`tempo`, `rhythm`) und Nichts (`PART_PRESETS`); ohne einen Haken wird nicht gespeichert.

**Laden** (`applyParts(session, parts)`, rein: die Eingabe bleibt unverändert): Die Werte der vorhandenen Teile ersetzen die der Sitzung. Die Objekte `layers`, `mix`, `voices` und `jobs` werden je Schlüssel gemischt (ein Profil, das nur `lead` enthält, ändert nur `lead`); `timbre`, `tags` und `bars` ersetzen im Ganzen. Das Ergebnis wird als Track geprüft (`validateTrack`, dieselben Codes wie überall). **Ist es ungültig, ändert sich nichts**: `{ ok: false, errors }`, die Meldung erscheint im Fenster; sonst `{ ok: true, session }`, und eine laufende Wiedergabe startet neu. Besonderheiten:

- Passt `scale` nicht zum Modus von `key`, gilt die Standardskala des Modus.
- Nur `tempo` setzt `bpm`. Hat der Teil ein `meter` mit anderem Puls als die Taktart nach dem Laden (die der Sitzung, oder die von `harmony`, wenn derselbe Ladevorgang sie wechselt), wird wie beim Taktartwechsel umgerechnet (`convertTempo`: gleiche Achtelgeschwindigkeit, auf 40 bis 200 begrenzt); 100 aus 4/4 wird in 6/8 zu 67. Ohne `meter` (ältere Profile und Dateien) gilt `bpm`, wie es ist. Ein ungültiges `meter` fällt beim Einlesen weg und wird gezählt.
- Der Teil `style` setzt nur Stil und Schlagworte, nicht die Akkordfarbe und färbt keine Akkorde um. `harmony` setzt `chordColor` und `chordColorFromStyle` aus den eigenen Werten.

**Werksprofile:** Laden ist genau das, was `applyStyle(id)` tut (Stil, Schlagworte, Tempo mit Umrechnung auf die Taktart, Akkordfarbe des Stils, Klangregler zurücksetzen, laufende Wiedergabe live anpassen). „Kopie in Meine Profile speichern“ legt ein eigenes Profil mit den Teilen `style`, `tempo` (das Stiltempo mit `meter: [4, 4]`, also beim Laden wie „Laden“ des Werksprofils auf die Taktart umgerechnet, egal in welcher Taktart die Kopie entstand) und `sound` (`timbre: {}`) an, ohne Akkordfarbe (`factoryParts` in `src/ui/profile-factory.js`); die Kopie wird gewählt und „Meine Profile“ geht auf. Werksprofile lassen sich nicht ändern oder löschen.

#### Dateiformate

```json
{ "format": "backingtrack-profile", "version": 2, "name": "Mein Groove", "parts": { "tempo": { "bpm": 96, "meter": [4, 4] }, "rhythm": { "groove": null, "complexity": 0.7, "length": 24 } } }
{ "format": "backingtrack-folder", "version": 1, "name": "Meine Profile", "backup": true, "items": [
  { "type": "folder", "name": "Blues", "items": [ { "type": "profile", "name": "Langsam", "parts": { "tempo": { "bpm": 70 } } } ] },
  { "type": "profile", "name": "Mein Groove", "parts": { "tempo": { "bpm": 96 } } } ] }
```

„Alles sichern“ ist ein Ordner mit dem Namen „Meine Profile“ (alles darunter) und dem Feld `"backup": true`. Die Wurzel einer Sicherung ist nur ein Behälter: ihre Einträge haben Ebene 1, sie selbst zählt nicht als Knoten, und beim Import kommen die Einträge einzeln in den gewählten Ordner (kein zusätzlicher Ordner „Meine Profile“); die Sicherung ergänzt den Ordner und ersetzt nichts, die Meldung lautet „Sicherung mit n Profilen aufgenommen.“. Ältere Versionen ignorieren das Feld und nehmen die Sicherung als gewöhnlichen Ordner auf. Der Export eines gewählten Ordners hat das Feld nicht und wird als ein Ordner wieder eingelesen; `backup` mit einem anderen Wert als `true`/`false` zählt als ungültig. Der Export schreibt alle Felder, die er kennt, und nie die internen Ids. Dateiname beim Speichern in der Sprache der Oberfläche: `backingtrack-profil-<Datum>.json` bzw. `backingtrack-ordner-<Datum>.json` (englisch `backingtrack-profile-…` bzw. `backingtrack-folder-…`). Ein Ordner ohne Einträge wird nicht exportiert („Nichts zu sichern“), weil er sich nicht wieder einlesen ließe.

**Einlesen** (`parseFile(text|objekt)` in `src/core/profile.js`, wirft nie) liefert `{ ok: true, node, skipped }` (`node` ohne Ids, `skipped` zählt verworfene Felder, Teile und Knoten, die Meldung nennt die Zahl) oder `{ ok: false, errors: [{ code: 'badProfile', params: {} }] }`. Die Regeln:

1. Unbekannte Felder werden überall ignoriert (oberste Ebene, in Teilen, in Knoten); `__proto__`, `constructor` und `prototype` zählen als ungültig.
2. Ein fehlendes oder ungültiges Feld fehlt im Ergebnis, der Rest bleibt (`sanitizeParts(raw)` liefert `{ parts, skipped }`). Die Körnung: in `voices`, `jobs`, `layers`, `mix` und `timbre` fällt ein ungültiger Eintrag allein weg (unbekannte Id bleibt still unberücksichtigt, Wert außerhalb des Bereichs wird gezählt); `tags` und `bars` sind je ein Wert. Ein Teil ohne jeden brauchbaren Inhalt fällt ganz weg. **`harmony` ist unteilbar:** `key`, `bars` und `meter` müssen vollständig sein und zusammen einen gültigen Track ergeben (Akkorde in der Tonart, Schläge je Takt gleich der Taktart, höchstens 512 Takte), sonst fällt der ganze Teil weg; `scale`, `chordColor` und `chordColorFromStyle` hängen davon nicht ab.
3. `version` ist nur eine Information: eine höhere Version wird nach bestem Wissen gelesen, nicht abgelehnt.
4. Abgelehnt (`badProfile`, nichts ändert sich) wird nur: kein JSON oder kein Objekt, unbekanntes `format`, ein Text über 5 000 000 Zeichen, nach dem Bereinigen kein Teil (Profil) bzw. kein Knoten (Ordner).
5. **Alte Dateien** (Version 1, ohne `parts`: `track`, `scale`, `style`, `chordColor`, `chordColorFromStyle`, `mix`) werden gelesen und auf alle 9 Teile abgebildet (ohne `meter` gilt 4/4). Brauchbar sind sie nur, wenn der Teil `harmony` gültig ist.
6. Namen: Randleerzeichen weg, höchstens 60 Zeichen, leer wird „Importiert“.

Grenzen: `LIMITS = { name: 60, depth: 8, nodes: 1000, file: 5_000_000 }`. Tiefe 8 zählt so: die Einträge direkt in „Meine Profile“ haben Ebene 1, der oberste Knoten einer Datei hat Ebene 1, bei einer Sicherung dessen Einträge (beim Import kommt die Ebene des Zielordners dazu). Was tiefer läge, fällt weg (ein Ordner auf Ebene 8 bleibt, sein Inhalt nicht) und wird gemeldet; ebenso alles ab dem 1001. Knoten (Ordner und Profile zählen; Speichern und Anlegen melden dann `tooMany`). Beim Einlesen der Datei zählt das als übersprungene Angabe (`skipped`); was erst beim Aufnehmen in den Zielordner zu tief läge oder keinen Platz mehr hat, zählt `importNode` als `dropped` (jeder Knoten samt Inhalt), und die Meldung sagt „n Einträge wurden übersprungen (zu tief verschachtelt oder zu viele Einträge).“ Eine Datei aus dem Fenster ist höchstens 5 MB.

#### Speicher und Migration

Der Baum liegt unter `backingtrack.profiles` im `localStorage` (`src/ui/profile-store.js`, `loadTree`/`saveTree`): `{ "version": 2, "items": [ Knoten ] }`, Knoten wie im Ordnerformat plus eine zufällige `id` (für Auswahl und Verschieben). Beim Laden wird jeder Knoten einzeln bereinigt: Defektes fällt weg, Ids und Namen werden repariert (doppelte oder die festen Schlüssel `session`, `mine`, `factory`, `factory:…` bekommen neue Ids), unbekannte Felder werden nicht übernommen. Eine **alte flache Liste** (Array von `{ name, profile }`, Format 1) wird in die oberste Ebene von „Meine Profile“ übernommen, jedes Profil mit allen 9 Teilen; Unbrauchbares fällt weg. Beim Laden wird nichts zurückgeschrieben, erst die erste Änderung speichert das neue Format. Misslingt das Speichern (Speicher gesperrt oder voll), gilt die Änderung bis zum Neuladen und die Meldung sagt es; Export als Datei oder Text bleibt möglich. Die Baum-Operationen (`src/core/profile-tree.js`: `addFolder`, `addProfile`, `renameNode`, `removeNode`, `overwriteParts`, `moveNode`, `importNode`, `canMove`, `moveTargets`, `validName`, `freeName`) sind rein und liefern einen neuen Baum oder `{ ok: false, code }`.

#### Auswahl, Export und Import

Das Gewählte bestimmt Rechtsfeld, Export und Importziel:

| Auswahl | Rechts | Export („Als Datei“, „Kopieren“) |
| --- | --- | --- |
| Aktuelle Sitzung | Als Profil speichern (Name, Ordner, Inhalt als eingeklappte Zeile), Import | die Sitzung als Profil mit allen 9 Teilen |
| Werksprofil | Laden, Kopie speichern | Profil mit den Teilen `style`, `tempo`, `sound` |
| Eigenes Profil | Laden, Mit Sitzung überschreiben, Umbenennen, Verschieben nach …, Löschen | das Profil |
| Ordner (auch „Meine Profile“) | Neuer Unterordner, Umbenennen, Verschieben nach …, Löschen (Rückfrage, wenn nicht leer), Import | der Ordner samt Inhalt; „Meine Profile“ = alles |

„Alles sichern“ steht unten und ist immer sichtbar. **Import** (aus Datei oder Textfeld) geht in den gewählten Ordner (ist ein Profil gewählt: dessen Ordner; bei „Aktuelle Sitzung“ und „Meine Profile“: oberste Ebene). Ein einzelnes Profil wird aufgenommen und **ausgewählt**, nicht geladen; ein Ordner wird mit seiner Struktur aufgenommen, die Auswahl bleibt, die Meldung nennt die Zahl der Profile (und die der übersprungenen Angaben und der Einträge, die zu tief lägen oder keinen Platz mehr hatten). Gleiche Namen bekommen „ (2)“, „ (3)“ … (mit dem Zusatz höchstens 60 Zeichen).

**Namen:** Innerhalb eines Ordners ist ein Name eindeutig, ohne Unterschied zwischen Ordner und Profil und ohne Beachtung der Groß-/Kleinschreibung. „Als Profil speichern“, „Umbenennen“ und „Neuer Unterordner“ mit einem vergebenen oder leeren Namen werden **abgelehnt** (Meldung, nichts wird ersetzt; beim Speichern mit dem Hinweis auf „Mit Sitzung überschreiben“). Import, Verschieben und „Kopie speichern“ hängen stattdessen „ (2)“ an.

**Mit Sitzung überschreiben** ersetzt nur die angehakten Teile des gespeicherten Profils (`overwriteParts`, `mergeParts`); nicht angehakte Teile bleiben, wie sie waren. Die Haken starten mit den Teilen, die das Profil schon hat; fehlende lassen sich dazuhaken. Einen Teil aus einem Profil zu entfernen geht nicht.

**Rückgängig:** Nach Löschen, Verschieben (auch Ziehen), Überschreiben und Import erscheint „Rückgängig“ in der Meldungszeile. Es gilt nur für den **Baum der gespeicherten Profile**, nie für die Sitzung (Laden lässt sich nicht rückgängig machen; wer das braucht, speichert die Sitzung vorher als Profil), eine Stufe, und jede andere Änderung des Baums (Umbenennen, Neuer Unterordner, Speichern, Kopie) verwirft es.

**Verschieben:** „Verschieben nach …“ ist immer da (Auswahl aller gültigen Zielordner, eingerückt; Tastatur, Screenreader, Touch). Zweiter Weg ist das Ziehen am Griff ⋮⋮ (Pointer Events, `src/ui/profile-drag.js`, kein HTML5-Drag-and-drop): die Maus nach 8 px Bewegung, Touch und Stift erst nach langem Drücken (400 ms ohne Bewegung über 8 px, mit kurzem Vibrieren, wo vorhanden); wer vorher bewegt, scrollt den Baum (kann der Baum nicht scrollen, etwa weil er kurz ist, das Fenster) und zieht in diesem Druck nicht mehr. Am oberen und unteren Rand (40 px) scrollt der Baum mit. Die Zeile unter dem Zeiger trägt `data-drop="ok"` oder `"no"`; gültig sind „Meine Profile“ und eigene Ordner, nicht der Ordner, in dem der Eintrag schon liegt, nicht er selbst oder seine Unterordner, nicht Ziele, bei denen die Tiefe über 8 ginge, nie Werksprofile. Loslassen außerhalb, Escape (die Auswahl bleibt), `pointercancel` und ein verlorenes Loslassen brechen ab. Gezogen werden nur eigene Einträge.

**Fehlercodes:** `badProfile` (Text `err.badProfile`) steht für alles Unlesbare beim Einlesen; er gehört nicht zu den 15 Codes von `validateTrack`. Ein Laden, das den Track ungültig machen würde, meldet dessen Codes. Fehler der Baum-Operationen (`nameEmpty`, `nameTaken`, `tooDeep`, `tooMany`, `notFound`, `invalidTarget`) sind Meldungen des Fensters (`ui.profileErr.<code>`).

### Hörhilfen für die Entwicklung

Der Klang lässt sich nur teilweise messen. Dafür gibt es: die **Hörprobe-Seite** `/ui/render-harness.html` (Stimme und Variante je Instrument wählen, auch während des Spiels; Feinwerte live verstellen; **Werte exportieren** liefert den JSON-Text für `tunables.js`; "Ton anspielen" spielt eine Einzelnote) und die **Spektrogramm-Seite** `/ui/spectrogram.html` (Spektrogramm, Obertonverläufe, Anschlagszeit, Grundton in Cent, Spektralschwerpunkt einer Stimme, optional neben einer Referenzaufnahme). Als Bild: `node scripts/spectrogram.mjs <ausgabe.png> "layer=bass&id=string&variant=finger&midi=40" [referenz.wav]`.

## Schlagworte und Stile

- `TAG_CATEGORIES`: `[{ id, tags: [id, ...] }]`, alle Kategorien und Schlagwort-IDs, die der Generator kennt.
- `STYLE_PRESETS`: `[{ id, bpm, tags, chordColor?, chordColorAlt? }]`. `tags` kann direkt in einen Track übernommen werden, `bpm` ist der Vorschlag des Stils. `chordColor` (`triads`, `sevenths`, `extended`, `power`; fehlt es, gelten Dreiklänge) ist die Akkordfarbe, die die eigene Oberfläche beim Wählen des Stils setzt (Blues: Septakkorde, Hardrock und Pop-Punk: Powerchords); mit `variety` wählt der Seed in etwa jeder vierten Variante die Ausweichfarbe `chordColorAlt` (Blues: Erweiterungen, Hardrock und Pop-Punk: Dreiklänge). Die Berechnung steht in `styleChordColor(preset, seed, variety)` in `src/core/tags.js` (nicht aus `src/index.js` exportiert); die Schnittstelle selbst ignoriert beide Felder.
- Aufbau (Kategorie `development`) in Abschnitten zu 8 Takten, der letzte Abschnitt spielt immer alles: ohne Angabe Bass, Schlagzeug und Akkorde, Pad erst im letzten Abschnitt; `fullFromStart` alles von Anfang an; `buildsSlowly` Bass und Schlagzeug ab Takt 1, im zweiten Abschnitt kommt (je Seed) Akkorde oder Pad dazu, ab dem dritten alles. Der Aufbau beginnt mit jedem Durchlauf über `length` Takte neu.
- Klang-Schlagworte: vier Kategorien (`drumSound`, `bassSound`, `chordSound`, `padSound`) und die früher wirkungslosen Schlagworte `gritty`, `warm`, `dark`, `bright`, `psychedelic` ändern den **Klang**, dazu `dreamy`. `dreamy` war nie wirkungslos: es behält seine alte Muster-Wirkung (`padWidth` +0.2, kann über 0.6 das Pad-Voicing verdoppeln) und wirkt zusätzlich auf den Klang. Zusammen sind es 26 klangrelevante Schlagworte:

  | Kategorie | Schlagwort-IDs | Wirkung |
  | --- | --- | --- |
  | `drumSound` | `punchy` | Kick kräftiger und kürzer, Snare knackiger |
  | | `boomy` | Kick länger, weniger Anschlag |
  | | `snappy` | Snare mit mehr Anschlag und Ton |
  | | `crisp` | Hi-Hats heller und kürzer |
  | | `roomy` | Schlagzeug mit Raumhall |
  | `bassSound` | `sub` | zusätzlicher Sub-Bass, dunklerer Filter |
  | | `fuzz` | übersteuerter, zerrender Bass |
  | | `plucky` | gezupfter Anschlag: Filter fällt schneller, der Ton klingt ab |
  | | `round` | runder, weicher Bass |
  | | `resonant` | Filterresonanz, Bass „quakt“ |
  | `chordSound` | `mellow` | Akkorde dunkler und weicher |
  | | `biting` | Akkorde heller und kürzer, bissig |
  | | `chorused` | Chorus auf den Akkorden |
  | | `tremolo` | Lautstärke-Tremolo auf den Akkorden |
  | | `ringing` | Akkorde klingen länger aus |
  | `padSound` | `swelling` | Pad setzt langsam ein |
  | | `airy` | luftiges Pad mit Schimmer, offener Filter |
  | | `glassy` | gläsernes, dünnes Pad mit viel Schimmer |
  | | `thick` | dickes, breit verstimmtes Pad |
  | | `moving` | Filter des Pads bewegt sich schneller und tiefer |
  | `bass` | `gritty` | leichte Zerrung im Bass |
  | `synths` | `warm` | Akkorde und Pad dunkler, Bass runder, Summe etwas dunkler |
  | `mood` | `dark` | Summe dunkler, Hi-Hats, Akkorde und Pad gedämpft |
  | | `bright` | Summe heller, Hi-Hats heller |
  | | `psychedelic` | mehr Echo und Hall, Chorus auf den Akkorden, tiefere Pad-Bewegung |
  | | `dreamy` | mehr Hall, Pad setzt etwas langsamer ein |

- Die 25 Schlagworte ohne `dreamy` (die 20 der vier Klang-Kategorien sowie `gritty`, `warm`, `dark`, `bright`, `psychedelic`) ändern **nur den Klang, nie den Ereignisstrom**: `buildEvents` liefert für denselben Track mit und ohne sie dieselben Ereignisse. `dreamy` behält seine alte `padWidth`-Verschiebung und kann deshalb weiterhin Ereignisse ändern. Tracks mit festem Seed behalten ihre Noten; die Golden-Hashes der drei Stile bleiben unverändert, weil deren Muster-Schlagworte (darunter `dreamy` im Stil Träumerisch) gleich geblieben sind und sich nur Klang-Schlagworte geändert haben (hinzugekommen; bei `funk` fiel `warm` weg). Der Klang liegt in einem internen Klangmodell (`resolveTimbre(tags)` in `src/core/timbre.js`, nicht aus `src/index.js` exportiert), das nur das Audio liest.
- `withBreakouts` (Kategorie `development`) hat weiterhin keine Wirkung, ist aber gültig. Unbekannte Kategorien und Schlagworte werden wie bisher abgelehnt (`badTags`).
- Die Presets in `STYLE_PRESETS` führen alle zehn Kategorien (leere Liste, wo nichts gewählt ist); ihre Klang-Schlagworte sind: `funk` kräftig und knackig (Schlagzeug), gezupft (Bass), bissig (Akkorde), ohne `warm` (das dunkelte die ganze Mischung ab und arbeitete gegen `biting`); `psych` Fuzz-Bass, Chorus-Akkorde, anschwellendes und gläsernes Pad; `dreamy` räumliches Schlagzeug, runder Bass, weiche Akkorde, luftiges und anschwellendes Pad.
- Beschriftungen über `t`: `category.<id>`, `tag.<Kategorie>.<id>`, `style.<id>` (Hinweis: `style.<id>.hint`), `layer.<name>`, `scale.<name>`, `mode.<name>`.

## Seed-Regel

- Ein Track ohne `seed` ist gültig und bedeutet Seed 1: wiederholte Aufrufe liefern identische Ausgabe.
- Ein Track mit `seed` ist wiederholbar: gleiche Eingabe plus gleicher Seed ergibt denselben Strom (der Seed wird mit `>>> 0` zu einer 32-Bit-Zahl).
- Die Ausgabe für feste Seeds ist durch einen Golden-Test festgehalten (`tests/core/golden.test.js`: SHA-256 des Stroms für die drei Stile und einen Track im alten Format). Ändert sich der Strom gewollt, ändert sich der Klang bestehender Übungen; das wird beim Aktualisieren der Werte bewusst entschieden.
- Will Interactive Scales Abwechslung, würfelt es selbst einen Seed (zum Beispiel eine Zufallszahl 1 bis 9999) und gibt ihn mit. Soll eine Übung immer gleich klingen, gibt es einen festen Seed mit.

## `buildEvents(track)` und der Ereignisstrom

Berechnet vorab, ohne Audio, den nach `t` sortierten Strom (bei gleichem `t`: `chord`, dann `marker`, dann der Rest). Wirft bei ungültigem Track einen `Error` mit `err.errors` (siehe Prüfung).

```js
// Beispiel bei 120 bpm, lauter 4/4-Takte (ein Takt = 2 s): Takt 3 beginnt bei t = 6.0
{ t: 6.0,  bar: 3, beat: 0,   type: 'chord',  chord: { root: 'D', quality: 'min' } }   // ein Ereignis je Takt
{ t: 6.0,  bar: 3,            type: 'marker', name: 'fill' }                           // am Taktanfang
{ t: 7.25, bar: 3, beat: 2.5, type: 'hit',  layer: 'drums', name: 'snare', vel: 0.8 }  // 6.0 + 2.5 * 0.5
{ t: 7.25, bar: 3, beat: 2.5, type: 'note', layer: 'bass',  midi: 33, vel: 0.9, dur: 0.25 }
{ t: 7.5,  bar: 3, beat: 3,   type: 'note', layer: 'lead',  midi: 81, vel: 0.6, dur: 0.25 }    // Lead, wenn sein Job nicht off ist
{ t: 7.5,  bar: 3, beat: 3,   type: 'hit',  layer: 'percussion', name: 'congaHigh', vel: 0.5 } // Percussion, wenn die Schicht an ist
```

(Die echten Zeiten von `hit` und `note` weichen durch Swing und leichtes Timing-Jitter um wenige Millisekunden von der Rasterzeit ab.)

- `t`: Sekunden ab Start (auf 6 Stellen gerundet). `bar`: 0-basierter Takt. `beat`: 0-basierte Rasterposition im Takt in Schlägen (Sechzehntel = 0.25).
- `hit` hat `layer: 'drums'` und einen Namen aus `kick`, `snare`, `hat`, `openHat`, `tomHigh`, `tomMid`, `tomLow`, `crash` (`DRUM_NAMES` aus `src/index.js`). Geisternoten sind `snare` mit `vel < 0.3`.
- `hit` mit `layer: 'percussion'` hat einen Namen aus `shaker`, `tambourine`, `congaHigh`, `congaLow`, `bongoHigh`, `bongoLow`, `claves`, `cowbell` (`PERCUSSION_NAMES` aus `src/index.js`); die Anschläge liegen unter 0,8, die Schicht spielt hinter dem Schlagzeug. Welche Namen vorkommen, bestimmt `jobs.percussion` (`mixed`: Shaker, Tamburin und Congas; `congas`: `congaHigh` und `congaLow`; `bongos`: `bongoHigh` und `bongoLow`; die übrigen je ihr eigener Name).
- `note` hat `layer` `bass`, `chords`, `pad` oder `lead`, `midi`, `vel` (0 bis 1) und `dur` in Sekunden. Der `lead` ist einstimmig, liegt zwischen MIDI 72 und 88 (eine Oktave über den Akkorden) und nimmt Töne der Tonleiter der Tonart (Moll: Moll-Pentatonik, Dur: Dur-Pentatonik, Dorisch: dorisch) und des Akkords im Takt; seine Aufgabe (`jobs.lead`) bestimmt das Muster: `fills` kurze Phrasen am Taktende in der zweiten Hälfte eines Abschnitts, `arpeggio` einen Lauf durch die Akkordtöne, `melody` lange, spärliche Töne, `callResponse` eine Phrase und im nächsten Takt die Antwort; `off` liefert nichts.
- `marker` mit `name: 'fill'` sitzt am Anfang des Takts, der das Schlagzeug-Fill enthält.
- Ausgeschaltete Schichten fehlen im Strom; `chord` und `marker` gibt es immer. Im Arrangement spielt der `lead` dort, wo die Akkorde spielen, die Percussion dort, wo das Schlagzeug spielt (`follows` im Register). Mit `lead: off` und ausgeschalteter Percussion ist der Strom bitgleich wie vor diesen Schichten (Golden-Test).

## `chordTimeline(track)`

Ersatz für das alte `buildEvents(track, loops)` von Interactive Scales: ein Eintrag je Takt für `length` Takte, genau so berechnet wie die `chord`-Ereignisse.

```js
chordTimeline(track) // [{ time: 0, bar: 0, chord: { root: 'A', quality: 'min' }, durationSec: 2.666667 }, ...]
```

`time` ist der Taktanfang in Sekunden (gleich `t` des `chord`-Ereignisses), `durationSec = beats * 60 / bpm`. Beides auf 6 Stellen gerundet. Wirft wie `buildEvents` bei ungültigem Track. Für mehrere Durchläufe verschiebt der Aufrufer `bar` um `loop * length` und `time` um die Summe der `durationSec`.

## `play(ctx, track, options)`

```js
const ctx = new AudioContext();   // der Aufrufer besitzt ihn und erzeugt ihn in einer Nutzergeste
const h = play(ctx, track, { loops: 1, levels: { bass: 0.5 }, master: 1, onBar: ({ bar, chord }) => {}, onEvent: (e) => {}, onEnd: () => {} });
// h = { startPerf, stop(), setLayer(name, on), setLevel(name, value), setMaster(value), setTempo(bpm), setTimbre(timbre), setTrack(track) }
```

- Optionen: `loops` (ganze Zahl >= 1, Standard 1, `Infinity` erlaubt, sonst `RangeError`), `onBar({bar, chord})` je Takt, `onEvent(ev)` je Ereignis (auch stummer Schichten), `onEnd()` nach dem letzten Durchlauf. `bar` und `t` zählen über alle Durchläufe weiter. `startBar` (ganze Zahl von 0 bis `length - 1`, Standard 0, sonst `RangeError`, geprüft nach dem Track und bevor ein Audioknoten entsteht): die Wiedergabe beginnt mit diesem Takt, frühere Ereignisse entfallen; das erste Ereignis ist der Akkord dieses Takts, `bar` und `t` zählen ab dort wie beim Durchspielen (ab `startBar: 10` meldet `onBar` zuerst Takt 10). Der angefangene Durchlauf zählt als erster: `loops: 1` ab Takt 10 von 96 endet nach Takt 95. `createInstruments` ist ein interner Haken und nicht Teil des Vertrags.
- Ein ungültiger Track wirft sofort, bevor ein Audioknoten entsteht.
- `startPerf`: Beginn des ersten gespielten Takts (Liedzeit 0, mit `startBar` der Beginn dieses Takts) auf der `performance.now()`-Zeitachse (Ausgabelatenz eingerechnet). Die Gitarrenaufnahme wird an `startPerf` ausgerichtet, nicht an Rückrufzeiten. Die Ereigniszeit `t` in Rückrufen bleibt Liedzeit ab Takt 0; mit `startBar` gilt: Aufführungszeit eines Ereignisses ≈ `startPerf + (t − t_startBar) · 1000` (ms, Tempo wie gespielt), `t_startBar` ist das `t` des ersten Akkord-Ereignisses.
- Rückrufe laufen auf der Audio-Uhr und kommen gegenüber `startPerf` etwa `ctx.outputLatency` zu früh. Für eine Anzeige reicht das, für das Ausrichten einer Aufnahme zählt `startPerf`.
- `setLayer(name, on)`: schaltet eine Schicht aus `LAYER_IDS` (`drums`, `bass`, `chords`, `pad`, `lead`, `percussion`) live. Unbekannter Name wirft. Echo- und Hallfahnen klingen nach dem Stummschalten noch 1 bis 2 Sekunden nach. `setLayer(name, true)` kann eine Schicht nicht zurückholen, die im Track mit `layers[name]: false` ausgeschaltet ist: ihre Ereignisse gibt es dann gar nicht. Wer live umschalten will, übergibt alle Schichten `true` und schaltet stumm mit `setLayer` (so macht es die eigene Oberfläche).
- `levels` (`{ drums, bass, chords, pad, lead, percussion }`, jeder Wert 0 bis 1, fehlende gelten als 1) und `master` (0 bis 1, Standard 1): Reglerstellungen des Mischpults von der ersten Note an. Ein Wert außerhalb von 0 bis 1 oder kein Zahlentyp wirft `RangeError` (eine unbekannte Schicht in `levels` wirft `Error`), geprüft bevor ein Audioknoten entsteht.
- `setLevel(name, value)` und `setMaster(value)`: stellen den Pegel einer Schicht bzw. die Gesamtlautstärke live (ohne Neustart, mit etwa 20 ms Rampe gegen Knacken). `value` ist die Reglerstellung 0 bis 1 (sonst `RangeError`, unbekannte Schicht `Error`); die Verstärkung ist `value * value`, also 1 exakt unverändert und nie lauter als der Standard, 0 still. Der Schichtpegel wirkt vor den Echo- und Hallwegen: sie folgen der Schicht (schon laufende Fahnen klingen nach). Die Gesamtlautstärke liegt hinter dem Begrenzer am Ausgang und ändert dessen Verhalten nicht. Der Pegel ist unabhängig vom Stummschalten mit `setLayer`.
- `setTempo(bpm)`: ändert das Tempo live (20 bis 400, sonst `RangeError`); schon geplante Ereignisse behalten ihre Zeit. Die Echo-Verzögerung folgt dem neuen Tempo.
- `setTimbre(timbre)`: stellt den Klang live um (ohne Neustart), `timbre` im Format des Klangmodells (`resolveTrackTimbre(track)` aus `src/core/timbre.js`, nicht aus `src/index.js` exportiert, liefert es aus Schlagworten und `track.timbre`; unvollständig oder ungültig wird mit dem Standard aufgefüllt). Neue Töne klingen sofort neu; Hall, Echo, Helligkeit, Raum-Anteil, Summenpegel und die Verzerrer (Fuzz, Overdrive, Distortion; auch auf schon klingende Töne, die erste Aktivierung mitten im Spiel blendet nach etwa 0,15 s ein, beim Anlegen der Instrumente nach etwa 0,08 s) folgen über kurze Rampen. Schon klingende Töne behalten ihren Klang, beim Pad (Töne liegen einen Takt) hört man die Änderung deshalb ab dem nächsten Akkord. Nach `stop()` ohne Wirkung.
- `setVoices(voices)`: wechselt die Stimmen live (ohne Neustart), `voices` wie das Track-Feld; unvollständig oder ungültig wird mit dem Standard aufgefüllt. Neue Töne klingen sofort in der neuen Stimme, schon klingende Töne klingen in der alten aus (die Verzerrerkette dahinter bleibt). Nach `stop()` ohne Wirkung. `setTrack` ändert Stimmen nicht. Aufgaben (`jobs`) dagegen ändern Ereignisse und gehen darum über `setTrack`.
- `setTrack(track)`: tauscht den Ereignisstrom live aus, etwa nach einem Schlagwort mit Mustereffekt: ab dem nächsten noch nicht geplanten Ereignis spielt der neue Strom, schon geplante Töne laufen weiter und gleichzeitig geplante Ereignisse werden nie doppelt gespielt. Die Liedzeit bezieht sich auf das Starttempo von `play`; das `bpm` des übergebenen Tracks zählt nicht (Tempowechsel macht `setTempo`). Rückgabe `true` bei Erfolg, `false` ohne jede Änderung, wenn der Player gestoppt ist oder sich `length`, die Taktlängen (`beats`) und damit die Dauer eines Durchlaufs oder die **Taktart** ändern (auch bei gleicher Dauer, etwa 4/4 zu 12/8); der Aufrufer startet dann neu. Groove und Komplexität bei gleicher Taktart tauscht `setTrack` live. Ein ungültiger Track wirft wie `play` und ändert nichts. Klang ändert `setTrack` nicht, dafür `setTimbre`.
- `stop()`: blendet in etwa 50 ms aus, bricht alle Rückrufe ab, ist wiederholbar und schließt den `AudioContext` nie.

## Prüfung

`validateTrack(track)` liefert `{ code, params }[]` (leer heißt gültig) und wirft für JSON-artige Daten nie (auch nicht bei `null`, Zahlen, Strings oder kaputten Feldern). Nicht klonbare Daten, etwa eine Funktion als Feld, lassen das interne `structuredClone` einen `DataCloneError` werfen, genau wie bei `buildEvents`. Die öffentliche Funktion wendet vorher die Standardwerte an (`length`, `meter`, `tags`, `layers`, `seed`), akzeptiert also auch Teil-Tracks wie das alte Format von Interactive Scales und meldet genau die Codes, die `buildEvents` und `chordTimeline` als `err.errors` werfen würden. Es gibt 15 Codes (`VALIDATION_CODES` aus `src/index.js`): `emptyBars`, `chordNotInKey`, `badBpm`, `unknownQuality`, `badBeats`, `badLength`, `badKey`, `badBar`, `badTags`, `badMeter`, `badComplexity`, `badGroove`, `badVoice`, `badJob`, `badForm` (`badMeter`, `badComplexity` und `badGroove` tragen den Wert als `params.meter`, `params.complexity`, `params.groove`; `badVoice` trägt `params.layer` und `params.voice`, bei einer ungültigen Variante als `id/variante`; `badJob` trägt `params.layer` und `params.job`; `badForm` trägt `params.reason`, ein kurzes englisches Stichwort). `badTags` trägt `params.category` und `params.tag`, soweit bekannt (kein Objekt: leere `params`). Text in der Sprache der App: `t('err.' + code, params)`.

```js
const errors = validateTrack(track);
if (errors.length) show(errors.map((e) => t('err.' + e.code, e.params)));
```

## Sprache

`setLanguage('de' | 'en')`, `getLanguage()` (Standard `de`), `t(key, params)` (unbekannter Schlüssel liefert den Schlüssel). `setLanguage` mit unbekannter Sprache wirft `RangeError`. Akkordsymbole werden nie übersetzt.

## Abbildung der heutigen Funktionen von Interactive Scales

| Heute (`backing.js`) | Neu |
| --- | --- |
| `buildEvents(track, loops)` mit `{time, bar, chord, durationSec}` | `chordTimeline(track)`; mehrere Durchläufe selbst versetzen |
| `playBacking(ctx, track, { loops, onBar })` mit `{startPerf, stop()}` | `play(ctx, track, { loops, onBar })` mit `{startPerf, stop(), setLayer, setLevel, setMaster, setTempo, setTimbre, setTrack}`; `length` auf die Taktzahl der Übung setzen (siehe unten) |

Achtung bei `loops`: Das alte `loops` zählte Durchläufe über `bars` (eine 4-Takt-Übung mit `loops: 3` dauerte 12 Takte). Das neue `loops` wiederholt jeweils den ganzen Track von `length` Takten, Standard 24. Ohne `length` dauert dieselbe Übung mit `loops: 3` also 72 Takte. Damit das alte Timing bleibt, gibt Interactive Scales `length: bars.length` mit (für die 4-Takt-Übung `length: 4`); dasselbe gilt für `chordTimeline`.
| `?bpm=`-Überschreibung | überschriebenes `bpm` in den Track schreiben (Zeiten aus `chordTimeline` passen dann), oder nach dem Start `setTempo(bpm)` |

## Nicht Teil des Vertrags

- Die Oberfläche unter `src/ui`.
- Tonleitern: sie sind reiner Zustand der Oberfläche und gehen nicht in den Track ein.
- Der Instrumenten- und Sample-Haken `createInstruments`: vorerst intern.
