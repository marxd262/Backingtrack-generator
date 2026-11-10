# Wählbare Instrumentenstimmen, Phase A: Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Stimmen-Register mit Verdrahtung, den Saitenmodell-Baukasten und drei Stimmen (E-Gitarre clean, E-Bass, E-Piano) bauen, dazu zwei Hörhilfen (Tuning-Panel mit Export, Spektrogramm-Seite). Danach **Halt und Bericht** (Phase B folgt nach der Hörprobe des Nutzers).

**Architecture:** `src/core/voices.js` (reine Daten und Auflösung) trägt Auswahl und Validierung; die Klangerzeugung zieht aus `synth.js` in `src/audio/voices/` um, `createInstruments` wählt je Instrument die Stimme und lässt sie live wechseln. Saitenmodelle berechnen Töne vorab in reinem JavaScript (`string-model.js`) und spielen sie als Puffer. Alle Stimmen-Feinwerte stehen in einer Tabelle `TUNABLES`, die das Tuning-Panel live verstellt und exportiert.

**Tech Stack:** Plain ES modules, Web Audio, `node --test` (Kern), Playwright (Browser).

**Spec:** `docs/superpowers/specs/2026-11-09-instrument-voices-design.md`

## Global Constraints

- Der Standardklang bleibt **bitgleich**: ohne `voices` oder mit `synth`/`classic` identischer Graph, identische Pegel (`levels.spec.js`, `sound.spec.js` unverändert grün). Stimmen ändern nie den Ereignisstrom (`golden.test.js` unverändert).
- `src/core` ohne Audio/DOM-Importe; kein `Math.random` (Rauschen aus `createRng`); LF; Kommentare deutsch mit Umlauten; Texte in `de.js` und `en.js` gleichzeitig (Paritätstest).
- `VALIDATION_CODES` nur additiv (`badVoice`); `src/index.js` nur additiv.
- Nur `bass`, `chords`, `pad` haben Stimmen; Schlagzeug unberührt. Die Verzerrerkette (`guitar-fx.js`) und die Klangregler gelten unverändert für jede Stimme.
- Töne im Bereich Bass MIDI 28 bis 52, Akkorde und Pad MIDI 24 bis 100.
- Kein Merge, kein Push. Danach laufende Dev-Server (Port 4173) beenden. Branch `feat/instrument-voices`.

## Review Focus

- `voices` mit Unbrauchbarem (`null`, Text, Array, unbekanntes Instrument wie `drums`, unbekannte Stimme oder Variante): `validateTrack` meldet `badVoice`, `play` und der Offline-Render fallen ohne Fehler auf den Standard zurück. Task 1 und 2.
- Wechsel der Stimme **mitten in einem klingenden Ton**, vor dem ersten Ton und mehrfach schnell hintereinander: kein Fehler, kein Knacken, alte Töne klingen aus. Task 2 und 4.
- Sehr tiefe und sehr hohe Töne sowie lange Töne im Saitenmodell: endlich, Grundton innerhalb von 5 Cent, Puffer begrenzt. Task 3.
- Ein Akkord mit 6 Tönen gleichzeitig im Saitenmodell: im Planer-Takt berechnet, kein Aufhängen. Task 4.
- Gleicher Track zweimal gerendert mit Saitenstimme: bitgleich; stumm geschaltete Schicht bleibt stumm. Task 4.

---

### Task 1: Stimmen-Register und `badVoice`

**Files:**
- Create: `src/core/voices.js`, `tests/core/voices.test.js`
- Modify: `src/core/track.js` (Code `badVoice`, Prüfung), `src/index.js` (Export `VOICES`), `src/i18n/de.js`, `src/i18n/en.js` (`err.badVoice`, `voice.kind.synth`, `voice.kind.model`, `voice.bass.synth` usw. siehe unten), `tests/core/track.test.js` (Pin der Codes 12 → 13), `tests/core/index.test.js`

