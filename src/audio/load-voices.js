// Packs der Sample-Stimmen eines Tracks vorab laden, damit play() gleich mit den Samples beginnt (sonst spielt bis dahin der Synth).
import { resolveVoices, VOICES } from '../core/voices.js';
import { loadPack, peekPack } from './voices/sampler.js';
import { packIdFor } from './voices/pack-id.js';

/** Ids der Packs, die die Stimmenwahl braucht und die noch nicht geladen sind. */
export const missingPacks = (track) => Object.entries(resolveVoices(track))
  .filter(([layer, v]) => VOICES[layer][v.id].kind === 'sample')
  .map(([layer, v]) => packIdFor(layer, v.variant))
  .filter((id) => !peekPack(id));

/** Lädt die fehlenden Packs; wirft nie. Liefert die Ids, die nicht geladen werden konnten (dort spielt der Synth). */
export async function loadVoices(track) {
  const ids = missingPacks(track);
  const results = await Promise.allSettled(ids.map(loadPack));
  return ids.filter((_, i) => results[i].status === 'rejected');
}
