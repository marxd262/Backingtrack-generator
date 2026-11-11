import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newTree, find, pathNames, sortItems, countProfiles, countNodes, listFolders, validName, defaultMakeId,
  addFolder, addProfile, renameNode, removeNode, overwriteParts, moveTargets, canMove, moveNode, importNode,
} from '../../src/core/profile-tree.js';
import { LIMITS } from '../../src/core/profile.js';

const counter = () => { let i = 0; return () => `id${++i}`; };
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const P = (extra = {}) => ({ tempo: { bpm: 100 }, ...extra });

// Baut einen Baum über die Operationen; spec: Namen mit "/" als Pfad, Endung "!" = Profil
function build(spec) {
  const makeId = counter();
  let tree = newTree();
  for (const path of spec) {
    const names = path.split('/');
    let parentId = null;
    names.forEach((n, i) => {
      const last = i === names.length - 1;
      const isProfile = last && n.endsWith('!');
      const name = isProfile ? n.slice(0, -1) : n;
      const siblings = (parentId === null ? tree.items : find(tree, parentId).node.items);
      const hit = siblings.find((x) => x.name === name);
      if (hit) { parentId = hit.id; return; }
      const r = isProfile ? addProfile(tree, parentId, name, P(), makeId) : addFolder(tree, parentId, name, makeId);
      assert.ok(r.ok, `${path}: ${r.code}`);
      tree = r.tree;
      parentId = r.id;
    });
  }
  return tree;
}

// Kette von Ordnern bis zur gegebenen Tiefe; liefert { tree, ids }
function chain(depth) {
  const makeId = counter();
  let tree = newTree();
  let parentId = null;
  const ids = [];
  for (let i = 1; i <= depth; i++) { const r = addFolder(tree, parentId, `F${i}`, makeId); assert.ok(r.ok); tree = r.tree; parentId = r.id; ids.push(r.id); }
  return { tree, ids };
}

test('anlegen: sortiert Ordner zuerst, dann numerisch nach Name', () => {
  const makeId = counter();
  let t = newTree();
  for (const [kind, name] of [['p', 'Funk 10'], ['p', 'Funk 2'], ['f', 'Zeta'], ['p', 'alpha'], ['f', 'Beta']]) {
    const r = kind === 'f' ? addFolder(t, null, name, makeId) : addProfile(t, null, name, P(), makeId);
    assert.ok(r.ok); assert.ok(r.id); t = r.tree;
  }
  assert.deepEqual(t.items.map((n) => n.name), ['Beta', 'Zeta', 'alpha', 'Funk 2', 'Funk 10']);
  assert.deepEqual(sortItems(t.items).map((n) => n.name), t.items.map((n) => n.name));
});

test('Namen: trimmen, nameEmpty, nameTaken ohne Groß-/Kleinschreibung und über Typen hinweg, 60 Zeichen', () => {
  const t = build(['Funk!', 'Ordner']);
  assert.deepEqual(addFolder(t, null, '  '), { ok: false, code: 'nameEmpty' });
  assert.deepEqual(addProfile(t, null, '', P()), { ok: false, code: 'nameEmpty' });
  assert.deepEqual(addProfile(t, null, 'funk', P()), { ok: false, code: 'nameTaken' });
  assert.deepEqual(addFolder(t, null, ' FUNK ', undefined), { ok: false, code: 'nameTaken' }); // Ordner gegen Profil
  assert.deepEqual(addProfile(t, null, 'ordner', P()), { ok: false, code: 'nameTaken' }); // Profil gegen Ordner
  const r = addFolder(t, null, `  ${'x'.repeat(80)}  `);
  assert.equal(r.name.length, LIMITS.name);
  assert.equal(validName(t, null, ' Neu ').name, 'Neu');
  // gleicher Name in einem anderen Ordner ist frei
  const folder = t.items.find((n) => n.name === 'Ordner');
  assert.ok(addProfile(t, folder.id, 'Funk', P()).ok);
});

