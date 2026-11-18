// Replaces src/audio/voices/sampler.js inside the app, for voices-panel.js: the app's engine owns the packs, the page only asks.
// loadPack(id) asks the app to read the pack (message `pack`) and settles on its answer (event `pack`: { id, error }, '' = ready);
// peekPack(id) is truthy once the app said the pack is ready.
const backend = window.__JUCE__.backend;
const ready = new Set();
const waiting = new Map(); // id -> [{ resolve, reject }]
backend.addEventListener('pack', ({ id, error }) => {
  if (!error) ready.add(id);
  for (const { resolve, reject } of waiting.get(id) ?? []) (error ? reject(new Error(error)) : resolve(id));
  waiting.delete(id);
});
export const peekPack = (id) => (ready.has(id) ? id : undefined);
export function loadPack(id) {
  if (ready.has(id)) return Promise.resolve(id);
  return new Promise((resolve, reject) => {
    if (!waiting.has(id)) {
      waiting.set(id, []);
      backend.emitEvent('btg', { type: 'pack', id });
    }
    waiting.get(id).push({ resolve, reject });
  });
}
