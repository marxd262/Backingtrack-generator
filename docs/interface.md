# Schnittstelle des Backingtrack-Generators

## Zweck und Trennung

Der Generator läuft allein (eigene Oberfläche unter `src/ui`). Die Lern-App Interactive Scales benutzt ausschließlich diese Schnittstelle, den Einstieg `src/index.js`. Er lädt auch in reinem Node, ohne Browser-Globals beim Import.

```js
import {
  play, buildEvents, chordTimeline, validateTrack, VALIDATION_CODES, allowedChords,
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
| `meter` | nein | `[4, 4]` | im Format vorhanden, wird aber derzeit ignoriert: das Raster ergibt sich aus `beats`; angeboten wird nur 4/4 |
| `tags` | nein | `{}` | `{Kategorie: [Schlagwort-IDs]}` (Objekt, je Kategorie ein Array), nur Kategorien und IDs aus `TAG_CATEGORIES`, sonst `badTags`; `null` gilt wie fehlend |
| `layers` | nein | alle `true` | `drums`, `bass`, `chords`, `pad`; `false` lässt die Schicht aus dem Strom weg |
| `seed` | nein | `1` | siehe Seed-Regel |

Weitere Felder (`id`, `title`, `style` ...) stören nicht und werden ignoriert. Ein Track im alten Format von Interactive Scales (`{ id, title, key, bpm, bars }`) ist gültig.

- Akkordarten: `maj`, `min`, `dim`. Akkordsymbole bleiben international (`B` bleibt `B`, nie das deutsche `H`).
- Jeder Akkord muss zur Tonart gehören: diatonisch, in Moll zusätzlich die Dur-Dominante (`allowedChords(key)` aus `src/index.js`). Sonst meldet `validateTrack` `chordNotInKey`. Dorisch hat keine Zusatzakkorde (A-Dorisch: `Am Bm C D Em F#dim G`).
- `allowedChords` schreibt die Akkorde in der Vorzeichnung der Tonart (D-Moll: `Bb`, E-Moll: `F#dim`); ein Grundton mit `#` oder `b` behält sein Vorzeichen. Geprüft wird nach Tonhöhe, `A#` und `Bb` sind im Track gleichwertig.

## Schlagworte und Stile

- `TAG_CATEGORIES`: `[{ id, tags: [id, ...] }]`, alle Kategorien und Schlagwort-IDs, die der Generator kennt.
- `STYLE_PRESETS`: `[{ id, bpm, tags }]`. `tags` kann direkt in einen Track übernommen werden, `bpm` ist der Vorschlag des Stils.
- Aufbau (Kategorie `development`) in Abschnitten zu 8 Takten, der letzte Abschnitt spielt immer alles: ohne Angabe Bass, Schlagzeug und Akkorde, Pad erst im letzten Abschnitt; `fullFromStart` alles von Anfang an; `buildsSlowly` Bass und Schlagzeug ab Takt 1, im zweiten Abschnitt kommt (je Seed) Akkorde oder Pad dazu, ab dem dritten alles. Der Aufbau beginnt mit jedem Durchlauf über `length` Takte neu.
- Beschriftungen über `t`: `category.<id>`, `tag.<Kategorie>.<id>`, `style.<id>` (Hinweis: `style.<id>.hint`), `layer.<name>`, `scale.<name>`, `mode.<name>`.

## Seed-Regel