test('Elternordner: unbekannt -> notFound, Profil als Eltern -> invalidTarget', () => {
  const t = build(['A!']);
  assert.equal(addFolder(t, 'nope', 'x').code, 'notFound');
  assert.equal(addFolder(t, t.items[0].id, 'x').code, 'invalidTarget');
});

test('umbenennen: eigener Name (auch anderes Schreibweise) erlaubt, fremder nameTaken, neu sortiert', () => {
  const t = build(['A!', 'B!']);
  const [a] = t.items;
  assert.ok(renameNode(t, a.id, 'A').ok);
  assert.equal(renameNode(t, a.id, 'a').tree.items[0].name, 'a');
  assert.equal(renameNode(t, a.id, 'b').code, 'nameTaken');
  assert.equal(renameNode(t, a.id, ' ').code, 'nameEmpty');
  assert.equal(renameNode(t, 'nope', 'x').code, 'notFound');
  assert.deepEqual(renameNode(t, a.id, 'Z').tree.items.map((n) => n.name), ['B', 'Z']);
  assert.equal(find(renameNode(t, a.id, 'Z').tree, a.id).node.id, a.id);
});

test('Tiefe: Ebene 8 ist die tiefste, darunter tooDeep (Ordner und Profil)', () => {
  const { tree, ids } = chain(8);
  assert.equal(find(tree, ids[7]).depth, 8);
  assert.equal(addFolder(tree, ids[7], 'x').code, 'tooDeep');
  assert.equal(addProfile(tree, ids[7], 'x', P()).code, 'tooDeep');
  assert.ok(addProfile(tree, ids[6], 'x', P()).ok); // Profil auf Ebene 8
  assert.equal(addFolder(tree, ids[6], 'x').ok, true);
});

test('Knotenlimit: 1000 Knoten, der 1001. wird abgelehnt', () => {
  const items = Array.from({ length: LIMITS.nodes }, (_, i) => ({ id: `n${i}`, type: 'profile', name: `P${i}`, parts: {} }));
  const full = { items };
  assert.equal(countNodes(full), 1000);
  assert.equal(addProfile(full, null, 'mehr', P()).code, 'tooMany');
  assert.equal(addFolder(full, null, 'mehr').code, 'tooMany');
  assert.ok(addFolder({ items: items.slice(1) }, null, 'ok').ok);
});

test('find, pathNames, countProfiles, countNodes', () => {
  const t = build(['A/B/c!', 'A/d!', 'e!']);
  const a = t.items.find((n) => n.name === 'A');
  const c = find(t, a.items.find((n) => n.name === 'B').items[0].id);
  assert.equal(c.depth, 3);
  assert.equal(c.parent.name, 'B');
  assert.equal(find(t, a.id).parent, null);
  assert.equal(find(t, a.id).depth, 1);
  assert.equal(find(t, 'nope'), null);
  assert.deepEqual(pathNames(t, c.node.id), ['A', 'B', 'c']);
  assert.deepEqual(pathNames(t, 'nope'), []);
  assert.equal(countProfiles(a), 2);
  assert.equal(countProfiles(t), 3);
  assert.equal(countProfiles(c.node), 1);
  assert.equal(countNodes(t), 5);
  assert.equal(countNodes(newTree()), 0);
});

test('removeNode liefert genau den Teilbaum und den Elternschlüssel', () => {
  const t = build(['A/B/c!', 'A/d!', 'e!']);
  const a = t.items.find((n) => n.name === 'A');
  const b = a.items.find((n) => n.name === 'B');
  const r = removeNode(t, b.id);
  assert.ok(r.ok);
  assert.deepEqual(r.removed, b);
  assert.equal(r.parentId, a.id);
  assert.equal(find(r.tree, b.id), null);
  assert.equal(countNodes(r.tree), 3);
  const top = removeNode(t, a.id);
  assert.equal(top.parentId, null);
  assert.deepEqual(top.removed, a);
  assert.deepEqual(top.tree.items.map((n) => n.name), ['e']);
  assert.equal(removeNode(t, 'nope').code, 'notFound');
});

