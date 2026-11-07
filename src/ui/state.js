// Gemeinsamer Zustand für Startseite und Feintuning plus kleine Helfer, die beide Ansichten brauchen.
import { STYLE_PRESETS } from '../index.js';
import { detectLanguage } from '../i18n/index.js';
import { progressionFor } from '../core/progressions.js';

export const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Skala ist nur Oberflächen-Zustand; der Generator kennt nur den Modus
export const SCALE_MODE = { minorPentatonic: 'minor', majorPentatonic: 'major', blues: 'minor', dorian: 'minor' };
export const LAYERS = ['drums', 'bass', 'chords', 'pad'];
export const ALL_LAYERS = Object.fromEntries(LAYERS.map((l) => [l, true]));
export const LENGTHS = [24, 48, 96, 192];
export const MAX_CHORDS = 8;
const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };
const STORAGE_KEY = 'backingtrack.lang';

export const $ = (id) => document.getElementById(id);
export const chordName = (c) => c.root + SYMBOLS[c.quality];
export const rollVariant = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 9999) + 1;
export const preset = (id) => STYLE_PRESETS.find((p) => p.id === id);
export const pressed = (el, on) => el.setAttribute('aria-pressed', String(on));

export function readLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch { /* Speicher gesperrt: Browsersprache */ }
  return detectLanguage(navigator.language);
}

export function saveLang(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch { /* ohne Speicher gilt die Wahl nur bis zum Neuladen */ }
}

const funk = preset('funk');
export const state = {
  track: {
    key: { root: 'A', mode: 'minor' },
    bpm: funk.bpm,
    bars: [],
    tags: structuredClone(funk.tags),
    layers: { drums: true, bass: true, chords: true, pad: true },
    seed: rollVariant(), // Variantennummer
    length: 96,
  },
  scale: 'minorPentatonic',
  style: 'funk',
  playing: false,
  lang: readLang(),
  tuningOpen: false,
  current: null, // { bar, chord } aus onBar
  errors: [], // [{ code, params }], übersetzt erst in render()
  notice: null, // Schlüssel einer Hinweis-Meldung im Feintuning, z. B. volle Folge
};

// Folge aus Tonart und Variante; überschreibt eigene Änderungen (nur bei Tonart, Skala, Variante)
export const deriveBars = () => {
  state.notice = null;
  state.track.bars = progressionFor(state.track.key, state.track.seed).map((chord) => ({ chord, beats: 4 }));
};

// Stil-Vorlage: Tempo und Schlagworte, Variante und Folge bleiben
export function applyStyle(id) {
  const p = preset(id);
  state.style = id;
  state.track.bpm = p.bpm;
  state.track.tags = structuredClone(p.tags);
}
