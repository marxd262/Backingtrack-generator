// Tonart und Skala: dieselben Funktionen für die Chips der Startseite (Popover) und die LCD-Auswahlen im Modul Harmonie.
import { SCALE_NAMES } from '../core/music.js';
import { t } from '../index.js';
import { ROOTS, SCALE_MODE, state, pressed, setText, deriveBars } from './state.js';
import { createLcdSelect } from './lcd-select.js';

export function chooseRoot(root) {
  state.track.key = { root, mode: SCALE_MODE[state.scale] };
  deriveBars();
}

export function chooseScale(scale) {
  state.scale = scale;
  state.track.key = { root: state.track.key.root, mode: SCALE_MODE[scale] };
  deriveBars();
}

const el = (tag, props) => Object.assign(document.createElement(tag), props);

// Chips der Startseite
export function buildKeyScale({ keyChips, scaleChips }, { restartIfPlaying, render }) {
  const chip = (parent, data, onClick) => {
    const b = el('button', { type: 'button', className: 'chip' });
    Object.assign(b.dataset, data);
    b.addEventListener('click', () => { onClick(); restartIfPlaying(); render(); });
    parent.append(b);
    return b;
  };
  for (const root of ROOTS) chip(keyChips, { root }, () => chooseRoot(root)).textContent = root; // Tonnamen international, nicht übersetzt
  for (const scale of SCALE_NAMES) chip(scaleChips, { scale }, () => chooseScale(scale));

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

// LCD-Auswahlen im Modul Harmonie (#key-select, #scale-select); die Einträge der Skala übersetzt data-i18n in render()
export function buildKeyScaleSelects({ keySelect, scaleSelect }, { restartIfPlaying, render }) {
  for (const root of ROOTS) keySelect.append(el('option', { value: root, textContent: root }));
  for (const scale of SCALE_NAMES) {
    const o = el('option', { value: scale });
    o.dataset.i18n = `scale.${scale}`;
    scaleSelect.append(o);
  }
  for (const select of [keySelect, scaleSelect]) createLcdSelect(select, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
  keySelect.addEventListener('change', () => { chooseRoot(keySelect.value); restartIfPlaying(); render(); });
  scaleSelect.addEventListener('change', () => { chooseScale(scaleSelect.value); restartIfPlaying(); render(); });
  return {
    render() {
      if (keySelect.value !== state.track.key.root) keySelect.value = state.track.key.root;
      if (scaleSelect.value !== state.scale) scaleSelect.value = state.scale;
    },
  };
}
