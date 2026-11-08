// Schlagworte, Stil-Presets und Auflösung zu Parametern. Reine Logik, kein Audio/DOM.
// Beschriftungen stehen nur in src/i18n.
import { TIMBRE_EFFECTS } from './timbre-effects.js';

export const TAG_CATEGORIES = [
  { id: 'drums', tags: ['driving', 'loose', 'halftime', 'dry', 'heavy'] },
  { id: 'bass', tags: ['deepFat', 'bouncy', 'calm', 'gritty'] },
  { id: 'synths', tags: ['deepSynths', 'shimmering', 'arpeggio', 'widePad', 'warm'] },
  { id: 'rhythm', tags: ['funky', 'straight', 'swing', 'syncopated'] },
  { id: 'mood', tags: ['dreamy', 'dark', 'bright', 'psychedelic'] },
  { id: 'development', tags: ['buildsSlowly', 'fullFromStart', 'withBreakouts'] },
  { id: 'drumSound', tags: ['punchy', 'boomy', 'snappy', 'crisp', 'roomy'] },
  { id: 'bassSound', tags: ['sub', 'fuzz', 'plucky', 'round', 'resonant'] },
  { id: 'chordSound', tags: ['mellow', 'biting', 'chorused', 'tremolo', 'ringing'] },
  { id: 'padSound', tags: ['swelling', 'airy', 'glassy', 'thick', 'moving'] },
];

export const STYLE_PRESETS = [
  {
    id: 'funk', bpm: 100,
    tags: { drums: ['driving', 'dry'], bass: ['bouncy'], synths: [], rhythm: ['funky', 'syncopated'], mood: [], development: ['buildsSlowly'],
      drumSound: ['punchy', 'snappy'], bassSound: ['plucky'], chordSound: ['biting'], padSound: [] },
  },
  {
    id: 'psych', bpm: 112,
    tags: { drums: ['driving'], bass: ['deepFat'], synths: ['arpeggio', 'widePad', 'shimmering'], rhythm: ['straight'], mood: ['psychedelic'], development: ['buildsSlowly'],
      drumSound: [], bassSound: ['fuzz'], chordSound: ['chorused'], padSound: ['swelling', 'glassy'] },
  },
  {
    id: 'dreamy', bpm: 80,
    tags: { drums: ['halftime', 'loose'], bass: ['calm'], synths: ['widePad', 'warm'], rhythm: [], mood: ['dreamy'], development: ['buildsSlowly'],
      drumSound: ['roomy'], bassSound: ['round'], chordSound: ['mellow'], padSound: ['airy', 'swelling'] },
  },
  // Gitarren-Stile (siehe docs/superpowers/specs/2026-11-09-guitar-styles-design.md); nur aus vorhandenen Schlagworten gebaut
  {
    id: 'blues', bpm: 88,
    tags: { drums: ['loose'], bass: ['bouncy'], synths: ['warm'], rhythm: ['swing'], mood: [], development: ['fullFromStart'],
      drumSound: ['roomy'], bassSound: ['round'], chordSound: ['mellow'], padSound: [] },
  },
  {
    id: 'rock', bpm: 124,
    tags: { drums: ['driving', 'heavy'], bass: ['gritty'], synths: [], rhythm: ['straight'], mood: ['bright'], development: ['fullFromStart'],
      drumSound: ['punchy', 'snappy'], bassSound: ['resonant'], chordSound: ['biting'], padSound: ['thick'] },
  },
  {
    id: 'hardrock', bpm: 148,
    tags: { drums: ['driving', 'heavy'], bass: ['deepFat', 'gritty'], synths: ['deepSynths'], rhythm: ['straight'], mood: ['dark'], development: ['fullFromStart'],
      drumSound: ['boomy'], bassSound: ['fuzz'], chordSound: ['biting', 'ringing'], padSound: [] },
  },
  {
    id: 'reggae', bpm: 76,
    tags: { drums: ['halftime', 'loose'], bass: ['calm', 'deepFat'], synths: ['warm'], rhythm: ['syncopated'], mood: [], development: ['fullFromStart'],
      drumSound: ['roomy'], bassSound: ['sub', 'round'], chordSound: ['biting'], padSound: [] },
  },
  {
    id: 'country', bpm: 112,
    tags: { drums: ['dry'], bass: ['bouncy'], synths: [], rhythm: ['straight'], mood: ['bright'], development: ['fullFromStart'],
      drumSound: ['crisp'], bassSound: ['plucky'], chordSound: ['ringing'], padSound: ['airy'] },
  },
  {
    id: 'poppunk', bpm: 172,
    tags: { drums: ['driving', 'heavy'], bass: ['bouncy'], synths: [], rhythm: ['straight'], mood: ['bright'], development: ['fullFromStart'],
      drumSound: ['crisp', 'snappy'], bassSound: ['plucky'], chordSound: ['biting'], padSound: ['thick'] },
  },
];

const DEFAULTS = {
  drive: 0.5, swing: 0, syncopation: 0.5, bassLow: 0.5, bassMovement: 0.5,
  arp: false, padWidth: 0.5, buildUp: 'normal',
};

