// Regeln der Orgel (docs/sound-v2/SPIELREGELN.md, Abschnitt 4.6), Teil der Artikulations-Schicht (articulation.js ruft organRules nach den
// Regelgruppen auf). Sie greifen nur, wenn die Akkord-Schicht die Tonewheel-Orgel spielt (chords/organ); der Strom aller anderen Stimmen bleibt
// unverändert. Die Regeln setzen nur Felder an den Tönen; was daraus wird, entscheidet die Stimme (audio/voices/organ.js, dort abschaltbar).
// leslie: 1 = der rotierende Lautsprecher dreht schnell (Refrain, Aufbau und letzter Takt vor dem Refrain); fehlt das Feld, dreht er langsam. Ohne Songform gibt es
// keinen Refrain: das Leslie bleibt langsam.
// swell: Stellung des Schweller-Pedals in dB (0 = ganz auf, fehlt dann). Die Orgel folgt der Anschlagstärke nicht; das Pedal übernimmt darum den
// Pegel, den die Songform dem Takt gibt (Strophe -3 dB, Refrain 0 dB ...). Im letzten Takt vor dem Refrain zieht das Pedal auf den Pegel des
// Refrains auf: art 'swell' mit artTime = Zeit bis zur Eins des Refrains (aus dem Raster, keine feste Zeit).
import { r6 } from './timeline.js';
import { levelAt } from './form-types.js';

/** Stellungen des Leslie-Wählers der Oberfläche, in seiner Reihenfolge; `auto` folgt den Regeln unten (schnell in Refrain und Aufbau). */
export const LESLIE_MODES = Object.freeze(['off', 'slow', 'auto', 'fast']);

/** out: Ereignisse (werden geändert); env: aus articulate (track, bars, ctx = Kontext je Takt) und die Abschnitte der Songform. */
export function organRules(out, { track, bars, ctx, sections }) {
  if (track.voices?.chords?.id !== 'organ') return;
  const level = []; // Pegel der Songform je Takt in dB; ohne Songform überall 0
  for (const sec of sections) for (let i = sec.start; i < sec.start + sec.bars; i++) level[i] = sec.resolved ? levelAt(sec.resolved, i - sec.start) : 0;
  const chorus = (bar) => ctx[bar]?.kind === 'chorus';
  for (const e of out) {
    if (e.layer !== 'chords' || e.type !== 'note') continue;
    const into = !chorus(e.bar) && chorus(e.bar + 1);
    if (into || chorus(e.bar) || ctx[e.bar]?.kind === 'build') e.leslie = 1;
    const db = level[into ? e.bar + 1 : e.bar] ?? 0;
    if (db < 0) e.swell = r6(db);
    if (into && level[e.bar] < db) Object.assign(e, { art: 'swell', artTime: r6(bars[e.bar].end - e.t) });
  }
}
