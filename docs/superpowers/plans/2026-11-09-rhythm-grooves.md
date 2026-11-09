# Taktarten, Grooves und Komplexitätsregler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fünf Taktarten (4/4, 3/4, 6/8, 12/8, 5/4), ein Groove-Register mit etwa acht Grooves und ein Komplexitätsregler, wobei 4/4-Tracks bitgleich bleiben.

**Architecture:** `src/core/grooves.js` enthält die Taktarten (`METERS`: Schläge und Schritte je Schlag) und das Groove-Register (Muster je Instrument in Stufen). `timeline.js` liefert je Takt Schlagzahl, Raster (`sub`) und `stepSec`; `events.js` liest seine Muster aus dem Groove statt aus festen Tabellen und rechnet mit dem Zyklus des Grooves statt mit 16. `complexity` verschiebt die schon vorhandenen Parameter `drive`, `bassMovement`, `syncopation`. Die Oberfläche bekommt die Gruppe "Rhythmus".

**Tech Stack:** Reines JavaScript (ES-Module), `node:test` (`npm test`), Playwright (`npx playwright test`).

**Spec:** `docs/superpowers/specs/2026-11-09-rhythm-grooves-design.md`

## Beim Planen getroffene Entscheidungen

- Das Vorgehen läuft in Stufen, die den Umbau von `events.js` absichern: **Task 1** nimmt die fehlenden Golden-Hashes mit `variety` aus dem heutigen Code auf, **Task 2** führt Taktart und Raster ein, **Task 3** hebt die heutigen Tabellen unverändert in das Register. In den Tasks 1 bis 3 bleibt **jeder Golden-Hash gleich**; erst danach kommen neue Grooves.
- Feldnamen im Register (vom Dokument dem Bauenden überlassen): siehe Task 3, Interfaces.
- Die konkreten Muster der neuen Grooves (Task 5) stehen nicht im Plan, nur ihr Charakter und ihre Grenzen; die Tests prüfen Gültigkeit, Raster und Komplexitätsverhalten, nicht den Geschmack.

## Global Constraints

- Reines JavaScript, keine Laufzeit-Abhängigkeiten, lokal und offline. Tests vor Code.
- Alle sichtbaren Texte über `t` in `src/i18n/de.js` und `en.js` (Deutsch mit echten Umlauten, gleiche Schlüssel); `tests/core/i18n.test.js` bleibt grün; kein roher Schlüsselname sichtbar (die `RAW_KEY`-Muster der e2e-Specs enthalten `groove|meter`).
- Kein `Math.random`. Kein Browser-Objekt beim Import in `src/core`, `src/i18n`, `src/audio`, `src/index.js`. Bezeichner Englisch, Kommentare Deutsch, LF-Zeilenenden, kein Steuerzeichen in `src`.
- **Bitgleich in 4/4:** `tests/core/golden.test.js` (alle Hashes, auch die in Task 1 ergänzten mit `variety`) bleibt in jedem Task unverändert grün; die Zufallsziehungen für `straight` in 4/4 behalten ihre Reihenfolge.
- Öffentliche Schnittstelle: Track-Format, `chordTimeline`-Zeiten für 4/4-Tracks und das `play`-Handle bleiben; `VALIDATION_CODES` wächst nur um `badMeter`, `badGroove`, `badComplexity`.
- Bestehende Tests sind Regressionsschutz: anpassen, nie abschwächen oder löschen; jede Änderung an einer bestehenden Prüfung im Bericht nennen.
- Befehle: `npm test`, einzelne e2e-Datei `npx playwright test tests/e2e/<datei> --no-deps`, am Ende `npx playwright test` (etwa 12 Minuten).
- Commit-Nachrichten `feat:`/`test:`/`docs:` mit der Co-Authored-By-Zeile der Sitzung. Hörprobe entscheidet der Auftraggeber.

## Review Focus

