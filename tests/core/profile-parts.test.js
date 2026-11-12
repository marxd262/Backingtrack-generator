import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PART_IDS, PART_PRESETS, captureParts, sanitizeParts, applyParts, partIdsOf, mergeParts } from '../../src/core/profile-parts.js';
import { SCALE_MODE } from '../../src/core/music.js';
import { SCALE_MODE as UI_SCALE_MODE } from '../../src/ui/state.js';
import { completeVoices } from '../../src/core/voices.js';
import { completeJobs } from '../../src/core/layers.js';

const mkBars = (list = [['A', 'min'], ['D', 'min'], ['E', 'maj'], ['A', 'min']], beats = 4) => list.map(([root, quality]) => ({ chord: { root, quality }, beats }));
const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 96, bars: mkBars(), tags: { development: ['fullFromStart'] }, timbre: { master: { echo: 0.2 } }, seed: 42, variety: true,
  length: 48, meter: [4, 4], layers: { drums: true, bass: false, chords: true, pad: true, lead: true, percussion: true },
  voices: { chords: { id: 'sample', variant: 'jazz' } }, jobs: { lead: 'melody', percussion: 'congas' }, groove: 'straight', complexity: 0.7, ...extra,
});
const session = (extra = {}) => ({ track: track(), scale: 'blues', style: 'funk', chordColor: 'sevenths', chordColorFromStyle: false, mix: { drums: 0.5, master: 0.8 }, ...extra });
// gültige Form für 48 Takte; Teile mit allen Feldern, einer gesperrt
const FORM = {
  template: 'pop', auto: true, feel: { structure: 0.6, dynamics: 0.9, pauses: 0.4, randomness: 0.5 },
  sections: [{ type: 'intro', bars: 8 }, { type: 'verse', bars: 16, level: -3, density: 0.25, transition: 'fill', crash: true, locked: true }, { type: 'chorus', bars: 16, transition: 'stop' }, { type: 'outro', bars: 8 }],
};
const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };
const codes = (r) => r.errors.map((e) => e.code);

test('PART_IDS und PART_PRESETS: eingefroren, Reihenfolge der Oberfläche', () => {
  assert.deepEqual(PART_IDS, ['harmony', 'tempo', 'rhythm', 'style', 'sound', 'voices', 'layers', 'mixer', 'variant', 'form']);
  assert.equal(PART_IDS.length, 10);
  assert.ok(Object.isFrozen(PART_IDS));
  assert.deepEqual(PART_PRESETS.all, PART_IDS);
  assert.deepEqual(PART_PRESETS.sound, ['sound', 'voices', 'mixer']);
  assert.deepEqual(PART_PRESETS.rhythm, ['tempo', 'rhythm']);
  assert.deepEqual(PART_PRESETS.none, []);
});

test('SCALE_MODE wohnt in music.js, state.js exportiert dasselbe weiter', () => {
  assert.equal(SCALE_MODE, UI_SCALE_MODE);
  assert.equal(SCALE_MODE.dorian, 'dorian');
});

test('captureParts: alle 10 Teile als tiefe Kopie', () => {
  const s = session({ track: track({ form: structuredClone(FORM), length: 48 }) });
  const parts = captureParts(s);
  assert.deepEqual(Object.keys(parts), PART_IDS);
  assert.deepEqual(parts.harmony, { key: { root: 'A', mode: 'minor' }, scale: 'blues', bars: s.track.bars, chordColor: 'sevenths', chordColorFromStyle: false, meter: [4, 4] });
  assert.deepEqual(parts.tempo, { bpm: 96, meter: [4, 4] }, 'bpm zählt den Puls dieser Taktart');
  assert.deepEqual(parts.rhythm, { groove: 'straight', complexity: 0.7, length: 48 });
  assert.deepEqual(parts.style, { style: 'funk', tags: s.track.tags });
  assert.deepEqual(parts.sound, { timbre: { master: { echo: 0.2 } } });
  // vollständige Stimmen- und Aufgabenwahl (nicht nur die gesetzten Einträge): sonst ließe sich der Standard nie wieder laden
  assert.deepEqual(parts.voices, { voices: completeVoices(s.track.voices), jobs: completeJobs(s.track.jobs) });
  assert.deepEqual(parts.layers, { layers: s.track.layers });
  assert.deepEqual(parts.mixer, { mix: { drums: 0.5, master: 0.8 } });
  assert.deepEqual(parts.variant, { seed: 42, variety: true });
  assert.deepEqual(parts.form, { form: FORM });
  assert.notEqual(parts.form.form, s.track.form, 'form nicht aliasen');
  assert.notEqual(parts.harmony.bars, s.track.bars, 'bars nicht aliasen');
  s.track.bars[0].chord.root = 'C';
  s.track.tags.development.push('x');
  s.mix.drums = 0;
  s.track.form.sections[0].bars = 1;
  assert.equal(parts.form.form.sections[0].bars, 8);
  assert.equal(parts.harmony.bars[0].chord.root, 'A');
  assert.deepEqual(parts.style.tags.development, ['fullFromStart']);
  assert.equal(parts.mixer.mix.drums, 0.5);
});

