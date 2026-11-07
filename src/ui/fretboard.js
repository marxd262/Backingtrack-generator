// Griffbrett-Block: SVG einmal aufbauen (6 Saiten, Bünde 0..15, hohe e-Saite oben), update() ändert nur Rollen,
// Sichtbarkeit und Beschriftung, und nur bei Änderung (render läuft je Takt). Farben und Formen stehen in app.css.
import { fretboardNotes, STANDARD_TUNING, FRETS } from '../core/fretboard.js';
import { chordMidi, noteName } from '../core/music.js';
import { t } from '../index.js';
import { chordName, setAttr, setText } from './state.js';

const NS = 'http://www.w3.org/2000/svg';
// Maße in SVG-Einheiten; bei der Mindestbreite (40rem) ist 1 Einheit = 1 px
const WIDTH = 640;
const NUT_X = 36; // links davon die Leersaiten-Töne
const TOP = 17;
const STRING_GAP = 30;
const HEIGHT = 2 * TOP + 5 * STRING_GAP;
const INLAYS = [3, 5, 7, 9, 12, 15];

// Bunddraht n nach 12tel-Teilung: Abstand zum Sattel = Mensur * (1 - 2^(-n/12)); Bund 15 endet kurz vor dem Rand
const SCALE_LENGTH = (WIDTH - NUT_X - 6) / (1 - 2 ** (-FRETS / 12));
const wireX = (n) => NUT_X + SCALE_LENGTH * (1 - 2 ** (-n / 12));
const noteX = (fret) => (fret === 0 ? NUT_X / 2 : (wireX(fret - 1) + wireX(fret)) / 2);
const stringY = (string) => TOP + string * STRING_GAP;

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
  const svg = el('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', 'data-i18n-label': 'ui.fretboardLabel', class: 'fretboard' }, container);
  const right = wireX(FRETS);
  el('rect', { class: 'board', x: NUT_X, y: TOP, width: right - NUT_X, height: 5 * STRING_GAP }, svg);
  for (const fret of INLAYS) {
    const ys = fret === 12 ? [TOP + 1.5 * STRING_GAP, TOP + 3.5 * STRING_GAP] : [TOP + 2.5 * STRING_GAP];
    for (const y of ys) el('circle', { class: 'inlay', cx: noteX(fret), cy: y, r: 4.5 }, svg);
  }
  for (let fret = 1; fret <= FRETS; fret++) el('line', { class: 'fret-wire', x1: wireX(fret), x2: wireX(fret), y1: TOP, y2: stringY(5) }, svg);
  el('line', { class: 'nut', x1: NUT_X, x2: NUT_X, y1: TOP - 2, y2: stringY(5) + 2 }, svg);
  STANDARD_TUNING.forEach((_, string) => {
    // tiefere Saiten dicker
    el('line', { class: 'string', x1: 4, x2: right, y1: stringY(string), y2: stringY(string), 'stroke-width': 0.8 + string * 0.3 }, svg);
  });

  const cells = [];
  STANDARD_TUNING.forEach((_, string) => {
    for (let fret = 0; fret <= FRETS; fret++) {
      const g = el('g', { class: 'fret-note', 'data-string': string, 'data-fret': fret, 'data-role': '', hidden: '', transform: `translate(${noteX(fret).toFixed(1)} ${stringY(string)})` }, svg);
      el('circle', { class: 'ring' }, g);
      el('rect', { class: 'dot' }, g);
      cells.push({ g, text: el('text', {}, g), id: `${string}:${fret}` });
    }
  });

  let last = '';
  return {
    update(view) {
      const id = JSON.stringify(view);
      if (id === last) return;
      last = id;
      const { key, scale, current, next, labels } = view;
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
    },
  };
}

// Textfassung für Screenreader: "Jetzt: Am (A, C, E). Als Nächstes: Dm (D, F, A)"; ohne folgenden nur der erste Teil
export function chordSentence(key, current, next) {
  if (!current) return '';
  const part = (k, chord) => t(k, { chord: chordName(chord), notes: chordMidi(chord, 3).map((m) => noteName(key, m % 12)).join(', ') });
  return next ? `${part('ui.fretboardNow', current)}. ${part('ui.fretboardNext', next)}` : part('ui.fretboardNow', current);
}
