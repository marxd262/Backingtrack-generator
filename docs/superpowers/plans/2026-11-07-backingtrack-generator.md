# Backingtrack-Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Browser-Generator, der aus Tonart, Akkordfolge, Tempo, Schlagworten und Seed einen sich aufbauenden Begleittrack synthetisiert, mit Startsatz, Feintuning, Akkordrad und einer Schnittstelle für Interactive Scales.

**Architecture:** Ein reiner Kern (`src/core`) berechnet aus der Eingabe einen Ereignisstrom, ohne Audio. Der Klang (`src/audio`) und die Oberfläche (`src/ui`) lesen nur diesen Strom. Gleiche Eingabe plus gleicher Seed ergibt denselben Strom. Der Klangerzeuger sitzt hinter einer `Instrument`-Schnittstelle.

**Tech Stack:** JavaScript (ES-Module, kein Framework, kein Bundler), `node:test`, Playwright (Chrome), Web Audio API, Canvas.

**Spec:** `docs/superpowers/specs/2026-11-07-backingtrack-generator-design.md` (dazu `handoff-backing-track-generator.md`)

## Global Constraints

- Windows 11, Chrome, Node 26, lokal und offline lauffähig. Keine Laufzeit-Abhängigkeiten.
- Oberfläche zweisprachig: Deutsch und Englisch. Weitere Sprachen später durch eine neue Datei in `src/i18n/`, ohne Änderung an Kern oder Oberfläche. Kein sichtbarer Text ist in Kern-, Audio- oder Zeichencode fest eingebaut. Bezeichner im Code Englisch, Kommentare Deutsch (Annahme).
- Oberfläche hell, Notenheft-Stil, Serifenschrift, genau ein farbiges Objekt je Bildschirm. Die Optik ist vorläufig (Mockups aus `.superpowers/brainstorm/*/content/`, Akzent `#c8452d`) und wird später mit dem Auftraggeber verfeinert. Die Oberfläche von `backing-demo.html` ist ausdrücklich nicht die Basis.
- Akkordarten nur `maj`, `min`, `dim`, aber über eine Tabelle erweiterbar. Taktart nur 4/4 in der Oberfläche, aber `meter` im Datenformat.
- Tests vor Code. Jeder Task endet mit grünen Tests und einem Commit.
- Ereignisstrom ohne Audio berechenbar. Zufall nur über den Seed, nie `Math.random`.
- Pegel: Spitze der Summe unter 0,9. Jede Schicht einzeln hörbar. Stumm geschaltete Schicht ist wirklich still.
- Hörprobe entscheidet der Auftraggeber, kein Test ersetzt sie.

## Review Focus

1. Leere Akkordfolge oder Akkord außerhalb der Tonart: klarer Fehler statt Absturz (Task 2).
2. Keine Schlagworte gewählt oder unbekanntes Schlagwort: Standardwerte bzw. Fehler (Task 3).
3. Seed `0`, sehr große Seeds, Seed fehlt: reproduzierbar, kein Absturz (Task 1, 5).
4. Alle Schichten aus: nur Akkord- und Marker-Ereignisse, Oberfläche läuft weiter ohne Konsolenfehler (Task 5, 9).
5. Tempo 40 und 240 sowie Takte mit 3 statt 4 Schlägen: Ereignisse bleiben innerhalb der Taktgrenzen (Task 5).

---

## File Structure

