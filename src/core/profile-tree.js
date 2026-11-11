// Baum der gespeicherten Profile ("Meine Profile"): reine, unveränderliche Operationen ohne DOM und Speicher.
// Tree = { items: Knoten[] }, Knoten = { id, type: 'profile', name, parts } | { id, type: 'folder', name, items }. parentId null = oberste Ebene.
// Jede Operation liefert einen NEUEN Baum (nie die Eingabe verändern; unveränderte Teilbäume werden geteilt) oder { ok: false, code }.
// Ebene: die Einträge der obersten Ebene haben Tiefe 1, tiefer als LIMITS.depth darf nichts liegen; LIMITS.nodes zählt alle Knoten.
// Namen sind nur Zeichenketten und werden nie als Schlüssel benutzt (feindliche Namen wie __proto__ sind gewöhnliche Namen).
import { LIMITS } from './profile.js';
import { mergeParts } from './profile-parts.js';

const fail = (code) => ({ ok: false, code });
const isFolder = (n) => n?.type === 'folder';

/** Zufällige Id (crypto.randomUUID, sonst Zufallszahlen). */
export function defaultMakeId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export const newTree = () => ({ items: [] });

const cmp = (a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });

/** Ordner zuerst, dann nach Name (numerisch: "Funk 2" vor "Funk 10"). Neue Liste. */
export const sortItems = (items) => [...items].sort((a, b) => (isFolder(a) === isFolder(b) ? cmp(a.name, b.name) : isFolder(a) ? -1 : 1));

// ---------- lesen ----------

// Knotenkette von der obersten Ebene bis zum Knoten mit der Id (null: nicht gefunden)
function pathTo(tree, id) {
  const walk = (items, path) => {
    for (const n of items) {
      if (n.id === id) return [...path, n];
      if (isFolder(n)) { const p = walk(n.items, [...path, n]); if (p) return p; }
    }
    return null;
  };
  return walk(tree.items, []);
}

/** { node, parent (null = oberste Ebene), depth (oberste Ebene = 1) } oder null. */
export function find(tree, id) {
  const path = pathTo(tree, id);
  return path ? { node: path.at(-1), parent: path.at(-2) ?? null, depth: path.length } : null;
}

/** Namen von der obersten Ebene bis zum Knoten ([] wenn unbekannt). */
export const pathNames = (tree, id) => (pathTo(tree, id) ?? []).map((n) => n.name);

/** Profile in einem Knoten (oder im ganzen Baum): ein Profil zählt 1. */
export const countProfiles = (node) => (node.type === 'profile' ? 1 : node.items.reduce((s, n) => s + countProfiles(n), 0));

/** Alle Knoten (Profile und Ordner) des Baums. */
export const countNodes = (tree) => { const c = (items) => items.reduce((s, n) => s + 1 + (isFolder(n) ? c(n.items) : 0), 0); return c(tree.items); };

const height = (n) => (isFolder(n) ? 1 + Math.max(0, ...n.items.map(height)) : 1);

/** Alle Ordner in Baumreihenfolge, zuerst die oberste Ebene { id: null, label: '', depth: 0 }; label = Ordnername, depth = Verschachtelung. */
export function listFolders(tree) {
  const out = [{ id: null, label: '', depth: 0 }];
  const walk = (items, depth) => {
    for (const n of sortItems(items)) if (isFolder(n)) { out.push({ id: n.id, label: n.name, depth }); walk(n.items, depth + 1); }
  };
  walk(tree.items, 1);
  return out;
}

// ---------- Namen ----------

const key = (s) => s.toLowerCase();

// Elternliste: null = oberste Ebene; Ordner -> dessen items; Unbekanntes oder Profil -> Fehlercode
function itemsOf(tree, parentId) {
  if (parentId === null) return { items: tree.items, depth: 0 };
  const path = pathTo(tree, parentId);
  if (!path) return { code: 'notFound' };
  return isFolder(path.at(-1)) ? { items: path.at(-1).items, depth: path.length } : { code: 'invalidTarget' };
}

