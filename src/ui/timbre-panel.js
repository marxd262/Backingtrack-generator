// Klangregler der linken Leiste: je Instrument eine einklappbare Gruppe, je Klangfeld (core/timbre.js) ein Regler 0..100 %.
// Ein bewegter Regler überschreibt nur sein Feld in state.track.timbre und gewinnt gegen die Schlagworte; der Wert wirkt live
// über player.setTimbre. Die Gruppen sind <details data-group>; ihren Offen-Zustand bindet app.js über initGroups.
import { t } from '../index.js';
import { $, state, setText, setAttr } from './state.js';
import { DEFAULT_TIMBRE, resolveTrackTimbre } from '../core/timbre.js';
import { usesTimbreField } from '../core/voices.js';

const el = (tag, props) => Object.assign(document.createElement(tag), props);

export function initTimbrePanel({ render, player }) {
  const rows = []; // { group, field, input, out }
  const resets = {}; // Zurücksetzen-Knopf je Gruppe
  const push = () => player()?.setTimbre(resolveTrackTimbre(state.track)); // live, ohne Neustart

  for (const [group, fields] of Object.entries(DEFAULT_TIMBRE)) {
    const details = el('details', { className: 'group' });
    details.dataset.group = group;
    const summary = el('summary');
    summary.dataset.i18n = `group.${group}`;
    details.append(summary);
    for (const field of Object.keys(fields)) {
      const row = el('div', { className: 'timbre-row' });
      const label = el('label', { htmlFor: `timbre-${group}-${field}` });
      label.dataset.i18n = `timbre.${group}.${field}`;
      const input = el('input', { type: 'range', id: `timbre-${group}-${field}`, min: '0', max: '100', step: '1' });
      const out = el('output', { htmlFor: input.id });
      input.addEventListener('input', () => {
        const timbre = state.track.timbre;
        state.track.timbre = { ...timbre, [group]: { ...timbre[group], [field]: Number(input.value) / 100 } };
        push();
        render();
      });
      row.append(label, input, out);
      details.append(row);
      rows.push({ group, field, input, out });
    }
    const reset = el('button', { type: 'button', className: 'chip timbre-reset' });
    reset.dataset.i18n = 'ui.timbreReset';
    reset.addEventListener('click', () => {
      const { [group]: removed, ...rest } = state.track.timbre;
      state.track.timbre = rest;
      push();
      render();
      // der Knopf ist jetzt deaktiviert und verlöre den Fokus an body: in der Gruppe bleiben
      // der erste Regler kann bei der gewählten Stimme ausgegraut sein (focus() wirkt dort nicht): den ersten bedienbaren nehmen
      rows.find((r) => r.group === group && !r.input.disabled)?.input.focus();
    });
    resets[group] = reset;
    details.append(reset);
    $('timbre-groups').append(details);
  }

  return function renderTimbre() {
    const effective = resolveTrackTimbre(state.track);
    for (const { group, field, input, out } of rows) {
      const percent = String(Math.round(effective[group][field] * 100));
      // nur bei Änderung: ein gerade gezogener Regler soll nicht neu gesetzt werden
      if (input.value !== percent) input.value = percent;
      // Regler, die die gewählte Stimme nicht benutzt, sind ausgegraut (die Verzerrer gelten für jede Stimme)
      const off = !usesTimbreField(state.track.voices, `${group}.${field}`);
      if (input.disabled !== off) input.disabled = off;
      const shown = t('ui.percent', { n: percent });
      setText(out, shown);
      setAttr(input, 'aria-valuetext', shown);
    }
    for (const [group, button] of Object.entries(resets)) {
      const off = Object.keys(state.track.timbre[group] ?? {}).length === 0;
      if (button.disabled !== off) button.disabled = off;
    }
  };
}
