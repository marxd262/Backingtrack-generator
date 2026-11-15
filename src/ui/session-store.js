// "Zuletzt gespielt": merkt die ganze Sitzung (alle Profil-Teile) samt Takt beim Stopp, damit "Weitermachen" auf der Startseite sie
// wiederherstellt und dort weiterspielt. Der Speicher wird übergeben; gelesen wird durch dasselbe Tor wie importierte Profile (sanitizeParts).
import { captureParts, sanitizeParts } from '../core/profile-parts.js';

export const SESSION_KEY = 'backingtrack.session';
const NEEDED = ['harmony', 'tempo', 'style', 'variant']; // ohne sie ließe sich weder weiterspielen noch die Zeile "Zuletzt gespielt" schreiben

/** Sitzung (readSession) und Takt (0-basiert im Durchlauf) merken; liefert den Eintrag { parts, bar, at }. Ohne Speicher gilt er bis zum Neuladen. */
export function saveLast(storage, session, bar) {
  const entry = { parts: captureParts(session), bar, at: Date.now() };
  try { storage.setItem(SESSION_KEY, JSON.stringify(entry)); } catch { /* kein Speicher */ }
  return entry;
}

/** Gemerkter Eintrag oder null (nichts gemerkt, kaputt oder unvollständig). Wirft nie. */
export function loadLast(storage) {
  try {
    const raw = JSON.parse(storage.getItem(SESSION_KEY));
    const { parts } = sanitizeParts(raw?.parts);
    if (!NEEDED.every((id) => Object.hasOwn(parts, id)) || !parts.harmony.scale || !parts.style.style) return null;
    return { parts, bar: Number.isInteger(raw.bar) && raw.bar >= 0 ? raw.bar : 0, at: Number.isFinite(raw.at) ? raw.at : null };
  } catch { return null; }
}
