// Songform würfeln: Leitplanken als Eigenschaftstests über Seeds x Vorlagen x Zielgrößen x Schlagworte x Sperren.
// Die Regeln stehen hier unabhängig vom Code (eigene Konstanten), damit ein Fehler in der Tabelle nicht still mitläuft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollForm, resolveTemplate, TEMPLATE_IDS, STYLE_TEMPLATE, TARGET_SIZES } from '../../src/core/form-roll.js';
import { STYLE_PRESETS } from '../../src/core/tags.js';
import { checkForm, formLength } from '../../src/core/form.js';
import { FEEL_DEFAULTS, TRANSITIONS } from '../../src/core/form-types.js';
import { createRng } from '../../src/core/rng.js';

const IDS = ['jam', 'pop', 'buildDrop', 'blues', 'rock'];
const SIZES = [24, 32, 48, 64, 96, 128, 192];
const MIN = { intro: 2, build: 2, break: 2, outro: 2, verse: 4, chorus: 4 };
const MAX_PART = 32;
const TAGSETS = [{}, { development: ['buildsSlowly'] }, { development: ['fullFromStart'] }, { development: ['withBreakouts'] }, { development: ['buildsSlowly', 'withBreakouts'] }];
const SEEDS = 200;
const STRUCTURES = [FEEL_DEFAULTS.structure, 0, 1];
const types = (f) => f.sections.map((s) => s.type);
const reasons = (form) => { const out = []; checkForm(form, (c, p) => out.push(p.reason)); return out; };
const label = (ctx, f) => `${JSON.stringify(ctx)} ${f.sections.map((s) => `${s.type}${s.bars}`).join(' ')}`;

/** Erste verletzte Leitplanke (Text) oder null; `jam` nimmt Regel 4 und 5 aus. `checkBars` prüft die Längen (Regel 6). */
function broken(form, { jam, checkBars = true } = {}) {
  const t = types(form), n = t.length;
  if (!['intro', 'verse'].includes(t[0])) return 'erster Teil';
  if (!['outro', 'chorus'].includes(t[n - 1])) return 'letzter Teil';
  for (let i = 0; i < n; i++) {
    if (t[i] === 'intro' && i > 0) return 'Intro nicht vorn';
    if (t[i] === 'outro' && i < n - 1) return 'Outro nicht am Ende';
    if (t[i] === 'build' && t[i + 1] !== 'chorus') return 'Aufbau nicht vor Refrain';
    if (t[i] === 'break' && (i === 0 || i === n - 1)) return 'Break am Rand';
    if (t[i] === 'break' && t[i + 1] === 'break') return 'zwei Breaks';
    if (!jam && i >= 2 && t[i] === t[i - 1] && t[i] === t[i - 2]) return 'drei gleiche';
    if (checkBars && (form.sections[i].bars < MIN[t[i]] || form.sections[i].bars > MAX_PART)) return `Länge ${t[i]}${form.sections[i].bars}`;
  }
  if (!jam && formLength(form) >= 24 && !t.includes('chorus')) return 'kein Refrain';
  return null;
}

test('Konstanten: Vorlagen, Zielgrößen, Auto-Zuordnung', () => {
  assert.deepEqual([...TEMPLATE_IDS], IDS);
  assert.deepEqual([...TARGET_SIZES], SIZES);
  assert.deepEqual({ ...STYLE_TEMPLATE }, { funk: 'jam', reggae: 'jam', psych: 'buildDrop', dreamy: 'pop', country: 'pop', poppunk: 'pop', blues: 'blues', rock: 'rock', hardrock: 'rock' });
});

