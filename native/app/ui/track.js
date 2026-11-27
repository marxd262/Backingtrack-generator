// Page for a loaded track (track.html). The app decodes and analyses the file and plays it; this page shows
// the result in sync with the playback and holds the user's corrections.
// Data: the analysis as it came (beats, first "one", chords with times) plus corrections
// { shift: beats the "one" is moved, tempo: 0.5 or 2 when the beats are to be counted at half or double the tempo,
//   edits: { index of a bar's first beat: chord name }, scale }.
// Fretboard, chord wheel, their texts and the remembered choices (language, labels, fret spacing) are the
// generator's own (this folder), so both pages look and behave alike. What the page shows comes from the core: the bars,
// chord changes, repeating parts and the tempo of the analysis with the corrections (trackView, native/PROTOKOLL.md section 4c),
// what the fretboard and the wheel show for the chords at the playhead (chordDisplays, section 4b), the lists of the selects
// from tables(). The page looks up by time in the core's lists, draws, and holds the corrections.
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
// the core's answer for the analysis and the corrections (trackView): the beats as counted, the tempo's text by the number of beats up to the
// playhead, the bars, the chord changes, the parts; empty until it came for this song
let gridBeats = [], tempos = [], bars = [], changes = [], sections = [];
let loop = null;                        // { start, end } in seconds
let rate = 1;

const storeKey = () => `btg.track.${track.name}.${Math.round(track.seconds)}`;
const ran = (e) => e.beats + (e.playing ? ((performance.now() - e.at) / 1000) * rate : 0); // one beat of the transport is one second
const seconds = () => Math.min(track ? track.seconds : 0, ran(engine));
// What the page last asked the engine for (playFile, stop, seek), until a report of the engine shows it: an input counts from there, not from the
// report before it, so two quick inputs are two (the messages wait in the shell's queue; the engine reports 30 times a second). A report shows it
// when it plays as asked within a quarter second of the place asked for, run on since; one that never does (a loop moved the place) gives way
// after a second. A wish within half a second of a place a late report could still show (the last report's, the wish before) is `near`: such a
// report would look like it, so only the second ends it (two keys from the last tenth of a bar are two bars). The displays follow the reports.
// shortcut: a message that waits in the shell's queue longer than a second lets the next input count from the report before it again, and a near
// wish lasts its full second even when the engine reached it at once: an input within it counts from the wish, also when the transport moved by
// itself meanwhile (the song's end, a loop's wrap), upgrade: when the engine's report names the last message the shell took
let wished = null; // { playing, beats, at, near }
const intended = () => (wished ? Math.min(track.seconds, ran(wished)) : seconds());
function wish(type, fields, playing, beats) {
  send(type, fields);
  const near = [engine, wished].some((e) => e && e.playing === playing && Math.abs(ran(e) - beats) < 0.5);
  wished = { playing, beats, at: performance.now(), near };
}
const seekTo = (beats) => wish('seek', { beats }, (wished ?? engine).playing, beats);
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
// the last questions again after every load and every return to the page: an answer that came while the page lay in the browser's history is not sent again
addEventListener('pageshow', () => { ask(asked.request); askView(viewed.json); });

// ---------- bars, chord changes and repeating parts: the core's (trackView) ----------

