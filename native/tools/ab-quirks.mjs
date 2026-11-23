// The listening set for one decision (native/core/src/patch.h, the test hooks exactOscillators and wholeFrameBuffers): the core as it starts
// a source inside Chromium's render quanta ("mit", as today: the web app's sound) and without that ("ohne": --without of btg_render and
// btg_fx voice). Per pair <name>-mit.wav and <name>-ohne.wav; every figure of LIESMICH.txt is measured in this run, from the pairs or from
// renders made for a figure only. The A/B page (ab-page.mjs, written at the end) shows the text.
//   node native/tools/ab-quirks.mjs [folder]     default .superpowers/audio-ab/quirks (native\tools\ab-quirks.cmd renders and serves it)
// Single notes and hits: btg_fx voice, the voice alone and dry (a track cannot place a note at a chosen frame). Tracks: btg_render, dry as
// the sound cases of native/tools/sound-cases/ render them, or as the app plays them (the style's own sound with its reverb, echo and room,
// and the limiter). Stops with a message when btg_fx or btg_render is older than the sources it is built from, when a pair's "mit" is not
// the same file when rendered again without any switch, or when a pair's two files are the same (a switch that did nothing).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeAbPage } from './ab-page.mjs';
import { fft, wavBytes } from './web-render.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = (file) => import(pathToFileURL(join(repo, 'src', file)).href);
const [{ resolveTrackTimbre }, { buildEvents }, { DRUM_FALLBACK }] = await Promise.all([load('core/timbre.js'), load('index.js'), load('core/event-helpers.js')]);
const R = 48000, WIN = Math.round(0.05 * R), BLOCK = 128, APP_LEAD = 0.15; // APP_LEAD: native/app/PluginEditor.cpp, every play of the generator
const stop = (message) => { console.error(`ab-quirks: ${message}`); process.exit(1); };

const exe = (name) => [`native/build/core/Release/${name}.exe`, `native/build/core/${name}`].map((p) => join(repo, p)).find(existsSync);
const [FX, RENDER] = [exe('btg_fx'), exe('btg_render')];
if (!FX || !RENDER) stop('btg_fx oder btg_render fehlt: zuerst native\\build.ps1 -NoApp ausführen.');
// a binary older than a source it is built from renders an old core, or does not know --without
const newest = (path) => {
  const s = statSync(path);
  if (!s.isDirectory()) return { time: s.mtimeMs, path };
  return readdirSync(path).map((f) => newest(join(path, f))).reduce((m, n) => (n.time > m.time ? n : m), { time: 0, path });
};
for (const [e, tool] of [[FX, 'fx.cpp'], [RENDER, 'render.cpp']]) {
  const source = ['native/core/src', 'native/core/include', `native/core/tools/${tool}`].map((p) => newest(join(repo, p))).reduce((m, n) => (n.time > m.time ? n : m));
  if (statSync(e).mtimeMs < source.time) stop(`${basename(e)} ist älter als ${source.path.slice(repo.length + 1)}: zuerst native\\build.ps1 -NoApp ausführen.`);
}