1. Ereignisse außerhalb des Takts oder Muster, die mit der Taktlänge nicht aufgehen, in jeder Taktart, Groove, Komplexitätsstufe, mit und ohne `variety` (Task 3, 5).
2. Takte mit anderer Schlagzahl als die Taktart (der Track erlaubt `beats` 1 bis 16): Muster schneiden oder wiederholen, ohne Fehler; Fills in kurzen Takten (Task 2, 3).
3. Komplexität 0, 0,5 und 1 über alle Grooves: Standard 0,5 und fehlende Angabe sind gleich, keine `NaN`, Dichte steigt (Task 4).
4. Taktart-Wechsel während der Wiedergabe: Neustart im selben AudioContext, Tempo-Umrechnung nur in der Oberfläche, Akkordfolge bleibt mit den neuen Schlägen (Task 6, 7).
5. Triolen-Raster: Swing ohne Wirkung, Zeiten liegen auf dem Raster plus Jitter, die Hi-Hat-Lautstärken haben so viele Werte wie Schritte je Schlag (Task 2, 5).

---

### Task 1: Golden-Hashes mit variety aufnehmen (vor jedem Umbau)

**Files:**
- Modify: `tests/core/golden.test.js`

**Interfaces:**
- Produces: `GOLDEN_VARIETY` mit `{ count, sha256 }` für `funk`, `psych`, `dreamy` und `legacy`, jeweils `buildEvents({ ...track, variety: true })`; Tests `Golden variety: <id>`.

- [ ] **Step 1:** Ein Wegwerf-Skript im Scratchpad (nicht im Repo) gibt `count` und `sha256` der vier Tracks mit `variety: true` aus dem **heutigen, unveränderten** Code aus (gleiche Rechnung wie der Golden-Test: `createHash('sha256').update(JSON.stringify(events)).digest('hex')`).
- [ ] **Step 2:** Die Werte als `GOLDEN_VARIETY` eintragen und je Track einen Test `Golden variety: <id>` ergänzen. Das ist ein Schutztest: er besteht sofort, weil die Werte aus dem heutigen Code stammen.
- [ ] **Step 3: Gegenprobe:** Eine Konstante in `events.js` vorübergehend ändern (zum Beispiel `JITTER`), die neuen Tests laufen lassen (erwartet: FAIL), die Änderung zurücknehmen (erwartet: PASS).
- [ ] **Step 4:** `npm test`. Erwartet: PASS.
- [ ] **Step 5: Commit** `test: golden hashes for tracks with variety`.

### Task 2: Taktart, Raster und Validierung

**Files:**
- Create: `src/core/grooves.js` (nur Taktarten), `tests/core/meter.test.js`
- Modify: `src/core/timeline.js:19-30`, `src/core/events.js` (`beat: s / 4` an drei Stellen, `at()`, Hi-Hat-Index, Fill-Länge), `src/core/track.js` (Code `badMeter`), `src/i18n/de.js`, `src/i18n/en.js`, `tests/core/track.test.js` (Liste der Codes)

**Interfaces:**
- Produces in `grooves.js`: `METERS` (tief eingefroren: `'4/4': {beats:4, sub:4}`, `'3/4': {beats:3, sub:4}`, `'6/8': {beats:2, sub:3}`, `'12/8': {beats:4, sub:3}`, `'5/4': {beats:5, sub:4}`), `meterKey(meter): string` (`[6, 8]` ergibt `'6/8'`, sonst `''`), `isMeter(meter): boolean` (Array aus genau zwei ganzen Zahlen, Schlüssel in `METERS`), `meterGrid(meter): {beats, sub}` (unbekannt: das Raster von 4/4).
- `barTimeline(track)` liefert je Takt zusätzlich `sub` und rechnet `steps = beats * sub`, `stepSec = 60 / bpm / sub` (für 4/4 exakt wie heute).
- `buildEvents`: `beat = Schritt / b.sub`; `at()` verschiebt nur bei `b.sub === 4` ungerade Schritte (Swing); Hi-Hat-Lautstärke `tier.hat[s % b.sub]` (für 4/4 wie `s % 4`); Fill-Anfang `b.steps - b.sub * Math.min(2, b.beats)`.
- `validateTrack`: ein gesetztes, nicht unterstütztes `meter` meldet `badMeter` mit `params.meter` als Text (`'2/4'`, bei Nicht-Array `'?'`); fehlend oder `null` gilt `[4, 4]`.
- Texte `err.badMeter` (de: "Die Taktart {meter} wird nicht unterstützt. Erlaubt sind 4/4, 3/4, 6/8, 12/8 und 5/4." / en entsprechend).

