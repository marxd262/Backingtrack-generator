import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_VERSION, FORMAT_PROFILE, FORMAT_FOLDER, FOLDER_VERSION, LIMITS, makeProfileFile, makeFolderFile, parseFile } from '../../src/core/profile.js';
import { captureParts, PART_IDS } from '../../src/core/profile-parts.js';

const bars = [['A', 'min'], ['D', 'min'], ['E', 'maj'], ['A', 'min']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 96, bars: structuredClone(bars), tags: { development: ['fullFromStart'] }, timbre: { master: { echo: 0.2 } }, seed: 42, variety: true,
  length: 48, meter: [4, 4], layers: { drums: true, bass: false, chords: true, pad: true, lead: true, percussion: true },
  voices: { chords: { id: 'sample', variant: 'jazz' } }, jobs: { lead: 'melody', percussion: 'congas' }, complexity: 0.7, ...extra,
});
const session = (extra = {}) => ({ track: track(), scale: 'blues', style: 'funk', chordColor: 'sevenths', chordColorFromStyle: false, mix: { drums: 0.5, master: 0.8 }, ...extra });

// ---------- neues Dateiformat ----------

const fullSession = () => ({ ...session(), track: track({ groove: 'straight' }) });
const profileNode = (name = 'Funk', extra = {}) => ({ type: 'profile', name, parts: captureParts(fullSession()), ...extra });
const folderNode = (name, items) => ({ type: 'folder', name, items });
const bad = (r, what) => { assert.equal(r.ok, false, what); assert.deepEqual(r.errors, [{ code: 'badProfile', params: {} }], what); };
// das Objekt aus Commit 561bc10 (makeProfile der alten Oberfläche), wörtlich
const OLD_FILE = {
  format: 'backingtrack-profile', version: 1,
  track: { key: { root: 'A', mode: 'minor' }, bpm: 96, bars, tags: { development: ['fullFromStart'] }, timbre: { master: { echo: 0.2 } }, seed: 42, variety: true,
    meter: [4, 4], length: 48, layers: { drums: true, bass: false, chords: true, pad: true, lead: true, percussion: true }, voices: { chords: { id: 'sample', variant: 'jazz' } },
    jobs: { lead: 'melody', percussion: 'congas' }, complexity: 0.7 },
  scale: 'blues', style: 'funk', chordColor: 'sevenths', chordColorFromStyle: false, mix: { drums: 0.5, master: 0.8 },
};

test('Konstanten und Grenzen', () => {
  assert.equal(FORMAT_PROFILE, 'backingtrack-profile');
  assert.equal(FORMAT_FOLDER, 'backingtrack-folder');
  assert.equal(PROFILE_VERSION, 2);
  assert.equal(FOLDER_VERSION, 1);
  assert.deepEqual(LIMITS, { name: 60, depth: 8, nodes: 1000, file: 5_000_000 });
});

test('Rundlauf Profil: Datei als Text ergibt denselben Knoten, ohne Ids', () => {
  const file = makeProfileFile({ ...profileNode(), id: 'abc', extra: 1 });
  assert.deepEqual(Object.keys(file), ['format', 'version', 'name', 'parts']);
  assert.equal(file.format, FORMAT_PROFILE);
  assert.equal(file.version, 2);
  const r = parseFile(JSON.stringify(file));
  assert.deepEqual(r, { ok: true, node: profileNode(), skipped: 0 });
});

test('Rundlauf Ordner: verschachtelter Baum bleibt gleich, Ids werden nie geschrieben', () => {
  const tree = { ...folderNode('Meine Profile', [profileNode('A', { id: 'ID-p1' }), { ...folderNode('Unter', [profileNode('B'), folderNode('Leer', [])]), id: 'ID-f1' }]), id: 'ID-root' };
  const file = makeFolderFile(tree);
  assert.deepEqual(Object.keys(file), ['format', 'version', 'name', 'items']);
  assert.equal(file.version, FOLDER_VERSION);
  for (const id of ['ID-']) assert.ok(!JSON.stringify(file).includes(id), id);
  const r = parseFile(JSON.stringify(file));
  assert.ok(r.ok);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.node, folderNode('Meine Profile', [profileNode('A'), folderNode('Unter', [profileNode('B'), folderNode('Leer', [])])]));
});

