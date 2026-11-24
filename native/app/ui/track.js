// Page for a loaded track (track.html). The app decodes and analyses the file and plays it; this page shows
// the result in sync with the playback and holds the user's corrections.
// Data: the analysis as it came (beats, first "one", chords with times) plus corrections
// { shift: beats the "one" is moved, tempo: 0.5 or 2 when the beats are to be counted at half or double the tempo,
//   edits: { index of a bar's first beat: chord name }, scale }.
// Fretboard, chord wheel, their texts and the remembered choices (language, labels, fret spacing) are the
// generator's own (this folder), so both pages look and behave alike. What they show for the chords at the
// playhead comes from the core (chordDisplays, native/PROTOKOLL.md section 4b), the lists of the selects from
// tables(): the page builds no chord name and holds no scale; it reads a name's root and minor third only to compare bars (`plain`).
import { createFretboardModule } from './fretboard.js';
import { createWheel } from './wheel.js';
import { loadLayout, saveLayout } from './layout-state.js';
import { layoutStorage, readLang, saveLang } from './page-storage.js'; // the language and the layout's storage, shared with the generator's page
import { t, setLanguage } from './i18n/index.js';
import { session, listen, post, on } from './session.js';
import TEXT from './track-text.js';

const send = post; // a message to the shell (native/PROTOKOLL.md section 7)
const $ = (id) => document.getElementById(id);
// a text of this page, or of the generator where this page has none
let lang = readLang();
const tr = (key, params) => (Object.hasOwn(TEXT[lang], key) ? TEXT[lang][key].replace(/\{(\w+)\}/g, (m, name) => String(params?.[name] ?? m)) : t(key, params));

let engine = { playing: false, beats: 0, at: 0 };
let track = null;                       // { name, seconds, analysis, peaks: Uint8Array, peakRate }
let fix = { shift: 0, edits: {} };
let bars = [], changes = [], sections = []; // derived from analysis and corrections
let loop = null;                        // { start, end } in seconds
let rate = 1;

const storeKey = () => `btg.track.${track.name}.${Math.round(track.seconds)}`;
const seconds = () => Math.min(track ? track.seconds : 0, engine.beats + (engine.playing ? ((performance.now() - engine.at) / 1000) * rate : 0)); // one beat of the transport is one second
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// The fretboard module (labels, fret spacing, board, legend) is the generator's, with the choice it remembers:
// names or degrees, real or even frets hold for both pages. Its strings and frets come with tables() (built then).
let layout = loadLayout(layoutStorage);
let boardView = { fretboard: [], name: null, notes: null, nextName: null, nextNotes: null }; // empty until a track is there
let fretboard = null;
const showBoard = () => fretboard?.update(boardView);
const wheel = createWheel($('wheel'), { key: { root: 'A', mode: 'minor' }, wheel: { nodes: [], path: [] }, at: null }, (chord) => editBar(chord.name));
// What the displays show: the core's answer to the page's last question (a late answer to an older one is dropped). The numbers start at this
// load's time, so that an answer to the page before is none here.
const asked = { seq: Date.now() % 1e9, key: null, request: { key: { root: 'A', mode: 'minor' }, scale: 'minorPentatonic', chords: [], current: null, next: null } };
function ask(request) {
  Object.assign(asked, { seq: asked.seq + 1, key: request.key, request });
  send('chordDisplays', { seq: asked.seq, json: JSON.stringify(request) });
}
on('chordDisplays', (m) => {
  if (m.seq !== asked.seq || !m.json) return;
  const answer = JSON.parse(m.json);
  if (track) { boardView = answer; showBoard(); }
  wheel.update({ key: asked.key, wheel: answer.wheel, at: answer.at });
});
// the last question again after every load and every return to the page: an answer lost while the browser was hidden is not sent again
addEventListener('pageshow', () => ask(asked.request));

// ---------- derive bars, chord changes and repeating parts ----------

