// Schlagworte, Stil-Presets und Auflösung zu Parametern. Reine Logik, kein Audio/DOM.
// Beschriftungen stehen nur in src/i18n.

export const TAG_CATEGORIES = [
  { id: 'drums', tags: ['driving', 'loose', 'halftime', 'dry', 'heavy'] },
  { id: 'bass', tags: ['deepFat', 'bouncy', 'calm', 'gritty'] },
  { id: 'synths', tags: ['deepSynths', 'shimmering', 'arpeggio', 'widePad', 'warm'] },
  { id: 'rhythm', tags: ['funky', 'straight', 'swing', 'syncopated'] },
  { id: 'mood', tags: ['dreamy', 'dark', 'bright', 'psychedelic'] },
  { id: 'development', tags: ['buildsSlowly', 'fullFromStart', 'withBreakouts'] },
];

export const STYLE_PRESETS = [
  {
    id: 'funk', bpm: 100,
    tags: { drums: ['driving', 'dry'], bass: ['bouncy'], synths: ['warm'], rhythm: ['funky', 'syncopated'], mood: [], development: ['buildsSlowly'] },
  },
  {
    id: 'psych', bpm: 112,
    tags: { drums: ['driving'], bass: ['deepFat'], synths: ['arpeggio', 'widePad', 'shimmering'], rhythm: ['straight'], mood: ['psychedelic'], development: ['buildsSlowly'] },
  },
  {
    id: 'dreamy', bpm: 80,
    tags: { drums: ['halftime', 'loose'], bass: ['calm'], synths: ['widePad', 'warm'], rhythm: [], mood: ['dreamy'], development: ['buildsSlowly'] },
  },
];

const DEFAULTS = {
  drive: 0.5, swing: 0, syncopation: 0.5, bassLow: 0.5, bassMovement: 0.5,
  arp: false, padWidth: 0.5, buildUp: 'normal',
};

// Wirkung je Schlagwort. Zahlen sind Verschiebungen zum Standardwert; arp/buildUp werden gesetzt.
// Mehrere Schlagworte addieren sich, das Ergebnis wird auf [0,1] begrenzt.
// Schlagworte ohne Eintrag (z. B. gritty, warm, dark) ändern noch nichts.
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

// Gegensätze: sind beide gewählt, entscheidet rng je Aufruf, welches zählt.
const OPPOSITES = [
  ['driving', 'loose'],
  ['calm', 'bouncy'],
  ['calm', 'heavy'],
  ['buildsSlowly', 'fullFromStart'],
  ['straight', 'swing'],
];

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function collectTags(tags) {
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
