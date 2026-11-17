// Runs the analysis of the core on every labelled track of a folder and scores it against the labels.
//   node native/tools/analysis-score.mjs <folder> [more folders ...] [--stems <folder>] [--held-out] [--beats <folder>] [--confusions] [--timing]
//   node native/tools/analysis-score.mjs --self-test      checks the timing numbers on made-up beats and chords
// --confusions: per track, the label chords heard as something else, by seconds.
// --timing: per track, the distance between found and labelled chord changes for every 30 s of the track.
// --beats: a folder with <track name>.beats.json ({ beats, downbeats } in seconds, e.g. from the Beat This! reference);
// the analysis then takes those instead of its own beats.
// Labels with "heldOut": true are left out, so nothing is tuned on them; --held-out scores only those.
// --stems: a folder with <track name>/drums.wav, bass.wav, other.wav (as a separation model writes them);
// tracks that have stems there are scored a second time with them.
// A track is <name>.mp3|.wav|.flac with <name>.json next to it (format: LIESMICH-labels.txt in the test folder,
// written by native/tools/analysis-set.mjs for generated tracks). Scored is the part the labels cover.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const analyze = ['native/build/core/Release/btg_analyze.exe', 'native/build/core/btg_analyze'].map((p) => join(repo, p)).find(existsSync);
if (!analyze && !process.argv.includes('--self-test')) throw new Error('btg_analyze not built (native/build.ps1)');
const work = join(repo, 'native/build/analysis');
mkdirSync(work, { recursive: true });

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pitchClass = (name) => (PC[name[0]] + (name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0) + 12) % 12;
// label chord -> root and third: 'min', 'maj' or null when the chord has none (power chord, sus) or is diminished
function parseChord(name) {
  const [, root, rest] = /^([A-G][#b]?)(.*)$/.exec(name);
  const third = /^(5|sus|dim)/.test(rest) ? null : rest.startsWith('m') && !rest.startsWith('maj') ? 'min' : 'maj';
  return { root: pitchClass(root), third };
}
// A label that only knows the repeating chord cycle (the video shows a chart, but not which chord sounds now):
// the cycle is laid over the track where it fits the found chords best. Start and a tempo within 1.5 % are free,
// so this score is a little kind; it still fails when the found chords are not that cycle.
function fitCycle(label, found, seconds) {
  const names = label.cycle.chords, roots = names.map((n) => parseChord(n).root);
  const from = label.cycle.from ?? 10, to = label.cycle.to ?? seconds - 15;
  const rootAt = [];
  for (let t = from, f = 0; t < to; t += 0.1) {
    while (f + 1 < found.chords.length && found.chords[f + 1].t <= t) f++;
    rootAt.push(found.chords[f]?.root);
  }
  let best = { hits: -1 };
  for (const bars of [].concat(label.cycle.bars ?? [1, 2])) {
    for (let scale = 0.985; scale <= 1.0151; scale += 0.001) {
      const each = bars * (label.meter[1] === 8 ? label.meter[0] / 3 : label.meter[0]) * 60 / label.bpm * scale; // seconds a chord lasts
      for (let start = 0; start < each * names.length; start += 0.05) {
        let hits = 0;
        for (let i = 0; i < rootAt.length; i++) {
          const at = Math.floor((from + i * 0.1 - start + each * names.length * 1000) / each) % names.length;
          if (roots[at] === rootAt[i]) hits++;
        }
        if (hits > best.hits) best = { hits, each, start, bars };
      }
    }
  }
  const chords = [];
  for (let k = Math.ceil((from - best.start) / best.each); best.start + k * best.each < to; k++) {
    chords.push({ t: +(best.start + k * best.each).toFixed(2), chord: names[((k % names.length) + names.length) % names.length] });
  }
  return { chords, until: to, bars: best.bars };
}
// label chord -> the app's chord quality, as far as the name tells (what the app cannot show is simplified:
// 11 and 13 count as sevenths, alterations are dropped)
function kindOf(name) {
  const rest = /^[A-G][#b]?(.*)$/.exec(name)[1];
  if (rest === '5') return 'power';
  if (/^sus2/.test(rest)) return 'sus2';
  if (/^sus/.test(rest)) return 'sus4';
  if (/^dim7/.test(rest)) return 'dim7';
  if (/^dim/.test(rest)) return 'dim';
  if (/^m7b5/.test(rest)) return 'm7b5';
  if (/^aug/.test(rest)) return 'aug';
  const minor = /^(m|-)(?!aj)/.test(rest), body = rest.replace(/^(m|-)(?!aj)/, '');
  if (/^maj/.test(body)) return 'maj7';
  if (/^9/.test(body)) return minor ? 'min9' : 'dom9';
  if (/^(7|11|13)/.test(body)) return /sus/.test(body) ? 'sus4' : minor ? 'min7' : 'dom7';
  if (/^6/.test(body)) return minor ? 'min6' : 'maj6';
  if (/^add9/.test(body)) return minor ? 'min' : 'add9';
  return minor ? 'min' : 'maj';
}
const SCALE = { dorian: 'dorian', minor: 'minorPentatonic', major: 'majorPentatonic' };
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)} %` : '–');
const ms = (x, sign = true) => (Number.isFinite(x) ? `${sign && x >= 0 ? '+' : ''}${(1000 * x).toFixed(0)} ms` : '–');
const median = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : NaN);

// timing: where the found chord changes lie against the labelled ones. For every labelled change of root, the
// nearest found change to that root within 2 s; delta = found minus label in seconds (positive: found late). Nothing
// is taken off for the lead of a video's display. Changes that keep the root (Bbsus2 to Bb) are left out: whether
// the kind is found is not a question of timing.
function timing(labelChords, foundChords, tolerance) {
  const deltas = [];
  let changes = 0;
  for (let i = 1; i < labelChords.length; i++) {
    const now = labelChords[i], before = labelChords[i - 1];
    if (!now.chord || !before.chord || parseChord(now.chord).root === parseChord(before.chord).root) continue;
    changes++;
    let best = null;
    for (let k = 1; k < foundChords.length; k++) {
      const d = foundChords[k].t - now.t;
      if (foundChords[k].root === parseChord(now.chord).root && foundChords[k - 1].root !== foundChords[k].root && Math.abs(d) <= 2 && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
    if (best !== null) deltas.push({ t: now.t, d: best });
  }
  if (!changes) return { changes };
  const d = deltas.map((x) => x.d), abs = d.map(Math.abs).sort((a, b) => a - b);
  const meanT = deltas.reduce((sum, x) => sum + x.t, 0) / deltas.length, meanD = d.reduce((sum, x) => sum + x, 0) / d.length;
  const spread = deltas.reduce((sum, x) => sum + (x.t - meanT) ** 2, 0);
  return {
    changes, deltas, median: median(d), medianAbs: median(abs), within: abs.filter((x) => x <= tolerance).length / changes, p90: abs.length ? abs[Math.min(abs.length - 1, Math.floor(0.9 * abs.length))] : NaN,
    drift: deltas.length > 2 && spread > 0 ? 60 * deltas.reduce((sum, x) => sum + (x.t - meanT) * (x.d - meanD), 0) / spread : NaN, // seconds per minute
    missed: 1 - deltas.length / changes,
  };
}
// tempo steady: the tempo over 8 beats around every found beat against the tempo the label has there (want: seconds
// -> bpm). per: 3 when the found beats are the eighths of a compound meter. A track counted at half or double the
// label's tempo is brought to the label's count first. max: the largest deviation, off: the share of beats where the
// local tempo is more than 3 % away. A stretch without beats (a break: more than four beats long) is no tempo; the
// beats whose 8 neighbours reach across one are left out.
function tempoSteady(beats, per, want) {
  const ratios = [], gaps = beats.slice(1).map((t, i) => t - beats[i]), hole = 4.5 * median(gaps);
  for (let i = 4; i + 4 < beats.length; i++) {
    if (gaps.slice(i - 4, i + 4).some((gap) => gap > hole)) continue;
    ratios.push(60 * 8 / (beats[i + 4] - beats[i - 4]) / per / want(beats[i]));
  }
  if (!ratios.length) return { max: NaN, off: NaN };
  const usual = median(ratios), count = Math.abs(usual - 2) < 0.2 ? 2 : Math.abs(usual - 0.5) < 0.05 ? 0.5 : 1;
  const off = ratios.map((r) => r / count - 1);
  return { max: off.reduce((top, x) => (Math.abs(x) > Math.abs(top) ? x : top), 0), off: off.filter((x) => Math.abs(x) > 0.03).length / off.length };
}
function nearest(times, t) { // index of the time nearest to t (times ascending)
  let lo = 0, hi = times.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid + 1; else hi = mid; }
  return lo > 0 && t - times[lo - 1] <= times[lo] - t ? lo - 1 : lo;
}
// The tempo of a list of beats at a time: over 8 beats around the beat nearest to it.
function tempoAt(beats) {
  const at = beats.map((_, i) => { const a = Math.max(0, i - 4), b = Math.min(beats.length - 1, i + 4); return 60 * (b - a) / (beats[b] - beats[a]); });
  return (t) => at[nearest(beats, t)];
}
// beats: every labelled time against the nearest found one. median: found minus label; within: share inside 50 ms.
function hits(want, got) {
  if (!want?.length || !got.length) return { median: NaN, within: NaN };
  const d = want.map((t) => got[nearest(got, t)] - t);
  return { median: median(d), within: d.filter((x) => Math.abs(x) <= 0.05).length / d.length };
}

if (process.argv.includes('--self-test')) {
  const { strict: assert } = await import('node:assert');
  const every = (step, n, from = 0) => Array.from({ length: n }, (_, i) => from + i * step);
  const late = timing([{ t: 0, chord: 'C' }, { t: 10, chord: 'F' }, { t: 20, chord: 'Fsus4' }, { t: 30, chord: 'G' }, { t: 40, chord: 'Am' }, { t: 50, chord: 'D' }],
    [{ t: 0, root: 0 }, { t: 10.2, root: 5 }, { t: 30.4, root: 7 }, { t: 40.5, root: 9 }, { t: 55, root: 2 }], 0.3);
  assert.equal(late.changes, 4); // F to Fsus4 keeps the root
  assert.ok(Math.abs(late.median - 0.4) < 1e-9 && Math.abs(late.within - 0.25) < 1e-9 && Math.abs(late.missed - 0.25) < 1e-9);
  assert.ok(Math.abs(late.drift - 0.6) < 1e-6); // 0.1 s later every 10 s
  assert.equal(tempoSteady([...every(0.5, 50), ...every(0.5, 50, 40)], 1, () => 120).off, 0); // a break is no tempo
  const steady = tempoSteady(every(0.5, 100), 1, () => 120);
  assert.ok(Math.abs(steady.max) < 1e-9 && steady.off === 0);
  assert.equal(tempoSteady(every(0.25, 100), 1, () => 120).off, 0);    // counted twice as fast: still steady
  assert.equal(tempoSteady(every(1, 100), 1, () => 120).off, 0);       // counted half as fast
  assert.equal(tempoSteady(every(0.5 / 3, 100), 3, () => 120).off, 0); // the eighths of a 12/8
  const extra = every(0.5, 100);
  extra.splice(50, 0, 24.75);                                          // one beat too many, half way between two
  const jump = tempoSteady(extra, 1, () => 120);
  assert.ok(jump.off > 0.05 && jump.off < 0.12 && jump.max > 0.05);
  const slowing = Array.from({ length: 100 }, (_, i) => 0.5 * i + 0.001 * i * i); // from 120 down to 86
  assert.ok(tempoSteady(slowing, 1, () => 120).off > 0.8 && tempoSteady(slowing, 1, () => 120).max < -0.2);
  assert.equal(tempoSteady(slowing, 1, tempoAt(slowing)).off, 0);      // against its own tempo curve it is right
  const beat = hits([0, 1, 2, 3], [0.01, 1.01, 2.2, 3.01]);
  assert.ok(Math.abs(beat.median - 0.01) < 1e-9 && beat.within === 0.75);
  console.log('self-test ok');
  process.exit(0);
}

const args = process.argv.slice(2);
const stemsRoot = args.includes('--stems') ? args.splice(args.indexOf('--stems'), 2)[1] : null;
const heldOut = args.includes('--held-out') ? args.splice(args.indexOf('--held-out'), 1).length > 0 : false;
const beatsRoot = args.includes('--beats') ? args.splice(args.indexOf('--beats'), 2)[1] : null;
const confusions = args.includes('--confusions') ? args.splice(args.indexOf('--confusions'), 1).length > 0 : false;
const byTime = args.includes('--timing') ? args.splice(args.indexOf('--timing'), 1).length > 0 : false;
const rows = [];
for (const folder of args) {
  for (const file of readdirSync(folder).filter((f) => /\.(mp3|wav|flac)$/i.test(f))) {
    const labelFile = join(folder, file.replace(/\.[^.]+$/, '.json'));
    if (!existsSync(labelFile)) continue;
    const label = JSON.parse(readFileSync(labelFile, 'utf8'));
    if (!!label.heldOut !== heldOut) continue;
    const stemDir = stemsRoot ? join(stemsRoot, file.replace(/\.[^.]+$/, '')) : null;
    const variants = stemDir && existsSync(join(stemDir, 'drums.wav')) ? [[], ['drums.wav', 'bass.wav', 'other.wav'].map((f) => join(stemDir, f))] : [[]];
    for (const stems of variants) {
    const out = join(work, file.replace(/\.[^.]+$/, stems.length ? '.stems.json' : '.json'));
    const beats = beatsRoot ? join(beatsRoot, file.replace(/\.[^.]+$/, '.beats.json')) : null;
    execFileSync(analyze, [join(folder, file), out, ...stems, ...(beats && existsSync(beats) ? ['--beats', beats] : [])], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    const found = JSON.parse(readFileSync(out, 'utf8'));

    const seconds = found.chords.at(-1)?.end ?? 0;
    if (label.cycle) {
      const fit = fitCycle(label, found, seconds);
      label.chords = fit.chords;
      label.chordsUntil = fit.until;
    }
    const ratio = found.bpm / label.bpm;
    const tempo = Math.abs(ratio - 1) < 0.04 ? 'ok' : Math.abs(ratio - 2) < 0.08 ? 'double' : Math.abs(ratio - 0.5) < 0.02 ? 'half' : 'wrong';
    const keyRoot = pitchClass(found.key.root) === pitchClass(label.key.root);
    const modes = [].concat(label.key.mode); // a label may accept several modes (a blues)
    // chords: every tenth of a second inside the labelled stretch; { chord: null } is a stretch without a label
    label.chords ??= [];
    const from = label.chords[0]?.t ?? 0, to = label.chords.length ? label.chordsUntil : 0;
    let samples = 0, rootHits = 0, thirds = 0, thirdHits = 0, kindHits = 0, plain = 0, plainKept = 0, l = 0, f = 0;
    const wrong = new Map(), kinds = new Map();
    for (let t = from; t < to; t += 0.1) {
      while (l + 1 < label.chords.length && label.chords[l + 1].t <= t) l++;
      while (f + 1 < found.chords.length && found.chords[f + 1].t <= t) f++;
      if (!label.chords[l].chord) continue;
      const want = parseChord(label.chords[l].chord), got = found.chords[f];
      samples++;
      if (want.root === got.root) rootHits++;
      const kind = kindOf(label.chords[l].chord);
      if (want.root === got.root && kind === got.kind) kindHits++;
      if (want.root === got.root) kinds.set(`${kind} -> ${got.kind}`, (kinds.get(`${kind} -> ${got.kind}`) ?? 0) + 0.1);
      if (kind === 'maj' || kind === 'min') { plain++; if (want.root === got.root && kind === got.kind) plainKept++; }
      if (want.root !== got.root || (want.third && (want.third === 'min') !== got.minor)) {
        const key = `${label.chords[l].chord} -> ${got.chord}`;
        wrong.set(key, (wrong.get(key) ?? 0) + 0.1);
      }
      if (want.third) { thirds++; if (want.root === got.root && (want.third === 'min') === got.minor) thirdHits++; }
    }
    // bar phase: where in the found bars do the labelled chord changes fall (0 = on the one)
    const perBar = found.beatsPerBar ?? 4;
    const phase = new Array(perBar).fill(0);
    let offsets = [];
    const changes = label.cycle ? [] : label.chords.slice(1).filter((c) => c.chord); // a fitted cycle has no times of its own
    const nearestBeat = (t) => {
      let nearest = 0;
      for (let b = 1; b < found.beats.length; b++) if (Math.abs(found.beats[b] - t) < Math.abs(found.beats[nearest] - t)) nearest = b;
      return nearest;
    };
    // A video shows a chord a little before it sounds, each video by its own amount. First pass: that lead (median);
    // second pass: the bar position of every labelled change, with the lead taken out.
    let lead = 0;
    for (const pass of [0, 1]) {
      offsets = [];
      phase.fill(0);
      for (const c of changes) {
        const nearest = nearestBeat(c.t + lead);
        const bar = found.bars.findLast((b) => b <= nearest); // counted from the bar start before it
        phase[(((nearest - (bar ?? found.bars[0])) % perBar) + perBar) % perBar]++;
        offsets.push(found.beats[nearest] - c.t); // signed: negative = the found beat is early
      }
      if (pass === 0 && offsets.length) lead = [...offsets].sort((a, b) => a - b)[Math.floor(offsets.length / 2)];
    }
    offsets.sort((a, b) => a - b);
    // timing against the labels as they are (no lead taken off): real tracks within 0.3 s, generated ones within 0.1 s
    const time = label.cycle ? { changes: 0 } : timing(label.chords, found.chords, label.source ? 0.3 : 0.1);
    const per = found.meter.endsWith('/8') ? 3 : 1;
    const own = median(found.beats.slice(1).map((t, i) => 60 / (t - found.beats[i]) / per)); // a label without a tempo: against the track's own usual tempo
    const steady = tempoSteady(found.beats, per, label.tempo ? tempoAt(label.beats) : () => label.bpm ?? own);
    const onBeat = hits(label.beats, found.beats), onBar = hits(label.downbeats, found.bars.map((b) => found.beats[b]));
    rows.push({
      time, timeMedian: time.median, timeAbs: time.medianAbs, timeWithin: time.within, timeP90: time.p90, timeDrift: Math.abs(time.drift), timeMissed: time.missed,
      steadyMax: steady.max, steadyOff: steady.off, beatMedian: onBeat.median, beatWithin: onBeat.within, barWithin: onBar.within,
      track: (label.title ?? file).slice(0, 34), group: (label.group ?? (label.source ? 'echt' : 'generiert')) + (stems.length ? '+stems' : ''),
      tempo: label.bpm ? `${found.bpm} / ${label.bpm} ${tempo}` : `${found.bpm} / –`, tempoOk: label.bpm ? tempo === 'ok' : null, // null: the label has no tempo
      meter: `${found.meter} / ${(label.meter ?? [4, 4]).join('/')}`,
      meterOk: found.meter === (label.meter ?? [4, 4]).join('/'),
      key: `${found.key.root} ${found.key.mode} / ${label.key.root} ${modes[0]}`, keyRootOk: keyRoot, keyOk: keyRoot && modes.includes(found.key.mode),
      scaleOk: keyRoot && modes.some((m) => found.scale === SCALE[m]),
      kind: samples ? kindHits / samples : NaN, plainKept: plain ? plainKept / plain : NaN, rich: samples > plain ? (kindHits - plainKept) / (samples - plain) : NaN,
      root: samples ? rootHits / samples : NaN, third: thirds ? thirdHits / thirds : NaN,
      onOne: changes.length ? phase[0] / changes.length : NaN, phase: phase.join('/'), fitted: !!label.cycle,
      changeOffsetMs: Math.round(1000 * offsets[Math.floor(offsets.length / 2)]),
      seconds, ms: 0, kinds, wrong: [...wrong].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(0)} s`).join(', '),
    });
    }
  }
}
for (const r of rows) {
  console.log(`${r.group.padEnd(15)} ${r.track.padEnd(34)} tempo ${r.tempo.padEnd(18)} meter ${r.meter.padEnd(11)} key ${r.key.padEnd(24)} ${r.keyOk ? 'ok ' : r.keyRootOk ? 'root' : 'no '}  chords root ${pct(r.root).padStart(7)} maj/min ${pct(r.third).padStart(7)} kind ${pct(r.kind).padStart(7)} (triads ${pct(r.plainKept)}, others ${pct(r.rich)})  changes on the one ${pct(r.onOne).padStart(7)} (${r.phase})  offset ${r.changeOffsetMs} ms${r.fitted ? '  [cycle fitted]' : ''}`
    + `  timing ${r.time.changes ? `${ms(r.timeMedian)}, within ${pct(r.timeWithin)}, 90 % under ${ms(r.timeP90, false)}, drift ${Number.isFinite(r.time.drift) ? `${ms(r.time.drift)}/min` : '–'}, missed ${pct(r.timeMissed)}` : '–'}`
    + `  tempo steady ${Number.isFinite(r.steadyMax) ? `${r.steadyMax >= 0 ? '+' : ''}${(100 * r.steadyMax).toFixed(1)} % at most, ${pct(r.steadyOff)} off` : '–'}`
    + (Number.isFinite(r.beatWithin) ? `  beats ${ms(r.beatMedian)}, within 50 ms ${pct(r.beatWithin)}, bars ${pct(r.barWithin)}` : ''));
  if (byTime && r.time.changes) {
    const cells = [];
    for (let from = 0; from <= (r.time.deltas.at(-1)?.t ?? -1); from += 30) {
      const d = r.time.deltas.filter((x) => x.t >= from && x.t < from + 30).map((x) => x.d);
      if (d.length) cells.push(`${from} s ${ms(median(d))} (${d.length}, ${ms(Math.min(...d))} to ${ms(Math.max(...d))})`);
    }
    console.log(`                    found minus label by 30 s: ${cells.join(' | ')}`);
  }
  if (confusions && r.wrong) console.log(`                    wrong: ${r.wrong}`);
}
for (const group of new Set(rows.map((r) => r.group))) {
  const g = rows.filter((r) => r.group === group);
  if (!g.length) continue;
  const mean = (key) => g.reduce((s, r) => s + (Number.isFinite(r[key]) ? r[key] : 0), 0) / g.filter((r) => Number.isFinite(r[key])).length;
  if (confusions) { // with the right root: which kind the label has and which was found, in seconds
    const all = new Map();
    for (const r of g) for (const [k, v] of r.kinds) all.set(k, (all.get(k) ?? 0) + v);
    console.log(`   kinds of ${group}: ${[...all].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}`);
  }
  const share = (key) => `${g.filter((r) => r[key]).length}/${g.filter((r) => r[key] !== null).length}`;
  console.log(`== ${group}: ${g.length} tracks | tempo ${share('tempoOk')} | meter ${share('meterOk')} | key root ${share('keyRootOk')}, with mode ${share('keyOk')} | scale ${share('scaleOk')} | chords root ${pct(mean('root'))}, maj/min ${pct(mean('third'))}, kind ${pct(mean('kind'))} (triads ${pct(mean('plainKept'))}, others ${pct(mean('rich'))}) | changes on the one ${pct(mean('onOne'))}`
    + ` | timing ${ms(mean('timeMedian'))}, apart ${ms(mean('timeAbs'), false)}, within ${pct(mean('timeWithin'))}, 90 % under ${ms(mean('timeP90'), false)}, drift ${ms(mean('timeDrift'), false)}/min, missed ${pct(mean('timeMissed'))}`
    + ` | tempo steady ${(100 * Math.max(...g.map((r) => Math.abs(r.steadyMax)).filter(Number.isFinite))).toFixed(1)} % at most, ${pct(mean('steadyOff'))} off`
    + (g.some((r) => Number.isFinite(r.beatWithin)) ? ` | beats ${ms(mean('beatMedian'))}, within 50 ms ${pct(mean('beatWithin'))}, bars ${pct(mean('barWithin'))}` : ''));
}