test('resolveTemplate: der Stil bestimmt Auto, Schlagworte nur bei unbekanntem Stil', () => {
  const preset = (id) => STYLE_PRESETS.find((p) => p.id === id);
  for (const [style, id] of Object.entries(STYLE_TEMPLATE)) {
    assert.deepEqual(resolveTemplate('auto', style, {}), { template: id, auto: true }, style);
    // auch mit den echten Schlagworten des Stils gewinnt die Zuordnung
    assert.deepEqual(resolveTemplate('auto', style, preset(style).tags), { template: id, auto: true }, style);
  }
  for (const [style, id] of [['funk', 'jam'], ['dreamy', 'pop'], ['psych', 'buildDrop']]) {
    assert.deepEqual(preset(style).tags.development, ['buildsSlowly']); // Voraussetzung des Falls
    assert.deepEqual(resolveTemplate('auto', style, preset(style).tags), { template: id, auto: true });
  }
  assert.deepEqual(resolveTemplate('auto', 'rock', { development: ['buildsSlowly'] }), { template: 'rock', auto: true });
  assert.deepEqual(resolveTemplate('auto', 'unbekannt', { development: ['buildsSlowly'] }), { template: 'buildDrop', auto: true });
  assert.deepEqual(resolveTemplate('auto', undefined, { development: ['buildsSlowly', 'fullFromStart'] }), { template: 'pop', auto: true });
  assert.deepEqual(resolveTemplate('auto', 'unbekannt', { development: ['fullFromStart'] }), { template: 'pop', auto: true });
  assert.deepEqual(resolveTemplate('auto', 'unbekannt', {}), { template: 'pop', auto: true });
  assert.deepEqual(resolveTemplate('auto', undefined, undefined), { template: 'pop', auto: true });
  assert.deepEqual(resolveTemplate('blues', 'funk', { development: ['buildsSlowly'] }), { template: 'blues', auto: false });
  assert.deepEqual(resolveTemplate('quark', 'blues', {}), { template: 'pop', auto: false });
  assert.deepEqual(resolveTemplate('__proto__', '__proto__', null), { template: 'pop', auto: false });
  assert.deepEqual(resolveTemplate('auto', '__proto__', null), { template: 'pop', auto: true });
});

test('Leitplanken 1 bis 6, Summe nahe Ziel, gültig: Seeds x Vorlagen x Zielgrößen x Schlagworte', () => {
  for (const template of IDS) for (const targetBars of SIZES) for (const [ti, tags] of TAGSETS.entries()) for (const structure of STRUCTURES) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ctx = { template, targetBars, ti, structure, seed };
      const f = rollForm({ template, style: 'rock', targetBars, feel: { ...FEEL_DEFAULTS, structure }, seed, tags });
      const why = broken(f, { jam: template === 'jam' });
      if (why) assert.fail(`${why}: ${label(ctx, f)}`);
      const r = reasons(f);
      if (r.length) assert.fail(`checkForm ${r}: ${label(ctx, f)}`);
      assert.equal(f.template, template);
      assert.equal(f.auto, false);
      const sum = formLength(f);
      if (sum > 512) assert.fail(`Summe ${sum}`);
      if (Math.abs(sum - targetBars) > 4) assert.fail(`Summe ${sum} Ziel ${targetBars}: ${label(ctx, f)}`);
      if (template === 'blues' && !f.sections.every((s) => s.bars % 12 === 0)) assert.fail(`Blues nicht in 12ern: ${label(ctx, f)}`);
    }
  }
});

test('Blues: Teile zu 12 Takten, Summe das nächste Vielfache von 12', () => {
  for (const targetBars of SIZES) for (let seed = 1; seed <= 40; seed++) {
    const f = rollForm({ template: 'blues', targetBars, seed });
    assert.ok(f.sections.every((s) => s.bars === 12), label({ targetBars, seed }, f));
    assert.equal(formLength(f), Math.round(targetBars / 12) * 12, label({ targetBars, seed }, f));
  }
});

test('Auto: template ist nie auto, auto-Flag gesetzt, Stil bestimmt die Vorlage', () => {
  for (const [style, id] of Object.entries(STYLE_TEMPLATE)) {
    const f = rollForm({ template: 'auto', style, targetBars: 64, seed: 3 });
    assert.equal(f.template, id);
    assert.equal(f.auto, true);
    assert.deepEqual(f, { ...rollForm({ template: id, style, targetBars: 64, seed: 3 }), auto: true });
  }
  for (let seed = 1; seed <= 50; seed++) assert.ok(IDS.includes(rollForm({ template: 'auto', style: 'psych', targetBars: 48, seed, tags: { development: ['buildsSlowly'] } }).template));
});

test('Reproduzierbar: gleiche Eingaben gleiche Form, anderer Seed meist andere', () => {
  const args = { template: 'rock', style: 'rock', targetBars: 96, feel: { structure: 0.9 }, seed: 7, tags: { development: ['withBreakouts'] } };
  assert.deepEqual(rollForm(args), rollForm(structuredClone(args)));
  const forms = new Set();
  for (let seed = 1; seed <= 30; seed++) forms.add(JSON.stringify(rollForm({ ...args, seed })));
  assert.ok(forms.size > 5);
});

