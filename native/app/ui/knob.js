// Drehknopf über einem echten Range-Input: das Input bleibt Quelle des Werts, Fokus- und Tastaturträger und trägt die
// Beschriftung (<label for>, aria-valuetext); der Knopf ist nur sein Bild (SVG) plus Ziehen, Mausrad und Doppelklick.
import { knobAngle, knobArc } from './knob-geometry.js';

const NS = 'http://www.w3.org/2000/svg';
const DRAG_PX = 200; // Pixel senkrecht für die volle Spanne
const R = 20; // Kappenradius im viewBox; Bogen und Rand liegen außen
const ARC_R = R + 3.5;
const BOX = 28;
const knobs = new Set();

const svg = (name, attrs) => {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const point = (r, deg) => [Math.sin((deg * Math.PI) / 180) * r, -Math.cos((deg * Math.PI) / 180) * r];
const arcPath = (a, b) => {
  const [x1, y1] = point(ARC_R, a);
  const [x2, y2] = point(ARC_R, b);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${ARC_R},${ARC_R} 0 ${b - a > 180 ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
};

// Kappe nach Art: weiß (Hauptregler), türkis/pink (Makros), schwarz; der Zeiger zeigt auf 12 Uhr und wird gedreht
function capParts(kind) {
  if (kind === 'white') return [svg('circle', { r: R, fill: '#111' }), svg('circle', { r: R * 0.8, fill: '#fbfbf9' })];
  if (kind === 'teal' || kind === 'pink') return [svg('circle', { r: R, fill: '#111' }), svg('circle', { r: R * 0.74, fill: `var(--${kind})` })];
  return [svg('circle', { r: R, fill: '#141414' })];
}

/** Umhüllt ein Range-Input mit dem Knopf. sync() zeichnet nach, wenn sich Wert oder Spanne geändert haben (nicht während des Ziehens). */
export function createKnob(input, { origin = 'start', size = 'm', kind = 'black', resetValue } = {}) {
  const wrap = document.createElement('span');
  wrap.className = `knob knob--${size} knob--${kind}`;
  const view = svg('svg', { viewBox: `${-BOX} ${-BOX} ${2 * BOX} ${2 * BOX}`, 'aria-hidden': 'true' });
  const pointerColor = kind === 'white' ? '#111' : kind === 'black' ? '#f2f2f2' : '#fff';
  const pointer = svg('g', {});
  pointer.append(svg('line', { x1: 0, y1: -R * (kind === 'black' ? 0.25 : 0.1), x2: 0, y2: -R * 0.95, stroke: pointerColor, 'stroke-width': 2.4, 'stroke-linecap': 'round' }));
  view.append(svg('path', { d: arcPath(-135, 135), class: 'knob-track' }), ...capParts(kind), pointer);
  const arc = svg('path', { class: 'knob-arc' });
  input.before(wrap);
  wrap.append(input, view);

  const range = () => ({ min: input.min === '' ? 0 : Number(input.min), max: input.max === '' ? 100 : Number(input.max) });
  let drawn = '';
  let dragging = false;
  const draw = () => {
    const { min, max } = range();
    const key = `${input.value}|${min}|${max}`;
    if (key === drawn) return;
    drawn = key;
    const value = Number(input.value);
    pointer.setAttribute('transform', `rotate(${knobAngle(value, min, max)})`);
    const a = knobArc(value, min, max, origin);
    if (!a) return arc.remove();
    arc.setAttribute('d', arcPath(a.from, a.to));
    arc.dataset.side = a.side;
    if (!arc.isConnected) view.append(arc);
  };

  // Wert über das Input setzen (es begrenzt und rastet selbst) und wie ein Nutzer melden
  const set = (v, { final = true } = {}) => {
    const before = input.value;
    input.value = String(v);
    if (input.value === before) return false;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (final) input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };

  let start = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || input.disabled) return;
    wrap.setPointerCapture(e.pointerId);
    input.focus({ preventScroll: true });
    start = { y: e.clientY, value: Number(input.value), changed: false };
    dragging = true;
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!start) return;
    const { min, max } = range();
    start.changed = set(start.value + ((start.y - e.clientY) / DRAG_PX) * (max - min), { final: false }) || start.changed;
  });
  const release = () => {
    if (!start) return;
    const { changed } = start;
    start = null;
    dragging = false;
    if (changed) input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  wrap.addEventListener('pointerup', release);
  wrap.addEventListener('pointercancel', release);
  wrap.addEventListener('lostpointercapture', release);

  wrap.addEventListener('wheel', (e) => {
    if (input.disabled || !e.deltaY || e.shiftKey) return; // Umschalt+Rad scrollt das Rack
    e.preventDefault();
    const { min, max } = range();
    const step = Number(input.step) > 0 ? Number(input.step) : (max - min) / 100; // step="any": 1 % der Spanne
    set(Number(input.value) + (e.deltaY < 0 ? step : -step));
  }, { passive: false });

  wrap.addEventListener('dblclick', () => {
    if (input.disabled) return;
    if (input.dataset.reset) return document.getElementById(input.dataset.reset)?.click();
    const { min, max } = range();
    set(resetValue ?? (origin === 'center' ? (min + max) / 2 : min));
  });

  input.addEventListener('input', draw); // Tastatur und Programm zeichnen sofort, auch beim Ziehen
  const knob = { wrap, sync: () => { if (!dragging) draw(); } };
  knobs.add(knob);
  draw();
  return knob;
}

/** Alle Knöpfe nachzeichnen (render() läuft je Takt; nur geänderte zeichnen). Entfernte Knöpfe fallen aus der Liste. */
export function syncKnobs() {
  for (const k of knobs) {
    if (k.wrap.isConnected) k.sync();
    else knobs.delete(k);
  }
}
