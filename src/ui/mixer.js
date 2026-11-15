// Mischpult der Spielseite (Rack-Modul): je Schicht ein Kanal mit senkrechtem Fader (0..100 %), LED-Pegelanzeige daneben, Pan-Knopf und
// Stummtaste; rechts der Gesamtkanal (Fader und Pegelanzeige). Der Schalter "Alle Samples" sitzt im Modul Gesamtklang (#master-voices)
// neben den Gesamt-Klangknöpfen (#mixer-master, baut timbre-panel.js).
// Die Taste ist der einzige Schalter für Stumm (state.track.layers, toggleLayer aus app.js); die Spurnamen am Verlauf zeigen den Zustand nur an.
import { t } from '../index.js';
import { $, LAYERS, state, layoutStorage, pressed, setText, setAttr } from './state.js';
import { saveMix, DEFAULT_PAN } from './mix-state.js';
import { createKnob } from './knob.js';
import { voiceKind } from '../core/voices.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

const SEGMENTS = 23; // LEDs der Pegelanzeige (6 px je LED bei 138 px Faderhöhe)
const FLOOR_DB = -42; // unterste LED
const FALL = 0.03; // Rücklauf je Bild (Anteil der Skala): die Anzeige fällt weich, steigt sofort

export function initMixer({ render, player, toggleLayer, chooseAll }) {
  const channels = {};
  const host = $('mixer');
  const strip = el('div', { className: 'mix-master' });
  const save = () => saveMix(layoutStorage, state.mix, state.pan);

  function channel(name) {
    const ch = el('div', { className: 'mix-ch' });
    const label = el('label', { htmlFor: `mix-${name}`, className: 'lbl' });
    label.dataset.i18n = name === 'master' ? 'ui.mixMaster' : `layer.${name}`;
    // senkrecht: oben laut (writing-mode + rtl), native Tastenbedienung bleibt
    const input = el('input', { type: 'range', id: `mix-${name}`, className: 'fader', min: '0', max: '100', step: '1' });
    const meter = el('span', { className: 'meter' }); // nur Anzeige
    meter.setAttribute('aria-hidden', 'true');
    const row = el('div', { className: 'fader-row' });
    row.append(input, meter);
    const out = el('output', { htmlFor: input.id, className: 'lbl' });
    input.addEventListener('input', () => {
      const v = Number(input.value) / 100;
      state.mix = { ...state.mix, [name]: v };
      save();
      if (name === 'master') player()?.setMaster(v);
      else player()?.setLevel(name, v); // live, ohne Neustart
      render();
    });
    ch.append(label, row, out);
    let mute = null, pan = null;
    if (name !== 'master') {
      // Pan: -100 (links) .. 100 (rechts), Mitte auf 12 Uhr; Doppelklick stellt die Lage der Schicht im Standard-Panorama wieder her
      const cell = el('div', { className: 'knob-cell' });
      pan = el('input', { type: 'range', id: `pan-${name}`, min: '-100', max: '100', step: '1' });
      const caption = el('span', { className: 'lbl' });
      caption.dataset.i18n = 'ui.mixPan';
      caption.setAttribute('aria-hidden', 'true'); // der Knopf heißt "Pan <Schicht>" (aria-label)
      cell.append(pan, caption);
      ch.append(cell);
      createKnob(pan, { origin: 'center', size: 's', resetValue: Math.round(DEFAULT_PAN[name] * 100) });
      pan.addEventListener('input', () => {
        const v = Number(pan.value) / 100;
        state.pan = { ...state.pan, [name]: v };
        save();
        player()?.setPan(name, v); // live, ohne Neustart
        render();
      });
      mute = el('button', { type: 'button', className: 'chip mute-key' });
      mute.dataset.mute = name;
      mute.dataset.i18n = 'ui.mixMute';
      mute.addEventListener('click', () => { toggleLayer(name); render(); });
      ch.append(mute);
    }
    channels[name] = { input, out, mute, pan, meter, shown: 0, lit: -1 };
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
  $('master-voices').append(all);
  strip.append(channel('master'));
  host.append(...LAYERS.map(channel), strip);

  // Pegelanzeigen: eigene Bildschleife (nicht über render(), das je Takt läuft). Gemessen wird nur bei laufender Wiedergabe und sichtbarem
  // Mixer; sonst laufen die Anzeigen auf null zurück. Geschrieben wird nur, wenn sich die Zahl der leuchtenden LEDs ändert.
  function tick() {
    const p = host.checkVisibility() ? player() : null;
    for (const [name, ch] of Object.entries(channels)) {
      const peak = p ? p.level(name) : 0;
      const target = peak > 0 ? Math.min(1, Math.max(0, 1 - (20 * Math.log10(peak)) / FLOOR_DB)) : 0;
      ch.shown = Math.max(target, ch.shown - FALL);
      const lit = Math.round(ch.shown * SEGMENTS);
      if (lit !== ch.lit) { ch.lit = lit; ch.meter.style.setProperty('--level', String(lit / SEGMENTS)); }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return function renderMixer() {
    for (const [name, { input, out, mute, pan }] of Object.entries(channels)) {
      const percent = String(Math.round(state.mix[name] * 100));
      // nur bei Änderung: ein gerade gezogener Fader soll nicht neu gesetzt werden
      if (input.value !== percent) input.value = percent;
      const text = t('ui.percent', { n: percent });
      setText(out, text);
      setAttr(input, 'aria-valuetext', text);
      if (!mute) continue;
      pressed(mute, !state.track.layers[name]); // gedrückt = stumm (umgekehrt zum Spurnamen: data-muted)
      const layer = t(`layer.${name}`);
      setAttr(mute, 'aria-label', t('ui.mixLayerMute', { layer }));
      const side = Math.round(state.pan[name] * 100);
      if (pan.value !== String(side)) pan.value = String(side);
      setAttr(pan, 'aria-label', t('ui.mixLayerPan', { layer }));
      const where = side === 0 ? t('ui.panCenter') : t(side < 0 ? 'ui.panLeft' : 'ui.panRight', { n: Math.abs(side) });
      setAttr(pan, 'aria-valuetext', where);
      setAttr(pan.closest('.knob-cell'), 'data-hint', where); // Anzeige über dem Knopf beim Überfahren
    }
    const kind = voiceKind(state.track.voices);
    setAttr(all, 'aria-pressed', kind === 'mixed' ? 'mixed' : String(kind === 'sample'));
    all.dataset.state = kind;
    setText(shown, t(`ui.allVoices.${kind}`));
  };
}
