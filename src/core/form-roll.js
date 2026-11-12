// Songform würfeln: aus Vorlage, Reglern, Zielgröße und Seed eine Reihe von Teilen ziehen, auf die Zielgröße bringen und die
// Leitplanken sichern. Reine Funktion ohne DOM; Zufall nur aus createRng(seed).fork('formgen'). Alle Zahlen stehen in den Tabellen oben.
import { createRng } from './rng.js';
import { checkForm, normalizeForm } from './form.js';
import { FEEL_DEFAULTS, DYNAMICS_MAX, FORM_LIMITS } from './form-types.js';

export const TEMPLATE_IDS = Object.freeze(['jam', 'pop', 'buildDrop', 'blues', 'rock']);
/** Auto-Zuordnung Stil -> Vorlage (unbekannter Stil: pop). */
export const STYLE_TEMPLATE = Object.freeze({ funk: 'jam', reggae: 'jam', psych: 'buildDrop', dreamy: 'pop', country: 'pop', poppunk: 'pop', blues: 'blues', rock: 'rock', hardrock: 'rock' });
export const TARGET_SIZES = Object.freeze([24, 32, 48, 64, 96, 128, 192]);

const DEFAULT_TARGET = 96;
const FALLBACK_TEMPLATE = 'pop';
/** Leitplanke 6: Mindestlänge je Typ und Höchstlänge eines Teils. */
const MIN_BARS = Object.freeze({ intro: 2, build: 2, break: 2, outro: 2, verse: 4, chorus: 4 });
const MAX_BARS = 32;
const STEP = 2; // Anpassung an die Zielgröße in Schritten von 2 Takten
const TOLERANCE = 4; // so weit darf die Summe vom Ziel abweichen (Spec: höchstens 4); die Notlösung in fit() hört dann auf
const PHRASE = 4; // Phrasenlänge: Teile sollen Vielfache davon sein
const FILLER_BARS = 8; // Länge eines Platzhalters vor einem gesperrten Teil
const LEN_FRACTION = 0.25; // Längenwahlen über diesem Anteil der Zielgröße werden nicht gezogen (kleine Ziele bekommen kurze Teile)
const MIN_CHORUS_LENGTH = 24; // Leitplanke 5: ab dieser Gesamtlänge (außer Jam) mindestens ein Refrain
const MAX_BODY_PARTS = 60; // Schutz vor endlosem Anhängen
const ATTEMPTS = 24; // Versuche, bis die Leitplanken halten; sonst der beste
const SEARCH_BUDGET = 3000; // Knoten der Typ-Suche je Versuch
const TYPE_ORDER = Object.freeze(['verse', 'chorus', 'outro', 'intro', 'break', 'build']); // Ersatzreihenfolge bei Reparatur
const CHORUS_STOP_P = 0.3; // Refrain nach Strophe/Intro beginnt mit Stopp (bei Struktur-Standard)
const STOP_AFTER = Object.freeze(['verse', 'intro']);

/** Wahrscheinlichkeits-Faktoren der Entwicklungs-Schlagworte je Typ (Spec, Entscheidung 1). */
const DEV_FACTORS = Object.freeze({
  buildsSlowly: { intro: 1.6, build: 1.6 },
  fullFromStart: { intro: 0.2, build: 0.3 },
  withBreakouts: { break: 2.2 },
});