test('Altformat (Commit 561bc10) wird als Profil mit allen 9 alten Teilen (ohne form) gelesen, Name "Importiert"', () => {
  for (const input of [JSON.stringify(OLD_FILE), structuredClone(OLD_FILE)]) {
    const r = parseFile(input);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.node.type, 'profile');
    assert.equal(r.node.name, 'Importiert');
    assert.deepEqual(Object.keys(r.node.parts), PART_IDS.filter((id) => id !== 'form'));
    assert.equal(r.node.parts.tempo.bpm, 96);
    assert.equal(r.node.parts.harmony.scale, 'blues');
    assert.equal(r.node.parts.style.style, 'funk');
    assert.deepEqual(r.node.parts.mixer.mix, { drums: 0.5, master: 0.8 });
    assert.equal(r.node.parts.rhythm.groove, null, 'Altdatei ohne groove: Standard');
    assert.equal(r.skipped, 0);
  }
});

test('Altformat: Ungültiges fällt einzeln weg und wird gezählt; ohne brauchbaren Track abgelehnt', () => {
  const r = parseFile({ ...OLD_FILE, version: 7, track: { ...OLD_FILE.track, bpm: 5 }, style: 'nope' });
  assert.ok(r.ok);
  assert.equal(r.node.parts.tempo, undefined);
  assert.equal(r.node.parts.style.style, undefined);
  assert.equal(r.skipped, 2);
  bad(parseFile({ ...OLD_FILE, track: null }), 'track null');
  bad(parseFile({ ...OLD_FILE, track: [] }), 'track Liste');
  bad(parseFile({ format: FORMAT_PROFILE, track: {} }), 'track leer');
});

test('unbekannte Felder werden überall ignoriert: oberste Ebene, Teile, Knoten; unbekannte Teile ebenso', () => {
  const p = profileNode();
  p.parts.tempo.future = 1;
  p.parts.futurePart = { a: 1 };
  const file = { ...makeProfileFile(p), extra: [1], parts: p.parts };
  const r = parseFile(file);
  assert.ok(r.ok);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.node, profileNode());
  const folder = { ...makeFolderFile(folderNode('F', [profileNode()])), extra: 1 };
  folder.items[0].more = { x: 1 };
  folder.items.push({ type: 'future', name: 'Z', stuff: 1 });
  const f = parseFile(folder);
  assert.ok(f.ok);
  assert.deepEqual(f.node, folderNode('F', [profileNode()]));
  assert.equal(f.skipped, 1, 'unbekannter Knotentyp zählt');
});

test('version ist nur Information: 99, fehlend, Text und negativ werden gelesen', () => {
  for (const version of [99, undefined, '2', -1, null]) {
    const r = parseFile({ ...makeProfileFile(profileNode()), version });
    assert.ok(r.ok, String(version));
    assert.deepEqual(r.node, profileNode());
    assert.ok(parseFile({ ...makeFolderFile(folderNode('F', [profileNode()])), version }).ok, String(version));
  }
});

test('abgelehnt wird nur Unbrauchbares, ohne zu werfen', () => {
  for (const input of ['', 'kein json', '[]', '5', 'null', '"x"', {}, [], null, undefined, 7, { format: 'x' }, { format: FORMAT_PROFILE, parts: {} },
    { format: FORMAT_PROFILE, parts: { tempo: { bpm: 5 } } }, { format: FORMAT_PROFILE, parts: 'x' }, { format: FORMAT_PROFILE },
    { format: FORMAT_FOLDER }, { format: FORMAT_FOLDER, items: [] }, { format: FORMAT_FOLDER, items: 'x' },
    { format: FORMAT_FOLDER, name: 'F', items: [{ type: 'profile', name: 'a', parts: {} }, { type: 'folder' }, 5, null, { type: 'x' }] }]) {
    bad(parseFile(input), JSON.stringify(input));
  }
  bad(parseFile('x'.repeat(LIMITS.file + 1)), 'zu groß');
  bad(parseFile(JSON.stringify({ ...makeProfileFile(profileNode()), pad: 'x'.repeat(LIMITS.file) })), 'zu groß mit gültigem Inhalt');
  assert.ok(parseFile(JSON.stringify(makeProfileFile(profileNode()))).ok);
  bad(parseFile({ format: FORMAT_PROFILE, get parts() { throw new Error('boom'); } }), 'werfender Getter');
});

