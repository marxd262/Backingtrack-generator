// Profil-Fenster neben dem Mischpult-Knopf: links der Baum ("Aktuelle Sitzung", "Werksprofile" mit den Stilen, "Meine Profile"),
// rechts das Feld zur Auswahl. Eigene Profile liegen im Browser (profile-store.js); Baum-Operationen stehen in core/profile-tree.js,
// die Teile in core/profile-parts.js, das Dateiformat in core/profile.js. Auswahl und offene Ordner gelten nur bis zum Neuladen.
// Löschen, Verschieben, Überschreiben und Import lassen sich einmal rückgängig machen (nur der Baum, nie die Sitzung).
// Verschieben geht immer über "Verschieben nach …"; Ziehen am Griff (profile-drag.js) ist der zweite Weg.
import { t } from '../index.js';
import { $, state, layoutStorage, setText, setAttr, applyStyle } from './state.js';
import { captureParts, applyParts } from '../core/profile-parts.js';
import { parseFile, makeProfileFile, makeFolderFile, FORMAT_FOLDER, LIMITS } from '../core/profile.js';
import { find, sortItems, addProfile, addFolder, renameNode, removeNode, overwriteParts, importNode, listFolders, freeName, canMove, moveNode, moveTargets } from '../core/profile-tree.js';
import { loadTree, saveTree } from './profile-store.js';
import { createTreeView } from './profile-tree-view.js';
import { attachDrag } from './profile-drag.js';
import { createPartsPicker, contentsLine, folderLine, deleteQuestion, count } from './profile-parts-picker.js';
import { factoryProfiles, factoryParts } from './profile-factory.js';
import { readSession, writeSession, summary } from './profile-session.js';

const FACTORY = 'factory:';
const BAD = [{ code: 'badProfile', params: {} }];
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const show = (node, on) => { if (node.hidden === on) node.hidden = !on; };
const button = (id) => el('button', { type: 'button', className: 'chip', id });
const row = (...nodes) => { const r = el('div', { className: 'chips' }); r.append(...nodes); return r; };
const wanted = (name) => name.trim().slice(0, LIMITS.name).trim(); // der Name, wie ihn validName prüft

// Feld mit Beschriftung und Knopf in einem Formular: Enter bestätigt
function fieldForm(input, buttonId, onSubmit) {
  const label = el('label', { htmlFor: input.id, className: 'pop-label' });
  const go = el('button', { type: 'submit', className: 'chip', id: buttonId });
  const form = el('form', { className: 'profile-section' });
  form.append(label, input, row(go));
  form.addEventListener('submit', (e) => { e.preventDefault(); onSubmit(input.value); });
  return { form, input, label, go };
}
const nameForm = (id, buttonId, onSubmit) => fieldForm(el('input', { type: 'text', id, maxLength: LIMITS.name, autocomplete: 'off' }), buttonId, onSubmit);

// Ordner als Optionen, je Ebene mit geschützten Leerzeichen eingerückt (<option> zieht normale zusammen); null = "Meine Profile" mit Wert ''
const folderOptions = (select, list) => select.replaceChildren(...list.map((f) => el('option', { value: f.id ?? '', textContent: `${'\u00a0\u00a0'.repeat(f.depth)}${f.label}` })));

