// Tonart und Skala: die Chips der Startseite (Popover) und die LCD-Auswahlen im Modul Harmonie; beide schicken setRoot und setScale, die
// Chips mit from "start" (die Sitzung merkt, dass der Nutzer die Tonart gewählt hat), die Auswahlen mit from "play".
import { t } from './i18n/index.js';
import { session, send, holds } from './session.js';
import { pressed, setText } from './dom.js';
import { createLcdSelect } from './lcd-select.js';

const el = (tag, props) => Object.assign(document.createElement(tag), props);

// Chips der Startseite
export function buildKeyScale({ keyChips, scaleChips }) {
  const chip = (parent, data, action) => {
    const b = el('button', { type: 'button', className: 'chip' });
    Object.assign(b.dataset, data);
    b.addEventListener('click', () => send({ ...action, from: 'start' }));
    parent.append(b);
    return b;
  };
  const { ROOTS, SCALE_NAMES } = session.tables;
  for (const root of ROOTS) chip(keyChips, { root }, { action: 'setRoot', root }).textContent = root; // Tonnamen international, nicht übersetzt
  for (const scale of SCALE_NAMES) chip(scaleChips, { scale }, { action: 'setScale', scale });

  return {
    render() {
      const { track, scale } = session.state;
      for (const b of keyChips.children) pressed(b, b.dataset.root === track.key.root);
      for (const b of scaleChips.children) {
        setText(b, t(`scale.${b.dataset.scale}`));
        pressed(b, b.dataset.scale === scale);
      }
    },
  };
}

// LCD-Auswahlen im Modul Harmonie (#key-select, #scale-select); die Einträge der Skala übersetzt data-i18n in render()
export function buildKeyScaleSelects({ keySelect, scaleSelect }) {
  const { ROOTS, SCALE_NAMES } = session.tables;
  for (const root of ROOTS) keySelect.append(el('option', { value: root, textContent: root }));
  for (const scale of SCALE_NAMES) {
    const o = el('option', { value: scale });
    o.dataset.i18n = `scale.${scale}`;
    scaleSelect.append(o);
  }
  for (const select of [keySelect, scaleSelect]) createLcdSelect(select, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
  keySelect.addEventListener('change', () => send({ action: 'setRoot', root: keySelect.value, from: 'play' }, keySelect));
  scaleSelect.addEventListener('change', () => send({ action: 'setScale', scale: scaleSelect.value, from: 'play' }, scaleSelect));
  return {
    render() {
      const { track, scale } = session.state;
      if (!holds(keySelect) && keySelect.value !== track.key.root) keySelect.value = track.key.root;
      if (!holds(scaleSelect) && scaleSelect.value !== scale) scaleSelect.value = scale;
    },
  };
}
