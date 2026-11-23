// Aufgabe (Job) je Schicht im Instrument-Modul (Rack): ein LCD-Select pro Schicht, die Aufgaben hat (core/layers.js), ohne Wissen
// über einzelne Schichten. Die Wahl steht in state.track.jobs und ändert das Muster, wirkt also wie ein Schlagwortwechsel (changed).
import { t } from '../index.js';
import { state, setText } from './state.js';
import { createLcdSelect } from './lcd-select.js';
import { LAYER_IDS, jobsFor, completeJobs } from '../core/layers.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

export function initJobs({ render, changed }) {
  const rows = {};
  for (const layer of LAYER_IDS.filter((id) => jobsFor(id).length)) {
    const label = el('label', { htmlFor: `job-${layer}`, className: 'lbl' });
    const select = el('select', { id: `job-${layer}` });
    const options = {};
    for (const job of jobsFor(layer)) select.append((options[job] = el('option', { value: job })));
    select.addEventListener('change', () => {
      state.track.jobs = { ...state.track.jobs, [layer]: select.value };
      changed();
      render();
    });
    document.querySelector(`.instrument[data-layer="${layer}"] .inst-job`).append(label, select);
    createLcdSelect(select, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
    select.parentElement.classList.add('alt'); // zweite Anzeigefarbe: die Aufgabe ist nicht die Stimme
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
