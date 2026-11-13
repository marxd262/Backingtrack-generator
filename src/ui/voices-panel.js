// Stimmenwahl in den Instrument-Modulen (Rack): ein LCD-Select für Stimme und Variante zusammen (nach Art gruppiert, ein Eintrag je
// Variante), Art-Kennung SMP/SYN, Ladezustand der Sample-Stimmen im Display und ein Hinweis auf ausgegraute Knöpfe. Die Wahl steht in
// state.track.voices, wirkt live über player.setVoices und bleibt bei einem Stilwechsel stehen. Welche Regler eine Stimme benutzt, steht im Register (usesTimbreField).
import { t } from '../index.js';
import { state, setText, setAttr } from './state.js';
import { DEFAULT_TIMBRE } from '../core/timbre.js';
import { VOICES, VOICE_LAYERS, completeVoices, usesTimbreField, setAllVoices } from '../core/voices.js';
import { loadPack, peekPack } from '../audio/voices/sampler.js';
import { packIdFor } from '../audio/voices/pack-id.js';
import { createLcdSelect } from './lcd-select.js';

const KINDS = ['synth', 'model', 'sample'];
// nur Instrumente mit echter Wahl (mehr als eine sichtbare Stimme)
const CHOOSABLE = VOICE_LAYERS.filter((layer) => Object.values(VOICES[layer]).filter((v) => !v.hidden).length > 1);
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

export function initVoices({ render, player }) {
  const rows = {};
  const loadState = {}; // je Instrument: '' | 'loading' | 'ready' | 'error' (nur Sample-Stimmen laden)

  // Ladezustand einer gerade gewählten Sample-Stimme verfolgen; ein überholter Ausgang (inzwischen andere Wahl) zählt nicht mehr
  function watch(layer) {
    const { id, variant } = completeVoices(state.track.voices)[layer];
    if (VOICES[layer][id].kind !== 'sample') { loadState[layer] = ''; return; }
    // schon geladen: sofort bereit, ohne 'lädt …' dazwischen (sonst flackert die Ansage)
    if (peekPack(packIdFor(layer, variant))) { loadState[layer] = 'ready'; return; }
    loadState[layer] = 'loading';
    const asked = `${id}/${variant}`;
    const current = () => `${completeVoices(state.track.voices)[layer].id}/${completeVoices(state.track.voices)[layer].variant}`;
    loadPack(packIdFor(layer, variant)).then(
      () => { if (current() === asked) { loadState[layer] = 'ready'; render(); } },
      () => { if (current() === asked) { loadState[layer] = 'error'; render(); } },
    );
  }

  const choose = (layer, next) => {
    state.track.voices = completeVoices({ ...state.track.voices, [layer]: next });
    player()?.setVoices(state.track.voices);
    watch(layer);
    render();
  };

  // alle Schichten auf Sample oder Synth; ein Pack, das nicht lädt, zeigt den Fehler nur im Display seines Instruments
  const chooseAll = (kind) => {
    state.track.voices = setAllVoices(state.track.voices, kind);
    player()?.setVoices(state.track.voices);
    for (const layer of VOICE_LAYERS) watch(layer);
    render();
  };

  for (const layer of CHOOSABLE) {
    const slot = document.querySelector(`.instrument[data-layer="${layer}"] .inst-voice`);
    const caption = el('div', { className: 'inst-caption' });
    const label = el('label', { htmlFor: `voice-${layer}`, className: 'lbl' });
    // Anzeige: Art-Kennung (SMP/SYN) und Ladezustand der Sample-Stimme
    const display = el('span', { className: 'lcd alt' });
    const kind = el('span', { id: `voice-kind-${layer}` });
    const status = el('span', { id: `voice-status-${layer}`, className: 'voice-status' });
    status.setAttribute('role', 'status'); // wird beim Laden und Bereitwerden angesagt
    display.append(kind, status);
    caption.append(label, display);
    const select = el('select', { id: `voice-${layer}` });
    const hint = el('p', { id: `voice-hint-${layer}`, className: 'hint', hidden: true });
    slot.append(caption, select, hint);
    createLcdSelect(select, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });

    // Gruppen nach Art; eine Zeile je Stimme und Variante (Wert "id/variante"), Text = Variantenname
    const groups = {}, options = {};
    for (const k of KINDS) {
      const ids = Object.keys(VOICES[layer]).filter((id) => VOICES[layer][id].kind === k && !VOICES[layer][id].hidden); // hidden: nicht in der Auswahl
      if (!ids.length) continue;
      groups[k] = el('optgroup');
      for (const id of ids) for (const variant of VOICES[layer][id].variants) groups[k].append((options[`${id}/${variant}`] = el('option', { value: `${id}/${variant}` })));
      select.append(groups[k]);
    }
    select.addEventListener('change', () => {
      const [id, variant] = select.value.split('/');
      choose(layer, { id, variant });
    });
    rows[layer] = { label, kind, status, select, hint, groups, options };
  }

  function renderVoices() {
    const voices = completeVoices(state.track.voices);
    for (const layer of CHOOSABLE) {
      const r = rows[layer], { id, variant } = voices[layer];
      setText(r.label, t('ui.voice'));
      for (const [kind, group] of Object.entries(r.groups)) if (group.label !== t(`voice.kind.${kind}`)) group.label = t(`voice.kind.${kind}`);
      for (const [key, option] of Object.entries(r.options)) setText(option, t(`variant.${layer}.${key.replace('/', '.')}`));
      // eine versteckte Stimme (Saitenmodell) hat keine Zeile: das Display bleibt dann leer
      if (r.select.value !== `${id}/${variant}`) r.select.value = `${id}/${variant}`;
      setAttr(r.select, 'title', r.options[`${id}/${variant}`]?.textContent ?? ''); // lange Namen werden im Display gekürzt
      setText(r.kind, t(`voice.kindShort.${VOICES[layer][id].kind === 'sample' ? 'sample' : 'synth'}`));
      setText(r.status, loadState[layer] ? t(`voice.status.${loadState[layer]}`) : '');
      // Hinweis, solange die Stimme Regler ihres Instruments nicht benutzt (sie sind im Modul ausgegraut)
      const unused = Object.keys(DEFAULT_TIMBRE[layer] ?? {}).some((field) => !usesTimbreField(state.track.voices, `${layer}.${field}`));
      if (r.hint.hidden === unused) r.hint.hidden = !unused;
      setText(r.hint, unused ? t('ui.voiceHint') : '');
    }
  }

  return { render: renderVoices, chooseAll };
}