// German numbers, signed by the rounded value (a figure that rounds to 0 is ±0)
const de = (x, digits = 2) => { const v = Number(x.toFixed(digits)); return (v < 0 ? '−' : v > 0 ? '+' : '±') + Math.abs(v).toFixed(digits).replace('.', ','); };
const abs = (x, digits = 1) => { const v = Number(x.toFixed(digits)); return (v < 0 ? '−' : '') + Math.abs(v).toFixed(digits).replace('.', ','); };
const list = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} und ${items.at(-1)}`);
const names = (counted) => counted.map((s) => s.replace(/ \d+$/, '')); // "Congas 85" -> "Congas"
const db = (p) => 10 * Math.log10(Math.max(p, 1e-30));
const power = (x, from, n) => { let s = 0; const to = Math.min(x.length / 2, from + n); for (let i = from; i < to; ++i) s += x[2 * i] ** 2 + x[2 * i + 1] ** 2; return s / (2 * Math.max(1, to - from)); };

// --- what is rendered ---
const RHODES = 'chords/epiano/rhodes', KIT = 'drums/synth/classic', PERC = 'percussion/synth/classic', STRINGS = 'chords/string/electric';
const between = [0, 0.5, 0, 0.5, 0, 0.5, 0.125, 0.25, 0.375, 0.625, 0.75, 0.875]; // the part of a frame each hit of a figure lies after its frame
const figure = (key, what, spacing, seconds = 0.1, timbre = {}) => ({ voice: key, timbre, strikes: between.map((q, n) => [4800 + n * Math.round(spacing * R) + q, what, 0.8, seconds]) });
const placed = (places) => ({ voice: RHODES, strikes: places.map((k, n) => [40 * BLOCK + n * R + k, 57, 0.6, 0.5]) }); // R = 375 blocks: strike n at place k
// each hit's first frame a block's first (the first-block rule then has nothing to delay), `q` of a frame after its time: the phase advance alone
const aligned = (key, hit, qs) => ({ voice: key, strikes: qs.map((q, n) => [(40 + n * 125) * BLOCK - (q > 0 ? 1 - q : 0), hit, 0.8, 0.1]) });
const onEpiano = (t) => { t.voices.chords = { id: 'epiano', variant: 'rhodes' }; };
const solo = (layer) => (t) => { for (const l of Object.keys(t.layers)) t.layers[l] = l === layer; };
const allOn = (t) => { for (const l of Object.keys(t.layers)) t.layers[l] = true; };
const track = (file, name, app, ...edits) => ({ track: [file, name], app, edits });

const lay = (base, over) => ({ ...base, ...Object.fromEntries(Object.entries(over ?? {}).map(([group, fields]) => [group, { ...base?.[group], ...fields }])) });
const caseOf = (file, name) => JSON.parse(readFileSync(join(repo, 'native/tools/sound-cases', file), 'utf8')).find((c) => c.name === name) ?? stop(`kein Fall ${name} in ${file}`);
function trackOf(spec) {
  const c = caseOf(...spec.track);
  const t = typeof c.track === 'string' ? JSON.parse(readFileSync(join(repo, 'native/tools/sound-cases', c.track), 'utf8')) : structuredClone(c.track);
  for (const edit of spec.edits) edit(t);
  return { c, t };
}
function readWav(bytes) { // btg_render's 32-bit float stereo
  for (let at = 12; at + 8 <= bytes.length; at += 8 + bytes.readUInt32LE(at + 4)) {
    if (bytes.toString('latin1', at, at + 4) === 'data') return new Float32Array(bytes.buffer.slice(bytes.byteOffset + at + 8, bytes.byteOffset + at + 8 + bytes.readUInt32LE(at + 4)));
  }
  stop('btg_render schrieb eine Datei ohne Daten');
}
let temp;
function render(spec, without) {
  const out = join(temp, 'out'), flag = without ? ['--without', without] : [];
  if (spec.voice) {
    const frames = Math.ceil(Math.max(...spec.strikes.map(([t, , , s]) => t + (s + 1.8) * R)));
    execFileSync(FX, [join(temp, 'in.f32'), out, String(R), 'voice', String(frames), spec.voice, JSON.stringify(spec.timbre ?? {}), ...flag, ...spec.strikes.flat().map(String)], { stdio: 'pipe' });
    const bytes = readFileSync(out);
    return { bytes, x: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)) };
  }
  const { c, t } = trackOf(spec);
  let tuning = null, dry = false, tail = c.tail ?? 0.2;
  if (spec.app) tail = 2; // as the app plays it: the track's own sound (reverb, echo, room), the limiter, no fine values; a tail for the reverb
  else { // dry, as sound-compare.mjs renders the case
    let timbre = lay(t.timbre, c.sound);
    if (c.dry) timbre = lay(timbre, { master: { reverb: 0, echo: 0 } });
    if (c.sound || c.dry) t.timbre = timbre;
    tuning = c.dry ? lay(c.tuning, { 'mix/room': { wet: 0 } }) : c.tuning ?? null;
    dry = c.dry || c.limiter === false;
  }
  writeFileSync(`${out}.json`, JSON.stringify(t));
  writeFileSync(`${out}-sound.json`, JSON.stringify(resolveTrackTimbre(t)));
  if (tuning) writeFileSync(`${out}-tuning.json`, JSON.stringify(tuning));
  execFileSync(RENDER, [`${out}.json`, join(repo, 'src/assets/samples'), `${out}.wav`, String(R), '--tail', String(tail), ...(dry ? ['--dry'] : []),
    '--sound', `${out}-sound.json`, ...(tuning ? ['--tuning', `${out}-tuning.json`] : []), ...flag], { stdio: 'pipe' });
  const bytes = readFileSync(`${out}.wav`);
  return { bytes, x: readWav(bytes) };
}
const both = (spec, without) => ({ mit: render(spec, null).x, ohne: render(spec, without).x });

// --- measuring ---
// per strike: its level from its onset over `window` frames (or to the next strike), mit and ohne, and the difference of the two
function strikes(spec, { mit, ohne }, window) {
  const onsets = spec.strikes.map(([t]) => Math.ceil(t));
  const rows = onsets.map((f, i) => {
    const n = Math.min(window, (onsets[i + 1] ?? Infinity) - f);
    let dd = 0, ss = 0;
    for (let j = 2 * f; j < 2 * (f + n); ++j) { dd += (mit[j] - ohne[j]) ** 2; ss += ohne[j] ** 2; }
    return { mit: db(power(mit, f, n)), ohne: db(power(ohne, f, n)), diff: db(dd / ss), part: spec.strikes[i][0] % 1, place: Math.ceil(spec.strikes[i][0]) % BLOCK };
  });
  const spread = (k) => Math.max(...rows.map((r) => r[k])) - Math.min(...rows.map((r) => r[k]));
  // the e-piano: per 50 ms window after the onsets, the largest level difference between two strikes, while each is within 40 dB of its first
  let windows = 0;
  for (let w = 1; spec.voice === RHODES && w * WIN < (spec.strikes[0][3] + 0.18) * R; ++w) {
    const levels = onsets.map((f) => db(power(mit, f + w * WIN, WIN)));
    if (levels.some((l, i) => l < rows[i].mit - 40)) break;
    windows = Math.max(windows, Math.max(...levels) - Math.min(...levels));
  }
  return { rows, spreadMit: spread('mit'), spreadOhne: spread('ohne'), windows: Math.max(windows, spread('mit')) };
}
// the share of the power in the octave around 8 kHz and above 11.3 kHz, dB of the whole
function highs(x) {
  const frames = x.length / 2;
  let n = 1;
  while (n < frames) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < frames; i++) { re[i] = x[2 * i]; im[i] = x[2 * i + 1]; }
  fft(re, im);
  const sums = [0, 0];
  let total = 0;
  for (let k = 0; k <= n / 2; k++) {
    const m = (n - k) % n, p = (re[k] ** 2 + im[k] ** 2 + re[m] ** 2 + im[m] ** 2) / 2, hz = k * R / n;
    total += p;
    if (hz >= 8000 / Math.SQRT2 && hz < 8000 * Math.SQRT2) sums[0] += p;
    if (hz >= 16000 / Math.SQRT2) sums[1] += p;
  }
  return sums.map((s) => db(s / total));
}
// a track or restrikes: the whole, the highs, and the 50 ms windows of "ohne" within 20 dB of its loudest (what can be heard over the rest)
function whole({ mit, ohne }) {
  const n = Math.min(mit.length, ohne.length) / 2, wins = Math.floor(n / WIN);
  const step = [];
  for (let w = 0; w < wins; ++w) step.push({ m: db(power(mit, w * WIN, WIN)), o: db(power(ohne, w * WIN, WIN)) });
  const loud = Math.max(...step.map((s) => s.o)), heard = (w) => step[w].o > loud - 20;
  let worst = 0, at = 0, up = 0, upAt = -1;
  step.forEach((s, w) => {
    if (!heard(w)) return;
    if (Math.abs(s.m - s.o) > Math.abs(worst)) { worst = s.m - s.o; at = w; }
    if (s.m - s.o > up) { up = s.m - s.o; upAt = w; }
  });
  let dd = 0, ss = 0;
  for (let j = 0; j < 2 * n; ++j) { dd += (mit[j] - ohne[j]) ** 2; ss += ohne[j] ** 2; }
  return { level: db(power(mit, 0, n)) - db(power(ohne, 0, n)), worst, worstAt: at * 0.05, up, upAt, diff: dd === 0 ? -Infinity : db(dd / ss), highs: { mit: highs(mit), ohne: highs(ohne) }, step, heard };
}

// --- what is in a track (the web app's events, as the engine gets them) ---
const KIT_SOUND = (name) => (['kick', 'snare', 'hat', 'openHat', 'crash', 'tomHigh', 'tomMid', 'tomLow'].includes(name) ? name : name === 'hatHalf' ? 'hat' : name === 'hatPedal' ? null : DRUM_FALLBACK[name]); // drums.js 60 to 62 (the pedalled hat silent by its fine value 0)
const GROUP = { kick: 'Bassdrum', snare: 'Snare', hat: 'Hi-Hat', openHat: 'offene Hi-Hat', crash: 'Crash', tomHigh: 'Toms', tomMid: 'Toms', tomLow: 'Toms', shaker: 'Shaker', tambourine: 'Tamburin',
  congaHigh: 'Congas', congaLow: 'Congas', bongoHigh: 'Bongos', bongoLow: 'Bongos', claves: 'Claves', cowbell: 'Kuhglocke' };
const SOUNDS = [...new Set(Object.values(GROUP))];
const HIT = { kick: ['Bassdrum', 'bassdrum'], tomHigh: ['hohe Tom', 'tom-hoch'], tomMid: ['mittlere Tom', 'tom-mittel'], tomLow: ['tiefe Tom', 'tom-tief'],
  congaHigh: ['hohe Conga', 'conga-hoch'], congaLow: ['tiefe Conga', 'conga-tief'], bongoHigh: ['hohe Bongo', 'bongo-hoch'], bongoLow: ['tiefe Bongo', 'bongo-tief'] }; // name, file name
const MOVING = ['Bassdrum', 'Toms', 'Congas', 'Bongos']; // a sine whose frequency falls (drums.cpp kick and tom, percussion.cpp tone)
const NOISE = ['Hi-Hat', 'offene Hi-Hat', 'Snare', 'Crash', 'Shaker', 'Tamburin']; // noise read from a buffer
const LAYER = { bass: 'Bass', chords: 'Akkorde', pad: 'Pad', lead: 'Lead' };
const synthOn = (t, layer) => t.layers[layer] && t.voices[layer]?.id === 'synth';
function soundOf(t, e) { // the German name of what an event plays on a synth voice, or null
  if (e.type === 'hit' && e.layer === 'drums' && synthOn(t, 'drums')) return GROUP[KIT_SOUND(e.name)] ?? null;
  if (e.type === 'hit' && e.layer === 'percussion' && synthOn(t, 'percussion')) return GROUP[e.name] ?? null;
  if (e.type === 'note' && e.layer === 'chords' && t.layers.chords && t.voices.chords?.id === 'epiano') return 'E-Piano';
  if (e.type === 'note' && LAYER[e.layer] && synthOn(t, e.layer)) return `${LAYER[e.layer]} (klassischer Synth)`;
  return null;
}
function contents(spec) {
  const { t } = trackOf(spec), events = buildEvents(t), count = new Map();
  for (const e of events) { const s = soundOf(t, e); if (s) count.set(s, (count.get(s) ?? 0) + 1); }
  const of = (names) => names.filter((n) => count.has(n)).map((n) => `${n} ${count.get(n)}`);
  const near = (at) => [...new Set(events.filter((e) => e.t >= at - 0.1 && e.t < at + 0.05).map((e) => soundOf(t, e)).filter(Boolean))];
  return { t, count, of, near, kickPunch: resolveTrackTimbre(t).drums?.kickPunch ?? 0.5 };
}

// --- the set ---
const folder = resolve(process.argv[2] ?? join(repo, '.superpowers/audio-ab/quirks'));
mkdirSync(folder, { recursive: true });
for (const f of readdirSync(folder)) if (/-(mit|ohne)\.wav$/.test(f)) rmSync(join(folder, f));
temp = mkdtempSync(join(tmpdir(), 'btg-quirks-'));
writeFileSync(join(temp, 'in.f32'), Buffer.alloc(4));
const P = {}, F = {}; // the pairs' measures by name; the figures made for the text only
function pair(name, spec, without, measure) {
  const mit = render(spec, null), ohne = render(spec, without), again = render(spec, null);
  if (Buffer.compare(mit.bytes, again.bytes) !== 0) stop(`${name}: „mit“ ist beim zweiten Rendern ohne Schalter nicht dieselbe Datei.`);
  if (Buffer.compare(mit.bytes, ohne.bytes) === 0) stop(`${name}: „mit“ und „ohne“ sind gleich: --without ${without} hat nichts bewirkt.`);
  let peak = 0;
  for (const x of [mit.x, ohne.x]) for (const v of x) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 1 ? 0.98 / peak : 1; // one gain for both files of a pair, as sound-compare.mjs does
  writeFileSync(join(folder, `${name}-mit.wav`), wavBytes(mit.x, R, gain));
  writeFileSync(join(folder, `${name}-ohne.wav`), wavBytes(ohne.x, R, gain));
  P[name] = { ...measure({ mit: mit.x, ohne: ohne.x }), spec, without };
  console.log(name, JSON.stringify(P[name], (k, v) => (['spec', 'step', 'heard', 'rows'].includes(k) ? undefined : typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));
}
try {
  // the e-piano at sixteen places spread evenly over a block, and the ten picked from all 128 as the loudest and the quietest
  const even = Array.from({ length: 16 }, (_, k) => 8 * k), picked = [40, 102, 72, 22, 80, 104, 64, 24, 48, 0];
  F.even = strikes(placed(even), both(placed(even), 'osc'), WIN);
  pair('osz-epiano-einzeln', placed(picked), 'osc', (x) => strikes(placed(picked), x, WIN));
  const restrikes = [[92, 58], [40, 102], [72, 22], [0, 40]].flatMap(([a, b], n) => [[n * 960 * BLOCK + 11 * BLOCK + a, 57, 0.6, 1.5], [n * 960 * BLOCK + 82 * BLOCK + b, 57, 0.6, 1.3]]);
  pair('osz-epiano-ueberlappend', { voice: RHODES, strikes: restrikes }, 'osc', (x) => {
    const m = whole(x), at = (s) => Math.floor(s[0] / WIN);
    const pairs = [];
    for (let p = 0; p < restrikes.length; p += 2) { // from the first strike's onset to 1.9 s after it
      let worst = 0;
      for (let w = at(restrikes[p]); w < at(restrikes[p]) + 38 && w < m.step.length; ++w) if (m.heard(w) && Math.abs(m.step[w].m - m.step[w].o) > Math.abs(worst)) worst = m.step[w].m - m.step[w].o;
      pairs.push({ places: [restrikes[p][0] % BLOCK, restrikes[p + 1][0] % BLOCK], worst });
    }
    return { ...m, pairs };
  });
  pair('osz-epiano-akkorde', track('epiano.json', 'epiano-neutral', false), 'osc', whole);
  pair('osz-epiano-funk', track('band.json', 'band-funk', false, onEpiano, solo('chords')), 'osc', whole);
  pair('osz-epiano-akkorde-band', track('epiano.json', 'epiano-neutral', true, allOn), 'osc', whole);
  pair('osz-epiano-funk-band', track('band.json', 'band-funk', true, onEpiano), 'osc', whole);
  // the e-piano alone with its band's sound (the style's, not the dry cases' neutral one) and the reverb: what tells the two apart
  F['epiano-akkorde-style'] = whole(both(track('epiano.json', 'epiano-neutral', true), 'osc'));
  F['epiano-funk-style'] = whole(both(track('band.json', 'band-funk', true, onEpiano, solo('chords')), 'osc'));
  // the phase advance alone: the kick, the toms and the percussion's tones, each an eighth of a frame after its time (the largest lead)
  F.advance = [['kick', KIT], ['tomHigh', KIT], ['tomMid', KIT], ['tomLow', KIT], ['congaHigh', PERC], ['congaLow', PERC], ['bongoHigh', PERC], ['bongoLow', PERC]]
    .map(([hit, key]) => ({ hit, key, ...strikes(aligned(key, hit, [0.125]), both(aligned(key, hit, [0.125]), 'osc'), Math.round(0.3 * R)).rows[0] }))
    .sort((a, b) => b.diff - a.diff);
  const top = F.advance[0];
  F.advanceName = `osz-vorschub-${HIT[top.hit][1]}`;
  pair(F.advanceName, aligned(top.key, top.hit, between), 'osc', (x) => strikes(aligned(top.key, top.hit, between), x, Math.round(0.3 * R)));

  pair('puffer-hihat', figure(KIT, 'hat', 0.25), 'buffers', (x) => strikes(figure(KIT, 'hat', 0.25), x, Math.round(0.24 * R)));
  pair('puffer-hihat-offen', figure(KIT, 'openHat', 0.6), 'buffers', (x) => strikes(figure(KIT, 'openHat', 0.6), x, Math.round(0.55 * R)));
  pair('puffer-crash', figure(KIT, 'crash', 1.6), 'buffers', (x) => strikes(figure(KIT, 'crash', 1.6), x, Math.round(1.5 * R)));
  pair('puffer-tamburin', figure(PERC, 'tambourine', 0.3), 'buffers', (x) => strikes(figure(PERC, 'tambourine', 0.3), x, Math.round(0.28 * R)));
  pair('puffer-saiten', figure(STRINGS, 64, 0.6, 0.5), 'buffers', (x) => strikes(figure(STRINGS, 64, 0.6, 0.5), x, Math.round(0.55 * R)));
  for (const [k, timbre] of [['snare', {}], ['snareSnap', { drums: { snareSnap: 1 } }]]) F[k] = strikes(figure(KIT, 'snare', 0.25, 0.1, timbre), both(figure(KIT, 'snare', 0.25, 0.1, timbre), 'buffers'), Math.round(0.24 * R));
  pair('puffer-percussion', track('kits-synth.json', 'percussion-synth', true), 'buffers', whole);
  pair('puffer-schlagzeug', track('kits-synth.json', 'drums-synth', true), 'buffers', whole);
  for (const band of ['funk', 'dreamy']) {
    const spec = track('band-synth.json', `band-synth-${band}`, true);
    pair(`beide-band-${band}`, spec, 'both', whole);
    for (const w of ['osc', 'buffers']) F[`${band}-${w}`] = whole(both(spec, w)); // each switch alone, for the text
  }
  // the voices of no pair: one figure each
  for (const layer of ['bass', 'chords', 'pad', 'lead']) F[`classic-${layer}`] = whole(both(track('classic.json', `classic-${layer}-neutral`, false), 'osc'));
  F['organ-osc'] = whole(both(track('organ.json', 'organ-jazz', false), 'osc'));
  F['organ-buffers'] = whole(both(track('organ.json', 'organ-jazz', false), 'buffers'));
  F['string-bass'] = whole(both(track('string.json', 'string-bass-neutral', false), 'buffers'));
} finally {
  rmSync(temp, { recursive: true, force: true });
}

// --- the text for the user ---
function rowsText(x, label, digits = 2) {
  return x.rows.map((y, i) => `    ${label} ${String(i + 1).padStart(2)}: mit ${abs(y.mit)} dB, ohne ${abs(y.ohne)} dB (${de(y.mit - y.ohne, digits)} dB)`).join('\n');
}
const quietest = (x) => x.rows.reduce((m, y, i) => (y.mit - y.ohne < x.rows[m].mit - x.rows[m].ohne ? i : m), 0);
const loudest = (x) => x.rows.reduce((m, y, i) => (y.mit - y.ohne > x.rows[m].mit - x.rows[m].ohne ? i : m), 0);
const DRY = 'trocken: die Stimme allein, ohne Mischpult, Hall und Begrenzer';
const DRY_TRACK = 'trocken: ohne Hall, Echo, Raum und Begrenzer, wie die Klangvergleiche rendern';
const APP = 'wie die App es spielt: mit Hall, Echo und Raum des Stils und mit dem Begrenzer';
function figures(m) {
  return `    Pegel des ganzen Laufs mit gegen ohne ${de(m.level)} dB; größter Unterschied in einem 50-ms-Fenster ${de(m.worst)} dB (bei ${abs(m.worstAt, 2)} s);\n`
    + `    Abstand der beiden Dateien ${abs(m.diff)} dB.`;
}
const highsText = (m) => `über 11 kHz mit ${abs(m.highs.mit[1])} dB, ohne ${abs(m.highs.ohne[1])} dB (um 8 kHz mit ${abs(m.highs.mit[0])}, ohne ${abs(m.highs.ohne[0])} dB)`;
function hitsText(name, what) {
  const x = P[name], q = quietest(x);
  return `${name}: ${what}, zwölf Schläge an den Stellen oben.\n    Gerendert ${DRY}.\n`
    + `Hinhören: Mit sind die Schläge 2, 4 und 6 leiser und dumpfer als 1, 3 und 5 (Schlag ${q + 1} am leisesten, ${abs(x.rows[q].ohne - x.rows[q].mit, 1)} dB); ohne klingen alle gleich.\n${rowsText(x, 'Schlag')}\n`
    + `    Spanne mit ${abs(x.spreadMit, 2)} dB, ohne ${abs(x.spreadOhne, 2)} dB.\n`;
}
function bandText(band) {
  const name = `beide-band-${band}`, m = P[name], c = contents(m.spec), o = F[`${band}-osc`], b = F[`${band}-buffers`];
  const classic = Object.keys(LAYER).filter((l) => synthOn(c.t, l)).map((l) => LAYER[l]);
  const up = m.upAt >= 0 ? (() => {
    const t = m.upAt * 0.05, ou = o.step[m.upAt].m - o.step[m.upAt].o, bu = b.step[m.upAt].m - b.step[m.upAt].o, osc = Math.abs(ou) >= Math.abs(bu);
    const hit = c.near(t).filter((s) => (osc ? MOVING : NOISE).includes(s));
    const why = osc ? 'Mit beginnt ihr Ton im ersten Block auf dem Standardwert 440 Hz (siehe oben), und je nach Stelle im Block wird ihr Einsatz so lauter oder leiser; hier lauter.'
      : 'Mit sind ihre Schläge leiser; wie das Ganze dort trotzdem lauter wird (über Hall und Begrenzer), zeigen die Zahlen nicht.';
    return `\n    Mit ist es auch einmal lauter: am meisten ${de(m.up)} dB im Fenster bei ${abs(t, 2)} s. Das kommt ${osc ? 'vom Oszillator-Schalter' : 'vom Puffer-Schalter'}: mit nur diesem Schalter`
      + `\n    sind es dort ${de(osc ? ou : bu)} dB, mit nur dem anderen ${de(osc ? bu : ou)} dB. In diesem Fenster setzen ${hit.length ? `${list(hit)} ein, die dieser Schalter trifft` : 'keine Stimmen ein, die dieser Schalter trifft'}.`
      + `\n    ${hit.length ? why : ''}`;
  })() : '';
  return `${name}: Fall band-synth-${band}, jede Schicht auf ihrer Synth-Stimme, beide Schalter.
    Gerendert ${APP}.
    Was der Oszillator-Schalter hier trifft: Oszillatoren mit fallender Frequenz in ${list(c.of(MOVING))} (Zahl der Schläge). Mit spielen sie in
    ihrem ersten Block bis zu ${BLOCK - 1} Abtastwerte lang auf dem Standardwert 440 Hz, bevor ihr Ton fällt; das ändert ihren Einsatz. Die
    Stimmen des klassischen Synths (${list(classic)}) haben nur Oszillatoren mit fester Frequenz; bei ihnen ändert der Schalter nur Rundungen
    (siehe „Was die Schalter sonst berühren“).
    Was der Puffer-Schalter hier trifft: Rauschen in ${list(c.of(NOISE))}, dazu ein kurzer Rausch-Klick in ${list([...names(c.of(['Congas', 'Bongos'])),
      ...(c.kickPunch > 0.5 ? [`bei diesem Klang (kickPunch ${abs(c.kickPunch, 2)}) der Bassdrum`] : [])]) || 'keinem weiteren Schlag'}.
    Hinhören: Mit sind Hi-Hats, Becken und Rauschen etwas dumpfer und einzelne Schläge leiser; die Einsätze von Bassdrum, Toms und Congas klingen
    je nach Schlag etwas anders. Die beiden Wirkungen sind in diesem Paar nicht getrennt; getrennt gemessen:
    nur Oszillatoren: Pegel ${de(o.level)} dB, größtes Fenster ${de(o.worst)} dB (bei ${abs(o.worstAt, 2)} s), Abstand der Dateien ${abs(o.diff)} dB;
    nur Puffer: Pegel ${de(b.level)} dB, größtes Fenster ${de(b.worst)} dB (bei ${abs(b.worstAt, 2)} s), Abstand der Dateien ${abs(b.diff)} dB, Höhen ${highsText(b)}.
