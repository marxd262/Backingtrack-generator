// Mischpult der Spielseite: ein Regler je Schicht plus Gesamt (0..100 %), je Schicht eine Taste für "an"/stumm.
// Die Taste ist derselbe Zustand wie der Schichtknopf über dem Verlauf (state.track.layers, toggleLayer aus app.js).
import { t } from '../index.js';
import { $, LAYERS, state, layoutStorage, pressed, setText, setAttr } from './state.js';
import { saveMix } from './mix-state.js';

export function initMixer({ render, player, toggleLayer }) {
  const rows = {};
  for (const name of ['master', ...LAYERS]) {
    const row = Object.assign(document.createElement('div'), { className: 'mix-row' });
    const label = Object.assign(document.createElement('label'), { htmlFor: `mix-${name}` });
    label.dataset.i18n = name === 'master' ? 'ui.mixMaster' : `layer.${name}`;
    const input = Object.assign(document.createElement('input'), { type: 'range', id: `mix-${name}`, min: '0', max: '100', step: '1' });
    const out = Object.assign(document.createElement('output'), { htmlFor: input.id });
    input.addEventListener('input', () => {
      const v = Number(input.value) / 100;
      state.mix = { ...state.mix, [name]: v };
      saveMix(layoutStorage, state.mix);
      if (name === 'master') player()?.setMaster(v);
      else player()?.setLevel(name, v); // live, ohne Neustart
      render();
    });
    row.append(label, input, out);
    let mute = null;
    if (name !== 'master') {
      mute = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' });
      mute.dataset.i18n = 'ui.mixOn';
      mute.addEventListener('click', () => { toggleLayer(name); render(); });
      row.append(mute);
    }
    rows[name] = { input, out, mute };
    $('mixer').append(row);
  }

  return function renderMixer() {
    for (const [name, { input, out, mute }] of Object.entries(rows)) {
      const percent = String(Math.round(state.mix[name] * 100));
      // nur bei Änderung: ein gerade gezogener Regler soll nicht neu gesetzt werden
      if (input.value !== percent) input.value = percent;
      const shown = t('ui.percent', { n: percent });
      setText(out, shown);
      setAttr(input, 'aria-valuetext', shown);
      if (mute) {
        pressed(mute, state.track.layers[name]);
        setAttr(mute, 'aria-label', t('ui.mixLayerOn', { layer: t(`layer.${name}`) }));
      }
    }
  };
}
