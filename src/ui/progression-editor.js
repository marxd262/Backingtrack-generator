// Akkordfolge bearbeiten: Klick auf einen Akkord der Folge entfernt ihn (nie leer); die zweistufige Auswahl (erst ein Grundton der
// Tonart, dann eine Akkordart, Tastatur-Gegenstück zum Rad) fügt an (höchstens MAX_CHORDS). Eigene Folge gilt bis Tonart, Skala oder Variante.
import { chordOptions } from '../core/music.js';
import { CHORDS, CHORD_GROUPS, chordName } from '../core/chords.js';
import { METERS, meterKey } from '../core/grooves.js';
import { t } from '../index.js';
import { $, state, setText, setAttr, pressed, MAX_CHORDS } from './state.js';

let refusals = 0; // zählt Ablehnungen, damit eine wiederholte Ablehnung erneut angesagt wird

export function addChord(chord) {
  if (state.track.bars.length >= MAX_CHORDS) {
    state.notice = 'ui.progressionFull';
    refusals++;
    return false;
  }
  state.track.bars.push({ chord: { ...chord }, beats: METERS[meterKey(state.track.meter)].beats });
  state.notice = null;
  return true;
}

function removeChord(i) {
  if (state.track.bars.length <= 1) return false;
  state.track.bars.splice(i, 1);
  state.notice = null;
  return true;
}

const button = (onClick) => {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' });
  b.addEventListener('click', onClick);
  return b;
};

// changed(): nach einer Änderung (Neustart falls nötig, neu rendern); render(): nur neu zeichnen (Ablehnung)
export function initProgressionEditor(changed, render) {
  const row = $('progression');
  const rootsBox = $('add-roots');
  const region = $('tuning-message');
  let addKey = '';
  let options = []; // chordOptions der gewählten Tonart
  let picked = ''; // gewählter Grundton
  // Chips der Akkordarten einmal bauen (alle des Registers, je Gruppe eine einklappbare Reihe; der Offen-Zustand steht im Layout,
  // app.js bindet ihn über initGroups); beim Rendern wechseln nur Text und Aktivierung
  const qualityChips = [];
  for (const group of CHORD_GROUPS) {
    const details = Object.assign(document.createElement('details'), { className: 'group' });
    details.dataset.group = group;
    const summary = document.createElement('summary');
    summary.dataset.i18n = `chordGroup.${group}`;
    const chips = Object.assign(document.createElement('div'), { className: 'chips' });
    for (const quality of Object.keys(CHORDS).filter((id) => CHORDS[id].group === group)) {
      const b = button(() => (addChord({ root: picked, quality }) ? changed() : render()));
      b.dataset.quality = quality;
      chips.append(b);
      qualityChips.push(b);
    }
    details.append(summary, chips);
    $('add-qualities').append(details);
  }
  let shown = { text: '', refusals: 0 };

  // Live-Region nur bei Änderung schreiben; gleiche Meldung erneut: leeren und im nächsten Frame wieder setzen
  function announce(text) {
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
    const { bars } = state.track;
    while (row.children.length < bars.length) {
      const b = button(() => {
        const i = [...row.children].indexOf(b);
        if (!removeChord(i)) return;
        changed();
        // nur noch ein (gesperrter) Akkord: Fokus auf den ersten aktiven Chip der Akkordart; sonst bleibt er an derselben
        // Stelle (nächster Akkord), war der entfernte Knopf der letzte, auf dem neuen letzten
        if (row.children.length === 1) qualityChips.find((c) => !c.disabled)?.focus();
        else if (!row.contains(document.activeElement)) row.children[Math.min(i, row.children.length - 1)].focus();
      });
      row.append(b);
    }
    while (row.children.length > bars.length) row.lastChild.remove();
    const now = state.current ? state.current.bar % bars.length : -1;
    bars.forEach(({ chord }, i) => {
      const b = row.children[i];
      setText(b, chordName(chord));
      setAttr(b, 'aria-label', t('ui.removeChord', { chord: chordName(chord) }));
      if (b.disabled !== (bars.length === 1)) b.disabled = bars.length === 1;
      if (i === now) setAttr(b, 'aria-current', 'true');
      else b.removeAttribute('aria-current');
    });

    // Grundtöne der Tonart; bei neuer Tonart wieder der erste gewählt
    const key = JSON.stringify(state.track.key);
    if (key !== addKey) {
      addKey = key;
      options = chordOptions(state.track.key);
      picked = options[0].root;
      rootsBox.replaceChildren(...options.map(({ root }) => {
        const b = button(() => { picked = root; render(); });
        b.textContent = root;
        b.dataset.root = root;
        return b;
      }));
    }
    for (const b of rootsBox.children) pressed(b, b.dataset.root === picked);
    // Akkordarten für den gewählten Grundton: Name mit dem Grundton, nur erlaubte aktiv
    const allowed = options.find((o) => o.root === picked)?.qualities ?? [];
    for (const b of qualityChips) {
      const name = chordName({ root: picked, quality: b.dataset.quality });
      setText(b, name);
      // Hilfetext und zugänglicher Name nennen die Art (Mollseptakkord), damit man das Symbol nicht lesen können muss
      const kind = t(`chord.${b.dataset.quality}`);
      setAttr(b, 'title', kind);
      setAttr(b, 'aria-label', t('ui.addChordKind', { chord: name, kind }));
      const off = !allowed.includes(b.dataset.quality);
      if (b.disabled !== off) b.disabled = off;
    }
    announce(state.notice ? t(state.notice, { max: MAX_CHORDS }) : '');
  }
  return renderProgression;
}