${figures(m)}
    Anteil der Höhen am Ganzen: ${highsText(m)}.${up}
`;
}
function trackText(name, what, listen) {
  const m = P[name];
  return `${name}: ${what}\n    Gerendert ${m.spec.app ? APP : DRY_TRACK}.\n${listen ? `Hinhören: ${listen}\n` : ''}${figures(m)}${m.without === 'osc' ? '' : `\n    Anteil der Höhen am Ganzen: ${highsText(m)}.`}\n`;
}
const louder = (m) => `${abs(Math.abs(m.level), 1)} dB ${m.level < 0 ? 'leiser' : 'lauter'}`;
function styleText(spec, alone) { // the e-piano's sound in its band against the dry case's
  const { c, t } = trackOf(spec), s = resolveTrackTimbre(t).chords, n = c.sound?.chords ?? {};
  const v = (x) => abs(x ?? 0, 2);
  return `Das E-Piano hat hier den Klang des Stils (Helligkeit ${v(s.brightness)}, Länge ${v(s.length)}, Tremolo ${v(s.tremolo)}; im trockenen Paar `
    + `${v(n.brightness)}, ${v(n.length)} und ${v(n.tremolo)}) und Hall: allein so gespielt ist es mit ${louder(alone)} als ohne.`;
}
function aside(m) {
  return Number.isFinite(m.diff) ? `Abstand der Dateien ${abs(m.diff)} dB, Pegel ${de(m.level)} dB, größtes Fenster ${de(m.worst)} dB` : 'keiner, die beiden Dateien sind gleich';
}
function text() {
  const e = P['osz-epiano-einzeln'], o = P['osz-epiano-ueberlappend'], v = P[F.advanceName], top = F.advance[0];
  const advanceDiffs = v.rows.filter((x) => x.part > 0).map((x) => x.diff), advanceLevel = Math.max(...v.rows.map((x) => Math.abs(x.mit - x.ohne)));
  const epianoHighs = ['osz-epiano-akkorde', 'osz-epiano-funk'].map((n) => P[n].highs.ohne[1]);
  const loudness = (n) => louder(P[n]);
  const perc = contents(P['puffer-percussion'].spec), drums = contents(P['puffer-schlagzeug'].spec);
  // a note between two frames in a render's first block: the one place where the oscillator switch moves a constant frequency's phase
  const firstNote = (layer) => buildEvents(trackOf(track('classic.json', `classic-${layer}-neutral`, false)).t).some((x) => x.type === 'note' && x.layer === layer && x.t * R < BLOCK && (x.t * R) % 1 > 0);
  return `Hörpaare: Eigenheiten des Browsers, mit und ohne