```
package.json, playwright.config.js, scripts/serve.js
src/core/rng.js        Seed-Zufall
src/core/music.js      Noten, Akkordarten, Skalen
src/core/track.js      normalizeTrack, validateTrack
src/core/tags.js       Schlagwort-Kategorien, Stil-Vorbelegung, resolveTags
src/core/arrange.js    Abschnitte, Einsatz der Schichten, Fills
src/core/events.js     buildEvents (reiner Ereignisstrom)
src/audio/synth.js     Instrumente (Synthese) hinter Instrument-Schnittstelle
src/audio/render.js    Offline-Render mit Pegelmessung
src/audio/play.js      play(): Wiedergabe mit Vorausplanung
src/i18n/index.js      t(), setLanguage(), detectLanguage()
src/i18n/de.js, en.js  alle sichtbaren Texte (flaches Objekt je Sprache)
src/ui/index.html, app.css, app.js   Startsatz, Auswahl, Feintuning
src/ui/lanes.js        Verlauf je Schicht (Canvas)
src/ui/wheel.js        Akkordrad (Canvas, klickbar)
src/index.js           Öffentliche Schnittstelle für Interactive Scales
tests/core/*.test.js   Unit (node:test)
tests/e2e/*.spec.js    Browser (Playwright)
```

### Task 1: Gerüst und Seed-Zufall

**Files:** Create `package.json`, `playwright.config.js`, `scripts/serve.js`, `src/core/rng.js`, `tests/core/rng.test.js`

**Interfaces:**
- Produces: `createRng(seed: number): { next(): number; int(min: number, max: number): number; pick<T>(arr: T[]): T; fork(label: string): Rng }`. `next()` liefert `[0,1)`. `fork` liefert einen unabhängigen, von `seed` und `label` abhängigen Strom.

- [ ] **Step 1: Write failing test** `tests/core/rng.test.js`: gleicher Seed ergibt 10 gleiche Werte; Seed 1 und 2 unterscheiden sich; Seed `0` und `2**32+5` liefern Werte in `[0,1)`; `fork('a')` ungleich `fork('b')`, `fork('a')` reproduzierbar.
- [ ] **Step 2: Run** `node --test tests/core` – Expected: FAIL (Modul fehlt).
- [ ] **Step 3: Implement** `createRng` in `src/core/rng.js` mit mulberry32; `fork` hasht `seed + label` zu einem neuen Seed.
- [ ] **Step 4: Gerüst** `npm init`, `npm i -D @playwright/test`, `npx playwright install chromium`; Skripte `test` (`node --test tests/core`) und `test:e2e` (`playwright test`); `scripts/serve.js` serviert `src/` statisch auf Port 4173 (Playwright `webServer`). `git init`.
- [ ] **Step 5: Run** `npm test` – Expected: PASS.
- [ ] **Step 6: Commit** `feat: scaffold, seeded rng`

### Task 2: Musikbasis und Track-Format

**Files:** Create `src/core/music.js`, `src/core/track.js`, `tests/core/music.test.js`, `tests/core/track.test.js`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `CHORD_QUALITIES: Record<string, number[]>` = `{ maj:[0,4,7], min:[0,3,7], dim:[0,3,6] }`
  - `noteToPc(name: string): number` (`'A'`→9, `'F#'`→6, `'Bb'`→10)
  - `chordMidi(chord: Chord, octave: number): number[]`
  - `scalePcs(key: Key, scale: 'minorPentatonic'|'majorPentatonic'|'blues'|'dorian'): number[]`
  - `diatonicChords(key: Key): Chord[]` (für A-Moll: Am, Bdim, C, Dm, Em, F, G)
  - `normalizeTrack(track: TrackInput): Track` setzt `meter:[4,4]`, `length: 24`, `layers` alle `true`, `tags: {}`, `seed: 1`
  - `validateTrack(track: Track): { code: 'emptyBars'|'chordNotInKey'|'badBpm'|'unknownQuality'|'badBeats'|'badLength'; params: Record<string, string|number> }[]` (leer = gültig). Keine Texte, die Oberfläche übersetzt über `err.<code>`.
  - Typen: `Chord = {root: string, quality: string}`, `Key = {root: string, mode: 'minor'|'major'}`, `Track = {key, bpm, meter:[number,number], style?:string, tags:Record<string,string[]>, bars:{chord:Chord, beats:number}[], length:number, layers:{drums,bass,chords,pad:boolean}, seed:number}`

