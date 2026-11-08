# Backingtrack Generator

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

Developer page for listening to the three styles: <http://localhost:4173/ui/render-harness.html>

## The interface

- **Start page:** the opening sentence (key and scale, style, tempo), the variant number, **Go** and **Fine-tune**. While playing, Go reads "Stop" and "To play page" leads back.
- **Play page:** in the middle, stacked: the **fretboard**, the **timeline** (with a mute button per layer) and the **chord wheel**. The left sidebar **Sound** holds style, tags, tempo and length; the right sidebar **Chords** holds key, scale, chord progression editing and views.
- **Mixer:** the button on the right of the play page header opens the **Mixer** with one slider per layer (drums, bass, chords, pad) and one for the overall volume, 0 to 100 % (100 % is the normal level; it can only get quieter, never louder), plus a **Mute** button per layer that shows the same state as the layer button above the timeline. Everything acts live without a restart. The browser remembers the slider positions (`localStorage`, key `backingtrack.mix`), but not the mutes.
- **Switching the variant:** in the play page header, ‹ and › step the variant number (after 9999 comes 1, before 1 comes 9999) and the dice picks a random one. The sound changes at once; tags, tempo, length, mixer and mutes stay. The chord progression is derived anew from key and number (a custom progression is dropped, as on the start page). While playing, it continues in the current bar instead of bar 1, also when the variant is chosen on the start page.
- **Sound tags:** four groups of their own (drum sound, bass sound, chord sound, pad sound) plus moods such as dark, bright and warm shape the sound. The notes stay the same; only "dreamy" also shifts the pad voicing, as before. The three styles use them, and picking a tag restarts playback.
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
