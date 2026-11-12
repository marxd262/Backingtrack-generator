// Profil-Dateien: ein Profil (Teile, Name) oder ein Ordner (Baum aus Profilen und Ordnern) als JSON. Reine Logik ohne DOM und Audio.
// Einlesen ist tolerant (Spec "Dateiformat"): unbekannte Felder fallen überall weg, Ungültiges fällt feldweise weg und wird gezählt (skipped),
// abgelehnt wird nur Kaputtes (kein JSON/Objekt, unbekanntes format, zu groß, nach dem Bereinigen ohne Inhalt). Die Teile prüft sanitizeParts.
import { captureParts, sanitizeParts, PART_IDS } from './profile-parts.js';

export const FORMAT_PROFILE = 'backingtrack-profile';
export const FORMAT_FOLDER = 'backingtrack-folder';
export const PROFILE_VERSION = 2;
export const FOLDER_VERSION = 1;
/**
 * Grenzen beim Einlesen. depth: der oberste Knoten der Datei hat Ebene 1 (bei einer Sicherung seine Einträge); ein Knoten auf Ebene > 8 fällt weg (ein Ordner auf Ebene 8
 * bleibt, sein Inhalt nicht). nodes: alle Knoten einschließlich des obersten. file: Zeichen des Textes.
 */
export const LIMITS = { name: 60, depth: 8, nodes: 1000, file: 5_000_000 };

const reject = () => ({ ok: false, errors: [{ code: 'badProfile', params: {} }] });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// nur eigene Felder lesen (ein JSON-Schlüssel \"__proto__\" ist ein eigenes Feld und gelangt so nie an den Prototyp)
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const cleanName = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, LIMITS.name) : 'Importiert');

// ---------- schreiben (nie Ids oder andere interne Felder) ----------

function exportNode(node) {
  if (node?.type === 'profile') return { type: 'profile', name: cleanName(node.name), parts: sanitizeParts(node.parts).parts };
  if (node?.type === 'folder') return { type: 'folder', name: cleanName(node.name), items: (Array.isArray(node.items) ? node.items : []).map(exportNode).filter(Boolean) };
  return null;
}

/** Profil-Knoten { type, name, parts } -> Datei. */
export const makeProfileFile = (node) => ({ format: FORMAT_PROFILE, version: PROFILE_VERSION, name: cleanName(node?.name), parts: sanitizeParts(node?.parts).parts });

/**
 * Ordner-Knoten { type, name, items } -> Datei. `backup: true` nur für „Alles sichern“: die Wurzel ist dann nur ein Behälter, beim Import
 * kommen ihre Einträge einzeln in den Zielordner (ältere Leser ignorieren das Feld und nehmen einen Ordner auf).
 */
export const makeFolderFile = (node) => ({
  format: FORMAT_FOLDER, version: FOLDER_VERSION, name: cleanName(node?.name), ...(node?.backup === true && { backup: true }), items: exportNode({ ...node, type: 'folder' }).items,
});

// ---------- lesen ----------

// Altdatei (Commit 561bc10: track, scale, style, chordColor, chordColorFromStyle, mix) -> alle Teile außer `form`. Brauchbar nur mit gültiger harmony:
// ohne Tonart und Takte ließe sich die Datei nicht laden (die alte Prüfung lehnte sie ebenso ab).
function legacyParts(raw, st) {
  const raw0 = own(raw, 'track');
  if (!isObject(raw0)) return null;
  const track = own(raw0, 'meter') === undefined ? { ...raw0, meter: [4, 4] } : raw0; // Altdateien ohne meter waren 4/4
  const session = { track, scale: own(raw, 'scale'), style: own(raw, 'style'), chordColor: own(raw, 'chordColor'), chordColorFromStyle: own(raw, 'chordColorFromStyle'), mix: own(raw, 'mix') };
  const { parts, skipped } = sanitizeParts(JSON.parse(JSON.stringify(captureParts(session, PART_IDS.filter((id) => id !== 'form'))))); // JSON: fehlende Felder statt undefined
  st.skipped += skipped;
  return parts.harmony ? parts : null;
}

function readNode(raw, level, st) {
  const drop = () => { st.skipped++; return null; };
  if (!isObject(raw) || level > LIMITS.depth || st.nodes >= LIMITS.nodes) return drop();
  const type = own(raw, 'type');
  if (type === 'profile') {
    const { parts, skipped } = sanitizeParts(own(raw, 'parts'));
    st.skipped += skipped;
    if (!Object.keys(parts).length) return drop();
    st.nodes++;
    return { type, name: cleanName(own(raw, 'name')), parts };
  }
  const items = own(raw, 'items');
  if (type !== 'folder' || !Array.isArray(items)) return drop();
  st.nodes++;
  const node = { type, name: cleanName(own(raw, 'name')), items: [] };
  for (const item of items) { const n = readNode(item, level + 1, st); if (n) node.items.push(n); }
  return node;
}

function read(input) {
  let raw = input;
  if (typeof input === 'string') {
    if (input.length > LIMITS.file) return reject();
    raw = JSON.parse(input);
  }
  if (!isObject(raw)) return reject();
  const st = { nodes: 0, skipped: 0 };
  const format = own(raw, 'format');
  let node = null;
  if (format === FORMAT_FOLDER) {
    const backup = own(raw, 'backup');
    if (backup !== undefined && typeof backup !== 'boolean') st.skipped++;
    // Sicherung: die Wurzel ist nur Behälter, ihre Einträge haben Ebene 1 und sie selbst zählt nicht als Knoten
    if (backup === true) st.nodes = -1;
    node = readNode({ ...raw, type: 'folder' }, backup === true ? 0 : 1, st);
    if (!node?.items.length) return reject();
    if (backup === true) node.backup = true;
  } else if (format === FORMAT_PROFILE) {
    let parts = null;
    if (own(raw, 'parts') === undefined) parts = legacyParts(raw, st);
    else { const r = sanitizeParts(own(raw, 'parts')); st.skipped += r.skipped; parts = r.parts; }
    if (!parts || !Object.keys(parts).length) return reject();
    node = { type: 'profile', name: cleanName(own(raw, 'name')), parts };
  } else return reject();
  return { ok: true, node, skipped: st.skipped };
}

/**
 * Text (JSON) oder Objekt -> { ok: true, node, skipped } oder { ok: false, errors: [{ code: 'badProfile', params: {} }] }. Wirft nie.
 * Der Knoten hat keine Ids. skipped zählt verworfene Felder, Teile und Knoten. Eine Sicherung („Alles sichern“) trägt `node.backup === true`.
 */
export function parseFile(input) {
  try { return read(input); } catch { return reject(); }
}

