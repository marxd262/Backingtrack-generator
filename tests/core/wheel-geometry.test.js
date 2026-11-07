import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutWheel, hitTest, FIFTHS } from '../../src/ui/wheel-geometry.js';
import { allowedChords, noteToPc, MODE_NAMES } from '../../src/core/music.js';

const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const deg = (rad) => (((rad * 180) / Math.PI) % 360 + 360) % 360;
const outer = (layout) => layout.nodes.filter((n) => n.ring === 'outer');
const inner = (layout) => layout.nodes.filter((n) => n.ring === 'inner');

test('12 äußere und 12 innere Knoten, Quintenzirkel ab C oben im Uhrzeigersinn', () => {
  const l = layoutWheel(400);
  assert.equal(l.nodes.length, 24);
  assert.equal(outer(l).length, 12);
  assert.equal(inner(l).length, 12);
  assert.deepEqual(FIFTHS, ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F']);
  assert.deepEqual(outer(l).map((n) => n.chord.root), FIFTHS);
  assert.ok(outer(l).every((n) => n.chord.quality === 'maj'));
  // innen die Moll-Parallele: kleine Terz unter dem Dur-Grundton
  inner(l).forEach((n, i) => {
    assert.equal(n.chord.quality, 'min');
    assert.equal(noteToPc(n.chord.root), (noteToPc(FIFTHS[i]) + 9) % 12);
  });
  assert.equal(inner(l)[0].chord.root, 'A');
});

test('Knoten liegen auf ihrem Radius und Winkel', () => {
  const l = layoutWheel(400);
  assert.equal(l.cx, 200);
  assert.equal(l.cy, 200);
  assert.ok(l.outerRadius > l.innerRadius);
  for (const n of l.nodes) {
    const radius = n.ring === 'outer' ? l.outerRadius : l.innerRadius;
    assert.ok(Math.abs(Math.hypot(n.x - l.cx, n.y - l.cy) - radius) < 1e-9);
    assert.ok(Math.abs(deg(Math.atan2(n.y - l.cy, n.x - l.cx)) - deg(((n.index * 30 - 90) * Math.PI) / 180)) < 1e-9);
  }
  // C oben, G rechts davon, A-Moll innen oben
  const c = outer(l)[0];
  assert.ok(Math.abs(c.x - 200) < 1e-9 && c.y < 200);
  assert.ok(outer(l)[1].x > c.x);
});

test('jeder Punkt in einem Knoten trifft genau diesen Knoten', () => {
  const l = layoutWheel(360);
  for (const n of l.nodes) {
    for (let k = 0; k < 16; k++) {
      for (const f of [0, 0.4, 0.8, 0.99]) {
        const a = (k / 16) * 2 * Math.PI;
        assert.equal(hitTest(l, n.x + Math.cos(a) * n.r * f, n.y + Math.sin(a) * n.r * f), n);
      }
    }
  }
});

test('Punkte zwischen den Knoten und in der Mitte treffen nichts', () => {
  const l = layoutWheel(400);
  assert.equal(hitTest(l, l.cx, l.cy), null);
  assert.equal(hitTest(l, -5, -5), null);
  for (let i = 0; i < 12; i++) {
    const between = (((i * 30 + 15) - 90) * Math.PI) / 180; // zwischen zwei Nachbarn
    const at = ((i * 30 - 90) * Math.PI) / 180;
    for (const radius of [l.outerRadius, l.innerRadius]) {
      assert.equal(hitTest(l, l.cx + radius * Math.cos(between), l.cy + radius * Math.sin(between)), null);
    }
    const mid = (l.outerRadius + l.innerRadius) / 2; // zwischen den Ringen
    assert.equal(hitTest(l, l.cx + mid * Math.cos(at), l.cy + mid * Math.sin(at)), null);
  }
});

test('Layout skaliert mit size und ist deterministisch', () => {
  const a = layoutWheel(400);
  const b = layoutWheel(800);
  assert.deepEqual(layoutWheel(400), a);
  assert.equal(b.outerRadius, 2 * a.outerRadius);
  b.nodes.forEach((n, i) => {
    assert.ok(Math.abs(n.x - 2 * a.nodes[i].x) < 1e-9);
    assert.ok(Math.abs(n.y - 2 * a.nodes[i].y) < 1e-9);
    assert.ok(Math.abs(n.r - 2 * a.nodes[i].r) < 1e-9);
  });
});

test('mit Tonart: verminderter Akkord der Tonart ersetzt außen den Dur-Akkord', () => {
  const am = outer(layoutWheel(400, { root: 'A', mode: 'minor' }));
  assert.deepEqual(am.filter((n) => n.chord.quality === 'dim').map((n) => n.chord.root), ['B']);
  const c = outer(layoutWheel(400, { root: 'C', mode: 'major' }));
  assert.deepEqual(c.filter((n) => n.chord.quality === 'dim').map((n) => n.chord.root), ['B']);
});

test('jeder erlaubte Akkord jeder Tonart hat genau einen Knoten', () => {
  for (const root of ROOTS) {
    for (const mode of MODE_NAMES) {
      const key = { root, mode };
      const l = layoutWheel(400, key);
      for (const c of allowedChords(key)) {
        const hits = l.nodes.filter((n) => noteToPc(n.chord.root) === noteToPc(c.root) && n.chord.quality === c.quality);
        assert.equal(hits.length, 1, `${root} ${mode}: ${c.root}${c.quality}`);
      }
    }
  }
});