test('captureParts: nicht gesetzte groove/complexity werden null; Auswahl der Teile', () => {
  const t = track(); delete t.groove; delete t.complexity;
  const parts = captureParts(session({ track: t }), ['rhythm', 'tempo']);
  assert.deepEqual(Object.keys(parts), ['tempo', 'rhythm'], 'in PART_IDS-Reihenfolge');
  assert.deepEqual(parts.rhythm, { groove: null, complexity: null, length: 48 });
  assert.deepEqual(captureParts(session(), PART_PRESETS.none), {});
});

test('Profil mit Standardstimmen setzt eine gewählte Stimme zurück (auch über die Datei)', () => {
  const fresh = track();
  delete fresh.voices; // neue Sitzung: noch keine Stimme gewählt
  delete fresh.jobs;
  const parts = captureParts(session({ track: fresh }), ['voices']);
  assert.deepEqual(parts.voices, { voices: completeVoices(), jobs: completeJobs() });
  const chosen = session(); // chords: sample/jazz, lead: melody
  for (const p of [parts, sanitizeParts(JSON.parse(JSON.stringify(parts))).parts]) {
    const r = applyParts(chosen, p);
    assert.ok(r.ok);
    assert.deepEqual(r.session.track.voices, completeVoices());
    assert.deepEqual(r.session.track.jobs, completeJobs());
  }
});

test('applyParts tempo: ändert nur track.bpm, Eingabe bleibt unverändert', () => {
  const s = deepFreeze(session());
  const r = applyParts(s, { tempo: { bpm: 77 } });
  assert.ok(r.ok, JSON.stringify(r));
  const expected = session(); expected.track.bpm = 77;
  assert.deepEqual(r.session, expected);
  assert.equal(s.track.bpm, 96);
});

test('applyParts tempo mit meter: auf die Taktart nach dem Laden umgerechnet (wie setMeter, 40 bis 200), ohne meter wie gespeichert', () => {
  const t128 = track({ meter: [12, 8] });
  delete t128.groove;
  const in128 = session({ track: t128 });
  const bpm = (s, parts) => { const r = applyParts(s, parts); assert.ok(r.ok, JSON.stringify(r)); return r.session.track.bpm; };
  assert.equal(bpm(in128, { tempo: { bpm: 100, meter: [4, 4] } }), 67);
  assert.equal(bpm(in128, { tempo: { bpm: 90, meter: [6, 8] } }), 90, 'gleicher Puls');
  assert.equal(bpm(in128, { tempo: { bpm: 100 } }), 100, 'ohne meter (ältere Profile): wie gespeichert');
  assert.equal(bpm(session(), { tempo: { bpm: 60, meter: [6, 8] } }), 90);
  assert.equal(bpm(in128, { tempo: { bpm: 45, meter: [3, 4] } }), 40, 'an 40 geklemmt');
  // harmony im selben Profil wechselt die Taktart: umgerechnet wird auf diese
  const harmony = { key: { root: 'A', mode: 'minor' }, bars: mkBars(), meter: [12, 8] };
  assert.equal(bpm(session(), { harmony, tempo: { bpm: 100, meter: [4, 4] } }), 67);
  assert.equal(bpm(in128, { harmony: { ...harmony, meter: [4, 4] }, tempo: { bpm: 100, meter: [4, 4] } }), 100);
  assert.deepEqual(captureParts(in128, ['tempo']), { tempo: { bpm: 96, meter: [12, 8] } });
});

test('sanitizeParts tempo.meter: gültige Taktart bleibt (als Kopie), ungültige fällt weg und zählt, ohne bpm kein Teil', () => {
  const meter = [6, 8];
  const r = sanitizeParts({ tempo: { bpm: 100, meter } });
  assert.deepEqual(r, { parts: { tempo: { bpm: 100, meter: [6, 8] } }, skipped: 0 });
  assert.notEqual(r.parts.tempo.meter, meter);
  for (const bad of [[7, 8], '4/4', [4], null]) assert.deepEqual(sanitizeParts({ tempo: { bpm: 100, meter: bad } }), { parts: { tempo: { bpm: 100 } }, skipped: 1 }, JSON.stringify(bad));
  assert.deepEqual(sanitizeParts({ tempo: { meter } }), { parts: {}, skipped: 0 });
});

