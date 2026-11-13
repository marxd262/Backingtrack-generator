// Verlauf: eine Spur je Schicht über alle Takte, ohne Text (Beschriftung sind die Schicht-Knöpfe daneben).
import { fitCanvas, cssColors } from './canvas.js';
import { LAYER_IDS } from '../core/layers.js';

const LANES = LAYER_IDS;
const SECTION = 8; // Abschnittsgrenze alle 8 Takte, solange der Track keine Songform hat
const summaries = new WeakMap();

/** Memo-Schlüssel des Verlaufs: alles, was den Ereignisstrom ändert. Tempo und Schichten fehlen (x-Achse sind Takte, stumme Spuren werden nur gedimmt). */
export const laneKey = ({ key, bars, tags, seed, length, meter, groove, complexity, form, jobs, voices, variety }) =>
  JSON.stringify([key, bars, tags, seed, length, meter, groove, complexity, form, jobs, voices, variety]);

// Je Takt: Startzeit, Anzahl Ereignisse je Schicht, Fill-Marker und Teilanfänge der Form. Einmal je Ereignisliste.
function summarize(events) {
  const starts = [];
  const fills = [];
  const parts = [];
  const counts = Object.fromEntries(LANES.map((l) => [l, []]));
  for (const e of events) {
    if (e.type === 'chord') starts[e.bar] = e.t;
    else if (e.type === 'marker') (e.name === 'fill' ? fills : e.name === 'section' ? parts : []).push(e.bar);
    else if (counts[e.layer]) counts[e.layer][e.bar] = (counts[e.layer][e.bar] ?? 0) + 1;
  }
  const max = Object.fromEntries(LANES.map((l) => [l, Math.max(1, ...counts[l].filter(Boolean))]));
  return { starts, fills, parts, counts, max };
}

const summaryOf = (events) => {
  let s = summaries.get(events);
  if (!s) summaries.set(events, (s = summarize(events)));
  return s;
};

/** Schichten mit mindestens einem Ereignis in diesem Takt (für die LEDs an Modulen und Spuren). */
export const activeLayers = (events, bar) => new Set(LANES.filter((l) => summaryOf(events).counts[l][bar]));

/**
 * Zeichnet die Spuren; der Zeiger steht am Anfang des Takts, in dem positionSec liegt (Liedzeit wie in events).
 * layers (optional): { drums: false, ... } dimmt stumme Spuren.
 */
export function drawLanes(canvas, events, positionSec, layers = {}) {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, width, height } = fit;
  const s = summaryOf(events);
  const bars = s.starts.length;
  if (!bars) return;
  const c = cssColors(canvas);
  const bw = width / bars;
  const gap = bw > 3 ? 1 : 0;
  const lh = height / LANES.length;

  LANES.forEach((lane, i) => {
    const y = i * lh;
    const dim = layers[lane] === false ? 0.3 : 1;
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.staff;
    ctx.fillRect(0, y + 4, width, lh - 8);
    ctx.fillStyle = c.ink;
    for (let b = 0; b < bars; b++) {
      const n = s.counts[lane][b];
      if (!n) continue;
      // Block: Schicht spielt in diesem Takt; dunkler Sockel: Dichte relativ zum vollsten Takt der Schicht
      ctx.globalAlpha = 0.25 * dim;
      ctx.fillRect(b * bw, y + 8, bw - gap, lh - 16);
      const dh = ((lh - 16) * n) / s.max[lane];
      ctx.globalAlpha = 0.8 * dim;
      ctx.fillRect(b * bw, y + lh - 8 - dh, bw - gap, dh);
    }
  });

  ctx.globalAlpha = 1;
  ctx.fillStyle = c.inkSoft;
  // mit Form folgen die Linien den Teilgrenzen (Teilanfänge ab dem zweiten Teil), sonst alle 8 Takte
  const bounds = s.parts.length ? s.parts.filter((b) => b > 0) : Array.from({ length: Math.ceil(bars / SECTION) - 1 }, (_, i) => (i + 1) * SECTION);
  for (const b of bounds) ctx.fillRect(Math.round(b * bw) - 0.5, 0, 1, height);
  // Fill: kleines Dreieck über dem Ende des Takts
  ctx.fillStyle = c.ink;
  for (const b of s.fills) {
    const x = (b + 1) * bw;
    ctx.beginPath();
    ctx.moveTo(x - 6, 0);
    ctx.lineTo(x, 0);
    ctx.lineTo(x, 6);
    ctx.fill();
  }

  let bar = 0;
  while (bar + 1 < bars && s.starts[bar + 1] <= positionSec) bar++;
  ctx.fillRect(bar * bw, 0, 2, height);
}