/** Name prüfen: trimmen, auf 60 Zeichen kürzen, leer -> nameEmpty, im Ordner schon vergeben (Ordner wie Profil, ohne Groß-/Kleinschreibung, außer exceptId) -> nameTaken. */
export function validName(tree, parentId, name, exceptId) {
  const clean = String(name ?? '').trim().slice(0, LIMITS.name).trim();
  if (!clean) return fail('nameEmpty');
  const p = itemsOf(tree, parentId);
  if (p.code) return fail(p.code);
  return p.items.some((n) => n.id !== exceptId && key(n.name) === key(clean)) ? fail('nameTaken') : { ok: true, name: clean };
}

// freier Name im Ordner: Name, sonst "Name (2)", "Name (3)" ...; mit dem Zusatz höchstens 60 Zeichen
export function freeName(names, name) {
  const taken = new Set(names.map(key));
  if (!taken.has(key(name))) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const cand = name.slice(0, LIMITS.name - suffix.length).trimEnd() + suffix;
    if (!taken.has(key(cand))) return cand;
  }
}

// ---------- ändern ----------

// Ersetzt die Liste unter parentId (null = oberste Ebene) durch fn(Liste); der Rest wird geteilt
function editItems(tree, parentId, fn) {
  if (parentId === null) return { items: fn(tree.items) };
  const walk = (items) => items.map((n) => (!isFolder(n) ? n : n.id === parentId ? { ...n, items: fn(n.items) } : { ...n, items: walk(n.items) }));
  return { items: walk(tree.items) };
}

// Knoten mit der Id durch fn(Knoten) ersetzen (fn liefert den neuen Knoten)
function editNode(tree, id, fn) {
  const walk = (items) => items.map((n) => (n.id === id ? fn(n) : isFolder(n) ? { ...n, items: walk(n.items) } : n));
  return { items: walk(tree.items) };
}

function add(tree, parentId, name, make, makeId) {
  const v = validName(tree, parentId, name);
  if (!v.ok) return v;
  if (itemsOf(tree, parentId).depth + 1 > LIMITS.depth) return fail('tooDeep');
  if (countNodes(tree) >= LIMITS.nodes) return fail('tooMany');
  const id = makeId();
  return { ok: true, tree: editItems(tree, parentId, (items) => sortItems([...items, make(id, v.name)])), id, name: v.name };
}

export const addFolder = (tree, parentId, name, makeId = defaultMakeId) => add(tree, parentId, name, (id, n) => ({ id, type: 'folder', name: n, items: [] }), makeId);

export const addProfile = (tree, parentId, name, parts, makeId = defaultMakeId) => add(tree, parentId, name, (id, n) => ({ id, type: 'profile', name: n, parts: structuredClone(parts) }), makeId);

export function renameNode(tree, id, name) {
  const f = find(tree, id);
  if (!f) return fail('notFound');
  const v = validName(tree, f.parent?.id ?? null, name, id);
  if (!v.ok) return v;
  const rename = (items) => sortItems(items.map((n) => (n.id === id ? { ...n, name: v.name } : n)));
  return { ok: true, tree: editItems(tree, f.parent?.id ?? null, rename), id, name: v.name };
}

export function removeNode(tree, id) {
  const f = find(tree, id);
  if (!f) return fail('notFound');
  const parentId = f.parent?.id ?? null;
  return { ok: true, tree: editItems(tree, parentId, (items) => items.filter((n) => n.id !== id)), removed: f.node, parentId };
}

/** Teile eines gespeicherten Profils mit den angegebenen überschreiben (nicht genannte Teile bleiben). */
export function overwriteParts(tree, id, parts) {
  const f = find(tree, id);
  if (!f) return fail('notFound');
  if (f.node.type !== 'profile') return fail('invalidTarget');
  return { ok: true, tree: editNode(tree, id, (n) => ({ ...n, parts: mergeParts(n.parts, parts) })), id };
}

// ---------- verschieben ----------