// The page asks when a song's analysis comes and after every correction, and draws from the answer to its last question (a late answer to an older
// one is dropped; the numbers start at this load's time, as for chordDisplays above).
const viewed = { seq: Date.now() % 1e9, json: null };
function askView(json) {
  if (json === null) return;
  Object.assign(viewed, { seq: viewed.seq + 1, json });
  send('trackView', { seq: viewed.seq, json });
}
const derive = () => askView(JSON.stringify({ analysis: track.analysis, seconds: track.seconds, shift: fix.shift, tempo: fix.tempo, edits: fix.edits }));
on('trackView', (m) => {
  if (m.seq !== viewed.seq || !m.json) return;
  let legend;
  ({ beats: gridBeats, tempo: tempos, bars, changes, sections, legend } = JSON.parse(m.json));
  $('sections').replaceChildren(...legend.map(({ name, pattern, count, places }) => {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: `${name}:  ${pattern.join(' | ')}   (${count}×)` });
    button.dataset.name = name;
    // the next place this pattern plays, from the playhead on (from the place last sought: two quick clicks are two places)
    button.addEventListener('click', () => seekTo(places.find((t) => t > intended() + 0.5) ?? places[0]));
    return button;
  }));
  shown.tempo = null; // draw() writes the tempo at the playhead
  shown.state = null;
  drawLane();
});
function save() {
  try { localStorage.setItem(storeKey(), JSON.stringify(fix)); } catch { /* the corrections then live until the page closes */ }
  derive();
}
function editBar(chord) {
  if (!track) return;
  const bar = bars.find((b) => intended() < b.end) ?? bars.at(-1); // the bar of the place last sought: a seek and an entry at once are two
  if (!bar) return; // the core's answer for this song has not come yet
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
  for (const { start, end, name, pattern } of sections) { // a part that does not repeat has no pattern
    if (end < from || start > to) continue;
    ctx.fillStyle = pattern ? 'rgba(111, 227, 230, 0.22)' : 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x(start) + 1, 1, (end - start) * pxPerSec - 2, ROWS.parts[1] - 3);
    ctx.fillStyle = ink2;
    ctx.fillText(pattern ? `${name}  ${pattern.join(' | ')}` : name, Math.max(x(start), 0) + 5, 9, Math.max(10, x(end) - Math.max(x(start), 0) - 8));
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
  if (!drag.moved) seekTo(Math.max(0, timeAt(e.clientX))); // a click jumps
  else if (loop.end - loop.start > 0.2) { send('loop', { start: loop.start, end: loop.end }); seekTo(loop.start); } else loop = null; // a drag sets the loop
  $('loop-off').disabled = !loop;
  drag = null;
  drawLane();
});
lane.addEventListener('keydown', (e) => {
  if (!track || !['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return;
  e.preventDefault();
  const n = bars.findIndex((b) => intended() < b.end); // from the place last sought: two quick keys are two bars
  const to = e.key === 'Home' ? 0 : bars[Math.min(bars.length - 1, Math.max(0, n + (e.key === 'ArrowRight' ? 1 : -1)))]?.start; // none before the core's answer
  if (to !== undefined) seekTo(to);
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
$('generator').addEventListener('click', () => { send('stop'); location.href = 'index.html'; });
$('play').addEventListener('click', () => { // starts or stops from what the page last asked for: two quick presses start and stop
  if ((wished ?? engine).playing) { wish('stop', {}, false, intended()); return; }
  const from = intended() >= track.seconds - 0.5 ? 0 : intended();
  wish('playFile', { from, rate }, true, from);
});
$('zoom-in').addEventListener('click', () => setZoom(pxPerSec * 1.5));
$('zoom-out').addEventListener('click', () => setZoom(pxPerSec / 1.5));
$('zoom-all').addEventListener('click', () => setZoom(0));
$('loop-off').addEventListener('click', () => { loop = null; send('loop', { start: 0, end: 0 }); $('loop-off').disabled = true; drawLane(); });
$('rate').addEventListener('input', () => { rate = Number($('rate').value) / 100; $('rate-out').textContent = `${$('rate').value} %`; send('fileRate', { rate }); });
addEventListener('keydown', (e) => { if (e.code === 'Space' && track && !['BUTTON', 'SELECT', 'INPUT'].includes(e.target.tagName)) { e.preventDefault(); $('play').click(); } });

on('engine', (m) => {
  engine = { ...m, at: performance.now() };
  if (wished && ((!wished.near && m.playing === wished.playing && Math.abs(m.beats - ran(wished)) < 0.25) || engine.at - wished.at > 1000)) wished = null;
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
  wished = null; // what the page asked for on the song before counts for none of this one
  gridBeats = tempos = bars = changes = sections = []; // the song without bars, changes and parts until the core's answer for it comes
  $('sections').replaceChildren();
  shown.state = null;
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
  const bar = bars.findIndex((b) => t < b.end), beat = bar >= 0 ? bars[bar].beats.findLastIndex((b) => b <= t + 0.01) : -1;
  const chord = now >= 0 ? changes[now].chord : null;
  set('chord', chord ?? '–');
  set('next', next ? next.chord : '–');
  const up = gridBeats.findLastIndex((b) => b <= t) + 1; // the beats up to the playhead
  const left = next ? Math.max(1, next.beats - up) : 0; // those after it up to the next change; a pushed chord comes before its beat
  set('next-label', !next ? tr('track.next') : left === 1 ? tr('track.nextInOne') : tr('track.nextIn', { n: left }));
  set('position', bar >= 0 ? tr('track.position', { bar: bar + 1, beat: Math.max(1, beat + 1) }) : '–');
  set('time', `${clock(t)} / ${clock(track.seconds)}`);
  if (tempos.length) set('tempo', tempos[up]); // the tempo where the track is now (it may change); none with fewer than ten beats
  // what depends on the chord, the bar and the part: only when one of them changes
  const part = bar >= 0 ? bars[bar].part : -1;
  const state = `${chord}|${next?.chord}|${bar}|${part}|${fix.scale}`;
  if (shown.state !== state) {
    shown.state = state;
    const s = sections[part]; // its pattern, when it repeats
    // the fretboard and the wheel show the core's answer for the chord at the playhead, the next one and the chords of the part (chordDisplays)
    ask({ key: track.analysis.key, scale: fix.scale ?? track.analysis.scale, chords: s ? s.used : [], current: chord, next: next?.chord ?? null });
    set('pattern-label', s?.pattern ? tr('track.patternAt', { name: s.name, turn: bars[bar].turn, repeats: s.repeats }) : tr('track.noPattern'));
    $('pattern').replaceChildren(...(s?.pattern ?? []).map((p, i) => Object.assign(document.createElement('li'), { textContent: p, className: i === bars[bar].place ? 'on' : '' })));
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