================================================

Der native Kern baut an zwei Stellen nach, wie Chromium einen Ton innerhalb seiner Blöcke von ${BLOCK} Abtastwerten startet. So klingt
heute die Web-App, und so klingt heute auch die App. Wenn die Web-App wegfällt (vor Phase 9), zwingt nichts mehr dazu. Jedes Paar
hat zwei Dateien: „mit“ (A) ist der heutige Klang, „ohne“ (B) derselbe Lauf ohne die Eigenheit. Sonst ist nichts verändert.

- Oszillatoren (Paare „osz-…“, Schalter --without osc): Ohne startet jeder Oszillator genau zu seiner Zeit, auf den Bruchteil eines
  Abtastwerts genau, und seine Phase rückt um diesen Bruchteil vor. Das gilt, was auch immer seine Frequenz tut und wo im Lauf er beginnt.
  Mit bekommt ein Oszillator, dessen Frequenz sich bewegt (der Träger des E-Pianos, die Sinustöne von Bassdrum, Toms, Congas und Bongos), in
  seinem ersten Block die Frequenzwerte vom Anfang dieses Blocks statt von seinem eigenen Start: Er läuft seiner Frequenz um bis zu ${BLOCK - 1}
  Abtastwerte hinterher. Beim E-Piano bleibt die so verlorene Phase für den ganzen Ton, und je nach Stelle im Block wird der Ton lauter
  oder leiser. Und wenn ein solcher Oszillator zwischen zwei Abtastwerten beginnt, bekommt er keinen Phasenvorschub.