- [ ] **Step 1: Tests schreiben** (`meter.test.js`): `meterGrid` für alle fünf Taktarten und für Unbekanntes; `isMeter` für `[4,4]`, `[6,8]` wahr und `[2,4]`, `[7,8]`, `[4]`, `'4/4'`, `[4,4,4]`, `[4.5,4]`, `null` falsch; `barTimeline`/`chordTimeline`: Track mit `meter: [6,8]` und `beats: 2` hat `steps` 6, `stepSec` `60/bpm/3`, Takt-Dauer `2*60/bpm`; `[3,4]` mit `beats: 3` Takt-Dauer `3*60/bpm`, `steps` 12; `buildEvents` für jede Taktart mit den heutigen Mustern (noch kein eigener Groove): alle Ereignisse liegen im Takt, sind sortiert, endlich, mit `beat` im Bereich `[0, beats)`; im Triolen-Raster ändert `swing` (Schlagwort `swing`) die Zeiten nicht (gleicher Strom mit und ohne Schlagwort `swing`, soweit dieser sonst nichts ändert: Vergleich von `t` der Hits bei `tags: {rhythm:['swing']}` gegen `{rhythm:['straight']}` zeigt in 6/8 keinen Swing-Versatz um `stepSec/3`); `validateTrack` meldet `badMeter` für `[2,4]`, `[7,8]`, `[4]`, `'x'` mit `params.meter`, und nichts für `[4,4]`, fehlend, `null`, `[3,4]`. `track.test.js`: die Liste der Codes um `badMeter` ergänzen (zehn).
- [ ] **Step 2:** `npm test`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren** wie oben. `grooves.js` importiert nichts.
- [ ] **Step 4:** `npm test`. Erwartet: PASS, **auch `golden.test.js` unverändert**.
- [ ] **Step 5: Commit** `feat: time signatures and the step grid (meter table, bar grid, badMeter)`.

### Task 3: Groove-Register mit dem heutigen Generator

**Files:**
- Modify: `src/core/grooves.js`, `src/core/events.js` (Tabellen raus, Logik liest aus dem Groove)
- Test: `tests/core/grooves.test.js` (neu)

**Interfaces:**
- Produces in `grooves.js`: `GROOVES` (tief eingefroren, Schlüssel = Groove-ID), `DEFAULT_GROOVE` (`{ '4/4': 'straight' }`, wächst in Task 5), `grooveFor(track): groove` (`track.groove`, wenn es zur Taktart des Tracks gehört, sonst `GROOVES[DEFAULT_GROOVE[meterKey]]`, hier vorerst bei jeder Taktart `straight`), `groovesFor(meterKey): string[]` (IDs in Registerreihenfolge), `levelOf(value, thresholds): number` (`thresholds.filter((t) => value >= t).length`, für `[0.35, 0.7]` gleich der heutigen `level`).
- Eintrag `straight` (Taktart `'4/4'`, `fillBeats: 2`):
  - `drums: { thresholds: [0.35, 0.7], tiers: [{ kicks, snare, ghosts, hat }, ...], extraKicks: [..., ...], offbeatKicks, openHatStep, fills, extraFills }`
  - `bass: { thresholds: [0.35, 0.7], tiers: [[Muster...], ...], extra: [[Muster...], ...] }`
  - `chords: { stabs, extraStabs, offbeatStabs, arps, extraArps, arpStep }`.
  Die Werte sind **die heutigen Tabellen aus `events.js`, unverändert** (`DRUMS`, `EXTRA_KICKS`, `OFFBEAT_KICKS`, Hi-Hat-Position 14, `FILLS`, `EXTRA_FILLS`, `BASS`, `EXTRA_BASS`, `STABS`, `EXTRA_STABS`, `OFFBEAT_STABS`, `ARPS`, `EXTRA_ARPS`, `arpStep` 2).
