// Gemeinsamer Zustand für Start- und Spielseite plus kleine Helfer, die beide Seiten brauchen.
import { STYLE_PRESETS } from '../index.js';
import { detectLanguage } from '../i18n/index.js';
import { progressionFor } from '../core/progressions.js';
import { loadLayout } from './layout-state.js';
import { loadMix } from './mix-state.js';

export const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Skala ist nur Oberflächen-Zustand; der Generator kennt nur den Modus
export const SCALE_MODE = { minorPentatonic: 'minor', majorPentatonic: 'major', blues: 'minor', dorian: 'dorian' };
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
// Nur bei Änderung schreiben: render() läuft je Takt, gleiche Werte sollen keine DOM-Mutation (und keine Ansage) auslösen
export const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
export const setAttr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
export const pressed = (el, on) => setAttr(el, 'aria-pressed', String(on));

export function readLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch { /* Speicher gesperrt: Browsersprache */ }
  return detectLanguage(navigator.language);
}

// Schon der Zugriff auf localStorage kann werfen (gesperrter Speicher); null speichert nichts
export const layoutStorage = (() => {
  try {
    return localStorage;
  } catch {
    return null;
  }
})();

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
    timbre: {}, // Klangregler: nur die vom Nutzer gesetzten Felder { gruppe: { feld: 0..1 } }, über den Schlagworten
    layers: { drums: true, bass: true, chords: true, pad: true },
    seed: rollVariant(), // Variantennummer
    variety: true, // reichere Varianten: der Seed streut Muster-Werte und Klang stärker (siehe docs/superpowers/specs/2026-11-09-variant-richness-design.md)
    length: 96,
  },
  scale: 'minorPentatonic',
  style: 'funk',
  playing: false,
  lang: readLang(),
  page: 'start', // 'start' | 'play'
  layout: loadLayout(layoutStorage), // Leisten, Ansichten, Beschriftung; Änderungen über saveLayout
  mix: loadMix(layoutStorage), // Mischpult-Regler { drums, bass, chords, pad, master }, je 0..1; Änderungen über saveMix
  current: null, // { bar, chord } aus onBar
  errors: [], // [{ code, params }], übersetzt erst in render()
  notice: null, // Schlüssel einer Hinweis-Meldung der Akkordfolge, z. B. volle Folge
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
  state.track.timbre = {}; // neue Vorlage, neuer Ausgangspunkt für die Regler
}