test('applyParts rhythm: groove null entfernt, fehlendes Feld bleibt', () => {
  const r = applyParts(session(), { rhythm: { groove: null } });
  assert.ok(r.ok);
  assert.equal(Object.hasOwn(r.session.track, 'groove'), false);
  assert.equal(r.session.track.complexity, 0.7);
  const r2 = applyParts(session(), { rhythm: { complexity: null, length: 24 } });
  assert.equal(Object.hasOwn(r2.session.track, 'complexity'), false);
  assert.equal(r2.session.track.groove, 'straight');
  assert.equal(r2.session.track.length, 24);
});

test('applyParts: layers, mixer, voices, jobs mischen je Schlüssel', () => {
  const s = session();
  const l = applyParts(s, { layers: { layers: { lead: false } } });
  assert.deepEqual(l.session.track.layers, { ...s.track.layers, lead: false });
  const m = applyParts(s, { mixer: { mix: { drums: 0.3 } } });
  assert.deepEqual(m.session.mix, { drums: 0.3, master: 0.8 });
  const v = applyParts(s, { voices: { voices: { bass: { id: 'sample', variant: 'pick' } } } });
  assert.deepEqual(v.session.track.voices, { chords: { id: 'sample', variant: 'jazz' }, bass: { id: 'sample', variant: 'pick' } });
  const j = applyParts(s, { voices: { jobs: { lead: 'arpeggio' } } });
  assert.deepEqual(j.session.track.jobs, { lead: 'arpeggio', percussion: 'congas' });
  assert.deepEqual(j.session.track.voices, s.track.voices);
});

test('applyParts sound: timbre {} setzt zurück, sonst ersetzt im Ganzen', () => {
  const s = session({ track: track({ timbre: { master: { echo: 0.2 }, bass: { sub: 0.9 } } }) });
  assert.deepEqual(applyParts(s, { sound: { timbre: {} } }).session.track.timbre, {});
  assert.deepEqual(applyParts(s, { sound: { timbre: { master: { echo: 0 } } } }).session.track.timbre, { master: { echo: 0 } });
});

test('applyParts style: nur style und tags, kein Umfärben', () => {
  const s = session();
  const r = applyParts(s, { style: { style: 'rock', tags: { mood: ['dark'] } } });
  assert.ok(r.ok);
  assert.equal(r.session.style, 'rock');
  assert.deepEqual(r.session.track.tags, { mood: ['dark'] });
  assert.equal(r.session.chordColor, 'sevenths');
  assert.equal(r.session.chordColorFromStyle, false);
  assert.deepEqual(r.session.track.bars, s.track.bars);
  assert.equal(r.session.track.bpm, 96);
});

test('applyParts harmony: setzt alles; Skala fällt auf den Standard des Modus zurück', () => {
  const h = { key: { root: 'C', mode: 'major' }, scale: 'majorPentatonic', bars: mkBars([['C', 'maj'], ['G', 'maj']], 2), chordColor: 'triads', chordColorFromStyle: true, meter: [6, 8] };
  const r = applyParts(session(), { harmony: h });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.session.track.key, h.key);
  assert.deepEqual(r.session.track.meter, [6, 8]);
  assert.deepEqual(r.session.track.bars, h.bars);
  assert.equal(r.session.scale, 'majorPentatonic');
  assert.equal(r.session.chordColor, 'triads');
  assert.equal(r.session.chordColorFromStyle, true);
  assert.notEqual(r.session.track.bars, h.bars);
  // Skala fehlt oder passt nicht zum Modus: Standardskala des Modus
  assert.equal(applyParts(session(), { harmony: { ...h, scale: undefined } }).session.scale, 'majorPentatonic');
  assert.equal(applyParts(session(), { harmony: { ...h, scale: 'blues' } }).session.scale, 'majorPentatonic');
  const minor = { key: { root: 'A', mode: 'minor' }, bars: mkBars([['A', 'min']]), meter: [4, 4] };
  assert.equal(applyParts(session({ scale: 'dorian' }), { harmony: minor }).session.scale, 'minorPentatonic');
  assert.equal(applyParts(session(), { harmony: { ...minor, scale: 'blues' } }).session.scale, 'blues');
  const dor = { key: { root: 'D', mode: 'dorian' }, bars: mkBars([['D', 'min']]), meter: [4, 4] };
  assert.equal(applyParts(session(), { harmony: dor }).session.scale, 'dorian');
  // ohne chordColor/chordColorFromStyle bleiben sie
  assert.equal(applyParts(session(), { harmony: minor }).session.chordColor, 'sevenths');
});

