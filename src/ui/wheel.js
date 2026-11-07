// Akkordrad: Quintenzirkel auf Canvas. Passende Akkorde kräftig umrandet, die Folge gestrichelt verbunden,
// der aktuelle Akkord als einziges farbiges Objekt. Geometrie und Trefferprüfung in wheel-geometry.js.
import { allowedChords, diatonicChords, noteToPc } from '../core/music.js';
import { layoutWheel, hitTest } from './wheel-geometry.js';
import { fitCanvas, cssColors } from './canvas.js';

const same = (a, b) => noteToPc(a.root) === noteToPc(b.root) && a.quality === b.quality;
const label = (c) => c.root + { maj: '', min: 'm', dim: '°' }[c.quality];

export function createWheel(canvas, state, onPick) {
  let current = state;
  // erlaubter Akkord zu einem Knoten, in der Schreibweise der Tonart (C# statt Db), sonst null
  const allowedAt = (node) => allowedChords(current.key).find((c) => same(c, node.chord)) ?? null;

  canvas.addEventListener('click', (e) => {
    const node = hitTest(layoutWheel(canvas.clientWidth, current.key), e.offsetX, e.offsetY);
    const chord = node && allowedAt(node);
    if (chord) onPick({ ...chord });
  });

  function draw() {
    const fit = fitCanvas(canvas);
    if (!fit) return;
    const { ctx } = fit;
    const c = cssColors(canvas);
    const l = layoutWheel(fit.width, current.key);
    const diatonic = diatonicChords(current.key);
    const nodeOf = (chord) => l.nodes.find((n) => same(n.chord, chord));

    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    for (const r of [l.outerRadius, l.innerRadius]) {
      ctx.beginPath();
      ctx.arc(l.cx, l.cy, r, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Wege der Folge, zurück zum ersten Akkord
    const path = current.progression.map(nodeOf).filter(Boolean);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    path.forEach((a, i) => {
      const b = path[(i + 1) % path.length];
      if (a === b) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    for (const n of l.nodes) {
      const chord = allowedAt(n);
      const isCurrent = chord && current.current && same(n.chord, current.current);
      ctx.globalAlpha = chord ? 1 : 0.3;
      ctx.setLineDash(chord && !diatonic.some((d) => same(d, chord)) ? [4, 3] : []); // Dur-Dominante in Moll
      ctx.lineWidth = chord ? 2.5 : 1;
      ctx.fillStyle = isCurrent ? c.accent : c.paper;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, 2 * Math.PI);
      ctx.fill();
      if (!isCurrent) ctx.stroke();
      ctx.globalAlpha = chord ? 1 : 0.45;
      ctx.fillStyle = isCurrent ? c.onAccent : c.ink;
      ctx.font = `${Math.round(n.r * 0.72)}px ${c.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label(chord ?? n.chord), n.x, n.y);
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  draw();
  return {
    update(next) {
      current = next;
      draw();
    },
  };
}
