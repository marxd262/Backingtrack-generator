// Orgel-Einstellungen der Oberfläche (Leslie-Wähler, Zerre-Knopf im Akkord-Modul) -> Feinwerte der Orgel-Stimme (audio/voices/tunables.js,
// 'chords/organ/<preset>'). Reine Rechnung ohne DOM. Im Standard ({ leslie: 'auto', drive: null }) entsteht nichts: die Presets gelten unverändert.
import { VOICES } from '../core/voices.js';
import { LESLIE_MODES } from '../core/organ.js';
import { TUNABLES } from '../audio/voices/tunables.js';

export { LESLIE_MODES };
export const DEFAULT_ORGAN = Object.freeze({ leslie: 'auto', drive: null }); // drive null: die Zerre des gewählten Presets

// Feinwert leslie der Stimme: 0 aus, 1 folgt den Regeln (schnell in Refrain und Aufbau), 2 immer langsam, 3 immer schnell
const LESLIE_CODE = Object.freeze({ off: 0, auto: 1, slow: 2, fast: 3 });

/** Zerre (0..1), die ein Orgel-Preset mitbringt (der Knopf zeigt sie, solange der Nutzer nichts gewählt hat). */
export const presetDrive = (variant) => TUNABLES[`chords/organ/${variant}`]?.drive.value ?? 0;

/** Feinwerte für alle Orgel-Presets (dieselbe Wahl gilt für jedes); {} im Standard. Ungültiges zählt wie der Standard. */
export function organTuning(organ) {
  const over = {};
  if (Object.hasOwn(LESLIE_CODE, organ?.leslie) && organ.leslie !== 'auto') over.leslie = LESLIE_CODE[organ.leslie];
  if (typeof organ?.drive === 'number' && organ.drive >= 0 && organ.drive <= 1) over.drive = organ.drive;
  if (!Object.keys(over).length) return {};
  return Object.fromEntries(VOICES.chords.organ.variants.map((variant) => [`chords/organ/${variant}`, over]));
}
