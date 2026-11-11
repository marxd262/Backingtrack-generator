# Backingtrack Generator

**Live version:** <https://marxd262.github.io/Backingtrack-generator/>

Generates backing tracks for practice in the browser (drums, bass, chords, pad, plus an optional lead and percussion) from a key, a style, a tempo and tags.
Plain JavaScript (ES modules), no build step, no runtime dependencies. The sound is synthesised with the Web Audio API, so everything runs offline.
The variant number on the start page is editable (1 to 9999): the same number in the same key always gives the same chord progression.

The interface is available in German and English (switch in the top right corner).

## Getting started

```sh
npm install
npm start
```

Then open <http://localhost:4173/ui/index.html> in your browser (the server only listens on localhost).

Developer page for listening to all styles (funk-rock, psychedelic indie, dreamy, blues shuffle, classic rock, hard rock, reggae, country, pop-punk): <http://localhost:4173/ui/render-harness.html>

## The interface

- **Start page:** the opening sentence (key and scale, style, tempo), the variant number, **Go** and **Fine-tune**. While playing, Go reads "Stop" and "To play page" leads back.
- **Play page:** in the middle, stacked: the **fretboard**, the **timeline** (with a mute button per layer) and the **chord wheel**. Both sidebars are split into collapsible groups (the browser remembers which are open). On wide windows (1200 px and up) the sidebars and the middle column each scroll on their own and the header stays in place; on narrow windows the sidebars are drawers. The left sidebar **Sound** holds style and tags, tempo and length, and the sound sliders; the right sidebar **Chords** holds key and scale, the chord progression and the views.
- **Mixer:** the button on the right of the play page header opens the **Mixer** with one slider per layer (drums, bass, chords, pad, lead, percussion) and one for the overall volume, 0 to 100 % (100 % is the normal level; it can only get quieter, never louder), plus a **Mute** button per layer that shows the same state as the layer button above the timeline. Everything acts live without a restart. The browser remembers the slider positions (`localStorage`, key `backingtrack.mix`), but not the mutes.
- **Switching the variant:** in the play page header, ‹ and › step the variant number (after 9999 comes 1, before 1 comes 9999) and the dice picks a random one. The pattern, the playing style (a little swing, syncopation and bass movement within what the tags allow) and the tone colour change with it, as do the slider values that are not set by hand; tags, tempo, length, mixer and mutes stay. The chord progression is derived anew from key and number (a custom progression is dropped, as on the start page). While playing, it continues in the current bar instead of bar 1, also when the variant is chosen on the start page.
- **Sound tags:** four groups of their own (drum sound, bass sound, chord sound, pad sound; the lead and the percussion have none) plus moods such as dark, bright and warm shape the sound. The notes stay the same; only "dreamy" also shifts the pad voicing, as before. The styles use them. Picking a tag or a style while playing takes effect live, without a restart.
- **Chords:** 17 chord types (triads incl. sus2, sus4, augmented and power chords; sevenths; sixths, add9 and ninths). The **Add chord** area works in two steps: pick a root of the key, then a chord type (only the types that fit that step are enabled). **Chord colour** rewrites the whole progression as triads, sevenths, extended chords or power chords and also applies to every newly generated progression (key, scale or variant change). Styles bring a chord colour of their own (blues: sevenths, hard rock and pop-punk: power chords; with variants, about one in four uses a fallback colour: extended chords, or plain triads); a colour you pick yourself is kept until you pick a style again. A new chord type is one entry in `src/core/chords.js` plus its names in the two language files, see `docs/interface.md`.
- **Rhythm:** the **Rhythm** group in the left sidebar picks a time signature (4/4, 3/4, 6/8, 12/8 or 5/4), one of the grooves of that time signature (for example waltz, 6/8 ballad, 12/8 shuffle, five-four) and a **complexity** slider (more ghost notes, denser hi-hat, more syncopated kicks and bass movement). Groove and complexity act live; changing the time signature restarts playback, converts the tempo so the eighth-note speed stays the same (4/4 at 100 becomes 6/8 at 67) and gives every bar the beats of the new time signature. In the track format `bpm` counts the beats of the time signature (dotted quarters in 6/8 and 12/8). A new groove is one entry in `src/core/grooves.js` plus its name, see `docs/interface.md`.
- **Layers:** six layers, each with its own mixer slider, mute button, timeline lane and voice choice: drums, bass, chords, pad, **lead** and **percussion**. The list lives in one place (`src/core/layers.js`); the audio, the mixer, the lanes and the track format derive from it. A new track has drums, bass, chords, pad and lead on and percussion off (its mute chip and mixer row are there, the layer just has to be switched on). The lead plays where the chords play, the percussion where the drums play.
- **Lead job:** the lead layer is on but silent until the **Lead job** dropdown in its sound group picks what it plays: Off (default), Fills (a short phrase at the end of a bar, in the second half of a section), Arpeggio (a run through the chord tones), Melody (long, sparse notes) or Call and response (a phrase in one bar, the answer in the next). One note at a time, always in the key. Changing the job works live.
- **Percussion part:** the **Percussion part** dropdown in the percussion group picks the instrument: Mixed (default: shaker, tambourine and congas together), Shaker, Tambourine, Congas, Bongos, Claves or Cowbell. The patterns follow the groove and its time signature, the density follows the same parameters as the drums. Changing the part works live.
- **Voice choice in the UI:** each of the six sound groups (drums, bass, chords, pad, lead, percussion) has a Voice dropdown (grouped into synthesis and samples; the string models are hidden from the list for now), a Variant dropdown where a voice has several, and a loading state for sample voices; sliders a voice does not use are dimmed. Choosing a voice works live and survives a style change.
- **Sample voices:** every layer can also play recorded samples taken from the MIT-licensed MuseScore_General soundfont (credits and licence text: `src/assets/samples/LICENSE-MuseScore_General.md`). Drums: standard, brushes, rimshot, jazz, electronic and 808 kits. Bass: finger, pick, upright. Chords: guitar, electric piano, organ, muted guitar, jazz guitar, funk guitar, steel-string, nylon and 12-string guitar. Pad: strings, warm. Lead: flute, sax, synth. Percussion: studio (shaker, tambourine, cowbell, bongos, congas, claves). The 23 sample packs (about 27.8 MB in total, from under 0.1 to 2.8 MB each) load only when such a voice is chosen; until they are ready the classic synth keeps playing.
- **Rebuilding the sample packs:** the soundfont is not in the repository (39.9 MB, [MuseScore_General.sf3](https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3)). With it downloaded and `ffmpeg` installed, `node scripts/extract-samples.mjs <MuseScore_General.sf3> [output folder]` cuts the packs (`src/assets/samples/<layer>-<variant>.json` and `.pcm`) out of it; which presets go into which pack is the `PACKS` table in the script. The rimshot kit is no pack of its own: it remaps keys of the standard kit.
- **Profiles:** the "Profiles" button next to the mixer opens a window with a tree: "Current session", the read-only folder "Factory profiles" (the 9 styles) and "My profiles" with your own nested folders (up to 8 levels) and profiles, stored in the browser. A profile holds only the parts you tick when saving, out of 9: key, chords and meter; tempo; groove, complexity and length; style and tags; sound sliders; voices and jobs; layer switches; mixer levels; variant. Loading changes only what the profile contains and leaves the rest of the session alone (a tempo saved in 4/4 is converted when loaded into 6/8 or 12/8, like switching the meter); if the result would be invalid, nothing changes. "Overwrite with session" replaces only the parts you tick. Names are unique within a folder (case-insensitive). Loading a factory profile does what picking that style used to do (style, tags, tempo, chord colour, sound sliders reset); the old quick-pick chips are gone, the start page keeps its style cards. Rename, delete, create sub-folders, and move entries with "Move to ..." or by dragging the grip (mouse at once, touch and pen after a long press, so scrolling still works). Export and import follow the selection: the session, a profile or a whole folder as a `.json` file or as text, plus "Back up everything" for all of "My profiles" (importing a backup adds its entries to the chosen folder one by one, all 8 levels intact). Reading is tolerant: unknown fields are ignored, invalid ones are skipped and counted, only broken input is refused; old profile files (version 1) and the old flat list in the browser still import. Delete, move, overwrite and import offer one level of "Undo" (stored profiles only, never the session). Handy for sharing exactly what you hear when something sounds off. Format and rules: `docs/interface.md`.
- **Selectable voices (phase A):** every layer can use different sound generators: the classic synth (default, unchanged), plucked-string models (electric bass, clean electric guitar), an FM electric piano and the sample voices above. Voices are chosen per layer in the track (`voices`) and can be switched live; `render-harness.html` lets you audition them and tune their inner values, `spectrogram.html` shows what they sound like as a spectrogram.
- **Sound sliders:** every sound parameter of every instrument (37 in total, in groups for drums, bass, chords, pad, lead and master, for example fuzz, sub, drum room, reverb and echo) has a slider. Bass, chords, pad and lead each have three guitar-style effects in series on the whole layer (overdrive after a Tube Screamer, distortion after a RAT, fuzz after a Fuzz Face plus Big Muff stage, then a speaker cabinet); the drums and the percussion have none. The percussion shares the drums' room (reverb send) knob. Tags set the starting values; a moved slider overrides only its own parameter and wins over the tags. Each group has a Reset button, and picking a style clears the overrides. Sliders act live without a restart.
- Both sidebars can be collapsed and expanded; the browser remembers the state (`localStorage`). On narrow windows an open sidebar lies over the middle as a drawer (Escape closes it).
- **Fretboard:** shows all notes of the scale, highlights the current chord and marks the next one. The **Names/Degrees** switch changes the labels (degrees count from the root of the key).
- Under **Views** (right sidebar) the fretboard and the chord wheel can be hidden; the timeline always stays visible.

## Tests

```sh
npm test          # logic tests (node:test)
npm run test:e2e  # browser tests (Playwright, Chromium; once: npx playwright install chromium)
npx playwright test tests/e2e/play.spec.js --no-deps  # a single file
```

The real-time tests (project `realtime`) only run after the compute-heavy offline renders (`offline`: `levels.spec.js`, `sound.spec.js`, `mix.spec.js`), so their timers do not drift under load. Without `--no-deps`, running a single real-time file also runs the `offline` project first.

## Documentation

The documents below are written in German.

- Interface for Interactive Scales: [docs/interface.md](docs/interface.md)
- Design: [docs/superpowers/specs/2026-11-07-backingtrack-generator-design.md](docs/superpowers/specs/2026-11-07-backingtrack-generator-design.md)
- Implementation plan: [docs/superpowers/plans/2026-11-07-backingtrack-generator.md](docs/superpowers/plans/2026-11-07-backingtrack-generator.md)

## License

[MIT](LICENSE)
