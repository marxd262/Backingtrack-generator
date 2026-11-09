// Akkordfarbe in der Gruppe "Akkordfolge": eine Einstellung (state.chordColor), die die aktuelle Folge umfärbt und für neu erzeugte
// Folgen (Tonart, Skala, Variante) gilt. Von Hand Angefügtes bleibt, bis die Farbe erneut gewählt oder die Folge neu erzeugt wird.
import { $, state, pressed, deriveBars, derivedBars } from './state.js';
import { CHORD_COLORS, colorProgression } from '../core/harmony.js';

// changed(): nach einer Änderung der Folge (Neustart falls nötig, neu rendern)
export function initChordColor({ changed }) {
  const box = $('chord-color');
  for (const color of CHORD_COLORS) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' });
    b.dataset.color = color;
    b.dataset.i18n = `chordColor.${color}`;
    b.addEventListener('click', () => {
      // unveränderte erzeugte Folge: in der neuen Farbe neu ableiten (so geht über Powerchords die Dominante nicht verloren,
      // E5 verrät nicht mehr, ob es die Moll-Stufe oder die Dominante war); eine von Hand geänderte Folge wird umgefärbt
      const untouched = JSON.stringify(state.track.bars) === JSON.stringify(derivedBars(state.chordColor));
      state.chordColor = color;
      if (untouched) deriveBars();
      else state.track.bars = colorProgression(state.track.bars, color, state.track.key);
      state.notice = null;
      changed();
    });
    box.append(b);
  }
  return function renderChordColor() {
    for (const b of box.children) pressed(b, b.dataset.color === state.chordColor);
  };
}