test('Vielfalt: Pop, 96 Takte, 200 Seeds ergibt mehr als 10 verschiedene Formen (jede Vorlage mehr als eine)', () => {
  const key = (f) => f.sections.map((s) => `${s.type}${s.bars}`).join(',');
  const pop = new Set();
  for (let seed = 1; seed <= 200; seed++) pop.add(key(rollForm({ template: 'pop', targetBars: 96, seed })));
  assert.ok(pop.size > 10, `nur ${pop.size}`);
  for (const template of IDS) {
    const s = new Set();
    for (let seed = 1; seed <= 200; seed++) s.add(key(rollForm({ template, targetBars: 96, seed })));
    assert.ok(s.size > 3, `${template}: ${s.size}`);
  }
});

const rate = (opts, pred) => {
  let hit = 0;
  for (let seed = 1; seed <= 300; seed++) if (pred(rollForm({ template: 'pop', targetBars: 96, seed, ...opts }))) hit++;
  return hit / 300;
};
test('Entwicklungs-Schlagworte verschieben die Häufigkeiten', () => {
  const hasIntro = (f) => types(f)[0] === 'intro';
  const hasBuild = (f) => types(f).includes('build');
  const hasBreak = (f) => types(f).includes('break');
  const base = { development: [] };
  assert.ok(rate({ tags: { development: ['buildsSlowly'] } }, hasIntro) > rate({ tags: base }, hasIntro) + 0.05);
  assert.ok(rate({ tags: { development: ['fullFromStart'] } }, hasIntro) < rate({ tags: base }, hasIntro) - 0.1);
  assert.ok(rate({ tags: { development: ['buildsSlowly'] } }, hasBuild) > rate({ tags: base }, hasBuild));
  assert.ok(rate({ tags: { development: ['fullFromStart'] } }, hasBuild) < rate({ tags: base }, hasBuild));
  assert.ok(rate({ tags: { development: ['withBreakouts'] } }, hasBreak) > rate({ tags: base }, hasBreak) + 0.05);
});

test('Struktur-Regler: 0 ergibt weniger verschiedene Teile als 1', () => {
  const mean = (structure) => {
    let sum = 0;
    for (let seed = 1; seed <= 100; seed++) for (const template of ['pop', 'rock', 'buildDrop']) sum += new Set(types(rollForm({ template, targetBars: 96, seed, feel: { structure } }))).size;
    return sum / 300;
  };
  assert.ok(mean(0) < mean(1) - 0.5, `${mean(0)} vs ${mean(1)}`);
  // auch bei Struktur 0 gelten die Leitplanken
  for (let seed = 1; seed <= 60; seed++) for (const template of IDS) assert.equal(broken(rollForm({ template, targetBars: 48, seed, feel: { structure: 0 } }), { jam: template === 'jam' }), null);
});

test('feel wird vollständig und begrenzt zurückgegeben', () => {
  assert.deepEqual(rollForm({ seed: 1 }).feel, { ...FEEL_DEFAULTS });
  assert.deepEqual(rollForm({ seed: 1, feel: { structure: 0.2, pauses: 'x', randomness: 9, dynamics: 5 } }).feel, { structure: 0.2, dynamics: 1.3, pauses: FEEL_DEFAULTS.pauses, randomness: 1 });
  assert.deepEqual(rollForm({ seed: 1, feel: { structure: -4, dynamics: NaN } }).feel, { structure: 0, dynamics: FEEL_DEFAULTS.dynamics, pauses: 0.4, randomness: 0.5 });
});

test('Zielgröße außerhalb fällt auf die nächste zurück', () => {
  for (const [input, expect] of [[200, 192], [1000, 192], [0, 24], [-5, 24], [30, 32], [70, 64], [100, 96], [NaN, 96], ['abc', 96], [undefined, 96], [null, 96], [Infinity, 96]]) {
    for (let seed = 1; seed <= 20; seed++) {
      const f = rollForm({ template: 'pop', targetBars: input, seed });
      assert.ok(Math.abs(formLength(f) - expect) <= 4, `${input}: ${formLength(f)}`);
    }
  }
});

