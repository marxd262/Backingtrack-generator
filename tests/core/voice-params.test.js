import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIMBRE, resolveTimbre } from '../../src/core/timbre.js';
import { bassParams, drumParams, chordParams, padParams, masterParams } from '../../src/audio/voice-params.js';

const STEPS = [0, 0.25, 0.5, 0.75, 1];
const BASS_INPUTS = Object.keys(DEFAULT_TIMBRE.bass);
const withInput = (key, value) => ({ ...DEFAULT_TIMBRE.bass, [key]: value });

// Bereiche je Feld über alle Eingaben (Extreme eingeschlossen)
const RANGES = {
  sawDetune: [6, 6],
  q: [1, 14],
  lpStart: [100, 15000],
  lpEnd: [40, 1000],
  lpTime: [0.02, 1.25],
  sawMix: [0, 1],
  triMix: [0, 1],
  sineGain: [0.4, 4],
  peak: [0.5, 0.5],
  sustain: [0.2, 1],
  attack: [0.004, 0.004],
  release: [0.05, 0.05],
  holdMin: [0.03, 0.03],
  holdCut: [0.06, 0.06],
};

test('bassParams: neutraler Bass ergibt exakt die bisherigen Konstanten aus bassNote', () => {
  assert.deepEqual(bassParams(DEFAULT_TIMBRE.bass), {
    sawDetune: 6, // Sägezähne bei -6 und +6 Cent
    q: 4,
    lpStart: 2200,
    lpEnd: 320,
    lpTime: 0.15,
    sawMix: 1,
    triMix: 0,
    sineGain: 1, // Sinus direkt auf die Hüllkurve
    peak: 0.5, // Hüllkurvenspitze vel * 0.5
    sustain: 1, // flach während der Haltezeit
    attack: 0.004,
    release: 0.05,
    holdMin: 0.03, // Haltezeit max(0.03, dur - 0.06)
    holdCut: 0.06,
  });
});

test('bassParams: jedes Mal ein neues Objekt', () => {
  const a = bassParams(DEFAULT_TIMBRE.bass);
  assert.notEqual(a, bassParams(DEFAULT_TIMBRE.bass));
  a.q = 99;
  assert.equal(bassParams(DEFAULT_TIMBRE.bass).q, 4);
});

test('bassParams: jedes Feld monoton in jedem Eingang (andere neutral), endlich, im Bereich', () => {
  for (const key of BASS_INPUTS) {
    const rows = STEPS.map((v) => bassParams(withInput(key, v)));
    for (const field of Object.keys(RANGES)) {
      const values = rows.map((r) => r[field]);
      const [lo, hi] = RANGES[field];
      for (const v of values) assert.ok(Number.isFinite(v) && v >= lo && v <= hi, `${key} -> ${field}: ${v} nicht in [${lo}, ${hi}]`);
      const steps = values.slice(1).map((v, i) => v - values[i]);
      assert.ok(steps.every((d) => d >= 0) || steps.every((d) => d <= 0), `${key} -> ${field} nicht monoton: ${values}`);
    }
  }
});

test('bassParams: beabsichtigte Richtungen (streng über die Tabelle)', () => {
  // [Eingang, Feld, +1 steigend / -1 fallend]
  const effects = [
    ['sub', 'sineGain', 1], ['sub', 'sawMix', -1], ['sub', 'lpEnd', -1], ['sub', 'lpStart', -1],
    ['pluck', 'lpTime', -1], ['pluck', 'lpStart', 1],
    ['cutoff', 'lpStart', 1], ['cutoff', 'lpEnd', 1],
    ['resonance', 'q', 1], ['resonance', 'sineGain', -1], ['resonance', 'lpTime', 1],
    ['roundness', 'triMix', 1], ['roundness', 'sawMix', -1],
  ];
  for (const [key, field, sign] of effects) {
    const values = STEPS.map((v) => bassParams(withInput(key, v))[field]);
    for (let i = 1; i < values.length; i++) assert.ok(sign * (values[i] - values[i - 1]) > 0, `${key} -> ${field}: ${values}`);
  }
  // zupfend klingt erst oberhalb der Mitte ab
  assert.deepEqual([0, 0.25, 0.5].map((v) => bassParams(withInput('pluck', v)).sustain), [1, 1, 1]);
  assert.ok(bassParams(withInput('pluck', 1)).sustain < bassParams(withInput('pluck', 0.75)).sustain);
});

