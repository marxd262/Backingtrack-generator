// Sprachen: Deutsch und Englisch. Reine Logik ohne Browser-Globals (Speichern der Wahl macht die Oberfläche).
// Akkordsymbole werden nicht übersetzt: internationale Schreibweise, `B` bleibt `B` (kein deutsches `H`).
import de from './de.js';
import en from './en.js';

const DICTS = { de, en };
let current = 'de';

export function setLanguage(lang) {
  if (typeof lang !== 'string' || !Object.hasOwn(DICTS, lang)) throw new RangeError(`Unbekannte Sprache: ${String(lang)}`);
  current = lang;
}

export const getLanguage = () => current;

// 'de', 'de-AT', 'DE' -> 'de'; alles andere (auch Nicht-Strings) -> 'en'
export const detectLanguage = (navLang) => (typeof navLang === 'string' && /^de(-|$)/i.test(navLang) ? 'de' : 'en');

// Unbekannter Schlüssel liefert den Schlüssel; fehlender Parameter lässt den Platzhalter stehen.
export function t(key, params) {
  const text = DICTS[current][key];
  if (typeof text !== 'string') return key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (params != null && Object.hasOwn(params, name) ? String(params[name]) : m));
}
