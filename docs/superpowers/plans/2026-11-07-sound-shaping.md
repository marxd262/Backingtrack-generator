# Klangformung je Instrument Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jedes Instrument (Schlagzeug, Bass, Akkorde, Pad) bekommt fünf neue Klang-Schlagworte, und die bisher wirkungslosen Schlagworte `gritty`, `warm`, `dark`, `bright`, `psychedelic` (sowie `dreamy`) wirken hörbar auf den Ton.

**Architecture:** Neue reine Logik `src/core/timbre.js` löst Schlagworte in ein Klangmodell (Zahlen 0..1 je Instrument) auf, ohne Zufall und ohne Audio. `play()` und `renderOffline()` reichen es als Option `timbre` an `createInstruments`. Die Stimmen in `src/audio/synth.js` lesen es über reine Abbildungsfunktionen (`src/audio/voice-params.js`), bei neutralen Werten ergeben sie exakt die heutigen Konstanten. Der Ereignisstrom bleibt unverändert.

**Tech Stack:** Reines JavaScript (ES-Module), Web Audio API, `node:test`, Playwright (Offline-Render im Browser).

**Spec:** `docs/superpowers/specs/2026-11-07-sound-shaping-design.md` (dazu `docs/superpowers/specs/2026-11-07-backingtrack-generator-design.md`)

## Global Constraints

- Reines JavaScript, keine Laufzeit-Abhängigkeiten, lokal und offline. Tests vor Code.
- Alle sichtbaren Texte über `t` in `src/i18n/de.js` und `en.js` (Deutsch mit echten Umlauten); Paritätstests in `tests/core/i18n.test.js` bleiben grün; kein roher Schlüsselname sichtbar.
- Kein `Math.random` im Klangmodell und in der Synthese (Rauschen bleibt aus `createRng`). Kein Browser-Objekt beim Import in `src/core`, `src/i18n`, `src/audio` und `src/index.js` (diese Module werden in reinem Node importiert; `AudioContext` nur innerhalb von Funktionen).
- Bezeichner Englisch, Kommentare Deutsch, LF-Zeilenenden.
- Der Ereignisstrom (Töne, Zeiten, Muster) bleibt unverändert: `tests/core/golden.test.js` bleibt unverändert grün.
- Ohne klangformende Schlagworte klingt der Track exakt wie bisher (Basiswerte, siehe Task 2).
- Bestehende Tests sind Regressionsschutz: anpassen, nie abschwächen oder löschen; jede Änderung an einer bestehenden Prüfung im Bericht nennen.
- Pegel: Summe nach dem Begrenzer unter 0,9; jede Schicht einzeln hörbar; Pegelverhältnisse bleiben in den bestehenden Grenzen der `levels.spec.js`, außer wo ein Schlagwort sie bewusst verschiebt (dann Grenzen aus Messwerten, im Test dokumentiert).
- Jedes neue Schlagwort ist messbar hörbar: normierte Differenz des Instrumentensignals gegenüber dem Standard mindestens 0,25 (bei den schwächeren bestehenden Schlagworten `gritty` und `dreamy` mindestens 0,15), siehe `compareRenders` in Task 2.
- Hörprobe entscheidet der Auftraggeber.

## Review Focus

1. Alle Klang-Schlagworte gleichzeitig, auch gegensätzliche (`dark` und `bright`, `sub` und `fuzz` und `round`): keine NaN-/Infinity-Werte im Klangmodell (alle Zahlen in [0,1]), Render endlich, Spitze nach dem Begrenzer unter 0,9, jede Schicht nicht stumm (Task 1, 5).
2. Ungültige Schlagworte (unbekannte Kategorie oder Id, Liste als Text, `null`): `resolveTimbre` wirft dieselben Fehler wie `resolveTags`, `play` mit gültigen Klang-Schlagworten wirft nie (Task 1, 2).
3. Tag-Wechsel während der Wiedergabe (Chip-Klick startet neu): der neue Klang gilt, kein Konsolenfehler, genau ein Player (Task 6).
4. Live-Stummschalten und Tempowechsel mit Klangmodell: `setLayer` und `setTempo` funktionieren weiter, der Echo-Takt folgt dem Tempo (Task 2).
5. Standardklang unverändert und Pegel nicht gekippt: Basiswerte aus dem alten Synth (Task 2), Pegeltests der drei Stile (Task 5, 6).

