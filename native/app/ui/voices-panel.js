// Stimmenwahl in den Instrument-Modulen (Rack): ein LCD-Select für Stimme und Variante zusammen (nach Art gruppiert, ein Eintrag je
// Variante), Art-Kennung SMP/SYN, Ladezustand der Sample-Stimmen im Display und ein Hinweis auf ausgegraute Knöpfe. Die Wahl ist die Aktion
// setVoice, was die Auswahl zeigt, gibt derived().voices; welche Regler eine Stimme benutzt, derived().usesTimbreField. Die Packs lädt die Engine
// der App; ihren Zustand meldet die Hülle (Ereignis `voices`, nach jedem Aufruf der Engine, der Stimmen oder Track setzt).
import { t } from './i18n/index.js';
import { session, send, holds } from './session.js';
import { setText, setAttr } from './dom.js';
import { createLcdSelect } from './lcd-select.js';

const KINDS = ['synth', 'model', 'sample'];
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const same = (a, b) => a?.id === b?.id && a?.variant === b?.variant;

/** Ladezustand der Sample-Stimme einer Schicht ('' für eine andere): lädt, solange eine Antwort sie gewählt hat und die Engine noch nicht gemeldet
 *  hat (bereit, wenn die Engine sie seit dem Laden der Seite schon einmal bereit meldete); sonst bereit oder nicht verfügbar nach der Meldung. */
export function voiceLoad(layer) {
  const voice = session.derived.voices[layer];
  if (session.tables.VOICES[layer][voice.id].kind !== 'sample') return '';
  if (session.voicesDue && !same(voice, session.reported?.[layer])) return session.loaded.has(`${layer} ${voice.id}/${voice.variant}`) ? 'ready' : 'loading';
  const status = session.voices?.[layer] ?? '';
  return status === 'ready' ? 'ready' : status.startsWith('error') ? 'error' : '';
}

export function initVoices() {
  const rows = {};
  const { VOICES, VOICE_LAYERS, DEFAULT_TIMBRE } = session.tables;
  // nur Instrumente mit echter Wahl (mehr als eine sichtbare Stimme)
  const choosable = VOICE_LAYERS.filter((layer) => Object.values(VOICES[layer]).filter((v) => !v.hidden).length > 1);

  for (const layer of choosable) {
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
    // nur für Vorleser: sichtbar steht "ohne Wirkung" über jedem ausgegrauten Knopf, sobald man ihn überfährt (timbre-panel.js); das Modul bleibt eine Reihe hoch
    const hint = el('p', { id: `voice-hint-${layer}`, className: 'hint visually-hidden', hidden: true });
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
      send({ action: 'setVoice', layer, id, variant }, select);
    });
    rows[layer] = { label, kind, status, select, hint, groups, options };
  }

  return function renderVoices() {
    const voices = session.derived.voices;
    for (const layer of choosable) {
      const r = rows[layer], { id, variant } = voices[layer];
      setText(r.label, t('ui.voice'));
      for (const [kind, group] of Object.entries(r.groups)) if (group.label !== t(`voice.kind.${kind}`)) group.label = t(`voice.kind.${kind}`);
      for (const [key, option] of Object.entries(r.options)) setText(option, t(`variant.${layer}.${key.replace('/', '.')}`));
      // eine versteckte Stimme (Saitenmodell) hat keine Zeile: das Display bleibt dann leer
      if (!holds(r.select) && r.select.value !== `${id}/${variant}`) r.select.value = `${id}/${variant}`;
      setAttr(r.select, 'title', r.options[r.select.value]?.textContent ?? ''); // lange Namen werden im Display gekürzt
      setText(r.kind, t(`voice.kindShort.${VOICES[layer][id].kind === 'sample' ? 'sample' : 'synth'}`));
      const load = voiceLoad(layer);
      setText(r.status, load ? t(`voice.status.${load}`) : '');
      // Hinweis, solange die Stimme Regler ihres Instruments nicht benutzt (sie sind im Modul ausgegraut)
      const unused = Object.keys(DEFAULT_TIMBRE[layer] ?? {}).some((field) => !session.derived.usesTimbreField[`${layer}.${field}`]);
      if (r.hint.hidden === unused) r.hint.hidden = !unused;
      setText(r.hint, unused ? t('ui.voiceHint') : '');
    }
  };
}