test('bassParams: Extreme (alle 0, alle 1, gemischt) endlich und im Bereich', () => {
  const zero = Object.fromEntries(BASS_INPUTS.map((k) => [k, 0]));
  const one = Object.fromEntries(BASS_INPUTS.map((k) => [k, 1]));
  const mixed = { sub: 1, fuzz: 1, pluck: 0, cutoff: 0, resonance: 1, roundness: 1 };
  for (const t of [zero, one, mixed, { ...one, cutoff: 0 }, { ...zero, cutoff: 1, resonance: 1 }]) {
    const p = bassParams(t);
    for (const [field, [lo, hi]] of Object.entries(RANGES)) {
      assert.ok(Number.isFinite(p[field]) && p[field] >= lo && p[field] <= hi, `${JSON.stringify(t)} -> ${field}: ${p[field]}`);
    }
  }
});

// Schlagzeug: Timbre['drums'] -> drumParams
const DRUM_INPUTS = Object.keys(DEFAULT_TIMBRE.drums);
const withDrum = (key, value) => ({ ...DEFAULT_TIMBRE.drums, [key]: value });

// Rundungsfehler der Potenzen an den Rändern (z. B. 109.99999999999999) zählen nicht
const within = (v, [lo, hi]) => Number.isFinite(v) && v >= lo - 1e-9 * Math.abs(lo) - 1e-12 && v <= hi + 1e-9 * Math.abs(hi);
const DRUM_RANGES = {
  kickStart: [110, 260],
  kickEnd: [36, 53],
  kickDrop: [0.07, 0.2],
  kickDecay: [0.15, 0.9],
  kickPeak: [0.67, 1],
  kickClick: [0, 0.5],
  snareFreq: [1020, 4800], // Tonlage 1200..3200 Hz, knackig bis x1.5
  snareQ: [0.6, 2],
  snareNoise: [0.19, 4.2], // nur am Rand der Kombination (snareSnap und snareTone je 1): x7.5 gegenüber dem Standard
  snareClick: [0, 1.6],
  snareTone: [0.12, 0.6],
  snareDecay: [0.07, 0.3],
  hatFreq: [4500, 11000],
  hatPeak: [0.14, 2.1],
  hatClosedDecay: [0.012, 0.1],
  hatOpenDecay: [0.06, 0.5],
  roomSend: [0, 7],
};

test('drumParams: neutrales Schlagzeug ergibt exakt die bisherigen Konstanten aus drumVoices', () => {
  assert.deepEqual(drumParams(DEFAULT_TIMBRE.drums), {
    kickStart: 150,
    kickEnd: 46,
    kickDrop: 0.12, // Tonhöhenabfall in s
    kickDecay: 0.4, // Pegelabfall bis 0.001 in s
    kickPeak: 0.9, // Spitze vel * 0.9
    kickClick: 0, // 0 = ohne Klick-Knoten
    snareFreq: 1900, // Bandpass
    snareQ: 0.8,
    snareNoise: 0.55, // Rauschspitze vel * 0.55
    snareClick: 0, // 0 = ohne Klick-Knoten
    snareTone: 0.3, // Dreieck 185 Hz, vel * 0.3
    snareDecay: 0.16, // Ausklang des Rauschens in s
    hatFreq: 7500, // Hochpass
    hatPeak: 0.3,
    hatClosedDecay: 0.04,
    hatOpenDecay: 0.2,
    roomSend: 0, // 0 = ohne Sendeweg
  });
});

test('drumParams: jedes Mal ein neues Objekt', () => {
  const a = drumParams(DEFAULT_TIMBRE.drums);
  assert.notEqual(a, drumParams(DEFAULT_TIMBRE.drums));
  a.kickStart = 99;
  assert.equal(drumParams(DEFAULT_TIMBRE.drums).kickStart, 150);
});

test('drumParams: jedes Feld monoton in jedem Eingang (andere neutral), endlich, im Bereich', () => {
  for (const key of DRUM_INPUTS) {
    const rows = STEPS.map((v) => drumParams(withDrum(key, v)));
    for (const field of Object.keys(DRUM_RANGES)) {
      const values = rows.map((r) => r[field]);
      const [lo, hi] = DRUM_RANGES[field];
      for (const v of values) assert.ok(within(v, [lo, hi]), `${key} -> ${field}: ${v} nicht in [${lo}, ${hi}]`);
      const steps = values.slice(1).map((v, i) => v - values[i]);
      assert.ok(steps.every((d) => d >= 0) || steps.every((d) => d <= 0), `${key} -> ${field} nicht monoton: ${values}`);
    }
  }
});

