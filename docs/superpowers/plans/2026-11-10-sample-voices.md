# Sample-Stimmen aus MuseScore_General: Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sample-Stimmen für Bass, Akkorde und Pad aus MuseScore_General bauen (Packs, Sampler, Laden mit Rückfall auf den Synth, Hörprobe), danach Halt für die Hörprobe des Nutzers.

**Architecture:** Ein Skript schneidet Instrumente aus der `.sf3` in kleine Packs (`.json` + `.pcm`). Zur Laufzeit lädt ein Sampler ein Pack erst bei Auswahl, spielt Noten über `AudioBufferSourceNode` mit Hüllkurve und fällt bis zur Bereitschaft auf `synth/classic` zurück. Die Stimmen hängen im vorhandenen Register (`kind: 'sample'`).

**Tech Stack:** Node (Skript, ffmpeg zum Dekodieren), Web Audio, `node --test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-sample-voices-design.md`

## Global Constraints

- Standardklang bitgleich (`levels.spec.js`, `sound.spec.js` unverändert grün); `src/core` ohne Audio/DOM; kein `Math.random`; LF; Kommentare deutsch; Texte in `de.js` und `en.js` gleichzeitig.
- Packs zusammen höchstens etwa 15 MB, nie alle beim Seitenstart geladen. Branch `feat/instrument-voices`; kein Merge, kein Push; Dev-Server danach beenden.
- Die Lizenzvermerke aus `MuseScore_General_License.md` liegen im Repository (`src/assets/samples/LICENSE-MuseScore_General.md`).

## Review Focus

- Ladefehler (404, abgebrochener `fetch`, kaputtes Pack): kein Fehler, Synth spielt weiter, `voiceStatus` zeigt `error`. Task 3.
- Wechsel auf eine Sample-Stimme, bevor das Pack geladen ist, und zurück: kein Fehler, kein doppeltes Laden. Task 3.
- Sehr kurze und sehr lange Noten, Töne außerhalb der Zonen: Hüllkurve endet sauber (kein Wert über 1, kein Knacken am Ende), Tonhöhe stimmt. Task 3.
- Zonenwahl an den Rändern (Taste und Anschlag genau auf der Grenze, Lücken im Register): immer eine Zone oder ein Rückfall, nie `undefined`. Task 2.

---

### Task 1: Soundfont-Packs und Lizenz

**Files:** Create: `scripts/extract-samples.mjs`, `src/assets/samples/*.json`, `src/assets/samples/*.pcm`, `src/assets/samples/LICENSE-MuseScore_General.md`, `tests/core/sample-packs.test.js`. Modify: `scripts/soundfont.mjs` (schon vorhanden: `readSoundFont(path)`; bei Bedarf ergänzen), `scripts/serve.js` nur falls `.pcm` einen Inhaltstyp braucht (`application/octet-stream` ist der Standard).

**Interfaces:**
- Produces: `node scripts/extract-samples.mjs <MuseScore_General.sf3> [out-dir]` schreibt für jedes Paar `bass-finger` (GM 33), `bass-pick` (34), `chords-guitar` (27), `chords-epiano` (4), `pad-strings` (48), `pad-warm` (89) die Dateien `<id>.json` und `<id>.pcm`. Pack-JSON: `{ id, source: 'MuseScore_General', gm: number, samples: [{ offset: number (Bytes im .pcm), frames: number, rate: number, loopStart: number, loopEnd: number (Frames, 0 = keine Schleife) }], zones: [{ keyLo, keyHi, velLo, velHi, sample: number (Index), rootKey: number, tuneCents: number, loop: boolean, attenuationDb: number, attack, hold, decay, release: number (Sekunden), sustainDb: number }] }`.
- Umrechnung: Zeitwerte in Sekunden aus Timecents (`2 ** (tc / 1200)`, `-12000` oder kleiner ergibt 0), `attenuationDb = initialAttenuation / 10`, `sustainDb = sustainVolEnv / 10`, `tuneCents = coarseTune * 100 + fineTune + pitchCorrection` (aus Zone und Sample-Kopf), `rootKey = overridingRootKey ?? originalPitch` (Wert 255 oder fehlend: 60), `loop = sampleModes & 1`; Schleifenpunkte aus dem Sample-Kopf plus Zonen-Offsets, relativ zum Sampleanfang. Samples einmalig je Pack, in Reihenfolge der ersten Verwendung.
- [ ] **Step 1: Failing test** `tests/core/sample-packs.test.js`: für jedes Pack: `.json` und `.pcm` existieren, `id` stimmt mit dem Dateinamen überein, jede Zone verweist auf ein vorhandenes Sample, `offset + frames * 2 <= Größe der .pcm`, Schleife `0 <= loopStart < loopEnd <= frames` wenn `loop`, Tastenbereiche liegen in 0 bis 127 und decken zusammen jede Taste von 28 bis 52 (Bass) bzw. 24 bis 100 (Akkorde, Pad) ab (mit Ausnahme von Lücken, die der Test benennt), Zeiten und Pegelwerte endlich, Summe der `.pcm`-Größen unter 15 MB, die Lizenzdatei enthält den Satz "must be included in any derivative work".
- [ ] **Step 2: Run** `node --test tests/core/sample-packs.test.js` — FAIL.
- [ ] **Step 3: Implement** das Skript; `.sf3`-Samples sind Ogg-Vorbis-Ströme (`sampleType & 0x10`): Bytes `smplAt + start .. smplAt + end` mit `ffmpeg -ac 1 -c:a pcm_s16le` zu Roh-PCM (`-f s16le`) dekodieren; die Rate steht im Sample-Kopf. Die `.sf3` ist **nicht** im Repository: Quelle `https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3` (39,9 MB), Lizenztext von `…/MuseScore_General_License.md`. Packs im Repository ablegen.
- [ ] **Step 4: Run** der Tests — grün.
- [ ] **Step 5: Commit** `feat: sample packs extracted from MuseScore_General`.