- [ ] **Step 1: Write failing tests**: `chordMidi({root:'A',quality:'min'},3)` ergibt `[57,60,64]`; `scalePcs({root:'A',mode:'minor'},'minorPentatonic')` ergibt `[9,0,2,4,7]`; `diatonicChords` für A-Moll enthält `Bdim`; `validateTrack` meldet die Codes `emptyBars` für `bars: []`, `chordNotInKey` (mit `params.chord === 'C#'`) für Akkord `{root:'C#',quality:'maj'}` in A-Moll, `badBpm` für `bpm: 0`, `unknownQuality` für `quality: 'xyz'`, und meldet nichts für `Am Am Dm E`.
- [ ] **Step 2: Run** – Expected: FAIL.
- [ ] **Step 3: Implement** in `music.js` und `track.js`. Neue Akkordart = ein Eintrag in `CHORD_QUALITIES`, sonst keine Änderung. Validierung wirft nicht, sie sammelt Meldungen als sprachfreie Codes.
- [ ] **Step 4: Run** `npm test` – Expected: PASS.
- [ ] **Step 5: Commit** `feat: music basics, track format and validation`

### Task 3: Schlagworte, Stile und Parameter

**Files:** Create `src/core/tags.js`, `tests/core/tags.test.js`

**Interfaces:**
- Consumes: `createRng`.
- Produces:
  - `TAG_CATEGORIES: {id: string, tags: string[]}[]` mit Kategorien `drums`, `bass`, `synths`, `rhythm`, `mood`, `development` und den Schlagworten aus dem Mockup (`tags-by-category.html`) als englische Ids (`driving`, `dry`, `calm`, `heavy`, ...). Beschriftungen stehen nur in `src/i18n`.
  - `STYLE_PRESETS: {id: string, bpm: number, tags: Record<string,string[]>}[]` für `funk`, `psych`, `dreamy` (100 / 112 / 80 bpm), ohne Beschriftung.
  - `resolveTags(tags: Record<string,string[]>, rng: Rng): Params`
  - `Params = {drive: number, swing: number, syncopation: number, bassLow: number, bassMovement: number, arp: boolean, padWidth: number, buildUp: 'slow'|'normal'|'instant'}`, Zahlen in `[0,1]`.

- [ ] **Step 1: Write failing tests**: `resolveTags({}, rng)` liefert gültige Standardwerte (alle Zahlen in `[0,1]`); `{drums:['driving']}` erhöht `drive` gegenüber Standard; `{drums:['driving','dry']}` (mehrere in einer Kategorie) wirft nicht; unbekanntes Schlagwort `{drums:['nope']}` wirft `Error` mit Text, der `nope` enthält; jeder Eintrag in `STYLE_PRESETS` verwendet nur bekannte Schlagwörter.
- [ ] **Step 2: Run** – Expected: FAIL.
- [ ] **Step 3: Implement.** Jedes Schlagwort verschiebt Parameter um feste Beträge, mehrere Schlagworte mitteln. Bei gegensätzlichen Schlagworten (z. B. `calm` und `heavy`) wählt `rng` je Aufruf eines davon als stärker. Exakte Beträge werden beim Hören festgelegt, im Code als Tabelle oben in `tags.js`.
- [ ] **Step 4: Run** – Expected: PASS.
- [ ] **Step 5: Commit** `feat: tags, style presets, parameter resolution`

### Task 4: Arrangement

**Files:** Create `src/core/arrange.js`, `tests/core/arrange.test.js`

**Interfaces:**
- Consumes: `Track`, `Params`, `Rng`.
- Produces: `buildArrangement(track: Track, params: Params, rng: Rng): { sections: { start: number; bars: number; layers: Record<'drums'|'bass'|'chords'|'pad', boolean>; fillAtEnd: boolean }[] }`