test('drumParams: beabsichtigte Richtungen (streng über die Tabelle, ab der Mitte für die Klicks, ab 0 für roomSend)', () => {
  // [Eingang, Feld, +1 steigend / -1 fallend]
  const effects = [
    ['kickPunch', 'kickStart', 1],
    ['kickLength', 'kickDecay', 1], ['kickLength', 'kickEnd', -1], ['kickLength', 'kickDrop', 1], ['kickLength', 'kickPeak', -1],
    ['snareTone', 'snareFreq', 1], ['snareTone', 'snareNoise', 1],
    ['snareSnap', 'snareFreq', 1], ['snareSnap', 'snareNoise', 1], ['snareSnap', 'snareTone', -1], ['snareSnap', 'snareDecay', -1], ['snareSnap', 'snareQ', 1],
    ['hatBright', 'hatFreq', 1], ['hatBright', 'hatPeak', 1],
    ['hatLength', 'hatClosedDecay', 1], ['hatLength', 'hatOpenDecay', 1],
  ];
  for (const [key, field, sign] of effects) {
    const values = STEPS.map((v) => drumParams(withDrum(key, v))[field]);
    for (let i = 1; i < values.length; i++) assert.ok(sign * (values[i] - values[i - 1]) > 0, `${key} -> ${field}: ${values}`);
  }
  // Klick und Raum wirken erst oberhalb ihres Standards
  assert.deepEqual([0, 0.25, 0.5].map((v) => drumParams(withDrum('kickPunch', v)).kickClick), [0, 0, 0]);
  assert.ok(drumParams(withDrum('kickPunch', 0.75)).kickClick > 0);
  assert.ok(drumParams(withDrum('kickPunch', 1)).kickClick > drumParams(withDrum('kickPunch', 0.75)).kickClick);
  assert.deepEqual([0, 0.25, 0.5].map((v) => drumParams(withDrum('snareSnap', v)).snareClick), [0, 0, 0]);
  assert.ok(drumParams(withDrum('snareSnap', 1)).snareClick > drumParams(withDrum('snareSnap', 0.75)).snareClick);
  assert.equal(drumParams(withDrum('room', 0)).roomSend, 0);
  assert.ok(drumParams(withDrum('room', 0.25)).roomSend > 0);
  assert.ok(drumParams(withDrum('room', 1)).roomSend > drumParams(withDrum('room', 0.25)).roomSend);
});

test('drumParams: Extreme (alle 0, alle 1, gemischt) endlich und im Bereich', () => {
  const zero = Object.fromEntries(DRUM_INPUTS.map((k) => [k, 0]));
  const one = Object.fromEntries(DRUM_INPUTS.map((k) => [k, 1]));
  const mixed = { kickPunch: 1, kickLength: 0, snareTone: 1, snareSnap: 0, hatBright: 1, hatLength: 0, room: 1 };
  const flipped = { kickPunch: 0, kickLength: 1, snareTone: 0, snareSnap: 1, hatBright: 0, hatLength: 1, room: 1 };
  for (const t of [zero, one, mixed, flipped]) {
    const p = drumParams(t);
    for (const [field, [lo, hi]] of Object.entries(DRUM_RANGES)) {
      assert.ok(within(p[field], [lo, hi]), `${JSON.stringify(t)} -> ${field}: ${p[field]}`);
    }
  }
});

