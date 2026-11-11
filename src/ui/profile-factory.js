// Werksprofile: die Stil-Vorlagen (STYLE_PRESETS) als nur lesbare Einträge im Profil-Baum. Laden macht applyStyle (state.js);
// hier stehen nur die Einträge und die Teile für "Kopie speichern" und den Austausch.
import { STYLE_PRESETS } from '../core/tags.js';

/** Einträge in der Reihenfolge von STYLE_PRESETS. */
export const factoryProfiles = () => STYLE_PRESETS.map((p) => ({ key: `factory:${p.id}`, styleId: p.id }));

/**
 * Teile eines Werksprofils (in PART_IDS-Reihenfolge): das Stiltempo als Viertel-Tempo mit meter 4/4 (applyParts rechnet es beim Laden
 * wie applyStyle auf die Taktart um, egal in welcher Taktart die Kopie entstand), Stil mit Schlagworten, Klangregler zurückgesetzt.
 */
export function factoryParts(styleId) {
  const p = STYLE_PRESETS.find((s) => s.id === styleId);
  return {
    tempo: { bpm: p.bpm, meter: [4, 4] },
    style: { style: p.id, tags: structuredClone(p.tags) },
    sound: { timbre: {} },
  };
}
