// Songform -> Abschnitte, Dichte und Phrasen für den Ereignisstrom (nur mit track.form; Tracks ohne Form nutzen arrange.js).
// Reine Logik: kein Zufall, keine Ereignisse.
import { LAYERS, LAYER_IDS } from './layers.js';
import { resolveSection, densityAt, FEEL_DEFAULTS, DRIVE_WINDOW, BASS_WINDOW } from './form-types.js';

const PHRASE_BARS = 4;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Abschnitte aus den Teilen der (gültigen) Form: `{ start, bars, layers, fillAtEnd, kind, index, resolved }`.
 * Lead und Percussion folgen wie bisher Akkorden und Schlagzeug; `fillAtEnd`, wenn der NÄCHSTE Teil `transition === 'fill'` hat.
 */
export function buildFormArrangement(track) {
  const { sections: parts, feel } = track.form;
  let start = 0;
  const resolved = parts.map((p) => resolveSection(p, feel));
  const sections = parts.map((p, index) => {
    const r = resolved[index];
    const sec = {
      start,
      bars: p.bars,
      layers: Object.fromEntries(LAYER_IDS.map((id) => [id, r.layers.includes(LAYERS[id].follows ?? id)])),
      fillAtEnd: resolved[index + 1]?.transition === 'fill',
      kind: p.type,
      index,
      resolved: r,
    };
    start += p.bars;
    return sec;
  });
  return { sections };
}

/**
 * Parameter für einen Takt des Teils: drive und bassMovement werden erst in ihr Fenster (form-types.js) gelegt, damit die Dichte
 * auch bei extremen Stilwerten wirkt, dann um die Dichte verschoben (drive voll, bassMovement zu 0,6); syncopation um 0,4 der Dichte
 * und um den Zufallsregler. Immer eine Kopie, alles auf 0 bis 1 geklemmt.
 */
export function withSection(params, resolved, barInSection, feel) {
  const d = densityAt(resolved, barInSection);
  const r = ((feel?.randomness ?? FEEL_DEFAULTS.randomness) - FEEL_DEFAULTS.randomness) * 0.4;
  return {
    ...params,
    drive: clamp(clamp(params.drive, ...DRIVE_WINDOW) + d, 0, 1),
    bassMovement: clamp(clamp(params.bassMovement, ...BASS_WINDOW) + d * 0.6, 0, 1),
    syncopation: clamp(params.syncopation + d * 0.4 + r, 0, 1),
  };
}

/** Phrasen zu 4 Takten ab Teilanfang, die letzte kürzer: `[{ start, bars }]`. */
export function phrasesOf(sec) {
  const out = [];
  for (let s = 0; s < sec.bars; s += PHRASE_BARS) out.push({ start: sec.start + s, bars: Math.min(PHRASE_BARS, sec.bars - s) });
  return out;
}
