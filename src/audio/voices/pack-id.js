// Pack-ID der Sample-Stimme (eigene Datei, damit die Oberfläche sie lesen kann, ohne alle Stimmen zu laden).
/**
 * Pack der Sample-Stimme (src/assets/samples): `${schicht}-${variante}`; das Kit Rimshot ist das Standard-Kit mit Seitenschlag als Snare,
 * die Lead-Gitarre spielt die Samples der E-Gitarre clean (Freepats) aus der Akkord-Schicht.
 */
const SHARED = { 'drums-rimshot': 'drums-standard', 'lead-guitar': 'chords-freepats' };
export const packIdFor = (layer, variant) => SHARED[`${layer}-${variant}`] ?? `${layer}-${variant}`;
