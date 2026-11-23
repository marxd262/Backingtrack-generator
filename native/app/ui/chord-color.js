// Akkordfarbe in der Gruppe "Akkordfolge": eine Einstellung (state().chordColor), die die aktuelle Folge umfärbt und für neu erzeugte
// Folgen (Tonart, Skala, Variante) gilt; die Regel steht in der Sitzung (Aktion setChordColor).
import { session, send } from './session.js';
import { $, pressed } from './dom.js';

export function initChordColor() {
  const box = $('chord-color');
  for (const color of session.tables.CHORD_COLORS) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' });
    b.dataset.color = color;
    b.dataset.i18n = `chordColor.${color}`;
    b.addEventListener('click', () => send({ action: 'setChordColor', color }));
    box.append(b);
  }
  return function renderChordColor() {
    for (const b of box.children) pressed(b, b.dataset.color === session.state.chordColor);
  };
}