// Plätze: { types: [...], bars: [Wahl...], p: Wahrscheinlichkeit (1 = immer), repeat?: [min, max] }; Vorlage: head, cycle (wird wiederholt, bis das Ziel erreicht ist), tail.
const slot = (type, bars, p = 1, repeat) => ({ types: [].concat(type), bars, p, ...(repeat && { repeat }) });
/** `unit`: alle Teile haben diese Länge (Blues), die Summe ist ein Vielfaches davon. `jam`: Regel 4 und 5 gelten nicht. */
export const TEMPLATES = Object.freeze({
  jam: { jam: true, head: [slot('intro', [4, 8], 0.3)], cycle: [slot('verse', [8, 16], 1, [1, 3]), slot('chorus', [8, 16], 0.6), slot('break', [4, 8], 0.12)], tail: [slot('chorus', [8, 16]), slot('outro', [4, 8], 0.35)] },
  pop: { head: [slot('intro', [4, 8], 0.65)], cycle: [slot('verse', [8, 16]), slot('build', [4], 0.35), slot('chorus', [8, 16]), slot('break', [4, 8], 0.2)], tail: [slot('chorus', [8, 16], 0.5), slot('outro', [4, 8], 0.6)] },
  buildDrop: { head: [slot(['intro', 'verse'], [8, 16])], cycle: [slot('verse', [8, 16], 0.3), slot('build', [4, 8], 0.9), slot('chorus', [8, 16]), slot('break', [8, 16], 0.45)], tail: [slot('chorus', [8, 16], 0.4), slot('outro', [8, 16], 0.6)] },
  blues: { unit: 12, head: [slot('intro', [12], 0.3)], cycle: [slot('verse', [12], 1, [1, 2]), slot('chorus', [12], 0.8)], tail: [slot('chorus', [12], 0.5), slot('outro', [12], 0.3)] },
  rock: { head: [slot('intro', [4, 8], 0.45)], cycle: [slot('verse', [8, 16]), slot('verse', [8], 0.3), slot('build', [4], 0.15), slot('chorus', [8, 16]), slot('break', [4, 8], 0.15)], tail: [slot('chorus', [8, 16], 0.4), slot('outro', [4, 8], 0.5)] },
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const read = (obj, key) => { try { return obj?.[key]; } catch { return undefined; } }; // werfende Getter zählen als fehlend
const sumBars = (items) => items.reduce((s, it) => s + it.bars, 0);

const devTags = (tags) => { const d = read(tags, 'development'); return Array.isArray(d) ? [...new Set(d.filter((t) => typeof t === 'string'))] : []; };

/** Vorlage für „auto“ (der Stil bestimmt sie; bei unbekanntem Stil bevorzugt `buildsSlowly` Build & Drop, sonst Pop) oder die gewählte; Unbekanntes wird Pop. */
export function resolveTemplate(templateOrAuto, styleId, tags) {
  if (TEMPLATE_IDS.includes(templateOrAuto)) return { template: templateOrAuto, auto: false };
  if (templateOrAuto != null && templateOrAuto !== 'auto') return { template: FALLBACK_TEMPLATE, auto: false };
  if (typeof styleId === 'string' && Object.hasOwn(STYLE_TEMPLATE, styleId)) return { template: STYLE_TEMPLATE[styleId], auto: true };
  const dev = devTags(tags); // nur für einen unbekannten Stil entscheidet das Schlagwort; sonst wirkt es über DEV_FACTORS in der Vorlage
  return { template: dev.includes('buildsSlowly') && !dev.includes('fullFromStart') ? 'buildDrop' : FALLBACK_TEMPLATE, auto: true };
}

const nearestTarget = (x) => (typeof x === 'number' && Number.isFinite(x) ? TARGET_SIZES.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a)) : DEFAULT_TARGET);

function cleanFeel(feel) {
  const out = {};
  for (const k of Object.keys(FEEL_DEFAULTS)) {
    const v = read(feel, k);
    out[k] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, k === 'dynamics' ? DYNAMICS_MAX : 1) : FEEL_DEFAULTS[k];
  }
  return out;
}

/** Gesperrte, gültige Teile der vorigen Form: Map Index -> Kopie (nur bekannte Felder). */
function lockedParts(previous) {
  const out = new Map();
  try {
    const prev = normalizeForm(previous);
    if (!isObj(prev) || !Array.isArray(prev.sections)) return out;
    prev.sections.slice(0, FORM_LIMITS.parts).forEach((s, i) => {
      if (!isObj(s) || s.locked !== true) return;
      let ok = true;
      checkForm({ sections: [s] }, () => { ok = false; });
      if (ok) out.set(i, s);
    });
  } catch { /* unlesbare Form: nichts gesperrt */ }
  return out;
}