test('ungültiges Feld wird übersprungen und gezählt, der Rest bleibt', () => {
  const p = profileNode();
  p.parts.tempo.bpm = 5;
  p.parts.mixer.mix.drums = 7;
  p.parts.variant = 'x';
  const r = parseFile({ format: FORMAT_PROFILE, version: 2, name: 'X', parts: p.parts });
  assert.ok(r.ok);
  assert.equal(r.skipped, 3);
  assert.equal(r.node.parts.tempo, undefined);
  assert.deepEqual(r.node.parts.mixer.mix, { master: 0.8 });
  assert.equal(r.node.parts.variant, undefined);
  assert.equal(r.node.parts.style.style, 'funk');
  // Ordner: der Zähler summiert über alle Profile
  const f = parseFile({ format: FORMAT_FOLDER, name: 'F', items: [{ type: 'profile', name: 'A', parts: p.parts }, { type: 'profile', name: 'B', parts: p.parts }] });
  assert.equal(f.skipped, 6);
});

test('Namen: Randleerzeichen weg, höchstens 60 Zeichen, Unbrauchbares wird "Importiert"', () => {
  const name = (n) => parseFile({ ...makeProfileFile(profileNode()), name: n }).node.name;
  assert.equal(name('  Funk mit Echo  '), 'Funk mit Echo');
  assert.equal(name('x'.repeat(80)), 'x'.repeat(60));
  for (const n of [5, null, {}, [], '', '   ', undefined]) assert.equal(name(n), 'Importiert', String(n));
  const f = parseFile({ format: FORMAT_FOLDER, name: 7, items: [{ type: 'folder', name: ' U ', items: [{ type: 'profile', name: '', parts: profileNode().parts }] }] });
  assert.equal(f.node.name, 'Importiert');
  assert.equal(f.node.items[0].name, 'U');
  assert.equal(f.node.items[0].items[0].name, 'Importiert');
  assert.equal(makeProfileFile({ ...profileNode(), name: '  A  ' }).name, 'A');
});

// Tiefe: die Datei selbst (oberster Ordner) ist Ebene 1; ein Knoten auf Ebene > LIMITS.depth (8) fällt weg. Ein Ordner auf Ebene 8 darf also
// nur noch leer bleiben; sein Inhalt (Ebene 9) wird übersprungen.
test('Tiefe: 100 Ebenen tief ergeben nur 8 Ordnerebenen, der Rest zählt als übersprungen', () => {
  let node = profileNode('tief');
  for (let i = 100; i >= 1; i--) node = folderNode(`F${i}`, [node]);
  const r = parseFile(makeFolderFile(node));
  assert.ok(r.ok);
  let depth = 0;
  for (let n = r.node; n.type === 'folder'; n = n.items[0] ?? { type: 'end' }) depth++;
  assert.equal(depth, LIMITS.depth);
  assert.equal(r.skipped, 1, 'der Teilbaum unter Ebene 8 zählt einmal');
  // Profil auf Ebene 8 bleibt, auf Ebene 9 fällt es weg
  const at = (levels) => { let n = profileNode(); for (let i = levels; i >= 1; i--) n = folderNode('F', [n]); return n; };
  assert.equal(parseFile(makeFolderFile(at(7))).skipped, 0);
  assert.equal(parseFile(makeFolderFile(at(8))).skipped, 1);
});

test('„Alles sichern“: backup: true nur auf Wunsch; parseFile trägt es am Knoten, anderes als true/false zählt als ungültig', () => {
  const items = [profileNode('A'), folderNode('U', [profileNode('B')])];
  const file = makeFolderFile({ name: 'Meine Profile', items, backup: true });
  assert.deepEqual(Object.keys(file), ['format', 'version', 'name', 'backup', 'items']);
  assert.equal(file.backup, true);
  assert.equal('backup' in makeFolderFile(folderNode('F', items)), false, 'ein gewöhnlicher Ordner bleibt ohne das Feld');
  const r = parseFile(JSON.stringify(file));
  assert.equal(r.node.backup, true);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.node.items, items);
  assert.equal('backup' in parseFile(makeFolderFile(folderNode('F', items))).node, false);
  assert.equal('backup' in parseFile({ ...file, backup: false }).node, false);
  const odd = parseFile({ ...file, backup: 'ja' });
  assert.equal('backup' in odd.node, false);
  assert.equal(odd.skipped, 1);
});

