# Layer registry, lead, percussion and more voices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded four-layer list with one layer registry, then add a lead layer (Job dropdown), a percussion layer (Part dropdown), drum kits and more instrument voices as registry entries and sample packs.

**Architecture:** `src/core/layers.js` is the single list of layers (id, default on/off, jobs, which layer it follows in the arrangement, whether it has the effects chain). Core, audio and UI loop over it. Audio-only facts (trim, echo or room send) live in one table in `synth.js`. Jobs change the generated events (so they go through `player.setTrack`); voices stay playback-only (`player.setVoices`). Sample variants are packs cut from MuseScore_General by `scripts/extract-samples.mjs`.

**Tech Stack:** Plain ES modules, Web Audio, `node --test tests/core`, Playwright (`npm run test:e2e`), `ffmpeg` (installed) for pack extraction.

**Spec:** `docs/superpowers/specs/2026-11-10-layer-registry-and-new-layers-design.md`

## Global Constraints

- Work on a new branch `feat/layer-registry` (the repo is on `main`, PRs go to `develop`); commit per task, commit messages end with the Co-Authored-By line from the session.
- Same track + same seed gives byte-identical events as before when `lead` job is `off` and `percussion` is off. `tests/core/golden.test.js` guards this and must pass after every task.
- New layers are appended after `drums, bass, chords, pad` everywhere (event push order breaks ties between equal times).
- Each layer keeps its own rng fork: `master.fork(layer)`.
- Core (`src/core/`) stays pure: no audio, no DOM. Validation returns language-free codes; every code and every id needs `de` and `en` strings (`tests/core/i18n.test.js` checks).
- Code comments are German, like the rest of the repo; UI strings in both `src/i18n/de.js` and `en.js`.
- Voices are playback-only: changing a voice never changes events. Jobs change events.
- Lead notes lie in MIDI 72 to 88, monophonic (each note ends at or before the next one starts), inside the bar (`b.start <= t < b.end`), in the key's scale or the bar's chord tones.
- The `.sf3` is at `C:\Users\lorda\AppData\Local\Temp\claude\84ff408a5aa68f0a\fc301f97-2e50-40f9-9893-843209376b8c\scratchpad\msg.sf3` (re-download from the URL in the script header if missing). It never goes into the repo.
- `src/assets/samples/` holds only finished packs (`<id>.json` + `<id>.pcm`).

## Review Focus

1. A track saved before this change (no `jobs`, `layers` without `lead`/`percussion`, `voices` without `drums`, mix storage with only the old four names) loads and plays unchanged. (Task 1, 2, 3)
2. `jobs` that is not an object, or contains an unknown layer or job id, gives `badJob`, never a crash; `null` and missing are fine. (Task 3)
3. Lead and percussion in 3/4, 5/4, 6/8, 12/8 and in 1-beat or odd-length bars: events stay inside the bar, no overlapping lead notes. (Task 4, 6)
4. Lead over every chord quality (power, dim, aug, 7ths, extended) and a 1-bar track. (Task 4)
5. A kit or pack that fails to load: the synth voice keeps playing (never silence), and switching kit live does not cut notes already sounding. (Task 8, 10)

---

### Task 1: Layer registry and the core consumers

**Files:**
- Create: `src/core/layers.js`, `tests/core/layers.test.js`
- Modify: `src/core/events.js` (LAYERS, PLAYERS loop), `src/core/arrange.js` (the four hard-coded `on` lists), `src/core/track.js:34` (`normalizeTrack` layer defaults), `src/index.js` (export the registry helpers)
- Also commit: the spec file (still untracked)