test('overwriteParts mischt mergeParts-artig, Ordner und Unbekanntes werden abgelehnt', () => {
  const makeId = counter();
  let t = addProfile(newTree(), null, 'P', { tempo: { bpm: 90 }, style: { style: 'funk' } }, makeId).tree;
  const id = t.items[0].id;
  const r = overwriteParts(t, id, { tempo: { bpm: 120 }, mixer: { mix: {} } });
  assert.deepEqual(r.tree.items[0].parts, { tempo: { bpm: 120 }, style: { style: 'funk' }, mixer: { mix: {} } });
  assert.deepEqual(t.items[0].parts.tempo, { bpm: 90 });
  const f = addFolder(t, null, 'F', makeId);
  assert.equal(overwriteParts(f.tree, f.id, {}).code, 'invalidTarget');
  assert.equal(overwriteParts(t, 'nope', {}).code, 'notFound');
});

test('listFolders: Wurzel zuerst, Ordner in Baumreihenfolge mit Tiefe', () => {
  const t = build(['B/z/y', 'A/m', 'A/a', 'p!']);
  assert.deepEqual(listFolders(t).map((f) => [f.label, f.depth]), [['', 0], ['A', 1], ['a', 2], ['m', 2], ['B', 1], ['z', 2], ['y', 3]]);
  assert.equal(listFolders(t)[0].id, null);
  assert.ok(listFolders(t).slice(1).every((f) => typeof f.id === 'string'));
  assert.deepEqual(listFolders(newTree()), [{ id: null, label: '', depth: 0 }]);
});

test('moveNode: in sich selbst/Unterordner invalidTarget, in den Elternordner ohne Änderung', () => {
  const t = build(['A/B/C', 'D', 'A/p!']);
  const a = t.items.find((n) => n.name === 'A');
  const b = a.items.find((n) => n.name === 'B');
  const c = b.items.find((n) => n.name === 'C');
  for (const target of [a.id, b.id, c.id]) {
    assert.equal(canMove(t, a.id, target), false);
    assert.equal(moveNode(t, a.id, target).code, 'invalidTarget');
  }
  assert.equal(canMove(t, b.id, a.id), true); // schon im Elternordner
  const same = moveNode(t, b.id, a.id);
  assert.ok(same.ok);
  assert.deepEqual(same.tree, t);
  const prof = a.items.find((n) => n.name === 'p');
  assert.equal(moveNode(t, a.id, prof.id).code, 'invalidTarget'); // Profil als Ziel
  assert.equal(moveNode(t, 'nope', null).code, 'notFound');
  assert.equal(moveNode(t, a.id, 'nope').code, 'notFound');
  assert.equal(canMove(t, a.id, 'nope'), false);
  // normal: B nach D, danach nach oben
  const d = t.items.find((n) => n.name === 'D');
  const m = moveNode(t, b.id, d.id);
  assert.ok(m.ok); assert.equal(m.name, 'B');
  assert.deepEqual(pathNames(m.tree, c.id), ['D', 'B', 'C']);
  assert.equal(find(m.tree, b.id).parent.id, d.id);
  assert.ok(moveNode(m.tree, c.id, null).ok);
  assert.equal(countNodes(moveNode(m.tree, c.id, null).tree), countNodes(t));
});

test('moveNode: Tiefenüberlauf bei Teilbaum verboten, Blatt erlaubt', () => {
  const { tree, ids } = chain(7); // F1..F7
  const m = addFolder(tree, null, 'Mitte', () => 'mid1');
  const mid = addFolder(m.tree, m.id, 'Kind', () => 'mid2'); // Mitte (Ebene 1) mit Kind (Ebene 2): Höhe 2
  assert.ok(mid.ok);
  assert.equal(canMove(mid.tree, m.id, ids[6]), false); // Ziel Ebene 7 + Höhe 2 = 9
  assert.equal(moveNode(mid.tree, m.id, ids[6]).code, 'tooDeep');
  assert.equal(canMove(mid.tree, m.id, ids[5]), true); // 6 + 2 = 8
  const pr = addProfile(mid.tree, null, 'Blatt', P(), () => 'mid3');
  assert.equal(canMove(pr.tree, pr.id, ids[6]), true); // Profil auf Ebene 8
});