---

## File Structure

```
src/core/timbre-effects.js   reine Wirkungstabelle Schlagwort -> Verschiebungen (keine Importe)
src/core/timbre.js           DEFAULT_TIMBRE, resolveTimbre
src/core/tags.js             neue Kategorien, collectTags exportiert, INERT_TAGS nutzt beide Tabellen
src/audio/voice-params.js    reine Abbildung Klangmodell -> Stimmenparameter (bass, drums, chords, pad, master)
src/audio/synth.js           Stimmen lesen die Parameter; createInstruments(ctx, { bpm, limiter, timbre })
src/audio/play.js, render.js timbre aus track.tags; render.js: centroid, compareRenders
src/ui/render-harness.html   window.__compare
src/i18n/de.js, en.js        neue Kategorien und Schlagworte
tests/core/timbre.test.js, voice-params.test.js
tests/e2e/levels.spec.js     Basiswerte; tests/e2e/sound.spec.js  Hörbarkeit je Schlagwort
```

### Task 1: Klangmodell und Schlagwörter (rein)

**Files:** Create `src/core/timbre-effects.js`, `src/core/timbre.js`, `tests/core/timbre.test.js`; Modify `src/core/tags.js`, `src/i18n/de.js`, `src/i18n/en.js`, `tests/core/tags.test.js`

**Interfaces:**
- Produces:
  - `TAG_CATEGORIES` um vier Kategorien am Ende erweitert: `drumSound`: `punchy`, `boomy`, `snappy`, `crisp`, `roomy`; `bassSound`: `sub`, `fuzz`, `plucky`, `round`, `resonant`; `chordSound`: `mellow`, `biting`, `chorused`, `tremolo`, `ringing`; `padSound`: `swelling`, `airy`, `glassy`, `thick`, `moving`. Bestehende Kategorien und Schlagworte unverändert.
  - `collectTags(tags: unknown): Set<string>` in `tags.js` exportiert (bisher intern; wirft wie bisher `Error` mit der ungültigen Id im Text).
  - `DEFAULT_TIMBRE` (tief eingefroren): `{ drums: { kickPunch: .5, kickLength: .5, snareTone: .5, snareSnap: .5, hatBright: .5, hatLength: .5, room: 0 }, bass: { sub: 0, fuzz: 0, pluck: .5, cutoff: .5, resonance: .5, roundness: 0 }, chords: { brightness: .5, length: .5, chorus: 0, tremolo: 0 }, pad: { attack: .5, cutoff: .5, lfoSpeed: .5, lfoDepth: .5, shimmer: 0, thickness: .5 }, master: { brightness: .5, echo: .5, reverb: .5 } }`.
  - `resolveTimbre(tags: Record<string, string[]> | null | undefined): Timbre` (neue Kopie je Aufruf, Werte auf [0,1] begrenzt, Schlagworte addieren sich, kein Zufall, mutiert die Eingabe nicht, wirft wie `resolveTags` bei ungültigem Schlagwort).
  - `TIMBRE_EFFECTS` in `timbre-effects.js`, Schlüssel `Schlagwort-Id` -> `{ 'gruppe.feld': Verschiebung }`, genau diese Tabelle:
    - `punchy`: `drums.kickPunch +.35, drums.kickLength -.15, drums.snareSnap +.2`; `boomy`: `drums.kickLength +.4, drums.kickPunch -.2`; `snappy`: `drums.snareSnap +.4, drums.snareTone +.2`; `crisp`: `drums.hatBright +.4, drums.hatLength -.2, drums.snareTone +.15`; `roomy`: `drums.room +.5`.
    - `sub`: `bass.sub +.6, bass.cutoff -.25`; `fuzz`: `bass.fuzz +.6`; `plucky`: `bass.pluck +.4, bass.cutoff +.1`; `round`: `bass.roundness +.6, bass.cutoff -.2, bass.resonance -.2`; `resonant`: `bass.resonance +.45, bass.cutoff +.15`; `gritty`: `bass.fuzz +.3`.
    - `mellow`: `chords.brightness -.35, chords.length +.1`; `biting`: `chords.brightness +.3, chords.length -.2`; `chorused`: `chords.chorus +.5`; `tremolo`: `chords.tremolo +.5`; `ringing`: `chords.length +.4`.
    - `swelling`: `pad.attack +.4`; `airy`: `pad.shimmer +.5, pad.cutoff +.2`; `glassy`: `pad.shimmer +.35, pad.cutoff +.3, pad.thickness -.2`; `thick`: `pad.thickness +.5, pad.cutoff -.1`; `moving`: `pad.lfoSpeed +.4, pad.lfoDepth +.3`.
    - `dark`: `master.brightness -.35, chords.brightness -.1, pad.cutoff -.1, drums.hatBright -.15`; `bright`: `master.brightness +.35, drums.hatBright +.15`; `warm`: `chords.brightness -.2, pad.cutoff -.2, bass.roundness +.2, master.brightness -.1`; `psychedelic`: `master.echo +.3, master.reverb +.25, chords.chorus +.25, pad.lfoDepth +.2`; `dreamy` (zusätzlich zu seiner bestehenden Muster-Wirkung): `master.reverb +.2, pad.attack +.15`.
  - `INERT_TAGS` (bleibt in `tags.js` exportiert) = Schlagworte ohne Eintrag in `EFFECTS` UND in `TIMBRE_EFFECTS`; danach genau `['withBreakouts']`. Keine zyklischen Importe: `timbre-effects.js` importiert nichts, `tags.js` und `timbre.js` importieren aus ihm.
  - i18n (beide Sprachen): `category.drumSound` de "Schlagzeugklang" en "Drum sound"; `category.bassSound` "Bassklang" / "Bass sound"; `category.chordSound` "Akkordklang" / "Chord sound"; `category.padSound` "Padklang" / "Pad sound"; Schlagworte `tag.<kategorie>.<id>`: drumSound: punchy "kräftig"/"punchy", boomy "dröhnend"/"boomy", snappy "knackig"/"snappy", crisp "klar"/"crisp", roomy "räumlich"/"roomy"; bassSound: sub "Sub"/"sub", fuzz "Fuzz"/"fuzz", plucky "zupfend"/"plucky", round "rund"/"round", resonant "resonant"/"resonant"; chordSound: mellow "sanft"/"mellow", biting "bissig"/"biting", chorused "breit"/"chorused", tremolo "zitternd"/"tremolo", ringing "klingend"/"ringing"; padSound: swelling "anschwellend"/"swelling", airy "luftig"/"airy", glassy "glasig"/"glassy", thick "dick"/"thick", moving "bewegt"/"moving".

