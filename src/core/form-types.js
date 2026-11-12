// Songform: die eine Tabelle für Teil-Typen, Grenzen und Reglerstandards. Alle Zahlen (Startwerte, Formeln) stehen nur hier;
// niemand kann hören, also sind sie hier leicht nachzustellen. Reine Daten und Rechnung, kein Audio.

import { LAYER_IDS, LAYERS } from './layers.js';

/** Teil-Typen in Anzeigereihenfolge. */
export const PART_TYPES = Object.freeze(['intro', 'verse', 'build', 'chorus', 'break', 'outro']);
/** Übergang vor einem Teil: keiner, Schlagzeug-Fill, Snare-Wirbel, Stopp (ein bis zwei Schläge Stille). */
export const TRANSITIONS = Object.freeze(['none', 'fill', 'roll', 'stop']);

/** Grenzen; `length` ist gleich MAX_LENGTH in track.js (ein Test prüft das), hier gedoppelt, damit form.js nicht von track.js abhängt. */
export const FORM_LIMITS = Object.freeze({ parts: 64, bars: 64, length: 512, levelMin: -24, levelMax: 0, densityMin: -1, densityMax: 1 });

/** Reglerstandards 0..1 (Dynamik bis `DYNAMICS_MAX`). */
export const FEEL_DEFAULTS = Object.freeze({ structure: 0.6, dynamics: 0.6, pauses: 0.4, randomness: 0.5 });
/** Obergrenze des Reglers Dynamik (noch weiter gespreizt als die Tabelle beim Standard 0,6). */
export const DYNAMICS_MAX = 1.3;

const freezeRow = (r) => Object.freeze({ ...r, layers: Object.freeze([...r.layers]), density: Object.freeze([...r.density]), level: Object.freeze([...r.level]) });

/**
 * Startwerte je Typ. `layers`: aktive Schichten ohne Lead und Percussion (die folgen Akkorden und Schlagzeug);
 * `density`: Verschiebung der Rhythmusdichte [Anfang, Ende]; `level`: dB relativ zum Refrain [Anfang, Ende], nie über 0;
 * `transition`: Übergang davor; `crash`: Crash auf der Eins des Teils.
 */
export const TYPE_TABLE = Object.freeze({
  intro: freezeRow({ layers: ['chords', 'pad', 'bass'], density: [-0.25, -0.25], level: [-5, -5], transition: 'none', crash: false }),
  verse: freezeRow({ layers: ['bass', 'drums', 'chords'], density: [-0.15, -0.15], level: [-3, -3], transition: 'fill', crash: false }),
  build: freezeRow({ layers: ['bass', 'drums', 'chords', 'pad'], density: [-0.1, 0.25], level: [-4, -1], transition: 'roll', crash: false }),
  chorus: freezeRow({ layers: LAYER_IDS.filter((id) => !LAYERS[id].follows), density: [0.2, 0.2], level: [0, 0], transition: 'fill', crash: true }),
  break: freezeRow({ layers: ['pad', 'chords'], density: [-0.4, -0.4], level: [-7, -7], transition: 'stop', crash: false }),
  outro: freezeRow({ layers: ['bass', 'chords', 'pad', 'drums'], density: [-0.15, -0.3], level: [-4, -8], transition: 'none', crash: false }),
});

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const CHORUS = TYPE_TABLE.chorus;

/**
 * Wirksame Werte eines Teils. Die Standardwerte des Typs weichen vom Refrain ab; diese Abweichung (Pegel und Dichte) wird mit
 * `feel.dynamics / FEEL_DEFAULTS.dynamics` multipliziert (0 bis DYNAMICS_MAX / Standard), der Standardregler ergibt also genau die Tabelle.
 * Ausdrücklich gesetzte `level`/`density` werden nicht skaliert und gelten für den ganzen Teil als [x, x].
 * @returns {{ type: string, bars: number, layers: string[], density: [number, number], level: [number, number], transition: string, crash: boolean, locked: boolean }}
 */
export function resolveSection(section, feel) {
  const row = TYPE_TABLE[section.type];
  const dyn = Number.isFinite(feel?.dynamics) ? feel.dynamics : FEEL_DEFAULTS.dynamics;
  const factor = clamp(dyn / FEEL_DEFAULTS.dynamics, 0, DYNAMICS_MAX / FEEL_DEFAULTS.dynamics);
  const level = section.level != null
    ? [section.level, section.level]
    : row.level.map((x) => clamp(CHORUS.level[0] + (x - CHORUS.level[0]) * factor, FORM_LIMITS.levelMin, FORM_LIMITS.levelMax));
  const density = section.density != null
    ? [section.density, section.density]
    : row.density.map((x) => clamp(CHORUS.density[0] + (x - CHORUS.density[0]) * factor, FORM_LIMITS.densityMin, FORM_LIMITS.densityMax));
  return {
    type: section.type,
    bars: section.bars,
    layers: [...row.layers],
    density,
    level,
    transition: section.transition ?? row.transition,
    crash: section.crash ?? row.crash,
    locked: section.locked === true,
  };
}

// linear von Anfang zu Ende über die Takte des Teils; bei einem Takt der Startwert
const ramp = ([a, b], bars, i) => (bars > 1 ? a + ((b - a) * clamp(i, 0, bars - 1)) / (bars - 1) : a);
/** Pegel (dB) im Takt `barInSection` eines aufgelösten Teils. */
export const levelAt = (resolved, barInSection) => ramp(resolved.level, resolved.bars, barInSection);
/** Dichteverschiebung im Takt `barInSection` eines aufgelösten Teils. */
export const densityAt = (resolved, barInSection) => ramp(resolved.density, resolved.bars, barInSection);
