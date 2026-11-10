// Sampler: lädt Sample-Packs (siehe scripts/extract-samples.mjs) und spielt Noten daraus. Kein eigener Zustand außer den Zwischenspeichern;
// die Stimme (sample.js) entscheidet, wann geladen wird und was bis dahin spielt.
import { pickZone, playbackRate, dbToGain } from './sample-zones.js';

const LOAD_TIMEOUT_MS = 30_000;
const loading = new Map(); // id -> Promise<Pack> (laufende und fertige Ladevorgänge, je Seite einmal)
const loaded = new Map(); // id -> Pack (fertig; erlaubt ein synchrones Nachsehen, damit ein bekanntes Pack ohne Verzögerung bereit ist)
const decoded = new WeakMap(); // AudioContext -> WeakMap(Pack -> AudioBuffer[])

/** Das Pack, wenn es schon geladen ist, sonst undefined. */
export const peekPack = (id) => loaded.get(id);

/**
 * Lädt <id>.json und <id>.pcm aus src/assets/samples/. Je Seite einmal, auch parallel wartende Aufrufer teilen sich den Vorgang; ein Fehler
 * (kein Netz, 404, kaputte Datei) wird nicht zwischengespeichert, ein neuer Aufruf versucht es erneut. Pack: { meta, pcm: Int16Array }.
 */
export function loadPack(id) {
  if (!loading.has(id)) {
    const base = new URL(`../../assets/samples/${id}`, import.meta.url).href;
    const promise = (async () => {
      const signal = AbortSignal.timeout(LOAD_TIMEOUT_MS); // ein hängender Abruf soll nicht ewig auf whenReady warten lassen
      const [metaResponse, pcmResponse] = await Promise.all([fetch(`${base}.json`, { signal }), fetch(`${base}.pcm`, { signal })]);
      if (!metaResponse.ok || !pcmResponse.ok) throw new Error(`Sample pack ${id}: HTTP ${metaResponse.status} / ${pcmResponse.status}`);
      const meta = await metaResponse.json();
      const bytes = await pcmResponse.arrayBuffer();
      const last = meta.samples?.at(-1);
      if (!Array.isArray(meta.zones) || !Array.isArray(meta.samples) || !last || bytes.byteLength % 2 !== 0 || last.offset + last.frames * 2 > bytes.byteLength) throw new Error(`Sample pack ${id}: invalid`);
      const pack = { meta, pcm: new Int16Array(bytes) };
      loaded.set(id, pack);
      return pack;
    })();
    loading.set(id, promise);
    promise.catch(() => loading.delete(id));
  }
  return loading.get(id);
}

/** Die Samples des Packs als AudioBuffer (je Sample in seiner Rate), je Kontext einmal gebaut. */
export function buffersFor(ctx, pack) {
  let byPack = decoded.get(ctx);
  if (!byPack) decoded.set(ctx, (byPack = new WeakMap()));
  let list = byPack.get(pack);
  if (!list) {
    list = pack.meta.samples.map((s) => {
      const buffer = ctx.createBuffer(1, s.frames, s.rate);
      const data = buffer.getChannelData(0), from = s.offset / 2;
      for (let i = 0; i < s.frames; i++) data[i] = pack.pcm[from + i] / 32768;
      return buffer;
    });
    byPack.set(pack, list);
  }
  return list;
}

const FLOOR = 0.0001; // exponentielle Rampen brauchen Werte über 0
const MIN_RELEASE = 0.04; // s, kürzeres Ausklingen knackt
const MAX_RELEASE = 2; // s, die Presets haben bis zu 4,5 s (Pads würden in den nächsten Takt hängen)

/**
 * Spielt eine Note aus dem Pack: Zone nach Ton und Anschlag, Tonhöhe über die Abspielgeschwindigkeit, Schleife der Zone, Hüllkurve des
 * Presets (Einsatz, Halten, Abklingen auf den Haltepegel; am Notenende Ausklingen). `timeScale` streckt oder staucht die Zeiten der Hüllkurve,
 * `gain` ist der Pegel der Stimme, `filter` (Hz) ein Tiefpass danach (>= 20000: kein Filterknoten), `naturalDecay` (s bis -60 dB, 0 = aus) ein
 * zusätzliches Abklingen für gezupfte Instrumente: die Presets halten ihren Schleifenton fast ohne Abfall, das klänge bei langen Noten wie eine Orgel.
 * `eq` ({ lowDb, midDb, midHz, highDb, highHz }, oder null) entzerrt den Klang: Tiefenregal bei 200 Hz, Glocke bei midHz, Höhenregal ab highHz; Stufen
 * mit weniger als 0,05 dB entfallen; davor ein Hochpass bei 50 Hz. Nach dem Ausklingen stoppt die Quelle.
 */
