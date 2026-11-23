// Aufgabe (Job) je Schicht im Instrument-Modul (Rack): ein LCD-Select pro Schicht, die Aufgaben hat (tables().jobsFor), ohne Wissen
// über einzelne Schichten. Die Wahl ist die Aktion setJob; was die Auswahl zeigt, gibt derived().jobs.
import { t } from './i18n/index.js';
import { session, send, holds } from './session.js';
import { setText } from './dom.js';
import { createLcdSelect } from './lcd-select.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

export function initJobs() {
  const rows = {};
  const { LAYER_IDS, jobsFor } = session.tables;
  for (const layer of LAYER_IDS.filter((id) => jobsFor[id].length)) {
    const label = el('label', { htmlFor: `job-${layer}`, className: 'lbl' });
    const select = el('select', { id: `job-${layer}` });
    const options = {};
    for (const job of jobsFor[layer]) select.append((options[job] = el('option', { value: job })));
    select.addEventListener('change', () => send({ action: 'setJob', layer, job: select.value }, select));
    document.querySelector(`.instrument[data-layer="${layer}"] .inst-job`).append(label, select);
    createLcdSelect(select, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
    select.parentElement.classList.add('alt'); // zweite Anzeigefarbe: die Aufgabe ist nicht die Stimme
    rows[layer] = { label, select, options };
  }

  return function renderJobs() {
    const jobs = session.derived.jobs;
    for (const [layer, r] of Object.entries(rows)) {
      setText(r.label, t(`ui.job.${layer}`));
      for (const [job, option] of Object.entries(r.options)) setText(option, t(`job.${layer}.${job}`));
      if (!holds(r.select) && r.select.value !== jobs[layer]) r.select.value = jobs[layer];
    }
  };
}
