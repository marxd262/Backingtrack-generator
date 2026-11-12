// Songform -> Abschnitte, Dichte und Phrasen für den Ereignisstrom (nur mit track.form; Tracks ohne Form nutzen arrange.js).
// Reine Logik: kein Zufall, keine Ereignisse.
import { LAYERS, LAYER_IDS } from './layers.js';
import { resolveSection, densityAt, FEEL_DEFAULTS } from './form-types.js';

const PHRASE_BARS = 4;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

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
 * Parameter für einen Takt des Teils: Dichte verschiebt drive voll, bassMovement und syncopation zu kleineren Anteilen,
 * syncopation zusätzlich um den Zufallsregler. Kopie, geklemmt auf 0 bis 1; ohne Verschiebung dieselben `params`.
 */
export function withSection(params, resolved, barInSection, feel) {
  const d = densityAt(resolved, barInSection);
  const r = ((feel?.randomness ?? FEEL_DEFAULTS.randomness) - FEEL_DEFAULTS.randomness) * 0.4;
  if (d === 0 && r === 0) return params;
  return {
    ...params,
    drive: clamp01(params.drive + d),
    bassMovement: clamp01(params.bassMovement + d * 0.6),
    syncopation: clamp01(params.syncopation + d * 0.4 + r),
  };
}

/** Phrasen zu 4 Takten ab Teilanfang, die letzte kürzer: `[{ start, bars }]`. */
export function phrasesOf(sec) {
  const out = [];
  for (let s = 0; s < sec.bars; s += PHRASE_BARS) out.push({ start: sec.start + s, bars: Math.min(PHRASE_BARS, sec.bars - s) });
  return out;
}