test('applyParts: ungültiges Ergebnis liefert Fehler und lässt die Eingabe unverändert', () => {
  const s = deepFreeze(session());
  const r = applyParts(s, { rhythm: { groove: 'gibtsnicht' } });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('badGroove'));
  assert.equal(s.track.groove, 'straight');
});

test('applyParts ohne Teile: Kopie der Sitzung, nichts geändert', () => {
  const s = session();
  const r = applyParts(s, {});
  assert.ok(r.ok);
  assert.deepEqual(r.session, s);
  assert.notEqual(r.session.track, s.track);
});

test('sanitizeParts: Rundlauf mit captureParts ändert nichts', () => {
  const parts = captureParts(session());
  const r = sanitizeParts(JSON.parse(JSON.stringify(parts)));
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.parts, parts);
});

test('sanitizeParts: unbekannte Teile und Felder werden ignoriert und nicht gezählt', () => {
  const r = sanitizeParts({ nope: { a: 1 }, tempo: { bpm: 100, extra: 1 } });
  assert.deepEqual(r, { parts: { tempo: { bpm: 100 } }, skipped: 0 });
});

test('sanitizeParts: ungültige Felder fallen einzeln weg und werden gezählt', () => {
  const r = sanitizeParts({ tempo: { bpm: 5 }, rhythm: { groove: 'x', complexity: 2, length: 24 }, variant: { seed: -1, variety: 'ja' }, style: { style: 'nope', tags: { mood: ['dark'] } } });
  assert.deepEqual(r.parts, { rhythm: { length: 24 }, style: { tags: { mood: ['dark'] } } });
  assert.equal(r.skipped, 6);
});

test('sanitizeParts: groove/complexity null bleiben (Standard), Zahlenbereiche', () => {
  const r = sanitizeParts({ rhythm: { groove: null, complexity: null }, variant: { seed: 4294967295, variety: false }, tempo: { bpm: 400 } });
  assert.deepEqual(r.parts, { rhythm: { groove: null, complexity: null }, variant: { seed: 4294967295, variety: false }, tempo: { bpm: 400 } });
  assert.equal(sanitizeParts({ variant: { seed: 4294967296 } }).skipped, 1);
  assert.equal(sanitizeParts({ variant: { seed: 1.5 } }).skipped, 1);
  assert.equal(sanitizeParts({ tempo: { bpm: 401 } }).skipped, 1);
  assert.equal(sanitizeParts({ rhythm: { length: 513 } }).skipped, 1);
});

test('sanitizeParts harmony: unteilbar', () => {
  const ok = { key: { root: 'A', mode: 'minor' }, bars: mkBars(), meter: [4, 4] };
  assert.deepEqual(sanitizeParts({ harmony: ok }), { parts: { harmony: ok }, skipped: 0 });
  const bad = (h) => assert.deepEqual(sanitizeParts({ harmony: h }), { parts: {}, skipped: 1 }, JSON.stringify(h));
  bad({ ...ok, meter: undefined });
  bad({ ...ok, bars: undefined });
  bad({ ...ok, key: undefined });
  bad({ ...ok, meter: [7, 8] });
  bad({ ...ok, bars: mkBars([['A', 'min'], ['C#', 'maj']]) }); // Akkord nicht in der Tonart
  bad({ ...ok, bars: mkBars(undefined, 3) }); // beats ungleich Schläge der Taktart
  bad({ ...ok, bars: [] });
  bad({ ...ok, bars: [null] });
  bad({ ...ok, key: { root: 'H', mode: 'minor' } });
});

test('sanitizeParts harmony: scale, chordColor, chordColorFromStyle einzeln', () => {
  const ok = { key: { root: 'A', mode: 'minor' }, bars: mkBars(), meter: [4, 4] };
  const r = sanitizeParts({ harmony: { ...ok, scale: 'nope', chordColor: 'power', chordColorFromStyle: 1 } });
  assert.deepEqual(r.parts.harmony, { ...ok, chordColor: 'power' });
  assert.equal(r.skipped, 2);
});

test('sanitizeParts: Einträge von voices, jobs, layers, mix und timbre einzeln', () => {
  const r = sanitizeParts({
    voices: { voices: { chords: { id: 'sample', variant: 'jazz' }, bass: 'sample', lead: 'gibtsnicht', drums: { id: 'sample', variant: 'nope' }, banjo: 'x' }, jobs: { lead: 'melody', percussion: 'nope', drums: 'x' } },
    layers: { layers: { lead: false, bass: 'ja', zither: true } },
    mixer: { mix: { drums: 0.5, bass: 2, master: -1, pad: 'x', zither: 1 } },
    sound: { timbre: { master: { echo: 0.2, reverb: 3, nope: 1 }, nogroup: { a: 1 }, bass: { sub: NaN } } },
  });
  assert.deepEqual(r.parts, {
    voices: { voices: { chords: { id: 'sample', variant: 'jazz' }, bass: { id: 'sample' } }, jobs: { lead: 'melody' } },
    layers: { layers: { lead: false } },
    mixer: { mix: { drums: 0.5 } },
    sound: { timbre: { master: { echo: 0.2 } } },
  });
  // voices (lead, drums) + jobs (percussion, drums) + layers (bass) + mix (bass, master, pad) + timbre (reverb, bass.sub); Unbekanntes zählt nicht
  assert.equal(r.skipped, 10);
});