- [ ] **Step 1: Write failing tests**: `length: 24` ergibt 3 Abschnitte mit je `bars: 8`, lückenlos (`start` 0, 8, 16); `buildUp:'slow'` hat im ersten Abschnitt weniger aktive Schichten als im letzten; `buildUp:'instant'` hat in allen Abschnitten alle Schichten; `fillAtEnd` ist in jedem Abschnitt außer dem letzten `true`; `length: 4` ergibt einen Abschnitt mit `bars: 4`.
- [ ] **Step 2: Run** – Expected: FAIL.
- [ ] **Step 3: Implement.** Abschnittslänge 8, Rest-Abschnitt kürzer. Einsatzreihenfolge bei `slow`: Bass, Schlagzeug, Akkorde, Pad.
- [ ] **Step 4: Run** – Expected: PASS.
- [ ] **Step 5: Commit** `feat: arrangement with build-up`

### Task 5: Ereignisstrom

**Files:** Create `src/core/events.js`, `tests/core/events.test.js`

**Interfaces:**
- Consumes: `normalizeTrack`, `validateTrack`, `resolveTags`, `buildArrangement`, `createRng`, `chordMidi`.
- Produces: `buildEvents(trackInput: TrackInput): Event[]`, sortiert nach `t`, wirft bei `validateTrack` ungleich leer. `Event` wie im Übergabedokument Abschnitt 5: `{t, bar, beat, type:'chord', chord}`, `{t, bar, beat, type:'hit', layer:'drums', name, vel}`, `{t, bar, beat, type:'note', layer, midi, vel, dur}`, `{t, bar, type:'marker', name}`. `t` in Sekunden, `bar` ab 0.

- [ ] **Step 1: Write failing tests** (jeweils mit `Am Am Dm E`, 4 Schläge, 100 bpm, Seed 1):
  - Chord-Ereignis in Takt 0 bei `t === 0`, in Takt 1 bei `t === 2.4`.
  - Gleicher Seed ergibt `deepEqual`; Seed 2 ergibt etwas anderes; Seed `0` wirft nicht.
  - `layers.drums:false` ergibt keine `hit`-Ereignisse; alle vier `false` ergibt nur `chord` und `marker`.
  - Marker `fill` liegt im letzten Takt jedes Abschnitts außer dem letzten.
  - Alle `note`/`hit`-Zeiten liegen innerhalb ihres Taktes; gilt auch bei `bpm: 40`, `bpm: 240` und `beats: 3`.
  - Humanisierung: Abweichung vom Raster höchstens 0,02 s, `vel` immer in `(0,1]`.
  - Bass trifft in jedem Takt auf Zählzeit 1 den Grundton des Akkords (Oktave egal).
  - Gleiche Schlagworte, Seed 1 und Seed 2 ergeben unterschiedliche Drum-Muster.
- [ ] **Step 2: Run** – Expected: FAIL.
- [ ] **Step 3: Implement** `buildEvents`. Je Schicht eine eigene Funktion mit `rng.fork(layer)`, damit sich Schichten nicht gegenseitig verschieben. Muster aus `Params` (`drive`, `swing`, `syncopation`, `bassMovement`, `arp`). Takte ergeben sich aus `bars` im Kreis über `length`. Fill: dichtere Schlagzeug-Ereignisse in den letzten 2 Zählzeiten.
- [ ] **Step 4: Run** `npm test` – Expected: PASS.
- [ ] **Step 5: Commit** `feat: pure event stream`

### Task 6: Synthese und Pegeltests

**Files:** Create `src/audio/synth.js`, `src/audio/render.js`, `tests/e2e/levels.spec.js`, `src/ui/render-harness.html`

**Interfaces:**
- Consumes: `buildEvents`, `Event`.
- Produces:
  - `createInstruments(ctx: BaseAudioContext): { output: AudioNode; layers: Record<'drums'|'bass'|'chords'|'pad', Instrument> }` mit `Instrument = { trigger(event: Event, when: number): void; setMuted(on: boolean): void }`.
  - `renderOffline(trackInput: TrackInput, seconds: number): Promise<{ peak: number; rms: number; perLayer: Record<string, {peak: number; rms: number}> }>` (läuft im Browser, `render-harness.html` stellt es als `window.__render` bereit).

