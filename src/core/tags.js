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
    tags: { drums: ['driving', 'dry'], bass: ['bouncy'], synths: ['warm'], rhythm: ['funky', 'syncopated'], mood: [], development: ['buildsSlowly'],
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
