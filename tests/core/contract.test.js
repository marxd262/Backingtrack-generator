// Vertrag mit Interactive Scales: Track im alten Format, Seed-Regel, Ebenen, Fehler, Presets und Schlagworte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, chordTimeline, validateTrack, TAG_CATEGORIES, STYLE_PRESETS } from '../../src/index.js';
import { createRng } from '../../src/core/rng.js';

const bar = (root, quality, beats = 4) => ({ chord: { root, quality }, beats });
// Format von Interactive Scales heute: keine tags, seed, layers, length
const legacy = () => ({
  id: 'x', title: 'y', key: { root: 'A', mode: 'minor' }, bpm: 90,
  bars: [bar('A', 'min'), bar('D', 'min'), bar('E', 'min'), bar('A', 'min')],
});
const drumHits = (track) => buildEvents(track).filter((e) => e.type === 'hit').map((e) => [e.bar, e.beat, e.name]);

test('Track im alten Format wird akzeptiert und ergibt gültige Ereignisse', () => {
  const events = buildEvents(legacy());
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.ok(Number.isFinite(e.t) && e.t >= 0, 't');
    assert.ok(Number.isInteger(e.bar) && e.bar >= 0 && e.bar < 24, 'bar');
    assert.ok(['chord', 'marker', 'hit', 'note'].includes(e.type), e.type);
  }
  assert.deepEqual(events.map((e) => e.t), [...events.map((e) => e.t)].sort((a, b) => a - b));
  assert.equal(events.filter((e) => e.type === 'chord').length, 24);
});

test('chordTimeline für das alte Format: Takte 0..23, Dauer aus bpm, erster Akkord bei 0', () => {
  const tl = chordTimeline(legacy());
  assert.deepEqual(tl.map((e) => e.bar), Array.from({ length: 24 }, (_, i) => i));
  assert.equal(tl[0].time, 0);
  assert.deepEqual(tl[0].chord, { root: 'A', quality: 'min' });
  assert.ok(tl.every((e) => e.durationSec === 2.666667));
  assert.equal(tl[1].time, 2.666667);
});

test('Tempo-Überschreibung (?bpm=): bpm im Track ersetzen skaliert die Zeiten mit 90/120', () => {
  const slow = chordTimeline(legacy());
  const fast = chordTimeline({ ...legacy(), bpm: 120 });
  slow.forEach((e, i) => {
    assert.ok(Math.abs(fast[i].time - (e.time * 90) / 120) < 2e-6, `bar ${i}`);
    assert.deepEqual(fast[i].chord, e.chord);
  });
});

test('Seed-Regel: ohne Seed gilt Seed 1, mit Seed ist die Ausgabe wiederholbar', () => {
  assert.deepEqual(buildEvents(legacy()), buildEvents(legacy()));
  assert.deepEqual(buildEvents(legacy()), buildEvents({ ...legacy(), seed: 1 }));
  assert.deepEqual(buildEvents({ ...legacy(), seed: 7 }), buildEvents({ ...legacy(), seed: 7 }));
  assert.notDeepEqual(drumHits({ ...legacy(), seed: 7 }), drumHits({ ...legacy(), seed: 8 }));
});

test('ausgeschaltete Ebenen liefern nur chord- und marker-Ereignisse', () => {
  const layers = { drums: false, bass: false, chords: false, pad: false };
  const types = new Set(buildEvents({ ...legacy(), layers }).map((e) => e.type));
  assert.deepEqual([...types].sort(), ['chord', 'marker']);
});

test('ungültiger Track wirft mit errors (chordNotInKey, badBpm)', () => {
  const bad = { ...legacy(), bpm: 5, bars: [bar('F#', 'maj')] };
  for (const fn of [buildEvents, chordTimeline]) {
    assert.throws(() => fn(bad), (err) => {
      const codes = err.errors.map((e) => e.code);
      return codes.includes('chordNotInKey') && codes.includes('badBpm');
    });
  }
});

test('jedes Stil-Preset und jedes Schlagwort passt in einen gültigen Track', () => {
  for (const preset of STYLE_PRESETS) {
    assert.deepEqual(validateTrack({ ...legacy(), length: 24, tags: preset.tags, bpm: preset.bpm }), [], preset.id);
    assert.ok(buildEvents({ ...legacy(), tags: preset.tags, bpm: preset.bpm }).length > 0, preset.id);
  }
  const all = Object.fromEntries(TAG_CATEGORIES.map((c) => [c.id, c.tags]));
  assert.ok(buildEvents({ ...legacy(), tags: all }).length > 0);
  for (const c of TAG_CATEGORIES) for (const tag of c.tags) assert.ok(buildEvents({ ...legacy(), tags: { [c.id]: [tag] } }).length > 0, tag);
});

test('öffentliches validateTrack wendet Standardwerte an: altes Format ist gültig', () => {
  assert.deepEqual(validateTrack(legacy()), []);
});