- [ ] **Step 1: Write failing tests** `tests/core/timbre.test.js` und Anpassung `tests/core/tags.test.js`: `resolveTimbre({})`, `null`, `undefined` ergeben `DEFAULT_TIMBRE` (deepEqual, neue Kopie, Mutation der Kopie ändert spätere Ergebnisse nicht); `DEFAULT_TIMBRE` tief eingefroren; jedes Schlagwort der Tabelle verschiebt genau seine Felder um die genannten Beträge (generischer Test über `TIMBRE_EFFECTS`, plus ausdrückliche Werte für `fuzz` → `bass.fuzz === 0.6`, `dark` → `master.brightness === 0.15`, `sub` → `bass.cutoff === 0.25`); Addition mit Begrenzung: `{ bassSound: ['fuzz', 'plucky'], mood: ['dark', 'bright'] }` hebt sich bei `master.brightness` auf (`0.5`), `{ drumSound: ['punchy','boomy'] }` ergibt `kickLength` `0.75` (0.5 − 0.15 + 0.4), `{ padSound: ['swelling', 'thick'], mood: ['dreamy'] }` bleibt in [0,1]; alle Schlagworte aller Kategorien gleichzeitig: alle Felder endlich und in [0,1] (Review Focus 1); unbekannte Kategorie, unbekanntes Schlagwort, Liste als Text (`{ drumSound: 'punchy' }`) und Schlagwort einer anderen Kategorie werfen `Error` mit der ungültigen Id im Text, genau wie `resolveTags` (gleiche Meldung: Test vergleicht beide Funktionen); `INERT_TAGS` ist `['withBreakouts']` (die bisherige feste Liste in `tags.test.js:90` ändert sich hiermit legitim; Begründung im Bericht); `resolveTags` liefert für alle bisherigen Eingaben unveränderte Parameter (bestehende Tests grün, plus ein Test, dass Schlagworte der neuen Kategorien `Params` nicht verändern); alle neuen Kategorien und Schlagworte stehen in `TAG_CATEGORIES`, haben Schlüssel in `de.js` und `en.js` (der vorhandene Paritätstest deckt es ab, hier nur prüfen, dass er grün ist); jedes Schlagwort aus `TIMBRE_EFFECTS` ist ein gültiges Schlagwort aus `TAG_CATEGORIES` und jedes Feld der Tabelle existiert in `DEFAULT_TIMBRE`.
- [ ] **Step 2: Run** `npm test` – Expected: FAIL.
- [ ] **Step 3: Implement** wie in den Interfaces; `resolveTimbre` nutzt `collectTags`; keine Gegensätze mit Zufall.
- [ ] **Step 4: Run** `npm test` – Expected: PASS inklusive Golden-Test und i18n-Parität; `npm run test:e2e` ebenfalls grün (die UI zeigt die neuen Kategorien über die vorhandene Liste; wenn ein bestehender Test an der festen Zahl der Kategorien oder Chips scheitert, minimal anpassen und melden).
- [ ] **Step 5: Commit** `feat: timbre model and sound-shaping tags`