test('sanitizeParts: timbre {} bleibt (Rücksetzen), ganz ungültiges timbre nicht', () => {
  assert.deepEqual(sanitizeParts({ sound: { timbre: {} } }), { parts: { sound: { timbre: {} } }, skipped: 0 });
  assert.deepEqual(sanitizeParts({ sound: { timbre: { master: { echo: 9 } } } }).parts, {});
});

test('sanitizeParts tags: ein Wert, ganz oder gar nicht', () => {
  assert.deepEqual(sanitizeParts({ style: { tags: { mood: ['dark'], drums: ['driving'] } } }).parts, { style: { tags: { mood: ['dark'], drums: ['driving'] } } });
  assert.deepEqual(sanitizeParts({ style: { tags: { mood: ['dark', 'nope'] } } }), { parts: {}, skipped: 1 });
  assert.deepEqual(sanitizeParts({ style: { tags: [] } }), { parts: {}, skipped: 1 });
});

test('sanitizeParts: Teil ohne brauchbares Feld fällt weg', () => {
  assert.deepEqual(sanitizeParts({ tempo: {}, rhythm: { nope: 1 }, layers: { layers: {} } }), { parts: {}, skipped: 0 });
});

test('sanitizeParts: feindliche Eingaben werfen nicht, Prototyp bleibt sauber', () => {
  for (const hostile of ['str', [], null, undefined, 5, NaN, () => 1, { tempo: 'x' }, { tempo: [] }, { tempo: { bpm: NaN } }, { tempo: { bpm: 1e308 } }, { tempo: { bpm: Infinity } },
    { harmony: { key: () => 1, bars: [() => 1], meter: 'x' } }, { harmony: { key: { root: 'A', mode: 'minor' }, meter: [4, 4], bars: [{ chord: () => 1, beats: 4 }] } },
    { variant: { seed: 1e30 } }, { sound: { timbre: [] } }, { voices: { voices: 'x', jobs: 5 } }, { mixer: { mix: [] } }]) {
    const r = sanitizeParts(hostile);
    assert.ok(r && typeof r.skipped === 'number' && typeof r.parts === 'object', String(hostile));
  }
  const evil = JSON.parse('{"__proto__":{"x":1},"tempo":{"bpm":100,"__proto__":{"y":1}},"mixer":{"mix":{"__proto__":0.5,"constructor":1,"prototype":1,"drums":0.5}}}');
  const r = sanitizeParts(evil);
  assert.deepEqual(r.parts, { tempo: { bpm: 100 }, mixer: { mix: { drums: 0.5 } } });
  assert.equal(r.skipped, 5);
  assert.equal(({}).x, undefined);
  assert.equal(({}).y, undefined);
  assert.equal(Object.getPrototypeOf(r.parts), Object.prototype);
  assert.equal(Object.getPrototypeOf(r.parts.mixer.mix), Object.prototype);
});

test('partIdsOf: in PART_IDS-Reihenfolge', () => {
  assert.deepEqual(partIdsOf({ variant: {}, tempo: {}, harmony: {} }), ['harmony', 'tempo', 'variant']);
  assert.deepEqual(partIdsOf({}), []);
});

test('mergeParts: Teile aus over ersetzen die in base, andere bleiben', () => {
  const base = { tempo: { bpm: 90 }, style: { style: 'funk', tags: {} } };
  const over = { tempo: { bpm: 120 }, variant: { seed: 3 } };
  const m = mergeParts(base, over);
  assert.deepEqual(m, { tempo: { bpm: 120 }, style: { style: 'funk', tags: {} }, variant: { seed: 3 } });
  assert.deepEqual(base.tempo, { bpm: 90 }, 'base unverändert');
  over.variant.seed = 9;
  assert.equal(m.variant.seed, 3, 'Kopie');
});

test('sanitizeParts: werfende Zugriffe (Getter, Proxy) ergeben { parts: {}, skipped: 1 }', () => {
  const boom = () => { throw new Error('boom'); };
  assert.deepEqual(sanitizeParts({ get tempo() { return boom(); } }), { parts: {}, skipped: 1 });
  assert.deepEqual(sanitizeParts({ tempo: { get bpm() { return boom(); } } }), { parts: {}, skipped: 1 });
  assert.deepEqual(sanitizeParts(new Proxy({}, { ownKeys: boom, getPrototypeOf: () => Object.prototype })), { parts: {}, skipped: 1 });
});

