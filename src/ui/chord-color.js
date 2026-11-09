// Akkordfarbe in der Gruppe "Akkordfolge": eine Einstellung (state.chordColor), die die aktuelle Folge umfärbt und für neu erzeugte
// Folgen (Tonart, Skala, Variante) gilt. Von Hand Angefügtes bleibt, bis die Farbe erneut gewählt oder die Folge neu erzeugt wird.
import { $, state, pressed, setChordColor } from './state.js';
import { CHORD_COLORS } from '../core/harmony.js';

// changed(): nach einer Änderung der Folge (Neustart falls nötig, neu rendern)
export function initChordColor({ changed }) {
  const box = $('chord-color');
  for (const color of CHORD_COLORS) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' });
    b.dataset.color = color;
    b.dataset.i18n = `chordColor.${color}`;
    b.addEventListener('click', () => {
      state.chordColorFromStyle = false; // vom Nutzer gewählt: folgt nicht mehr dem Stil
      setChordColor(color);
      changed();
    });
    box.append(b);
  }
  return function renderChordColor() {
    for (const b of box.children) pressed(b, b.dataset.color === state.chordColor);
  };
}