### Task 2: Anschluss, Messwerkzeug und Basiswerte

**Files:** Modify `src/audio/synth.js`, `src/audio/play.js`, `src/audio/render.js`, `src/ui/render-harness.html`, `tests/e2e/levels.spec.js`, `tests/e2e/play.spec.js`; Create `tests/e2e/sound.spec.js`

**Interfaces:**
- Consumes: `resolveTimbre`, `DEFAULT_TIMBRE` (Task 1).
- Produces:
  - `createInstruments(ctx, { bpm = 100, limiter = true, timbre = DEFAULT_TIMBRE }): Instruments` — nimmt `timbre` an und reicht es an die Stimmen-Fabriken weiter; in diesem Task ändert es den Klang noch nicht (die Stimmen ignorieren es). Ein unvollständiges `timbre` wird mit `DEFAULT_TIMBRE` aufgefüllt, ein ungültiges (`null`, Zahl) wie fehlend behandelt.
  - `play(ctx, trackInput, options)` ruft `createInstruments(ctx, { bpm, timbre: resolveTimbre(track.tags) })` (nach `buildEvents`; eigene `createInstruments`-Hooks bekommen dasselbe Objekt).
  - `renderOffline(trackInput, seconds, { limiter }): Promise<{ peak, rms, centroid, perLayer: Record<layer, { peak, rms, centroid }> }>`: `centroid` = Spektralschwerpunkt in Hz des linken Kanals (reine Funktion `spectralCentroid(samples: Float32Array, sampleRate): number`, ein Radix-2-FFT über das größte Zweierpotenzfenster, das hineinpasst, höchstens 2^16 Abtastwerte, ab dem ersten Ereignis; 0 für Stille); `renderOffline` rendert mit `timbre` aus den Schlagworten des Tracks.
  - `compareRenders(trackA, trackB, seconds, { layer, limiter } = {}): Promise<{ diff, rmsA, rmsB, centroidA, centroidB }>` in `render.js`: rendert beide Tracks (mit `layer` nur diese Schicht allein, sonst Summe) mit gleicher Länge und liefert `diff = rms(a - b) / rms(a)` (a ist der Bezug; 0 bei Stille von a) und die Schwerpunkte; `window.__compare = compareRenders` in `render-harness.html`.