test('Sicherung: die Wurzel ist nur Behälter (Einträge ab Ebene 1, zählt nicht als Knoten): Profil auf Ebene 8 bleibt, 1000 Einträge passen', () => {
  const below = (levels) => { let n = profileNode(); for (let i = levels; i >= 1; i--) n = folderNode('F', [n]); return n; }; // Profil auf Ebene levels + 1
  const backup = (items) => parseFile(makeFolderFile({ name: 'Meine Profile', items, backup: true }));
  const r = backup([below(7)]);
  assert.equal(r.skipped, 0);
  let n = r.node;
  let depth = 0;
  while (n.type === 'folder') { n = n.items[0]; depth++; }
  assert.equal(depth, 8, 'Wurzel + 7 Ordner, das Profil liegt auf Ebene 8');
  assert.equal(backup([below(8)]).skipped, 1, 'Ebene 9 fällt weiter weg');
  const many = Array.from({ length: LIMITS.nodes }, (_, i) => ({ type: 'profile', name: `P${i}`, parts: { tempo: { bpm: 100 } } }));
  const full = backup(many);
  assert.equal(full.node.items.length, LIMITS.nodes);
  assert.equal(full.skipped, 0);
  assert.equal(backup([...many, many[0]]).skipped, 1, 'der 1001. Eintrag fällt weg');
});

test('Knotenzahl: von 10000 Knoten bleiben höchstens 1000', () => {
  const items = Array.from({ length: 10000 }, (_, i) => ({ type: 'profile', name: `P${i}`, parts: { tempo: { bpm: 100 } } }));
  const r = parseFile({ format: FORMAT_FOLDER, name: 'F', items });
  assert.ok(r.ok);
  const count = (n) => 1 + (n.items ?? []).reduce((a, c) => a + count(c), 0);
  assert.equal(count(r.node), LIMITS.nodes);
  assert.equal(r.skipped, 10000 - (LIMITS.nodes - 1));
});

test('Export schreibt nie Ids oder interne Felder', () => {
  const p = makeProfileFile({ ...profileNode(), id: 'x', selected: true });
  assert.ok(!('id' in p) && !('selected' in p));
  const f = makeFolderFile({ ...folderNode('F', [{ ...profileNode(), id: 'y' }]), id: 'z', open: true });
  assert.ok(!('id' in f) && !('open' in f) && !('id' in f.items[0]));
  assert.deepEqual(Object.keys(f.items[0]), ['type', 'name', 'parts']);
});

test('Prototyp bleibt sauber bei feindlichem JSON', () => {
  for (const text of ['{"__proto__":{"polluted":1}}', '{"format":"backingtrack-folder","name":"F","__proto__":{"polluted":1},"items":[{"type":"profile","name":"A","__proto__":{"polluted":2},"parts":{"__proto__":{"polluted":3},"tempo":{"bpm":100,"__proto__":{"polluted":4}}}}]}']) {
    const r = parseFile(text);
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
    if (r.ok) assert.equal(r.node.items[0].parts.tempo.bpm, 100);
  }
});

test('Altformat ohne meter im Track: gilt als 4/4; sonst ungültige Harmonie lehnt weiter ab', () => {
  const noMeter = structuredClone(OLD_FILE);
  delete noMeter.track.meter;
  const r = parseFile(noMeter);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.node.parts.harmony.meter, [4, 4]);
  assert.equal(r.node.parts.harmony.bars.length, 4);
  // ein ausdrücklich ungültiger meter oder Takte, die nicht zu 4/4 passen, bleiben abgelehnt
  bad(parseFile({ ...OLD_FILE, track: { ...OLD_FILE.track, meter: [5, 4] } }), 'meter ungültig');
  bad(parseFile({ ...noMeter, track: { ...noMeter.track, bars: noMeter.track.bars.map((b) => ({ ...b, beats: 3 })) } }), 'Takte passen nicht zu 4/4');
  bad(parseFile({ ...noMeter, track: { ...noMeter.track, bars: [] } }), 'ohne Takte');
});

