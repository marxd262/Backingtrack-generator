// Aufgabe (Job) je Schicht in den Klanggruppen (linke Leiste): ein Dropdown pro Schicht, die Aufgaben hat (core/layers.js), ohne Wissen
// über einzelne Schichten. Die Wahl steht in state.track.jobs und ändert das Muster, wirkt also wie ein Schlagwortwechsel (changed).
import { t } from '../index.js';
import { $, state, setText } from './state.js';
import { LAYER_IDS, jobsFor, completeJobs } from '../core/layers.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

export function initJobs({ render, changed }) {
  const rows = {};
  for (const layer of LAYER_IDS.filter((id) => jobsFor(id).length)) {
    const details = $('timbre-groups').querySelector(`details[data-group="${layer}"]`);
    const row = el('div', { className: 'voice-row' });
    const label = el('label', { htmlFor: `job-${layer}` });
    const select = el('select', { id: `job-${layer}` });
    const options = {};
    for (const job of jobsFor(layer)) select.append((options[job] = el('option', { value: job })));
    select.addEventListener('change', () => {
      state.track.jobs = { ...state.track.jobs, [layer]: select.value };
      changed();
      render();
    });
    row.append(label, select);
    details.querySelector('summary').after(row);
    rows[layer] = { label, select, options };
  }

  return function renderJobs() {
    const jobs = completeJobs(state.track.jobs);
    for (const [layer, r] of Object.entries(rows)) {
      setText(r.label, t(`ui.job.${layer}`));
      for (const [job, option] of Object.entries(r.options)) setText(option, t(`job.${layer}.${job}`));
      if (r.select.value !== jobs[layer]) r.select.value = jobs[layer];
    }
  };
}
