// Akkordrad: Quintenzirkel auf Canvas. Jetziger Akkord pink, nächster türkis (beide gefüllt, Text dunkel), Akkorde der Tonart grau
// hinterlegt, Akkorde der Folge kräftig umrandet und gestrichelt verbunden; in der Mitte die Tonart als LCD-Kreis.
// Geometrie und Trefferprüfung in wheel-geometry.js; was an jedem Knoten liegt, gibt derived().wheel, den klingenden und den nächsten
// Knoten position().wheel.
import { layoutWheel, hitTest } from './wheel-geometry.js';
import { fitCanvas, cssColors } from './canvas.js';

// state: { key, wheel (derived().wheel), at (position().wheel beim Spielen, sonst null) }; onPick(chord) mit dem erlaubten Akkord eines Knotens
export function createWheel(canvas, state, onPick) {
  let current = state;
  // der Knoten von derived().wheel.nodes[k] in der Geometrie: sein Platz aus Ring und Index
  const placeOf = (l, d) => l.nodes[(d.ring === 'outer' ? 0 : 12) + d.index];

  canvas.addEventListener('click', (e) => {
    const l = layoutWheel(canvas.clientWidth);
    const node = hitTest(l, e.offsetX, e.offsetY);
    const chord = node && current.wheel.nodes.find((d) => placeOf(l, d) === node)?.allowed; // vor der ersten Antwort hat das Rad keine Knoten
    if (chord) onPick({ ...chord });
  });

  function draw() {
    const fit = fitCanvas(canvas);
    if (!fit) return;
    const { ctx } = fit;
    const c = cssColors(canvas);
    const l = layoutWheel(fit.width);
    const { nodes, path } = current.wheel;
    const at = current.at;

    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    for (const r of [l.outerRadius, l.innerRadius]) {
      ctx.beginPath();
      ctx.arc(l.cx, l.cy, r, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Wege der Folge, zurück zum ersten Akkord
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    path.forEach((a, i) => {
      const b = path[(i + 1) % path.length];
      if (a === b) return;
      const [p, q] = [placeOf(l, nodes[a]), placeOf(l, nodes[b])];
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    });

    nodes.forEach((d, k) => {
      const n = placeOf(l, d);
      const chord = d.allowed;
      const isCurrent = at !== null && k === at.current;
      const isNext = at !== null && k === at.next;
      ctx.globalAlpha = chord ? 1 : 0.3;
      ctx.setLineDash(chord && !d.diatonic ? [4, 3] : []); // Dur-Dominante in Moll
      ctx.lineWidth = d.inProgression ? 3 : 1.5;
      ctx.fillStyle = isCurrent ? c.accent : isNext ? c.accent2 : d.diatonic ? c.diatonic : c.paper;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = chord ? 1 : 0.45;
      ctx.fillStyle = isCurrent || isNext ? c.onAccent : c.ink;
      ctx.font = `${Math.max(11, Math.round(n.r * 0.72))}px ${c.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.short, n.x, n.y);
    });
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    // Mitte: Tonart als LCD-Kreis, darunter der nächste Akkord in der zweiten Farbe
    const next = at?.nextShort ?? null;
    const lcdR = l.innerRadius - l.size * 0.07;
    ctx.fillStyle = c.lcd;
    ctx.beginPath();
    ctx.arc(l.cx, l.cy, lcdR, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const keyName = `${current.key.root}${current.key.mode === 'minor' ? 'm' : ''}`;
    ctx.fillStyle = c.lcdInk;
    ctx.font = `${Math.max(14, Math.round(lcdR * 0.62))}px ${c.mono}`;
    ctx.fillText(keyName, l.cx, l.cy - (next ? lcdR * 0.14 : 0));
    if (next) {
      ctx.fillStyle = c.lcdInk2;
      ctx.font = `${Math.max(11, Math.round(lcdR * 0.32))}px ${c.mono}`;
      ctx.fillText(`→ ${next}`, l.cx, l.cy + lcdR * 0.42);
    }
  }

  draw();
  document.fonts?.addEventListener('loadingdone', draw); // die LCD-Schrift der Mitte lädt erst beim ersten Zeichnen
  return {
    update(next) {
      current = next;
      draw();
    },
  };
}