// --- Ziehen ---
// Längen, die ein Platz beim Anpassen annehmen darf: seine Wahlen plus die Vielfachen von PHRASE dazwischen (nie außerhalb von [lo, hi]).
function lengthOptions(choices) {
  const lo = Math.min(...choices), hi = Math.max(...choices), out = new Set(choices);
  for (let b = lo; b <= hi; b++) if (b % PHRASE === 0) out.add(b);
  return [...out].sort((a, b) => a - b);
}
function drawSlot(sl, ctx, rng, extra = false) {
  const weights = sl.types.map((t) => ctx.mult[t] ?? 1);
  let r = rng.next() * weights.reduce((a, b) => a + b, 0), pick = 0;
  while (pick < weights.length - 1 && r >= weights[pick]) r -= weights[pick++];
  const type = sl.types[pick];
  const required = sl.p >= 1;
  if (!required && rng.next() >= Math.min(1, sl.p * (ctx.mult[type] ?? 1) * ctx.structure)) return [];
  const allowed = sl.bars.filter((b) => b <= ctx.cap);
  const pool = allowed.length ? allowed : [Math.min(...sl.bars)];
  const count = sl.repeat ? rng.int(sl.repeat[0], sl.repeat[1]) : 1;
  const opts = lengthOptions(sl.bars);
  // Wiederholungen und weitere Durchläufe sind entbehrlich (opt): beim Anpassen an kleine Ziele fallen sie zuerst weg
  return Array.from({ length: count }, (_, k) => ({ type, bars: rng.pick(pool), opt: !required || extra || k > 0, locked: false, opts }));
}

function drawItems(tpl, ctx, rng) {
  const run = (slots, extra) => slots.flatMap((sl) => drawSlot(sl, ctx, rng, extra));
  const head = run(tpl.head), tail = run(tpl.tail), body = [];
  let cycles = 0;
  do { body.push(...run(tpl.cycle, cycles > 0)); cycles++; } while (sumBars(head) + sumBars(body) + sumBars(tail) < ctx.target && head.length + body.length + tail.length < MAX_BODY_PARTS && cycles < MAX_BODY_PARTS);
  return [...head, ...body, ...tail];
}

/** Gesperrte Teile an ihren Index setzen, die Ziehung füllt die Lücken davor, der Rest kommt dahinter. */
function mergeLocked(items, locks, unit) {
  const last = locks.size ? Math.max(...locks.keys()) : -1;
  if (last < 0) return { merged: items, last };
  const queue = items.slice(), merged = [];
  for (let i = 0; i <= last; i++) {
    if (locks.has(i)) { const sec = locks.get(i); merged.push({ type: sec.type, bars: sec.bars, locked: true, opt: false, sec }); continue; }
    // vor einem gesperrten Teil sind Intro (außer vorn) und Outro fehl am Platz
    while (queue.length && (queue[0].type === 'outro' || (queue[0].type === 'intro' && i > 0))) queue.shift();
    merged.push(queue.shift() ?? { type: 'verse', bars: unit ?? FILLER_BARS, opt: false, locked: false, opts: unit ? [unit] : lengthOptions([PHRASE, 2 * FILLER_BARS]) });
  }
  // hinter dem letzten gesperrten Teil gibt es kein Intro mehr, ein Outro nur ganz am Ende, und hinter einem gesperrten Outro nichts
  const rest = merged[last].type === 'outro' ? [] : queue.filter((it, k) => it.type !== 'intro' && (it.type !== 'outro' || k === queue.length - 1));
  return { merged: [...merged, ...rest], last };
}

// --- Anpassen der Summe ---
function dropOne(items, last, rng) {
  if (items.length <= 2) return false;
  const idx = items.map((_, i) => i).filter((i) => i > last && !items[i].locked);
  if (!idx.length) return false;
  const opt = idx.filter((i) => items[i].opt), notLast = idx.filter((i) => i !== items.length - 1);
  const pool = opt.length ? opt : notLast.length ? notLast : idx;
  items.splice(rng.pick(pool), 1);
  return true;
}
const isMain = (it) => it.type === 'verse' || it.type === 'chorus';

/** Bester Zug (kleinste Restabweichung, bei Gleichstand zufällig), der die Abweichung `diff` verkleinert, sonst undefined. */
function bestMove(moves, diff, rng) {
  const better = moves.filter((m) => Math.abs(diff - m.delta) < Math.abs(diff));
  if (!better.length) return undefined;
  const least = Math.min(...better.map((m) => Math.abs(diff - m.delta)));
  return rng.pick(better.filter((m) => Math.abs(diff - m.delta) === least));
}

/**
 * Erst nur Längen aus dem Bereich des Platzes [lo, hi] (Wahlen und Vielfache von PHRASE), dann optionale Teile weglassen oder eine
 * Strophe anhängen; so bleiben die Teile Vielfache von PHRASE. Hört auf, wenn kein Zug die Abweichung mehr verkleinert.
 */