// Akkorde, Pad und Gesamtklang: Timbre['chords' | 'pad' | 'master'] -> chordParams, padParams, masterParams
const GROUPS = {
  chords: {
    fn: chordParams,
    neutral: {
      lpStart: 3600, // Tiefpass 3600 -> 900 Hz in 0.25 s
      lpEnd: 900,
      lpTime: 0.25,
      holdScale: 1, // Haltezeit max(0.01, dur * 0.5)
      release: 0.2,
      peak: 0.16, // Hüllkurvenspitze vel * 0.16
      attack: 0.003,
      chorusMix: 0, // 0 = ohne zusätzliche Oszillatoren
      chorusDetune: 12,
      tremRate: 6,
      tremDepth: 0, // 0 = ohne Tremolo-Knoten
      tremBase: 1,
    },
    ranges: {
      lpStart: [720, 9000], lpEnd: [180, 2250], lpTime: [0.125, 0.5], holdScale: [0.5, 3], release: [0.06, 0.6],
      peak: [0.05, 0.3], attack: [0.003, 0.003], chorusMix: [0, 1.6], chorusDetune: [12, 12], tremRate: [6, 6], tremDepth: [0, 0.95], tremBase: [0.525, 1],
    },
    // [Eingang, Feld, +1 steigend / -1 fallend] (streng über die Tabelle, außer wo unten gesondert geprüft)
    effects: [
      ['brightness', 'lpStart', 1], ['brightness', 'lpEnd', 1],
      ['length', 'holdScale', 1], ['length', 'release', 1], ['length', 'lpTime', 1],
      ['chorus', 'peak', -1], ['tremolo', 'peak', 1], ['tremolo', 'tremBase', -1], // Tremolo hebt die Spitze an, damit der Pegel (rms) bleibt
    ],
  },
  pad: {
    fn: padParams,
    neutral: {
      attack: 0.45,
      peak: 0.1, // Hüllkurvenspitze vel * 0.1
      holdMin: 0.1, // Haltezeit max(0.1, dur - 0.5)
      holdCut: 0.5,
      holdAttack: 0.45, // ein längerer Einsatz verkürzt die Haltezeit um das Mehr
      release: 0.9,
      cutoff: 1100, // Tiefpass, Q 0.8
      q: 0.8,
      lfoSpeed: 0.18, // Hz
      lfoDepth: 450, // Hz
      spread: 9, // Sägezähne bei -9 / 0 / +9 Cent
      extraMix: 0, // 0 = ohne zusätzliche Oszillatoren
      shimmerMix: 0, // 0 = ohne Oktav-Anteile
    },
    ranges: {
      attack: [0.05, 1.6], peak: [0.03, 0.1], holdMin: [0.1, 0.1], holdCut: [0.5, 0.5], holdAttack: [0.45, 0.45], release: [0.9, 0.9],
      cutoff: [300, 4500], q: [0.8, 0.8], lfoSpeed: [0.05, 1.2], lfoDepth: [100, 1500], spread: [3, 25], extraMix: [0, 1], shimmerMix: [0, 2],
    },
    effects: [
      ['attack', 'attack', 1], ['cutoff', 'cutoff', 1], ['lfoSpeed', 'lfoSpeed', 1], ['lfoDepth', 'lfoDepth', 1],
      ['thickness', 'spread', 1], ['thickness', 'cutoff', -1],
    ],
  },
  master: {
    fn: masterParams,
    neutral: {
      shelfDb: 0, // Hochregal bei 0 dB: kein Filterknoten
      level: 1,
      shelfFreq: 800,
      echoWet: 0.3,
      echoFeedback: 0.38,
      echoTone: 2400,
      reverbWet: 0.15,
    },
    ranges: { level: [0.68, 1], shelfDb: [-15, 9], shelfFreq: [800, 800], echoWet: [0, 1], echoFeedback: [0.1, 0.7], echoTone: [2400, 2400], reverbWet: [0, 0.6] },
    effects: [['brightness', 'shelfDb', 1], ['echo', 'echoWet', 1], ['echo', 'echoFeedback', 1], ['reverb', 'reverbWet', 1]],
  },
};