**Interfaces:**
- Produces: `VOICES` (eingefroren): `{ bass|chords|pad: { [id]: { kind: 'synth'|'model'|'sample', variants: string[] (erste = Standard), uses: string[] ('gruppe.feld' aus DEFAULT_TIMBRE, nur stimmenspezifische Regler; Fuzz/Overdrive/Distortion gelten immer) } } }`. Phase A enthält: `bass`: `synth` (`classic`), `string` (`finger`, kind `model`); `chords`: `synth` (`classic`), `string` (`electric`, `model`), `epiano` (`rhodes`, `synth`); `pad`: `synth` (`classic`).
- Produces: `DEFAULT_VOICE = { id: 'synth', variant: 'classic' }`, `VOICE_LAYERS = ['bass', 'chords', 'pad']`, `isVoice(layer, id, variant?) -> boolean`, `voicesFor(layer) -> string[]`, `completeVoices(voices) -> { bass, chords, pad }` je `{ id, variant }` (ungültiges oder fehlendes ergibt den Standard; gültige Stimme mit fehlender oder ungültiger Variante ergibt deren erste Variante; Eingabe wird nicht verändert), `resolveVoices(track) -> completeVoices(track?.voices)`.
- Produces: Code `badVoice` mit Parametern `{ layer, voice }` (`voice` = `'id'` oder `'id/variant'`, Text über `show` wie bei den anderen Codes).

- [ ] **Step 1: Failing tests** in `tests/core/voices.test.js`: (a) Register: jede Stimme hat gültiges `kind`, nicht leere eindeutige `variants`, `uses` nur Pfade aus `DEFAULT_TIMBRE`, tief eingefroren; `VOICES.bass.synth.variants[0] === 'classic'` und Standard je Instrument ist `synth/classic`; (b) `completeVoices`: `undefined`, `null`, `[]`, `'x'`, `{ drums: ... }`, `{ bass: 'string' }`, `{ bass: { id: 'string' } }` → `{ id: 'string', variant: 'finger' }`, `{ bass: { id: 'nope' } }` → Standard, `{ chords: { id: 'string', variant: 'nope' } }` → `string/electric`; Eingabe unverändert; (c) `validateTrack({ ...gültig, voices })`: `badVoice` für `{ drums: {...} }`, `{ bass: { id: 'nope' } }`, `{ bass: { id: 'string', variant: 'nope' } }`, `voices: 'x'`, `voices: []`; keine Meldung für fehlend, `null`, `{}`, `{ bass: { id: 'string' } }`, `{ chords: { id: 'epiano', variant: 'rhodes' } }`; (d) i18n: `err.badVoice`, `voice.kind.*`, `voice.<layer>.<id>` und `variant.<layer>.<id>.<variant>` für jeden Registereintrag in beiden Sprachen (der vorhandene Paritätstest deckt Gleichheit der Schlüssel; dieser Test deckt, dass für jeden Eintrag Namen existieren).
- [ ] **Step 2: Run** `node --test tests/core/voices.test.js` — FAIL (Modul fehlt).
- [ ] **Step 3: Implement** `src/core/voices.js` (eingefrorene Tabelle, Funktionen oben) und in `track.js`: `'badVoice'` an `VALIDATION_CODES` anhängen (JSDoc-Typen nachziehen), Prüfung in `validateTrack`: `voices` fehlend/`null` gültig, sonst Objekt (kein Array) mit Schlüsseln aus `VOICE_LAYERS`, jeder Wert fehlend/`null` oder `{ id?, variant? }`, wobei `id` (falls vorhanden) und `variant` (falls vorhanden) über `isVoice` gültig sein müssen. `src/index.js`: `export { VOICES } from './core/voices.js'`. i18n: `err.badVoice` ("Die Stimme {voice} ist für {layer} unbekannt." / "The voice {voice} is unknown for {layer}."), `voice.kind.synth` "Synthese"/"Synthesis", `voice.kind.model` "Saitenmodell"/"String model", `voice.kind.sample` "Samples"/"Samples", Namen: Bass `synth` "Synth", `string` "Saitenmodell"/"String model"; Akkorde `synth` "Synth", `string` "Saitenmodell", `epiano` "E-Piano"; Pad `synth`; Varianten: `classic` "Klassisch"/"Classic", `finger` "E-Bass Finger"/"Electric bass, fingers", `electric` "E-Gitarre clean"/"Electric guitar, clean", `rhodes` "Rhodes".
- [ ] **Step 4: Run** `node --test tests/core` — alles grün (`track.test.js` und `index.test.js` auf 13 Codes bzw. Export `VOICES` angepasst).
- [ ] **Step 5: Commit** `feat: voice registry with badVoice`.