### Task 2: Zonenwahl und Umrechnungen (rein)

**Files:** Create: `src/audio/voices/sample-zones.js`, `tests/core/sample-zones.test.js`.

**Interfaces:**
- Produces: `pickZone(zones, midi, vel01) -> zone | null` (Anschlag in 0..127: `Math.round(vel01 * 127)`; Zone, deren Tasten- und Anschlagbereich passt; bei mehreren die mit dem engsten Tastenbereich, bei Gleichstand die erste; keine passende: die Zone mit der nächsten Taste, dann gleiche Anschlagswahl; leere Liste `null`), `playbackRate(zone, midi) -> number` (`2 ** (((midi - zone.rootKey) * 100 + zone.tuneCents) / 1200)`), `dbToGain(db) -> number` (`10 ** (-db / 20)` für Dämpfung), `brightnessHz(value01) -> number` (ab 0.5 gleich 20000, darunter exponentiell bis 400 bei 0).
- [ ] **Step 1: Failing tests:** `pickZone` für Taste und Anschlag genau auf der Grenze (`keyLo`, `keyHi`, `velLo`, `velHi`), Lücke im Register (nächste Zone), überlappende Zonen (engste), leere Liste (`null`), `vel01` 0, 1 und außerhalb (begrenzt); `playbackRate` ist 1 beim Grundton, 2 bei +12, die Feinstimmung wirkt (`tuneCents: 1200` ergibt 2); `dbToGain(0) === 1`, `dbToGain(6)` etwa 0.5; `brightnessHz` ist 20000 bei 0.5 und 1, 400 bei 0, streng steigend zwischen 0 und 0.5.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — grün. **Step 5: Commit** `feat: sample zone picking`.

### Task 3: Sampler, Sample-Stimmen, Laden, Rückfall

**Files:** Create: `src/audio/voices/sampler.js`, `src/audio/voices/sample.js`, `tests/e2e/voices-sample-sound.spec.js`. Modify: `src/core/voices.js` (Stimme `sample` mit Art `sample`; `bass`: Varianten `finger`, `pick`; `chords`: `guitar`, `epiano`; `pad`: `strings`, `warm`; `uses` wie in der Spec), `src/audio/voices/index.js`, `src/audio/voices/tunables.js` (je Variante `level`, bei `chords/sample/guitar` und `chords/sample/epiano` zusätzlich `strum`), `src/audio/synth.js`, `src/audio/render.js`, `src/i18n/de.js`, `src/i18n/en.js` (`voice.<layer>.sample`: "Samples"/"Samples", `variant.<layer>.sample.<variant>`: "E-Bass Finger", "E-Bass Plektrum", "E-Gitarre clean", "E-Piano (Tine)", "Streicher", "Warmes Pad" und englisch).

**Interfaces:**
- Produces in `sampler.js`: `loadPack(id) -> Promise<{ meta, pcm: Int16Array }>` (lädt `new URL('../../assets/samples/<id>.json', import.meta.url)` und `.pcm`, einmal je Seite zwischengespeichert, auch laufende Ladevorgänge; ein Fehler wird **nicht** zwischengespeichert, damit ein neuer Versuch möglich ist), `buffersFor(ctx, pack) -> AudioBuffer[]` (je Sample ein `AudioBuffer` in seiner Rate, Werte `/ 32768`, je Kontext einmal), `playZone(ctx, out, t, { zone, buffer, midi, dur, vel, envScale, attackScale })` (BufferSource mit `playbackRate`, bei `zone.loop` `loop`, `loopStart`, `loopEnd` in Sekunden; Hüllkurve: Dämpfung, Einsatz `attack`, Abklingen auf `sustainDb` in `decay`, am Notenende `release`; stoppt die Quelle nach dem Ausklingen).
- Produces in `sample.js`: `sampleVoice(layer, variant, ctx, deps) -> (out, t, e) => void` mit `deps.status` (Setter) und `deps.classic` (die klassische Stimme als Rückfall); startet das Laden beim Anlegen; solange nicht bereit, ruft jede Note `deps.classic`; Klangregler als Tiefpass (`brightnessHz`) und Zeitfaktoren (Akkorde `length`, Pad `attack`); bei Akkorden Strum wie `string.js`.
- Produces in `synth.js`: `createInstruments(...)` Rückgabe zusätzlich `whenReady() -> Promise<void>` (wartet auf alle Packs der gewählten Stimmen; wirft nie) und `voiceStatus() -> { bass, chords, pad }` je `'ready' | 'loading' | 'error' | 'none'` (`none` für Stimmen ohne Pack). `setVoices` startet das Laden neuer Packs; der Stand wird je Stimmeninstanz geführt. In `render.js` warten `renderLeft` und `renderNote` mit `await instruments.whenReady?.()`, bevor sie Töne auslösen.