test('feindliche Eingaben werfen nie und ergeben eine gültige Form', () => {
  const hostile = [undefined, null, 0, 'x', [], {}, { template: 5 }, { template: {}, style: [], tags: 5, feel: 'x', seed: {}, targetBars: {}, previous: 7 },
    { template: 'quark', seed: 'abc' }, { seed: -1, targetBars: -9 }, { seed: 2 ** 40 }, { seed: NaN }, { tags: { development: 'buildsSlowly' } }, { tags: { development: [null, 1, {}] } },
    { tags: { get development() { throw new Error('boom'); } } }, { feel: { get structure() { throw new Error('boom'); } } },
    { previous: { sections: 'x' } }, { previous: { sections: [null, 5, 'a', { type: 'zzz', locked: true }, { type: 'verse', bars: 0, locked: true }, { type: 'verse', bars: 3.5, locked: true }] } },
    { previous: { get sections() { throw new Error('boom'); } } },
    { previous: { sections: Array.from({ length: 200 }, () => ({ type: 'verse', bars: 64, locked: true })) } },
    { previous: { sections: Array.from({ length: 64 }, () => ({ type: 'break', bars: 64, locked: true })) } },
    { previous: { sections: [{ type: 'verse', bars: 8, locked: true, level: 5 }, { type: 'chorus', bars: 8, locked: 'yes' }] } }];
  for (const [hi, args] of hostile.entries()) {
    let f;
    assert.doesNotThrow(() => { f = rollForm(args); }, `hostile ${hi}`);
    assert.deepEqual(reasons(f), [], `hostile ${hi}`);
    assert.ok(formLength(f) <= 512);
    assert.ok(IDS.includes(f.template));
  }
  assert.equal(rollForm({ template: 'quark', seed: 1 }).template, 'pop');
  assert.equal(rollForm({ template: 'quark', seed: 1 }).auto, false);
});

// --- gesperrte Teile ---
// gesperrt werden auch Pegel, Dichte, Crash und Übergang (vom Nutzer gesetzt); `mode` wählt, welche Teile
function lockSome(prev, rng, mode = 'random') {
  const n = prev.sections.length;
  const pick = { random: () => rng.next() < 0.35, first: (i) => i === 0, last: (i) => i === n - 1, ends: (i) => i === 0 || i === n - 1 }[mode];
  const sections = prev.sections.map((s, i) => {
    if (!pick(i)) return { ...s };
    const out = { ...s, locked: true };
    if (rng.next() < 0.5) out.level = -rng.int(0, 12);
    if (rng.next() < 0.5) out.density = rng.int(-10, 10) / 10;
    if (rng.next() < 0.5) out.crash = rng.next() < 0.5;
    if (rng.next() < 0.5) out.transition = rng.pick(TRANSITIONS);
    return out;
  });
  if (!sections.some((s) => s.locked)) sections[rng.int(0, n - 1)].locked = true;
  return { ...prev, sections };
}
test('gesperrte Teile bleiben bit-gleich an ihrer Stelle, Leitplanken gelten rundherum', () => {
  let changed = 0, total = 0;
  const modes = ['random', 'random', 'first', 'last', 'ends'];
  for (const template of IDS) for (const targetBars of SIZES) for (let seed = 1; seed <= 40; seed++) {
    const rng = createRng(seed * 977 + targetBars);
    const prev = lockSome(rollForm({ template, targetBars, seed }), rng, modes[seed % modes.length]);
    const next = rollForm({ template, targetBars, seed: seed + 1000, previous: prev });
    const ctx = { template, targetBars, seed, prev: label({}, prev) };
    prev.sections.forEach((s, i) => { if (s.locked) assert.deepEqual(next.sections[i], s, `Index ${i}: ${label(ctx, next)}`); });
    const why = broken(next, { jam: template === 'jam' });
    if (why) assert.fail(`${why}: ${label(ctx, next)}`);
    assert.deepEqual(reasons(next), []);
    if (Math.abs(formLength(next) - targetBars) > 4) assert.fail(`Summe ${formLength(next)}: ${label(ctx, next)}`);
    total++;
    if (JSON.stringify(next.sections) !== JSON.stringify(prev.sections)) changed++;
  }
  assert.ok(changed > total * 0.8, `nur ${changed} von ${total} verändert`);
});

