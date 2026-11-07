// Merkt sich Seitenleisten, Ansichten und Beschriftung; der Speicher wird übergeben (keine Browser-Globals).
export const LAYOUT_KEY = 'backingtrack.layout';

export const DEFAULT_LAYOUT = Object.freeze({
  sidebars: Object.freeze({ left: false, right: false }),
  views: Object.freeze({ fretboard: true, wheel: true }),
  labels: 'names',
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Nur bekannte Schlüssel mit gültigem Wert; alles andere fällt auf den Standard zurück
const pickBooleans = (raw, defaults) => {
  const src = isObject(raw) ? raw : {};
  const out = {};
  for (const key of Object.keys(defaults)) {
    out[key] = typeof src[key] === 'boolean' ? src[key] : defaults[key];
  }
  return out;
};

const sanitize = (raw) => {
  const src = isObject(raw) ? raw : {};
  return {
    sidebars: pickBooleans(src.sidebars, DEFAULT_LAYOUT.sidebars),
    views: pickBooleans(src.views, DEFAULT_LAYOUT.views),
    labels: src.labels === 'names' || src.labels === 'degrees' ? src.labels : DEFAULT_LAYOUT.labels,
  };
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
