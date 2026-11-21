// The table of the core's compareNames and lowerCase (native/core/src/profile_tree.cpp), derived from Node's Intl.Collator and String.prototype.toLowerCase,
// i.e. from the ICU of the Node that runs this script: profile-tree.js sorts names with localeCompare(b, 'de', { numeric: true, sensitivity: 'base' }).
// Used by export-events.mjs --data (writes native/core/data/collation.json) and by export-logic.mjs (the cases of compareNames).
//
// The covered set: printable ASCII, the Latin-1 Supplement from U+00A0, Latin Extended-A, the combining marks U+0300 to U+036F, U+2010 to U+2027 and U+20AC. For each covered character the table has its
// primary weights (a list: empty for a character the collation ignores, several for an expansion such as the sharp s). Equal weights are equal at primary strength
// (case and accents tie). The weights are ranks of the classes of this set plus the few characters the expansions are made of, so only their order means anything.
export const COVERED = [[0x20, 0x7e], [0xa0, 0xff], [0x100, 0x17f], [0x300, 0x36f], [0x2010, 0x2027], [0x20ac, 0x20ac]];
// not covered, but parts of the expansions of covered characters: the fraction slash and the modifier apostrophe (U+0149), and the plain digits (the superscripts;
// U+00B9, U+00B2 and U+00B3 are covered), which the numeric collation does not read as numbers
const EXTRAS = [0x2044, 0x2bc, 0x2070, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079];
const PLAIN_DIGITS = [0x2070, 0xb9, 0xb2, 0xb3, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079];

export const cmp = (a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
const text = (cp) => String.fromCodePoint(cp);

export function buildCollation() {
  const covered = COVERED.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i));
  const ignorable = new Set(covered.filter((cp) => cmp(text(cp), '') === 0));
  const alphabet = [...new Set([...covered, ...EXTRAS])].filter((cp) => !ignorable.has(cp));
  // classes: characters that tie are one class
  const sorted = [...alphabet].sort((a, b) => cmp(text(a), text(b)) || a - b);
  const classes = [];
  for (const cp of sorted) {
    const last = classes.at(-1);
    if (last && cmp(text(last[0]), text(cp)) === 0) last.push(cp); else classes.push([cp]);
  }
  // a class of one character that ties with a string of two (or, as hinted by its compatibility decomposition, three) others is an expansion, not a class
  const reps = classes.map((members) => members[0]);
  const expansion = new Map();
  const plain = (ch) => (ch >= '0' && ch <= '9' ? text(PLAIN_DIGITS[Number(ch)]) : ch);
  for (const members of classes) {
    const [cp] = members;
    if (cp >= 0x30 && cp <= 0x39) continue;
    const target = text(cp);
    let found = null;
    for (const a of reps) for (const b of reps) if (found === null && a !== cp && b !== cp && cmp(target, text(a) + text(b)) === 0) found = [a, b];
    if (found === null) {
      const hint = [...target.normalize('NFKD')].map((ch) => plain(ch));
      if (hint.length === 3 && cmp(target, hint.join('')) === 0) found = hint.map((ch) => ch.codePointAt(0));
    }
    if (found !== null) for (const member of members) expansion.set(member, found);
  }
  const rankOf = new Map();
  let rank = 0;
  for (const members of classes) {
    if (expansion.has(members[0])) continue; // the expansions' own weights are the ranks of their parts
    rank += 1;
    members.forEach((cp) => rankOf.set(cp, rank));
  }
  const weightsOf = (cp) => (expansion.has(cp) ? expansion.get(cp).flatMap(weightsOf) : [rankOf.get(cp)]); // a part may be an expansion itself (U+2026 is a dot and U+2025)
  const chars = {};
  for (const cp of covered) chars[cp] = ignorable.has(cp) ? [] : weightsOf(cp);
  // a contraction that gives its second character no weight of its own ("L" and "l" followed directly by the middle dot U+00B7: "l·" ties with "l");
  // the numeric zeros are no such pair ("00" ties with "0" by the numbers' rule)
  const absorbed = [];
  for (const x of covered) for (const y of covered) {
    if (!ignorable.has(y) && !(x >= 0x30 && x <= 0x39 && y >= 0x30 && y <= 0x39) && cmp(text(x) + text(y), text(x)) === 0) absorbed.push([x, y]);
  }
  const lower = {};
  for (const cp of covered) { const l = text(cp).toLowerCase(); if (l !== text(cp)) lower[cp] = l; }
  return { chars, absorbed, lower, number: rankOf.get(0x30) };
}

// native/core/data/collation.json: one line per covered character
export function collationText() {
  const { chars, absorbed, lower, number } = buildCollation();
  const note = 'The order of the names of profiles (profile-tree.js sortItems: localeCompare(b, "de", { numeric: true, sensitivity: "base" })) for the characters named in native/tools/collation-data.mjs, '
    + 'and their toLowerCase. It FOLLOWS THE ICU OF THE NODE THAT GENERATED IT: Node v26.12.1, ICU 78.3, CLDR 48.0. A Node with another collation changes this file: regenerate it with '
    + '"node native/tools/export-events.mjs --data" and look at the difference (the check collation_data says so). chars: code point -> its primary weights (none: ignored by the collation; several: an expansion); '
    + 'number: the weight of a run of ASCII digits (compared by value); absorbed: [x, y] pairs where y directly after x has no weight of its own (the contraction l and the middle dot); lower: code point -> its lower case.';
  const lines = Object.entries(chars).map(([cp, w]) => `    "${cp}": ${JSON.stringify(w)}`);
  const lows = Object.entries(lower).map(([cp, l]) => `    "${cp}": ${JSON.stringify(l)}`);
  return `{\n  "note": ${JSON.stringify(note)},\n  "number": ${number},\n  "absorbed": ${JSON.stringify(absorbed)},\n  "chars": {\n${lines.join(',\n')}\n  },\n  "lower": {\n${lows.join(',\n')}\n  }\n}\n`;
}
