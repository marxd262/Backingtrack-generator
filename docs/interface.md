# Schnittstelle des Backingtrack-Generators

## Zweck und Trennung

Der Generator läuft allein (eigene Oberfläche unter `src/ui`). Die Lern-App Interactive Scales benutzt ausschließlich diese Schnittstelle, den Einstieg `src/index.js`. Er lädt auch in reinem Node, ohne Browser-Globals beim Import.

```js
import {
  play, buildEvents, chordTimeline, validateTrack, VALIDATION_CODES, allowedChords, chordOptions, chordName, CHORDS,
  TAG_CATEGORIES, STYLE_PRESETS, DRUM_NAMES, t, setLanguage, getLanguage,
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
  "layers": { "drums": true, "bass": true, "chords": true, "pad": true },
  "seed": 1
}
```

| Feld | Pflicht | Standard | Regel |
| --- | --- | --- | --- |
| `key` | ja | - | `root` ist ein Notenname (`C`, `F#`, `Bb`), `mode` ist `minor`, `major` oder `dorian` |
| `bpm` | ja | - | 20 bis 400 |
| `bars` | ja | - | nicht leer; je Eintrag `chord: {root, quality}` und `beats` (ganze Zahl 1 bis 16) |
| `length` | nein | `24` | Anzahl Takte, 1 bis 512; `bars` läuft im Kreis darüber |
| `meter` | nein | `[4, 4]` | Taktart `[Zähler, Nenner]`: `[4, 4]`, `[3, 4]`, `[6, 8]`, `[12, 8]` oder `[5, 4]` (Abschnitt "Taktarten, Raster und Grooves"); sie bestimmt das Raster und den Standard-Groove, eine andere Taktart meldet `badMeter`; fehlend oder `null` gilt `[4, 4]` wie bisher |
| `groove` | nein | Standard der Taktart | Groove-ID aus `GROOVES`; ein Groove einer anderen Taktart wird durch den Standard der Taktart ersetzt, eine unbekannte ID meldet `badGroove` |
| `complexity` | nein | `0.5` | Zahl von 0 bis 1 (sonst `badComplexity`); 0,5 und fehlend lassen alles wie es ist |
| `tags` | nein | `{}` | `{Kategorie: [Schlagwort-IDs]}` (Objekt, je Kategorie ein Array), nur Kategorien und IDs aus `TAG_CATEGORIES`, sonst `badTags`; `null` gilt wie fehlend |
| `timbre` | nein | `{}` | Klangregler: `{Gruppe: {Feld: Zahl 0 bis 1}}` mit den Gruppen und Feldern von `DEFAULT_TIMBRE` (`src/core/timbre.js`: `drums`, `bass`, `chords`, `pad`, `master`). Nur die gesetzten Felder zählen; sie liegen **über** dem, was die Schlagworte ergeben, und schlagen sie. Werte außerhalb von 0 bis 1 werden begrenzt; unbekannte Gruppen oder Felder, Nicht-Zahlen und ein Nicht-Objekt werden ohne Fehler ignoriert |
| `variety` | nein | `false` | `true` lässt den Seed (die Variante) mehr verändern: er streut Synkopen, Bass-Bewegung und Swing leicht innerhalb der Schlagwort-Werte, schaltet zusätzliche Muster frei und verschiebt sieben Klangfelder um höchstens ±0,08 (unter `timbre`, das gewinnt). Ohne den Schalter ist der Ereignisstrom bitgleich wie ohne dieses Feld; die eigene Oberfläche setzt ihn auf `true`. Das Klangmodell mit Drift liefert `resolveTrackTimbre(track)`, es braucht dafür den `seed` im Track |
| `layers` | nein | alle `true` | `drums`, `bass`, `chords`, `pad`; `false` lässt die Schicht aus dem Strom weg |
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
```

(Die echten Zeiten von `hit` und `note` weichen durch Swing und leichtes Timing-Jitter um wenige Millisekunden von der Rasterzeit ab.)

- `t`: Sekunden ab Start (auf 6 Stellen gerundet). `bar`: 0-basierter Takt. `beat`: 0-basierte Rasterposition im Takt in Schlägen (Sechzehntel = 0.25).
- `hit` hat `layer: 'drums'` und einen Namen aus `kick`, `snare`, `hat`, `openHat`, `tomHigh`, `tomMid`, `tomLow` (`DRUM_NAMES` aus `src/index.js`). Geisternoten sind `snare` mit `vel < 0.3`.
- `note` hat `layer` `bass`, `chords` oder `pad`, `midi`, `vel` (0 bis 1) und `dur` in Sekunden.
- `marker` mit `name: 'fill'` sitzt am Anfang des Takts, der das Schlagzeug-Fill enthält.
- Ausgeschaltete Schichten fehlen im Strom; `chord` und `marker` gibt es immer.

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
- `setLayer(name, on)`: schaltet `drums`, `bass`, `chords` oder `pad` live. Unbekannter Name wirft. Echo- und Hallfahnen klingen nach dem Stummschalten noch 1 bis 2 Sekunden nach. `setLayer(name, true)` kann eine Schicht nicht zurückholen, die im Track mit `layers[name]: false` ausgeschaltet ist: ihre Ereignisse gibt es dann gar nicht. Wer live umschalten will, übergibt alle Schichten `true` und schaltet stumm mit `setLayer` (so macht es die eigene Oberfläche).
- `levels` (`{ drums, bass, chords, pad }`, jeder Wert 0 bis 1, fehlende gelten als 1) und `master` (0 bis 1, Standard 1): Reglerstellungen des Mischpults von der ersten Note an. Ein Wert außerhalb von 0 bis 1 oder kein Zahlentyp wirft `RangeError` (eine unbekannte Schicht in `levels` wirft `Error`), geprüft bevor ein Audioknoten entsteht.
- `setLevel(name, value)` und `setMaster(value)`: stellen den Pegel einer Schicht bzw. die Gesamtlautstärke live (ohne Neustart, mit etwa 20 ms Rampe gegen Knacken). `value` ist die Reglerstellung 0 bis 1 (sonst `RangeError`, unbekannte Schicht `Error`); die Verstärkung ist `value * value`, also 1 exakt unverändert und nie lauter als der Standard, 0 still. Der Schichtpegel wirkt vor den Echo- und Hallwegen: sie folgen der Schicht (schon laufende Fahnen klingen nach). Die Gesamtlautstärke liegt hinter dem Begrenzer am Ausgang und ändert dessen Verhalten nicht. Der Pegel ist unabhängig vom Stummschalten mit `setLayer`.
- `setTempo(bpm)`: ändert das Tempo live (20 bis 400, sonst `RangeError`); schon geplante Ereignisse behalten ihre Zeit. Die Echo-Verzögerung folgt dem neuen Tempo.
- `setTimbre(timbre)`: stellt den Klang live um (ohne Neustart), `timbre` im Format des Klangmodells (`resolveTrackTimbre(track)` aus `src/core/timbre.js`, nicht aus `src/index.js` exportiert, liefert es aus Schlagworten und `track.timbre`; unvollständig oder ungültig wird mit dem Standard aufgefüllt). Neue Töne klingen sofort neu; Hall, Echo, Helligkeit, Raum-Anteil und Summenpegel folgen über kurze Rampen. Schon klingende Töne behalten ihren Klang, beim Pad (Töne liegen einen Takt) hört man die Änderung deshalb ab dem nächsten Akkord. Nach `stop()` ohne Wirkung.
- `setTrack(track)`: tauscht den Ereignisstrom live aus, etwa nach einem Schlagwort mit Mustereffekt: ab dem nächsten noch nicht geplanten Ereignis spielt der neue Strom, schon geplante Töne laufen weiter und gleichzeitig geplante Ereignisse werden nie doppelt gespielt. Die Liedzeit bezieht sich auf das Starttempo von `play`; das `bpm` des übergebenen Tracks zählt nicht (Tempowechsel macht `setTempo`). Rückgabe `true` bei Erfolg, `false` ohne jede Änderung, wenn der Player gestoppt ist oder sich `length`, die Taktlängen (`beats`) und damit die Dauer eines Durchlaufs oder die **Taktart** ändern (auch bei gleicher Dauer, etwa 4/4 zu 12/8); der Aufrufer startet dann neu. Groove und Komplexität bei gleicher Taktart tauscht `setTrack` live. Ein ungültiger Track wirft wie `play` und ändert nichts. Klang ändert `setTrack` nicht, dafür `setTimbre`.
- `stop()`: blendet in etwa 50 ms aus, bricht alle Rückrufe ab, ist wiederholbar und schließt den `AudioContext` nie.

## Prüfung

`validateTrack(track)` liefert `{ code, params }[]` (leer heißt gültig) und wirft für JSON-artige Daten nie (auch nicht bei `null`, Zahlen, Strings oder kaputten Feldern). Nicht klonbare Daten, etwa eine Funktion als Feld, lassen das interne `structuredClone` einen `DataCloneError` werfen, genau wie bei `buildEvents`. Die öffentliche Funktion wendet vorher die Standardwerte an (`length`, `meter`, `tags`, `layers`, `seed`), akzeptiert also auch Teil-Tracks wie das alte Format von Interactive Scales und meldet genau die Codes, die `buildEvents` und `chordTimeline` als `err.errors` werfen würden. Codes (`VALIDATION_CODES` aus `src/index.js`): `emptyBars`, `chordNotInKey`, `badBpm`, `unknownQuality`, `badBeats`, `badLength`, `badKey`, `badBar`, `badTags`, `badMeter`, `badComplexity`, `badGroove` (die letzten drei tragen den Wert als `params.meter`, `params.complexity`, `params.groove`). `badTags` trägt `params.category` und `params.tag`, soweit bekannt (kein Objekt: leere `params`). Text in der Sprache der App: `t('err.' + code, params)`.

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