- [ ] **Step 1: Basiswerte aufnehmen (vor jeder Änderung am Klang):** Mit dem unveränderten Synth den Track `Am Am Dm E` (je 4 Schläge, 100 bpm, Seed 1, `length` 24, A-Moll) mit `tags: { development: ['fullFromStart'] }`, 16 s, `limiter` an und aus, per `renderOffline` messen: Summe und jede Schicht `peak` und `rms`. Diese Zahlen als Konstanten in `tests/e2e/levels.spec.js` festhalten (Kommentar: aufgenommen vor Einführung des Klangmodells, Commit-Hash des Vorgängers).
- [ ] **Step 2: Write failing tests:** (a) Basiswerte-Test in `levels.spec.js`: derselbe Track ohne klangformende Schlagworte liefert die festgehaltenen Werte mit relativer Toleranz 1e-6 (Chrome summiert Eingänge in wechselnder Reihenfolge, siehe frühere Regel); (b) `play.spec.js`: eine Spy-Fabrik als `createInstruments` erhält `{ bpm, timbre }` mit `timbre` gleich `resolveTimbre(track.tags)` (deepEqual, importiert in einer `evaluate`-freien Weise: Erwartung als Literale für `tags: { bassSound: ['fuzz'] }` → `bass.fuzz === 0.6`) und eigene Fabriken ohne `timbre`-Auswertung laufen weiter; (c) `sound.spec.js`: `compareRenders` mit identischen Tracks ergibt `diff === 0` (innerhalb 1e-6), mit einem Track, der ein anderes Tempo hat, `diff > 0.25`; `spectralCentroid` einer reinen Sinuswelle (in einer `evaluate`, 1000 Hz, 1 s) liegt innerhalb 2 % von 1000 Hz, Stille ergibt 0; `centroid` in `renderOffline` ist endlich und größer 0 für jede Schicht der Basis-Track; (d) `setLayer`/`setTempo` funktionieren mit einem Track mit Klang-Schlagworten (Spy-Fabrik und echte Instrumente: `setTempo` ändert die Echo-Verzögerung wie zuvor, bestehender Test bleibt grün).
- [ ] **Step 3: Run** `npm run test:e2e -- tests/e2e/levels.spec.js tests/e2e/play.spec.js tests/e2e/sound.spec.js` – Expected: FAIL.
- [ ] **Step 4: Implement** die Signaturen oben (reine Funktionen für `spectralCentroid`, keine Browser-Objekte beim Import).
- [ ] **Step 5: Run** `npm test` und `npm run test:e2e` – Expected: alles PASS, zweimal ohne Flake.
- [ ] **Step 6: Commit** `feat: timbre plumbing, spectral centroid and render comparison`

### Task 3: Bassklang

**Files:** Create `src/audio/voice-params.js` (nur `bassParams` in diesem Task), `tests/core/voice-params.test.js`; Modify `src/audio/synth.js`, `tests/e2e/sound.spec.js`

**Interfaces:**
- Produces: `bassParams(t: Timbre['bass']): { sawDetune: number, lpStart: number, lpEnd: number, lpTime: number, q: number, sineGain: number, sawMix: number, triMix: number, sub: number, drive: number, ... }` (genaue Felder wählt der Bauende; reine Funktion, monoton in jedem Eingang, kein Wert NaN, stetig). Bei `DEFAULT_TIMBRE.bass` ergeben die Felder exakt die heutigen Konstanten (Sägezähne ±6 Cent, Tiefpass 2200→320 Hz in 0,15 s mit Q 4, Sinus als Fundament, Hüllkurve wie bisher). Die Stimme `bassNote` baut daraus: `sub` stärkt den Sinus-Fundamentton und senkt die Grenzfrequenz, `fuzz` setzt einen `WaveShaperNode` mit Tanh-Kennlinie (Drive von 1 bis etwa 20, nachgeregelter Pegel gegen Übersteuern), `pluck` regelt Länge und Tiefe des Filterabfalls, `cutoff` die Grundlage, `resonance` Q (etwa 1 bis 14), `roundness` mischt die Sägezähne zu Dreieckschwingungen.
- [ ] **Step 1: Write failing tests:** Node (`voice-params.test.js`): neutral ergibt exakt die heutigen Konstanten (Werte aus `synth.js` bassNote als Literale), jeder Eingang ist monoton (Tabelle über 0, .25, .5, .75, 1) und endlich, Extreme liegen in den genannten Bereichen. E2E (`sound.spec.js`, Basis-Track wie Task 2, nur Bass-Schicht, `compareRenders` gegen `tags: {}`): je Schlagwort `sub`, `fuzz`, `plucky`, `round`, `resonant`: `diff >= 0.25`; `gritty`: `diff >= 0.15`; Richtungen (Spektralschwerpunkt der Bass-Schicht): `sub` tiefer als Standard, `fuzz` höher, `round` tiefer, `resonant` höher, `gritty` höher; Pegelsicherheit je Schlagwort: Bass-Schicht `rms > 0.005`, Summe nach dem Begrenzer `peak < 0.9`, Summe vor dem Begrenzer `peak < 0.95`, Bass-`rms` höchstens das Dreifache und mindestens ein Viertel des Standard-Basspegels (Grenzen aus Messwerten, im Test dokumentiert; wenn ein Schlagwort lauter oder leiser wird, `bassNote` nachregeln statt die Grenzen zu öffnen); Basiswerte-Test aus Task 2 bleibt grün; Kombination `sub`+`fuzz`+`round`+`resonant`: endlich, Spitze unter 0,9 (Review Focus 1).
- [ ] **Step 2: Run** `npm test` und `npm run test:e2e -- tests/e2e/sound.spec.js` – Expected: FAIL.
- [ ] **Step 3: Implement** `bassParams` und die Stimme; die Abbildung entscheidet der Bauende so, dass die Schwellen eingehalten werden; die Schwellen werden nicht gesenkt, die Wirkung wird stärker gemacht.
- [ ] **Step 4: Run** `npm test` und `npm run test:e2e` – Expected: alles PASS, zweimal ohne Flake.
- [ ] **Step 5: Commit** `feat: bass sound options`