// Parts: stretches in which the bars repeat with a period of 1 to 24 bars. Bars are compared by their main
// chord, and that by root and major/minor only (Gm7 and Gm are the same bar here, and so is a bar whose last beat
// already plays the next chord). The pattern of a part is the majority over its repeats, so a misread bar or a
// seventh heard once does not break it. Of the periods that fit, the shortest that reaches
// nearly as far as the best one wins: a long pattern is often a short one played twice.
// shortcut: the page reads root and minor third from a chord's name to compare bars (the bars, the corrections and the parts of an own song are
// still computed here), upgrade: when the bars and parts of an own song are computed in the core
const plain = (label) => label.split(' ').map((c) => (/^([A-G][#b]?)(m(?!aj))?/.exec(c) ?? [c]).slice(1).join('') || c).join(' ');
function findSections(labels, keys) {
  const most = (list) => { const votes = {}; for (const x of list) votes[x] = (votes[x] ?? 0) + 1; return Object.keys(votes).sort((x, y) => votes[y] - votes[x])[0]; };
  // from bar i on: how many bars follow the pattern `ref` (whole repeats; a few misses are forgiven)
  const reach = (i, ref) => {
    let miss = 0, good = i;
    for (let j = i; j < keys.length; j++) {
      if (keys[j] === ref[(j - i) % ref.length]) { good = j + 1; continue; }
      if (++miss > 1 + (j - i) / 8) break;
    }
    return good - i - ((good - i) % ref.length);
  };
  const majority = (i, bars, period, from) => Array.from({ length: period }, (_, k) => most(Array.from({ length: bars / period }, (_, r) => from[i + k + r * period])));
  const out = [];
  for (let i = 0; i < keys.length;) {
    const fits = [];
    for (let period = 1; period <= 24 && i + 2 * period <= keys.length; period++) {
      let bars = reach(i, keys.slice(i, i + period));
      if (bars < 2 * period || (period === 1 && bars < 4)) continue; // one chord held is a pattern only when it lasts
      bars = Math.max(bars, reach(i, majority(i, bars, period, keys))); // again against the majority: the first pass may hold the misread bar
      fits.push({ bars, period });
    }
    const far = Math.max(0, ...fits.map((f) => f.bars));
    // phrases are mostly 1, 2 or a multiple of 4 bars long: such a period goes first, then an even one
    const odd = (f) => (f.period <= 2 || f.period % 4 === 0 ? 0 : f.period % 2 === 0 ? 1 : 2);
    const best = fits.filter((f) => f.bars >= 0.8 * far).sort((x, y) => odd(x) - odd(y) || x.period - y.period)[0] ?? { bars: 1, period: 1 };
    const key = majority(i, best.bars, best.period, keys);
    // shown: at every place the most frequent full name among the bars that agree with the majority
    const pattern = key.map((k, at) => most(Array.from({ length: best.bars / best.period }, (_, r) => i + at + r * best.period).filter((j) => keys[j] === k).map((j) => labels[j])) ?? k);
    out.push({ first: i, bars: best.bars, pattern, key, repeats: best.bars / best.period });
    i += best.bars;
  }
  // bars that repeat nothing, next to each other, are one free part
  const merged = [];
  for (const s of out) {
    const last = merged.at(-1);
    if (s.repeats < 2 && last && last.repeats < 2) { last.bars += s.bars; last.pattern.push(...s.pattern); last.key.push(...s.key); } else merged.push(s);
  }
  // The same pattern gets the same letter: also when it starts at another of its bars, and when a quarter of its
  // bars differ (a part is rarely read the same twice).
  const alike = (x, y) => x.length === y.length && x.some((_, turn) => x.filter((v, i) => v === y[(i + turn) % y.length]).length >= 0.75 * x.length);
  const letters = [];
  for (const s of merged) {
    if (s.repeats < 2) { s.name = '–'; continue; }
    let known = letters.find((l) => alike(s.key, l.key));
    if (!known) letters.push(known = { key: s.key, name: String.fromCharCode(65 + letters.length) });
    s.name = known.name;
  }
  return merged;
}

// The beats and bar starts as found, or at half or double the tempo: whether a track is 76 or 152 bpm is a matter
// of how one counts, and the analysis sometimes counts the other way.
let gridBeats = []; // the beats as counted now
function gridOf(a) {
  if (fix.tempo === 2) { // a beat between every two, every bar becomes two
    const beats = a.beats.flatMap((t, i) => (i + 1 < a.beats.length ? [t, (t + a.beats[i + 1]) / 2] : [t]));
    return { beats, bars: a.bars.flatMap((b) => [2 * b, 2 * b + a.beatsPerBar]), bpm: a.bpm * 2 };
  }
  if (fix.tempo === 0.5) { // every second beat, every second bar
    const first = a.bars[0] % 2;
    return { beats: a.beats.filter((_, i) => i % 2 === first), bars: a.bars.filter((_, k) => k % 2 === 0).map((b) => Math.round((b - first) / 2)), bpm: a.bpm / 2 };
  }
  return { beats: a.beats, bars: a.bars, bpm: a.bpm };
}
function derive() {
  const a = track.analysis, grid = gridOf(a), beats = grid.beats, per = a.beatsPerBar;
  gridBeats = beats;
  shown.tempo = null; // draw() writes the tempo at the playhead
  const at = (t) => a.chords.findLast((c) => c.t <= t + 0.01) ?? a.chords[0];
  // bar starts as found, moved by the user's correction; beats before the first one form a short first bar
  const shift = ((fix.shift % per) + per) % per;
  const starts = [...new Set([0, ...(shift && grid.bars[0] + shift >= per ? [grid.bars[0] + shift - per] : []), ...grid.bars.map((b) => b + shift)])].filter((b) => b < beats.length);
  bars = [];
  for (let k = 0; k < starts.length; k++) {
    const i = starts[k], stop = starts[k + 1] ?? beats.length;
    const edit = fix.edits[i];
    const byBeat = beats.slice(i, stop).map((t) => ({ t, chord: edit ?? at(t).chord, from: edit != null ? t : at(t).t }));
    const count = {};
    for (const b of byBeat) count[plain(b.chord)] = (count[plain(b.chord)] ?? 0) + 1;
    const main = Object.keys(count).sort((x, y) => count[y] - count[x])[0]; // the chord most of the bar plays, for comparing bars
    bars.push({ first: i, start: beats[i], end: stop < beats.length ? beats[stop] : track.seconds, byBeat, main, label: [...new Set(byBeat.map((b) => b.chord))].join(' ') });
  }
  // a change begins where its chord begins in the analysis: on its beat, or an eighth before it (a pushed chord)
  changes = [];
  let before = -Infinity; // the beat before
  for (const b of bars) for (const s of b.byBeat) {
    if (changes.at(-1)?.chord !== s.chord) changes.push({ t: s.from > before ? s.from : s.t, chord: s.chord });
    before = s.t;
  }
  sections = findSections(bars.map((b) => b.label), bars.map((b) => b.main));
  // the legend: the patterns that fill most of the track, at most eight, in the order they first appear
  const share = {};
  for (const s of sections) if (s.repeats >= 2) share[s.name] = (share[s.name] ?? 0) + s.bars;
  const top = Object.keys(share).sort((x, y) => share[y] - share[x]).slice(0, 8);
  const names = [...new Set(sections.filter((s) => top.includes(s.name)).map((s) => s.name))];
  $('sections').replaceChildren(...names.map((name) => {
    const places = sections.filter((s) => s.name === name);
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: `${name}:  ${places[0].pattern.join(' | ')}   (${places.reduce((n, s) => n + s.repeats, 0)}×)` });
    button.dataset.name = name;
    button.addEventListener('click', () => { // the next place this pattern plays, from the playhead on
      const next = places.find((s) => bars[s.first].start > seconds() + 0.5) ?? places[0];
      send('seek', { beats: bars[next.first].start });
    });
    return button;
  }));
  shown.state = null;
  drawLane();
}
function save() {
  try { localStorage.setItem(storeKey(), JSON.stringify(fix)); } catch { /* the corrections then live until the page closes */ }
  derive();
}
function editBar(chord) {
  if (!track) return;
  const bar = bars.find((b) => seconds() < b.end) ?? bars.at(-1);
  fix.edits[bar.first] = chord;
  save();
}

// ---------- the lane: parts, chords, waveform, bar lines; scrolls and zooms in itself ----------

const lane = $('lane'), canvas = $('lane-canvas'), ctx = canvas.getContext('2d');
let pxPerSec = 20, followAfter = 0, drag = null;
let ROWS = { parts: [0, 18], chords: [18, 30], wave: [48, 100], ruler: [148, 22] }, laneHeight = 170;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const timeAt = (clientX) => (lane.scrollLeft + clientX - lane.getBoundingClientRect().left) / pxPerSec;
const beatNear = (t) => track.analysis.beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), 0);

