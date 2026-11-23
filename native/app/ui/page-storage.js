// Was die Seiten der App im Speicher der WebView halten, für beide Seiten an einer Stelle: die Sprache (backingtrack.lang, die Wahl gilt für
// jede Seite) und den Speicher, in dem layout-state.js das Layout merkt.
import { detectLanguage } from './i18n/index.js';

const LANG_KEY = 'backingtrack.lang';

// Schon der Zugriff auf localStorage kann werfen (gesperrter Speicher); null speichert nichts
export const layoutStorage = (() => { try { return localStorage; } catch { return null; } })();

// die gemerkte Sprache, sonst die des Browsers
export function readLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch { /* Speicher gesperrt: Browsersprache */ }
  return detectLanguage(navigator.language);
}

export function saveLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* ohne Speicher gilt die Wahl nur bis zum Neuladen */ }
}
