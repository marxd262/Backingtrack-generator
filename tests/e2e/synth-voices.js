// Alle Schichten auf synth/classic: seit 2026-11-15 sind Samples der Standard. Tests, die den Synth messen (Klangregler, Pegel-Basiswerte,
// "vorher gleich Synth"), nennen ihn ausdrücklich.
export const SYNTH = Object.freeze(Object.fromEntries(['drums', 'bass', 'chords', 'pad', 'lead', 'percussion'].map((l) => [l, { id: 'synth', variant: 'classic' }])));
