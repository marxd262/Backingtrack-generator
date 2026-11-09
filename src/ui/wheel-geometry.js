// Akkordrad als reine Geometrie: Knotenpositionen und Trefferprüfung, ohne DOM (läuft auch in Node-Tests).
import { diatonicChords, noteToPc, stepBase } from '../core/music.js';

// Quintenzirkel ab C oben im Uhrzeigersinn; innen die Moll-Parallele (kleine Terz tiefer)
export const FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const RELATIVE_MINORS = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'Bb', 'F', 'C', 'G', 'D'];

// Anteile von size: Ringradien und Knotenradien, so dass sich keine zwei Knoten berühren
const OUTER = 0.4;
const INNER = 0.25;
const OUTER_NODE = 0.06;
const INNER_NODE = 0.055;

/**
 * Gehört der Akkord zu diesem Knoten? Gleicher Grundton (nach Tonhöhe) und die Ring-Grundart des Knotens ist die Grundart der
 * Stufe des Akkords in der Tonart: Am7 trifft Am (innen), E7 in A-Moll die Dur-Dominante E (außen), Em7 und Esus4 den Knoten Em.
 */
export const nodeMatches = (node, chord, key) => noteToPc(node.chord.root) === noteToPc(chord.root) && node.chord.quality === stepBase(chord, key);

/**
 * Knoten des Rads für ein Quadrat der Kantenlänge size. Mit Tonart wird außen der Dur-Akkord durch den
 * verminderten ersetzt, wenn die Tonart auf diesem Grundton einen verminderten Akkord hat (B° in A-Moll).
 * @returns {{ size, cx, cy, outerRadius, innerRadius, nodes: { ring: 'outer'|'inner', index, x, y, r, chord }[] }}
 */
export function layoutWheel(size, key) {
  const c = size / 2;
  const dim = key ? diatonicChords(key).filter((ch) => ch.quality === 'dim').map((ch) => noteToPc(ch.root)) : [];
  const ring = (name, radius, r, roots, quality) => roots.map((root, index) => {
    const a = ((index * 30 - 90) * Math.PI) / 180;
    const q = name === 'outer' && dim.includes(noteToPc(root)) ? 'dim' : quality;
    return { ring: name, index, x: c + radius * Math.cos(a), y: c + radius * Math.sin(a), r: r * size, chord: { root, quality: q } };
  });
  return {
    size, cx: c, cy: c, outerRadius: OUTER * size, innerRadius: INNER * size,
    nodes: [...ring('outer', OUTER * size, OUTER_NODE, FIFTHS, 'maj'), ...ring('inner', INNER * size, INNER_NODE, RELATIVE_MINORS, 'min')],
  };
}

/** Knoten unter dem Punkt (x, y) oder null. */
export const hitTest = (layout, x, y) => layout.nodes.find((n) => (x - n.x) ** 2 + (y - n.y) ** 2 <= n.r ** 2) ?? null;