test('sanitizeParts harmony: höchstens 512 Takte, mehr lässt den Teil wegfallen', () => {
  const harmony = (n) => ({ key: { root: 'A', mode: 'minor' }, meter: [4, 4], bars: mkBars(Array.from({ length: n }, () => ['A', 'min'])) });
  assert.equal(sanitizeParts({ harmony: harmony(512) }).parts.harmony.bars.length, 512);
  assert.deepEqual(sanitizeParts({ harmony: harmony(513) }), { parts: {}, skipped: 1 });
});

test('jeder Teil allein: captureParts -> applyParts ergibt dieselbe Sitzung, ohne Aliasing', () => {
  const mutate = (o) => { for (const k of Object.keys(o)) { if (o[k] && typeof o[k] === 'object') mutate(o[k]); else o[k] = 'X'; } if (Array.isArray(o)) o.push('X'); else o.zz = 'X'; };
  for (const id of PART_IDS) {
    const parts = captureParts(session({ track: track({ form: structuredClone(FORM), length: 48 }) }));
    const r = applyParts(session(), { [id]: parts[id] });
    assert.ok(r.ok, id);
    const want = session();
    if (id === 'form') want.track.form = FORM;
    if (id === 'voices') want.track.voices = completeVoices(want.track.voices); // festgehalten wird die vollständige Wahl, gleich klingend
    assert.deepEqual(r.session, want, id);
    const before = structuredClone(r.session);
    mutate(parts);
    assert.deepEqual(r.session, before, `${id}: kein Aliasing`);
  }
});

// ---------- Teil form (Songform) ----------

const withForm = (form = structuredClone(FORM), extra = {}) => session({ track: track({ form, length: form.sections.reduce((n, x) => n + x.bars, 0), ...extra }) });
const sumOf = (f) => f.sections.reduce((n, x) => n + x.bars, 0);

test('captureParts form: ohne Form (oder mit unbrauchbarer) gibt es den Teil nicht', () => {
  assert.deepEqual(captureParts(session(), ['form']), {});
  assert.equal(captureParts(session()).form, undefined);
  assert.equal(Object.keys(captureParts(session())).length, 9);
  assert.deepEqual(captureParts(withForm({ ...FORM, sections: [{ type: 'nope', bars: 8 }] }), ['form']), {});
  assert.deepEqual(captureParts(withForm(), ['form']), { form: { form: FORM } });
});

test('sanitizeParts form: gültige Form unverändert, Rundlauf über JSON, unbekannte Felder ignoriert', () => {
  const r = sanitizeParts(JSON.parse(JSON.stringify({ form: { form: FORM } })));
  assert.deepEqual(r, { parts: { form: { form: FORM } }, skipped: 0 });
  const extra = sanitizeParts({ form: { zukunft: 1, form: { ...FORM, neu: 1, sections: FORM.sections.map((s) => ({ ...s, farbe: 'rot' })) } } });
  assert.deepEqual(extra, { parts: { form: { form: FORM } }, skipped: 0 });
});

test('sanitizeParts form: ungültige Teile der Liste einzeln verworfen und gezählt, Rest bleibt', () => {
  const r = sanitizeParts({ form: { form: { template: 'jam', auto: false, feel: {}, sections: [
    { type: 'verse', bars: 8 }, { type: 'nope', bars: 8 }, { type: 'chorus', bars: 0 }, { type: 'chorus', bars: 1.5 }, { type: 'chorus', bars: 65 },
    { type: 'break', bars: 4, level: 5 }, { type: 'break', bars: 4, density: 2 }, { type: 'break', bars: 4, transition: 'x' }, { type: 'break', bars: 4, crash: 'ja' },
    { type: 'break', bars: 4, locked: 1 }, 'str', null, 5, [], { type: 'outro', bars: 4, level: -6, transition: 'stop' },
  ] } } });
  assert.deepEqual(r.parts.form.form.sections, [{ type: 'verse', bars: 8 }, { type: 'outro', bars: 4, level: -6, transition: 'stop' }]);
  assert.equal(r.skipped, 13);
  assert.deepEqual(r.parts.form.form.feel, { structure: 0.6, dynamics: 0.6, pauses: 0.4, randomness: 0.5 }, 'fehlende Regler: Standard');
  assert.equal(r.parts.form.form.template, 'jam');
});