- Ein Track ohne `seed` ist gültig und bedeutet Seed 1: wiederholte Aufrufe liefern identische Ausgabe.
- Ein Track mit `seed` ist wiederholbar: gleiche Eingabe plus gleicher Seed ergibt denselben Strom (der Seed wird mit `>>> 0` zu einer 32-Bit-Zahl).
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
const h = play(ctx, track, { loops: 1, onBar: ({ bar, chord }) => {}, onEvent: (e) => {}, onEnd: () => {} });
// h = { startPerf, stop(), setLayer(name, on), setTempo(bpm) }
```

- Optionen: `loops` (ganze Zahl >= 1, Standard 1, `Infinity` erlaubt, sonst `RangeError`), `onBar({bar, chord})` je Takt, `onEvent(ev)` je Ereignis (auch stummer Schichten), `onEnd()` nach dem letzten Durchlauf. `bar` und `t` zählen über alle Durchläufe weiter. `createInstruments` ist ein interner Haken und nicht Teil des Vertrags.
- Ein ungültiger Track wirft sofort, bevor ein Audioknoten entsteht.
- `startPerf`: Zeitpunkt von Liedzeit 0 auf der `performance.now()`-Zeitachse (Ausgabelatenz eingerechnet). Die Gitarrenaufnahme wird an `startPerf` ausgerichtet, nicht an Rückrufzeiten.
- Rückrufe laufen auf der Audio-Uhr und kommen gegenüber `startPerf` etwa `ctx.outputLatency` zu früh. Für eine Anzeige reicht das, für das Ausrichten einer Aufnahme zählt `startPerf`.
- `setLayer(name, on)`: schaltet `drums`, `bass`, `chords` oder `pad` live. Unbekannter Name wirft. Echo- und Hallfahnen klingen nach dem Stummschalten noch 1 bis 2 Sekunden nach. `setLayer(name, true)` kann eine Schicht nicht zurückholen, die im Track mit `layers[name]: false` ausgeschaltet ist: ihre Ereignisse gibt es dann gar nicht. Wer live umschalten will, übergibt alle Schichten `true` und schaltet stumm mit `setLayer` (so macht es die eigene Oberfläche).
- `setTempo(bpm)`: ändert das Tempo live (20 bis 400, sonst `RangeError`); schon geplante Ereignisse behalten ihre Zeit. Die Echo-Verzögerung folgt dem neuen Tempo.
- `stop()`: blendet in etwa 50 ms aus, bricht alle Rückrufe ab, ist wiederholbar und schließt den `AudioContext` nie.

## Prüfung

`validateTrack(track)` liefert `{ code, params }[]` (leer heißt gültig) und wirft für JSON-artige Daten nie (auch nicht bei `null`, Zahlen, Strings oder kaputten Feldern). Nicht klonbare Daten, etwa eine Funktion als Feld, lassen das interne `structuredClone` einen `DataCloneError` werfen, genau wie bei `buildEvents`. Die öffentliche Funktion wendet vorher die Standardwerte an (`length`, `meter`, `tags`, `layers`, `seed`), akzeptiert also auch Teil-Tracks wie das alte Format von Interactive Scales und meldet genau die Codes, die `buildEvents` und `chordTimeline` als `err.errors` werfen würden. Codes (`VALIDATION_CODES` aus `src/index.js`): `emptyBars`, `chordNotInKey`, `badBpm`, `unknownQuality`, `badBeats`, `badLength`, `badKey`, `badBar`, `badTags`. `badTags` trägt `params.category` und `params.tag`, soweit bekannt (kein Objekt: leere `params`). Text in der Sprache der App: `t('err.' + code, params)`.

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
| `playBacking(ctx, track, { loops, onBar })` mit `{startPerf, stop()}` | `play(ctx, track, { loops, onBar })` mit `{startPerf, stop(), setLayer, setTempo}`; `length` auf die Taktzahl der Übung setzen (siehe unten) |

Achtung bei `loops`: Das alte `loops` zählte Durchläufe über `bars` (eine 4-Takt-Übung mit `loops: 3` dauerte 12 Takte). Das neue `loops` wiederholt jeweils den ganzen Track von `length` Takten, Standard 24. Ohne `length` dauert dieselbe Übung mit `loops: 3` also 72 Takte. Damit das alte Timing bleibt, gibt Interactive Scales `length: bars.length` mit (für die 4-Takt-Übung `length: 4`); dasselbe gilt für `chordTimeline`.
| `?bpm=`-Überschreibung | überschriebenes `bpm` in den Track schreiben (Zeiten aus `chordTimeline` passen dann), oder nach dem Start `setTempo(bpm)` |

## Nicht Teil des Vertrags

- Die Oberfläche unter `src/ui`.
- Tonleitern: sie sind reiner Zustand der Oberfläche und gehen nicht in den Track ein.
- Der Instrumenten- und Sample-Haken `createInstruments`: vorerst intern.
