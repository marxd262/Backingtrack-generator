// Gruppe "Songform" in der linken Leiste: Vorlage (inkl. "Ohne Form"), Zielgröße (die frühere Längen-Auswahl) und die vier Regler
// Struktur, Dynamik, Pausen, Zufall. Würfeln und Zustand stehen in state.js. Dynamik, Pausen und Zufall wirken live (applyLive);
// Struktur würfelt beim Loslassen neu. Ändert sich die Gesamtlänge, startet eine laufende Wiedergabe an der gleichen Position neu.
import { t } from '../index.js';
import { TEMPLATE_IDS, TARGET_SIZES } from '../core/form-roll.js';
import { FEEL_DEFAULTS, DYNAMICS_MAX } from '../core/form-types.js';
import { $, state, setText, setAttr, formChoice, rollNewForm, setFormTemplate, setFormTarget, setFormFeel } from './state.js';

const FEEL = ['structure', 'dynamics', 'pauses', 'randomness'];
const MAX = { structure: 1, dynamics: DYNAMICS_MAX, pauses: 1, randomness: 1 };

export function initFormPanel({ render, restartIfPlaying, applyLive }) {
  // gleiche Gesamtlänge: live über setTrack, sonst Neustart an der gleichen Position
  const commit = (before) => (state.track.length === before ? applyLive({ patterns: true }) : restartIfPlaying({ inPlace: true }));

  const template = $('form-template');
  for (const id of ['auto', ...TEMPLATE_IDS, 'off']) template.append(new Option('', id));
  template.addEventListener('change', () => {
    const before = state.track.length;
    setFormTemplate(template.value);
    commit(before);
    render();
  });

  const target = $('length');
  for (const n of TARGET_SIZES) target.append(new Option('', String(n)));
  target.addEventListener('change', () => {
    const before = state.track.length;
    setFormTarget(Number(target.value));
    commit(before);
    render();
  });

  const sliders = FEEL.map((name) => {
    const el = $(`form-${name}`);
    el.max = String(Math.round(MAX[name] * 100));
    let queued = false;
    el.addEventListener('input', () => {
      setFormFeel(name, Number(el.value) / 100);
      render();
      // beim Ziehen höchstens eine Neuberechnung des Ereignisstroms je Bild; Struktur wirkt erst beim Loslassen
      if (name !== 'structure' && !queued) {
        queued = true;
        requestAnimationFrame(() => { queued = false; applyLive({ patterns: true }); });
      }
    });
    if (name === 'structure') {
      el.addEventListener('change', () => {
        const before = state.track.length;
        rollNewForm();
        commit(before);
        render();
      });
    }
    return [name, el];
  });

  return function renderForm() {
    if (state.page !== 'play') return;
    const { track, formTarget } = state;
    const choice = formChoice();
    const on = choice !== 'off';
    for (const o of template.options) setText(o, t(`form.template.${o.value}`));
    if (template.value !== choice) template.value = choice;
    setText($('length-label'), t(on ? 'ui.formTarget' : 'ui.length'));
    for (const o of target.options) setText(o, t('ui.barsCount', { n: o.value }));
    const shown = String(on ? formTarget : track.length);
    if (target.value !== shown) target.value = shown;
    const feel = track.form?.feel ?? state.formFeel;
    for (const [name, el] of sliders) {
      const percent = String(Math.round(feel[name] * 100));
      if (el.value !== percent) el.value = percent;
      if (el.disabled === on) el.disabled = !on;
      const text = t('ui.percent', { n: percent });
      setText($(`form-${name}-out`), text);
      setAttr(el, 'aria-valuetext', t('ui.formFeelValue', { n: percent, def: Math.round(FEEL_DEFAULTS[name] * 100) }));
    }
  };
}
