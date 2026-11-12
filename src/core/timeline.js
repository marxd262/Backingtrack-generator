// Taktzeiten: eine Quelle für Ereignisstrom und chordTimeline, damit beide nie auseinanderlaufen.
import { normalizeTrack, validateTrack } from './track.js';
import { meterGrid } from './grooves.js';
import { chordIndex } from './form.js';

export const r6 = (x) => Math.round(x * 1e6) / 1e6;

/** Normalisiert und prüft einen Track; wirft einen Error mit `.errors`, wenn er ungültig ist. */
export function checkedTrack(input) {
  const track = normalizeTrack(input);
  const errors = validateTrack(track);
  if (errors.length > 0) {
    throw Object.assign(new Error(`Invalid track: ${errors.map((e) => e.code).join(', ')}`), { errors });
  }
  return track;
}

// Takte: bars läuft im Kreis über length (mit Form beginnt die Folge in jedem Teil neu, siehe chordIndex); Startzeit = Schläge davor * 60 / bpm; das Raster (Schritte je Schlag) kommt aus der Taktart
export function barTimeline(track) {
  const { sub } = meterGrid(track.meter);
  let startBeat = 0;
  return Array.from({ length: track.length }, (_, index) => {
    const { chord, beats } = track.bars[chordIndex(track, index)];
    const b = {
      index, chord, beats,
      next: track.bars[chordIndex(track, index + 1)].chord,
      sub,
      steps: beats * sub,
      stepSec: 60 / track.bpm / sub,
      start: (startBeat * 60) / track.bpm,
      end: ((startBeat + beats) * 60) / track.bpm,
    };
    startBeat += beats;
    return b;
  });
}

/** Ein Eintrag je Takt: Startzeit und Dauer in Sekunden (auf 6 Stellen gerundet wie der Ereignisstrom). Wirft wie buildEvents. */
export function chordTimeline(input) {
  const track = checkedTrack(input);
  return barTimeline(track).map((b) => ({
    time: r6(b.start), bar: b.index, chord: { ...b.chord }, durationSec: r6((b.beats * 60) / track.bpm),
  }));
}