### Task 4: Schlagzeugklang

**Files:** Modify `src/audio/voice-params.js` (`drumParams`), `src/audio/synth.js`, `tests/core/voice-params.test.js`, `tests/e2e/sound.spec.js`

**Interfaces:**
- Produces: `drumParams(t: Timbre['drums']): { kickStart, kickEnd, kickDrop, kickDecay, snareFreq, snareNoise, snareTone, snareDecay, hatFreq, hatClosedDecay, hatOpenDecay, roomSend, ... }` (reine Funktion; neutral = heutige Konstanten: Kick 150→46 Hz in 0,12 s, Ausklang 0,4 s; Snare Bandpass 1900 Hz Q 0,8, Rauschen Ausklang 0,16 s, Dreieck 185 Hz; Hi-Hat Hochpass 7500 Hz, geschlossen 0,04 s, offen 0,2 s; Toms unverändert; `roomSend` 0). Neu: `room` speist einen Teil der Schlagzeugsumme in den vorhandenen Hall (Sendeweg von der Schlagzeug-Schicht zum Hall-Eingang, Stummschalten der Schicht muss den Sendeweg mit stumm schalten).
- [ ] **Step 1: Write failing tests:** Node: neutral gleich heutigen Konstanten, monoton, endlich, Bereiche (`kickStart` 150 bis etwa 260 Hz, Ausklang 0,4 bis etwa 0,9 s, Hi-Hat-Hochpass 4500 bis 11000 Hz usw. wie im Test festgehalten). E2E (nur Schlagzeug-Schicht, `compareRenders` gegen `tags: {}`): `punchy`, `boomy`, `snappy`, `crisp`, `roomy`: `diff >= 0.25`; Richtungen: `boomy` Schwerpunkt tiefer, `crisp` höher, `snappy` höher, `roomy` Schlagzeug-`rms` größer als Standard (Hall-Anteil); `roomy` ohne Schlagzeug-Ereignisse (Schicht aus) erzeugt keinen Klang (stumm geschaltete Schicht ist wirklich still, inklusive Sendeweg: Schlagzeug-Schicht aus → `perLayer.drums` genau 0 und Summe unverändert gegenüber ohne `roomy`); Pegelsicherheit wie in Task 3 (Summe nach Begrenzer unter 0,9, vor Begrenzer unter 0,95, Schlagzeug-`rms` zwischen einem Viertel und dem Dreifachen des Standards); Kombination `punchy`+`boomy`+`snappy`+`crisp`+`roomy` endlich und unter 0,9; Basiswerte aus Task 2 grün.
- [ ] **Step 2: Run** – Expected: FAIL.
- [ ] **Step 3: Implement** `drumParams` und die Schlagzeugstimmen (Kick, Snare, Hi-Hat offen/geschlossen, Toms folgen `kickPunch`/`kickLength` nicht, nur Kick), Sendeweg für `room`.
- [ ] **Step 4: Run** `npm test` und `npm run test:e2e` – Expected: alles PASS, zweimal ohne Flake.
- [ ] **Step 5: Commit** `feat: drum sound options`