test('ohne gesperrte Teile würfelt previous alles neu; gleiche Sperren und Seed ergeben dieselbe Form', () => {
  const prev = rollForm({ template: 'pop', targetBars: 64, seed: 4 });
  const fresh = rollForm({ template: 'pop', targetBars: 64, seed: 9 });
  assert.deepEqual(rollForm({ template: 'pop', targetBars: 64, seed: 9, previous: prev }), fresh);
  const lock = () => ({ ...prev, sections: prev.sections.map((s, i) => (i === 0 ? { ...s, locked: true } : { ...s })) });
  const a = rollForm({ template: 'pop', targetBars: 64, seed: 9, previous: lock() });
  assert.deepEqual(a, rollForm({ template: 'pop', targetBars: 64, seed: 9, previous: lock() }));
  assert.deepEqual(a.sections[0], lock().sections[0]);
});

test('Sperren (Index 0, Ende, Zufall): hinter gesperrten Teilen kein zweites Intro, Outro nur am Ende', () => {
  for (const template of IDS) for (const targetBars of SIZES) for (const mode of ['first', 'last', 'ends', 'random']) for (let seed = 1; seed <= 25; seed++) {
    const rng = createRng(seed * 31 + targetBars);
    const prev = lockSome(rollForm({ template, targetBars, seed }), rng, mode);
    const next = rollForm({ template, targetBars, seed: seed + 500, previous: prev });
    const t = types(next);
    if (t.indexOf('intro', 1) !== -1) assert.fail(`zweites Intro (${mode}): ${label({ template, targetBars, seed }, next)}`);
    if (t.indexOf('outro') !== -1 && t.indexOf('outro') !== t.length - 1) assert.fail(`Outro mitten (${mode}): ${label({ template, targetBars, seed }, next)}`);
  }
});

test('Phrasen: ohne Sperren sind fast alle Teile Vielfache von 4 Takten (Blues zu 12)', () => {
  for (const template of IDS.filter((t) => t !== 'blues')) {
    let forms = 0, odd = 0;
    for (const targetBars of SIZES) for (let seed = 1; seed <= 150; seed++) {
      const f = rollForm({ template, targetBars, seed });
      forms++;
      if (f.sections.some((x) => x.bars % 4)) odd++;
    }
    assert.ok(forms >= 1000);
    assert.ok(odd / forms < 0.02, `${template}: ${odd} von ${forms} mit Teil, der kein Vielfaches von 4 ist`);
  }
});

test('unmögliche Sperren: nie ein Wurf, gesperrte Teile bleiben, Ergebnis gültig', () => {
  // gesperrter Break an Index 0, drei Refrains in Folge, Summe weit über dem Ziel
  const odd = { sections: [{ type: 'break', bars: 40, locked: true }, { type: 'chorus', bars: 30, locked: true }, { type: 'chorus', bars: 30, locked: true }, { type: 'chorus', bars: 30, locked: true }, { type: 'verse', bars: 5 }] };
  for (const template of IDS) for (let seed = 1; seed <= 20; seed++) {
    const f = rollForm({ template, targetBars: 24, seed, previous: odd });
    assert.deepEqual(reasons(f), []);
    for (let i = 0; i < 4; i++) assert.deepEqual(f.sections[i], odd.sections[i]);
  }
});

test('previous wird nicht verändert', () => {
  const prev = { template: 'pop', feel: { structure: 1 }, sections: [{ type: 'intro', bars: 4, locked: true, level: -3 }, { type: 'verse', bars: 8 }, { type: 'chorus', bars: 8 }] };
  const copy = structuredClone(prev);
  rollForm({ template: 'pop', targetBars: 24, seed: 2, previous: prev });
  assert.deepEqual(prev, copy);
});

test('Zufall nur aus dem eigenen Strom: Math.random und Date.now werden nie gelesen', () => {
  const { random } = Math, { now } = Date;
  Math.random = () => { throw new Error('Math.random'); };
  Date.now = () => { throw new Error('Date.now'); };
  try {
    for (let seed = 1; seed <= 300; seed++) rollForm({ template: IDS[seed % IDS.length], targetBars: SIZES[seed % SIZES.length], seed, previous: seed % 3 ? undefined : rollForm({ seed }) });
  } finally {
    Math.random = random;
    Date.now = now;
  }
});