- [ ] **Step 1: Write failing tests** `levels.spec.js` (Playwright, lädt die Harness-Seite, Funk-Rock-Track, 20 s): Summenspitze `< 0.9`; jede Schicht für sich `rms > 0.005`; mit `layers.bass:false` ist Bass-`rms === 0`; Verhältnis jeder Schicht-`rms` zur lautesten liegt zwischen 0,15 und 1 (Grenzen beim ersten Lauf anhand echter Messwerte festziehen und im Test dokumentieren).
- [ ] **Step 2: Run** `npm run test:e2e` – Expected: FAIL.
- [ ] **Step 3: Implement** Schlagzeug (Kick, Snare, Hi-Hat, Toms), Bass aus leicht verstimmten Sägezähnen, Akkorde (kurze Stabs), Pad (langsamer Filter-LFO), Echo und einfacher Hall auf der Summe, Begrenzer am Ausgang. Ausgangspunkt ist `backing-demo.html` im Projektordner: Klangerzeuger `D` (Kick, Snare, Hi-Hat, Tom), `bassNote`, `compNote`, `padChord`, Echo, Start-Pegel `TRIM = {drums: .5, bass: .28, chords: 1, pad: .8}`, Master 0,7 mit Kompressor und das Muster von `window.__render`. Übernehmen, `Math.random` durch den Seed ersetzen. Die Taktplanung (`scheduleBar`) entfällt, sie kommt aus dem Ereignisstrom. Pegel anhand der Messung angleichen.
- [ ] **Step 4: Run** – Expected: PASS.
- [ ] **Step 5: Hörprobe:** Auftraggeber hört die drei Stile (Harness-Seite). Anmerkungen werden vor dem Weiterbauen notiert und eingearbeitet.
- [ ] **Step 6: Commit** `feat: synth instruments and level tests`

### Task 7: Wiedergabe-Schnittstelle

**Files:** Create `src/audio/play.js`, `src/index.js`, `tests/e2e/play.spec.js`

**Interfaces:**
- Consumes: `createInstruments`, `buildEvents`.
- Produces: `play(ctx: AudioContext, trackInput: TrackInput, options?: { loops?: number; onEvent?: (e: Event) => void; onBar?: (b: {bar: number; chord: Chord}) => void }): { startPerf: number; stop(): void; setLayer(name: string, on: boolean): void; setTempo(bpm: number): void }`. `src/index.js` exportiert `play`, `buildEvents`, `TAG_CATEGORIES`, `STYLE_PRESETS`, `validateTrack`.

- [ ] **Step 1: Write failing tests** (Playwright): `startPerf` liegt nahe an `performance.now()` beim Start (Abweichung unter 250 ms); `onBar` wird in Takt-Reihenfolge mit dem erwarteten Akkord aufgerufen; nach `stop()` kommen keine weiteren Aufrufe; `setLayer('drums', false)` erzeugt ab dann keinen Schlagzeugklang (per Offline-Messung oder Zählung der `trigger`-Aufrufe); kein `AudioContext` entsteht vor dem ersten Klick; keine Konsolenfehler.
- [ ] **Step 2: Run** – Expected: FAIL.
- [ ] **Step 3: Implement** mit Vorausplanung (Timer 25 ms, 100 ms voraus). `setTempo` skaliert die Restzeit der noch nicht geplanten Ereignisse.
- [ ] **Step 4: Run** `npm run test:e2e` – Expected: PASS.
- [ ] **Step 5: Commit** `feat: playback interface`

### Task 8: Sprachen (Deutsch und Englisch)

**Files:** Create `src/i18n/index.js`, `src/i18n/de.js`, `src/i18n/en.js`, `tests/core/i18n.test.js`; Modify `src/index.js`