test('moveNode: gleichnamiger Eintrag im Ziel -> " (2)", " (3)"', () => {
  const t = build(['A/Funk!', 'Funk!', 'A/Funk (2)!', 'B']);
  const top = t.items.find((n) => n.name === 'Funk');
  const a = t.items.find((n) => n.name === 'A');
  const r = moveNode(t, top.id, a.id);
  assert.ok(r.ok);
  assert.equal(r.name, 'Funk (3)');
  assert.equal(find(r.tree, top.id).node.name, 'Funk (3)');
  // Groß-/Kleinschreibung zählt als gleich, Ordner gegen Profil
  const t2 = build(['X/funk', 'Funk!']);
  const funk = t2.items.find((n) => n.name === 'Funk');
  const x = t2.items.find((n) => n.name === 'X');
  assert.equal(moveNode(t2, funk.id, x.id).name, 'Funk (2)');
  // Name mit 60 Zeichen bleibt mit Zusatz bei höchstens 60
  const long = 'y'.repeat(60);
  const t3 = build([`D/${long}!`, `${long}!`]);
  const mv = moveNode(t3, t3.items.find((n) => n.type === 'profile').id, t3.items.find((n) => n.name === 'D').id);
  assert.ok(mv.name.length <= LIMITS.name && mv.name.endsWith(' (2)'));
});

test('moveTargets: ohne Selbst/Nachfahren/Tiefenüberlauf, mit Wurzel und Elternordner', () => {
  const t = build(['A/B/C', 'D/E', 'p!']);
  const a = t.items.find((n) => n.name === 'A');
  const b = a.items[0];
  assert.deepEqual(moveTargets(t, a.id).map((x) => x.label), ['', 'D', 'E']);
  assert.deepEqual(moveTargets(t, b.id).map((x) => x.label), ['', 'A', 'D', 'E']);
  const p = t.items.find((n) => n.type === 'profile');
  assert.equal(moveTargets(t, p.id).length, 6); // Wurzel + A,B,C,D,E
  assert.deepEqual(moveTargets(t, 'nope'), []);
  assert.equal(moveTargets(t, a.id)[0].id, null);
  // Tiefe
  const { tree, ids } = chain(7);
  const k = addFolder(tree, null, 'K', () => 'k1');
  const k2 = addFolder(k.tree, k.id, 'K2', () => 'k2');
  assert.ok(!moveTargets(k2.tree, k.id).some((x) => x.id === ids[6]));
});

test('importNode: Ids, Namenskonflikte " (2)", Profilzahl', () => {
  const t = build(['Funk!', 'Ordner']);
  const node = { type: 'folder', name: 'Ordner', items: [
    { type: 'profile', name: 'a', parts: P() }, { type: 'profile', name: 'A', parts: P() },
    { type: 'folder', name: 'Sub', items: [{ type: 'profile', name: 'x', parts: P() }] },
  ] };
  const r = importNode(t, null, node, counter());
  assert.ok(r.ok);
  assert.equal(r.profiles, 3);
  assert.equal(find(r.tree, r.rootId).node.name, 'Ordner (2)');
  assert.deepEqual(find(r.tree, r.rootId).node.items.map((n) => n.name), ['Sub', 'a', 'A (2)']);
  assert.equal(r.ids.length, 5);
  assert.equal(new Set(r.ids).size, 5);
  assert.ok(r.ids.every((id) => find(r.tree, id)));
  assert.equal(r.ids[0], r.rootId);
  assert.equal(countNodes(r.tree), countNodes(t) + 5);
  // ein einzelnes Profil in einen Ordner
  const folder = t.items.find((n) => n.name === 'Ordner');
  const one = importNode(t, folder.id, { type: 'profile', name: 'Funk', parts: P() }, counter());
  assert.equal(one.profiles, 1);
  assert.equal(find(one.tree, one.rootId).node.name, 'Funk');
  assert.equal(importNode(t, 'nope', node).code, 'notFound');
  assert.equal(importNode(t, t.items.find((n) => n.type === 'profile').id, node).code, 'invalidTarget');
});

