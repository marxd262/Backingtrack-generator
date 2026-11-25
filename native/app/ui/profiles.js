// Profil-Fenster neben dem Mischpult-Knopf: links der Baum ("Aktuelle Sitzung", "Werksprofile" mit den Stilen, "Meine Profile"),
// rechts das Feld zur Auswahl. Baum, Auswahl, offene Ordner, Meldung und "Rückgängig" gibt profiles(), jede Änderung ist eine Aktion der
// Sitzung (native/PROTOKOLL.md Abschnitt 3); die Seite hält nur das offene Feld, die Haken, den Inhalt der Felder und den Austausch der Dateien.
// Verschieben geht immer über "Verschieben nach …"; Ziehen am Griff (profile-drag.js) ist der zweite Weg.
import { t, getLanguage } from './i18n/index.js';
import { session, send, exportFile } from './session.js';
import { $, setText, setAttr } from './dom.js';
import { createTreeView } from './profile-tree-view.js';
import { attachDrag } from './profile-drag.js';
import { createPartsPicker, contentsLine, folderLine, deleteQuestion } from './profile-parts-picker.js';

const FACTORY = 'factory:';
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const show = (node, on) => { if (node.hidden === on) node.hidden = !on; };
const button = (id) => el('button', { type: 'button', className: 'chip', id });
const row = (...nodes) => { const r = el('div', { className: 'chips' }); r.append(...nodes); return r; };
const newId = () => crypto.randomUUID(); // die neue Id eines Profils oder Ordners bringt die Aktion (defaultMakeId der Web-App)
// Meldungen, nach denen nichts übernommen ist (das Feld bleibt offen)
const refused = (message) => !message || message.some((m) => /^(ui\.profileErr\.|err\.|ui\.profileNeedParts$|ui\.profileNotStored$)/.test(m.key));

// Feld mit Beschriftung und Knopf in einem Formular: Enter bestätigt
function fieldForm(input, buttonId, onSubmit) {
  const label = el('label', { htmlFor: input.id, className: 'pop-label' });
  const go = el('button', { type: 'submit', className: 'chip', id: buttonId });
  const form = el('form', { className: 'profile-section' });
  form.append(label, input, row(go));
  form.addEventListener('submit', (e) => { e.preventDefault(); onSubmit(input.value); });
  return { form, input, label, go };
}

// Ordner als Optionen, je Ebene mit geschützten Leerzeichen eingerückt (<option> zieht normale zusammen); null = "Meine Profile" mit Wert ''
const folderOptions = (select, list) => select.replaceChildren(...list.map((f) => el('option', { value: f.id ?? '', textContent: `${'  '.repeat(f.depth)}${f.label}` })));

// Die Ordner zum Speichern (listFolders der Web-App): "Meine Profile", dann die Ordner der sortierten Liste, Tiefe für Tiefe hinab
function listFolders(items) {
  const out = [{ id: null, label: '', depth: 0 }];
  const walk = (list, depth) => { for (const n of list) if (n.type === 'folder') { out.push({ id: n.id, label: n.name, depth }); walk(n.items, depth + 1); } };
  walk(items, 1);
  return out;
}

// Eintrag mit der Id in der leichten Liste von profiles(): { node, parentId } oder null
function find(items, id, parentId = null) {
  for (const n of items) {
    if (n.id === id) return { node: n, parentId };
    const hit = n.type === 'folder' ? find(n.items, id, n.id) : null;
    if (hit) return hit;
  }
  return null;
}