function fitInRange(items, target, last, rng) {
  for (let guard = 0; guard < 600; guard++) {
    const diff = target - sumBars(items);
    const lengths = [];
    for (const it of items) if (!it.locked && it.opts) for (const b of it.opts) if (b !== it.bars) lengths.push({ it, delta: b - it.bars });
    let move = bestMove(lengths, diff, rng);
    if (!move && diff < 0 && items.length > 2) {
      move = bestMove(items.flatMap((it, i) => (i > last && !it.locked && it.opt ? [{ it, delta: -it.bars }] : [])), diff, rng);
      if (move) { items.splice(items.indexOf(move.it), 1); continue; }
    }
    if (!move && diff > 0 && items.length < FORM_LIMITS.parts) {
      const verse = items.find((it) => !it.locked && it.type === 'verse' && it.opts);
      move = verse && bestMove(verse.opts.map((b) => ({ delta: b, b })), diff, rng);
      if (move) { items.splice(Math.max(last + 1, items.length - 1), 0, { type: 'verse', bars: move.b, opt: true, locked: false, opts: verse.opts }); continue; }
    }
    if (!move) return;
    move.it.bars += move.delta;
  }
}

/** Notlösung: 2-Takt-Schritte zwischen Mindest- und Höchstlänge, ganze Teile weglassen, bei `unit` ganze Teile anhängen. */
function fitAnyLength(items, target, unit, last, rng) {
  const tol = unit ? unit / 2 : TOLERANCE;
  const movable = (pred) => items.filter((it) => !it.locked && pred(it));
  for (let guard = 0; guard < 600; guard++) {
    const diff = target - sumBars(items);
    if (Math.abs(diff) <= tol) return;
    if (diff < 0) {
      const c = unit ? [] : movable((it) => it.bars - STEP >= MIN_BARS[it.type]);
      if (c.length) { const max = Math.max(...c.map((it) => it.bars)); rng.pick(c.filter((it) => it.bars === max)).bars -= STEP; continue; }
      if (!dropOne(items, last, rng)) return;
    } else {
      const room = unit ? [] : movable((it) => it.bars + STEP <= MAX_BARS);
      const c = room.some(isMain) ? room.filter(isMain) : room; // wachsen sollen Strophe und Refrain, nicht Aufbau und Break
      if (c.length) { const min = Math.min(...c.map((it) => it.bars)); rng.pick(c.filter((it) => it.bars === min)).bars += STEP; continue; }
      if (!unit || items.length >= FORM_LIMITS.parts) return;
      items.splice(Math.max(last + 1, items.length - 1), 0, { type: 'verse', bars: unit, opt: false, locked: false });
    }
  }
}
function fit(items, target, unit, last, rng) {
  if (!unit) fitInRange(items, target, last, rng);
  fitAnyLength(items, target, unit, last, rng); // tut nichts, wenn die Summe schon höchstens TOLERANCE neben dem Ziel liegt
}

// --- Leitplanken (lokale Fenster, damit die Suche nur prüft, was sie gerade ändert) ---
const singleBad = (s, i) => (i === 0 && s[0] !== undefined && s[0] !== 'intro' && s[0] !== 'verse') || (i === s.length - 1 && s[i] !== undefined && s[i] !== 'outro' && s[i] !== 'chorus');
const pairBad = (s, i) => s[i] !== undefined && s[i + 1] !== undefined && ((s[i] === 'build' && s[i + 1] !== 'chorus') || (s[i] === 'break' && s[i + 1] === 'break'));
const tripleBad = (s, i, jam) => !jam && s[i] !== undefined && s[i] === s[i + 1] && s[i] === s[i + 2];
const windowBad = (s, i, jam) => singleBad(s, i) || pairBad(s, i - 1) || pairBad(s, i) || tripleBad(s, i - 2, jam) || tripleBad(s, i - 1, jam) || tripleBad(s, i, jam);
function countViolations(s, jam, total) {
  let n = 0;
  for (let i = 0; i < s.length; i++) n += +singleBad(s, i) + +pairBad(s, i) + +tripleBad(s, i, jam);
  if (!jam && total >= MIN_CHORUS_LENGTH && !s.includes('chorus')) n++;
  return n;
}

