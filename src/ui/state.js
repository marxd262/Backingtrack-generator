// Gemeinsamer Zustand für Start- und Spielseite plus kleine Helfer, die beide Seiten brauchen.
import { STYLE_PRESETS } from '../index.js';
import { detectLanguage } from '../i18n/index.js';
import { progressionFor } from '../core/progressions.js';
import { loadLayout } from './layout-state.js';
import { loadMix } from './mix-state.js';
import { LAYER_IDS, layerDefaults, completeJobs } from '../core/layers.js';
import { chordName } from '../core/chords.js';
import { colorProgression } from '../core/harmony.js';
import { styleChordColor } from '../core/tags.js';
import { METERS, meterKey, convertTempo } from '../core/grooves.js';
import { SCALE_MODE } from '../core/music.js';
import { rollForm } from '../core/form-roll.js';
import { formLength } from '../core/form.js';
import { FEEL_DEFAULTS } from '../core/form-types.js';

export const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export { SCALE_MODE }; // wohnt in core/music.js, hier weiter erreichbar
export const LAYERS = LAYER_IDS;
export const ALL_LAYERS = Object.fromEntries(LAYERS.map((l) => [l, true]));
export const MAX_CHORDS = 8;
const STORAGE_KEY = 'backingtrack.lang';

export const $ = (id) => document.getElementById(id);
export { chordName }; // Name mit Symbol aus dem Akkord-Register
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
    layers: layerDefaults(),
    jobs: completeJobs(), // Aufgabe je Schicht mit Aufgaben (Lead, Percussion)
    seed: rollVariant(), // Variantennummer
    variety: true, // reichere Varianten: der Seed streut Muster-Werte und Klang stärker (siehe docs/superpowers/specs/2026-11-09-variant-richness-design.md)
    length: 96,
    meter: [4, 4], // Taktart; groove und complexity fehlen, bis der Nutzer sie wählt (Standard-Groove der Taktart, Komplexität 0,5)
  },
  formTarget: 96, // Zielgröße der Songform (Takte); ohne Form ist sie die Länge
  formSalt: 0, // wie oft "Neu würfeln" bei dieser Variante gedrückt wurde (siehe roll)
  formFeel: { ...FEEL_DEFAULTS }, // Reglerwerte Struktur, Dynamik, Pausen, Zufall; bleiben auch ohne Form stehen
  scale: 'minorPentatonic',
  chordColor: 'triads', // Akkordfarbe: wie erzeugte Folgen gefärbt werden (triads, sevenths, extended, power); deriveBars wendet sie an
  chordColorFromStyle: true, // true: die Farbe kommt vom Stil (und folgt der Variante), false: der Nutzer hat sie gewählt
  style: 'funk',
  playing: false,
  lang: readLang(),
  page: 'start', // 'start' | 'play'
  layout: loadLayout(layoutStorage), // Fokus/Einstellen, Beschriftung, Bünde; Änderungen über saveLayout
  mix: loadMix(layoutStorage), // Mischpult-Regler { <Schicht-ids>, master }, je 0..1; Änderungen über saveMix
  current: null, // { bar, chord } aus onBar
  errors: [], // [{ code, params }], übersetzt erst in render()
  notice: null, // Schlüssel einer Hinweis-Meldung der Akkordfolge, z. B. volle Folge
};

// Die aus Tonart und Variante erzeugte Folge in einer Akkordfarbe, ohne den Zustand zu ändern
export const derivedBars = (color = state.chordColor) => {
  const beats = METERS[meterKey(state.track.meter)].beats; // Schläge der Taktart
  const bars = progressionFor(state.track.key, state.track.seed).map((chord) => ({ chord, beats }));
  return colorProgression(bars, color, state.track.key);
};

// Folge aus Tonart und Variante in der gewählten Akkordfarbe; überschreibt eigene Änderungen (nur bei Tonart, Skala, Variante)
export const deriveBars = () => {
  state.notice = null;
  // Farbe vom Stil: mit variety kann die Variante die Ausweichfarbe des Stils wählen
  if (state.chordColorFromStyle) state.chordColor = styleChordColor(preset(state.style), state.track.seed, state.track.variety);
  state.track.bars = derivedBars();
};

// Akkordfarbe setzen: eine unveränderte erzeugte Folge wird in der neuen Farbe neu abgeleitet (verlustfrei, auch von Powerchords aus),
// eine von Hand geänderte umgefärbt
export function setChordColor(color) {
  const untouched = JSON.stringify(state.track.bars) === JSON.stringify(derivedBars(state.chordColor));
  state.chordColor = color;
  if (untouched) deriveBars();
  else state.track.bars = colorProgression(state.track.bars, color, state.track.key);
  state.notice = null;
}