### Task 5: Akkorde, Pad und Gesamtklang

**Files:** Modify `src/audio/voice-params.js` (`chordParams`, `padParams`, `masterParams`), `src/audio/synth.js`, `tests/core/voice-params.test.js`, `tests/e2e/sound.spec.js`

**Interfaces:**
- Produces: `chordParams(t)`, `padParams(t)`, `masterParams(t)` als reine Funktionen (neutral = heutige Konstanten: Akkord Tiefpass 3600→900 Hz in 0,25 s, Säge + Rechteck +7 Cent, Ausklang 0,2 s; Pad Tiefpass 1100 Hz Q 0,8, LFO 0,18 Hz Tiefe 450 Hz, Einsatz 0,45 s, Ausklang 0,9 s, Sägezähne −9/0/+9 Cent; Master 0,6, Hall 0,15, Echo nass 0,3, Rückkopplung 0,38, Echo-Ton 2400 Hz, Helligkeit neutral). Neu: `chords.chorus` zusätzliche verstimmte Oszillatoren (±12 Cent) und leichte Breite, `chords.tremolo` Amplituden-LFO (etwa 6 Hz, Tiefe bis etwa 0,7), `chords.length` Ausklang und Haltedauer; `pad.shimmer` leise Oktav-Anteile, `pad.thickness` Verstimmung und zusätzliche Oszillatoren, `pad.attack` 0,05 bis etwa 1,6 s, `pad.lfoSpeed` 0,05 bis etwa 1,2 Hz, `pad.lfoDepth` 100 bis etwa 1500 Hz; `master.brightness` ein Hochregal-Filter auf der Summe (neutral 0 dB, dunkel bis etwa −12 dB, hell bis etwa +9 dB, um 3 kHz), `master.echo` Echo-Pegel 0 bis etwa 0,7 (Rückkopplung bis etwa 0,6), `master.reverb` Hallpegel 0 bis etwa 0,4.
- [ ] **Step 1: Write failing tests:** Node: neutral gleich heutigen Konstanten (Master-Helligkeit neutral = 0 dB), monoton, endlich. E2E (Schicht allein bzw. Summe, `compareRenders` gegen `tags: {}`): `mellow`, `biting`, `chorused`, `tremolo`, `ringing` auf der Akkord-Schicht `diff >= 0.25` (Richtungen: `mellow` Schwerpunkt tiefer, `biting` höher, `ringing` Akkord-`rms` höher); `swelling`, `airy`, `glassy`, `thick`, `moving` auf der Pad-Schicht `diff >= 0.25` (Richtungen: `airy` und `glassy` höher, `thick` tiefer, `swelling` Pad-Spitze in den ersten 0,5 s niedriger als Standard); Mood auf der Summe: `dark` Schwerpunkt tiefer und `bright` höher als Standard (`diff >= 0.25`), `warm` Akkorde und Pad Schwerpunkt tiefer (`diff >= 0.25` auf einer der beiden), `psychedelic` Summe `diff >= 0.25` und Echo-/Hallanteil (Summen-`rms` nach dem letzten Ereignis, im Ausklang gemessen) größer als Standard, `dreamy` auf der Pad-Schicht `diff >= 0.15`; Pegelsicherheit je Schlagwort wie in Task 3 (inklusive Verhältnis der Schichten innerhalb 0,2 bis 1 des lautesten, Grenzen aus Messwerten); Review Focus 1: ALLE Klang-Schlagworte gleichzeitig (auch `dark` und `bright`, `sub` und `fuzz` und `round`): alle Zahlen des Klangmodells in [0,1] (Node), Render endlich, Spitze nach Begrenzer unter 0,9, jede Schicht `rms > 0.005`; Review Focus 4: `setLayer`/`setTempo` mit `psychedelic` (Echo folgt dem Tempo); Basiswerte aus Task 2 grün.
- [ ] **Step 2: Run** – Expected: FAIL.
- [ ] **Step 3: Implement** die drei Abbildungen und die Stimmen/Summenkette (Hochregal-Filter und Pegel für Echo/Hall aus `masterParams`).
- [ ] **Step 4: Run** `npm test` und `npm run test:e2e` – Expected: alles PASS, zweimal ohne Flake.
- [ ] **Step 5: Commit** `feat: chord, pad and overall sound options`

