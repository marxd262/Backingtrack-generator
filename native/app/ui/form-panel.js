// Feld "ganzes Lied" links im Modul Form & Spuren: Vorlage (inkl. "Ohne Form"), Zielgröße (die frühere Längen-Auswahl) als LCD-Auswahl und die vier Knöpfe
// Struktur, Dynamik, Pausen, Zufall. Würfeln und Zustand stehen in der Sitzung (setFormTemplate, setFormTarget, setFormFeel, releaseStructure);
// Struktur würfelt beim Loslassen neu.
import { t } from './i18n/index.js';
import { session, send, holds } from './session.js';
import { $, setText, setAttr } from './dom.js';
import { createKnob } from './knob.js';
import { createLcdSelect } from './lcd-select.js';

const FEEL = ['structure', 'dynamics', 'pauses', 'randomness'];
// Bogen am Knopf: Struktur und Dynamik ab 12 Uhr (links türkis, rechts pink), Pausen und Zufall ab dem linken Anschlag
const ORIGIN = { structure: 'center', dynamics: 'center', pauses: 'start', randomness: 'start' };
const KIND = { structure: 'teal', dynamics: 'pink', pauses: 'black', randomness: 'black' };

export function initFormPanel({ page }) {
  const { TEMPLATE_IDS, TARGET_SIZES, FEEL_DEFAULTS, DYNAMICS_MAX } = session.tables;
  const MAX = { structure: 1, dynamics: DYNAMICS_MAX, pauses: 1, randomness: 1 };

  const template = $('form-template');
  for (const id of ['auto', ...TEMPLATE_IDS, 'off']) template.append(new Option('', id));
  createLcdSelect(template, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
  template.addEventListener('change', () => send({ action: 'setFormTemplate', template: template.value }, template));

  const target = $('length');
  for (const n of TARGET_SIZES) target.append(new Option('', String(n)));
  createLcdSelect(target, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
  target.addEventListener('change', () => send({ action: 'setFormTarget', bars: Number(target.value) }, target));

  const sliders = FEEL.map((name) => {
    const el = $(`form-${name}`);
    el.max = String(Math.round(MAX[name] * 100));
    createKnob(el, { origin: ORIGIN[name], kind: KIND[name], resetValue: Math.round(FEEL_DEFAULTS[name] * 100) });
    el.addEventListener('input', () => {
      send({ action: 'setFormFeel', knob: name, value: Number(el.value) }, el);
      show(name, el);
    });
    if (name === 'structure') el.addEventListener('change', () => send({ action: 'releaseStructure' }, el));
    return [name, el];
  });

  // ein Knopf zeigt die Antwort der Sitzung; solange ein Drehen unbeantwortet ist, die Hand
  function show(name, el) {
    const percent = holds(el) ? el.value : String(Math.round(session.derived.feel[name] * 100));
    if (el.value !== percent) el.value = percent;
    setText($(`form-${name}-out`), t('ui.percent', { n: percent }));
    setAttr(el, 'aria-valuetext', t('ui.formFeelValue', { n: percent, def: Math.round(FEEL_DEFAULTS[name] * 100) }));
  }

  return function renderForm() {
    if (page() !== 'play') return;
    const { track, formTarget } = session.state;
    const choice = session.derived.formChoice;
    const on = choice !== 'off';
    // Auto nennt die gewürfelte Vorlage dazu: "Auto (Pop)"
    for (const o of template.options) setText(o, o.value === 'auto' && track.form?.auto ? `${t('form.template.auto')} (${t(`form.template.${track.form.template}`)})` : t(`form.template.${o.value}`));
    if (!holds(template) && template.value !== choice) template.value = choice;
    setText($('length-label'), t(on ? 'ui.formTarget' : 'ui.length'));
    for (const o of target.options) setText(o, t('ui.barsCount', { n: o.value }));
    const shown = String(on ? formTarget : track.length);
    if (!holds(target) && target.value !== shown) target.value = shown;
    if ($('form-feel-hint').hidden !== on) $('form-feel-hint').hidden = on;
    for (const [name, el] of sliders) {
      show(name, el);
      if (el.disabled === on) el.disabled = !on;
      $(`form-${name}-label`).classList.toggle('off', !on);
    }
  };
}
