// Akkordrad: Quintenzirkel auf Canvas. Jetziger Akkord pink, nächster türkis (beide gefüllt, Text dunkel), Akkorde der Tonart grau
// hinterlegt, Akkorde der Folge kräftig umrandet und gestrichelt verbunden; in der Mitte die Tonart als LCD-Kreis.
// Geometrie und Trefferprüfung in wheel-geometry.js.
import { allowedChords, diatonicChords, noteToPc } from '../core/music.js';
import { layoutWheel, hitTest, nodeMatches } from './wheel-geometry.js';
import { chordShort } from '../core/chords.js';
import { fitCanvas, cssColors } from './canvas.js';

const same = (a, b) => noteToPc(a.root) === noteToPc(b.root) && a.quality === b.quality;

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
    const nodeOf = (chord) => l.nodes.find((n) => nodeMatches(n, chord, current.key));

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

    const inProgression = (chord) => current.progression.some((p) => same(p, chord));
    for (const n of l.nodes) {
      const chord = allowedAt(n);
      const isCurrent = chord && current.current && nodeMatches(n, current.current, current.key);
      const isNext = !isCurrent && chord && current.next && nodeMatches(n, current.next, current.key);
      const isDiatonic = chord && diatonic.some((d) => same(d, chord));
      ctx.globalAlpha = chord ? 1 : 0.3;
      ctx.setLineDash(chord && !isDiatonic ? [4, 3] : []); // Dur-Dominante in Moll
      ctx.lineWidth = chord && inProgression(chord) ? 3 : 1.5;
      ctx.fillStyle = isCurrent ? c.accent : isNext ? c.accent2 : isDiatonic ? c.diatonic : c.paper;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = chord ? 1 : 0.45;
      ctx.fillStyle = isCurrent || isNext ? c.onAccent : c.ink;
      ctx.font = `${Math.max(11, Math.round(n.r * 0.72))}px ${c.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(chordShort(chord ?? n.chord), n.x, n.y);
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    // Mitte: Tonart als LCD-Kreis, darunter der nächste Akkord in der zweiten Farbe
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
    ctx.fillText(keyName, l.cx, l.cy - (current.next ? lcdR * 0.14 : 0));
    if (current.next) {
      ctx.fillStyle = c.lcdInk2;
      ctx.font = `${Math.max(11, Math.round(lcdR * 0.32))}px ${c.mono}`;
      ctx.fillText(`→ ${chordShort(current.next)}`, l.cx, l.cy + lcdR * 0.42);
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
