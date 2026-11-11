// Pack-ID der Sample-Stimme (eigene Datei, damit die Oberfläche sie lesen kann, ohne alle Stimmen zu laden).
/** Pack der Sample-Stimme (src/assets/samples): `${schicht}-${variante}`; das Kit Rimshot ist das Standard-Kit mit Seitenschlag als Snare. */
export const packIdFor = (layer, variant) => (layer === 'drums' && variant === 'rimshot' ? 'drums-standard' : `${layer}-${variant}`);