for (const [group, { fn, neutral, ranges, effects }] of Object.entries(GROUPS)) {
  const inputs = Object.keys(DEFAULT_TIMBRE[group]);
  const withKey = (key, value) => ({ ...DEFAULT_TIMBRE[group], [key]: value });

  test(`${fn.name}: neutrales Klangmodell ergibt exakt die bisherigen Konstanten`, () => {
    assert.deepEqual(fn(DEFAULT_TIMBRE[group]), neutral);
  });

  test(`${fn.name}: jedes Mal ein neues Objekt`, () => {
    const a = fn(DEFAULT_TIMBRE[group]);
    assert.notEqual(a, fn(DEFAULT_TIMBRE[group]));
    a[Object.keys(neutral)[0]] = 99;
    assert.deepEqual(fn(DEFAULT_TIMBRE[group]), neutral);
  });

  test(`${fn.name}: jedes Feld monoton in jedem Eingang (andere neutral), endlich, im Bereich`, () => {
    for (const key of inputs) {
      const rows = STEPS.map((v) => fn(withKey(key, v)));
      for (const field of Object.keys(neutral)) {
        const values = rows.map((r) => r[field]);
        for (const v of values) assert.ok(within(v, ranges[field]), `${key} -> ${field}: ${v} nicht in [${ranges[field]}]`);
        const steps = values.slice(1).map((v, i) => v - values[i]);
        assert.ok(steps.every((d) => d >= 0) || steps.every((d) => d <= 0), `${key} -> ${field} nicht monoton: ${values}`);
      }
    }
  });

  test(`${fn.name}: beabsichtigte Richtungen (streng über die Tabelle)`, () => {
    for (const [key, field, sign] of effects) {
      const values = STEPS.map((v) => fn(withKey(key, v))[field]);
      for (let i = 1; i < values.length; i++) assert.ok(sign * (values[i] - values[i - 1]) > 0, `${key} -> ${field}: ${values}`);
    }
  });

  test(`${fn.name}: Extreme (alle 0, alle 1, gemischt) endlich und im Bereich`, () => {
    const zero = Object.fromEntries(inputs.map((k) => [k, 0]));
    const one = Object.fromEntries(inputs.map((k) => [k, 1]));
    const flipped = Object.fromEntries(inputs.map((k, i) => [k, i % 2]));
    for (const t of [zero, one, flipped, Object.fromEntries(inputs.map((k, i) => [k, 1 - (i % 2)]))]) {
      const p = fn(t);
      for (const [field, range] of Object.entries(ranges)) assert.ok(within(p[field], range), `${JSON.stringify(t)} -> ${field}: ${p[field]}`);
    }
  });
}

test('chordParams: Chorus, Tremolo und Länge schalten ihre Zusatzknoten erst oberhalb von 0 ein', () => {
  const c = (key, v) => chordParams({ ...DEFAULT_TIMBRE.chords, [key]: v });
  assert.equal(c('chorus', 0).chorusMix, 0);
  assert.ok(c('chorus', 0.25).chorusMix > 0);
  assert.ok(c('chorus', 1).chorusMix > c('chorus', 0.25).chorusMix);
  assert.equal(c('tremolo', 0).tremDepth, 0);
  assert.ok(c('tremolo', 0.25).tremDepth > 0 && c('tremolo', 1).tremDepth > c('tremolo', 0.25).tremDepth);
});

test('padParams: zusätzliche Oszillatoren und Oktav-Anteile erst oberhalb ihres Standards', () => {
  const p = (key, v) => padParams({ ...DEFAULT_TIMBRE.pad, [key]: v });
  assert.deepEqual([0, 0.25, 0.5].map((v) => p('thickness', v).extraMix), [0, 0, 0]);
  assert.ok(p('thickness', 0.75).extraMix > 0 && p('thickness', 1).extraMix > p('thickness', 0.75).extraMix);
  assert.equal(p('shimmer', 0).shimmerMix, 0);
  assert.ok(p('shimmer', 0.25).shimmerMix > 0 && p('shimmer', 1).shimmerMix > p('shimmer', 0.25).shimmerMix);
});

test('masterParams: Summenpegel bleibt bis zur Mitte 1 und sinkt erst bei heller Einstellung', () => {
  const m = (v) => masterParams({ ...DEFAULT_TIMBRE.master, brightness: v });
  assert.deepEqual([0, 0.25, 0.5].map((v) => m(v).level), [1, 1, 1]);
  assert.ok(m(0.75).level < 1 && m(1).level < m(0.75).level);
  assert.equal(masterParams({ ...DEFAULT_TIMBRE.master, brightness: 0.5 }).shelfDb, 0);
});

test('alle Klang-Schlagworte zugleich: Klangmodell in [0,1], alle Stimmparameter endlich', () => {
  const tags = {
    drumSound: ['punchy', 'boomy', 'snappy', 'crisp', 'roomy'], bassSound: ['sub', 'fuzz', 'plucky', 'round', 'resonant'],
    chordSound: ['mellow', 'biting', 'chorused', 'tremolo', 'ringing'], padSound: ['swelling', 'airy', 'glassy', 'thick', 'moving'],
    mood: ['dark', 'bright', 'psychedelic', 'dreamy'], bass: ['gritty'], synths: ['warm'],
  };
  const timbre = resolveTimbre(tags);
  for (const [group, fields] of Object.entries(timbre)) {
    for (const [key, v] of Object.entries(fields)) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `${group}.${key}: ${v}`);
  }
  for (const params of [bassParams(timbre.bass), drumParams(timbre.drums), chordParams(timbre.chords), padParams(timbre.pad), masterParams(timbre.master)]) {
    for (const [field, v] of Object.entries(params)) assert.ok(Number.isFinite(v), `${field}: ${v}`);
  }
});