// Wirkung je Schlagwort. Zahlen sind Verschiebungen zum Standardwert; arp/buildUp werden gesetzt.
// Mehrere Schlagworte addieren sich, das Ergebnis wird auf [0,1] begrenzt.
// Klangwirkung steht in timbre-effects.js; Schlagworte ohne Eintrag dort wie hier sind inert, siehe INERT_TAGS.
const EFFECTS = {
  driving: { drive: 0.3 },
  loose: { drive: -0.3 },
  halftime: { drive: -0.15 },
  dry: { drive: 0.1 },
  heavy: { drive: 0.2 },
  deepFat: { bassLow: 0.3 },
  deepSynths: { bassLow: 0.15 },
  bouncy: { bassMovement: 0.3 },
  calm: { bassMovement: -0.3 },
  arpeggio: { arp: true },
  widePad: { padWidth: 0.3 },
  shimmering: { padWidth: 0.2 },
  dreamy: { padWidth: 0.2 },
  swing: { swing: 0.5 },
  funky: { swing: 0.25, syncopation: 0.25 },
  syncopated: { syncopation: 0.3 },
  straight: { swing: -1, syncopation: -0.3 },
  buildsSlowly: { buildUp: 'slow' },
  fullFromStart: { buildUp: 'instant' },
};

/** Schlagwort-IDs ohne Eintrag in Muster- und Klangtabelle: wählbar, ändern aber nichts. */
export const INERT_TAGS = Object.freeze(TAG_CATEGORIES.flatMap((c) => c.tags)
  .filter((tag) => !Object.hasOwn(EFFECTS, tag) && !Object.hasOwn(TIMBRE_EFFECTS, tag)));

/**
 * true, wenn sich die Auswahl geändert hat und jedes geänderte Schlagwort reiner Klang ist (Eintrag in TIMBRE_EFFECTS, keiner in
 * EFFECTS): der Ereignisstrom bleibt gleich. Ungültige Eingaben werfen nicht, sie ergeben false.
 */
export function isSoundOnlyChange(prevTags, nextTags) {
  const selected = (tags) => {
    if (typeof tags !== 'object' || tags === null) return null;
    const out = new Set();
    for (const list of Object.values(tags)) {
      if (!Array.isArray(list)) return null;
      for (const tag of list) out.add(tag);
    }
    return out;
  };
  try {
    const a = selected(prevTags), b = selected(nextTags);
    if (!a || !b) return false;
    const changed = [...a].filter((tag) => !b.has(tag)).concat([...b].filter((tag) => !a.has(tag)));
    return changed.length > 0 && changed.every((tag) => Object.hasOwn(TIMBRE_EFFECTS, tag) && !Object.hasOwn(EFFECTS, tag));
  } catch {
    return false; // z. B. werfende Getter
  }
}

// Gegensätze: sind beide gewählt, entscheidet rng je Aufruf, welches zählt.
const OPPOSITES = [
  ['driving', 'loose'],
  ['calm', 'bouncy'],
  ['calm', 'heavy'],
  ['buildsSlowly', 'fullFromStart'],
  ['straight', 'swing'],
];

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function collectTags(tags) {
  const selected = new Set();
  for (const [cat, list] of Object.entries(tags ?? {})) {
    const category = TAG_CATEGORIES.find((c) => c.id === cat);
    if (!category) throw new Error(`Unknown tag category: ${cat}`);
    for (const tag of list) {
      if (!category.tags.includes(tag)) throw new Error(`Unknown tag: ${tag} (category ${cat})`);
      selected.add(tag);
    }
  }
  return selected;
}

/**
 * Mit dem Track-Schalter `variety`: der Seed streut Synkopen und Bass-Bewegung um höchstens ±0,12 und skaliert den Swing
 * (Faktor 0,75 bis 1,25, ein gerader Stil bleibt gerade). drive, bassLow, padWidth, arp und buildUp tragen den Stil und bleiben.
 * Neue Kopie, rng sollte ein eigener Zweig sein (master.fork('drift')), damit sich die Schichten nicht verschieben.
 */
export function driftParams(params, rng) {
  const spread = () => (rng.next() * 2 - 1) * 0.12;
  return {
    ...params,
    swing: clamp01(params.swing * (0.75 + 0.5 * rng.next())),
    syncopation: clamp01(params.syncopation + spread()),
    bassMovement: clamp01(params.bassMovement + spread()),
  };
}

export function resolveTags(tags, rng) {
  const selected = collectTags(tags);
  for (const [a, b] of OPPOSITES) {
    if (selected.has(a) && selected.has(b)) selected.delete(rng.next() < 0.5 ? a : b);
  }
  const params = { ...DEFAULTS };
  for (const tag of selected) {
    for (const [key, value] of Object.entries(EFFECTS[tag] ?? {})) {
      params[key] = typeof value === 'number' ? params[key] + value : value;
    }
  }
  for (const key of ['drive', 'swing', 'syncopation', 'bassLow', 'bassMovement', 'padWidth']) {
    params[key] = clamp01(params[key]);
  }
  return params;
}