test('importNode: Tiefe 8 und Knotenlimit lassen Überzähliges weg', () => {
  const mk = (levels) => { let n = { type: 'profile', name: 'blatt', parts: P() }; for (let i = levels; i >= 1; i--) n = { type: 'folder', name: `O${i}`, items: [n] }; return n; };
  // 10 Ebenen Ordner + Profil, an die Wurzel gehängt: Ebenen 1..8 bleiben (O1..O8), Rest fällt weg
  const r = importNode(newTree(), null, mk(10), counter());
  assert.ok(r.ok);
  assert.equal(r.ids.length, 8);
  assert.equal(r.profiles, 0);
  assert.equal(r.dropped, 3, 'O9, O10 und das Blatt');
  assert.equal(find(r.tree, r.ids[7]).depth, 8);
  // Wurzelknoten zu tief
  const { tree, ids } = chain(8);
  assert.equal(importNode(tree, ids[7], mk(1)).code, 'tooDeep');
  assert.equal(importNode(tree, ids[6], { type: 'profile', name: 'p', parts: P() }, counter()).ok, true);
  // Knotenlimit
  const items = Array.from({ length: LIMITS.nodes - 3 }, (_, i) => ({ id: `n${i}`, type: 'profile', name: `P${i}`, parts: {} }));
  const big = { type: 'folder', name: 'Gross', items: Array.from({ length: 10 }, (_, i) => ({ type: 'profile', name: `q${i}`, parts: P() })) };
  const lim = importNode({ items }, null, big, counter());
  assert.ok(lim.ok);
  assert.equal(countNodes(lim.tree), LIMITS.nodes);
  assert.equal(lim.ids.length, 3);
  assert.equal(lim.profiles, 2);
  assert.equal(lim.dropped, 8);
  assert.equal(importNode({ items: [...items, { id: 'x1', type: 'profile', name: 'x1', parts: {} }, { id: 'x2', type: 'profile', name: 'x2', parts: {} }, { id: 'x3', type: 'profile', name: 'x3', parts: {} }] }, null, big).code, 'tooMany');
});

test('importNode: Teilbaum mit 5 Ebenen in einen Ordner auf Ebene 5 behält genau 3 Ebenen (tiefste auf Ebene 8)', () => {
  const { tree, ids } = chain(5);
  let n = { type: 'profile', name: 'blatt', parts: P() };
  for (let i = 5; i >= 1; i--) n = { type: 'folder', name: `O${i}`, items: [n] };
  let k = 0; const r = importNode(tree, ids[4], n, () => `imp${++k}`);
  assert.ok(r.ok);
  assert.equal(r.ids.length, 3);
  assert.equal(r.profiles, 0);
  assert.equal(find(r.tree, r.ids[0]).depth, 6);
  assert.equal(find(r.tree, r.ids[2]).depth, 8);
  assert.deepEqual(find(r.tree, r.ids[2]).node.items, []);
});

test('importNode meldet Weggelassenes: dropped zählt jeden Knoten, der zu tief läge oder keinen Platz mehr hat', () => {
  const four = { type: 'folder', name: 'V1', items: [{ type: 'folder', name: 'V2', items: [{ type: 'folder', name: 'V3', items: [{ type: 'profile', name: 'V4', parts: P() }] }] }] };
  const { tree, ids } = chain(6);
  let k = 0; const r = importNode(tree, ids[5], four, () => `imp${++k}`);
  assert.ok(r.ok);
  assert.equal(r.ids.length, 2, 'V1 auf Ebene 7, V2 auf Ebene 8');
  assert.equal(r.profiles, 0);
  assert.equal(r.dropped, 2, 'V3 und V4');
  assert.equal(importNode(newTree(), null, four, counter()).dropped, 0);
  // Knotenlimit: 900 Knoten im Baum, ein Ordner mit 299 Profilen kommt, 100 Knoten passen noch
  const items = Array.from({ length: 900 }, (_, i) => ({ id: `n${i}`, type: 'profile', name: `P${i}`, parts: {} }));
  const big = { type: 'folder', name: 'G', items: Array.from({ length: 299 }, (_, i) => ({ type: 'profile', name: `q${i}`, parts: P() })) };
  const lim = importNode({ items }, null, big, counter());
  assert.equal(lim.ids.length, 100);
  assert.equal(lim.profiles, 99);
  assert.equal(lim.dropped, 200);
});