// null = darf; sonst der Fehlercode
function moveCheck(tree, id, targetId) {
  const f = find(tree, id);
  if (!f) return 'notFound';
  const t = itemsOf(tree, targetId);
  if (t.code) return t.code;
  if (targetId !== null && pathTo(tree, targetId).some((n) => n.id === id)) return 'invalidTarget'; // in sich selbst oder einen Nachfahren
  return t.depth + height(f.node) > LIMITS.depth ? 'tooDeep' : null;
}

export const canMove = (tree, id, targetId) => moveCheck(tree, id, targetId) === null;

/** Gültige Zielordner (null = oberste Ebene) in Baumreihenfolge, wie listFolders. */
export const moveTargets = (tree, id) => (find(tree, id) ? listFolders(tree).filter((t) => canMove(tree, id, t.id)) : []);

export function moveNode(tree, id, targetId) {
  const code = moveCheck(tree, id, targetId);
  if (code) return fail(code);
  const f = find(tree, id);
  if (targetId === (f.parent?.id ?? null)) return { ok: true, tree: { items: [...tree.items] }, name: f.node.name }; // schon dort (neue Liste: eine Änderung am Ergebnis trifft die Eingabe nicht)
  const name = freeName(itemsOf(tree, targetId).items.map((n) => n.name), f.node.name);
  const removed = removeNode(tree, id).tree;
  return { ok: true, tree: editItems(removed, targetId, (items) => sortItems([...items, { ...f.node, name }])), name };
}

// ---------- importieren ----------

/**
 * Nimmt einen id-losen Knoten (aus parseFile) samt Inhalt auf. Namenskonflikte bekommen " (2)" ...; was die Tiefe oder die Gesamtzahl
 * sprengt, fällt weg (Rest bleibt) und wird in `dropped` gezählt (jeder Knoten samt Inhalt). Passt schon der Wurzelknoten nicht: tooDeep / tooMany.
 * Eine Sicherung (`node.backup === true`, aus parseFile) ist nur ein Behälter: ihre Einträge kommen einzeln in den Zielordner, rootId ist null.
 */
export function importNode(tree, parentId, node, makeId = defaultMakeId) {
  const p = itemsOf(tree, parentId);
  if (p.code) return fail(p.code);
  if (p.depth + 1 > LIMITS.depth) return fail('tooDeep');
  let room = LIMITS.nodes - countNodes(tree);
  if (room <= 0) return fail('tooMany');
  const ids = [];
  let profiles = 0;
  let dropped = 0; // Knoten, die zu tief lägen oder keinen Platz mehr haben (samt Inhalt); Ungültiges zählt nicht
  const name = (n) => String(n?.name ?? '').trim().slice(0, LIMITS.name).trim() || 'Importiert';
  const size = (n) => 1 + (Array.isArray(n.items) ? n.items.reduce((s, c) => s + size(c), 0) : 0);
  // liefert den neuen Knoten oder null (nicht aufnehmen)
  const build = (n, level, siblings) => {
    if ((n?.type !== 'profile' && !(isFolder(n) && Array.isArray(n.items))) || (n.type === 'profile' && (n.parts === null || typeof n.parts !== 'object'))) return null;
    if (level > LIMITS.depth || room <= 0) { dropped += size(n); return null; }
    room--;
    const out = { id: makeId(), type: n.type, name: freeName(siblings, name(n)) };
    ids.push(out.id);
    if (n.type === 'profile') { profiles++; out.parts = structuredClone(n.parts); return out; }
    out.items = sortItems(buildAll(n.items, level + 1, []));
    return out;
  };
  // Liste von Knoten neben den bestehenden Namen der Zielliste
  const buildAll = (list, level, names) => {
    const out = [];
    for (const c of list) { const b = build(c, level, [...names, ...out.map((x) => x.name)]); if (b) out.push(b); }
    return out;
  };
  const backup = node?.backup === true && isFolder(node) && Array.isArray(node.items);
  const added = buildAll(backup ? node.items : [node], p.depth + 1, p.items.map((n) => n.name));
  if (!added.length) return fail('invalidTarget'); // kein gültiger Knoten
  return { ok: true, tree: editItems(tree, parentId, (items) => sortItems([...items, ...added])), rootId: backup ? null : added[0].id, ids, profiles, dropped };
}