/** Typen der nicht gesperrten Teile so wählen, dass die Leitplanken halten (zuerst der gezogene Typ); false, wenn die Suche scheitert. */
function assignTypes(items, jam, total) {
  const seq = items.map((it) => (it.locked ? it.type : undefined));
  const free = items.map((_, i) => i).filter((i) => !items[i].locked);
  const needChorus = !jam && total >= MIN_CHORUS_LENGTH;
  let nodes = 0;
  const rec = (k) => {
    if (k === free.length) return !needChorus || seq.includes('chorus');
    if (++nodes > SEARCH_BUDGET) return false;
    const i = free[k], drawn = items[i].type;
    for (const t of [drawn, ...TYPE_ORDER.filter((x) => x !== drawn)]) {
      if (items[i].bars < MIN_BARS[t] || items[i].bars > MAX_BARS || (t === 'intro' && i > 0) || (t === 'outro' && i < items.length - 1)) continue;
      seq[i] = t;
      if (!windowBad(seq, i, jam) && rec(k + 1)) return true;
    }
    seq[i] = undefined;
    return false;
  };
  if (!rec(0)) return false;
  free.forEach((i) => { items[i].type = seq[i]; });
  return true;
}

function attempt(tpl, ctx, locks, rng) {
  const unit = tpl.unit;
  const { merged: items, last } = mergeLocked(drawItems(tpl, ctx, rng), locks, unit);
  // ein offener Aufbau/Break am Ende hinter dem letzten gesperrten Teil entfällt, damit die Form auf Outro/Refrain endet
  while (items.length > 1 && items.length - 1 > last && items.at(-1).opt && !['outro', 'chorus'].includes(items.at(-1).type)) items.pop();
  fit(items, ctx.target, unit, last, rng);
  const ok = assignTypes(items, !!tpl.jam, sumBars(items));
  const sections = items.map((it) => ({ it, sec: it.locked ? it.sec : { type: it.type, bars: it.bars } }));
  sections.forEach(({ it, sec }, i) => { // Refrain nach Strophe/Intro beginnt manchmal mit einem Stopp
    if (it.locked) return;
    const roll = rng.next();
    if (sec.type === 'chorus' && i > 0 && STOP_AFTER.includes(sections[i - 1].sec.type) && roll < CHORUS_STOP_P * ctx.structure) sec.transition = 'stop';
  });
  const out = sections.map((s) => s.sec);
  const total = sumBars(out);
  const types = out.map((s) => s.type);
  const lengthMiss = Math.max(0, Math.abs(ctx.target - total) - (unit ? unit / 2 : TOLERANCE));
  return { sections: out, score: countViolations(types, !!tpl.jam, total) * 1000 + lengthMiss + (ok ? 0 : 1) };
}

/**
 * Würfelt eine Form. Eingaben dürfen beliebig kaputt sein (nie ein Fehler); das Ergebnis besteht `checkForm`.
 * @param {{ template?: string, style?: string, targetBars?: number, feel?: object, seed?: number, tags?: object, previous?: object }} args
 * @returns {{ template: string, auto: boolean, feel: object, sections: object[] }}
 */
export function rollForm(args) {
  const get = (k) => read(args, k);
  const { template, auto } = resolveTemplate(get('template'), get('style'), get('tags'));
  const feel = cleanFeel(get('feel'));
  const seed = get('seed');
  const dev = devTags(get('tags'));
  const mult = {};
  for (const d of dev) if (Object.hasOwn(DEV_FACTORS, d)) for (const [type, f] of Object.entries(DEV_FACTORS[d])) mult[type] = (mult[type] ?? 1) * f;
  const target = nearestTarget(get('targetBars'));
  const ctx = { target, mult, structure: clamp(feel.structure / FEEL_DEFAULTS.structure, 0, 1 / FEEL_DEFAULTS.structure), cap: target * LEN_FRACTION };
  const tpl = TEMPLATES[template];
  const finish = (locks) => {
    const rng = createRng(typeof seed === 'number' ? seed : 0).fork('formgen');
    let best = null;
    for (let n = 0; n < ATTEMPTS && (!best || best.score > 0); n++) {
      const a = attempt(tpl, ctx, locks, rng);
      if (!best || a.score < best.score) best = a;
    }
    const sections = best.sections;
    while (sections.length > FORM_LIMITS.parts || (sumBars(sections) > FORM_LIMITS.length && sections.length > 1)) sections.pop(); // nur bei absurden Sperren
    return { template, auto, feel, sections };
  };
  const form = finish(lockedParts(get('previous')));
  let bad = false;
  checkForm(form, () => { bad = true; });
  return bad ? finish(new Map()) : form;
}
