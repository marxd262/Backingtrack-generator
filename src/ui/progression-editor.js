// Akkordfolge bearbeiten: Klick auf einen Akkord der Folge entfernt ihn (nie leer), die Akkord-Knöpfe der Tonart
// (Tastatur-Gegenstück zum Rad) fügen an (höchstens MAX_CHORDS). Eigene Folge gilt bis Tonart, Skala oder Variante.
import { allowedChords } from '../core/music.js';
import { t } from '../index.js';
import { $, state, chordName, setText, setAttr, MAX_CHORDS } from './state.js';

let refusals = 0; // zählt Ablehnungen, damit eine wiederholte Ablehnung erneut angesagt wird

export function addChord(chord) {
  if (state.track.bars.length >= MAX_CHORDS) {
    state.notice = 'ui.progressionFull';
    refusals++;
    return false;
  }
  state.track.bars.push({ chord: { ...chord }, beats: 4 });
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
  const add = $('add-chords');
  const region = $('tuning-message');
  let addKey = '';
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
        // nur noch ein (gesperrter) Akkord: Fokus auf den ersten Anfüge-Knopf; sonst bleibt er an derselben
        // Stelle (nächster Akkord), war der entfernte Knopf der letzte, auf dem neuen letzten
        if (row.children.length === 1) add.firstElementChild?.focus();
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

    const key = JSON.stringify(state.track.key);
    if (key !== addKey) {
      addKey = key;
      add.replaceChildren(...allowedChords(state.track.key).map((chord) => {
        const b = button(() => (addChord(chord) ? changed() : render()));
        b.textContent = chordName(chord);
        b.dataset.chord = chordName(chord);
        return b;
      }));
    }
    for (const b of add.children) setAttr(b, 'aria-label', t('ui.addChordNamed', { chord: b.dataset.chord }));
    announce(state.notice ? t(state.notice, { max: MAX_CHORDS }) : '');
  }
  return renderProgression;
}
