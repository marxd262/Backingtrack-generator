// Akkordfolge bearbeiten: Klick auf einen Akkord der Folge entfernt ihn (nie leer), die Akkord-Knöpfe der Tonart
// (Tastatur-Gegenstück zum Rad) fügen an (höchstens MAX_CHORDS). Eigene Folge gilt bis Tonart, Skala oder Variante.
import { allowedChords } from '../core/music.js';
import { t } from '../index.js';
import { $, state, chordName, MAX_CHORDS } from './state.js';

export function addChord(chord) {
  if (state.track.bars.length >= MAX_CHORDS) {
    state.notice = 'ui.progressionFull';
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

// changed(): nach einer Änderung (Neustart falls nötig, neu rendern)
export function initProgressionEditor(changed) {
  const row = $('progression');
  const add = $('add-chords');
  let addKey = '';

  // Knöpfe werden wiederverwendet, damit der Fokus beim Rendern je Takt nicht verloren geht
  function renderProgression() {
    const { bars } = state.track;
    while (row.children.length < bars.length) {
      const b = button(() => {
        const i = [...row.children].indexOf(b);
        if (!removeChord(i)) return;
        changed();
        // war der entfernte Knopf der letzte, wandert der Fokus auf den neuen letzten
        if (!row.contains(document.activeElement)) row.children[Math.min(i, row.children.length - 1)].focus();
      });
      row.append(b);
    }
    while (row.children.length > bars.length) row.lastChild.remove();
    const now = state.current ? state.current.bar % bars.length : -1;
    bars.forEach(({ chord }, i) => {
      const b = row.children[i];
      b.textContent = chordName(chord);
      b.setAttribute('aria-label', t('ui.removeChord', { chord: chordName(chord) }));
      b.disabled = bars.length === 1;
      if (i === now) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });

    const key = JSON.stringify(state.track.key);
    if (key !== addKey) {
      addKey = key;
      add.replaceChildren(...allowedChords(state.track.key).map((chord) => {
        const b = button(() => { addChord(chord); changed(); });
        b.textContent = chordName(chord);
        b.dataset.chord = chordName(chord);
        return b;
      }));
    }
    for (const b of add.children) b.setAttribute('aria-label', t('ui.addChordNamed', { chord: b.dataset.chord }));
    $('tuning-message').textContent = state.notice ? t(state.notice, { max: MAX_CHORDS }) : '';
  }
  return renderProgression;
}