- `events.js`: `STEPS` entfällt; der Zyklus ist `cycle = beats * sub` der Taktart des Grooves (für `straight` 16). Bass-Anlauf `apStep = b.steps - cycle + ap[0]`, Stabs `p = s % cycle`, Arpeggio-Schrittweite `groove.chords.arpStep` mit `notes[v.arp[(s / arpStep) % 8]]` und `humanVel(s % b.sub ? 0.7 : 0.85)`, Notenlänge `arpStep * b.stepSec`; Stab-Länge `(drive < 0.35 ? 4 : 1.5) * b.stepSec * (b.sub / 4)`; Fills: Länge `fillBeats * b.sub`, Zuschnitt `v.fill.slice(fillLen - (b.steps - fillStart))`; Stufenwahl über `levelOf(param, thresholds)`. **Reihenfolge und Anzahl der Zufallsziehungen bleiben je Funktion wie heute.**

- [ ] **Step 1: Tests schreiben** (`grooves.test.js`): `levelOf` gleich der alten `level` für Werte `0, 0.34, 0.35, 0.69, 0.7, 1` mit `[0.35, 0.7]`; Register-Konsistenz über **alle** Grooves (läuft für neue automatisch): `meter` in `METERS`; `thresholds` aufsteigend in (0,1) und `tiers.length === thresholds.length + 1` je Instrument; `extraKicks.length === drums.tiers.length`, `bass.extra.length === bass.tiers.length`; jeder Kick-, Snare-, Geisternoten-, Stab-, Bass-Schritt `0 <= Schritt < cycle` (Bass: `Schritt + Länge` darf den Zyklus nicht überschreiten, `'ap'` genau als letzter Schritt eines Musters mit `ap`); `hat` je Stufe genau `sub` Werte; jedes Bassmuster beginnt mit `[0, 'r', _]`; Fills haben `fillBeats * sub` Einträge und bestehen aus `DRUM_NAMES` oder `null`; `fillBeats` zwischen 1 und der Schlagzahl; `arpStep >= 1`, Arpeggio-Listen enthalten nur 0 bis 3; `groovesFor('4/4')` enthält `straight`; `grooveFor` ohne `groove` und mit unbekanntem `groove` liefert `straight`; die Tabellen sind tief eingefroren.
- [ ] **Step 2:** `npm test`. Erwartet: FAIL (Register fehlt).
- [ ] **Step 3: Implementieren:** Tabellen nach `grooves.js` verschieben (Werte **kopieren, nicht umschreiben**), `events.js` liest daraus.
- [ ] **Step 4:** `npm test`. Erwartet: PASS, **`golden.test.js` mit allen Hashes (auch `variety`) unverändert**, `events.test.js` und `chord-events.test.js` unverändert grün. Scheitert ein Hash, den Umbau korrigieren, nie den Hash ändern.
- [ ] **Step 5: Commit** `feat: groove registry with the current generator as the straight 4/4 groove`.

### Task 4: Komplexität

**Files:**
- Modify: `src/core/events.js` (`buildEvents`), `src/core/track.js` (Code `badComplexity`), `src/core/grooves.js` (Funktion), `src/i18n/de.js`, `src/i18n/en.js`, `tests/core/track.test.js`
- Test: `tests/core/complexity.test.js` (neu)

**Interfaces:**
- Produces in `grooves.js`: `applyComplexity(params, complexity): params` (neue Kopie; `complexity` fehlend, `null` oder `undefined` gilt 0,5): `drive' = clamp01(drive + (c - 0.5) * 1.0)`, `bassMovement' = clamp01(bassMovement + (c - 0.5) * 1.0)`, `syncopation' = clamp01(syncopation + (c - 0.5) * 0.6)`; andere Felder unverändert.
- `buildEvents`: nach der Streuung durch `variety` und vor der Arrangement-Berechnung `params = applyComplexity(params, track.complexity)`; bei 0,5 (und fehlend) bleiben die Parameter **gleich** und damit der Strom bitgleich.
- `validateTrack`: `complexity` gesetzt, aber keine endliche Zahl in [0,1], meldet `badComplexity` (`params.complexity` als Text); fehlend, `null` oder `undefined` ist gültig. Text `err.badComplexity` ("Die Komplexität {complexity} ist ungültig. Erlaubt sind Zahlen von 0 bis 1.").

