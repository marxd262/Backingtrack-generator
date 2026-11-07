// Tonart- und Skala-Chips; zweimal gebaut (Popover der Startseite, rechte Leiste), beide auf demselben Zustand.
import { SCALE_NAMES } from '../core/music.js';
import { t } from '../index.js';
import { ROOTS, SCALE_MODE, state, pressed, setText, deriveBars } from './state.js';

export function buildKeyScale({ keyChips, scaleChips }, { restartIfPlaying, render }) {
  const chip = (parent, data, onClick) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' });
    Object.assign(b.dataset, data);
    b.addEventListener('click', () => { onClick(); restartIfPlaying(); render(); });
    parent.append(b);
    return b;
  };

  for (const root of ROOTS) {
    chip(keyChips, { root }, () => {
      state.track.key = { root, mode: SCALE_MODE[state.scale] };
      deriveBars();
    }).textContent = root; // Tonnamen international, nicht übersetzt
  }

  for (const scale of SCALE_NAMES) {
    chip(scaleChips, { scale }, () => {
      state.scale = scale;
      state.track.key = { root: state.track.key.root, mode: SCALE_MODE[scale] };
      deriveBars();
    });
  }

  return {
    render() {
      for (const b of keyChips.children) pressed(b, b.dataset.root === state.track.key.root);
      for (const b of scaleChips.children) {
        setText(b, t(`scale.${b.dataset.scale}`));
        pressed(b, b.dataset.scale === state.scale);
      }
    },
  };
}