test('öffentliches validateTrack wirft nie und meldet Codes für Müll', () => {
  for (const bad of [{}, null, undefined]) {
    const codes = validateTrack(bad).map((e) => e.code);
    assert.ok(codes.includes('badKey') && codes.includes('emptyBars'), String(bad));
  }
  const codes = validateTrack({ ...legacy(), bars: [bar('F#', 'maj')] }).map((e) => e.code);
  assert.deepEqual(codes, ['chordNotInKey']);
});

test('öffentliches validateTrack ist genau dann leer, wenn buildEvents nicht wirft', () => {
  const tracks = [
    legacy(), { ...legacy(), length: 2 }, { ...legacy(), bpm: 5 }, { ...legacy(), length: 0 },
    { ...legacy(), bars: [] }, { ...legacy(), bars: [bar('F#', 'maj')] }, { ...legacy(), bars: [bar('A', 'min', 0)] }, {},
    // Schlagworte: kein Objekt, unbekannte Kategorie oder Schlagwort, Liste statt String, Prototyp-Schlüssel
    { ...legacy(), tags: 'driving' }, { ...legacy(), tags: [] }, { ...legacy(), tags: { nope: ['driving'] } },
    { ...legacy(), tags: { drums: ['nope'] } }, { ...legacy(), tags: { drums: 'driving' } }, { ...legacy(), tags: { bass: ['driving'] } },
    { ...legacy(), tags: JSON.parse('{"__proto__": ["driving"]}') }, { ...legacy(), tags: { constructor: ['driving'] } },
    { ...legacy(), tags: null }, { ...legacy(), tags: { drums: ['driving'] } },
    // Schläge: Obergrenze 16
    { ...legacy(), bars: [bar('A', 'min', 17)] }, { ...legacy(), bars: [bar('A', 'min', 1e5)] },
    { ...legacy(), bars: [bar('A', 'min', 3)] }, { ...legacy(), bars: [bar('A', 'min', 16)] },
  ];
  for (const track of tracks) {
    let threw = null;
    try { buildEvents(track); } catch (err) { threw = err; }
    assert.equal(validateTrack(track).length > 0, threw !== null, JSON.stringify(track));
    // wer wirft, wirft mit den Codes
    if (threw) assert.deepEqual(threw.errors, validateTrack(track), JSON.stringify(track));
  }
});

test('Stichprobe aus 200 seltsamen Tracks: buildEvents wirft genau dann, wenn validateTrack meldet, und dann mit errors', () => {
  const rng = createRng(2026);
  const pick = (list) => list[rng.int(0, list.length - 1)];
  // meist gültige, aber ungewöhnliche Werte, selten ungültige: so wird beides oft geprüft
  const odd = (valid, invalid) => (rng.next() < 0.1 ? pick(invalid) : pick(valid));
  const all = Object.fromEntries(TAG_CATEGORIES.map((c) => [c.id, c.tags]));
  const validTags = [undefined, null, {}, { drums: ['driving', 'loose'] }, { synths: ['arpeggio', 'warm'], development: ['buildsSlowly', 'fullFromStart'] },
    { development: ['buildsSlowly'], rhythm: ['swing', 'straight'] }, { mood: [] }, all];
  const badTags = ['x', [], { drums: 'driving' }, { nope: [] }, { mood: [7] }, JSON.parse('{"__proto__": []}')];
  const chords = [['A', 'min'], ['D', 'min'], ['E', 'maj'], ['E', 'min'], ['F', 'maj'], ['G', 'maj'], ['B', 'dim'], ['C', 'maj']];
  let accepted = 0;
  for (let i = 0; i < 200; i++) {
    const track = {
      ...legacy(),
      bars: Array.from({ length: rng.int(1, 5) }, () => {
        const [root, quality] = odd(chords, [['F#', 'maj'], ['A', 'xyz']]);
        return bar(root, quality, odd([1, 2, 3, 4, 5, 7, 12, 16], [0, 17, 2.5, 1e5]));
      }),
      tags: odd(validTags, badTags),
      length: odd([undefined, 1, 3, 4, 24, 100, 512], [0, 513]),
      bpm: odd([20, 40, 90, 237.5, 400], [401, NaN]),
      seed: pick([undefined, 0, 1, 7, -1, 2 ** 32 + 5, 1.5]),
    };
    const errors = validateTrack(track);
    let threw = null;
    try { buildEvents(track); } catch (err) { threw = err; }
    if (errors.length === 0) {
      accepted++;
      assert.equal(threw, null, `${JSON.stringify(track)}: ${threw?.message}`);
    } else {
      assert.deepEqual(threw?.errors, errors, JSON.stringify(track));
    }
  }
  assert.ok(accepted >= 10 && accepted <= 190, `angenommen: ${accepted}`);
});