export function initProfiles({ render, restartIfPlaying, applyLive }) {
  let tree = loadTree(layoutStorage);
  let selection = 'session'; // Schlüssel der gewählten Zeile: session, factory, factory:<Stil>, mine oder die Id eines eigenen Eintrags
  let open = new Set(['mine', 'factory']); // offene Ordner; neue Menge bei jeder Änderung (render vergleicht die Identität)
  let message = null; // () => Text; wird in jedem Render neu übersetzt
  let undo = null; // { tree, selection, message } vor der letzten Aktion, die sich rückgängig machen lässt; message = ihre Meldung
  let mode = null; // offenes Feld rechts: 'overwrite', 'rename', 'subfolder', 'move' oder 'confirm' (Rückfrage beim Löschen)
  let targets = []; // Ziele für "Verschieben nach …" beim gewählten eigenen Eintrag (ohne seinen Ordner), neu bei jeder Änderung

  // --- Aufbau ---
  const treeBox = el('div', { className: 'profile-tree', id: 'profile-tree' });
  const view = createTreeView(treeBox, {
    onSelect: (key) => { selection = key; message = undo?.message ?? null; mode = null; render(); },
    onToggle: (key) => {
      open = new Set(open);
      if (!open.delete(key)) open.add(key);
      render();
    },
  });

  const panel = el('section', { className: 'profile-panel', id: 'profile-panel' });
  const title = el('h2', { className: 'profile-title', id: 'profile-panel-title' });
  panel.setAttribute('aria-labelledby', title.id);
  const info = el('p', { className: 'hint', id: 'profile-panel-info' });

  // Aktuelle Sitzung: Kurzbeschreibung, als Profil speichern
  const sessionBox = el('div', { className: 'profile-section' });
  const sessionSummary = el('p', { className: 'profile-summary', id: 'profile-session-summary' });
  const saveLabel = el('p', { className: 'pop-label' });
  const name = el('input', { type: 'text', id: 'profile-name', maxLength: LIMITS.name, autocomplete: 'off' });
  const nameLabel = el('label', { htmlFor: name.id, className: 'pop-label' });
  const folder = el('select', { id: 'profile-folder' });
  const folderLabel = el('label', { htmlFor: folder.id, className: 'pop-label' });
  const picker = createPartsPicker({ idPrefix: 'profile-save-parts', t });
  const save = button('profile-save');
  sessionBox.append(sessionSummary, saveLabel, nameLabel, name, folderLabel, folder, picker.element, row(save));

  // Werksprofil und eigenes Profil: Laden; Werksprofil: Kopie speichern; eigenes Profil: Mit Sitzung überschreiben (Teile-Auswahl)
  const load = button('profile-load');
  const factoryCopy = button('profile-factory-copy');
  const overwrite = button('profile-overwrite');
  const actions = row(load, overwrite, factoryCopy);
  const overwritePicker = createPartsPicker({ idPrefix: 'profile-overwrite-parts', t });
  const overwriteGo = button('profile-overwrite-go');
  const overwriteBox = el('div', { className: 'profile-section' });
  overwriteBox.append(overwritePicker.element, row(overwriteGo));

  // eigenes Profil und Ordner: Neuer Unterordner (nur Ordner), Umbenennen, Verschieben nach …, Löschen (nicht bei "Meine Profile")
  const subfolder = button('profile-subfolder');
  const rename = button('profile-rename');
  const moveButton = button('profile-move');
  const del = button('profile-delete');
  const manage = row(subfolder, rename, moveButton, del);
  const renameForm = nameForm('profile-rename-name', 'profile-rename-go', doRename);
  const subfolderForm = nameForm('profile-folder-name', 'profile-folder-add', doSubfolder);
  const moveForm = fieldForm(el('select', { id: 'profile-move-to' }), 'profile-move-go', (value) => move(selected().node.id, value || null));
  const ask = el('p', { className: 'profile-ask', id: 'profile-delete-ask' });
  const yes = button('profile-delete-yes');
  const no = button('profile-delete-no');
  const confirmBox = el('div', { className: 'profile-section' });
  for (const b of [yes, no]) b.setAttribute('aria-describedby', ask.id); // die Frage gehört zu beiden Antworten
  confirmBox.append(ask, row(yes, no));

  // Austausch (alles außer dem Ordner "Werksprofile"); Import bei der Sitzung und bei Ordnern
  const exchange = el('div', { className: 'profile-section' });
  const exchangeLabel = el('p', { className: 'pop-label' });
  const file = button('profile-file');
  const copy = button('profile-copy');
  const text = el('textarea', { id: 'profile-text', rows: 4, spellcheck: false });
  const textLabel = el('label', { htmlFor: text.id, className: 'pop-label' });
  const importBox = el('div', { className: 'profile-section' });
  const importText = button('profile-import-text');
  const pick = el('input', { type: 'file', id: 'profile-import-file', accept: '.json,application/json' });
  const pickLabel = el('label', { htmlFor: pick.id, className: 'pop-label' });
  importBox.append(row(importText), pickLabel, pick);
  exchange.append(exchangeLabel, row(file, copy), textLabel, text, importBox);

  // Meldungszeile mit "Rückgängig"; ganz unten "Alles sichern"
  const status = el('p', { className: 'message', id: 'profile-message' });
  status.setAttribute('role', 'status');
  const undoButton = button('profile-undo');
  const statusRow = el('div', { className: 'profile-status' });
  statusRow.append(status, undoButton);
  const backup = button('profile-backup');
  const backupRow = row(backup);
  backupRow.classList.add('profile-backup');
  panel.append(title, info, sessionBox, actions, overwriteBox, manage, renameForm.form, subfolderForm.form, moveForm.form, confirmBox, exchange, statusRow, backupRow);
  $('profiles').append(treeBox, panel);

  // beim Öffnen: Fokus auf die Zeile mit dem Tabstopp (nach dem allgemeinen Popover-Fokus in app.js)
  $('profiles-pop').addEventListener('toggle', (e) => {
    if (e.newState === 'open') treeBox.querySelector('[tabindex="0"]')?.focus();
  });

  // --- Auswahl ---
  // { kind, styleId? , node?, parentId? }; ein verschwundener eigener Eintrag gilt als Sitzung
  function selected() {
    if (['session', 'factory', 'mine'].includes(selection)) return { kind: selection === 'factory' ? 'factory-folder' : selection };
    if (selection.startsWith(FACTORY)) return { kind: 'factory', styleId: selection.slice(FACTORY.length) };
    const f = find(tree, selection);
    return f ? { kind: f.node.type, node: f.node, parentId: f.parent?.id ?? null } : { kind: 'session' };
  }

  // eigenen Eintrag wählen und seine Ordner öffnen, damit die Zeile sichtbar ist
  function select(id) {
    selection = id;
    open = new Set(open).add('mine');
    for (let f = find(tree, id); f?.parent; f = find(tree, f.parent.id)) open.add(f.parent.id);
  }

  const say = (fn) => { message = fn; render(); };
  const sayErrors = (errors) => say(() => errors.map((e) => t(`err.${e.code}`, e.params)).join(' '));
  const sayCode = (code, params) => say(() => t(`ui.profileErr.${code}`, params));

  // Baum übernehmen und speichern; texts() liefert die Meldung, dazu der Hinweis, wenn der Browser-Speicher nichts nimmt.
  // undoable: der alte Baum samt Auswahl wird für "Rückgängig" gemerkt; jede andere Änderung verwirft ihn, damit
  // "Rückgängig" nie eine spätere Änderung (Umbenennen, Speichern …) stillschweigend mit zurücknimmt.
  function commit(next, selectId, texts, undoable = false) {
    undo = undoable ? { tree, selection } : null;
    tree = next;
    mode = null;
    const stored = saveTree(layoutStorage, tree);
    if (selectId) select(selectId);
    const text = () => [...texts(), stored ? '' : t('ui.profileNotStored')].filter(Boolean).join(' ');
    if (undo) undo.message = text; // bleibt beim Wechseln der Auswahl stehen, solange "Rückgängig" da ist
    say(text);
    if (selectId) view.focusKey(selectId); // der gedrückte Knopf ist mit dem Feld verschwunden
  }

  undoButton.addEventListener('click', () => {
    const u = undo;
    if (u) commit(u.tree, u.selection, () => [t('ui.profileUndone')]);
  });

  // --- Sitzung speichern ---
  save.addEventListener('click', () => {
    const ids = picker.getIds();
    if (!ids.length) { say(() => t('ui.profileNeedParts')); return; }
    const r = addProfile(tree, folder.value || null, name.value, captureParts(readSession(state), ids));
    if (!r.ok) {
      sayCode(r.code, { name: wanted(name.value) });
      name.focus();
      return;
    }
    commit(r.tree, r.id, () => [t('ui.profileSaved', { name: r.name })]);
  });

  // --- eigenes Profil und Ordner ändern ---
  // Feld öffnen oder wieder schließen; prepare() füllt es beim Öffnen
  const toggle = (m, prepare) => () => {
    mode = mode === m ? null : m;
    if (mode) prepare();
    render();
    if (mode) ({ rename: renameForm.input, subfolder: subfolderForm.input, move: moveForm.input })[mode]?.focus();
  };

  overwrite.addEventListener('click', toggle('overwrite', () => {
    overwritePicker.setIds(Object.keys(selected().node.parts)); // fehlende Teile lassen sich dazuhaken
    overwritePicker.element.open = true;
  }));

  // nur die angehakten Teile werden ersetzt, die übrigen Teile des Profils bleiben (mergeParts in overwriteParts)
  overwriteGo.addEventListener('click', () => {
    const ids = overwritePicker.getIds();
    if (!ids.length) { say(() => t('ui.profileNeedParts')); return; }
    const { node } = selected();
    const r = overwriteParts(tree, node.id, captureParts(readSession(state), ids));
    if (!r.ok) { sayCode(r.code); return; }
    commit(r.tree, r.id, () => [t('ui.profileOverwritten', { name: node.name })], true);
  });

  rename.addEventListener('click', toggle('rename', () => { renameForm.input.value = selected().node.name; }));
  subfolder.addEventListener('click', toggle('subfolder', () => { subfolderForm.input.value = ''; }));

  // vergebener oder leerer Name: Meldung, nichts ersetzt, das Feld bleibt offen
  function nameRefused(code, value, input) {
    sayCode(code === 'nameTaken' ? 'nameTakenHere' : code, { name: wanted(value) });
    input.focus();
  }

  function doRename(value) {
    const r = renameNode(tree, selected().node.id, value);
    if (!r.ok) { nameRefused(r.code, value, renameForm.input); return; }
    commit(r.tree, r.id, () => [t('ui.profileRenamed', { name: r.name })]);
  }

  function doSubfolder(value) {
    const s = selected();
    const r = addFolder(tree, s.kind === 'mine' ? null : s.node.id, value);
    if (!r.ok) { nameRefused(r.code, value, subfolderForm.input); return; }
    commit(r.tree, r.id, () => [t('ui.profileFolderAdded', { name: r.name })]);
  }

  moveButton.addEventListener('click', toggle('move', () => folderOptions(moveForm.input, targets)));

  // Verschieben (Auswahl oder Ziehen): der Eintrag bleibt gewählt, sein neuer Ordner geht auf; Namenskonflikt -> " (2)" mit Hinweis
  function move(id, target) {
    const { node } = find(tree, id);
    const where = target === null ? null : find(tree, target)?.node.name;
    const r = moveNode(tree, id, target);
    if (!r.ok) { sayCode(r.code); return; }
    commit(r.tree, id, () => [t(r.name === node.name ? 'ui.profileMoved' : 'ui.profileMovedRenamed',
      { name: node.name, folder: where ?? t('ui.profileMine'), newName: r.name })], true);
  }

  // Ziel beim Ziehen: null ("Meine Profile") oder ein eigener Ordner; undefined nimmt nichts an (auch der Ordner, in dem es schon liegt)
  function dropTarget(id, key) {
    const to = key === 'mine' ? null : find(tree, key)?.node.type === 'folder' ? key : undefined;
    return to !== undefined && to !== (find(tree, id)?.parent?.id ?? null) && canMove(tree, id, to) ? to : undefined;
  }
  attachDrag(treeBox, {
    canDrag: (key) => find(tree, key) !== null, // nur eigene Einträge; feste Schlüssel sind nie Ids (profile-store.js)
    canDrop: (key, target) => dropTarget(key, target) !== undefined,
    onDrop: (key, target) => move(key, dropTarget(key, target)),
  });

  // Löschen wählt danach den Elternordner
  function remove() {
    const r = removeNode(tree, selected().node.id);
    if (!r.ok) { sayCode(r.code); return; }
    commit(r.tree, r.parentId ?? 'mine', () => [t('ui.profileDeleted', { name: r.removed.name })], true);
  }

  del.addEventListener('click', () => {
    const { node } = selected();
    if (node.type === 'profile' || !node.items.length) { remove(); return; }
    mode = 'confirm';
    render();
    no.focus(); // sicherer Standard
  });
  yes.addEventListener('click', remove);
  no.addEventListener('click', () => { mode = null; render(); del.focus(); });

  // --- Laden ---
  load.addEventListener('click', () => {
    const s = selected();
    if (s.kind === 'factory') {
      applyStyle(s.styleId); // Stil, Schlagworte, Tempo, Akkordfarbe, Klangregler zurück
      applyLive({ patterns: true, tempo: true });
      say(() => t('ui.profileLoaded'));
    } else if (s.kind === 'profile') {
      const r = applyParts(readSession(state), s.node.parts);
      if (!r.ok) { sayErrors(r.errors); return; } // ganz oder gar nicht: bei Fehlern bleibt die Sitzung
      writeSession(state, r.session);
      restartIfPlaying();
      say(() => t('ui.profileLoaded'));
    }
  });

  // wie Speichern: die Kopie wird gewählt und „Meine Profile“ geht auf
  factoryCopy.addEventListener('click', () => {
    const { styleId } = selected();
    const r = addProfile(tree, null, freeName(tree.items.map((n) => n.name), t(`style.${styleId}`)), factoryParts(styleId));
    if (!r.ok) { sayCode(r.code); return; }
    commit(r.tree, r.id, () => [t('ui.profileSaved', { name: r.name })]);
  });

  // --- Austausch ---
  // Export folgt der Auswahl: Sitzung (alle 10 Teile), Werksprofil, Profil, Ordner samt Inhalt; "Meine Profile" = alles
  function exportFile() {
    const s = selected();
    if (s.kind === 'profile') return makeProfileFile(s.node);
    if (s.kind === 'folder') return makeFolderFile(s.node);
    if (s.kind === 'mine') return backupFile();
    const node = s.kind === 'factory'
      ? { name: t(`style.${s.styleId}`), parts: factoryParts(s.styleId) }
      : { name: t('ui.profileSession'), parts: captureParts(readSession(state)) };
    return makeProfileFile(node);
  }
  const backupFile = () => makeFolderFile({ name: t('ui.profileMine'), items: tree.items, backup: true });

  // ein Ordner ohne Einträge ließe sich nicht wieder importieren (parseFile lehnt ihn ab)
  const empty = (data) => data.format === FORMAT_FOLDER && !data.items.length;

  function download(data) {
    if (empty(data)) { say(() => t('ui.profileNothing')); return; }
    const date = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = el('a', { href: url, download: t(data.format === FORMAT_FOLDER ? 'ui.profileFolderFileName' : 'ui.profileFileName', { date }) });
    a.click();
    URL.revokeObjectURL(url);
    say(() => t('ui.profileFileSaved'));
  }

  file.addEventListener('click', () => download(exportFile()));
  backup.addEventListener('click', () => download(backupFile()));

  copy.addEventListener('click', async () => {
    const data = exportFile();
    if (empty(data)) { say(() => t('ui.profileNothing')); return; }
    text.value = JSON.stringify(data, null, 2); // steht danach auch im Feld: zum Kopieren von Hand, falls die Zwischenablage gesperrt ist
    try {
      await navigator.clipboard.writeText(text.value);
      say(() => t('ui.profileCopied'));
    } catch {
      text.select();
      say(() => t('ui.profileCopyFailed'));
    }
  });

  // Import in den gewählten Ordner (Profil gewählt: dessen Ordner; sonst "Meine Profile"); ein einzelnes Profil wird gewählt, nicht geladen.
  // Eine Sicherung bringt keinen eigenen Ordner mit: ihre Einträge kommen einzeln dazu (rootId null)
  function importRaw(raw) {
    const r = parseFile(raw);
    if (!r.ok) { sayErrors(r.errors); return; }
    const s = selected();
    const target = s.kind === 'profile' ? s.parentId : s.kind === 'folder' ? s.node.id : null;
    const added = importNode(tree, target, r.node);
    if (!added.ok) { sayCode(added.code); return; }
    const node = added.rootId === null ? null : find(added.tree, added.rootId).node;
    const single = node?.type === 'profile';
    if (!single) open = new Set(open).add(target ?? 'mine'); // die Auswahl bleibt, der neue Ordner wird darunter sichtbar
    commit(added.tree, single ? added.rootId : null, () => [
      single ? t('ui.profileImported', { name: node.name })
        : node ? count(t, 'ui.profileImportedFolder', added.profiles, { name: node.name }) : count(t, 'ui.profileRestored', added.profiles),
      r.skipped ? count(t, 'ui.profileSkipped', r.skipped) : '',
      added.dropped ? count(t, 'ui.profileDropped', added.dropped) : '',
    ], true);
  }

  importText.addEventListener('click', () => importRaw(text.value));

  pick.addEventListener('change', async () => {
    const f = pick.files?.[0];
    pick.value = '';
    if (!f) return;
    if (f.size > LIMITS.file) { sayErrors(BAD); return; } // 5 MB
    try { importRaw(await f.text()); } catch { sayErrors(BAD); }
  });

  // --- Darstellung ---
  function rows() {
    const row = (key, label, depth, kind, expandable = false, draggable = false) =>
      ({ key, label, depth, kind, expandable, expanded: expandable && open.has(key), selected: key === selection, draggable });
    const out = [row('session', t('ui.profileSession'), 1, 'session'), row('factory', t('ui.profileFactory'), 1, 'factory-folder', true)];
    if (open.has('factory')) for (const f of factoryProfiles()) out.push(row(f.key, t(`style.${f.styleId}`), 2, 'factory'));
    out.push(row('mine', t('ui.profileMine'), 1, 'folder', true));
    const walk = (items, depth) => {
      for (const n of sortItems(items)) {
        const isFolder = n.type === 'folder';
        out.push(row(n.id, n.name, depth, n.type, isFolder, true));
        if (isFolder && open.has(n.id)) walk(n.items, depth + 1);
      }
    };
    if (open.has('mine')) walk(tree.items, 2);
    return out;
  }

  let drawn = {}; // Stand, für den Baum und Ordnerliste gezeichnet sind (render läuft je Takt)
  let foldersFor = null;

  return function renderProfiles() {
    const s = selected();
    if (s.kind === 'session') selection = 'session';
    if (drawn.tree !== tree || drawn.selection !== selection || drawn.open !== open || drawn.lang !== state.lang) {
      if (drawn.tree !== tree || drawn.selection !== selection) targets = s.node ? moveTargets(tree, s.node.id).filter((f) => f.id !== s.parentId) : [];
      drawn = { tree, selection, open, lang: state.lang };
      view.render(rows());
    }
    setAttr(treeBox, 'aria-label', t('ui.profiles'));

    const titles = { session: t('ui.profileSession'), 'factory-folder': t('ui.profileFactory'), mine: t('ui.profileMine') };
    setText(title, titles[s.kind] ?? (s.kind === 'factory' ? t(`style.${s.styleId}`) : s.node.name));
    const own = s.kind === 'profile' || s.kind === 'folder';
    const folderish = s.kind === 'folder' || s.kind === 'mine';
    const infoText = s.kind === 'factory' ? t('ui.profileFactoryInfo')
      : s.kind === 'profile' ? contentsLine(s.node.parts, t)
        : folderish ? folderLine(s.node ?? tree, t) : '';
    setText(info, infoText);
    show(info, infoText !== '');
    show(sessionBox, s.kind === 'session');
    show(actions, s.kind === 'factory' || s.kind === 'profile');
    show(factoryCopy, s.kind === 'factory');
    show(overwrite, s.kind === 'profile');
    show(manage, own || folderish);
    show(subfolder, folderish);
    show(rename, own);
    show(moveButton, own && targets.length > 0);
    show(del, own);
    show(overwriteBox, mode === 'overwrite');
    show(renameForm.form, mode === 'rename');
    show(subfolderForm.form, mode === 'subfolder');
    show(moveForm.form, mode === 'move');
    show(confirmBox, mode === 'confirm');
    for (const [b, m] of [[overwrite, 'overwrite'], [rename, 'rename'], [subfolder, 'subfolder'], [moveButton, 'move']]) setAttr(b, 'aria-expanded', String(mode === m));
    show(exchange, s.kind !== 'factory-folder');
    show(importBox, s.kind === 'session' || folderish);
    show(undoButton, undo !== null);

    setText(sessionSummary, summary(state, t));
    setText(saveLabel, t('ui.profileSaveAs'));
    setText(nameLabel, t('ui.profileName'));
    setText(folderLabel, t('ui.profileFolder'));
    if (foldersFor !== tree) { // Ordnerliste nur neu bauen, wenn sich der Baum geändert hat; die Wahl bleibt, solange es den Ordner gibt
      foldersFor = tree;
      const keep = folder.value;
      folderOptions(folder, listFolders(tree));
      folder.value = [...folder.options].some((o) => o.value === keep) ? keep : '';
    }
    setText(folder.options[0], t('ui.profileMine'));
    for (const p of [picker, overwritePicker]) p.setUnavailable(state.track.form ? [] : ['form']);
    picker.render();
    setText(save, t('ui.profileSave'));
    setText(load, t('ui.profileLoad'));
    setText(factoryCopy, t('ui.profileFactoryCopy'));
    setText(overwrite, t('ui.profileOverwrite'));
    overwritePicker.render();
    setText(overwriteGo, t('ui.profileOverwriteGo'));
    setText(subfolder, t('ui.profileSubfolder'));
    setText(rename, t('ui.profileRename'));
    setText(del, t('ui.profileDelete'));
    setText(renameForm.label, t('ui.profileNewName'));
    setText(renameForm.go, t('ui.profileOk'));
    setText(subfolderForm.label, t('ui.profileFolderName'));
    setText(subfolderForm.go, t('ui.profileCreate'));
    setText(moveButton, t('ui.profileMove'));
    setText(moveForm.label, t('ui.profileMoveTo'));
    setText(moveForm.go, t('ui.profileMoveGo'));
    if (moveForm.input.options[0]?.value === '') setText(moveForm.input.options[0], t('ui.profileMine'));
    if (mode === 'confirm') setText(ask, deleteQuestion(s.node, t));
    setText(yes, t('ui.profileDeleteYes'));
    setText(no, t('ui.profileCancel'));
    setText(exchangeLabel, t('ui.profileExchange'));
    setText(file, t(folderish ? 'ui.profileFolderFile' : 'ui.profileFile'));
    setText(copy, t(folderish ? 'ui.profileFolderCopy' : 'ui.profileCopy'));
    setText(textLabel, t(s.kind === 'session' || folderish ? 'ui.profileTextAny' : 'ui.profileText'));
    setText(importText, t(folderish ? 'ui.profileImportInto' : 'ui.profileImportText'));
    setText(pickLabel, t('ui.profileImportFile'));
    setText(status, message ? message() : '');
    setText(undoButton, t('ui.profileUndo'));
    setText(backup, t('ui.profileBackup'));
  };
}
