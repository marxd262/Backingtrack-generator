# Layer registry, lead layer, percussion layer, more voices (design)

Agreed in chat on 2026-11-10. Follows `2026-11-09-instrument-voices-design.md` and `2026-11-10-sample-voices-design.md`.

## Intent and why

The generator has four layers (drums, bass, chords, pad). The user wants more instruments in the backing track: a **lead** layer, a **percussion** layer and more voice variants. Today the layer list `['drums','bass','chords','pad']` is hard-coded in about twelve places (event generator, arrangement, track defaults, synth graph, mixer, lanes, tuning, mix state, render helpers, voices panel, i18n). Adding two layers on top of that would copy the list twice more.

**The user decided to fix this first:** make the layer list data-driven (one registry), then add the new layers as registry entries. The registry is the main deliverable; the new layers prove it.

## Goals

1. **Layer registry.** One module lists every layer and its properties. Every place that today names the four layers derives from it instead.
2. **Lead layer** (new). **Off by default.** A **Job dropdown** chooses what it plays: Off (default), Fills, Arpeggio, Melody, Call and response. It has its own mixer slider, mute chip, lane, voice dropdown and guitar-effects chain.
3. **Percussion layer** (new): simple patterns that follow the groove. Off by default. A **Part dropdown** (same mechanism as the lead's Job) chooses the instrument that plays: Mixed (default), Shaker, Tambourine, Congas, Bongos, Claves, Cowbell. Own slider, mute chip, lane and voice dropdown.
4. **More voice variants:** upright bass; organ and muted guitar for chords; brush kit and rimshot kit for drums. Drums join the voice registry for this.
5. Existing tracks, saved settings and seeds keep working (see constraints).

## Non-goals

- Layers defined by the user at runtime, or a plugin system. The registry is a source file.
- Changing the job per section, or several lead jobs at once.
- MIDI export, a new groove, a new timbre knob set for the new layers (they start with none).
- Changing how the existing four layers sound or are arranged.

## Anti-goals (a failure even if it technically works)

- Any change to the generated events of an existing track when lead is Off and percussion is off. Same track + same seed must give identical events as before.
- A lead or percussion line that is loud, busy or clashing by default. A bad generated lead is worse than none.
- A refactor that leaves some of the old hard-coded lists behind, so the next layer needs the same hunt.

## Constraints (from the code as it is)

- Core (`src/core/`) is pure logic with no audio and no DOM; `buildEvents(track)` is deterministic per seed, each layer has its own forked rng (`master.fork(layer)`), so a new layer never shifts the others' randomness. Event order for equal times depends on push order, so **new layers are appended after the existing four**.
- Validation is language-free codes (`VALIDATION_CODES`), translated in `src/i18n/de.js` and `en.js`; tests check that every id has a name in both.
- Sample voices come from packs (`src/assets/samples/<layer>-<variant>.json/.pcm`) made by `scripts/extract-samples.mjs` from the MuseScore_General `.sf3` (MIT). **The `.sf3` is not in the repository**; it must be downloaded (URL in the script header) and `ffmpeg` must be installed to extract new packs.
- `ffmpeg` is installed on the dev machine; the `.sf3` was not on it, so for the instrument check I downloaded it (38 MB, public mirror in the script header) to a scratch folder outside the repo; the extraction step uses the same file. Everything except sample packs (registry, lead, percussion with its synth voice, drums registry entry) works without it, so packs are the last step and never block the rest.
- The golden test passes `layers: ALL_LAYERS`-style input exactly as the app does.
- Tests: `node --test tests/core` (logic) and Playwright e2e (`tests/e2e`).
- Code comments and UI strings follow the repo's existing conventions (German comments, `de`/`en` strings).

## Design

### 1. Layer registry (`src/core/layers.js`, new)

One frozen table, in order: `drums, bass, chords, pad, lead, percussion`. Each entry says only what core needs; audio-only facts (trim, echo send, room send) go in one table in `src/audio/synth.js` keyed by layer id, replacing the `if (name === 'drums')` / `name === 'chords' || name === 'pad'` branches.

Per layer (the builder may adjust field names):

| field | meaning |
|---|---|
| `defaultOn` | value in `track.layers` when missing: true for the four old layers, true for `lead` (its Job dropdown is what keeps it silent), false for `percussion` |
| `voiced` | has a voice dropdown (all except none; drums join) |
| `jobs` | optional list of job ids (first = default); gives the layer a Job/Part dropdown, `track.jobs[layer]` and the `badJob` validation (lead, percussion) |
| `fx` | gets the guitar-effects chain (bass, chords, pad, lead; not drums, percussion) |
| `arrangement` | which sections it plays in (see 4) |

Everything below derives from this table: `LAYERS`/`ALL_LAYERS` (ui/state.js), `LAYERS` in events.js and render.js, `LANES` (ui/lanes.js), `MIX_NAMES` (audio/mix.js), `VOICE_LAYERS`, `normalizeTrack` layer defaults, `SLOW_FIRST/SLOW_SHUFFLED` in arrange.js, and the `status`/`generation`/`layerParams` objects in synth.js (built by looping the registry).

`index.html` has a static `details[data-group="…"]` per layer. The voices panel and the new Job dropdown attach to these groups; the groups for `lead`, `percussion` and `drums` are added (or generated from the registry, builder's call).

### 2. Lead layer

- Both new layers have a "job" (lead: what it plays; percussion: which instrument plays). A job is a **registry feature**, not lead-specific code: a layer entry may list `jobs` (first = default), and a generic dropdown, validation and event dispatch handle it. Track field `jobs: { lead, percussion }`; missing = each layer's default.
- Lead jobs: `off | fills | arpeggio | melody | callResponse` (default `off`). A new validation code `badJob` (params: layer, job) joins `VALIDATION_CODES`, with `err.badJob` in both languages.
- Jobs live in a small registry (`src/core/lead-jobs.js`), one entry per job with a `play(bar, ctx)` function that returns events, same shape as bass/chords notes (`layer: 'lead'`). `off` produces nothing.
- Notes: in the track's key/scale (`scalePcs`, `chordTones` from `music.js`), chord tones on strong beats, scale tones as passing notes, range roughly MIDI 72 to 88 (an octave above the chords). Single voice (monophonic) like bass.
- Jobs, as designed (my calls on the exact musical behaviour, the builder tunes):
  - **Fills:** one short phrase (2 to 5 notes) in the last beat or two of a bar, only in the second half of a section's bars and not every bar.
  - **Arpeggio:** a steady run through the chord tones, one octave up from the chords, rate from the groove's `arpStep`.
  - **Melody:** long, sparse notes (one or two per bar), a chord tone on the downbeat.
  - **Call and response:** a two-bar pattern: a short phrase in bar 1, an answer (the same rhythm, ending on a chord tone) in bar 2.
- Intensity follows the existing track parameters (`drive`, `syncopation`, `swing`) so the lead matches the groove; complexity shifts them as for the other layers.
- Own rng fork `master.fork('lead')`.
- UI: Job dropdown in the lead group of the sidebar (live, no restart, like the voice dropdowns); the lane and mixer row appear like the others.

### 3. Percussion layer

- Jobs (the Part dropdown): `mixed` (default), `shaker`, `tambourine`, `congas`, `bongos`, `claves`, `cowbell`. The job decides the **events** (so changing it goes through `player.setTrack`, like the other pattern controls, not `setVoices`). Hits (`type: 'hit'`, `layer: 'percussion'`, `name` = instrument) come from the groove's grid: shaker on every sixteenth or eighth with accents, tambourine on the backbeat, congas and bongos as syncopated patterns, claves on a clave rhythm, cowbell on the beat. `mixed` plays shaker + tambourine + congas together. Pattern data goes in the groove registry or a small percussion table, builder's call.
- Voices stay playback-only: `synth/classic` (default; noise/tone-based sounds for each instrument, so the layer works with no sample pack) and `sample/studio` (one pack holding all the instruments). The registry therefore needs a `synth` entry for percussion like every other layer.
- Every instrument above exists in MuseScore_General (checked: the same percussion zones are in the Standard, Jazz, Brush and Electronic kits): Small Shaker (key 82), Maracas (70), Cabasa (69), Tambourine (54), High Conga (63), Low Tumba (64), Low Bongo (61), Bongo Rim (60), Clave (75), Cow Bell (56). Possible later additions: cabasa, maracas, triangle (80), guiro, timbales, agogo, castanet, sleigh bells, clap.
- Quiet by default (low trim, velocities below the drum kit).
- Off by default (`defaultOn: false`); the existing mute chip/layer button turns it on. In the app, `track.layers` is only a playback mute (`ALL_LAYERS` is passed to `buildEvents`), so percussion events are always generated and "off" means muted. The lead layer's Job `off` produces no events at all.

### 4. Arrangement of the new layers

The new layers follow the existing build-up rule: `lead` plays in the sections where `chords` plays; `percussion` plays in the sections where `drums` plays. The "slow" build-up order stays as it is for the four old layers (the new ones are not part of the shuffle, so the old events do not change). Fills at section ends are not affected.

### 5. Voices

- `drums` joins `VOICES`: `synth/classic` (the current synthesized kit) is the default and the only one that exists today. Added: `sample/standard`, `sample/brushes`, `sample/rimshot` (the standard kit whose snare is replaced by the side stick), `sample/jazz`, `sample/electronic`, `sample/808` (the user asked for both electronic kits). Drum samples are chosen by note: the registry maps event names to MIDI keys (`kick 36, snare 38, sideStick 37, hat 42, openHat 46, toms 50/47/43`), and the sampler picks the zone for that key.
- `bass`: add `sample/upright`. `chords`: add `sample/organ` and `sample/muted` (muted guitar). `lead`: `synth/classic` plus samples `flute`, `sax`, `synthLead`. `percussion`: `synth/classic` and `sample/studio`.
- **Source presets, checked against the actual MuseScore_General.sf3** (downloaded to a scratch folder to list its presets; nothing added to the repo yet): upright = `Acoustic Bass` (0:32); organ = `Drawbar Organ` (0:16) or `Rock Organ` (0:18); muted guitar = `Palm Muted Guitar` (0:28); flute = `Flute` (0:73); sax = `Alto Sax` (0:65); synth lead = `Saw Lead` (0:81) or `Square Lead` (0:80); drum kits = `Standard` (128:0), `Brush` (128:40), `Jazz` (128:32), `Electronic` (128:24) and `TR-808` (128:25; checked: it has every key the drums use, kick 35/36, snare 38, hats 42/44/46, toms 41 to 50); the rimshot kit is the Standard kit with the snare mapped to key 37 (`Rim Tap`, which exists in every kit). All the variants asked for are available, none had to be dropped. Drum packs hold a whole kit, so their size must be measured against the existing packs (0.35 to 5.3 MB each) before all kits are kept; six drum kits could add up to 15 to 25 MB, so loading must stay per chosen kit (as `loadPack` does), never all at start.
- Drum timbre knobs (my call): the synth kit uses all of them; the sample kits grey them out, as sample voices do for the other layers (`uses: []`, the existing hint appears). `completeVoices` and saved `track.voices` gain a `drums` key; missing = `synth/classic`, so old saved tracks load unchanged.
- Each sample variant is a pack: `<layer>-<variant>.json/.pcm`. Any variant that sounds bad after extraction is dropped and said so in the final report; it does not block the rest.

## Order of work

1. Golden test: record `buildEvents` for a handful of tracks/seeds; later steps must keep them identical.
2. Registry refactor, no behaviour change; all existing tests pass.
3. Drums into the voice registry (synth default only).
4. Lead layer with the four jobs, then percussion layer.
5. New sample packs and voices; one by one.

## Left to the builder

Field names of the registry, whether the sidebar groups are static HTML or generated, where percussion patterns live, exact musical constants, UI wording in both languages, the e2e test updates.
