// Replaces src/audio/play.js inside the app. Same contract (docs/interface.md, "play"), but the engine of the
// app is the clock and the sound: this file hands it the track and the controls and turns the engine's
// position into the callbacks the UI draws from (onBar, onEvent). The AudioContext passed in is not used.
import { buildEvents } from '../core/events.js';
import { normalizeTrack } from '../core/track.js';
import { resolveVoices } from '../core/voices.js';
import { resolveTrackTimbre } from '../core/timbre.js';
import { chordIndex } from '../core/form.js';
import { meterKey } from '../core/grooves.js';
import { LAYER_IDS } from '../core/layers.js';
import { sliderGain } from './mix.js';

const backend = window.__JUCE__.backend;
const send = (type, data = {}) => backend.emitEvent('btg', { type, ...data });

// Last state from the engine (30 per second); between two messages the position runs on at the engine's tempo.
let engine = { run: 0, playing: false, beats: 0, bpm: 120, peaks: {}, at: 0 };
backend.addEventListener('engine', (message) => { engine = { ...message, at: performance.now() }; });
// The language is chosen in the app's strip, for every page. On the generator's page its own chips do the
// switching and the remembering; they stay hidden. (The track page loads this module too and has no chips.)
if (document.querySelector('[data-lang]')) {
  document.head.append(Object.assign(document.createElement('style'), { textContent: '.lang { display: none !important; }' }));
  backend.addEventListener('language', (lang) => document.querySelector(`[data-lang="${lang}"]`)?.click());
  addEventListener('load', () => send('language', { lang: document.documentElement.lang })); // by then the page has drawn itself in its language
}
// (`standing`: the lead after a start, the clock stands at the start place and the page must not run on.)
const engineBeats = () => engine.beats + (engine.playing && !engine.standing ? ((performance.now() - engine.at) / 1000) * (engine.bpm / 60) : 0);

// The engine takes the track as normalizeTrack writes it, with the voices filled in.
const sendTrack = (track) => send('track', { json: JSON.stringify({ ...normalizeTrack(track), voices: resolveVoices(track) }) });
// the whole sound model (the core maps it: Task 16; the layer effects: Task 18)
const sendTimbre = (timbre) => send('timbre', { json: JSON.stringify(timbre) });

let runs = 0;
const TICK_MS = 10;