export function initProfiles() {
  const { LIMITS, FORMAT_FOLDER } = session.tables;
  let mode = null; // offenes Feld rechts: 'overwrite', 'rename', 'subfolder', 'move' oder 'confirm' (Rückfrage beim Löschen)
  let local = null; // Meldung des Austauschs (Datei, Zwischenablage): ein Schlüssel, bis zur nächsten Aktion des Fensters
  const p = () => session.profiles;

  // eine Aktion des Fensters; mit ihrer Antwort (und dem neuen profiles()) taken() und das Feld zu, wenn sie übernommen ist, sonst refusedThen()
  let out = null; // die Antwort auf die letzte, solange sie aussteht
  function act(action, { taken, refusedThen } = {}) {
    local = null;
    const answer = send(action).then(() => {
      if (refused(p().message)) refusedThen?.();
      else {
        mode = null;
        taken?.();
      }
      render();
    });
    out = answer;
    answer.then(() => { if (out === answer) out = null; });
    return answer;
  }
  // Eine Taste, die aus der Auswahl entscheidet oder mit ihrem Feld verschwindet, wirkt erst auf das Fenster, das die Antworten auf die Aktionen
  // davor zeichnen, und gar nicht, wenn sie mit ihnen verschwand: die Seite der Web-App zeichnet sofort, ein zweites schnelles „Löschen“ findet
  // dort die Rückfrage zum Ordner, ein zweites „Ja, löschen“ keine Rückfrage mehr
  async function whenAnswered(key, fn) {
    while (out) await out;
    if (key.checkVisibility()) fn();
  }

  // --- Aufbau ---
  const treeBox = el('div', { className: 'profile-tree', id: 'profile-tree' });
  const view = createTreeView(treeBox, {
    onSelect: (key) => { mode = null; act({ action: 'profileSelect', key }); },
    onToggle: (key) => send({ action: 'profileToggle', key }),
  });
  // der gewählte Eintrag hat seine Zeile (der Fokus folgt ihr, wie commit der Web-App: der gedrückte Knopf ist mit dem Feld verschwunden)
  const focusSelection = () => view.focusKey(p().selection);

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
  const renameForm = fieldForm(el('input', { type: 'text', id: 'profile-rename-name', maxLength: LIMITS.name, autocomplete: 'off' }), 'profile-rename-go',
    (value) => act({ action: 'renameNode', name: value }, { taken: focusSelection, refusedThen: () => renameForm.input.focus() }));
  const subfolderForm = fieldForm(el('input', { type: 'text', id: 'profile-folder-name', maxLength: LIMITS.name, autocomplete: 'off' }), 'profile-folder-add',
    (value) => whenAnswered(subfolderForm.form, () => act({ action: 'addFolder', name: value, id: newId() }, { taken: focusSelection, refusedThen: () => subfolderForm.input.focus() })));
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

  // was mit den gespeicherten Profilen nicht stimmt (state().storage.profiles, PROTOKOLL.md Abschnitt 3a), bei "unlesbar" mit "Erneut lesen"
  const storage = el('p', { className: 'message', id: 'profile-storage', hidden: true });
  storage.setAttribute('role', 'status');
  const reload = button('profile-reload');
  const storageRow = row(reload);
  storageRow.hidden = true;
  // Meldungszeile mit "Rückgängig"; ganz unten "Alles sichern"
  const status = el('p', { className: 'message', id: 'profile-message' });
  status.setAttribute('role', 'status');
  const undoButton = button('profile-undo');
  const statusRow = el('div', { className: 'profile-status' });
  statusRow.append(status, undoButton);
  const backup = button('profile-backup');
  const backupRow = row(backup);
  backupRow.classList.add('profile-backup');
  panel.append(title, info, sessionBox, actions, overwriteBox, manage, renameForm.form, subfolderForm.form, moveForm.form, confirmBox, exchange, storage, storageRow, statusRow, backupRow);
  $('profiles').append(treeBox, panel);

  // beim Öffnen: Fokus auf die Zeile mit dem Tabstopp (nach dem allgemeinen Popover-Fokus in app.js)
  $('profiles-pop').addEventListener('toggle', (e) => {
    if (e.newState === 'open') treeBox.querySelector('[tabindex="0"]')?.focus();
  });

  // --- Auswahl ---
  // { kind, styleId?, node?, parentId? } der Zeile profiles().selection (eine verschwundene setzt die Sitzung auf "session")
  function selected() {
    const key = p().selection;
    if (['session', 'factory', 'mine'].includes(key)) return { kind: key === 'factory' ? 'factory-folder' : key };
    if (key.startsWith(FACTORY)) return { kind: 'factory', styleId: key.slice(FACTORY.length) };
    const f = find(p().items, key);
    return f ? { kind: f.node.type, node: f.node, parentId: f.parentId } : { kind: 'session' };
  }

  // eine Aktion, die nichts übernimmt (das offene Feld bleibt, wie es ist)
  const request = (action) => { local = null; send(action); };
  undoButton.addEventListener('click', () => act({ action: 'undoProfile' }, { taken: focusSelection }));
  reload.addEventListener('click', () => request({ action: 'reloadProfiles' }));

  // --- Sitzung speichern ---
  save.addEventListener('click', () => act({ action: 'saveProfile', name: name.value, folder: folder.value || null, parts: picker.getIds(), id: newId() },
    { taken: focusSelection, refusedThen: () => { if (p().message?.[0].key.startsWith('ui.profileErr.')) name.focus(); } }));

  // --- eigenes Profil und Ordner ändern ---
  // Feld öffnen oder wieder schließen; prepare() füllt es beim Öffnen
  const toggle = (m, prepare) => () => {
    mode = mode === m ? null : m;
    if (mode) prepare();
    render();
    if (mode) ({ rename: renameForm.input, subfolder: subfolderForm.input, move: moveForm.input })[mode]?.focus();
  };

  overwrite.addEventListener('click', toggle('overwrite', () => {
    overwritePicker.setIds(selected().node.parts); // fehlende Teile lassen sich dazuhaken
    overwritePicker.element.open = true;
  }));

  // nur die angehakten Teile werden ersetzt, die übrigen Teile des Profils bleiben
  overwriteGo.addEventListener('click', () => whenAnswered(overwriteGo, () => act({ action: 'overwriteProfile', parts: overwritePicker.getIds() }, { taken: focusSelection })));

  rename.addEventListener('click', toggle('rename', () => { renameForm.input.value = selected().node.name; }));
  subfolder.addEventListener('click', toggle('subfolder', () => { subfolderForm.input.value = ''; }));
  moveButton.addEventListener('click', toggle('move', () => folderOptions(moveForm.input, p().targets)));

  // Verschieben (Auswahl oder Ziehen): der Eintrag bleibt gewählt, sein neuer Ordner geht auf; Namenskonflikt -> " (2)" mit Hinweis
  const move = (id, target) => act({ action: 'moveNode', id, target }, { taken: focusSelection });

  // Ziehen am Griff: die Sitzung nennt, wohin sich der gezogene Eintrag ablegen lässt (profiles().drag.targets); das Ablegen ist moveNode
  const dragger = attachDrag(treeBox, {
    canDrag: (key) => find(p().items, key) !== null, // nur eigene Einträge; feste Schlüssel sind nie Ids
    // shortcut: ein Ablegen, bevor die Antwort auf profileDrag die Ziele brachte (wenige Millisekunden nach dem Beginn des Ziehens), bricht ab, statt
    // zu verschieben (die Web-App kennt die Ziele sofort), upgrade: wenn ein Ablegen so schnell vorkommt (ein Stift, ein Test) oder die Antwort länger braucht
    canDrop: (key, target) => p().drag?.key === key && p().drag.targets.includes(target),
    onStart: (key) => send({ action: 'profileDrag', key }),
    onDrop: (key, target) => {
      move(key, target === 'mine' ? null : target);
      send({ action: 'profileDrag', key: null });
    },
    onCancel: () => send({ action: 'profileDrag', key: null }),
  });

  // Löschen wählt danach den Elternordner
  const remove = () => act({ action: 'deleteNode' }, { taken: focusSelection });
  del.addEventListener('click', () => whenAnswered(del, () => {
    const { node } = selected();
    if (node.type === 'profile' || !node.items.length) { remove(); return; }
    mode = 'confirm';
    render();
    no.focus(); // sicherer Standard
  }));
  yes.addEventListener('click', () => whenAnswered(yes, remove));
  no.addEventListener('click', () => { mode = null; render(); del.focus(); });

  // --- Laden ---
  load.addEventListener('click', () => request({ action: 'loadProfile' }));
  // wie Speichern: die Kopie wird gewählt und „Meine Profile“ geht auf
  factoryCopy.addEventListener('click', () => act({ action: 'copyFactory', name: t(`style.${selected().styleId}`), id: newId() }, { taken: focusSelection }));

  // --- Austausch ---
  // Export folgt der Auswahl: Sitzung (alle 10 Teile), Werksprofil, Profil, Ordner samt Inhalt; "Meine Profile" = alles. Den Text gibt die
  // Sitzung (Hülle: export); `name` ist der Name der Datei der festen Zeilen
  function exportOf(key) {
    const s = selected();
    const named = { session: t('ui.profileSession'), mine: t('ui.profileMine') }[key] ?? (key.startsWith(FACTORY) ? t(`style.${key.slice(FACTORY.length)}`) : s.node?.name ?? '');
    return exportFile(key, named);
  }
  const say = (key) => { local = key; render(); };

  // ein Ordner ohne Einträge gibt keinen Text (er ließe sich nicht wieder importieren)
  function download(json) {
    if (!json) { say('ui.profileNothing'); return; }
    const date = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = el('a', { href: url, download: t(JSON.parse(json).format === FORMAT_FOLDER ? 'ui.profileFolderFileName' : 'ui.profileFileName', { date }) });
    a.click();
    URL.revokeObjectURL(url);
    say('ui.profileFileSaved');
  }

  file.addEventListener('click', async () => download(await exportOf(p().selection)));
  backup.addEventListener('click', async () => download(await exportOf('mine')));

  copy.addEventListener('click', async () => {
    const json = await exportOf(p().selection);
    if (!json) { say('ui.profileNothing'); return; }
    text.value = json; // steht danach auch im Feld: zum Kopieren von Hand, falls die Zwischenablage gesperrt ist
    try {
      await navigator.clipboard.writeText(text.value);
      say('ui.profileCopied');
    } catch {
      text.select();
      say('ui.profileCopyFailed');
    }
  });

  // Import in den gewählten Ordner (Profil gewählt: dessen Ordner; sonst "Meine Profile"); ein einzelnes Profil wird gewählt, nicht geladen.
  // Die Ids für alles, was er anlegt, bringt die Aktion: höchstens so viele, wie noch in den Baum passen
  const ids = () => Array.from({ length: LIMITS.nodes - p().nodes }, newId);
  const imported = { taken: () => { if (p().message[0].key === 'ui.profileImported') focusSelection(); } }; // ein einzelnes Profil ist gewählt
  importText.addEventListener('click', () => act({ action: 'importProfile', from: 'text', text: text.value, ids: ids() }, imported));

  // eine Datei über LIMITS.file liest die Seite nicht (5 MB), eine, die sich nicht lesen lässt, bringt keinen Text: beides meldet die Sitzung
  pick.addEventListener('change', async () => {
    const f = pick.files?.[0];
    pick.value = '';
    if (!f) return;
    let content = null;
    if (f.size <= LIMITS.file) try { content = await f.text(); } catch { /* text null */ }
    act({ action: 'importProfile', from: 'file', text: content, size: f.size, ids: ids() }, imported);
  });

  // --- Darstellung ---
  // Meldung der Sitzung: eine Liste von { key, params }, übersetzt und mit Leerzeichen verbunden; der Ordner null ist "Meine Profile"
  const messageText = (list) => (list ?? []).map((m) => t(m.key, m.params.folder === null ? { ...m.params, folder: t('ui.profileMine') } : m.params)).join(' ');

  function rows() {
    const { items, open, selection, factory } = p();
    const row = (key, label, depth, kind, expandable = false, draggable = false) =>
      ({ key, label, depth, kind, expandable, expanded: expandable && open.includes(key), selected: key === selection, draggable });
    const out = [row('session', t('ui.profileSession'), 1, 'session'), row('factory', t('ui.profileFactory'), 1, 'factory-folder', true)];
    if (open.includes('factory')) for (const f of factory) out.push(row(f.key, t(`style.${f.styleId}`), 2, 'factory'));
    out.push(row('mine', t('ui.profileMine'), 1, 'folder', true));
    const walk = (list, depth) => {
      for (const n of list) {
        const isFolder = n.type === 'folder';
        out.push(row(n.id, n.name, depth, n.type, isFolder, true));
        if (isFolder && open.includes(n.id)) walk(n.items, depth + 1);
      }
    };
    if (open.includes('mine')) walk(items, 2);
    return out;
  }

  let drawn = {}; // profiles() und Sprache, für die Baum und Ordnerliste gezeichnet sind (render läuft je Takt)

  function render() {
    if (!p()) return; // bis die Antwort auf sync da ist
    const s = selected();
    if (drawn.profiles !== p() || drawn.lang !== getLanguage()) {
      if (drawn.profiles !== p()) { // Ordnerliste neu, wenn profiles() neu kam; die Wahl bleibt, solange es den Ordner gibt
        const keep = folder.value;
        folderOptions(folder, listFolders(p().items));
        folder.value = [...folder.options].some((o) => o.value === keep) ? keep : '';
      }
      drawn = { profiles: p(), lang: getLanguage() };
      view.render(rows());
      dragger.refresh(); // die Ziele des Ziehens sind vielleicht eben gekommen
    }
    setAttr(treeBox, 'aria-label', t('ui.profiles'));

    const titles = { session: t('ui.profileSession'), 'factory-folder': t('ui.profileFactory'), mine: t('ui.profileMine') };
    setText(title, titles[s.kind] ?? (s.kind === 'factory' ? t(`style.${s.styleId}`) : s.node.name));
    const own = s.kind === 'profile' || s.kind === 'folder';
    const folderish = s.kind === 'folder' || s.kind === 'mine';
    const infoText = s.kind === 'factory' ? t('ui.profileFactoryInfo')
      : s.kind === 'profile' ? contentsLine(s.node.parts, t)
        : folderish ? folderLine(p().counts, t) : '';
    setText(info, infoText);
    show(info, infoText !== '');
    show(sessionBox, s.kind === 'session');
    show(actions, s.kind === 'factory' || s.kind === 'profile');
    show(factoryCopy, s.kind === 'factory');
    show(overwrite, s.kind === 'profile');
    show(manage, own || folderish);
    show(subfolder, folderish);
    show(rename, own);
    show(moveButton, own && p().targets.length > 0);
    show(del, own);
    show(overwriteBox, mode === 'overwrite');
    show(renameForm.form, mode === 'rename');
    show(subfolderForm.form, mode === 'subfolder');
    show(moveForm.form, mode === 'move');
    show(confirmBox, mode === 'confirm');
    for (const [b, m] of [[overwrite, 'overwrite'], [rename, 'rename'], [subfolder, 'subfolder'], [moveButton, 'move']]) setAttr(b, 'aria-expanded', String(mode === m));
    show(exchange, s.kind !== 'factory-folder');
    show(importBox, s.kind === 'session' || folderish);
    show(undoButton, p().undo);

    const { track, scale, style } = session.state;
    // "A-Moll-Pentatonik · 100 bpm · Stil: Funk-Rock"
    setText(sessionSummary, t('ui.profileSessionSummary', { key: t('ui.keyScale', { root: track.key.root, scale: t(`scale.${scale}`) }), bpm: track.bpm, style: t(`style.${style}`) }));
    setText(saveLabel, t('ui.profileSaveAs'));
    setText(nameLabel, t('ui.profileName'));
    setText(folderLabel, t('ui.profileFolder'));
    setText(folder.options[0], t('ui.profileMine'));
    const noForm = track.form ? [] : ['form'];
    picker.setUnavailable(noForm);
    overwritePicker.setUnavailable(noForm, { recheck: false });
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
    if (mode === 'confirm') setText(ask, deleteQuestion(p().counts, t));
    setText(yes, t('ui.profileDeleteYes'));
    setText(no, t('ui.profileCancel'));
    setText(exchangeLabel, t('ui.profileExchange'));
    setText(file, t(folderish ? 'ui.profileFolderFile' : 'ui.profileFile'));
    setText(copy, t(folderish ? 'ui.profileFolderCopy' : 'ui.profileCopy'));
    setText(textLabel, t(s.kind === 'session' || folderish ? 'ui.profileTextAny' : 'ui.profileText'));
    setText(importText, t(folderish ? 'ui.profileImportInto' : 'ui.profileImportText'));
    setText(pickLabel, t('ui.profileImportFile'));
    const problem = session.state.storage.profiles;
    show(storage, Boolean(problem));
    setText(storage, problem ? t(`ui.storage.profiles.${problem}`, { version: session.state.storage.profilesVersion }) : '');
    show(storageRow, problem === 'unreadable');
    setText(reload, t('ui.profileReload'));
    setText(status, local ? t(local) : messageText(p().message));
    setText(undoButton, t('ui.profileUndo'));
    setText(backup, t('ui.profileBackup'));
  }
  return render;
}