### Task 2: Verdrahtung: Stimmen in `createInstruments`, Live-Umschaltung, Tuning-Tabelle

**Files:**
- Create: `src/audio/nodes.js`, `src/audio/voices/classic.js`, `src/audio/voices/index.js`, `src/audio/voices/tunables.js`, `tests/e2e/voices-sound.spec.js` (läuft im Projekt `offline`, weil der Name auf `sound.spec.js` endet)
- Modify: `src/audio/synth.js`, `src/audio/play.js`, `src/audio/render.js`, `tests/core/play-live.test.js`

**Interfaces:**
- Consumes: `completeVoices`, `resolveVoices` (Task 1).
- Produces in `nodes.js` (aus `synth.js` verschoben, unverändert): `hz(midi)`, `adsr(g, t, a, peak, hold, rel)`, `osc(ctx, type, freq, detune, dest, t, end)`, `gain(ctx, value, dest)`, `noiseBuffer(ctx, rng, seconds, channels?, decay?)`.
- Produces in `voices/classic.js`: `classicVoice(layer, ctx, deps) -> (out, t, e) => void` mit den bisherigen `bassNote`, `chordNote`, `padNote` (Graph bit für bit unverändert; `deps.params` ist das bisherige live aktualisierte Parameterobjekt des Instruments).
- Produces in `voices/index.js`: `createVoice(layer, voice, ctx, deps) -> (out, t, e) => void` (Dispatch auf `IMPLS[layer][`${id}/${variant}`]`; unbekannt → Klassisch), mit `deps = { params, rng, tuned }`, wobei `tuned(name) -> number` den aktuellen Wert eines Tunable dieser Stimme liefert (Standardwert aus `TUNABLES`, überschrieben durch `tuning`).
- Produces in `voices/tunables.js`: `TUNABLES: { [`${layer}/${id}/${variant}`]: { [name]: { min, max, step, value } } }` (in Task 2 leer für alle Einträge), `tunedValue(key, name, tuning) -> number` (Standardwert, überschrieben durch `tuning[key][name]`, auf `[min, max]` begrenzt; unbekannter Name → `NaN` wirft nicht).
- Produces in `synth.js`: `createInstruments(ctx, { ..., voices, tuning })` (`voices` wird mit `completeVoices` aufgefüllt), Rückgabe zusätzlich `setVoices(voices)` (wirkt auf neue Töne, ohne Neustart; alte klingen aus) und `setTuning(tuning)` (wirkt auf neue Töne). `play.js`: Handle `setVoices(voices)` (nach `stop()` ohne Wirkung, wie `setTimbre`), `createInstruments`-Aufruf bekommt `voices: resolveVoices(track)`. `render.js`: `renderLeft` und `compareRenders` geben `voices: resolveVoices(trackInput)` weiter; neu `renderNote(layer, { midi, dur = 0.6, vel = 0.8, seconds = 1.5, voices, tuning, timbre, sampleRate = 44100 }) -> Promise<Float32Array>` (eine Note, nur diese Schicht hörbar, Begrenzer aus, linker Kanal; für Analyse und Tests).