// Pad-Filter: der LFO darf die Grenzfrequenz nie unter 0 Hz drücken (Chrome klemmt dort auf 0, das Filter macht zu und pumpt)
const GRID = Array.from({ length: 21 }, (_, i) => i / 20);
const padFloor = (p) => p.cutoff - p.lfoDepth;

test('padParams: tiefste Filterfrequenz cutoff - lfoDepth >= 0.2 x cutoff für jede Kombination aus cutoff, lfoDepth und thickness', () => {
  for (const cutoff of GRID) {
    for (const lfoDepth of GRID) {
      for (const thickness of GRID) {
        const p = padParams({ ...DEFAULT_TIMBRE.pad, cutoff, lfoDepth, thickness });
        const label = JSON.stringify({ cutoff, lfoDepth, thickness, p: [p.cutoff, p.lfoDepth] });
        assert.ok(p.cutoff > 0 && padFloor(p) >= 0.2 * p.cutoff - 1e-9, label);
      }
    }
  }
});

test('padParams: moving mit warm, dark, psychedelic bleibt über 0 Hz', () => {
  for (const tags of [
    { padSound: ['moving'], synths: ['warm'] },
    { padSound: ['moving'], mood: ['dark'] },
    { padSound: ['moving'], mood: ['psychedelic'] },
    { padSound: ['moving'], synths: ['warm'], mood: ['dark'] },
    { padSound: ['moving', 'thick'], synths: ['warm'], mood: ['dark', 'psychedelic'] },
  ]) {
    const p = padParams(resolveTimbre(tags).pad);
    assert.ok(padFloor(p) >= 0.2 * p.cutoff - 1e-9 && padFloor(p) > 0, `${JSON.stringify(tags)}: ${p.cutoff} - ${p.lfoDepth}`);
  }
  // neutral unverändert: 450 Hz Tiefe liegt unter 0.8 x 1100 Hz
  assert.equal(padParams(DEFAULT_TIMBRE.pad).lfoDepth, 450);
});

// Akkord-Tiefpass: Ende nie unter 450 Hz (die Grundtöne der Akkorde liegen bei 220-330 Hz), Start mindestens 1.5 x Ende
const chordFloorOk = (p) => p.lpEnd >= 450 - 1e-9 && p.lpStart >= 1.5 * p.lpEnd - 1e-9;

test('chordParams: Tiefpass-Ende >= 450 Hz und Start >= 1.5 x Ende bei jeder Helligkeit, neutral 3600 / 900', () => {
  for (const brightness of GRID) {
    for (const length of [0, 0.5, 1]) {
      const p = chordParams({ ...DEFAULT_TIMBRE.chords, brightness, length });
      assert.ok(chordFloorOk(p), `${brightness}: ${p.lpStart} / ${p.lpEnd}`);
    }
  }
  const zero = chordParams({ ...DEFAULT_TIMBRE.chords, brightness: 0 });
  assert.ok(chordFloorOk(zero), `${zero.lpStart} / ${zero.lpEnd}`);
  const neutral = chordParams(DEFAULT_TIMBRE.chords);
  assert.deepEqual([neutral.lpStart, neutral.lpEnd], [3600, 900]);
});

test('chordParams: warm + mellow + dark (Helligkeit 0) und warm + mellow (wie im Stil Träumerisch) halten die Untergrenzen', () => {
  for (const tags of [{ synths: ['warm'], chordSound: ['mellow'], mood: ['dark'] }, { synths: ['warm'], chordSound: ['mellow'] }]) {
    const timbre = resolveTimbre(tags);
    const p = chordParams(timbre.chords);
    assert.ok(chordFloorOk(p), `${JSON.stringify(tags)} (brightness ${timbre.chords.brightness}): ${p.lpStart} / ${p.lpEnd}`);
  }
  assert.equal(resolveTimbre({ synths: ['warm'], chordSound: ['mellow'], mood: ['dark'] }).chords.brightness, 0);
});