test('Dateigröße: genau LIMITS.file Zeichen werden gelesen, eines mehr wird abgelehnt', () => {
  const base = JSON.stringify({ ...makeProfileFile(profileNode()), pad: '' });
  const fill = (n) => JSON.stringify({ ...makeProfileFile(profileNode()), pad: 'x'.repeat(n) });
  const exact = fill(LIMITS.file - base.length);
  assert.equal(exact.length, LIMITS.file);
  assert.ok(parseFile(exact).ok, 'genau am Limit');
  const over = fill(LIMITS.file - base.length + 1);
  assert.equal(over.length, LIMITS.file + 1);
  bad(parseFile(over), 'ein Zeichen zu viel');
});

test('Knotenzahl: genau 1000 Knoten ohne Verlust, der 1001. fällt weg und wird gezählt', () => {
  const folder = (children) => parseFile({ format: FORMAT_FOLDER, name: 'F', items: Array.from({ length: children }, (_, i) => ({ type: 'profile', name: `P${i}`, parts: { tempo: { bpm: 100 } } })) });
  const exact = folder(LIMITS.nodes - 1); // Ordner + 999 Profile
  assert.equal(exact.node.items.length, LIMITS.nodes - 1);
  assert.equal(exact.skipped, 0);
  const over = folder(LIMITS.nodes);
  assert.equal(over.node.items.length, LIMITS.nodes - 1);
  assert.equal(over.skipped, 1);
});

test('parseFile verändert die Eingabe nicht (tief eingefroren)', () => {
  const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
  const inputs = [
    freeze(makeFolderFile(folderNode('F', [profileNode('A'), folderNode('U', [profileNode('B')])]))),
    freeze({ ...makeProfileFile(profileNode()), extra: { a: [1] } }),
    freeze(structuredClone(OLD_FILE)),
    freeze({ format: FORMAT_FOLDER, name: 'F', items: [{ type: 'profile', name: 'A', parts: { tempo: { bpm: 5 } } }, { type: 'profile', name: 'B', parts: profileNode().parts }] }),
  ];
  for (const input of inputs) {
    const snap = JSON.stringify(input);
    const r = parseFile(input);
    assert.ok(r.ok || input.items);
    assert.equal(JSON.stringify(input), snap);
  }
});

// ---------- Teil form (zehnter Teil) ----------

const FORM = {
  template: 'rock', auto: false, feel: { structure: 0.6, dynamics: 0.9, pauses: 0.4, randomness: 0.5 },
  sections: [{ type: 'intro', bars: 8 }, { type: 'verse', bars: 16, level: -3, locked: true }, { type: 'chorus', bars: 24, crash: true, transition: 'stop' }],
};

test('Rundlauf Profil mit Teil form: Datei als Text ergibt dieselbe Form (10 Teile)', () => {
  const node = { type: 'profile', name: 'Mit Form', parts: captureParts({ ...session(), track: track({ form: FORM, length: 48 }) }) };
  assert.equal(Object.keys(node.parts).length, 10);
  const r = parseFile(JSON.stringify(makeProfileFile(node)));
  assert.deepEqual(r, { ok: true, node, skipped: 0 });
  assert.deepEqual(r.node.parts.form, { form: FORM });
});

test('Dateien von früher (Version 1 und 2, 9 Teile) und unbekannte künftige Teile bleiben lesbar', () => {
  const nine = captureParts(fullSession());
  assert.equal(Object.keys(nine).length, 9);
  for (const version of [1, 2, 9]) {
    const r = parseFile(JSON.stringify({ format: FORMAT_PROFILE, version, name: 'Alt', parts: { ...nine, zukunft: { a: 1 } } }));
    assert.ok(r.ok, `Version ${version}`);
    assert.deepEqual(Object.keys(r.node.parts), PART_IDS.filter((id) => id !== 'form'));
    assert.equal(r.skipped, 0);
  }
});

test('Datei mit kaputtem Teil form: Rest des Profils bleibt, Zählung stimmt, nur Teil form allein und ungültig -> abgelehnt', () => {
  const parts = { ...captureParts(fullSession()), form: { form: { ...FORM, sections: [{ type: 'verse', bars: 8 }, { type: 'nope', bars: 4 }] } } };
  const r = parseFile({ format: FORMAT_PROFILE, version: 2, name: 'Halb', parts });
  assert.ok(r.ok);
  assert.deepEqual(r.node.parts.form.form.sections, [{ type: 'verse', bars: 8 }]);
  assert.equal(r.skipped, 1);
  bad(parseFile({ format: FORMAT_PROFILE, version: 2, name: 'Nur', parts: { form: { form: { ...FORM, sections: [] } } } }), 'leere Liste');
});
