// Eigene Profile im Browser (localStorage): der Baum { version: 2, items } (loadTree/saveTree). Eine alte flache Liste { name, profile }
// (Commit 561bc10) wird beim Laden übernommen. Der Speicher wird übergeben (null oder werfend = kein Speicher).
import { parseFile, LIMITS } from '../core/profile.js';
import { sanitizeParts } from '../core/profile-parts.js';
import { newTree, sortItems, importNode, freeName, defaultMakeId } from '../core/profile-tree.js';

export const PROFILES_KEY = 'backingtrack.profiles';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const STORED_VERSION = 2;

/** Feste Schlüssel des Profil-Baums (profiles.js); keine gespeicherte Id darf so heißen, sonst verdrängt sie deren Zeile. */
export const isReservedId = (id) => ['session', 'mine', 'factory'].includes(id) || id.startsWith('factory:');

// Knoten einzeln bereinigen: Ebene 1 = oberste Ebene; Defektes fällt weg, Ids und Namen werden repariert, unbekannte Felder nie übernommen
function readItems(raw, level, st) {
  const out = [];
  for (const r of raw) {
    if (!isObject(r) || level > LIMITS.depth || st.nodes >= LIMITS.nodes) continue;
    let node;
    if (r.type === 'profile') {
      const { parts } = sanitizeParts(r.parts);
      if (!Object.keys(parts).length) continue;
      node = { type: 'profile', parts };
    } else if (r.type === 'folder' && Array.isArray(r.items)) node = { type: 'folder', items: [] };
    else continue;
    st.nodes++;
    const id = typeof r.id === 'string' && r.id && !isReservedId(r.id) && !st.ids.has(r.id) ? r.id : defaultMakeId();
    st.ids.add(id);
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, LIMITS.name).trim() : '';
    const full = { id, type: node.type, name: freeName(out.map((n) => n.name), name || 'Importiert'), ...(node.parts ? { parts: node.parts } : { items: readItems(r.items, level + 1, st) }) };
    out.push(full);
  }
  return sortItems(out);
}

// Alte flache Liste -> oberste Ebene; jedes Profil über parseFile mit allen 9 Teilen (Name aus dem Eintrag), Unbrauchbares fällt weg
function migrate(list) {
  let tree = newTree();
  for (const entry of list) {
    const name = typeof entry?.name === 'string' ? entry.name.trim().slice(0, LIMITS.name) : '';
    const r = name ? parseFile(entry?.profile) : null;
    if (!r?.ok || r.node.type !== 'profile') continue;
    const added = importNode(tree, null, { ...r.node, name });
    if (added.ok) tree = added.tree;
  }
  return tree;
}

/** Gespeicherter Baum; tolerant (wirft nie), schreibt nichts zurück. Eine alte flache Liste wird übernommen, alles Unbrauchbare ergibt einen leeren Baum. */
export function loadTree(storage) {
  try {
    const raw = JSON.parse(storage.getItem(PROFILES_KEY));
    if (Array.isArray(raw)) return migrate(raw);
    if (isObject(raw) && Array.isArray(raw.items)) return { items: readItems(raw.items, 1, { nodes: 0, ids: new Set() }) };
  } catch { /* kein Speicher oder kaputtes JSON */ }
  return newTree();
}

/** true, wenn gespeichert wurde (false: Speicher gesperrt, voll oder nicht vorhanden). */
export function saveTree(storage, tree) {
  try {
    storage.setItem(PROFILES_KEY, JSON.stringify({ version: STORED_VERSION, items: tree.items }));
    return true;
  } catch { return false; }
}