- Rausch-Schläge und andere Puffer (Paare „puffer-…“, Schalter --without buffers): Ohne beginnt ein Puffer-Ton auf dem nächsten Abtastwert
  statt dazwischen; er verschiebt sich dadurch um höchstens einen Abtastwert, ${abs(1000 / R, 2)} ms. Mit liest Chromium den Puffer zwischen
  zwei Abtastwerten (lineare Interpolation). Das dämpft Rauschen, und zwar am stärksten bei einem halben Abtastwert.
- Beide zusammen (Paare „beide-…“): zwei ganze Bands mit allen Stimmen auf Synth.

Trocken oder wie die App: Bei jedem Paar steht dabei, wie es gerendert ist. Die einzelnen Töne und Schläge und das E-Piano allein sind
trocken, damit der Unterschied deutlich ist; in der App liegt Hall darüber, der einen Teil davon verdeckt. Die Bands, die beiden
Schlagzeug-Paare und das E-Piano in seiner Band sind so gerendert, wie die App sie spielt.

Die Zahlen:
- Pegel eines Schlags oder Anschlags: sein Effektivwert in dB unter Vollaussteuerung, vom Einsatz bis zum nächsten Schlag (beim E-Piano
  die ersten 50 ms). „Spanne“: der Abstand zwischen dem lautesten und dem leisesten Schlag eines Paars.
