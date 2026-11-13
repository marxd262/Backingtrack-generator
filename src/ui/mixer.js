// Mischpult der Spielseite (Rack-Modul): je Schicht ein Kanal mit senkrechtem Fader (0..100 %) und Stummtaste, rechts der Gesamtkanal
// mit dem Schalter "Alle Samples", den Gesamt-Klangknöpfen (#mixer-master, baut timbre-panel.js) und dem Gesamtfader.
// Die Taste ist der einzige Schalter für Stumm (state.track.layers, toggleLayer aus app.js); die Spurnamen am Verlauf zeigen den Zustand nur an.
import { t } from '../index.js';
import { $, LAYERS, state, layoutStorage, pressed, setText, setAttr } from './state.js';
import { saveMix } from './mix-state.js';
import { voiceKind } from '../core/voices.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

export function initMixer({ render, player, toggleLayer, chooseAll }) {
  const channels = {};
  const host = $('mixer');
  const strip = el('div', { className: 'mix-master' });

  function channel(name) {
    const ch = el('div', { className: 'mix-ch' });
    const label = el('label', { htmlFor: `mix-${name}`, className: 'lbl' });
    label.dataset.i18n = name === 'master' ? 'ui.mixMaster' : `layer.${name}`;
    // senkrecht: oben laut (writing-mode + rtl), native Tastenbedienung bleibt
    const input = el('input', { type: 'range', id: `mix-${name}`, className: 'fader', min: '0', max: '100', step: '1' });
    const out = el('output', { htmlFor: input.id, className: 'lbl' });
    input.addEventListener('input', () => {
      const v = Number(input.value) / 100;
      state.mix = { ...state.mix, [name]: v };
      saveMix(layoutStorage, state.mix);
      if (name === 'master') player()?.setMaster(v);
      else player()?.setLevel(name, v); // live, ohne Neustart
      render();
    });
    ch.append(label, input, out);
    let mute = null;
    if (name !== 'master') {
      mute = el('button', { type: 'button', className: 'chip mute-key' });
      mute.dataset.mute = name;
      mute.dataset.i18n = 'ui.mixMute';
      mute.addEventListener('click', () => { toggleLayer(name); render(); });
      ch.append(mute);
    }
    channels[name] = { input, out, mute };
    return ch;
  }

  // Taste mit aria-pressed (true/false/mixed ist dort gültig, bei role="switch" nicht); sichtbare Beschriftung = Name
  const all = el('button', { type: 'button', id: 'all-voices', className: 'all-voices' });
  all.dataset.i18nLabel = 'ui.allVoices';
  const caption = el('span', { className: 'lbl' });
  caption.dataset.i18n = 'ui.allVoices';
  const track = el('span', { className: 'mode-track' });
  const shown = el('span', { className: 'lcd' });
  all.append(caption, track, shown);
  all.addEventListener('click', () => chooseAll(voiceKind(state.track.voices) === 'sample' ? 'synth' : 'sample')); // chooseAll zeichnet neu
  const left = el('div', { className: 'mix-master-left' });
  left.append(all, $('mixer-master'));
  strip.append(left, channel('master'));
  host.append(...LAYERS.map(channel), strip);

  return function renderMixer() {
    for (const [name, { input, out, mute }] of Object.entries(channels)) {
      const percent = String(Math.round(state.mix[name] * 100));
      // nur bei Änderung: ein gerade gezogener Fader soll nicht neu gesetzt werden
      if (input.value !== percent) input.value = percent;
      const text = t('ui.percent', { n: percent });
      setText(out, text);
      setAttr(input, 'aria-valuetext', text);
      if (mute) {
        pressed(mute, !state.track.layers[name]); // gedrückt = stumm (umgekehrt zum Spurnamen: data-muted)
        setAttr(mute, 'aria-label', t('ui.mixLayerMute', { layer: t(`layer.${name}`) }));
      }
    }
    const kind = voiceKind(state.track.voices);
    setAttr(all, 'aria-pressed', kind === 'mixed' ? 'mixed' : String(kind === 'sample'));
    all.dataset.state = kind;
    setText(shown, t(`ui.allVoices.${kind}`));
  };
}
