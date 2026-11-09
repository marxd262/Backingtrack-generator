// Echtzeit-Wiedergabe mit Vorausplanung: Timer alle 25 ms plant die Ereignisse der nächsten 100 ms.
// Der Aufrufer besitzt den AudioContext; stop() schließt ihn nie.
import { buildEvents } from '../core/events.js';
import { resolveTrackTimbre } from '../core/timbre.js';
import { normalizeTrack } from '../core/track.js';
import { meterKey } from '../core/grooves.js';
import { createInstruments as synthInstruments } from './synth.js';
import { sliderGain } from './mix.js';

const TICK_MS = 25;
const LOOKAHEAD = 0.1;
const LEAD = 0.15; // Vorlauf bis Liedzeit 0
const FADE = 0.05;

/**
 * Spielt einen Track `loops`-mal (Standard 1, Infinity erlaubt). Takte zählen über Durchläufe weiter.
 * onEvent: jedes Ereignis (auch stumm geschalteter Schichten), onBar: {bar, chord} je Takt, onEnd: nach dem letzten Durchlauf.
 * Ereignisse an die Rückrufe tragen `bar` und `t` (Liedzeit beim Originaltempo) über alle Durchläufe.
 * startBar (ganze Zahl 0..length-1, Standard 0): beginnt mit diesem Takt; frühere Ereignisse entfallen, `bar` und `t` zählen ab
 * dort wie beim Durchspielen weiter, der angefangene Durchlauf zählt als erster. startPerf ist der Beginn des ersten gespielten Takts.
 * levels ({drums, bass, chords, pad}, je 0..1, fehlend 1) und master (0..1) sind die Reglerstellungen des Mischpults von Beginn an;
 * ungültig wirft RangeError (unbekannte Schicht Error) noch vor dem ersten Ton.
 */