- [ ] **Step 1: Failing tests** (`voices-sample-sound.spec.js`, Projekt `offline`; Hilfen wie in `voices-string-sound.spec.js`): (a) je Pack-Variante `renderNote` mit der Stimme ist hörbar (rms > 0.005), endlich, Spitze unter 1, über den Tonumfang (Bass 28, 40, 52; Akkorde und Pad 24, 40, 60, 84, 100) und Grundton innerhalb von 15 Cent (`pitchCents` aus `analysis.js`; bei Nicht-Tonhöhen wie Pad nur Bereichs- und Endlichkeitstest); (b) Pegel: rms gegen `synth/classic` im Band 0,7 bis 1,4 für jede Variante (Bass allein, Akkorde allein, Pad allein, `limiter: false`); (c) gleicher Track zweimal gerendert gleich (rms-Differenz unter 1e-5), stumme Schicht bleibt stumm; (d) **Rückfall:** `createInstruments` mit Sample-Stimme ohne auf `whenReady` zu warten spielt sofort (Synth) und danach (Sample) ohne Fehler; mit `fetch`, das ablehnt oder 404 liefert, bleibt `voiceStatus` auf `error`, `whenReady` löst auf, die Noten klingen weiter als Synth; ein späterer `setVoices` auf dieselbe Stimme versucht erneut zu laden; (e) **Hüllkurve:** eine sehr kurze (0,02 s), eine lange (4 s) Note und ein Ton außerhalb der Zonen bleiben endlich, unter 1 und enden unter 1e-3 spätestens 2 s nach dem Notenende; (f) Wechsel mitten im Render per `ctx.suspend`: vor dem Wechsel gleich Synth, danach anders; (g) jeder Feinwert (`level`, `strum`) ändert die Ausgabe (`strum` mit einem Akkord).
- [ ] **Step 2: Run** `npx playwright test tests/e2e/voices-sample-sound.spec.js --project=offline` — FAIL.
- [ ] **Step 3: Implement** wie oben. **Pegel angleichen:** `level` je Variante aus Messungen (Messwerte als Kommentar bei `tunables.js`).
- [ ] **Step 4: Run** `node --test tests/core`, `voices-sample-sound.spec.js`, `voices-sound.spec.js`, `levels.spec.js` — grün (Standardklang unverändert).
- [ ] **Step 5: Commit** `feat: sample voices with loading and synth fallback`.

### Task 4: Hörprobe-Seite

**Files:** Modify: `src/ui/render-harness.html`, `tests/e2e/audition.spec.js`.

- [ ] **Step 1: Failing test** (`audition.spec.js`, `realtime`): `#voice-bass` enthält `sample` (Gruppe "Samples" über `optgroup` oder Beschriftung), `#variant-bass` zeigt `finger` und `pick`; nach Wahl zeigt `#status-bass` erst "lädt", dann "bereit" (innerhalb von 15 s); "Ton anspielen" wartet auf das Laden und wirft keinen Fehler; Stimme während des Spiels wechseln ohne Fehler und ohne zweiten `AudioContext`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (Zustand je Instrument `#status-<layer>`, abgefragt über `instruments.voiceStatus()` und `whenReady()`; die Auswahl bleibt wie bisher aus dem Register gebaut). **Step 4: Run** — grün. **Step 5: Commit** `feat: audition page shows sample voices and loading state`.

### Task 5: Doku, Gesamtprüfung, Abschluss

**Files:** Modify: `docs/interface.md` (Stimmen-Abschnitt: Sample-Stimmen, Packs und wie man sie baut, `whenReady`, `voiceStatus`, Quelle und Lizenz), `README.md`, `docs/superpowers/specs/2026-11-10-sample-voices-design.md` (Stand).

- [ ] **Step 1:** Doku schreiben. **Step 2:** `node --test tests/core` und `npx playwright test` komplett — grün; Pegel-Messwerte und Pack-Größen festhalten. **Step 3:** Frischer Reviewer über den Branch seit dem letzten Stand; Critical und Important beheben (je mit Test). **Step 4:** Commit `docs: sample voices`; Dev-Server beenden. **Step 5: Halt.** Bericht an den Nutzer mit Hörhinweisen (Hörprobe-Seite, welche Stimmen, was zu beurteilen ist) und der zweiten Stufe (Dropdowns in der Hauptoberfläche).