test('sanitizeParts form: leere oder fehlende Liste lässt den Teil wegfallen', () => {
  for (const sections of [[], undefined, 'x', {}, [{ type: 'nope', bars: 8 }]]) {
    const r = sanitizeParts({ form: { form: { template: 'pop', sections } } });
    assert.deepEqual(r.parts, {}, JSON.stringify(sections));
  }
  assert.equal(sanitizeParts({ form: { form: { template: 'pop', sections: [] } } }).skipped, 0, 'leere Liste: kein Fehler gezählt');
  assert.deepEqual(sanitizeParts({ form: {} }), { parts: {}, skipped: 0 });
  for (const form of ['x', 5, [], null]) assert.deepEqual(sanitizeParts({ form: { form } }), { parts: {}, skipped: 1 });
});

test('sanitizeParts form: Vorlage, auto und Regler wie normalizeForm geprüft', () => {
  const sec = [{ type: 'verse', bars: 8 }];
  const one = (form) => sanitizeParts({ form: { form: { sections: sec, ...form } } });
  assert.equal(one({ template: 'blues', auto: true }).parts.form.form.auto, true);
  assert.equal(one({ template: 'blues' }).parts.form.form.auto, false);
  const r = one({ template: 'gibtsnicht', auto: 'ja' });
  assert.equal(r.skipped, 2);
  assert.ok(typeof r.parts.form.form.template === 'string' && typeof r.parts.form.form.auto === 'boolean');
  const f = one({ template: 'pop', feel: { structure: 2, dynamics: 1.3, pauses: NaN, randomness: -1, zusatz: 1 } });
  assert.deepEqual(f.parts.form.form.feel, { structure: 0.6, dynamics: 1.3, pauses: 0.4, randomness: 0.5 });
  assert.equal(f.skipped, 3);
  assert.equal(one({ template: 'pop', feel: 'x' }).skipped, 1);
  assert.equal(one({ template: 'pop', feel: { dynamics: 1.31 } }).skipped, 1);
});

test('sanitizeParts form: bis 64 Teile und 512 Takte, riesige Listen kosten nichts und werfen nicht', () => {
  const many = Array.from({ length: 200000 }, () => ({ type: 'verse', bars: 1 }));
  let r = sanitizeParts({ form: { form: { template: 'pop', sections: many } } });
  assert.equal(r.parts.form.form.sections.length, 64);
  assert.equal(r.skipped, 200000 - 64);
  r = sanitizeParts({ form: { form: { template: 'pop', sections: Array.from({ length: 20 }, () => ({ type: 'verse', bars: 64 })) } } });
  assert.equal(r.parts.form.form.sections.length, 8, '8 x 64 = 512');
  assert.equal(r.skipped, 12);
  assert.ok(sumOf(r.parts.form.form) <= 512);
  assert.ok(applyParts(session(), r.parts).ok);
});

test('sanitizeParts form: __proto__, constructor und prototype in Form, Teilen und Reglern', () => {
  const evil = JSON.parse('{"form":{"__proto__":{"x":1},"form":{"__proto__":{"y":1},"template":"pop","feel":{"__proto__":{"z":1},"structure":0.2,"constructor":1},"sections":[{"__proto__":{"w":1},"type":"verse","bars":8,"prototype":1},{"constructor":{"a":1},"type":"outro","bars":4}]}}}');
  const r = sanitizeParts(evil);
  assert.deepEqual(r.parts.form.form.sections, [{ type: 'verse', bars: 8 }, { type: 'outro', bars: 4 }]);
  assert.equal(r.parts.form.form.feel.structure, 0.2);
  assert.ok(r.skipped >= 5, 'verbotene Schlüssel zählen als ungültig');
  for (const k of ['x', 'y', 'z', 'w', 'a']) assert.equal(({})[k], undefined);
  assert.equal(Object.getPrototypeOf(r.parts.form.form.sections[0]), Object.prototype);
  assert.equal(Object.getPrototypeOf(r.parts.form.form.feel), Object.prototype);
  for (const hostile of [{ form: { form: { sections: [() => 1, new Proxy({}, { ownKeys() { throw new Error('boom'); } })] } } }, { form: { form: { sections: { length: 1e9 } } } }]) {
    const h = sanitizeParts(hostile);
    assert.ok(h && typeof h.skipped === 'number', 'wirft nicht');
  }
});

test('applyParts form: setzt die Form, die Länge ist die Summe der Teile, Eingabe bleibt unverändert', () => {
  const s = deepFreeze(session()); // length 48, ohne Form
  const other = { ...structuredClone(FORM), sections: [{ type: 'verse', bars: 10 }, { type: 'chorus', bars: 14 }] };
  const r = applyParts(s, { form: { form: other }, rhythm: { length: 96 } });
  assert.ok(r.ok);
  assert.deepEqual(r.session.track.form, other);
  assert.equal(r.session.track.length, 24, 'die Form gewinnt gegen rhythm.length');
  assert.notEqual(r.session.track.form, other, 'Kopie');
  assert.equal(s.track.form, undefined);
});