- Bei Liedern und Bands: der Pegel des ganzen Laufs, und der größte Unterschied zwischen mit und ohne in einem Fenster von 50 ms
  (gezählt werden nur Fenster, die höchstens 20 dB unter dem lautesten liegen, also zu hören sind).
- Abstand der beiden Dateien: die Leistung ihres Unterschieds, Abtastwert für Abtastwert, im Verhältnis zur Datei „ohne“. Bei −20 dB ist
  der Unterschied ein Zehntel des Klangs. Um 0 dB oder darüber ist er so groß wie der Klang selbst; beim E-Piano liegt das daran, dass die
  Töne mit einer anderen Phase laufen, nicht daran, dass sie ganz anders klingen.
- Anteil der Höhen: die Leistung um 8 kHz und über 11 kHz im Verhältnis zum ganzen Klang (nur wo Rauschen im Spiel ist; beim E-Piano allein
  liegen die Höhen ${abs(-Math.max(...epianoHighs), 0)} bis ${abs(-Math.min(...epianoHighs), 0)} dB unter dem Ganzen und zählen nicht).

Die Schläge der Figuren (Rausch-Schläge, Saiten, Phasenvorschub) liegen so: Schlag 1, 3 und 5 genau auf einem Abtastwert, 2, 4 und 6 genau
in der Mitte dazwischen, 7 bis 12 ein Achtel, zwei Achtel, drei, fünf, sechs und sieben Achtel eines Abtastwerts danach.