export function playNote(ctx, out, t, { pack, midi, dur, vel, gain = 1, timeScale = 1, filter = 20000, naturalDecay = 0, eq = null }) {
  const zone = pickZone(pack.meta.zones, midi, vel);
  if (!zone) return;
  const sample = pack.meta.samples[zone.sample];
  const src = ctx.createBufferSource();
  src.buffer = buffersFor(ctx, pack)[zone.sample];
  src.playbackRate.value = playbackRate(zone, midi);
  if (zone.loop) { src.loop = true; src.loopStart = sample.loopStart / sample.rate; src.loopEnd = sample.loopEnd / sample.rate; }

  const velocity = Number.isFinite(vel) ? Math.min(1, Math.max(0, vel)) : 1; // ungültig zählt wie kräftig (wie bei der Zonenwahl)
  const peak = Math.max(FLOOR, gain * dbToGain(zone.attenuationDb) * velocity);
  const sustain = Math.max(FLOOR, peak * dbToGain(zone.sustainDb));
  const attack = Math.max(0.003, zone.attack * timeScale), decay = Math.max(0.001, zone.decay * timeScale);
  const release = Math.min(MAX_RELEASE, Math.max(MIN_RELEASE, zone.release * timeScale));
  const noteEnd = t + (Number.isFinite(dur) ? Math.max(0.02, dur) : 0.5);
  const g = ctx.createGain();
  // Hüllkurve bis zum Notenende (der Wert dort wird gerechnet, damit das Ausklingen an der richtigen Stelle beginnt)
  g.gain.setValueAtTime(FLOOR, t);
  const attackEnd = Math.min(t + attack, noteEnd);
  let level = Math.max(FLOOR, peak * ((attackEnd - t) / attack));
  g.gain.linearRampToValueAtTime(level, attackEnd);
  if (noteEnd > attackEnd) {
    const holdEnd = Math.min(attackEnd + zone.hold * timeScale, noteEnd);
    g.gain.setValueAtTime(level, holdEnd);
    if (noteEnd > holdEnd) {
      const decayEnd = Math.min(holdEnd + decay, noteEnd);
      level = decayEnd >= holdEnd + decay ? sustain : peak * (sustain / peak) ** ((decayEnd - holdEnd) / decay);
      g.gain.exponentialRampToValueAtTime(Math.max(FLOOR, level), decayEnd);
    }
  }
  g.gain.setValueAtTime(Math.max(FLOOR, level), noteEnd);
  g.gain.exponentialRampToValueAtTime(FLOOR, noteEnd + release);

  let node = src.connect(g);
  if (naturalDecay > 0) {
    const total = noteEnd + release - t, tail = ctx.createGain();
    tail.gain.setValueAtTime(1, t);
    tail.gain.exponentialRampToValueAtTime(Math.max(FLOOR, 10 ** ((-3 * total) / naturalDecay)), t + total);
    node = node.connect(tail);
  }
  if (eq) {
    // Hochpass bei 50 Hz: unter dem tiefsten Gitarrenton (E2, 82 Hz) liegt nichts Nutzbares, und das Tiefenregal hob dort Rumpeln über 1
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 50;
    node = node.connect(hp);
    for (const [type, frequency, dB, q] of [['lowshelf', 200, eq.lowDb, 0.7], ['peaking', eq.midHz, eq.midDb, 0.8], ['highshelf', eq.highHz, eq.highDb, 0.7]]) {
      if (!(Math.abs(dB) >= 0.05)) continue;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      f.gain.value = dB;
      f.Q.value = q;
      node = node.connect(f);
    }
  }
  if (filter < 20000) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = filter;
    node = node.connect(lp);
  }
  node.connect(out);
  src.start(t);
  src.stop(noteEnd + release + 0.05);
}
