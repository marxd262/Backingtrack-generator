// Inhalt beim Speichern wählen: die Teile (tables().PART_IDS) als Kontrollkästchen mit Name und Erklärung in einer eingeklappten Zeile
// "Inhalt: …", dazu die Schnellwahlen aus tables().PART_PRESETS. Bleibt eingeklappt, bis der Nutzer sie öffnet.
// Dazu die reinen Textzeilen des Profil-Fensters über Inhalt und Ordner (aus profiles(): die Teile eines Profils, counts eines Ordners).
import { session } from './session.js';
import { setText } from './dom.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/** Text der eingeklappten Zeile: "Inhalt: Alles" oder "Inhalt: n von 10". */
export const partsSummary = (ids, t) => {
  const total = session.tables.PART_IDS.length;
  return ids.length === total ? t('ui.partsAll') : t('ui.partsCount', { n: ids.length, total });
};

/** Zeile eines gespeicherten Profils: "Inhalt: Tempo, Klangregler" (seine Teil-ids, schon in der Reihenfolge von PART_IDS). */
export const contentsLine = (parts, t) => t('ui.profileContents', { parts: parts.map((id) => t(`part.${id}`)).join(', ') });

/** Text mit Zahl n: Schlüssel.one für genau 1, sonst der Schlüssel; params füllen weitere Platzhalter. */
export const count = (t, key, n, params = {}) => t(n === 1 ? `${key}.one` : key, { ...params, n });

/** "n Profile, m Unterordner" (alles im Ordner, auch tief: profiles().counts). */
export const folderLine = (counts, t) => t('ui.profileFolderLine', { profiles: count(t, 'ui.profileCountProfiles', counts.profiles), folders: count(t, 'ui.profileCountFolders', counts.folders) });

/** Rückfrage vor dem Löschen eines nicht leeren Ordners. */
export const deleteQuestion = (counts, t) => count(t, 'ui.profileDeleteAsk', counts.profiles + counts.folders);

export function createPartsPicker({ idPrefix, t }) {
  const { PART_IDS, PART_PRESETS } = session.tables;
  const element = el('details', { className: 'profile-parts', id: idPrefix });
  const summary = el('summary');
  const list = el('div', { className: 'profile-part-list' });
  const rows = PART_IDS.map((id) => {
    const box = el('input', { type: 'checkbox', id: `${idPrefix}-${id}`, checked: true });
    const name = el('span');
    const label = el('label'); // umschließt das Kästchen: die ganze Zeile ist die Trefferfläche
    label.append(box, name);
    const hint = el('span', { className: 'hint', id: `${box.id}-hint` });
    box.setAttribute('aria-describedby', hint.id); // Name bleibt kurz, die Erklärung kommt als Beschreibung
    const row = el('div', { className: 'profile-part' });
    row.append(label, hint);
    list.append(row);
    return { id, box, name, hint };
  });
  const presets = el('div', { className: 'chips' });
  const buttons = Object.keys(PART_PRESETS).map((key) => {
    const b = el('button', { type: 'button', className: 'chip' });
    b.dataset.preset = key;
    b.addEventListener('click', () => { setIds(PART_PRESETS[key]); render(); });
    presets.append(b);
    return b;
  });
  element.append(summary, list, presets);
  list.addEventListener('change', () => render());

  const getIds = () => rows.filter((r) => r.box.checked).map((r) => r.id);
  function setIds(ids) {
    for (const r of rows) r.box.checked = ids.includes(r.id) && !r.box.disabled;
  }
  // Teile, die die Sitzung gerade nicht hat (Songform bei "Ohne Form"), sind nicht angehakt und gesperrt; mit `recheck` kehren sie angehakt zurück
  // (Speichern), sonst bleiben sie frei und ungehakt (Überschreiben: die Haken kommen aus dem Profil und ändern sich nicht von allein)
  function setUnavailable(ids, { recheck = true } = {}) {
    for (const r of rows) {
      const gone = ids.includes(r.id);
      if (r.box.disabled === gone) continue;
      r.box.disabled = gone;
      r.box.checked = gone ? false : recheck;
    }
  }
  function render() {
    setText(summary, partsSummary(getIds(), t));
    for (const r of rows) {
      setText(r.name, t(`part.${r.id}`));
      setText(r.hint, t(`part.${r.id}.hint`));
    }
    for (const b of buttons) setText(b, t(`ui.partsPreset.${b.dataset.preset}`));
  }
  return { element, getIds, setIds, setUnavailable, render };
}