Oszillatoren
------------

osz-epiano-einzeln: ein E-Piano-Ton (A3, Anschlag 0,6, 0,5 s), zehnmal angeschlagen.
    Gerendert ${DRY}.
Jedes Mal an einer anderen Stelle eines Blocks (${e.rows.map((x) => x.place).join(', ')} Abtastwerte nach dessen Anfang). Diese zehn
Stellen sind aus allen ${BLOCK} so gewählt, dass die Spanne am größten ist: die lautesten und die leisesten. Gezählt wird der Pegel der
ersten 50 ms. Hinhören: Mit sind die Anschläge verschieden laut (am lautesten Anschlag ${loudest(e) + 1}, am leisesten Anschlag ${quietest(e) + 1}); ohne
klingen alle zehn gleich.
${rowsText(e, 'Anschlag')}
    Spanne mit ${abs(e.spreadMit, 2)} dB, ohne ${abs(e.spreadOhne, 2)} dB. Vergleicht man die Anschläge in 50-ms-Fenstern über den ganzen Ton,
    unterscheiden sich zwei mit um bis zu ${abs(e.windows, 1)} dB.
    Ein Anschlag an einer beliebigen Stelle liegt dazwischen: Bei sechzehn gleichmäßig verteilten Stellen (0, 8, …, 120) ist die Spanne
    ${abs(F.even.spreadMit, 2)} dB (ohne ${abs(F.even.spreadOhne, 2)} dB).
    Berichtigung einer früheren Zahl: Einzelne E-Piano-Anschläge unterscheiden sich um bis zu etwa ${abs(e.windows, 1)} dB. Die früher genannten
    5,4 dB stammen aus überlappenden Anschlägen, als Unterschied zwischen mit und ohne in einem 50-ms-Fenster; das nächste Paar misst
    dafür ${de(o.pairs[0].worst)} dB.

osz-epiano-ueberlappend: viermal zwei Anschläge desselben Tons, der zweite, während der erste noch klingt.
    Gerendert ${DRY}.
So schlagen die Akkorde des E-Pianos unter dem Pedal nach. Die Stellen im Block sind ${o.pairs.map((p) => `${p.places[0]} und ${p.places[1]}`).join(', ')};
das erste Paar ist das aus der früheren Messung. Hinhören: wie laut und wie hell der Nachschlag kommt, und wie sich die beiden Töne
überlagern.
${o.pairs.map((p, i) => `    Paar ${i + 1}: größter Unterschied mit gegen ohne in einem 50-ms-Fenster ${de(p.worst)} dB`).join('\n')}
${figures(o)}

${trackText('osz-epiano-akkorde', 'die E-Piano-Akkorde des Falls epiano-neutral (Stil dreamy), das E-Piano allein.', `Mit ist das E-Piano insgesamt ${loudness('osz-epiano-akkorde')}, und einzelne Akkorde kommen verschieden laut.`)}
${trackText('osz-epiano-funk', 'die Akkord-Spur des Falls band-funk mit dem E-Piano gespielt, eine schnellere Figur, das E-Piano allein.', `wie bei den Akkorden; mit ist das E-Piano ${loudness('osz-epiano-funk')}.`)}
${trackText('osz-epiano-akkorde-band', `dieselben ${contents(P['osz-epiano-akkorde-band'].spec).count.get('E-Piano')} Akkordtöne in ihrer Band (Stil dreamy, alle Schichten an). Die anderen Stimmen sind Samples und ändern sich nicht.`,
    `das E-Piano unter Schlagzeug, Bass, Pad und Lead; mit ist das Ganze ${loudness('osz-epiano-akkorde-band')}. ${styleText(P['osz-epiano-akkorde-band'].spec, F['epiano-akkorde-style'])}`)}
${trackText('osz-epiano-funk-band', 'die Funk-Figur in ihrer Band (Fall band-funk, die Akkorde auf dem E-Piano). Die anderen Stimmen sind Samples und ändern sich nicht.',
    `das E-Piano in der Band; mit ist das Ganze ${loudness('osz-epiano-funk-band')}. ${styleText(P['osz-epiano-funk-band'].spec, F['epiano-funk-style'])}`)}
${F.advanceName}: die ${HIT[top.hit][0]}, zwölf Schläge an den Stellen oben; jeder setzt auf dem ersten Abtastwert eines Blocks ein.
    Gerendert ${DRY}.
Das zeigt allein den fehlenden Phasenvorschub: Mit beginnt ihr Sinuston mit einer Phase, die um bis
zu einen Abtastwert zurückliegt. Von Bassdrum, Toms, Congas und Bongos ist sie der größte Fall, gemessen an je einem Schlag ein Achtel nach
einem Abtastwert (Abstand der beiden Schläge: ${F.advance.map((x) => `${HIT[x.hit][0]} ${abs(x.diff)} dB`).join(', ')}). Er ist sehr klein: Der Pegel ändert sich
um höchstens ${abs(advanceLevel, 3)} dB, der Abstand der beiden Schläge liegt zwischen ${abs(Math.min(...advanceDiffs))} und ${abs(Math.max(...advanceDiffs))} dB.
Wahrscheinlich ist er nicht zu hören.
${v.rows.map((x, i) => `    Schlag ${String(i + 1).padStart(2)}: mit ${abs(x.mit)} dB, ohne ${abs(x.ohne)} dB (${de(x.mit - x.ohne, 3)} dB), Abstand der beiden Schläge ${x.part > 0 ? `${abs(x.diff)} dB` : 'keiner (auf einem Abtastwert)'}`).join('\n')}

