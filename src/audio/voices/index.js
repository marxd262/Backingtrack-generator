// Klangerzeugung der wählbaren Stimmen. Das Register (Namen, Arten, Varianten) steht in core/voices.js; hier steht je Eintrag die Umsetzung.
// Eine Umsetzung ist (layer, ctx, deps) => (out, t, e) => void und liest ihre Parameter beim Anschlag, damit Regler live wirken.
import { classicVoice } from './classic.js';
import { stringVoice } from './string.js';
import { epianoVoice } from './epiano.js';
import { sampleVoice } from './sample.js';
import { tunedValue } from './tunables.js';

// Sample-Stimmen: Pack-ID ist `${instrument}-${variante}` (src/assets/samples)
const sample = (variant) => (layer, ctx, deps) => sampleVoice(`${layer}-${variant}`, layer, ctx, deps);

// Schlüssel `${id}/${variante}`; was hier fehlt (noch nicht gebaute Stimmen), spielt als Synth/Klassisch
const IMPLS = {
  bass: { 'synth/classic': classicVoice, 'string/finger': stringVoice, 'sample/finger': sample('finger'), 'sample/pick': sample('pick') },
  chords: { 'synth/classic': classicVoice, 'string/electric': stringVoice, 'epiano/rhodes': epianoVoice, 'sample/guitar': sample('guitar'), 'sample/epiano': sample('epiano') },
  pad: { 'synth/classic': classicVoice, 'sample/strings': sample('strings'), 'sample/warm': sample('warm') },
};

/** Ob für Instrument, Stimme und Variante eine eigene Umsetzung existiert (sonst spielt createVoice den klassischen Synth). */
export const hasVoice = (layer, id, variant) => Object.hasOwn(IMPLS[layer] ?? {}, `${id}/${variant}`);

/**
 * Stimme für ein Instrument. deps: { params (live aktualisierte abgeleitete Klangparameter des Instruments), getTimbre () => rohe Klangregler
 * (0..1) des Instruments, rng (seedbar, nur für diese Stimme), getTuning () => Überschreibungen der Feinwerte, setStatus (Ladezustand melden),
 * track (Promise eines Ladevorgangs anmelden, damit whenReady darauf wartet) }. Die Umsetzung bekommt zusätzlich deps.tuned(name) -> Zahl (siehe tunables.js).
 */
export function createVoice(layer, voice, ctx, deps) {
  const key = `${voice.id}/${voice.variant}`;
  const impl = IMPLS[layer]?.[key] ?? IMPLS[layer]['synth/classic'];
  const tuningKey = `${layer}/${key}`;
  // classic: Rückfall für Stimmen, die erst laden müssen (Samples); gleiche Parameter wie die klassische Stimme des Instruments
  const classic = classicVoice(layer, ctx, deps);
  return impl(layer, ctx, { ...deps, classic, tuned: (name) => tunedValue(tuningKey, name, deps.getTuning()) });
}