test('importNode Sicherung (backup): die Einträge kommen einzeln in den Zielordner, " (2)" je Eintrag, die 8 Ebenen gelten ab dem Ziel', () => {
  const imp = () => { let k = 0; return () => `imp${++k}`; };
  const t = build(['Funk!', 'Ordner/x!']);
  const backup = { type: 'folder', name: 'Meine Profile', backup: true, items: [
    { type: 'profile', name: 'Funk', parts: P() }, { type: 'folder', name: 'Neu', items: [{ type: 'profile', name: 'y', parts: P() }] },
  ] };
  const r = importNode(t, null, backup, imp());
  assert.ok(r.ok);
  assert.equal(r.rootId, null, 'kein neuer Wurzelordner');
  assert.deepEqual(r.tree.items.map((n) => n.name), ['Neu', 'Ordner', 'Funk', 'Funk (2)']);
  assert.equal(r.profiles, 2);
  assert.deepEqual(r.ids, ['imp1', 'imp2', 'imp3']);
  assert.equal(countNodes(r.tree), countNodes(t) + 3);
  // Ziel auf Ebene 6: die Einträge liegen auf Ebene 7, ihr Inhalt auf Ebene 8, tiefer nichts
  const { tree, ids } = chain(6);
  const deep = { type: 'folder', name: 'M', backup: true, items: [{ type: 'folder', name: 'O1', items: [{ type: 'folder', name: 'O2', items: [{ type: 'profile', name: 'p', parts: P() }] }] }] };
  const d = importNode(tree, ids[5], deep, imp());
  assert.ok(d.ok);
  assert.deepEqual(d.ids.map((id) => find(d.tree, id).depth), [7, 8]);
  assert.equal(importNode(chain(8).tree, 'id8', deep).code, 'tooDeep');
  // an der obersten Ebene: dieselben Ebenen wie im gesicherten Baum (Profil auf Ebene 3)
  const top = importNode(newTree(), null, deep, imp());
  assert.deepEqual(top.ids.map((id) => find(top.tree, id).depth), [1, 2, 3]);
});

test('importNode: Profil ohne parts wird übersprungen, nicht mit parts undefined aufgenommen', () => {
  const t = newTree();
  assert.equal(importNode(t, null, { type: 'profile', name: 'leer' }).code, 'invalidTarget');
  assert.equal(importNode(t, null, { type: 'profile', name: 'leer', parts: null }).code, 'invalidTarget');
  const r = importNode(t, null, { type: 'folder', name: 'F', items: [{ type: 'profile', name: 'ohne' }, { type: 'profile', name: 'mit', parts: P() }] }, counter());
  assert.ok(r.ok);
  assert.deepEqual(find(r.tree, r.rootId).node.items.map((n) => n.name), ['mit']);
  assert.equal(r.profiles, 1);
  assert.equal(r.ids.length, 2);
});

test('importNode: spätere Änderung an den importierten Teilen trifft den übergebenen Knoten nicht', () => {
  const node = { type: 'folder', name: 'F', items: [{ type: 'profile', name: 'a', parts: { tempo: { bpm: 5 }, mixer: { mix: { drums: 1 } } } }] };
  const r = importNode(newTree(), null, node, counter());
  const imported = find(r.tree, r.ids[1]).node;
  imported.parts.tempo.bpm = 99;
  imported.parts.mixer.mix.drums = 0;
  assert.deepEqual(node.items[0].parts, { tempo: { bpm: 5 }, mixer: { mix: { drums: 1 } } });
});

