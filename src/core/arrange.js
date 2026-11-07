// Arrangement: Abschnitte à 8 Takte, welche Schichten wann spielen, Fills.
import { MAX_LENGTH } from './track.js';

const SECTION_BARS = 8;
const DEFAULT_LENGTH = 24;
const OTHER_LAYERS = ['drums', 'chords', 'pad'];

// Fisher-Yates mit dem seedbaren rng (Eingabe wird nicht verändert)
function shuffled(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Schichten, die ein Abschnitt (nicht der letzte) spielt
function layersBefore(buildUp, index, slowOrder) {
  if (buildUp === 'instant') return ['bass', 'drums', 'chords', 'pad'];
  if (buildUp === 'slow') return slowOrder.slice(0, index + 2);
  return ['bass', 'drums', 'chords'];
}

export function buildArrangement(track, params, rng) {
  const length = Number.isInteger(track?.length) && track.length > 0 && track.length <= MAX_LENGTH ? track.length : DEFAULT_LENGTH;
  const buildUp = params?.buildUp;
  const count = Math.ceil(length / SECTION_BARS);
  const slowOrder = buildUp === 'slow' ? ['bass', ...shuffled(OTHER_LAYERS, rng)] : null;

  const sections = Array.from({ length: count }, (_, i) => {
    const start = i * SECTION_BARS;
    const isLast = i === count - 1;
    const on = isLast ? ['bass', 'drums', 'chords', 'pad'] : layersBefore(buildUp, i, slowOrder);
    return {
      start,
      bars: Math.min(SECTION_BARS, length - start),
      layers: {
        drums: on.includes('drums'),
        bass: on.includes('bass'),
        chords: on.includes('chords'),
        pad: on.includes('pad'),
      },
      fillAtEnd: !isLast,
    };
  });
  return { sections };
}
