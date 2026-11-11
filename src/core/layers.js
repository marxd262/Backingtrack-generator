// Schicht-Registry: die eine Quelle für Schichten, ihre Standardwerte und ihre Aufgaben (Jobs). Reine Daten, kein Audio.
// Neue Schichten werden hinten angehängt (die Reihenfolge bestimmt die Zufallsströme und die Anzeige).
const freeze = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze({ ...v, ...(v.jobs && { jobs: Object.freeze([...v.jobs]) }) })])));

/**
 * `defaultOn`: Schalter im neuen Track; `follows`: spielt dort, wo die genannte Schicht spielt (Arrangement);
 * `jobs`: Aufgaben, unter denen die Schicht spielen kann (erste = Standard); `fx`: hat eine eigene Effektkette.
 */
export const LAYERS = freeze({
  drums: { defaultOn: true, fx: false },
  bass: { defaultOn: true, fx: true },
  chords: { defaultOn: true, fx: true },
  pad: { defaultOn: true, fx: true },
  lead: { defaultOn: true, follows: 'chords', fx: true, jobs: ['off', 'fills', 'arpeggio', 'melody', 'callResponse'] },
  percussion: { defaultOn: false, follows: 'drums', fx: false, jobs: ['mixed', 'shaker', 'tambourine', 'congas', 'bongos', 'claves', 'cowbell'] },
});

export const LAYER_IDS = Object.freeze(Object.keys(LAYERS));

/** Neue Standard-Schalter { id: defaultOn }. */
export const layerDefaults = () => Object.fromEntries(LAYER_IDS.map((id) => [id, LAYERS[id].defaultOn]));

const NO_JOBS = Object.freeze([]);
export const jobsFor = (layer) => (Object.hasOwn(LAYERS, layer) ? LAYERS[layer].jobs ?? NO_JOBS : NO_JOBS);
export const isJob = (layer, job) => jobsFor(layer).includes(job);

/** Je Schicht mit Aufgaben: die gegebene, wenn gültig, sonst die erste. Neues Objekt, Eingabe bleibt unverändert. */
export function completeJobs(jobs) {
  const given = jobs !== null && typeof jobs === 'object' ? jobs : {};
  const out = {};
  for (const id of LAYER_IDS) if (jobsFor(id).length) out[id] = isJob(id, given[id]) ? given[id] : jobsFor(id)[0];
  return out;
}