test('applyParts: Profile ohne Teil form lassen die Form unberührt', () => {
  const s = deepFreeze(withForm());
  for (const parts of [{}, { tempo: { bpm: 77 } }, { rhythm: { groove: 'straight' } }, { harmony: captureParts(session()).harmony }, { style: { style: 'rock' } }]) {
    const r = applyParts(s, parts);
    assert.ok(r.ok);
    assert.deepEqual(r.session.track.form, FORM, JSON.stringify(Object.keys(parts)));
    assert.equal(r.session.track.length, 48);
  }
});

test('applyParts: rhythm.length ohne Teil form würfelt die vorhandene Form für die nächste Zielgröße neu', () => {
  const s = deepFreeze(withForm({ ...structuredClone(FORM), auto: false, template: 'rock' }));
  const r = applyParts(s, { rhythm: { length: 96 } });
  assert.ok(r.ok);
  const f = r.session.track.form;
  assert.equal(f.template, 'rock');
  assert.equal(f.auto, false);
  assert.deepEqual(f.feel, FORM.feel, 'Regler bleiben');
  assert.ok(Math.abs(sumOf(f) - 96) <= 12, `Summe ${sumOf(f)} nahe 96`);
  assert.equal(r.session.track.length, sumOf(f));
  assert.deepEqual(applyParts(s, { rhythm: { length: 96 } }).session.track.form, f, 'reproduzierbar');
  const near = applyParts(s, { rhythm: { length: 50 } }).session.track.form; // nächste Zielgröße: 48
  assert.ok(Math.abs(sumOf(near) - 48) <= 8, `Summe ${sumOf(near)} nahe 48`);
  assert.equal(applyParts(withForm({ ...structuredClone(FORM), auto: true }), { rhythm: { length: 96 } }).session.track.form.auto, true, 'Auto bleibt Auto');
  // rhythm ohne length rührt die Form nicht an
  assert.deepEqual(applyParts(s, { rhythm: { groove: null } }).session.track.form, s.track.form);
});

test('applyParts: ohne Form setzt rhythm.length nur die Länge (Ohne Form bleibt Ohne Form)', () => {
  const r = applyParts(session(), { rhythm: { length: 96 } });
  assert.equal(r.session.track.length, 96);
  assert.equal(r.session.track.form, undefined);
});

test('Rundlauf: Sitzung mit Form -> captureParts -> JSON -> sanitizeParts -> applyParts ergibt dieselbe Form', () => {
  const s = withForm();
  const { parts, skipped } = sanitizeParts(JSON.parse(JSON.stringify(captureParts(s))));
  assert.equal(skipped, 0);
  assert.deepEqual(Object.keys(parts), PART_IDS);
  const r = applyParts(withForm({ ...structuredClone(FORM), sections: [{ type: 'verse', bars: 24 }, { type: 'chorus', bars: 24 }], feel: { structure: 0, dynamics: 0, pauses: 0, randomness: 0 } }), parts);
  assert.ok(r.ok);
  assert.deepEqual(r.session.track.form, FORM);
  assert.equal(r.session.track.length, 48);
});

test('applyParts: gleiche Zielgröße wie die vorhandene Form behält die Form samt Sperren, andere Zielgröße würfelt neu ohne Sperren', () => {
  const s = deepFreeze(withForm()); // Summe 48, ein gesperrter Teil
  for (const length of [48, 50, 44]) { // alle mit nächster Zielgröße 48
    const r = applyParts(s, { rhythm: { length } });
    assert.ok(r.ok);
    assert.deepEqual(r.session.track.form, FORM, `Länge ${length}: unverändert`);
    assert.equal(r.session.track.length, 48);
  }
  const other = applyParts(s, { rhythm: { length: 96 } }).session.track.form;
  assert.ok(other.sections.every((x) => !x.locked), 'Sperren fallen beim Neuwürfeln');
  assert.ok(Math.abs(sumOf(other) - 96) <= 12);
});

test('sanitizeParts form: Reglernamen werden als eigene Schlüssel geprüft (toString, valueOf zählen nicht)', () => {
  const r = sanitizeParts({ form: { form: { template: 'pop', sections: [{ type: 'verse', bars: 8 }], feel: { toString: 5, valueOf: 'x', hasOwnProperty: 1, structure: 0.2 } } } });
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.parts.form.form.feel, { structure: 0.2, dynamics: 0.6, pauses: 0.4, randomness: 0.5 });
});