**Interfaces:**
- Produces (`src/core/layers.js`, frozen data, German comments):
  - `LAYERS: { [id]: { defaultOn: boolean, follows?: string, jobs?: readonly string[], fx: boolean } }`, key order `drums, bass, chords, pad` for now.
  - `LAYER_IDS: readonly string[]` (= `Object.keys(LAYERS)`), `layerDefaults(): Record<string, boolean>` (the `defaultOn` map).
  - `jobsFor(layer): readonly string[]` (empty if none), `isJob(layer, job): boolean`, `completeJobs(jobs): Record<string,string>` (first job of each layer that has jobs; a valid given job wins; anything else falls back to the default; new object, input unchanged).
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests** in `tests/core/layers.test.js`: `LAYER_IDS` deep-equals `['drums','bass','chords','pad']`; the registry is deep-frozen; `layerDefaults()` is all true; `jobsFor('drums')` is `[]`; `completeJobs(undefined)`, `completeJobs({ nope: 'x' })` and `completeJobs('str')` return `{}` (no layer has jobs yet).
- [ ] **Step 2: Run** `node --test tests/core/layers.test.js` and confirm it fails (module missing).
- [ ] **Step 3: Implement `src/core/layers.js`** as above.
- [ ] **Step 4: Derive the core consumers.** `events.js`: `LAYERS` constant becomes `LAYER_IDS`; `PLAYERS` stays keyed by layer id (a layer without an entry produces no events, so later tasks can add registry entries first). `arrange.js`: `sections[i].layers` is built from `LAYER_IDS`: `layers[id] = on.includes(LAYERS[id].follows ?? id)`; the `on` lists and `SLOW_FIRST/SLOW_SHUFFLED` stay as they are for the four old layers. `track.js`: `layers: { ...layerDefaults(), ...t.layers }`.
- [ ] **Step 5: Run** `node --test tests/core` — everything including `golden.test.js` passes unchanged.
- [ ] **Step 6: Commit** `refactor: layer registry for the core consumers` (include the spec).

### Task 2: Audio and UI consumers derive from the registry

**Files:**
- Modify: `src/audio/mix.js` (`MIX_NAMES = [...LAYER_IDS, 'master']`), `src/audio/render.js` (`LAYERS` from the registry; `renderNote` rejects non-pitched layers by `layer === 'drums'` today: use a registry-independent rule "layer has a `note` voice" later, for now keep the drums exception), `src/audio/synth.js` (`TRIM`, the `status`/`generation` objects, `layerParams`, the `play` map, the echo/room branches), `src/ui/state.js` (`LAYERS`, `ALL_LAYERS`, `state.track.layers`, the `mix` comment), `src/ui/lanes.js` (`LANES`), `src/ui/mixer.js`, `src/ui/tuning.js`, `src/ui/app.js`, `tests/core/mix.test.js` if its literals need the derived list
- Test: `tests/core/mix.test.js`, `tests/core/layers.test.js`

**Interfaces:**
- Consumes: `LAYER_IDS`, `LAYERS`, `layerDefaults` (Task 1).
- Produces: in `synth.js` one table `LAYER_AUDIO = { drums: { trim: 0.65, room: true }, bass: { trim: 0.24 }, chords: { trim: 1, echo: true }, pad: { trim: 0.8, echo: true } }` replacing `TRIM` and the `name === 'drums'` / `name === 'chords' || name === 'pad'` branches; `play[name]` is built for every layer id as `(out, t, e) => impl[name](out, t, e)` for voiced layers and the drum branch stays for drums until Task 8.

- [ ] **Step 1: Add a failing test** to `tests/core/layers.test.js` that derives expectations from the registry: `MIX_NAMES` equals `[...LAYER_IDS, 'master']`, `DEFAULT_MIX` has exactly those keys, `loadMix` of a stored object with only `{drums, bass}` fills the rest with 1.
- [ ] **Step 2: Run it**, expect a pass for the derived-names parts only after the change (fails now for the missing import).
- [ ] **Step 3: Replace every hand-written list** found by `grep -rn "'drums', 'bass', 'chords', 'pad'" src` and `grep -rn "pad: true" src` with the registry (state.js default layers: `layerDefaults()`).
- [ ] **Step 4: Run** `node --test tests/core` and `npm run test:e2e` (mixer, mix, play, levels, voices-ui specs). All pass, no visible change.
- [ ] **Step 5: Commit** `refactor: audio and UI derive layers from the registry`.