- [ ] **Step 1: Tests schreiben** (`complexity.test.js`): `applyComplexity({drive:.5,swing:0,syncopation:.5,bassMovement:.5,...}, .5)` gleich der Eingabe; bei 0 und 1 die erwarteten, begrenzten Werte (`drive` 0 und 1, `syncopation` 0,2 und 0,8), `swing`, `padWidth`, `arp`, `buildUp` unverändert, Eingabe nicht verändert; `buildEvents` mit `complexity: 0.5` und fehlend gleich (`deepEqual`) für alle neun Stil-Vorlagen mit und ohne `variety`; **Dichte:** für jede Stil-Vorlage und `variety` aus/an ist die mittlere Zahl der Schlagzeug- und Bass-Ereignisse je Takt über 20 Seeds bei `complexity` 0, 0,25, 0,5, 0,75, 1 nicht fallend, und bei 1 insgesamt größer als bei 0; alle Ereignisse bei jeder Stufe gültig (Bereiche, Reihenfolge, endlich); `validateTrack` meldet `badComplexity` für `-0.1`, `1.1`, `NaN`, `'x'`, `Infinity`, und nichts für `0`, `1`, `0.5`, fehlend, `null`. `track.test.js`: Codes um `badComplexity` (elf).
- [ ] **Step 2:** `npm test`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** `npm test`. Erwartet: PASS, Golden unverändert.
- [ ] **Step 5: Commit** `feat: complexity shifts the pattern parameters`.

### Task 5: Neue Grooves und die Wahl des Grooves

**Files:**
- Modify: `src/core/grooves.js` (Einträge, `DEFAULT_GROOVE`), `src/core/track.js` (Code `badGroove`), `src/i18n/de.js`, `src/i18n/en.js`, `tests/core/track.test.js`, `tests/e2e/sound.spec.js`
- Test: `tests/core/groove-events.test.js` (neu)

**Interfaces:**
- Neue Einträge in `GROOVES` (Taktart: Charakter; die Muster schreibt der Bauende, jedes Muster im Raster seiner Taktart, Stufen von einfach bis komplex nach dem Vorbild von `straight`):
  - `latin` (`4/4`): Clave-artige Kicks und Betonungen, offene Hi-Hat, viele Synkopen in höheren Stufen; `fillBeats` 2.
  - `waltz` (`3/4`): Kick auf 1, Snare oder Rimshot auf 2 und 3, Hi-Hat in Vierteln, höhere Stufen Achtel und Geisternoten; Bass Grundton auf 1, Quinte auf 2/3; Stabs auf 2 und 3 ("oom-pah-pah"); `fillBeats` 1.
  - `waltzRock` (`3/4`): Kick auf 1, Snare auf 3, treibende Achtel; `fillBeats` 1.
  - `ballad68` (`6/8`): Herzschlag-Kick auf 1 und dem vierten Achtel, Snare auf dem vierten Achtel, sanfte Hi-Hat; Arpeggio je Achtel; `fillBeats` 1.
  - `rock68` (`6/8`): Kick 1, Snare 4, Hi-Hat in Achteln, Fills mit Toms; `fillBeats` 1.
  - `shuffle` (`12/8`): Kick auf 1 und 3 (Pulse), Snare auf 2 und 4, Hi-Hat-Muster "lang-kurz" (Schritt 1 und 3 jeder Gruppe), Bass im Walking-Stil; `fillBeats` 2.
  - `slowBlues` (`12/8`): Kick 1, Snare 2 und 4 mit Achteltriolen-Geisternoten, vollere Hi-Hat; `fillBeats` 2.
  - `fiveFour` (`5/4`): 3+2-Gruppierung: Kick auf 1 und 4, Snare auf 3 und 5; Bass folgt der Gruppierung; `fillBeats` 2.
