// Stimmenwahl in den Klanggruppen der Instrumente (linke Leiste): Dropdown Stimme (nach Art gruppiert), Dropdown Variante (nur bei
// mehreren Varianten), Ladezustand der Sample-Stimmen und ein Hinweis auf ausgegraute Regler. Die Wahl steht in state.track.voices, wirkt live
// über player.setVoices und bleibt bei einem Stilwechsel stehen. Welche Regler eine Stimme benutzt, steht im Register (usesTimbreField).
import { t } from '../index.js';
import { $, state, setText } from './state.js';
import { DEFAULT_TIMBRE } from '../core/timbre.js';
import { VOICES, VOICE_LAYERS, completeVoices, usesTimbreField } from '../core/voices.js';
import { loadPack, peekPack } from '../audio/voices/sampler.js';
import { packIdFor } from '../audio/voices/pack-id.js';

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

  for (const layer of CHOOSABLE) {
    const details = $('timbre-groups').querySelector(`details[data-group="${layer}"]`);
    const row = el('div', { className: 'voice-row' });
    const voiceLabel = el('label', { htmlFor: `voice-${layer}` });
    const voiceSelect = el('select', { id: `voice-${layer}` });
    const variantLabel = el('label', { htmlFor: `variant-${layer}`, hidden: true });
    const variantSelect = el('select', { id: `variant-${layer}`, hidden: true });
    const status = el('span', { id: `voice-status-${layer}`, className: 'voice-status' });
    status.setAttribute('role', 'status'); // wird beim Laden und Bereitwerden angesagt
    const hint = el('p', { id: `voice-hint-${layer}`, className: 'hint', hidden: true });

    // Gruppen nach Art, nur solche, die es für das Instrument gibt
    const groups = {}, options = {};
    for (const kind of KINDS) {
      const ids = Object.keys(VOICES[layer]).filter((id) => VOICES[layer][id].kind === kind && !VOICES[layer][id].hidden); // hidden: nicht im Dropdown
      if (!ids.length) continue;
      groups[kind] = el('optgroup');
      for (const id of ids) groups[kind].append((options[id] = el('option', { value: id })));
      voiceSelect.append(groups[kind]);
    }
    voiceSelect.addEventListener('change', () => choose(layer, { id: voiceSelect.value })); // erste Variante der neuen Stimme
    variantSelect.addEventListener('change', () => choose(layer, { id: voiceSelect.value, variant: variantSelect.value }));
    row.append(voiceLabel, voiceSelect, variantLabel, variantSelect, status, hint);
    details.querySelector('summary').after(row);
    rows[layer] = { voiceLabel, voiceSelect, variantLabel, variantSelect, status, hint, groups, options, variantsOf: '' };
  }

  return function renderVoices() {
    const voices = completeVoices(state.track.voices);
    for (const layer of CHOOSABLE) {
      const r = rows[layer], { id, variant } = voices[layer];
      setText(r.voiceLabel, t('ui.voice'));
      setText(r.variantLabel, t('ui.variant'));
      for (const [kind, group] of Object.entries(r.groups)) if (group.label !== t(`voice.kind.${kind}`)) group.label = t(`voice.kind.${kind}`);
      for (const [optionId, option] of Object.entries(r.options)) setText(option, t(`voice.${layer}.${optionId}`));
      if (r.voiceSelect.value !== id) r.voiceSelect.value = id;
      // Varianten der gewählten Stimme; das Feld erscheint nur bei mehreren
      const list = VOICES[layer][id].variants;
      if (r.variantsOf !== id) {
        r.variantsOf = id;
        r.variantSelect.replaceChildren(...list.map((v) => el('option', { value: v })));
      }
      for (const option of r.variantSelect.children) setText(option, t(`variant.${layer}.${id}.${option.value}`));
      if (r.variantSelect.value !== variant) r.variantSelect.value = variant;
      const many = list.length > 1;
      if (r.variantSelect.hidden === many) r.variantSelect.hidden = !many;
      if (r.variantLabel.hidden === many) r.variantLabel.hidden = !many;
      setText(r.status, loadState[layer] ? t(`voice.status.${loadState[layer]}`) : '');
      // Hinweis, solange die Stimme Regler ihres Instruments nicht benutzt (sie sind in der Gruppe ausgegraut)
      const unused = Object.keys(DEFAULT_TIMBRE[layer] ?? {}).some((field) => !usesTimbreField(state.track.voices, `${layer}.${field}`));
      if (r.hint.hidden === unused) r.hint.hidden = !unused;
      setText(r.hint, unused ? t('ui.voiceHint') : '');
    }
  };
}