test('moveNode: "schon dort" liefert eine eigene oberste Liste, eine Änderung daran trifft die Eingabe nicht', () => {
  const t = build(['A!', 'B!']);
  const r = moveNode(t, t.items[0].id, null);
  assert.ok(r.ok);
  assert.deepEqual(r.tree, t);
  r.tree.items.push({ id: 'x' });
  r.tree.items.reverse();
  assert.equal(t.items.length, 2);
  assert.deepEqual(t.items.map((n) => n.name), ['A', 'B']);
});

test('feindliche Namen sind gewöhnliche Namen', () => {
  const makeId = counter();
  let t = newTree();
  for (const name of ['__proto__', 'constructor', '<b>x</b>', 'toString', 'hasOwnProperty']) {
    const r = addFolder(t, null, name, makeId);
    assert.ok(r.ok, name); t = r.tree;
    assert.equal(addProfile(t, null, name.toUpperCase(), P(), makeId).code, 'nameTaken');
  }
  assert.deepEqual(t.items.map((n) => n.name).sort(), ['<b>x</b>', '__proto__', 'constructor', 'hasOwnProperty', 'toString'].sort());
  assert.equal(Object.getPrototypeOf(t.items[0]), Object.prototype);
  const p = t.items.find((n) => n.name === '__proto__');
  const r = importNode(t, p.id, { type: 'folder', name: '__proto__', items: [{ type: 'profile', name: '__proto__', parts: P() }] }, makeId);
  assert.ok(r.ok);
  assert.deepEqual(pathNames(r.tree, r.ids[1]), ['__proto__', '__proto__', '__proto__']);
  assert.equal(({}).polluted, undefined);
});

test('unveränderlich: eingefrorener Baum bleibt nach jeder Operation unverändert', () => {
  const t = deepFreeze(build(['A/B/c!', 'A/d!', 'e!', 'F']));
  const snap = JSON.stringify(t);
  const a = t.items.find((n) => n.name === 'A');
  const f = t.items.find((n) => n.name === 'F');
  const e = t.items.find((n) => n.name === 'e');
  const parts = deepFreeze({ tempo: { bpm: 70 } });
  const node = deepFreeze({ type: 'folder', name: 'A', items: [{ type: 'profile', name: 'e', parts: { tempo: { bpm: 1 } } }] });
  const results = [
    addFolder(t, null, 'N'), addProfile(t, a.id, 'N', parts), renameNode(t, a.id, 'Q'), removeNode(t, a.id), overwriteParts(t, e.id, parts),
    moveNode(t, a.id, f.id), moveNode(t, e.id, a.id), importNode(t, f.id, node), moveTargets(t, a.id), listFolders(t),
  ];
  assert.ok(results.slice(0, 8).every((r) => r.ok));
  assert.equal(JSON.stringify(t), snap);
  // das Ergebnis teilt keine veränderlichen Teile der Eingabeparts: spätere Änderung am Ergebnis trifft die Eingabe nicht
  const src = { tempo: { bpm: 5 } };
  const q = addProfile(newTree(), null, 'P', src);
  q.tree.items[0].parts.tempo.bpm = 99;
  assert.equal(src.tempo.bpm, 5);
});

test('defaultMakeId: viele verschiedene Zeichenketten', () => {
  const ids = new Set(Array.from({ length: 500 }, () => defaultMakeId()));
  assert.equal(ids.size, 500);
  assert.ok([...ids].every((s) => typeof s === 'string' && s.length > 8));
  // ohne Angabe von makeId erzeugen die Operationen verschiedene Ids
  let t = newTree();
  const seen = new Set();
  for (let i = 0; i < 20; i++) { const r = addFolder(t, null, `F${i}`); t = r.tree; seen.add(r.id); }
  assert.equal(seen.size, 20);
});