- `DEFAULT_GROOVE`: `'4/4': 'straight'`, `'3/4': 'waltz'`, `'6/8': 'ballad68'`, `'12/8': 'shuffle'`, `'5/4': 'fiveFour'`. `grooveFor(track)` wählt `track.groove`, wenn der Groove zur Taktart des Tracks gehört, sonst den Standard der Taktart.
- `validateTrack`: gesetztes `groove`, das nicht in `GROOVES` steht, meldet `badGroove` (`params.groove` als Text); ein Groove einer anderen Taktart ist **gültig** und wird durch den Standard ersetzt. Text `err.badGroove` ("Der Groove {groove} ist unbekannt.").
- Texte `groove.<id>` (acht) und `meter.<key>` (Schlüssel `meter.4/4` usw., fünf) in beiden Sprachen; deutsche Namen zum Beispiel "Latin", "Walzer", "Rock-Walzer", "Ballade (6/8)", "Rock (6/8)", "Shuffle", "Langsamer Blues", "Fünfviertel".

- [ ] **Step 1: Tests schreiben** (`groove-events.test.js`): **Generatortest** über alle Grooves × `complexity` (0, 0,25, 0,5, 0,75, 1) × `variety` aus/an × 6 Seeds × Tonarten A-Moll und C-Dur × Taktzahl 1 bis 3 Takte mit `beats` der Taktart, `fullFromStart`: `validateTrack` leer; Ereignisse sortiert, endlich; **jedes Ereignis liegt im Takt** (`t >= Taktanfang` und `< Taktende`); `beat` in `[0, beats)`; Töne im Bereich (Bass 28 bis 52, sonst 24 bis 100); jeder Takt hat `chord`- und `pad`-Ereignisse und Schlagzeug-Ereignisse; **Raster:** die Zeit jedes Schlagzeug-Ereignisses liegt bei `Taktanfang + Schritt * stepSec` bis auf 0,02 s (Jitter) plus bei `sub = 4` höchstens `stepSec / 3` (Swing); **Fills:** mit Schlagwort `buildsSlowly` und `length` 8 endet jeder Fill-Takt im Takt und enthält noch Ereignisse vor dem Fill, wenn `fillBeats < beats`; **Takte mit anderer Schlagzahl** (zum Beispiel `beats: 1` und `beats: 7` in jeder Taktart) erzeugen gültige Ereignisse; `chordTimeline` und die `chord`-Ereignisse von `buildEvents` stimmen in Zeit und Dauer überein; `grooveFor`: unbekannt und Groove einer anderen Taktart liefern den Standard; `validateTrack` meldet `badGroove` für `'nope'`, `5`, `{}` und nichts für `'waltz'` in 4/4, fehlend, `null`. `track.test.js`: Codes um `badGroove` (zwölf). `sound.spec.js` (Offline): für jede Taktart ihr Standard-Groove und je ein komplexer Groove bei `complexity` 1: Spitze nach dem Begrenzer unter 0,9 und jede Schicht mit Effektivwert über 0,005.
- [ ] **Step 2:** `npm test`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren** (die acht Grooves als Daten; `events.js` braucht dank Task 3 keine Änderung; wo ein Groove ein Feld braucht, das es noch nicht gibt, im Bericht nennen).
- [ ] **Step 4:** `npm test` (inklusive Golden) und `npx playwright test tests/e2e/sound.spec.js --no-deps -g "Groove"`. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: eight grooves across five time signatures`.

### Task 6: setTrack prüft die Taktart

**Files:**
- Modify: `src/audio/play.js` (`setTrack`), `tests/core/play-live.test.js`

**Interfaces:**
- `setTrack(newTrack)` meldet zusätzlich `false` ohne Änderung, wenn sich die **Taktart** (`meterKey`) gegenüber dem Start unterscheidet, auch wenn die Dauer eines Durchlaufs gleich bleibt (4/4 zu 12/8). Das gilt auch, wenn nur das Raster (`sub`) abweicht. `play()` merkt sich die Taktart des Starts.

- [ ] **Step 1: Tests schreiben** (Attrappen-Kontext wie in den vorhandenen `setTrack`-Tests): Wechsel von `[4,4]` zu `[12,8]` mit gleicher Takt- und Schlagzahl liefert `false` und ändert den Strom nicht; Wechsel von `groove` oder `complexity` bei gleicher Taktart liefert `true` und tauscht den Strom (Menge der Ereignisse nach dem Tausch gleich dem des neuen Tracks ab dem Tauschpunkt wie in den bestehenden Tests); gleiche Taktart, anderes `meter`-Format (`[4,4]` gegen fehlend) liefert `true`.
- [ ] **Step 2:** `node --test tests/core/play-live.test.js`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** `npm test`. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: setTrack refuses a time signature change`.