- [ ] **Step 1: Failing tests.** `tests/core/play-live.test.js`: `setVoices` reicht die Eingabe genau einmal an die Instrumente weiter und wirkt nach `stop()` nicht (wie die vorhandenen `setTimbre`-Tests). `tests/e2e/voices-sound.spec.js` (Harness `/ui/render-harness.html`): (a) `renderNote('bass', { midi: 40 })` ohne `voices` ist bitgleich zu `renderNote` mit `voices: { bass: { id: 'synth', variant: 'classic' } }` und zu `{ bass: { id: 'nope' } }`; (b) `__render` über `track.voices` mit ungültigen Formen (`null`, `'x'`, `[]`, `{ drums: {} }`) wirft nicht und ist gleich dem Standard; (c) ungültige Eingabe an `createInstruments` (`voices: 3`) wirft nicht; (d) `setVoices({ bass: { id: 'nope' } })` und `setTuning(7)` werfen nicht.
- [ ] **Step 2: Run** `node --test tests/core/play-live.test.js` und `npx playwright test tests/e2e/voices-sound.spec.js --project=offline` — FAIL.
- [ ] **Step 3: Implement.** Hilfsfunktionen aus `synth.js` nach `nodes.js` verschieben (Drums-Code importiert sie von dort). `bassNote`/`chordNote`/`padNote` unverändert nach `classic.js`. In `createInstruments`: `let current = completeVoices(voices)`; je Schicht `impl[name] = createVoice(name, current[name], ctx, deps)`; `play[name]` ruft `impl[name]`; `setVoices` baut die Implementierungen neu (Saiten-Caches gehen dabei verloren, das ist gewollt); `tuning` live über `tunedValue`. Reihenfolge der Knotenerzeugung und Parameterobjekte unverändert, damit der Standardklang bitgleich bleibt.
- [ ] **Step 4: Run** `node --test tests/core` und `npx playwright test tests/e2e/voices-sound.spec.js tests/e2e/levels.spec.js --project=offline` — grün; die Pegel-Messwerte in `levels.spec.js` unverändert.
- [ ] **Step 5: Commit** `feat: voice dispatch in createInstruments, setVoices, tuning table, renderNote`.

### Task 3: Saitenmodell (reine Funktion)

**Files:**
- Create: `src/audio/string-model.js`, `tests/core/string-model.test.js`

**Interfaces:**
- Produces: `renderString({ midi, seconds, dur, vel, sampleRate, seed, params }) -> Float32Array` (Länge `Math.ceil(seconds * sampleRate)`, ein Kanal), rein und deterministisch (Rauschen aus `createRng(seed)`). `params` (alle Zahlen, Bedeutung wie im Namen; Wertebereiche stehen als Tunables in Task 4): `pluckPos` (Zupfposition als Anteil der Saitenlänge, 0..0.5), `brightness` (0..1, Verlustfilter in der Schleife: höher = Obertöne klingen länger), `decay` (Abklingzeit in s bei mittlerem Anschlag), `excite` (Rauschanteil/Helligkeit der Anregung 0..1), `stiffness` (Inharmonizität 0..1), `pickupPos` (Anteil der Saitenlänge, Kammfilter am Ausgang) und `pickupLp` (Hz, Tiefpass), `body` (Pegel einer festen Resonanzgruppe 0..1). Nach `dur` wird der Ton ausgeblendet (Finger/Hand dämpft, ca. 60 ms).
- Hinweis: Karplus-Strong mit Bruchteil-Verzögerung (Allpass) und Einpol-Tiefpass in der Schleife; die Phasenverzögerung des Verlustfilters wird in der Stimmung ausgeglichen.

- [ ] **Step 1: Failing tests** (`tests/core/string-model.test.js`, Hilfsfunktion `pitchCents(samples, sampleRate, midi)` per Autokorrelation über ein Fenster nach dem Anschlag): (a) Grundton innerhalb von **5 Cent** für jede MIDI-Zahl von 24 bis 100 bei 44100 und 48000 Hz; (b) Ausgabe endlich, nicht stumm (rms > 1e-3), Betrag ≤ 1.5, Länge wie verlangt; (c) gleiche Eingabe zweimal bitgleich, anderer `seed` ergibt anderes Rauschen (Anschlag) aber denselben Grundton; (d) höhere `vel` ergibt höheren Spektralschwerpunkt (Schwerpunkt der ersten 0,2 s) und höheren rms; (e) größeres `brightness` ergibt höheren Schwerpunkt, größeres `decay` ergibt höheren rms am Ende; (f) nach `dur` + 0,15 s ist der Pegel unter 10 % des Pegels bei `dur`; (g) `pluckPos` 0.1 gegen 0.5 ändert das Spektrum (Differenz > 1e-3); `pickupPos` ebenso; (h) Extremwerte der Parameter und `seconds` 4 bleiben endlich.
- [ ] **Step 2: Run** `node --test tests/core/string-model.test.js` — FAIL.
- [ ] **Step 3: Implement** `renderString(...)` wie oben; kein Browser-Objekt, kein `Math.random`.
- [ ] **Step 4: Run** `node --test tests/core` — grün.
- [ ] **Step 5: Commit** `feat: pure string model (extended Karplus-Strong)`.

### Task 4: Saitenstimmen: E-Bass `finger` und E-Gitarre `electric`