**Interfaces:**
- Consumes: `TAG_CATEGORIES`, `STYLE_PRESETS`, die Fehlercodes aus `validateTrack`, Schichtnamen `drums|bass|chords|pad`, Skalennamen aus `scalePcs`.
- Produces:
  - `t(key: string, params?: Record<string, string|number>): string`, ersetzt `{name}` durch `params.name`. Unbekannter Schlüssel liefert den Schlüssel selbst und wirft nicht.
  - `setLanguage(lang: 'de'|'en'): void` (wirft bei anderen Werten), `getLanguage(): 'de'|'en'`
  - `detectLanguage(navLang: string): 'de'|'en'` (`'de'`, `'de-AT'` → `'de'`, alles andere → `'en'`)
  - `de.js` und `en.js` exportieren je ein flaches `Record<string, string>` mit Schlüsseln `category.<id>`, `tag.<category>.<tag>`, `style.<id>`, `style.<id>.hint`, `layer.<name>`, `scale.<name>`, `err.<code>`, `ui.<name>` (z. B. `ui.go`, `ui.tonight`, `ui.stop`, `ui.fineTune`, `ui.newVariant`).
  - `src/index.js` exportiert zusätzlich `t`, `setLanguage`, `getLanguage`.

- [ ] **Step 1: Write failing tests** `tests/core/i18n.test.js`: `de` und `en` haben exakt dieselben Schlüssel, alle Werte nicht leer; für jede Kategorie, jedes Schlagwort, jeden Stil, jede Schicht, jede Skala und jeden Fehlercode aus dem Kern gibt es den passenden Schlüssel in beiden Sprachen; `setLanguage('en'); t('ui.go') === 'Go'` und `setLanguage('de'); t('ui.go') === 'Los'`; `t('err.chordNotInKey', {chord: 'C#'})` enthält `C#` in beiden Sprachen; `t('does.not.exist') === 'does.not.exist'`; `detectLanguage('de-AT') === 'de'`, `detectLanguage('fr') === 'en'`; `setLanguage('fr')` wirft.
- [ ] **Step 2: Run** `npm test` – Expected: FAIL.
- [ ] **Step 3: Implement** `t` ohne Bibliothek. Alle Texte der Mockups und des Plans in beide Dateien. Akkordsymbole werden nicht übersetzt (internationale Schreibweise, `B` bleibt `B`, kein deutsches `H`), Annahme, in `docs/interface.md` vermerken. Speichern der Sprachwahl gehört zur Oberfläche (Task 9).
- [ ] **Step 4: Run** – Expected: PASS.
- [ ] **Step 5: Commit** `feat: i18n with German and English`

### Task 9: Oberfläche – Startsatz, Auswahl, Feintuning

**Files:** Create `src/ui/index.html`, `src/ui/app.css`, `src/ui/app.js`, `src/ui/lanes.js`, `src/ui/wheel.js`, `tests/e2e/ui.spec.js`

**Interfaces:**
- Consumes: `play`, `buildEvents`, `TAG_CATEGORIES`, `STYLE_PRESETS`, `diatonicChords`, `t`, `setLanguage`, `detectLanguage`.
- Produces: `drawLanes(canvas: HTMLCanvasElement, events: Event[], positionSec: number): void`; `createWheel(canvas: HTMLCanvasElement, state: { key: Key; progression: Chord[]; current: Chord|null }, onPick: (c: Chord) => void): { update(state): void }`.

