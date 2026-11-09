// Akkord-Register: die einzige Quelle für alles, was eine Akkordart ausmacht. Neue Akkordart = ein Eintrag in CHORDS plus ihr Name
// `chord.<id>` in src/i18n/de.js und en.js; Prüfung, Muster, Rad, Griffbrett und Oberfläche lesen von hier (tests/core/chords.test.js
// prüft die Vollständigkeit). Reine Logik ohne Audio und DOM; tonartabhängiges steht in music.js (dieses Modul importiert nichts).

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
};

export const BASES = Object.freeze(['maj', 'min', 'dim']);
export const CHORD_GROUPS = Object.freeze(['triad', 'seventh', 'extended']);

// Eintrag: intervals (Halbtöne ab dem Grundton, aufsteigend, beginnt mit 0), symbol (Text hinter dem Grundton), base (Dreiklangs-
// Grundart; null bei Arten, die auf mehreren Grundarten stehen), on (Grundarten der Stufen, auf denen die Art stehen darf),
// group (Gruppe in der Auswahl), fifth (Quinte für den Bass), optional short (kürzere Schreibweise, z. B. '°') und seventh
const e = (intervals, symbol, base, on, group, fifth, extra = {}) => ({ intervals, symbol, base, on, group, fifth, ...extra });

export const CHORDS = deepFreeze({
  maj: e([0, 4, 7], '', 'maj', ['maj'], 'triad', 7),
  min: e([0, 3, 7], 'm', 'min', ['min'], 'triad', 7),
  dim: e([0, 3, 6], 'dim', 'dim', ['dim'], 'triad', 6, { short: '°' }),
  aug: e([0, 4, 8], 'aug', 'maj', ['maj'], 'triad', 8),
  sus2: e([0, 2, 7], 'sus2', null, ['maj', 'min'], 'triad', 7),
  sus4: e([0, 5, 7], 'sus4', null, ['maj', 'min'], 'triad', 7),
  power: e([0, 7], '5', null, ['maj', 'min', 'dim'], 'triad', 7),
  dom7: e([0, 4, 7, 10], '7', 'maj', ['maj'], 'seventh', 7, { seventh: 10 }),
  maj7: e([0, 4, 7, 11], 'maj7', 'maj', ['maj'], 'seventh', 7, { seventh: 11 }),
  min7: e([0, 3, 7, 10], 'm7', 'min', ['min'], 'seventh', 7, { seventh: 10 }),
  m7b5: e([0, 3, 6, 10], 'm7b5', 'dim', ['dim'], 'seventh', 6, { seventh: 10 }),
  dim7: e([0, 3, 6, 9], 'dim7', 'dim', ['dim'], 'seventh', 6, { seventh: 9 }),
  maj6: e([0, 4, 7, 9], '6', 'maj', ['maj'], 'extended', 7),
  min6: e([0, 3, 7, 9], 'm6', 'min', ['min'], 'extended', 7),
  add9: e([0, 4, 7, 14], 'add9', 'maj', ['maj'], 'extended', 7),
  dom9: e([0, 4, 7, 10, 14], '9', 'maj', ['maj'], 'extended', 7, { seventh: 10 }),
  min9: e([0, 3, 7, 10, 14], 'm9', 'min', ['min'], 'extended', 7, { seventh: 10 }),
});

/** Nur eigene Einträge: kein 'toString' oder '__proto__'. */
export const isChordQuality = (quality) => typeof quality === 'string' && Object.hasOwn(CHORDS, quality);

/** Name mit Symbol hinter dem Grundton, z. B. Am7. Für Namen im Text, in Fehlern und Beschriftungen. */
export const chordName = (chord) => chord.root + CHORDS[chord.quality].symbol;

/** Kürzere Schreibweise für enge Stellen (Rad: B° statt Bdim), sonst wie chordName. */
export const chordShort = (chord) => {
  const spec = CHORDS[chord.quality];
  return chord.root + (spec.short ?? spec.symbol);
};

/** Arten, deren `on` die Grundart enthält, in Registerreihenfolge. */
export const qualitiesFor = (base) => Object.keys(CHORDS).filter((id) => CHORDS[id].on.includes(base));