// Stil-Vorlage: Tempo, Schlagworte und Akkordfarbe (die Folge wird umgefärbt, Variante und Tonart bleiben)
export function applyStyle(id) {
  const p = preset(id);
  state.style = id;
  state.chordColorFromStyle = true;
  setChordColor(styleChordColor(p, state.track.seed, state.track.variety));
  // das Stiltempo ist ein Viertel-Tempo: in 6/8 und 12/8 (Puls = punktierte Viertel) gilt dieselbe Achtelgeschwindigkeit
  state.track.bpm = convertTempo(p.bpm, '4/4', meterKey(state.track.meter));
  state.track.tags = structuredClone(p.tags);
  state.track.timbre = {}; // neue Vorlage, neuer Ausgangspunkt für die Regler
  if (state.track.form?.auto) rollNewForm(); // Vorlage Auto folgt dem Stil (gesperrte Teile bleiben)
}

// Taktart wechseln: der Standard-Groove der Taktart gilt, das Tempo wird umgerechnet (convertTempo), die Takte der Folge bekommen die
// Schläge der Taktart (die Akkorde bleiben). Liefert false, wenn es dieselbe oder keine unterstützte Taktart ist.
export function setMeter(key) {
  const prev = meterKey(state.track.meter);
  if (!Object.hasOwn(METERS, key) || key === prev) return false;
  // Tempo als unabgerundeter Viertel-Wert führen: solange der Nutzer es nicht anfasst, gibt jeder Wechsel (auch über mehrere
  // Taktarten und zurück) wieder genau das alte Tempo, ohne Rundungsabweichung (100, 67, 101) und ohne Klemmen an 40 und 200
  const ref = state.tempoRef;
  const untouched = ref && ref.key === prev && ref.shown === state.track.bpm;
  const quarter = untouched ? ref.quarter : state.track.bpm * (METERS[prev].sub === 3 ? 3 / 2 : 1);
  const bpm = Math.min(200, Math.max(40, Math.round(quarter * (METERS[key].sub === 3 ? 2 / 3 : 1))));
  state.tempoRef = { key, quarter, shown: bpm };
  state.track.meter = key.split('/').map(Number);
  delete state.track.groove;
  state.track.bpm = bpm;
  state.track.bars = state.track.bars.map((bar) => ({ ...bar, beats: METERS[key].beats }));
  return true;
}

// --- Songform: Vorlage, Zielgröße und Regler; die Form selbst steht in state.track.form (fehlt = "Ohne Form") ---

/** Gewählte Vorlage: 'auto', eine Vorlagen-id oder 'off' (keine Form). */
export const formChoice = (track = state.track) => (track.form ? (track.form.auto ? 'auto' : track.form.template) : 'off');

// Reglerwerte: die der Form, sonst die gemerkten
const feelNow = () => state.track.form?.feel ?? state.formFeel;

// salt 0: die Form folgt allein der Variante (gleiche Eingaben, gleiche Form); "Neu würfeln" zählt ihn hoch, damit dieselbe Variante andere Teile zieht
function roll(choice, previous, salt = 0) {
  const { seed, tags } = state.track;
  const form = rollForm({ template: choice, style: state.style, targetBars: state.formTarget, feel: feelNow(), seed: seed + salt * 10000, tags, previous });
  state.formSalt = salt;
  state.track.form = form;
  state.track.length = formLength(form);
}

/** Würfelt die nicht gesperrten Teile neu (Variante, Stilwechsel mit Auto, Struktur-Regler); ohne Form nichts. reroll: dieselbe Variante, andere Teile ("Neu würfeln"). */
export function rollNewForm({ reroll = false } = {}) {
  if (state.track.form) roll(formChoice(), state.track.form, reroll ? state.formSalt + 1 : 0);
}

/** Vorlage wechseln würfelt alles neu (Sperren fallen); 'off' entfernt die Form, die Länge ist dann die Zielgröße. */
export function setFormTemplate(choice) {
  if (choice === 'off') {
    delete state.track.form;
    state.track.length = state.formTarget;
  } else roll(choice);
}

/** Zielgröße wechseln würfelt alles neu (Sperren fallen); ohne Form ist sie die Länge. */
export function setFormTarget(bars) {
  state.formTarget = bars;
  if (state.track.form) roll(formChoice());
  else state.track.length = bars;
}

/** Einen Regler setzen (0..1, Dynamik bis DYNAMICS_MAX); würfelt nicht neu. */
export function setFormFeel(name, value) {
  state.formFeel = { ...feelNow(), [name]: value };
  if (state.track.form) state.track.form = { ...state.track.form, feel: { ...state.formFeel } };
}