**Files:**
- Create: `src/audio/voices/string.js`
- Modify: `src/audio/voices/index.js` (Einträge `bass/string/finger`, `chords/string/electric`), `src/audio/voices/tunables.js`, `tests/e2e/voices-sound.spec.js`

**Interfaces:**
- Consumes: `renderString` (Task 3), `deps` aus Task 2.
- Produces: `stringVoice(layer, variant, ctx, deps) -> (out, t, e) => void`; spielt `renderString(...)` als `AudioBufferSourceNode` mit Pufferzwischenspeicher nach `(Ton, Anschlag in 8 Stufen, Abtastrate, Tunable-Werte)`, höchstens 256 Einträge (ältester fliegt zuerst raus); Notenlänge begrenzt auf 4 s; `tuned('level')` gleicht den Pegel an die Standardstimme an; bei Akkorden (`chords`) Strum: Töne mit gleichem `t` (±1 ms) werden nach Reihenfolge um `i * tuned('strum')` Sekunden gestaffelt (deterministisch, zurückgesetzt bei neuem `t`). Rauschen: `seed` aus Ton und laufender Nummer der Stimme.
- `TUNABLES` für beide Stimmen (Namen aus `params` von Task 3 plus `level`, bei Akkorden `strum`; Bereiche so, dass jeder Tunable von Minimum bis Maximum hörbar etwas ändert): Startwerte nach bestem Wissen für E-Bass (Finger: weiche Anregung, lange Abklingzeit, Tonabnehmer nahe am Steg) und E-Gitarre clean (Plektrum: hellere Anregung, Tonabnehmer zwischen Hals und Mitte), sie werden in der Hörprobe verändert.

- [ ] **Step 1: Failing tests** (`tests/e2e/voices-sound.spec.js`): (a) `renderNote` mit der Saitenstimme für Bass-Töne MIDI 28, 40, 52 und Akkord-Töne 40, 57, 76: Grundton innerhalb von 5 Cent (Autokorrelation im Browser), endlich, nicht stumm; (b) Pegel: rms eines 4-Töne-Akkords bzw. einer Basslinie liegt gegen `synth/classic` im Band **0,7 bis 1,4** (Messwerte in einen Kommentar); (c) gleicher Track zweimal gerendert (`__render` mit `track.voices` = Saitenstimme) bitgleich; (d) stumm geschaltete Schicht (`layers.bass: false` bzw. `setMuted`) mit Saitenstimme bleibt unter 1e-6; (e) Wechsel mitten im Render per `ctx.suspend`: vor dem Wechsel identisch zum Standard, danach anders, kein Wert außerhalb ±1; (f) ein Akkord mit 6 gleichzeitigen Tönen: die Zeit für `trigger` aller Töne (im Browser mit `performance.now()` gemessen) liegt unter 50 ms, bei zweitem Anschlag derselben Töne (Zwischenspeicher) unter 5 ms; (g) jeder Tunable ändert die Ausgabe: für jeden Eintrag in `TUNABLES['…string…']` ist die Differenz zwischen Minimum und Maximum > 1e-4 (rms der Differenz gegen rms).
- [ ] **Step 2: Run** `npx playwright test tests/e2e/voices-sound.spec.js --project=offline` — FAIL.
- [ ] **Step 3: Implement** `stringVoice` und die Tunables.
- [ ] **Step 4: Run** wie in Step 2 sowie `tests/e2e/levels.spec.js` — grün.
- [ ] **Step 5: Commit** `feat: string voices (electric bass, electric guitar)`.

### Task 5: E-Piano `epiano/rhodes`

**Files:**
- Create: `src/audio/voices/epiano.js`
- Modify: `src/audio/voices/index.js`, `src/audio/voices/tunables.js`, `tests/e2e/voices-sound.spec.js`

**Interfaces:**
- Consumes: `deps` und `nodes.js` aus Task 2.
- Produces: `epianoVoice(ctx, deps) -> (out, t, e) => void` (Web-Audio-Graph je Ton: FM mit Träger bei `f` und Modulator mit Frequenzverhältnis, kurzem Glockenanteil (hohes Verhältnis, schnell abklingend), Hüllkurve mit exponentiellem Abklingen, Anschlagstärke steuert den Modulationsindex (heller bei hartem Anschlag); die Klangregler `chords.brightness`, `chords.length`, `chords.tremolo` werden benutzt: Helligkeit skaliert den Index, Länge die Abklingzeit, Tremolo wie bei `chordNote`). Tunables: Frequenzverhältnis, Index, Glockenindex, Abklingzeit, Pegel (`level`).

