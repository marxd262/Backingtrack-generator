// Klangerzeugung der wählbaren Stimmen. Das Register (Namen, Arten, Varianten) steht in core/voices.js; hier steht je Eintrag die Umsetzung.
// Eine Umsetzung ist (layer, ctx, deps) => (out, t, e) => void und liest ihre Parameter beim Anschlag, damit Regler live wirken.
import { classicVoice } from './classic.js';
import { stringVoice } from './string.js';
import { epianoVoice } from './epiano.js';
import { sampleVoice } from './sample.js';
import { sampleHitVoice, HIT_KEYS } from './sample-hits.js';
import { drumKitVoice } from './drums.js';
import { percussionVoice } from './percussion.js';
import { tunedValue } from './tunables.js';
import { packIdFor } from './pack-id.js';

export { packIdFor };
/** Tastenbelegung der Schläge eines Sample-Kits (Name -> GM-Taste). */
export const hitKeysFor = (layer, variant) => (layer === 'drums' && variant === 'rimshot' ? { ...HIT_KEYS.drums, snare: 37 } : HIT_KEYS[layer]);

const sample = (variant) => (layer, ctx, deps) => sampleVoice(packIdFor(layer, variant), layer, ctx, deps);
const hits = (variant) => (layer, ctx, deps) => sampleHitVoice(packIdFor(layer, variant), hitKeysFor(layer, variant), ctx, deps);
const kits = (...variants) => Object.fromEntries(variants.map((v) => [`sample/${v}`, hits(v)]));

// Schlüssel `${id}/${variante}`; was hier fehlt (noch nicht gebaute Stimmen), spielt als Synth/Klassisch
const IMPLS = {
  drums: { 'synth/classic': (layer, ctx, deps) => drumKitVoice(ctx, { params: deps.params, noise: deps.noise }), ...kits('standard', 'brushes', 'rimshot', 'jazz', 'electronic', '808') },
  bass: { 'synth/classic': classicVoice, 'string/finger': stringVoice, 'sample/finger': sample('finger'), 'sample/pick': sample('pick'), 'sample/upright': sample('upright') },
  chords: {
    'synth/classic': classicVoice, 'string/electric': stringVoice, 'epiano/rhodes': epianoVoice,
    'sample/guitar': sample('guitar'), 'sample/epiano': sample('epiano'), 'sample/organ': sample('organ'), 'sample/muted': sample('muted'), 'sample/jazz': sample('jazz'), 'sample/funk': sample('funk'), 'sample/steel': sample('steel'), 'sample/nylon': sample('nylon'), 'sample/twelve': sample('twelve'),
    'sample/freepats': sample('freepats'), 'sample/freepatsjazz': sample('freepatsjazz'),
  },
  lead: { 'synth/classic': classicVoice, 'sample/flute': sample('flute'), 'sample/sax': sample('sax'), 'sample/synth': sample('synth') },
  percussion: { 'synth/classic': (layer, ctx, deps) => percussionVoice(ctx, { noise: deps.noise }), ...kits('studio') },
  pad: { 'synth/classic': classicVoice, 'sample/strings': sample('strings'), 'sample/warm': sample('warm') },
};

/** Ob für Instrument, Stimme und Variante eine eigene Umsetzung existiert (sonst spielt createVoice den klassischen Synth). */
export const hasVoice = (layer, id, variant) => Object.hasOwn(IMPLS[layer] ?? {}, `${id}/${variant}`);

/**
 * Stimme für ein Instrument. deps: { params (live aktualisierte abgeleitete Klangparameter des Instruments), getTimbre () => rohe Klangregler
 * (0..1) des Instruments, rng (seedbar, nur für diese Stimme), getTuning () => Überschreibungen der Feinwerte, setStatus (Ladezustand melden),
 * track (Promise eines Ladevorgangs anmelden, damit whenReady darauf wartet), noise (gemeinsamer Rauschpuffer der Instrumente) }. Die Umsetzung bekommt zusätzlich deps.tuned(name) -> Zahl (siehe tunables.js).
 */
export function createVoice(layer, voice, ctx, deps) {
  const key = `${voice.id}/${voice.variant}`;
  const impl = IMPLS[layer]?.[key] ?? IMPLS[layer]['synth/classic'];
  const tuningKey = `${layer}/${key}`;
  // classic: Rückfall für Stimmen, die erst laden müssen (Samples): die Synth-Stimme des Instruments (bei Schlagzeug und Percussion das Synth-Kit)
  const classic = IMPLS[layer]['synth/classic'](layer, ctx, deps);
  return impl(layer, ctx, { ...deps, classic, tuned: (name) => tunedValue(tuningKey, name, deps.getTuning()) });
}
