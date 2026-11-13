// Merkt sich den Zustand der Spielseite (Fokus/Einstellen), die Beschriftung des Griffbretts und die Bundabstände; der Speicher
// wird übergeben (keine Browser-Globals). Unbekannte und alte Felder (Leisten, Ansichten, Gruppen) werden verworfen.
export const LAYOUT_KEY = 'backingtrack.layout';

export const DEFAULT_LAYOUT = Object.freeze({ mode: 'focus', labels: 'names', frets: 'real' });

// je Feld die erlaubten Werte; der erste ist der Standard
const CHOICES = { mode: ['focus', 'setup'], labels: ['names', 'degrees'], frets: ['real', 'even'] };

const sanitize = (raw) => {
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(Object.entries(CHOICES).map(([key, values]) => [key, values.includes(src[key]) ? src[key] : values[0]]));
};

export function loadLayout(storage) {
  try {
    const raw = storage.getItem(LAYOUT_KEY);
    return sanitize(typeof raw === 'string' ? JSON.parse(raw) : null);
  } catch { /* kein Speicher oder kaputtes JSON: Standardwerte */ }
  return sanitize(null);
}

export function saveLayout(storage, layout) {
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(sanitize(layout)));
  } catch { /* ohne Speicher gilt das Layout nur bis zum Neuladen */ }
}