- [ ] **Step 1: Failing tests** (`voices-sound.spec.js`): Grundton innerhalb von 10 Cent (Autokorrelation) für MIDI 40, 57, 76; Pegelband 0,7 bis 1,4 gegen `synth/classic`-Akkorde; höhere `vel` ergibt höheren Schwerpunkt; `chords.brightness` und `chords.length` wirken hörbar (diff > 0.05); jeder Tunable wirkt (Differenz Minimum zu Maximum > 1e-4); Tonumfang 24 bis 100 endlich.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `epianoVoice` und Tunables.
- [ ] **Step 4: Run** `tests/e2e/voices-sound.spec.js` und `levels.spec.js` — grün.
- [ ] **Step 5: Commit** `feat: electric piano voice (FM)`.

### Task 6: Analysewerkzeug und Spektrogramm-Seite

**Files:**
- Create: `src/audio/analysis.js`, `src/ui/spectrogram.html`, `scripts/spectrogram.mjs`, `tests/core/analysis.test.js`, `tests/e2e/spectrogram.spec.js`
- Modify: `src/audio/spectrum.js` (FFT exportieren, Verhalten unverändert), `docs/interface.md` (nur ein Absatz "Hörhilfen für die Entwicklung")

**Interfaces:**
- Produces in `analysis.js` (rein): `stft(samples, sampleRate, { size = 2048, hop = 512 }) -> { times: number[], freqs: number[], db: Float32Array[] }` (Hann-Fenster, dB gegen den größten Wert, Untergrenze −90); `harmonicTracks(samples, sampleRate, f0, count = 12, { hop = 512 }) -> { harmonic: number, db: number[] }[]` (Pegel der Obertöne `k * f0` über die Zeit); `attackTime(samples, sampleRate) -> number` (Sekunden von 10 % bis 90 % der Hüllkurvenspitze).
- Produces: `src/ui/spectrogram.html?layer=bass&id=string&variant=finger&midi=40&vel=0.8&dur=0.6&seconds=1.5[&ref=/pfad.wav]`: rendert die Note mit `renderNote`, zeichnet auf `<canvas id="plot">` das Spektrogramm (Zeit nach rechts, Frequenz logarithmisch nach oben, Farbe nach dB) und darunter die Verläufe der ersten Obertöne; zeigt in `<pre id="metrics">` Anschlagszeit, Grundton (Cent Abweichung) und Spektralschwerpunkt; mit `ref` oder einer Datei-Auswahl (`#ref-file`) daneben dieselbe Auswertung der Referenzaufnahme.
- Produces: `node scripts/spectrogram.mjs <ausgabe.png> <query>` startet den Server aus `scripts/serve.js` auf einem freien Port, öffnet die Seite mit Playwright (Chromium), wartet auf `#plot[data-ready]` und speichert den Canvas als PNG.

- [ ] **Step 1: Failing tests.** `tests/core/analysis.test.js`: `stft` eines 440-Hz-Sinus hat das Maximum im Frequenz-Bin nahe 440 Hz in jedem Zeitfenster; `harmonicTracks` eines Signals aus Sinus bei 100 und 300 Hz mit exponentiellem Abklingen (Zeitkonstanten 0,3 s und 0,1 s) liefert abfallende Verläufe, der 3. Oberton fällt schneller; `attackTime` einer linearen Rampe von 20 ms auf 1 liegt bei 16 ms ± 2 ms; alle Ausgaben endlich bei Stille. `tests/e2e/spectrogram.spec.js` (Projekt `realtime`): die Seite mit `layer=chords&id=synth&variant=classic&midi=57` zeichnet einen Canvas mit mehr als 5 verschiedenen Farben und setzt `data-ready`; unbekannte Stimme fällt auf den Standard zurück ohne Konsolenfehler.
- [ ] **Step 2: Run** `node --test tests/core/analysis.test.js` — FAIL.
- [ ] **Step 3: Implement** `analysis.js` (`stft` nutzt die nun exportierte FFT), die Seite und `scripts/spectrogram.mjs`.
- [ ] **Step 4: Run** `node --test tests/core` und `npx playwright test tests/e2e/spectrogram.spec.js --project=realtime --no-deps` — grün; dazu manuell `node scripts/spectrogram.mjs $TEMP/probe.png "layer=bass&id=string&variant=finger&midi=40"` und das PNG ansehen (die Datei ist nicht leer und zeigt Obertonlinien).
- [ ] **Step 5: Commit** `feat: analysis tools and spectrogram page`.