- [ ] **Step 1: Write failing tests** (Playwright):
  - Startseite zeigt den Startsatz (de: "Heute Abend:", en: "Tonight:") mit Tonart/Skala, Stil und Tempo; Klick auf Los startet (Zeiger bewegt sich), erneuter Klick stoppt.
  - Klick auf ein unterstrichenes Wort öffnet die Auswahl; Auswahl eines Stils ändert den Satz.
  - "andere Variante" ändert die Variantennummer und die angezeigte Folge bleibt gültig.
  - Feintuning öffnet die zweite Ansicht; Schichten per Klick stumm schaltbar; Tempo änderbar.
  - Schlagworte sind in Kategorien sichtbar, mehrere pro Kategorie wählbar; Stil-Wahl belegt sie vor.
  - Klick auf einen Akkord im Rad fügt ihn der Folge hinzu, Klick auf einen Akkord in der Folge entfernt ihn; die Folge darf nie leer werden.
  - Alle vier Schichten aus: Los läuft weiter, keine Konsolenfehler.
  - Kein `AudioContext` vor der ersten Geste.
  - Sprachumschalter DE/EN: Wechsel auf Englisch ändert Startsatz, Knöpfe, Schlagwort- und Stilbeschriftungen und `<html lang>` ohne Neuladen; die Wahl bleibt nach Neuladen erhalten (`localStorage`, Zugriff in `try/catch`, ohne Speicher läuft die Seite weiter); beim ersten Besuch folgt die Sprache `navigator.language`; in beiden Sprachen entspricht kein sichtbarer Text dem Muster eines rohen Schlüssels (`/^(ui|tag|style|err|layer|scale|category)\./`), auch nicht in den Canvas-Beschriftungen; ein ungültiger Track zeigt seine Fehlermeldung in der gewählten Sprache.
- [ ] **Step 2: Run** `npm run test:e2e` – Expected: FAIL.
- [ ] **Step 3: Implement** nach den Mockups aus `.superpowers/brainstorm/*/content/` (`start-mix-b-c.html`, `chord-wheel.html`, `tags-by-category.html`) im Notenheft-Stil. Rad: Quintenzirkel, passende Akkorde kräftig umrandet, aktueller Akkord als einziges farbiges Objekt. Zustand in `app.js` als ein Objekt `{ track, playing, lang }`, Oberfläche rendert daraus neu. Alle sichtbaren Texte, auch Canvas-Beschriftungen, über `t`, nie fest eingebaut. Optik vorläufig, Farben und Schrift als CSS-Variablen in `app.css`, damit die spätere Verfeinerung nur dort ansetzt.
- [ ] **Step 4: Run** – Expected: PASS.
- [ ] **Step 5: Hörprobe und Sichtprobe** mit dem Auftraggeber. Anmerkungen einarbeiten.
- [ ] **Step 6: Commit** `feat: ui with start sentence, tuning view, chord wheel`

### Task 10: Einbindung in Interactive Scales (Vertrag)

**Files:** Create `tests/core/contract.test.js`, `docs/interface.md`

**Interfaces:**
- Consumes: `src/index.js`.
- Produces: dokumentierter Vertrag. Ein Track im Format von Interactive Scales (`{ id, title, key, bpm, bars }` ohne `tags`, `seed`, `layers`) wird von `buildEvents` akzeptiert.

- [ ] **Step 1: Write failing test** `contract.test.js`: Track im alten Format ergibt gültige Ereignisse; `chord`-Ereignisse zeigen Takt- und Akkordzeiten, aus denen `buildEvents`-Nutzer `{time, bar, chord, durationSec}` ableiten können; Seed festgelegt ergibt identische Ausgabe, Seed weggelassen ergibt dieselbe Ausgabe nur wenn `normalizeTrack` den Standard-Seed 1 setzt (Dokumentation: Interactive Scales soll für Zufall einen Seed würfeln).
- [ ] **Step 2: Run** – Expected: FAIL oder PASS-nach-Anpassung.
- [ ] **Step 3: Implement** nur, was fehlt (voraussichtlich nichts), und `docs/interface.md` mit Eingabe, `play`, Ereignisstrom, Seed-Regel (festgelegt = wiederholbar).
- [ ] **Step 4: Run** `npm test && npm run test:e2e` – Expected: alles PASS.
- [ ] **Step 5: Commit** `docs: interface contract and compatibility test`