export function play(ctx, trackInput, { loops = 1, startBar = 0, levels, master, onEvent, onBar, onEnd, createInstruments = synthInstruments } = {}) {
  let events = buildEvents(trackInput); // wirft bei ungültigem Track, bevor ein Knoten entsteht; setTrack tauscht ihn
  if (!(loops === Infinity || (Number.isInteger(loops) && loops >= 1))) {
    throw new RangeError(`loops must be an integer >= 1 or Infinity, got ${loops}`);
  }
  for (const v of [master ?? 1, ...Object.values(levels ?? {})]) sliderGain(v); // wirft RangeError, bevor ein Knoten entsteht
  const track = normalizeTrack(trackInput);
  const startMeter = meterKey(track.meter);
  const bpm = track.bpm;
  const loopBars = track.length;
  if (!(Number.isInteger(startBar) && startBar >= 0 && startBar < loopBars)) {
    throw new RangeError(`startBar must be an integer in [0, ${loopBars - 1}], got ${startBar}`);
  }
  let loopSec = 0, startSec = 0; // startSec: Liedzeit am Beginn von startBar
  for (let i = 0; i < loopBars; i++) {
    if (i === startBar) startSec = loopSec;
    loopSec += (track.bars[i % track.bars.length].beats * 60) / bpm;
  }

  // Schlagworte sind durch buildEvents geprüft, resolveTimbre wirft hier nicht
  const instruments = createInstruments(ctx, { bpm, timbre: resolveTrackTimbre(track), levels, master });
  for (const e of events) {
    if (e.layer && !Object.hasOwn(instruments.layers, e.layer)) throw new Error(`Instruments lack layer: ${e.layer}`);
  }
  const out = ctx.createGain();
  instruments.output.connect(out).connect(ctx.destination);

  const startCtx = ctx.currentTime + LEAD;
  const ts = ctx.getOutputTimestamp?.();
  const startPerf = ts?.contextTime && ts?.performanceTime
    ? ts.performanceTime + (startCtx - ts.contextTime) * 1000
    : performance.now() + (startCtx - ctx.currentTime) * 1000;

  // Liedzeit -> ctx-Zeit über Anker und Tempofaktor; setTempo setzt einen neuen Anker
  let anchor = { song: startSec, ctx: startCtx };
  let rate = 1;
  let lastCtx = startCtx; // ctx-Zeit des zuletzt geplanten Ereignisses (ungeklemmt)
  const toCtx = (song) => anchor.ctx + (song - anchor.song) / rate;

  let loop = 0;
  let next = 0;
  let stopped = false;
  const timers = new Set();
  // Rückrufe laufen auf der ctx.currentTime-Uhr: gegenüber startPerf (enthält die Ausgabelatenz) kommen sie etwa
  // ctx.outputLatency zu früh; Interactive Scales muss das beim Ausrichten einer Aufnahme berücksichtigen.
  const at = (when, fn) => {
    if (!fn) return;
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, Math.max(0, (when - ctx.currentTime) * 1000));
    timers.add(id);
  };

  function schedule() {
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
      if (loop === 0 && e.bar < startBar) { next++; continue; } // vor startBar: entfällt
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
  function stop() {
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
  }
  // Fehler beim Planen (z. B. werfendes trigger) stoppt alles, sonst bliebe ein Planer übrig, den niemand anhalten kann
  function tick() {
    try {
      schedule();
    } catch (err) {
      stop();
      throw err;
    }
  }
  const scheduler = setInterval(tick, TICK_MS);
  tick();

  return {
    startPerf,
    stop,
    // setMuted(true) heißt stumm. Neue und schon geplante Töne verstummen, Echo- und Hallfahnen klingen 1-2 s nach.
    setLayer(name, on) {
      if (!Object.hasOwn(instruments.layers, name)) throw new Error(`Unknown layer: ${name}`);
      instruments.layers[name].setMuted(!on);
    },
    // Reglerstellung 0..1 (Quadrat, 1 = unverändert); wirkt auf die Schicht samt Echo und Hall. Ungültig: RangeError, unbekannter Name: Error.
    setLevel(name, value) {
      if (!Object.hasOwn(instruments.layers, name)) throw new Error(`Unknown layer: ${name}`);
      sliderGain(value);
      instruments.setLevel?.(name, value); // optional wie setTempo
    },
    setMaster(value) {
      sliderGain(value);
      instruments.setMaster?.(value);
    },
    // Ereignisstrom live tauschen (z. B. nach einem Schlagwort mit Mustereffekt): ab dem nächsten noch nicht geplanten Ereignis
    // spielt der neue Strom, schon geplante Töne laufen weiter. Die Liedzeit der Ereignisse bezieht sich auf das Starttempo (das
    // bpm des übergebenen Tracks zählt nicht; Tempowechsel macht setTempo). false ohne Änderung, wenn der Player gestoppt ist oder
    // sich Länge, Taktlängen (damit die Dauer eines Durchlaufs) oder die Taktart (auch bei gleicher Dauer, etwa 4/4 zu 12/8) ändern;
    // ein ungültiger Track wirft wie buildEvents. Groove und Komplexität bei gleicher Taktart tauschen den Strom.
    setTrack(newTrack) {
      if (stopped) return false;
      const next2 = buildEvents({ ...newTrack, bpm });
      const t2 = normalizeTrack({ ...newTrack, bpm });
      let sec = 0;
      for (let i = 0; i < t2.length; i++) sec += (t2.bars[i % t2.bars.length].beats * 60) / bpm;
      if (t2.length !== loopBars || Math.abs(sec - loopSec) > 1e-9 || meterKey(t2.meter) !== startMeter) return false;
      // gleichzeitige Ereignisse plant ein Planerlauf zusammen: was bis tLast geplant ist, wird nicht wiederholt
      const tLast = next > 0 ? events[next - 1].t : -Infinity;
      events = next2;
      next = events.findIndex((e) => e.t > tLast);
      if (next < 0) next = events.length;
      return true;
    },
    // Klang live umstellen (siehe createInstruments in synth.js); nach stop() ohne Wirkung
    setTimbre(timbre) {
      if (!stopped) instruments.setTimbre?.(timbre);
    },
    setTempo(newBpm) {
      if (!(Number.isFinite(newBpm) && newBpm >= 20 && newBpm <= 400)) throw new RangeError(`bpm must be in [20, 400], got ${newBpm}`);
      // Anker nicht vor das zuletzt geplante Ereignis: geplante Ereignisse behalten ihre Zeit, nichts wird umgeordnet
      const pivot = Math.max(ctx.currentTime, anchor.ctx, lastCtx);
      anchor = { song: anchor.song + (pivot - anchor.ctx) * rate, ctx: pivot };
      rate = newBpm / bpm;
      instruments.setTempo?.(newBpm); // optional: eigene Instrumente ohne setTempo bleiben gültig
    },
  };
}