### Task 7: Hörprobe-Seite: Stimmenauswahl und Tuning-Panel mit Export

**Files:**
- Modify: `src/ui/render-harness.html`
- Create: `tests/e2e/audition.spec.js`

**Interfaces:**
- Consumes: `VOICES`, `completeVoices` (Task 1), `TUNABLES` (Task 2/4/5), `createInstruments`-Wrapper über die Option `createInstruments` von `play`.
- Produces auf der Seite: je Instrument (`bass`, `chords`, `pad`) zwei `<select>` (`#voice-<layer>`, `#variant-<layer>`, die Varianten folgen der Stimme), die **live** wirken (über `inst.setVoices`); Abschnitt `#tuning` mit einem Regler je Eintrag von `TUNABLES[key]` der gerade gewählten Stimmen (`input[type=range]` mit `min`/`max`/`step`/`value` aus der Tabelle, beschriftet mit dem Namen), live über `inst.setTuning`; Knopf `#export` schreibt den JSON-Text `{ "chords/string/electric": { "pluckPos": 0.2, … } }` (nur geänderte und alle Werte der gerade gewählten Stimmen) in `<textarea id="export-text">`, wählt ihn aus und versucht `navigator.clipboard.writeText` (Fehler werden ignoriert). Die Seite bleibt eine Entwicklerseite (deutsch, ungeschmückt, keine i18n).

- [ ] **Step 1: Failing test** (`tests/e2e/audition.spec.js`, `realtime`): Seite laden, `#voice-chords` auf `string` setzen: `#variant-chords` zeigt `electric`; `#tuning` enthält mindestens einen Regler je Tunable der Stimme; einen Regler bewegen und `#export` klicken: `#export-text` enthält gültiges JSON mit dem geänderten Wert; Wiedergabe starten (`[data-style="funk"]`) und die Stimme während des Spiels wechseln wirft keinen Konsolenfehler und erzeugt keinen zweiten `AudioContext`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/audition.spec.js --project=realtime --no-deps` — FAIL.
- [ ] **Step 3: Implement** die Seite.
- [ ] **Step 4: Run** wie Step 2 — grün.
- [ ] **Step 5: Commit** `feat: audition page with voice selection and tuning export`.

### Task 8: Abschluss Phase A

**Files:**
- Modify: `docs/interface.md` (Feld `voices`, Code `badVoice`, Handle `setVoices`, Abschnitt "So ergänzt man eine Stimme"), `README.md` (ein Satz), `docs/superpowers/specs/2026-11-09-instrument-voices-design.md` (Phase-A-Stand)

- [ ] **Step 1:** Doku ergänzen (Tabellenzeile `voices`: optional, Format, Standard, Fallback; neue Fehlercodes; `setVoices`; Anleitung für eine Stimme: Registereintrag, Klangerzeugung in `src/audio/voices/`, Tunables, Namen in beiden Sprachdateien).
- [ ] **Step 2:** Komplette Suite: `node --test tests/core` und `npx playwright test` — alles grün; Messwerte der Pegel und Stimmgenauigkeit festhalten.
- [ ] **Step 3:** Frischer Reviewer über den Branch; Befunde Critical/Important beheben (je mit Test), Minor im Bericht nennen.
- [ ] **Step 4:** Commit `docs: voices phase A`; Dev-Server beenden.
- [ ] **Step 5:** **Halt.** Bericht an den Nutzer: was gebaut ist, wie man hört (Hörprobe-Seite, Tuning-Panel, Spektrogramm-Skript), Messwerte, bekannte Grenzen, und die Bitte um Hörrückmeldung. Phase B erst danach.
