// Percussion-Stimme: eine Aufgabe (Job) je Track, gespielt Takt für Takt hinter dem Schlagzeug (alle Anschläge unter 0.8).
// Die Muster folgen dem Raster des Grooves (Schläge, Schritte je Schlag `b.sub` 3 oder 4); die Dichte folgt drive und syncopation
// über dieselben Schwellen wie das Schlagzeug, das Timing swing (über `at`). Reine Logik ohne Audio.
import { at, humanVel } from './event-helpers.js';
import { grooveCycle, levelOf } from './grooves.js';

const hit = (b, rng, params, s, name, vel) =>
  ({ t: at(b, s, rng, params.swing), bar: b.index, beat: s / b.sub, type: 'hit', layer: 'percussion', name, vel: humanVel(vel, rng) });

// Dichtestufe 0 bis 2: drive trägt, syncopation hebt sie leicht an
const levelFor = (params, g) => levelOf(0.7 * params.drive + 0.3 * params.syncopation, g.drums.thresholds);

// Muster über zwei Schläge, danach wiederholt: [Schritt, Name, Anschlag, ab Stufe]; Schlüssel = Schritte je Schlag
const CONGAS = {
  4: [[0, 'congaLow', 0.5, 0], [3, 'congaHigh', 0.45, 1], [4, 'congaHigh', 0.55, 0], [6, 'congaLow', 0.6, 0], [7, 'congaHigh', 0.45, 2]], // Tumbao
  3: [[0, 'congaLow', 0.5, 0], [2, 'congaHigh', 0.45, 1], [3, 'congaHigh', 0.55, 0], [4, 'congaLow', 0.6, 0], [5, 'congaHigh', 0.4, 2]],
};
const BONGOS = {
  4: [[0, 'bongoLow', 0.5, 0], [2, 'bongoHigh', 0.4, 1], [4, 'bongoLow', 0.55, 0], [6, 'bongoHigh', 0.45, 0], [7, 'bongoHigh', 0.4, 2]], // Martillo
  3: [[0, 'bongoLow', 0.5, 0], [2, 'bongoHigh', 0.4, 1], [3, 'bongoLow', 0.55, 0], [4, 'bongoHigh', 0.45, 0], [5, 'bongoHigh', 0.4, 2]],
};
const SON_CLAVE = [0, 3, 6, 10, 12]; // 3-2-Son-Clave in 16 Schritten, auf den Zyklus des Grooves skaliert

// Muster aus der Tabelle über die ganze Takt-Länge, wiederholt alle zwei Schläge
function table(rows, b, rng, params, g) {
  const level = levelFor(params, g);
  const period = 2 * b.sub;
  const out = [];
  for (let s = 0; s < b.steps; s++) for (const [p, name, vel, min] of rows[b.sub]) if (s % period === p && level >= min) out.push(hit(b, rng, params, s, name, vel));
  return out;
}

// Shaker: jeder Rasterschritt, Betonung auf dem Schlag, mit drive lauter
function shaker(b, rng, params) {
  const gain = 0.8 + 0.4 * params.drive;
  return Array.from({ length: b.steps }, (_, s) => hit(b, rng, params, s, 'shaker', (s % b.sub === 0 ? 0.5 : s % 2 ? 0.28 : 0.36) * gain));
}

// Tambourin: auf den Backbeat-Schritten (Snare der zweiten Stufe), ab Stufe 1 dazu die Achtel dazwischen
function tambourine(b, rng, params, g) {
  const level = levelFor(params, g);
  const cycle = grooveCycle(g);
  const back = new Set(g.drums.tiers[1].snare);
  const weak = Math.round(b.sub / 2);
  const out = [];
  for (let s = 0; s < b.steps; s++) {
    if (back.has(s % cycle)) out.push(hit(b, rng, params, s, 'tambourine', 0.62));
    else if (level >= 1 && s % b.sub === weak) out.push(hit(b, rng, params, s, 'tambourine', 0.3));
  }
  return out;
}

// Claves: Son-Clave auf den Zyklus skaliert; Stufe 0 spielt die drei Schläge der ersten Seite, jede Stufe einen mehr
function claves(b, rng, params, g) {
  const cycle = grooveCycle(g);
  const steps = new Set(SON_CLAVE.map((x) => Math.round((x * cycle) / 16)));
  const keep = [...steps].slice(0, 3 + levelFor(params, g));
  const out = [];
  for (let s = 0; s < b.steps; s++) if (keep.includes(s % cycle)) out.push(hit(b, rng, params, s, 'claves', 0.6));
  return out;
}

// Kuhglocke: auf den Schlägen (Stufe 0 nur auf jedem zweiten), auf Stufe 2 dazu die Achtel dazwischen
function cowbell(b, rng, params, g) {
  const level = levelFor(params, g);
  const out = [];
  for (let s = 0; s < b.steps; s++) {
    const beat = Math.floor(s / b.sub);
    if (s % b.sub === 0 && (level >= 1 || beat % 2 === 0)) out.push(hit(b, rng, params, s, 'cowbell', beat % 2 ? 0.45 : 0.55));
    else if (level >= 2 && s % b.sub === Math.round(b.sub / 2)) out.push(hit(b, rng, params, s, 'cowbell', 0.3));
  }
  return out;
}

/** Aufgaben der Percussion: (Takt, rng, params, Groove) -> Treffer. */
export const PERCUSSION_JOBS = Object.freeze({
  mixed: (b, rng, params, g) => [...shaker(b, rng, params), ...tambourine(b, rng, params, g), ...table(CONGAS, b, rng, params, g)],
  shaker,
  tambourine,
  congas: (b, rng, params, g) => table(CONGAS, b, rng, params, g),
  bongos: (b, rng, params, g) => table(BONGOS, b, rng, params, g),
  claves,
  cowbell,
});

export const percussionPlayer = Object.freeze({
  section: () => null,
  play: (b, _v, rng, params, _fill, g, job) => PERCUSSION_JOBS[job]?.(b, rng, params, g) ?? [],
});
