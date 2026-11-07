// Echtzeit-Wiedergabe mit Vorausplanung: Timer alle 25 ms plant die Ereignisse der nächsten 100 ms.
// Der Aufrufer besitzt den AudioContext; stop() schließt ihn nie.
import { buildEvents } from '../core/events.js';
import { normalizeTrack } from '../core/track.js';
import { createInstruments as synthInstruments } from './synth.js';

const TICK_MS = 25;
const LOOKAHEAD = 0.1;
const LEAD = 0.15; // Vorlauf bis Liedzeit 0
const FADE = 0.05;

/**
 * Spielt einen Track `loops`-mal (Standard 1, Infinity erlaubt). Takte zählen über Durchläufe weiter.
 * onEvent: jedes Ereignis (auch stumm geschalteter Schichten), onBar: {bar, chord} je Takt, onEnd: nach dem letzten Durchlauf.
 * Ereignisse an die Rückrufe tragen `bar` und `t` (Liedzeit beim Originaltempo) über alle Durchläufe.
 */
export function play(ctx, trackInput, { loops = 1, onEvent, onBar, onEnd, createInstruments = synthInstruments } = {}) {
  const events = buildEvents(trackInput); // wirft bei ungültigem Track, bevor ein Knoten entsteht
  if (!(loops >= 1)) throw new RangeError(`loops must be >= 1, got ${loops}`);
  const track = normalizeTrack(trackInput);
  const bpm = track.bpm;
  const loopBars = track.length;
  let loopSec = 0;
  for (let i = 0; i < loopBars; i++) loopSec += (track.bars[i % track.bars.length].beats * 60) / bpm;

  const instruments = createInstruments(ctx, { bpm });
  const out = ctx.createGain();
  instruments.output.connect(out).connect(ctx.destination);

  const startCtx = ctx.currentTime + LEAD;
  const ts = ctx.getOutputTimestamp?.();
  const startPerf = ts?.contextTime && ts?.performanceTime
    ? ts.performanceTime + (startCtx - ts.contextTime) * 1000
    : performance.now() + (startCtx - ctx.currentTime) * 1000;

  // Liedzeit -> ctx-Zeit über Anker und Tempofaktor; setTempo setzt einen neuen Anker
  let anchor = { song: 0, ctx: startCtx };
  let rate = 1;
  let lastCtx = startCtx; // ctx-Zeit des zuletzt geplanten Ereignisses (ungeklemmt)
  const toCtx = (song) => anchor.ctx + (song - anchor.song) / rate;

  let loop = 0;
  let next = 0;
  let stopped = false;
  const timers = new Set();
  const at = (when, fn) => {
    if (!fn) return;
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, Math.max(0, (when - ctx.currentTime) * 1000));
    timers.add(id);
  };

  function tick() {
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (loop < loops) {
      if (next === events.length) {
        // Durchlauf endet mit seinem letzten Takt, nicht mit seinem letzten Ereignis
        const end = toCtx((loop + 1) * loopSec);
        if (end > horizon) return;
        loop++;
        next = 0;
        if (loop >= loops) {
          clearInterval(scheduler);
          at(end, onEnd);
        }
        continue;
      }
      const e = events[next];
      const song = loop * loopSec + e.t;
      const due = toCtx(song);
      if (due > horizon) return;
      next++;
      lastCtx = due;
      const when = Math.max(due, ctx.currentTime);
      const ev = { ...e, t: song, bar: e.bar + loop * loopBars };
      if (e.type === 'hit' || e.type === 'note') {
        instruments.layers[e.layer].trigger(e.type === 'note' && rate !== 1 ? { ...ev, dur: ev.dur / rate } : ev, when);
      }
      at(when, onEvent && (() => onEvent(ev)));
      if (e.type === 'chord') at(when, onBar && (() => onBar({ bar: ev.bar, chord: ev.chord })));
    }
  }
  const scheduler = setInterval(tick, TICK_MS);
  tick();

  return {
    startPerf,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(scheduler);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0, now + FADE);
      setTimeout(() => out.disconnect(), FADE * 2000);
    },
    // setMuted(true) heißt stumm. Neue und schon geplante Töne verstummen, Echo- und Hallfahnen klingen 1-2 s nach.
    setLayer(name, on) {
      if (!Object.hasOwn(instruments.layers, name)) throw new Error(`Unknown layer: ${name}`);
      instruments.layers[name].setMuted(!on);
    },
    setTempo(newBpm) {
      if (!(Number.isFinite(newBpm) && newBpm >= 20 && newBpm <= 400)) throw new RangeError(`bpm must be in [20, 400], got ${newBpm}`);
      // Anker nicht vor das zuletzt geplante Ereignis: geplante Ereignisse behalten ihre Zeit, nichts wird umgeordnet
      const pivot = Math.max(ctx.currentTime, anchor.ctx, lastCtx);
      anchor = { song: anchor.song + (pivot - anchor.ctx) * rate, ctx: pivot };
      // shortcut: Echo-Verzögerung der Synth-Instrumente bleibt beim Originaltempo, Instrument-Schnittstelle hat kein setTempo
      rate = newBpm / bpm;
    },
  };
}