export function play(ctx, trackInput, { loops = 1, startBar = 0, levels, master, pans, tuning, onEvent, onBar, onEnd, timing, ornaments } = {}) {
  const given = trackInput;
  let events = buildEvents(given, { timing, ornaments }); // throws on an invalid track before anything starts
  if (!(loops === Infinity || (Number.isInteger(loops) && loops >= 1))) {
    throw new RangeError(`loops must be an integer >= 1 or Infinity, got ${loops}`);
  }
  for (const v of [master ?? 1, ...Object.values(levels ?? {})]) sliderGain(v);
  const track = normalizeTrack(given);
  const startMeter = meterKey(track.meter);
  const bpm = track.bpm;
  const loopBars = track.length;
  if (!(Number.isInteger(startBar) && startBar >= 0 && startBar < loopBars)) {
    throw new RangeError(`startBar must be an integer in [0, ${loopBars - 1}], got ${startBar}`);
  }
  let loopSec = 0, startSec = 0;
  for (let i = 0; i < loopBars; i++) {
    if (i === startBar) startSec = loopSec;
    loopSec += (track.bars[chordIndex(track, i)].beats * 60) / bpm;
  }

  const run = ++runs;
  send('tuning', { json: JSON.stringify(tuning ?? {}) }); // the voices that `track` builds read it
  sendTrack(given);
  sendTimbre(resolveTrackTimbre(track));
  send('master', { value: master ?? 1 });
  for (const layer of LAYER_IDS) {
    send('level', { layer, value: levels?.[layer] ?? 1 });
    send('pan', { layer, value: pans?.[layer] ?? null }); // null: where mix/pan puts the layer
    send('mute', { layer, on: false });
  }
  send('play', { run, bpm, startBeats: (startSec * bpm) / 60 });

  // Song time in seconds at the start tempo, as in the web player. Until the engine reports this run: the start.
  let frozen = null;
  const songTime = () => frozen ?? (engine.run === run ? Math.max(0, (engineBeats() * 60) / bpm) : startSec);

  // first event at or after a song time inside the loop (event times are rounded to six places)
  const firstAt = (sec) => { const i = events.findIndex((e) => e.t >= sec - 1e-6); return i < 0 ? events.length : i; };
  let loop = 0;
  let next = firstAt(startSec); // events before startBar are not played
  let stopped = false;
  let last = startSec;
  // The engine can jump (the app's own transport: jump, loop). Then the callbacks start again at the new place.
  function resync(now) {
    loop = Math.floor(now / loopSec);
    const inLoop = now - loop * loopSec;
    next = firstAt(inLoop);
    const chord = events.findLast((e) => e.type === 'chord' && e.t <= inLoop);
    if (chord) onBar?.({ bar: chord.bar + loop * loopBars, chord: chord.chord });
  }
  function tick() {
    // before the engine reports this play, and in its lead (the clock stands): nothing fires, the events at the start fire when the clock moves
    if (frozen === null && (engine.run !== run || engine.standing)) return;
    const now = songTime();
    if (now < last - 0.05 || now > last + 0.5) resync(now);
    last = now;
    while (loop < loops && !stopped) {
      if (next === events.length) {
        if ((loop + 1) * loopSec > now) return;
        loop++;
        next = 0;
        if (loop >= loops) onEnd?.();
        continue;
      }
      const e = events[next];
      const song = loop * loopSec + e.t;
      if (song > now) return;
      next++;
      const ev = { ...e, t: song, bar: e.bar + loop * loopBars };
      onEvent?.(ev);
      if (e.type === 'chord') onBar?.({ bar: ev.bar, chord: ev.chord });
    }
  }
  const timer = setInterval(tick, TICK_MS);

  function stop() {
    if (stopped) return;
    frozen = songTime();
    stopped = true;
    clearInterval(timer);
    send('stop');
  }
  const checkLayer = (name) => {
    if (!LAYER_IDS.includes(name)) throw new Error(`Unknown layer: ${name}`);
  };

  return {
    startPerf: performance.now(),
    stop,
    songTime,
    setLayer(name, on) {
      checkLayer(name);
      send('mute', { layer: name, on: !on });
    },
    setLevel(name, value) {
      checkLayer(name);
      sliderGain(value);
      send('level', { layer: name, value });
    },
    setPan(name, pan) {
      if (!(Number.isFinite(pan) && pan >= -1 && pan <= 1)) throw new RangeError(`pan must be a number in [-1, 1], got ${pan}`);
      send('pan', { layer: name, value: pan });
    },
    setMaster(value) {
      sliderGain(value);
      send('master', { value });
    },
    setTimbre(timbre) {
      if (!stopped) sendTimbre(timbre);
    },
    setVoices(voices) { if (!stopped) send('voices', { json: JSON.stringify(voices) }); },
    setTuning(next) { if (!stopped) send('tuning', { json: JSON.stringify(next ?? {}) }); },
    level: (name) => (stopped ? 0 : engine.peaks?.[name] ?? 0),
    setTrack(newTrack) {
      if (stopped) return false;
      const given2 = { ...newTrack, bpm };
      const next2 = buildEvents(given2, { timing, ornaments });
      const t2 = normalizeTrack(given2);
      let sec = 0;
      for (let i = 0; i < t2.length; i++) sec += (t2.bars[chordIndex(t2, i)].beats * 60) / bpm;
      if (t2.length !== loopBars || Math.abs(sec - loopSec) > 1e-9 || meterKey(t2.meter) !== startMeter) return false;
      sendTrack(given2); // the engine plays the new events from its next block on
      const tLast = next > 0 ? events[next - 1].t : -Infinity;
      events = next2;
      next = events.findIndex((e) => e.t > tLast);
      if (next < 0) next = events.length;
      return true;
    },
    setTempo(newBpm) {
      if (!(Number.isFinite(newBpm) && newBpm >= 20 && newBpm <= 400)) throw new RangeError(`bpm must be in [20, 400], got ${newBpm}`);
      send('tempo', { bpm: newBpm });
    },
  };
}