### Task 6: Stile nutzen den neuen Klang, Doku und Gesamtprobe

**Files:** Modify `src/core/tags.js` (Stil-Presets), `docs/interface.md`, `README.md`, bestehende Tests, die feste Preset-Schlagworte erwarten; Modify `tests/e2e/sound.spec.js`, `tests/e2e/tuning.spec.js`

**Interfaces:** `STYLE_PRESETS` Schlagworte um die neuen Kategorien erweitert (Bpm unverändert): `funk`: `drumSound: ['punchy','snappy']`, `bassSound: ['plucky']`, `chordSound: ['biting']`, `padSound: []`; `psych`: `drumSound: []`, `bassSound: ['fuzz']`, `chordSound: ['chorused']`, `padSound: ['swelling','glassy']`; `dreamy`: `drumSound: ['roomy']`, `bassSound: ['round']`, `chordSound: ['mellow']`, `padSound: ['airy','swelling']`. Der Ereignisstrom der Presets bleibt identisch (nur Klang-Schlagworte kommen hinzu): Golden-Hashes unverändert.

- [ ] **Step 1: Write failing tests:** Node: jedes Preset enthält nur gültige Schlagworte, `resolveTags(preset.tags, rng)` ist gleich dem Ergebnis ohne die neuen Kategorien (Muster unverändert, Review Focus 5), der Golden-Test ist unverändert grün; Presets unterscheiden sich im Klangmodell (`resolveTimbre` der drei Presets ist paarweise verschieden und jeder Preset weicht bei mindestens je einem Feld von Bass, Akkorden und Pad vom Standard ab). E2E: die drei Stile klingen messbar verschieden: `compareRenders` der Presets paarweise auf der Summe (gleiche Akkordfolge, gleiches Tempo vorgegeben, nur Schlagworte der Klangkategorien unterscheiden): `diff >= 0.25`; Pegeltests der drei Stile (bestehende `levels.spec.js`, Grenzen nur anpassen, wenn Messwerte es nötig machen, mit Begründung im Test); Oberfläche: im Feintuning/Seitenleiste "Klang" erscheinen die vier neuen Gruppen mit übersetzten Beschriftungen in beiden Sprachen (kein roher Schlüssel), die Schnellwahl markiert einen Stil weiterhin genau dann als gedrückt, wenn Tempo und Schlagworte dem Preset gleichen (bestehende Tests mit festen Preset-Schlagworten, zum Beispiel "Träumerisch setzt Schlagworte", minimal anpassen und melden); ein Klick auf ein neues Klang-Schlagwort während der Wiedergabe startet neu, ohne Konsolenfehler und mit genau einem Player (Review Focus 3); das Schlagwort `withBreakouts` ist als wirkungslos markiert, die anderen früher wirkungslosen nicht mehr (`INERT_TAGS` in der Oberfläche, vorhandener Test).
- [ ] **Step 2: Run** `npm test` und `npm run test:e2e` – Expected: FAIL.
- [ ] **Step 3: Implement** die Preset-Änderung, `docs/interface.md` (Abschnitt Schlagworte: neue Kategorien und Schlagworte, Wirkung nur auf den Klang, der Ereignisstrom ändert sich nicht, `withBreakouts` weiter ohne Wirkung), `README.md` (ein Satz zu den Klang-Schlagworten), Anpassung der Tests.
- [ ] **Step 4: Run** `npm test` und `npm run test:e2e` – Expected: alles PASS, dreimal ohne Flake.
- [ ] **Step 5: Hörprobe vorbereiten:** Die Entwicklerseite `/ui/render-harness.html` spielt die drei Presets bereits; im Bericht beschreiben, welche Schlagwort-Kombinationen der Auftraggeber zum Vergleich anhören sollte (zum Beispiel Bass: `sub`, `fuzz`, `round`, `resonant` nacheinander bei gleichem Stil).
- [ ] **Step 6: Commit** `feat: styles use sound-shaping tags, docs`