Rausch-Schläge und Saiten
-------------------------

${hitsText('puffer-hihat', 'die geschlossene Hi-Hat')}
${hitsText('puffer-hihat-offen', 'die offene Hi-Hat')}
${hitsText('puffer-crash', 'das Crash-Becken')}
${hitsText('puffer-tamburin', 'das Tamburin der Synth-Percussion')}
Die Snare ist nicht dabei: Ihr Rauschen läuft durch einen Bandpass in der Mitte, wo die Interpolation kaum etwas wegnimmt. An denselben
zwölf Stellen liegen ihre Schläge mit nur ${abs(F.snare.spreadMit, 2)} dB auseinander (mit snareSnap 1: ${abs(F.snareSnap.spreadMit, 2)} dB; ohne ${abs(F.snare.spreadOhne, 2)} und ${abs(F.snareSnap.spreadOhne, 2)} dB).

puffer-saiten: die Saiten-Stimme der Akkorde (electric), ein Ton E4 zwölfmal an den Stellen oben.
    Gerendert ${DRY}.
Ihre Töne sind Puffer, die der Kern vorab rechnet; der Puffer-Schalter trifft sie wie das Rauschen.
Hinhören: ${P['puffer-saiten'].spreadMit < 0.5 ? 'wahrscheinlich nichts, die Saiten haben wenig Höhen' : 'mit sind die Schläge 2, 4 und 6 dumpfer'} (Schlag ${quietest(P['puffer-saiten']) + 1} am leisesten, ${abs(P['puffer-saiten'].rows[quietest(P['puffer-saiten'])].ohne - P['puffer-saiten'].rows[quietest(P['puffer-saiten'])].mit, 2)} dB).
${rowsText(P['puffer-saiten'], 'Schlag')}
    Spanne mit ${abs(P['puffer-saiten'].spreadMit, 2)} dB, ohne ${abs(P['puffer-saiten'].spreadOhne, 2)} dB.

${trackText('puffer-percussion', `die Synth-Percussion des Falls percussion-synth: ${list(perc.of(SOUNDS))} (Zahl der Schläge), keine Hi-Hats.`,
    `mit klingen ${list(names(perc.of(NOISE)))} etwas dumpfer, einzelne Schläge leiser${perc.of(['Congas', 'Bongos']).length ? `; ${list(names(perc.of(['Congas', 'Bongos'])))} haben nur einen kurzen Rausch-Klick` : ''}.`)}
${trackText('puffer-schlagzeug', `ein Groove des Synth-Schlagzeugs, Fall drums-synth: ${list(drums.of(SOUNDS))} (Zahl der Schläge; Ride, Side-Stick und Rimshot spielt das Synth-Schlagzeug als Hi-Hat und Snare).`,
    'Mit klingen Hi-Hats und Becken etwas dumpfer, einzelne Schläge leiser.')}
Beide Schalter, ganze Band
--------------------------

${bandText('funk')}
${bandText('dreamy')}
Was die Schalter sonst berühren
-------------------------------

Der Oszillator-Schalter trifft jede Stimme mit Oszillatoren: E-Piano, Synth-Schlagzeug und Synth-Percussion (oben), dazu den klassischen
Synth und die Orgel. Die beiden haben nur Oszillatoren mit fester Frequenz; bei ihnen ändert der Schalter, wo die Rechnung ihre Blöcke
beginnt, und den allerersten Block eines Renderlaufs (der in der App nie klingt, siehe unten). Gemessen, trocken, je Fall mit gegen ohne:
${['bass', 'chords', 'pad', 'lead'].map((l) => `    klassischer Synth, ${LAYER[l]} (classic-${l}-neutral): ${aside(F[`classic-${l}`])}${firstNote(l) ? ';\n      sein erster Ton liegt zwischen zwei Abtastwerten im allerersten Block, den es nur beim Rendern gibt' : ''}`).join('\n')}
    Orgel (organ-jazz): ${aside(F['organ-osc'])}
Die Saiten- und die Sample-Stimmen haben keine Oszillatoren.

Der Puffer-Schalter trifft jede Stimme mit Puffern: die Rausch-Schläge von Schlagzeug und Percussion und die Saiten-Stimmen (oben), dazu
den Tastenklick der Orgel. Gemessen, trocken:
    Orgel-Klick (organ-jazz): ${aside(F['organ-buffers'])}
    Saiten-Bass (string-bass-neutral): ${aside(F['string-bass'])}
E-Piano und klassischer Synth haben keine Puffer, die Sample-Stimmen gehen nicht durch diese Stelle.

Die dritte Eigenheit
--------------------

Ein Oszillator, der im allerersten Block eines Renderlaufs zwischen zwei Abtastwerten beginnt, bekommt keinen Phasenvorschub. Das ist in
der App nicht zu hören: Dort beginnt jedes Abspielen mit ${abs(APP_LEAD, 2)} s Vorlauf, in dem kein Ton startet, und der erste Block von ${BLOCK}
Abtastwerten (${abs(BLOCK / R * 1000, 1)} ms) ist vorbei, lange bevor der erste Ton kommt. Deshalb gibt es dafür kein Paar; der Oszillator-Schalter
nimmt sie mit weg.
`;
}

// after every definition above: the text and the page
writeFileSync(join(folder, 'LIESMICH.txt'), text().replace(/\n/g, '\r\n'));
console.log(`${Object.keys(P).length} pairs -> ${writeAbPage(folder).page}`);