function setZoom(next, anchorTime = seconds(), anchorX = lane.clientWidth / 2) {
  if (!track) return;
  const fit = lane.clientWidth / track.seconds;
  pxPerSec = Math.min(400, Math.max(fit, next));
  $('lane-spacer').style.width = `${Math.ceil(track.seconds * pxPerSec)}px`;
  lane.scrollLeft = anchorTime * pxPerSec - anchorX;
  drawLane();
}
function drawLane() {
  const width = lane.clientWidth, ratio = devicePixelRatio || 1;
  laneHeight = lane.clientHeight; // set by the page's style; the room under it is not the lane's
  ROWS = { parts: [0, 18], chords: [18, 30], wave: [48, laneHeight - 70], ruler: [laneHeight - 22, 22] };
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(laneHeight * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(laneHeight * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${laneHeight}px`;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = css('--lcd');
  ctx.fillRect(0, 0, width, laneHeight);
  if (!track) return;
  const from = lane.scrollLeft / pxPerSec, to = from + width / pxPerSec, x = (t) => (t - from) * pxPerSec;
  const now = seconds(), ink = css('--lcd-ink'), ink2 = css('--lcd-ink-2'), pink = css('--pink'), teal = css('--teal');
  ctx.textBaseline = 'middle';
  // loop
  if (loop) { ctx.fillStyle = 'rgba(24, 162, 166, 0.28)'; ctx.fillRect(x(loop.start), 0, (loop.end - loop.start) * pxPerSec, laneHeight); }
  // waveform: the loudest sample of every 10 ms, mirrored
  const [waveY, waveH] = ROWS.wave, mid = waveY + waveH / 2;
  ctx.fillStyle = ink;
  for (let px = 0; px < width; px++) {
    const a = Math.floor((from + px / pxPerSec) * track.peakRate), b = Math.max(a + 1, Math.floor((from + (px + 1) / pxPerSec) * track.peakRate));
    let peak = 0;
    for (let i = a; i < b && i < track.peaks.length; i++) if (track.peaks[i] > peak) peak = track.peaks[i];
    const h = Math.max(1, (peak / 255) * waveH);
    ctx.globalAlpha = (from + px / pxPerSec) < now ? 0.45 : 1; // played part dimmer
    ctx.fillRect(px, mid - h / 2, 1, h);
  }
  ctx.globalAlpha = 1;
  // bar lines and numbers
  ctx.font = `11px ${css('--mono')}`;
  const step = Math.max(1, Math.ceil(46 / ((bars[1]?.end - bars[1]?.start || 2) * pxPerSec)));
  bars.forEach((bar, n) => {
    if (bar.end < from || bar.start > to) return;
    ctx.fillStyle = 'rgba(185, 242, 107, 0.25)';
    ctx.fillRect(Math.round(x(bar.start)), waveY, 1, waveH + ROWS.ruler[1]);
    if (n % step === 0) { ctx.fillStyle = ink; ctx.fillText(String(n + 1), x(bar.start) + 3, ROWS.ruler[0] + 11); }
  });
  // chords above the waveform, at their place
  ctx.font = `600 14px ${css('--sans')}`;
  const current = changes.findLastIndex((c) => c.t <= now + 0.01);
  changes.forEach((c, i) => {
    const end = changes[i + 1]?.t ?? track.seconds;
    if (end < from || c.t > to) return;
    const left = x(c.t), w = (end - c.t) * pxPerSec;
    ctx.fillStyle = i === current ? pink : i === current + 1 ? teal : '#fff';
    ctx.fillRect(left + 1, ROWS.chords[0] + 2, Math.max(1, w - 2), ROWS.chords[1] - 4);
    if (w > 16) { ctx.fillStyle = '#111'; ctx.fillText(c.chord, Math.max(left, 0) + 5, ROWS.chords[0] + ROWS.chords[1] / 2 + 1, Math.max(8, w - 8)); }
  });
  // parts
  ctx.font = `11px ${css('--mono')}`;
  for (const s of sections) {
    const start = bars[s.first].start, end = bars[s.first + s.bars - 1].end;
    if (end < from || start > to) continue;
    ctx.fillStyle = s.repeats >= 2 ? 'rgba(111, 227, 230, 0.22)' : 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x(start) + 1, 1, (end - start) * pxPerSec - 2, ROWS.parts[1] - 3);
    ctx.fillStyle = ink2;
    ctx.fillText(s.repeats >= 2 ? `${s.name}  ${s.pattern.join(' | ')}` : s.name, Math.max(x(start), 0) + 5, 9, Math.max(10, x(end) - Math.max(x(start), 0) - 8));
  }
  // playhead
  ctx.fillStyle = pink;
  ctx.fillRect(Math.round(x(now)) - 1, 0, 2, laneHeight);
}

lane.addEventListener('wheel', (e) => { // the wheel moves the view, never the position in the song
  if (!track) return;
  e.preventDefault();
  if (e.ctrlKey) setZoom(pxPerSec * (e.deltaY < 0 ? 1.25 : 0.8), timeAt(e.clientX), e.clientX - lane.getBoundingClientRect().left);
  else lane.scrollLeft += e.deltaY + e.deltaX;
  followAfter = performance.now() + 4000;
}, { passive: false });
lane.addEventListener('scroll', drawLane);
canvas.addEventListener('pointerdown', (e) => { if (track) { drag = { x: e.clientX, t: timeAt(e.clientX), moved: false }; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (Math.abs(e.clientX - drag.x) > 5) drag.moved = true;
  if (drag.moved) { const [a, b] = [drag.t, timeAt(e.clientX)].sort((p, q) => p - q); loop = { start: beatNear(a), end: beatNear(b) }; drawLane(); }
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag) return;
  if (!drag.moved) send('seek', { beats: Math.max(0, timeAt(e.clientX)) }); // a click jumps
  else if (loop.end - loop.start > 0.2) { send('loop', { start: loop.start, end: loop.end }); send('seek', { beats: loop.start }); } else loop = null; // a drag sets the loop
  $('loop-off').disabled = !loop;
  drag = null;
  drawLane();
});
lane.addEventListener('keydown', (e) => {
  if (!track || !['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return;
  e.preventDefault();
  const n = bars.findIndex((b) => seconds() < b.end);
  send('seek', { beats: e.key === 'Home' ? 0 : bars[Math.min(bars.length - 1, Math.max(0, n + (e.key === 'ArrowRight' ? 1 : -1)))].start });
});
new ResizeObserver(() => { if (track) setZoom(pxPerSec); else drawLane(); }).observe(lane);

// ---------- controls ----------

// What needs the core's lists (the board's strings and frets, the scales, the chords of a bar's select) is built when tables() came with the
// answer to the page's sync; then the app is asked for the loaded track's analysis.
// shortcut: tables() comes with the whole sync (about 1 MB of the session's texts this page ignores), and as sync is queued, hello and so the
// analysis wait behind any queued session job, upgrade: a message for tables() alone when the load of this page is measured as slow
function build() {
  const { STANDARD_TUNING, FRETS, SCALES, BAR_CHORDS } = session.tables;
  fretboard = createFretboardModule($('mod-fretboard'), {
    layout: () => layout,
    choose(attr, value) { layout = { ...layout, [attr]: value }; saveLayout(layoutStorage, layout); showBoard(); },
    strings: STANDARD_TUNING,
    frets: FRETS,
  });
  showBoard();
  new ResizeObserver(() => fretboard.resize()).observe($('fretboard'));
  $('edit').append(...BAR_CHORDS.map((c) => Object.assign(document.createElement('option'), { value: c, textContent: c })));
  $('scale').append(...SCALES.map((id) => Object.assign(document.createElement('option'), { value: id })));
  if (track) $('scale').value = fix.scale ?? track.analysis.scale; // an analysis that came before the lists: its scale, now that the select has it
  shown.state = null; // draw() sets the bar's chord in its select, now that it has them
  language(lang);
  send('hello'); // the app sends the analysis of the loaded track again
}
$('edit').addEventListener('change', () => editBar($('edit').value));
$('scale').addEventListener('change', () => { fix.scale = $('scale').value; save(); });
$('one-back').addEventListener('click', () => { fix = { ...fix, shift: fix.shift - 1, edits: {} }; save(); }); // bars move, so edits of bars no longer fit
$('one-on').addEventListener('click', () => { fix = { ...fix, shift: fix.shift + 1, edits: {} }; save(); });
// the bars change with the count, so the moved "one" and the edits of bars no longer fit
$('tempo-half').addEventListener('click', () => { fix = { ...fix, tempo: fix.tempo === 2 ? 1 : 0.5, shift: 0, edits: {} }; save(); });
$('tempo-double').addEventListener('click', () => { fix = { ...fix, tempo: fix.tempo === 0.5 ? 1 : 2, shift: 0, edits: {} }; save(); });
$('reset').addEventListener('click', () => { fix = { shift: 0, edits: {} }; $('scale').value = track.analysis.scale; save(); });
// the picture takes room above the lane; the user may put it away (remembered)
const videoWanted = () => { try { return localStorage.getItem('btg.video') !== 'off'; } catch { return true; } };
function showVideo(on) {
  $('mod-video').hidden = !on;
  $('video-toggle').setAttribute('aria-pressed', String(on));
  if (!on) $('video').pause();
}
$('video-toggle').addEventListener('click', () => {
  const on = $('mod-video').hidden;
  try { localStorage.setItem('btg.video', on ? 'on' : 'off'); } catch { /* then it holds until the page closes */ }
  showVideo(on);
});
$('open').addEventListener('click', () => send('openFile'));
$('generator').addEventListener('click', () => { send('stop'); send('page', { track: false }); location.href = 'index.html'; });
$('play').addEventListener('click', () => (engine.playing ? send('stop') : send('playFile', { from: seconds() >= track.seconds - 0.5 ? 0 : seconds(), rate })));
$('zoom-in').addEventListener('click', () => setZoom(pxPerSec * 1.5));
$('zoom-out').addEventListener('click', () => setZoom(pxPerSec / 1.5));
$('zoom-all').addEventListener('click', () => setZoom(0));
$('loop-off').addEventListener('click', () => { loop = null; send('loop', { start: 0, end: 0 }); $('loop-off').disabled = true; drawLane(); });
$('rate').addEventListener('input', () => { rate = Number($('rate').value) / 100; $('rate-out').textContent = `${$('rate').value} %`; send('fileRate', { rate }); });
addEventListener('keydown', (e) => { if (e.code === 'Space' && track && !['BUTTON', 'SELECT', 'INPUT'].includes(e.target.tagName)) { e.preventDefault(); $('play').click(); } });

on('engine', (m) => {
  engine = { ...m, at: performance.now() };
  const f = m.file ?? {};
  $('loading').hidden = !f.loading && !f.error;
  $('loading-text').textContent = f.error ? tr('track.error', { error: f.error }) : tr('track.loading', { name: f.name ?? '', percent: Math.round(100 * (f.progress ?? 0)) });
  $('progress').value = f.progress ?? 0;
});
// Diagnosis, only when the app runs with BTG_POSITION_LOG=<file>: twice a second the engine says where it is, and
// the page writes that next to the position it shows (half way through the round trip, so the error is at most half
// of it), the age of the engine's last message and how the frames ran.
const probe = { id: null, frames: 0, longest: 0, last: 0, header: false };
setInterval(() => {
  if (!engine.positionLog || !engine.playing || !track) return;
  Object.assign(probe, { id: `p${performance.now()}`, t0: performance.now(), shown0: seconds() });
  send('ping', { id: probe.id });
}, 500);
on('pong', (m) => {
  if (m.id !== probe.id || m.beats === undefined) return;
  const t1 = performance.now(), at = (probe.shown0 + seconds()) / 2, chord = changes.findLast((c) => c.t <= at + 0.01);
  if (!probe.header) send('positionLog', { line: 'engine s\tshown s\tshown behind ms\tround trip ms\tage of engine message ms\tframes\tlongest frame ms\tspeed\tdevice Hz\tbuffer\toutput latency ms\tchord shown\tsince s' });
  probe.header = true;
  send('positionLog', { line: [m.beats.toFixed(3), at.toFixed(3), (1000 * (m.beats - at) / rate).toFixed(1), (t1 - probe.t0).toFixed(1), (t1 - engine.at).toFixed(1), probe.frames, probe.longest.toFixed(1), rate, engine.sampleRate, engine.bufferFrames, engine.outputLatencyMs?.toFixed(1), chord?.chord ?? '-', chord?.t.toFixed(2) ?? '-'].join('\t') });
  Object.assign(probe, { id: null, frames: 0, longest: 0 });
});
on('analysis', (m) => {
  const bytes = atob(m.peaks);
  track = { name: m.name, version: m.version, seconds: m.seconds, analysis: JSON.parse(m.json), peaks: Uint8Array.from(bytes, (c) => c.charCodeAt(0)), peakRate: m.peakRate };
  try { fix = JSON.parse(localStorage.getItem(storeKey())) ?? { shift: 0, edits: {} }; } catch { fix = { shift: 0, edits: {} }; }
  const a = track.analysis;
  delete $('title').dataset.i18n; // from here on the name of the file
  $('title').textContent = m.name;
  $('tempo').textContent = `${Math.round(a.bpm)} bpm · ${a.meter}`;
  $('key').textContent = `${a.key.root} ${tr(`mode.${a.key.mode}`)}`;
  $('scale').value = fix.scale ?? a.scale;
  for (const id of ['play', 'one-back', 'one-on', 'tempo-half', 'tempo-double', 'reset', 'zoom-in', 'zoom-out', 'zoom-all', 'edit', 'scale', 'rate']) $(id).disabled = false;
  loop = null;
  send('loop', { start: 0, end: 0 });
  // a video file: its picture runs along, muted (the sound is the engine's, so speed and loop apply)
  // The file is fetched whole and played from memory: the app's answers cannot be read in parts, and without
  // that a browser cannot jump inside a video.
  $('mod-video').hidden = $('video-toggle').hidden = true;
  URL.revokeObjectURL($('video').src);
  $('video').removeAttribute('src');
  if (m.video) {
    const version = m.version;
    fetch(`/media/video?v=${version}`).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status)))).then((blob) => {
      if (version !== track.version) return; // another track was loaded meanwhile
      $('video').src = URL.createObjectURL(blob);
      $('video-toggle').hidden = false;
      showVideo(videoWanted());
    }).catch(() => {}); // no picture then; the track plays all the same
  }
  derive();
  setZoom(lane.clientWidth / (16 * 4 * 60 / a.bpm), 0, 0); // about sixteen bars in view; "Alles" shows the whole track
});

// ---------- display: follows the engine's position, writes only what changed ----------

const shown = {};
const set = (id, text) => { if (shown[id] !== text) { shown[id] = text; $(id).textContent = text; } };
function draw() {
  requestAnimationFrame(draw);
  if (engine.positionLog) { // diagnosis: how the frames run
    const at = performance.now();
    if (probe.last) probe.longest = Math.max(probe.longest, at - probe.last);
    probe.last = at;
    probe.frames++;
  }
  set('play', tr(engine.playing ? 'track.stop' : 'track.start'));
  if (!track) return;
  const t = seconds();
  const now = changes.findLastIndex((c) => c.t <= t + 0.01), next = changes[now + 1];
  const bar = bars.findIndex((b) => t < b.end), beat = bar >= 0 ? bars[bar].byBeat.findLastIndex((s) => s.t <= t + 0.01) : -1;
  const chord = now >= 0 ? changes[now].chord : null;
  set('chord', chord ?? '–');
  set('next', next ? next.chord : '–');
  const left = next ? Math.max(1, gridBeats.filter((b) => b > t && b <= next.t + 0.01).length) : 0; // a pushed chord comes before its beat
  set('next-label', !next ? tr('track.next') : left === 1 ? tr('track.nextInOne') : tr('track.nextIn', { n: left }));
  set('position', bar >= 0 ? tr('track.position', { bar: bar + 1, beat: Math.max(1, beat + 1) }) : '–');
  set('time', `${clock(t)} / ${clock(track.seconds)}`);
  // the tempo where the track is now (it may change): from the beats around the playhead
  const here = Math.max(4, Math.min(gridBeats.length - 5, gridBeats.findLastIndex((b) => b <= t)));
  if (gridBeats.length > 9) set('tempo', `${Math.round(60 * 8 / (gridBeats[here + 4] - gridBeats[here - 4]) / (track.analysis.meter.endsWith('/8') ? 3 : 1))} bpm · ${track.analysis.meter}`);
  // what depends on the chord, the bar and the part: only when one of them changes
  const part = sections.findIndex((s) => bar >= s.first && bar < s.first + s.bars);
  const state = `${chord}|${next?.chord}|${bar}|${part}|${fix.scale}`;
  if (shown.state !== state) {
    shown.state = state;
    const s = sections[part];
    // the fretboard and the wheel show the core's answer for the chord at the playhead, the next one and the chords of the part (chordDisplays)
    const used = s && s.repeats >= 2 ? [...new Set(s.pattern.flatMap((p) => p.split(' ')))] : [];
    ask({ key: track.analysis.key, scale: fix.scale ?? track.analysis.scale, chords: used, current: chord, next: next?.chord ?? null });
    set('pattern-label', s && s.repeats >= 2 ? tr('track.patternAt', { name: s.name, turn: Math.floor((bar - s.first) / s.pattern.length) + 1, repeats: s.repeats }) : tr('track.noPattern'));
    $('pattern').replaceChildren(...(s && s.repeats >= 2 ? s.pattern : []).map((p, i) => Object.assign(document.createElement('li'), { textContent: p, className: i === (bar - s.first) % s.pattern.length ? 'on' : '' })));
    [...$('sections').children].forEach((b) => b.classList.toggle('on', b.dataset.name === s?.name));
    if (session.tables?.BAR_CHORDS.includes(bars[bar]?.label)) $('edit').value = bars[bar].label; // the lists come with the answer to sync
  }
  if (!$('mod-video').hidden) { // the picture follows the engine: same place, same speed
    const video = $('video');
    if (video.playbackRate !== rate) video.playbackRate = rate;
    if (engine.playing && video.paused) video.play().catch(() => {});
    if (!engine.playing && !video.paused) video.pause();
    if (Math.abs(video.currentTime - t) > (engine.playing ? 0.25 : 0.04)) video.currentTime = t;
  }
  // the lane follows the playhead while it plays, unless the user just moved the view
  if (engine.playing && performance.now() > followAfter) {
    const x = t * pxPerSec - lane.scrollLeft;
    if (x > lane.clientWidth * 0.85 || x < 0) lane.scrollLeft = t * pxPerSec - lane.clientWidth * 0.15;
  }
  drawLane();
}

// ---------- language: chosen in the app's strip, the same for every page ----------

function language(next) {
  lang = next;
  setLanguage(lang); // the generator's components take their texts from there
  document.documentElement.lang = lang;
  document.title = tr('track.title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = tr(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', tr(el.dataset.i18nLabel));
  for (const option of $('scale').options) option.textContent = tr(`scale.${option.value}`);
  if (track) $('key').textContent = `${track.analysis.key.root} ${tr(`mode.${track.analysis.key.mode}`)}`;
  for (const id of Object.keys(shown)) delete shown[id]; // draw() writes the rest anew
  send('language', { lang }); // the strip shows the choice
}
let built = false;
listen((what, value) => {
  if (what === 'tables' && !built) { built = true; build(); }
  if (what === 'language') { saveLang(value); language(value); }
});
language(lang);
draw();
