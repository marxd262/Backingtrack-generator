# Backingtrack Generator

**Live version:** <https://marxd262.github.io/Backingtrack-generator/>

Generates backing tracks for practice in the browser (drums, bass, chords, pad) from a key, a style, a tempo and tags.
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
- **Mixer:** the button on the right of the play page header opens the **Mixer** with one slider per layer (drums, bass, chords, pad) and one for the overall volume, 0 to 100 % (100 % is the normal level; it can only get quieter, never louder), plus a **Mute** button per layer that shows the same state as the layer button above the timeline. Everything acts live without a restart. The browser remembers the slider positions (`localStorage`, key `backingtrack.mix`), but not the mutes.
- **Switching the variant:** in the play page header, ‹ and › step the variant number (after 9999 comes 1, before 1 comes 9999) and the dice picks a random one. The pattern, the playing style (a little swing, syncopation and bass movement within what the tags allow) and the tone colour change with it, as do the slider values that are not set by hand; tags, tempo, length, mixer and mutes stay. The chord progression is derived anew from key and number (a custom progression is dropped, as on the start page). While playing, it continues in the current bar instead of bar 1, also when the variant is chosen on the start page.
- **Sound tags:** four groups of their own (drum sound, bass sound, chord sound, pad sound) plus moods such as dark, bright and warm shape the sound. The notes stay the same; only "dreamy" also shifts the pad voicing, as before. The styles use them. Picking a tag or a style while playing takes effect live, without a restart.
- **Chords:** 17 chord types (triads incl. sus2, sus4, augmented and power chords; sevenths; sixths, add9 and ninths). The **Add chord** area works in two steps: pick a root of the key, then a chord type (only the types that fit that step are enabled). **Chord colour** rewrites the whole progression as triads, sevenths, extended chords or power chords and also applies to every newly generated progression (key, scale or variant change). Styles bring a chord colour of their own (blues: sevenths, hard rock and pop-punk: power chords; with variants, about one in four uses a fallback colour: extended chords, or plain triads); a colour you pick yourself is kept until you pick a style again. A new chord type is one entry in `src/core/chords.js` plus its names in the two language files, see `docs/interface.md`.
- **Rhythm:** the **Rhythm** group in the left sidebar picks a time signature (4/4, 3/4, 6/8, 12/8 or 5/4), one of the grooves of that time signature (for example waltz, 6/8 ballad, 12/8 shuffle, five-four) and a **complexity** slider (more ghost notes, denser hi-hat, more syncopated kicks and bass movement). Groove and complexity act live; changing the time signature restarts playback, converts the tempo so the eighth-note speed stays the same (4/4 at 100 becomes 6/8 at 67) and gives every bar the beats of the new time signature. In the track format `bpm` counts the beats of the time signature (dotted quarters in 6/8 and 12/8). A new groove is one entry in `src/core/grooves.js` plus its name, see `docs/interface.md`.
- **Sound sliders:** every sound parameter of every instrument (26 in total, in groups for drums, bass, chords, pad and master, for example fuzz, sub, drum room, reverb and echo) has a slider. Tags set the starting values; a moved slider overrides only its own parameter and wins over the tags. Each group has a Reset button, and picking a style clears the overrides. Sliders act live without a restart.
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