### Task 7: Oberfläche (Gruppe Rhythmus)

**Files:**
- Create: `src/ui/rhythm.js`, `tests/e2e/rhythm.spec.js`
- Modify: `src/ui/index.html` (neue Gruppe links über den Klangreglern), `src/ui/state.js` (`meter`, `groove`, `complexity` in `state.track`, `deriveBars` und Takte mit `beats` der Taktart), `src/ui/progression-editor.js` (`addChord` mit den Schlägen der Taktart), `src/ui/layout-state.js` (Gruppe `rhythm`, Standard offen) und `tests/core/layout-state.test.js`, `src/ui/app.js`, `src/ui/app.css`, `src/i18n/de.js`/`en.js`

**Interfaces:**
- Produces in `src/ui/rhythm.js`: `initRhythm({ render, restartIfPlaying, applyLive }): () => void` (Muster wie `initChordColor`). Baut in `#rhythm-groups` die Reihen: **Taktart** (`#meter-chips`, ein Chip je Eintrag von `METERS`, Text `meter.<key>`, `aria-pressed`), **Groove** (`#groove-chips`, Chips aus `groovesFor(gewählte Taktart)`, Text `groove.<id>`, der gewählte per `aria-pressed`; ohne gültige Wahl der Standard der Taktart) und **Komplexität** (`#complexity`, `<input type="range" min="0" max="100" step="1">`, `<output>` mit `ui.percent`, Standard 50).
- Verhalten: Groove und Komplexität setzen `state.track.groove`/`complexity` und rufen `applyLive({ patterns: true })` (kein Neustart, ein Instrumentensatz); beim Ziehen der Komplexität höchstens eine Neuberechnung je Bild (`requestAnimationFrame`). Ein Taktartwechsel setzt `state.track.meter` (`[Zähler, Nenner]`), den Standard-Groove der Taktart, **rechnet `bpm` um** (einfache Taktart zu zusammengesetzter `round(bpm * 2 / 3)`, zusammengesetzte zu einfacher `round(bpm * 3 / 2)`, jeweils auf 40 bis 200 begrenzt, gleiche Art bleibt `bpm`), setzt `beats` aller Takte der Folge auf die Schlagzahl der Taktart (Akkorde bleiben) und ruft `restartIfPlaying()`. Ein Klick auf einen Stil ändert `meter`, `groove` und `complexity` nicht.
- `state.track.meter` Standard `[4, 4]`, `groove` und `complexity` fehlen im Anfangszustand (so bleibt der Track wie bisher).
- Texte: `group.rhythm` ("Rhythmus" / "Rhythm"), `ui.meter` ("Taktart" / "Time signature"), `ui.groove` ("Groove" / "Groove"), `ui.complexity` ("Komplexität" / "Complexity"); `RAW_KEY` der e2e-Specs enthält `groove|meter`.

