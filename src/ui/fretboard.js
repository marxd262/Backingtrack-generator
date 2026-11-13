// Griffbrett-Block: SVG in Pixeln des Behälters aufbauen (6 Saiten, Bünde 0..22, hohe e-Saite oben); neu aufgebaut wird nur bei
// neuer Größe oder anderem Bundabstand. update() ändert sonst nur Rollen, Sichtbarkeit und Beschriftung, und nur bei Änderung
// (render läuft je Takt). Farben und Formen stehen in app.css.
import { fretboardNotes, STANDARD_TUNING, FRETS } from '../core/fretboard.js';
import { chordMidi, noteName } from '../core/music.js';
import { t } from '../index.js';
import { chordName, setAttr, setText } from './state.js';

const NS = 'http://www.w3.org/2000/svg';
const MIN_W = 640; // schmaler wird der Behälter waagerecht gescrollt, das Brett bleibt so breit
const NUT_X = 46; // links davon die Leersaiten-Töne
const PAD = 8; // das Brett ragt so weit über die äußeren Saiten
const NUM_H = 18; // eigene Zeile der Bundzahlen unter dem Brett
const NOTE_R = 11; // Notenradius, in engen Bünden höchstens 40 % der Bundbreite
const MARKS = [3, 5, 7, 9, 12, 15, 17, 19, 21];

function el(name, attrs, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent.append(node);
  return node;
}

const roles = (n) => [
  n.scale && 'scale',
  n.current && n.next ? 'both' : n.current ? 'current' : n.next && 'next',
  n.root && 'root',
  !n.scale && 'outside', // sichtbar und nicht in der Leiter: Akkordton außerhalb
].filter(Boolean).join(' ');

export function createFretboard(container) {
  let svg = null;
  let cells = [];
  let built = '';
  let view = null;
  let last = '';

  // Neu aufbauen, wenn Größe oder Bundabstand nicht mehr stimmen; ohne Größe (versteckt) bleibt es leer
  function layout(spacing) {
    const w = Math.max(container.clientWidth, MIN_W);
    const h = container.clientHeight;
    if (!container.clientWidth || !h) return;
    const id = `${w}x${h}${spacing}`;
    if (id === built) return;
    built = id;
    last = '';
    svg?.remove();

    const right = w - 6;
    const sh = Math.max((h - NUM_H - 4 - 2 * PAD) / 5, 0);
    const stringY = (string) => 2 + PAD + string * sh;
    const boardH = 5 * sh + 2 * PAD;
    // echt: Abstand zum Sattel = Mensur * (1 - 2^(-n/12)), Bund 22 endet am Rand; gleich: alle Bünde gleich breit
    const span = right - NUT_X;
    const scaleLength = span / (1 - 2 ** (-FRETS / 12));
    const wireX = (n) => NUT_X + (spacing === 'even' ? (n * span) / FRETS : scaleLength * (1 - 2 ** (-n / 12)));
    const noteX = (fret) => (fret === 0 ? NUT_X / 2 : (wireX(fret - 1) + wireX(fret)) / 2);

    svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img', 'aria-label': t('ui.fretboardLabel'), 'data-i18n-label': 'ui.fretboardLabel', class: 'fretboard' }, container);
    el('rect', { class: 'board', x: NUT_X, y: 2, width: right - NUT_X, height: boardH }, svg);
    for (const fret of MARKS) el('rect', { class: 'mark', x: wireX(fret - 1), y: 2, width: wireX(fret) - wireX(fret - 1), height: boardH }, svg);
    for (const fret of MARKS) {
      const ys = fret === 12 ? [1.5, 3.5] : [2.5];
      for (const y of ys) el('circle', { class: 'inlay', cx: noteX(fret), cy: stringY(0) + y * sh, r: 6.5 }, svg);
    }
    for (let fret = 1; fret <= FRETS; fret++) {
      el('line', { class: 'fret-wire', 'data-fret': fret, x1: wireX(fret), x2: wireX(fret), y1: 2, y2: 2 + boardH }, svg);
      const num = el('text', { class: 'fret-num', 'data-fret': fret, x: noteX(fret), y: h - 4 }, svg);
      if (MARKS.includes(fret)) num.textContent = String(fret);
    }
    el('line', { class: 'nut', x1: NUT_X, x2: NUT_X, y1: 2, y2: 2 + boardH }, svg);
    STANDARD_TUNING.forEach((_, string) => {
      // tiefere Saiten dicker
      el('line', { class: 'string', x1: 4, x2: right, y1: stringY(string), y2: stringY(string), 'stroke-width': 0.8 + string * 0.3 }, svg);
    });

    cells = [];
    STANDARD_TUNING.forEach((_, string) => {
      for (let fret = 0; fret <= FRETS; fret++) {
        const r = fret === 0 ? NOTE_R : Math.min(NOTE_R, 0.4 * (wireX(fret) - wireX(fret - 1)));
        const g = el('g', { class: 'fret-note', 'data-string': string, 'data-fret': fret, 'data-role': '', hidden: '', style: `--r:${r.toFixed(1)}px`, transform: `translate(${noteX(fret).toFixed(1)} ${stringY(string).toFixed(1)})` }, svg);
        el('circle', { class: 'ring' }, g);
        el('rect', { class: 'dot' }, g);
        cells.push({ g, text: el('text', {}, g), id: `${string}:${fret}` });
      }
    });
  }

  function paint() {
    const { key, scale, current, next, labels } = view;
    const id = JSON.stringify(view);
    if (!svg || id === last) return;
    last = id;
    const found = new Map(fretboardNotes({ key, scale, current, next }).map((n) => [`${n.string}:${n.fret}`, n]));
    for (const { g, text, id: cell } of cells) {
      const n = found.get(cell);
      if (!n) {
        if (!g.hasAttribute('hidden')) g.setAttribute('hidden', '');
        setAttr(g, 'data-role', '');
        continue;
      }
      if (g.hasAttribute('hidden')) g.removeAttribute('hidden');
      setAttr(g, 'data-role', roles(n));
      setText(text, labels === 'degrees' ? n.degree : n.name);
    }
  }

  return {
    // view: { key, scale, current, next, labels: 'names'|'degrees', spacing: 'real'|'even' }
    update(next) {
      view = next;
      layout(view.spacing);
      paint();
    },
    // Behälter hat eine andere Größe: neu aufbauen und die letzte Ansicht wieder zeichnen
    resize() {
      if (!view) return;
      layout(view.spacing);
      paint();
    },
  };
}

// Textfassung für Screenreader: "Jetzt: Am (A, C, E). Als Nächstes: Dm (D, F, A)"; ohne folgenden nur der erste Teil
export function chordSentence(key, current, next) {
  if (!current) return '';
  const part = (k, chord) => t(k, { chord: chordName(chord), notes: chordMidi(chord, 3).map((m) => noteName(key, m % 12)).join(', ') });
  return next ? `${part('ui.fretboardNow', current)}. ${part('ui.fretboardNext', next)}` : part('ui.fretboardNow', current);
}
