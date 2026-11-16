// Pack-ID der Sample-Stimme (eigene Datei, damit die Oberfläche sie lesen kann, ohne alle Stimmen zu laden).
// Standard- und Rimshot-Kit spielen seit 2026-11-16 Naked Drums (Format 2; das Rimshot-Kit nimmt den Side-Stick als Snare, hitKeysFor, sample-hits.js);
// das alte MuseScore-Standard-Kit (Pack drums-standard) ist als Legacy Drums weiter wählbar
const SHARED = { 'drums-standard': 'drums-naked', 'drums-rimshot': 'drums-naked', 'drums-legacy': 'drums-standard', 'lead-guitar': 'chords-freepats' };
let overrides = {};

/**
 * Pack der Sample-Stimme (src/assets/samples): `${schicht}-${variante}`; das Kit Rimshot ist das Standard-Kit mit Seitenschlag als Snare,
 * die Lead-Gitarre spielt die Samples der E-Gitarre clean (Freepats) aus der Akkord-Schicht.
 */
export const packIdFor = (layer, variant) => {
  const id = SHARED[`${layer}-${variant}`] ?? `${layer}-${variant}`;
  return overrides[id] ?? id;
};

/** Nur für Hörproben (scripts/render-full.mjs --pack): Packs umlenken, z. B. { 'drums-standard': 'drums-muldjord' }; wirkt auf danach gebaute Stimmen. */
export const setPackOverrides = (map) => { overrides = { ...map }; };