- [ ] **Step 1: Tests schreiben** (`rhythm.spec.js`, 1280 px und 360 px): Gruppe `rhythm` ist offen und steht in der linken Leiste vor den Klang-Gruppen; fünf Taktart-Chips, `4/4` gedrückt; die Groove-Chips folgen der Taktart (`straight` und `latin` in 4/4, `waltz` und `waltzRock` in 3/4 usw.) und der erste ist gedrückt; Komplexität zeigt `50 %`; Wahl von `3/4`: die Folge zeigt weiter dieselben Akkorde, die Taktzeile läuft in 3-Schlag-Takten (Takt-Dauer bei laufender Wiedergabe `3 * 60 / bpm`, geprüft über zwei `onBar`-Abstände wie in den vorhandenen Specs bei hohem Tempo), das Tempo bleibt bei einfacher zu einfacher Taktart; Wechsel von `4/4` auf `6/8` rechnet das Tempo um (100 wird 67); Wechsel von `6/8` zurück auf `4/4` rechnet zurück; Groove und Komplexität ändern während der Wiedergabe **nicht** den Instrumentensatz und nicht den AudioContext (`createConvolver`-Zähler wie in `tuning.spec.js`) und die Ereignisse ändern sich (über die Oberfläche beobachtbar: Verlauf `#lanes` zeichnet anders, geprüft über das Pixel-Signal des Verlaufs oder über die Taktzeile bleibt ohne Sprung); Taktartwechsel während der Wiedergabe startet im selben AudioContext neu (`__audioContexts` bleibt 1); Stilwechsel (`blues`) lässt die gewählte Taktart und den Groove stehen; Tastatur (Tab erreicht Chips und Regler, Enter und Pfeiltasten wirken); beide Sprachen ohne rohen Schlüssel; 360 px ohne waagerechtes Scrollen, Chips mindestens 44 px; `layout-state.test.js`: neue Gruppe `rhythm: true` im Standard.
- [ ] **Step 2:** `npx playwright test tests/e2e/rhythm.spec.js --no-deps`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** `rhythm`, `chord-picker`, `chord-color`, `style-color`, `tuning`, `groups`, `play-page`, `flow`, `layout-stability`, `timbre`, `sidebar-scroll`, `ui` je mit `--no-deps`. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: rhythm group with time signature, groove and complexity`.

### Task 8: Doku und Gesamtlauf

**Files:**
- Modify: `docs/interface.md`, `README.md`

- [ ] **Step 1:** `docs/interface.md`: Abschnitt "Taktarten und Raster" (fünf Taktarten, Schläge und Schritte je Schlag, **`bpm` zählt Schläge der Taktart**, `6/8` und `12/8` punktierte Viertel), "Grooves" (Tabelle der acht mit Taktart, `fillBeats` und Charakter, `GROOVES`/`METERS` nur wenn in `src/index.js` ausgeführt, sonst als `src/core/grooves.js`), "Komplexität" (Formel, Standard 0,5), Track-Tabelle um `groove`, `complexity` und die Beschreibung von `meter` (nicht mehr "ignoriert"), neue Codes `badMeter`/`badGroove`/`badComplexity`, `setTrack` ergänzt um die Taktart, Anleitung "So ergänzt man einen Groove" (Eintrag in `GROOVES`, Texte `groove.<id>`, `npm test` prüft die Konsistenz). `README.md`: ein Absatz zu Taktarten, Grooves und Komplexität.
- [ ] **Step 2:** `npm test` und `npx playwright test` komplett. Erwartet: alles PASS; Abweichungen einzeln benennen.
- [ ] **Step 3: Commit** `docs: time signatures, grooves and complexity`.

---

## Selbstprüfung

- Abdeckung: Taktarten und Raster (T2), Register und bitgleicher Umbau (T1, T3), Komplexität (T4), Grooves und Wahl (T5), `setTrack` (T6), Oberfläche mit Tempo-Umrechnung und Stilverhalten (T7), Doku (T8). Akzeptanz 1 in jedem Node-Lauf (T1 bis T5), 2 in T3, 3 und 4 in T5, 5 in T4, 6 in T7, 7 in T5, 8 in T8.
- Namen: `METERS`, `meterKey`, `isMeter`, `meterGrid`, `GROOVES`, `DEFAULT_GROOVE`, `grooveFor`, `groovesFor`, `levelOf`, `applyComplexity`, `initRhythm`, `badMeter`, `badGroove`, `badComplexity` sind in allen Tasks gleich.
- Review-Fokus-Zuordnung: 1 in T3/T5, 2 in T2/T3/T5, 3 in T4, 4 in T6/T7, 5 in T2/T5.
