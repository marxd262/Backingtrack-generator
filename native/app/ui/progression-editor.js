// Akkordfolge bearbeiten: Klick auf einen Akkord der Folge entfernt ihn (nie leer); die zweistufige Auswahl (erst ein Grundton der
// Tonart, dann eine Akkordart, Tastatur-Gegenstück zum Rad) fügt an. Die Folge mit Namen, Stufen und Rollen gibt position(), die Akkordarten
// je Grundton derived(), den Hinweis "Folge voll" und die Zahl der Ablehnungen state(); die Regeln stehen in der Sitzung (addChord, removeChord).
import { t } from './i18n/index.js';
import { session, send } from './session.js';
import { $, setText, setAttr, pressed } from './dom.js';

// shortcut: the 8 the notice names is MAX_CHORDS of the web (state.js), a rule of the session no text gives, upgrade: when state() or tables() gives it
const MAX_CHORDS = 8;

const button = (onClick) => {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' });
  b.addEventListener('click', onClick);
  return b;
};

// current(): die Wiedergabe hat einen Takt erreicht (aria-current nur dann)
export function initProgressionEditor({ current }) {
  const { CHORD_GROUPS, CHORDS } = session.tables;
  const row = $('progression');
  const rootsBox = $('add-roots');
  const region = $('tuning-message');
  let addKey = '';
  let picked = ''; // gewählter Grundton
  let removed = null; // { at, length }: ein entfernter Akkord, bis die Folge ohne ihn da ist (dann der Fokus)
  // Chips der Akkordarten einmal bauen (alle des Registers, je Gruppe eine Reihe; app.js hält die Gruppen offen);
  // beim Rendern wechseln nur Text und Aktivierung
  const qualityChips = [];
  for (const group of CHORD_GROUPS) {
    const details = Object.assign(document.createElement('details'), { className: 'group' });
    details.dataset.group = group;
    const summary = document.createElement('summary');
    summary.dataset.i18n = `chordGroup.${group}`;
    const chips = Object.assign(document.createElement('div'), { className: 'chips' });
    for (const quality of Object.keys(CHORDS).filter((id) => CHORDS[id].group === group)) {
      const b = button(() => send({ action: 'addChord', root: picked, quality }));
      b.dataset.quality = quality;
      chips.append(b);
      qualityChips.push(b);
    }
    details.append(summary, chips);
    $('add-qualities').append(details);
  }
  let shown = { text: '', refusals: 0 };

  // Live-Region nur bei Änderung schreiben; gleiche Meldung erneut (state().refusals zählt weiter): leeren und im nächsten Frame wieder setzen
  function announce(text, refusals) {
    if (text === shown.text && refusals === shown.refusals) return;
    const repeat = text !== '' && text === shown.text;
    shown = { text, refusals };
    if (!repeat) {
      region.textContent = text;
      return;
    }
    region.textContent = '';
    requestAnimationFrame(() => { if (shown.text === text) region.textContent = text; });
  }

  // Knöpfe werden wiederverwendet, damit der Fokus beim Rendern je Takt nicht verloren geht
  function renderProgression() {
    const { track, notice, refusals } = session.state;
    const { progression, index } = session.position;
    while (row.children.length < progression.length) {
      const b = button(() => {
        removed = { at: [...row.children].indexOf(b), length: row.children.length - 1 };
        send({ action: 'removeChord', index: removed.at });
      });
      row.append(b);
    }
    while (row.children.length > progression.length) row.lastChild.remove();
    const now = current() ? index : -1;
    progression.forEach(({ name, degree, role }, i) => {
      const b = row.children[i];
      setText(b, name);
      setAttr(b, 'class', `chip role-${role}`); // Farbe nach Rolle
      setAttr(b, 'data-degree', degree); // Stufe darunter (CSS ::after, nicht im Namen)
      setAttr(b, 'aria-label', t('ui.removeChord', { chord: name }));
      if (b.disabled !== (progression.length === 1)) b.disabled = progression.length === 1;
      if (i === now) setAttr(b, 'aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    // die Folge ohne den entfernten Akkord ist da (position() kommt nach der Antwort): nur noch ein (gesperrter) Akkord, Fokus auf den ersten
    // aktiven Chip der Akkordart; sonst bleibt er an derselben Stelle (nächster Akkord), war der entfernte Knopf der letzte, auf dem neuen letzten
    if (removed && progression.length === removed.length && track.bars.length === removed.length) {
      if (progression.length === 1) qualityChips.find((c) => !c.disabled)?.focus();
      else if (!row.contains(document.activeElement)) row.children[Math.min(removed.at, row.children.length - 1)].focus();
      removed = null;
    }

    // Grundtöne der Tonart; bei neuer Tonart wieder der erste gewählt
    const key = JSON.stringify(track.key);
    if (key !== addKey) {
      addKey = key;
      picked = session.derived.chordOptions[0].root;
      rootsBox.replaceChildren(...session.derived.chordOptions.map(({ root }) => {
        const b = button(() => { picked = root; renderProgression(); });
        b.textContent = root;
        b.dataset.root = root;
        return b;
      }));
    }
    for (const b of rootsBox.children) pressed(b, b.dataset.root === picked);
    // Akkordarten für den gewählten Grundton: Name mit dem Grundton, nur erlaubte aktiv
    const { names, qualities: allowed } = session.derived.chordOptions.find((o) => o.root === picked);
    for (const b of qualityChips) {
      const name = names[b.dataset.quality];
      setText(b, name);
      // Hilfetext und zugänglicher Name nennen die Art (Mollseptakkord), damit man das Symbol nicht lesen können muss
      const kind = t(`chord.${b.dataset.quality}`);
      setAttr(b, 'title', kind);
      setAttr(b, 'aria-label', t('ui.addChordKind', { chord: name, kind }));
      const off = !allowed.includes(b.dataset.quality);
      if (b.disabled !== off) b.disabled = off;
    }
    announce(notice ? t(notice, { max: MAX_CHORDS }) : '', refusals);
  }
  return renderProgression;
}