### Task 3: Jobs, the two new layer entries, validation, the generic Job dropdown

**Files:**
- Modify: `src/core/layers.js` (add `lead`, `percussion`), `src/core/track.js` (`jobs` in `normalizeTrack`, `badJob` in `VALIDATION_CODES`, `checkJobs`), `src/core/events.js` (pass `job` to a layer's `play`), `src/ui/state.js` (`state.track.jobs`), `src/ui/app.js`, `src/ui/timbre-panel.js` (groups built for every registry layer, not only `DEFAULT_TIMBRE` groups), new `src/ui/jobs-panel.js`, `src/ui/index.html` if needed, `src/i18n/de.js` + `en.js`
- Test: `tests/core/layers.test.js`, `tests/core/track.test.js` (count 13 to 14), `tests/core/i18n.test.js`, `tests/e2e/voices-ui.spec.js` (or a new `tests/e2e/jobs-ui.spec.js`)

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: registry entries `lead: { defaultOn: true, follows: 'chords', fx: true, jobs: ['off','fills','arpeggio','melody','callResponse'] }` and `percussion: { defaultOn: false, follows: 'drums', fx: false, jobs: ['mixed','shaker','tambourine','congas','bongos','claves','cowbell'] }`; `normalizeTrack` adds `jobs: completeJobs(t.jobs)`; `validateTrack` reports `{ code: 'badJob', params: { layer, job } }` for an unknown layer, an unknown job, or a non-object `jobs` (`layer: '?'`); `initJobs({ render, player, changed })` in `jobs-panel.js` builds one `<select id="job-<layer>">` per layer with jobs, inside that layer's `details[data-group]`; changing it sets `state.track.jobs[layer]` and calls `applyLive({ patterns: true })` (pattern change, like tag changes). i18n keys: `layer.lead`, `layer.percussion`, `group.lead`, `group.percussion`, `ui.job.lead`, `ui.job.percussion`, `job.lead.<id>`, `job.percussion.<id>`, `err.badJob`.
- Events in this task: `PLAYERS.lead` and `PLAYERS.percussion` exist but return no events yet (`play: () => []`, `section: () => null`).

- [ ] **Step 1: Write failing tests.** `track.test.js`: `VALIDATION_CODES` has fourteen entries including `badJob`. `layers.test.js`: `LAYER_IDS` ends with `lead, percussion`; `layerDefaults()` has `lead: true, percussion: false`; `completeJobs({ lead: 'melody', percussion: 'nope', x: 'y' })` equals `{ lead: 'melody', percussion: 'mixed' }`; `completeJobs()` equals `{ lead: 'off', percussion: 'mixed' }`. `validateTrack` reports `badJob` for `jobs: { lead: 'x' }`, `jobs: { nope: 'x' }`, `jobs: 5`, `jobs: []`, and nothing for `jobs: null`, missing, `{}`, `{ lead: 'fills' }`. A golden-style test: `buildEvents` for the funk preset with `jobs` missing equals the same with `jobs: { lead: 'off', percussion: 'mixed' }` and has no `lead`/`percussion` events (the guard for Review Focus 1).
- [ ] **Step 2: Run** `node --test tests/core` and confirm the new tests fail.
- [ ] **Step 3: Implement** registry entries, `jobs` normalization and `checkJobs`; in `events.js` give `play` a seventh argument `job` (`track.jobs[layer]`). Add the i18n strings in both languages (percussion job names: Mixed/Gemischt, Shaker, Tambourine/Tamburin, Congas, Bongos, Claves, Cowbell/Kuhglocke; lead: Off/Aus, Fills/Fills, Arpeggio, Melody/Melodie, Call and response/Frage und Antwort).
- [ ] **Step 4: UI.** `timbre-panel.js` creates a `details[data-group]` for every id in `LAYER_IDS` that is voiced or has jobs (percussion has no timbre fields but needs the group); `jobs-panel.js` as above, label text and option text set from `t()` in the returned render function, same no-redundant-DOM-write rule as `voices-panel.js`. Layer chips, mixer rows and lanes now show five and six layers automatically (Task 2).
- [ ] **Step 5: e2e.** Add `tests/e2e/jobs-ui.spec.js`: the lead group has a Job select with value `off` by default; choosing `melody` while playing keeps playing and shows lead events in the lane; the percussion group has a Part select with value `mixed`; the percussion layer chip starts unpressed.
- [ ] **Step 6: Run** all tests (`node --test tests/core`, `npm run test:e2e`), then **commit** `feat: jobs and the lead and percussion layer entries`.

### Task 4: Lead jobs (events)

**Files:**
- Create: `src/core/lead.js` (job players), `tests/core/lead-events.test.js`
- Modify: `src/core/events.js` (`PLAYERS.lead` uses `lead.js`)

**Interfaces:**
- Consumes: `chordTones`, `scalePcs` from `music.js`; the bar record from `barTimeline` (`b.start, b.end, b.stepSec, b.steps, b.sub, b.chord, b.next, b.index`), `at()`/`note()`/`humanVel()` helpers in `events.js` (export or move them to a small shared helper module, builder's call), `g.chords.arpStep` for the arpeggio rate.
- Produces: `LEAD_JOBS: { [job]: (b, v, rng, params, fill, g, ctx) => Event[] }` for `fills`, `arpeggio`, `melody`, `callResponse` (no entry for `off`); `PLAYERS.lead.play` returns `[]` for `off` and calls the job otherwise. Events are `{ type: 'note', layer: 'lead', midi, vel, dur, t, bar, beat }`. The scale is `scalePcs(track.key, scaleOfMode)`; pass the key through `buildEvents`' per-layer context (builder's call how).

- [ ] **Step 1: Write failing tests** (`lead-events.test.js`, with a helper that builds a 4-bar A-minor track): `off` gives zero lead events; each other job gives at least one lead event on 8 bars; for every job and seed 1..20: all `midi` in 72..88, every note's `t` is inside its bar (`bar start <= t < bar end`), `t + dur <= next note's t` (monophonic), every midi pitch class is in the key's scale or the bar's chord tones; same track + seed is identical twice; different seeds differ for `melody`. Job specifics: `fills` plays only in the last two beats of a bar and not in every bar; `arpeggio` plays at the groove's `arpStep` grid; `melody` has at most 2 notes per bar and the first is a chord tone on beat 0 of the bar; `callResponse` plays in even bars and answers in odd bars with the same rhythm and ends on a chord tone.
- [ ] **Step 2: Run** and confirm the failures.
- [ ] **Step 3: Implement** `lead.js` and wire `PLAYERS.lead`. Per-layer rng `master.fork('lead')` (already the loop's behavior). Intensity from `params.drive` and `params.syncopation` (see how `playChords` uses `params`).
- [ ] **Step 4: Review Focus tests.** Add to the same file: all jobs in `3/4`, `5/4`, `6/8`, `12/8` (set `meter` and matching `beats`), over every quality in `CHORD_QUALITIES`, and a one-bar track: all invariants above hold, no exception. Also run `tests/core/contract.test.js` and `groove-events.test.js` with the lead on `melody`; they stay green.
- [ ] **Step 5: Run** `node --test tests/core` (golden unchanged) and **commit** `feat: lead jobs`.

### Task 5: Lead sound (synth voice, effects chain, level)

**Files:**
- Modify: `src/core/voices.js` (`VOICES.lead = { synth: { kind: 'synth', variants: ['classic'], uses: [] } }`), `src/core/timbre.js` (`DEFAULT_TIMBRE.lead = { fuzz: 0, overdrive: 0, distortion: 0 }`), `src/audio/voices/classic.js` (`leadNote` into `NOTE.lead`), `src/audio/voices/index.js` (`IMPLS.lead`), `src/audio/fx-params.js` (`LAYER_FX.lead`), `src/audio/synth.js` (`LAYER_AUDIO.lead = { trim, echo: true }`, `layerParams.lead = {}`, `status`/`generation` from the voiced layers), `src/audio/guitar-fx.js` comment, `src/i18n/*.js` (`timbre.lead.fuzz|overdrive|distortion`, `voice.lead.synth`, `variant.lead.synth.classic`, `voice.kind` unchanged)
- Test: `tests/core/voices.test.js`, `tests/core/timbre.test.js`, `tests/core/fx-params.test.js`, `tests/core/voices-impl.test.js`, `tests/e2e/levels.spec.js`

**Interfaces:**
- Consumes: Task 3 (the `lead` layer exists), `classicVoice(layer, ctx, { params })`.
- Produces: `leadNote(ctx, out, t, e, p)` monophonic: a sawtooth plus a detuned triangle through a lowpass with a short attack (about 15 ms) and a release that ends within the note plus 0.2 s. `LAYER_FX.lead` starts as a copy of the `chords` profile and `ref` is then set to `0.15 / measured peak` of the lead voice (as the existing comment describes for the other layers).

- [ ] **Step 1: Write failing tests.** `voices.test.js`: `VOICE_LAYERS` includes `lead` and `completeVoices({})` gives `lead: { id: 'synth', variant: 'classic' }`; `usesTimbreField(undefined, 'lead.fuzz')` is true (effects always on) while every `uses` list is empty. `timbre.test.js`: `DEFAULT_TIMBRE.lead` has the three effect fields and `completeTimbre` keeps them. `voices-impl.test.js`: `hasVoice('lead','synth','classic')` is true. `fx-params.test.js`: `fxChainParams({ fuzz: 1 }, 'lead')` does not throw and its `makeup` values are finite and positive.
- [ ] **Step 2: Run** and confirm the failures.
- [ ] **Step 3: Implement** the registry entries, `leadNote`, the audio table and fx profile.
- [ ] **Step 4: Level calibration.** In `tests/e2e/levels.spec.js` add the lead (job `melody`) to the measured layers and bring its rms into the range of the others by changing `LAYER_AUDIO.lead.trim`; write the measured values in a comment like the existing ones. The "all effects at maximum stays under the peak limit" test (see commit 60976f1) must also pass with the lead's effects at maximum.
- [ ] **Step 5: Run** `node --test tests/core` and the e2e specs `levels`, `sound`, `voices-ui`, `mixer`; **commit** `feat: lead voice, effects chain and level`.

### Task 6: Percussion jobs (events)

**Files:**
- Create: `src/core/percussion.js`, `tests/core/percussion-events.test.js`
- Modify: `src/core/events.js` (`DRUM_NAMES` stays; add `PERCUSSION_NAMES = ['shaker','tambourine','congaHigh','congaLow','bongoHigh','bongoLow','claves','cowbell']` exported next to it; `PLAYERS.percussion`)

**Interfaces:**
- Consumes: the bar record and `at()`/`humanVel()` helpers; `grooveCycle(g)`.
- Produces: `PERCUSSION_JOBS: { [job]: (b, rng, params, g) => Event[] }` for `mixed, shaker, tambourine, congas, bongos, claves, cowbell`. Events are `{ type: 'hit', layer: 'percussion', name, vel, t, bar, beat }` with `name` from `PERCUSSION_NAMES`. `mixed` = shaker + tambourine + congaHigh/congaLow. Patterns (builder writes the data): shaker on every grid step of the groove's hat grid with accents on the beat; tambourine on the groove's backbeat steps (the snare steps of the second tier); congas and bongos syncopated; claves on a 3-2 son clave scaled to the cycle; cowbell on the beats. Velocities are below 0.8 so the layer sits behind the kit.

- [ ] **Step 1: Write failing tests:** for each job, seeds 1..10, meters `4/4, 3/4, 6/8, 12/8, 5/4`: events non-empty over 8 bars, `name` is only from the job's instrument set (`mixed` only from its four), `t` inside the bar, `vel` in (0, 0.8], identical for the same seed; `shaker` hits equal the groove grid count per bar; the `percussion` layer produces nothing when `track.layers.percussion` is false (default) and events when true.
- [ ] **Step 2: Run**, confirm failure. **Step 3: Implement** and wire `PLAYERS.percussion` (own rng fork).
- [ ] **Step 4: Run** `node --test tests/core` (golden unchanged, `contract.test.js` green with percussion on) and **commit** `feat: percussion jobs`.

### Task 7: Percussion sound (synth voice, level)

**Files:**
- Create: `src/audio/voices/percussion.js`
- Modify: `src/core/voices.js` (`VOICES.percussion = { synth: { kind: 'synth', variants: ['classic'], uses: [] } }`), `src/audio/voices/index.js` (`IMPLS.percussion`), `src/audio/synth.js` (`LAYER_AUDIO.percussion = { trim, room: true }`, no effects chain since `fx: false`), `src/i18n/*.js` (`voice.percussion.synth`, `variant.percussion.synth.classic`)
- Test: `tests/core/voices.test.js`, `tests/core/voices-impl.test.js`, `tests/e2e/levels.spec.js`

**Interfaces:**
- Produces: `percussionVoice(ctx, { noise })` returning `(out, t, e) => void` that plays by `e.name` for all `PERCUSSION_NAMES` (filtered noise for shaker and tambourine with jingle partials, pitched decaying sines with a short noise click for congas and bongos, two detuned square partials for cowbell, two short sines for claves) and ignores non-hits and unknown names. The classic Rückfall for the layer is this voice.

- [ ] **Step 1: Write failing tests:** `completeVoices({}).percussion` is `synth/classic`; `hasVoice('percussion','synth','classic')`; an offline render of one hit per name through `createInstruments` gives non-silent output with peak below 1 (use the pattern of `tests/e2e/voices-sound.spec.js`).
- [ ] **Step 2: Run**, confirm failure. **Step 3: Implement.**
- [ ] **Step 4: Level.** Measure the percussion layer in `levels.spec.js` (job `mixed`) and set `LAYER_AUDIO.percussion.trim` so it sits clearly below the drums (rms about a third of the drums') — comment the measurement.
- [ ] **Step 5: Run** all tests and **commit** `feat: percussion synth voice`.

### Task 8: Drums join the voice registry

**Files:**
- Create: `src/audio/voices/drums.js` (the drum kit synth moves here from `synth.js`)
- Modify: `src/core/voices.js` (`VOICES.drums = { synth: { kind: 'synth', variants: ['classic'], uses: ['drums.kickPunch','drums.kickLength','drums.snareTone','drums.snareSnap','drums.hatBright','drums.hatLength','drums.room'] } }`), `src/audio/synth.js` (remove `drumVoices`/`TOMS`, `layerParams.drums = drum`, `play.drums` becomes the generic impl call, the room send keeps `LAYER_AUDIO.drums.room`), `src/audio/voices/index.js` (`IMPLS.drums`), `src/i18n/*.js` (`voice.drums.synth`, `variant.drums.synth.classic`), `src/ui/voices-panel.js` only if it hard-codes layers
- Test: `tests/core/voices.test.js`, `tests/core/voices-impl.test.js`, `tests/e2e/voices-ui.spec.js`, `tests/e2e/sound.spec.js`, `tests/e2e/levels.spec.js`

**Interfaces:**
- Produces: `drumKitVoice(ctx, { params, noise })` returning `(out, t, e) => e.type === 'hit' && kit[e.name]?.(out, t, e.vel)` with exactly the sounds `drumVoices` has today (move, do not rewrite); `usesTimbreField` for `drums.*` fields now follows the registry (all used by `synth/classic`).

- [ ] **Step 1: Write failing tests:** `VOICE_LAYERS` includes `drums`; `completeVoices({})` has `drums: { id:'synth', variant:'classic' }`; `validateTrack` accepts `voices: { drums: 'synth' }` and reports `badVoice` for `voices: { drums: 'nope' }`; a track saved without `voices.drums` still validates. A render comparison: the funk preset rendered before and after is bit-identical for the drums layer (use `compareRenders` from `render.js` against a render recorded from the commit before this task; if recording is awkward, assert that every drum name still produces non-silent output and that `levels.spec.js` values are unchanged).
- [ ] **Step 2: Run**, confirm failure. **Step 3: Implement** the move and the registry entry; the voices panel now shows a voice dropdown in the drum group (variant row hidden while a voice has one variant).
- [ ] **Step 4: Run** all unit and e2e tests; **commit** `refactor: drums join the voice registry`.

### Task 9: Extend the pack extractor and build the packs

**Files:**
- Modify: `scripts/extract-samples.mjs` (`PACKS` entries become `{ bank, program, keys? }`; `buildPack` selects the preset by bank and program and keeps only zones whose key range includes one of `keys`), `tests/core/sample-packs.test.js`
- Create: `src/assets/samples/` packs listed below; `scripts/extract-samples.mjs` header comment lists them

**Interfaces:**
- Produces packs (bank:program in the SoundFont): `bass-upright` 0:32, `chords-organ` 0:16, `chords-muted` 0:28, `lead-flute` 0:73, `lead-sax` 0:65, `lead-synth` 0:81, `drums-standard` 128:0, `drums-brushes` 128:40, `drums-jazz` 128:32, `drums-electronic` 128:24, `drums-808` 128:25 (drum packs keep only keys `35,36,37,38,41,42,43,44,46,47,50`), `percussion-studio` 128:0 (keys `54,56,60,61,63,64,75,82`). The existing six packs are rebuilt unchanged (the test compares the new `PACKS` form to the old output for them).
- Rimshot is not a pack: it reuses `drums-standard` with the snare mapped to key 37 (Task 10).

- [ ] **Step 1: Write failing tests** in `sample-packs.test.js`: every `PACKS` id has both files in `src/assets/samples/`, valid JSON with `zones` and `samples`, a `.pcm` whose byte length equals the last sample's `offset + frames * 2`; drum packs contain zones for each of their keys; every pack is below 6 MB; total of new packs is reported (not asserted).
- [ ] **Step 2: Run**, confirm failure (packs missing). **Step 3: Extend the script**, run `node scripts/extract-samples.mjs <path to msg.sf3>`, check that the six old packs are byte-identical (`git status` shows no change in them).
- [ ] **Step 4: Listen check** is not possible here; instead render a note (pitched) or hit (drums) from each pack in `tests/e2e` in Task 10 and check non-silence and level.
- [ ] **Step 5: Run** `node --test tests/core`; **commit** `feat: sample packs for new voices`.

### Task 10: Sample voices for the new variants

**Files:**
- Modify: `src/core/voices.js` (new `sample` variants: `bass: ['finger','pick','upright']`, `chords: ['guitar','epiano','organ','muted']`, `lead: sample ['flute','sax','synth']`, `drums: sample ['standard','brushes','rimshot','jazz','electronic','808']`, `percussion: sample ['studio']`, each `uses: []` except pitched ones that already list `bass.cutoff` / `chords.brightness, chords.length`; drum sample kits `uses: ['drums.room']`), `src/audio/voices/index.js` (`IMPLS` entries), `src/audio/voices/sample.js` (`lead` branch with no filter and no time scaling), new `src/audio/voices/sample-hits.js` (hit sampler for drums and percussion), `src/audio/voices/tunables.js` (a `level` entry for every new key, `decay` for upright, muted guitar; measured), `src/i18n/*.js` (`variant.<layer>.sample.<variant>` for all new variants), `tests/core/voices-impl.test.js`, `tests/core/voices.test.js`, `tests/e2e/voices-sample-sound.spec.js`

**Interfaces:**
- Produces: `sampleHitVoice(packId, keyMap, ctx, deps)` returning `(out, t, e) => void` for `type: 'hit'` events: look up `keyMap[e.name]`, `pickZone(pack.meta.zones, key, e.vel)`, play with `playNote` using `midi = zone.rootKey` (no pitch shift; the zone's own tuning only), `dur` the sample's natural length (let it ring out; closed hat stops the open hat is not required), gain `deps.tuned('level')`. Until the pack is loaded or if loading failed it plays the synth voice of that layer (`deps.classic`), same status reporting as `sampleVoice`. Key maps: drums `{ kick: 36, snare: 38, hat: 42, openHat: 46, tomHigh: 50, tomMid: 47, tomLow: 43 }`, rimshot overrides `snare: 37` and uses pack `drums-standard`; percussion `{ shaker: 82, tambourine: 54, congaHigh: 63, congaLow: 64, bongoHigh: 60, bongoLow: 61, claves: 75, cowbell: 56 }`.
- `createVoice` gets `deps.classic` for drums and percussion as the synth hit voice (Tasks 7 and 8), so it must build those, not `classicVoice` (the generic fallback assumes notes).

- [ ] **Step 1: Write failing tests:** `hasVoice(layer, id, variant)` true for every new key; `isVoice` accepts them; every new sample key has a `level` tunable in `TUNABLES`; the pack id used by each `IMPLS` key exists in `PACKS`; every new `variant.*` and `voice.*` string exists in both languages (extend `i18n.test.js` if it enumerates the registry). e2e: render one note per new pitched variant and one hit per drum kit and percussion name: non-silent, peak below 0.95, rms within 0.5x to 2x of the synth voice of that layer after setting `level`.
- [ ] **Step 2: Run**, confirm failure. **Step 3: Implement**; set each `level` by measuring (same method as the comment in `tunables.js`), put the measured rms numbers in that comment.
- [ ] **Step 4: Failure and live switch tests** (Review Focus 5): with the pack fetch failing (stub `fetch` to reject), a drum hit still produces sound through the synth kit and `voiceStatus().drums` is `'error'`; switching kit while a hit is ringing does not throw and does not cut it (the old source keeps its own gain node).
- [ ] **Step 5: Run** all unit and e2e tests; **commit** `feat: sample variants for bass, chords, lead, drums and percussion`.

### Task 11: Whole-app check and docs

**Files:**
- Modify: `README.md` (layers, jobs, voice list), `docs/interface.md` if it lists layers or track fields (`jobs`, `badJob`), `tests/e2e/*` that assert the number of layers or mixer rows

- [ ] **Step 1: Full runs.** `node --test tests/core` and `npm run test:e2e` all green; fix literals that assume four layers (`grep -rn "toHaveCount(4)" tests`).
- [ ] **Step 2: Run the app** (`npm start`), start a track, pick lead job `melody`, percussion part `congas` with the layer on, switch drums to `808` and bass to `upright`, and confirm sound, lanes, mixer rows (six plus master), the mute chips, and reload (settings that persist still do) work. Report anything that did not.
- [ ] **Step 3: Size report:** total size of `src/assets/samples/` before and after in the final message.
- [ ] **Step 4: Commit** `docs: layers, jobs and voices`.

---

## Self-review

- **Spec coverage:** registry (T1, T2); lead layer, Job dropdown, off by default (T3, T4, T5); percussion Part dropdown (T3, T6, T7); drums in the voice registry (T8); sample variants for bass, chords, lead, drums (6 kits incl. rimshot, electronic, 808), percussion (T9, T10); compatibility (golden tests in every task, Review Focus 1); arrangement `follows` (T1, T3); non-goals untouched. Spec item "lead timbre knobs: none" is honored (only the three effect fields, which the chain needs).
- **Not in the spec but decided here:** the order of work puts jobs plumbing (T3) before the layer content; Review Focus 1 test lives in T3; the rimshot kit is a key remap, not a pack; drum and percussion packs keep only the used keys to stay small.
- **Type consistency:** `LAYERS`, `LAYER_IDS`, `layerDefaults`, `jobsFor`, `isJob`, `completeJobs` (T1) are the only registry names used later; `PERCUSSION_NAMES` (T6) is what T7 and T10 consume; `LAYER_AUDIO` (T2) is extended in T5 and T7.
