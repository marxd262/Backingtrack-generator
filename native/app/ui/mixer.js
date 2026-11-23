// Mischpult der Spielseite (Rack-Modul): je Schicht ein Kanal mit senkrechtem Fader (0..100 %), LED-Pegelanzeige daneben, Pan-Knopf und
// Stummtaste; rechts der Gesamtkanal (Fader und Pegelanzeige). Der Schalter "Alle Samples" sitzt im Modul Gesamtklang (#master-voices)
// neben den Gesamt-Klangknöpfen (#mixer-master, baut timbre-panel.js).
// Die Taste ist der einzige Schalter für Stumm (state().track.layers, Aktion toggleMute); die Spurnamen am Verlauf zeigen den Zustand nur an.
// Fader und Pan schicken setLevel und setPan (die Sitzung speichert das Mischpult), die Pegel kommen mit den Meldungen der Engine.
import { t } from './i18n/index.js';
import { session, send, holds } from './session.js';
import { $, pressed, setText, setAttr } from './dom.js';
import { createKnob } from './knob.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

const SEGMENTS = 23; // LEDs der Pegelanzeige (6 px je LED bei 138 px Faderhöhe)
const FLOOR_DB = -42; // unterste LED
const FALL = 0.03; // Rücklauf je Bild (Anteil der Skala): die Anzeige fällt weich, steigt sofort

export function initMixer() {
  const channels = {};
  const host = $('mixer');
  const strip = el('div', { className: 'mix-master' });
  const { LAYER_IDS, DEFAULT_PAN } = session.tables;

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
      send({ action: 'setLevel', channel: name, value: Number(input.value) }, input);
      showLevel(name); // die Anzeige folgt der Hand
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
        send({ action: 'setPan', layer: name, value: Number(pan.value) }, pan);
        showPan(name);
      });
      mute = el('button', { type: 'button', className: 'chip mute-key' });
      mute.dataset.mute = name;
      mute.dataset.i18n = 'ui.mixMute';
      mute.addEventListener('click', () => send({ action: 'toggleMute', layer: name }));
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
  all.addEventListener('click', () => send({ action: 'toggleAllVoices' }));
  $('master-voices').append(all);
  strip.append(channel('master'));
  host.append(...LAYER_IDS.map(channel), strip);
  // was mit den gespeicherten Reglern nicht stimmt (state().storage.mix, PROTOKOLL.md Abschnitt 3a): eine Zeile unter dem Mischpult
  const stored = el('p', { className: 'message', id: 'mix-storage', hidden: true });
  stored.setAttribute('role', 'status');
  host.after(stored);

  // Pegelanzeigen: eigene Bildschleife (nicht über render(), das je Antwort läuft). Gemessen wird nur bei laufender Wiedergabe und sichtbarem
  // Mixer; sonst laufen die Anzeigen auf null zurück. Geschrieben wird nur, wenn sich die Zahl der leuchtenden LEDs ändert.
  function tick() {
    const peaks = host.checkVisibility() && session.engine.playing ? session.engine.peaks : null;
    for (const [name, ch] of Object.entries(channels)) {
      const peak = peaks?.[name] ?? 0;
      const target = peak > 0 ? Math.min(1, Math.max(0, 1 - (20 * Math.log10(peak)) / FLOOR_DB)) : 0;
      ch.shown = Math.max(target, ch.shown - FALL);
      const lit = Math.round(ch.shown * SEGMENTS);
      if (lit !== ch.lit) { ch.lit = lit; ch.meter.style.setProperty('--level', String(lit / SEGMENTS)); }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Fader und Pan zeigen die Antwort der Sitzung; solange eine Bewegung unbeantwortet ist, die Hand (der Fader springt nicht zurück)
  function showLevel(name) {
    const { input, out } = channels[name];
    const percent = holds(input) ? input.value : String(Math.round(session.state.mix[name] * 100));
    if (input.value !== percent) input.value = percent;
    const text = t('ui.percent', { n: percent });
    setText(out, text);
    setAttr(input, 'aria-valuetext', text);
  }
  function showPan(name) {
    const { pan } = channels[name];
    const side = holds(pan) ? pan.value : String(Math.round(session.state.pan[name] * 100));
    if (pan.value !== side) pan.value = side;
    const n = Number(side);
    const where = n === 0 ? t('ui.panCenter') : t(n < 0 ? 'ui.panLeft' : 'ui.panRight', { n: Math.abs(n) });
    setAttr(pan, 'aria-valuetext', where);
    setAttr(pan.closest('.knob-cell'), 'data-hint', where); // Anzeige über dem Knopf beim Überfahren
  }

  return function renderMixer() {
    const { track } = session.state;
    for (const [name, { mute, pan }] of Object.entries(channels)) {
      showLevel(name);
      if (!mute) continue;
      pressed(mute, !track.layers[name]); // gedrückt = stumm (umgekehrt zum Spurnamen: data-muted)
      const layer = t(`layer.${name}`);
      setAttr(mute, 'aria-label', t('ui.mixLayerMute', { layer }));
      setAttr(pan, 'aria-label', t('ui.mixLayerPan', { layer }));
      showPan(name);
    }
    const kind = session.derived.voiceKind;
    setAttr(all, 'aria-pressed', kind === 'mixed' ? 'mixed' : String(kind === 'sample'));
    all.dataset.state = kind;
    setText(shown, t(`ui.allVoices.${kind}`));
    const problem = session.state.storage.mix;
    if (stored.hidden === Boolean(problem)) stored.hidden = !problem;
    setText(stored, problem ? t(`ui.storage.mix.${problem}`) : '');
  };
}
