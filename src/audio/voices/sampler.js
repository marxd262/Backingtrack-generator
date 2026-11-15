// Sampler: lädt Sample-Packs (siehe scripts/extract-samples.mjs) und spielt Noten daraus. Kein eigener Zustand außer den Zwischenspeichern;
// die Stimme (sample.js) entscheidet, wann geladen wird und was bis dahin spielt.
import { pickArtZone, playbackRate, dbToGain, zoneGain, zoneVelocity } from './sample-zones.js';

const LOAD_TIMEOUT_MS = 30_000;
const CACHE = 'backingtrack-samples'; // Cache API: Format-2-Audio (Dateiname mit Inhalts-Hash, also unveränderlich) bleibt über Besuche hinweg
const loading = new Map(); // id -> Promise<Pack> (laufende und fertige Ladevorgänge, je Seite einmal)
const loaded = new Map(); // id -> Pack (fertig; erlaubt ein synchrones Nachsehen, damit ein bekanntes Pack ohne Verzögerung bereit ist)
const decoded = new WeakMap(); // AudioContext -> WeakMap(Pack -> AudioBuffer[])

/** Das Pack, wenn es schon geladen ist, sonst undefined. */
export const peekPack = (id) => loaded.get(id);

/** Bytes einer unveränderlichen Datei: aus der Cache API, sonst aus dem Netz (und dann dort abgelegt, ältere Fassungen desselben Packs gelöscht). */
async function cachedBytes(url, prefix, signal) {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch { cache = null; } // ohne Cache API (unsicherer Ursprung, privater Modus, Node): nur das Netz
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  if (cache) cache.put(url, response.clone()).then(async () => { for (const old of await cache.keys()) if (old.url.startsWith(prefix) && old.url !== url) await cache.delete(old); }).catch(() => {});
  return response.arrayBuffer();
}

/** Format 2: eine FLAC-Datei mit allen Samples hintereinander (meta.rate, meta.channels), dekodiert ohne Umrechnung und in ein AudioBuffer je Sample geteilt. */
async function decodePack(meta, bytes) {
  const audio = await new OfflineAudioContext(meta.channels, 1, meta.rate).decodeAudioData(bytes);
  const last = meta.samples.at(-1);
  if (audio.numberOfChannels !== meta.channels || audio.sampleRate !== meta.rate || audio.length < last.offset + last.frames) throw new Error('decoded audio does not match');
  return meta.samples.map((s) => {
    const buffer = new AudioBuffer({ numberOfChannels: meta.channels, length: s.frames, sampleRate: meta.rate });
    for (let c = 0; c < meta.channels; c++) buffer.copyToChannel(audio.getChannelData(c).subarray(s.offset, s.offset + s.frames), c);
    return buffer;
  });
}

/**
 * Lädt <id>.json aus src/assets/samples/ und dazu das Audio: Format 1 <id>.pcm (16 Bit mono, roh), Format 2 (`meta.version` 2, scripts/import-sfz.mjs)
 * die FLAC-Datei `meta.file`, schon dekodiert. Je Seite einmal, auch parallel wartende Aufrufer teilen sich den Vorgang; ein Fehler
 * (kein Netz, 404, kaputte Datei) wird nicht zwischengespeichert, ein neuer Aufruf versucht es erneut. Pack: { meta, pcm: Int16Array } oder { meta, buffers: AudioBuffer[] }.
 */
export function loadPack(id) {
  if (!loading.has(id)) {
    const base = new URL(`../../assets/samples/${id}`, import.meta.url).href;
    const promise = (async () => {
      const signal = AbortSignal.timeout(LOAD_TIMEOUT_MS); // ein hängender Abruf soll nicht ewig auf whenReady warten lassen
      const metaResponse = await fetch(`${base}.json`, { signal });
      if (!metaResponse.ok) throw new Error(`Sample pack ${id}: HTTP ${metaResponse.status}`);
      const meta = await metaResponse.json();
      if (!Array.isArray(meta.zones) || !Array.isArray(meta.samples) || !meta.samples.length) throw new Error(`Sample pack ${id}: invalid`);
      let pack;
      if (meta.version === 2) {
        if (typeof meta.file !== 'string' || !/^[\w.-]+\.flac$/.test(meta.file)) throw new Error(`Sample pack ${id}: invalid file`);
        pack = { meta, buffers: await decodePack(meta, await cachedBytes(new URL(meta.file, base).href, `${base}.`, signal)) };
      } else {
        const pcmResponse = await fetch(`${base}.pcm`, { signal });
        if (!pcmResponse.ok) throw new Error(`Sample pack ${id}: HTTP ${pcmResponse.status}`);
        const bytes = await pcmResponse.arrayBuffer(), last = meta.samples.at(-1);
        if (bytes.byteLength % 2 !== 0 || last.offset + last.frames * 2 > bytes.byteLength) throw new Error(`Sample pack ${id}: invalid`);
        pack = { meta, pcm: new Int16Array(bytes) };
      }
      loaded.set(id, pack);
      return pack;
    })();
    loading.set(id, promise);
    promise.catch(() => loading.delete(id));
  }
  return loading.get(id);
}

/** Die Samples des Packs als AudioBuffer (je Sample in seiner Rate), je Kontext einmal gebaut; Format 2 bringt sie schon dekodiert mit (für alle Kontexte). */
export function buffersFor(ctx, pack) {
  if (pack.buffers) return pack.buffers;
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
 * mit weniger als 0,05 dB entfallen; davor ein Hochpass bei 50 Hz. Nach dem Ausklingen stoppt die Quelle. `zone` (optional) spielt diese Zone statt
 * der nach Ton und Anschlag gewählten (Schläge: sample-hits.js). `cents` verstimmt zusätzlich. `oneShot` spielt nie die Schleife einer Zone mit
 * Schleife: das Sample klingt an seinem Ende aus (Zonen ohne Schleife bleiben unverändert); reicht die Note bis dahin, beginnt das Ausklingen spätestens `fadeOut` (s) vor dem Ende und endet mit ihm.
 * `art` (Artikulation, Namen aus SPEC_PHASE3 Abschnitt 2; nach Wissen gesetzt, nicht gehört). Reihenfolge: hat das Pack Zonen mit diesem `art`
 * (eigene Sample-Gruppe), spielt eine davon ohne die gerechnete Variante; sonst wird gerechnet; Unbekanntes spielt normal:
 *   slideIn gleitet in `artTime` s (Standard 0,08) von `artSemi` Halbtönen daneben (Standard -2) auf den Ton; der Ton beginnt so viel früher,
 *           dass er zum Zeitpunkt `t` ankommt (Regel: der Zielton kommt pünktlich). Reicht die Zeit bis `t` nicht (Planer mit 100 ms Vorausschau,
 *           allererster Ton), wird der Vorlauf kürzer; unter 20 ms beginnt der Slide auf dem Schlag
 *   bend    beginnt `artSemi` Halbtöne daneben (Standard -2), hält kurz (höchstens 40 ms) und zieht weich auf den Ton; `artTime` = Zeit vom
 *           Anschlag bis der Zielton erreicht ist (die Regeln setzen sie aus Raster und Notenlänge; höchstens die halbe Dauer), ohne sie höchstens 180 ms Zug;
 *           `artTone` (dB je Halbton, Standard 9, 0 = aus): ein Höhenregal ab 1800 Hz läuft mit, von -artTone·Halbtöne/2 auf +artTone·Halbtöne/2 dB
 *           (Urteil des Nutzers: 3 zu schwach, 9 besser). bend und vibrato spielen ohne das zusätzliche Abklingen der Stimme (naturalDecay)
 *   vibrato Einsatz nach `artTime` s (Standard 0,2, spätestens bei 40 % der Dauer; die Regeln setzen ihn aus Raster und Notenlänge), `artRate` Hz (Standard 5,5), Tiefe |artSemi| Halbtöne (Standard 0,15 = ±15 Cent),
 *           schwillt in 0,25 s an (nur Noten ab 0,3 s; Werte aus den Regeln statt ±25 Cent ab 30 %)
 *   scoop, slideChord   wie slideIn (kleiner Abstand, z. B. -0,5 bis -1 Halbton)
 *   fall, slideOff   rutscht in den letzten `artTime` s (Standard 0,2, höchstens 60 % der Dauer) um `artSemi` Halbtöne (Standard -2) ab und blendet dabei aus
 *   hammer, pull  ohne Anschlag: das Sample beginnt 30 ms später, Einsatz mindestens 20 ms, 15 % leiser
 *   dead    höchstens 50 ms lang, Tiefpass 900 Hz;   chuck  wie dead, höchstens 40 ms;   palmMute  Tiefpass 1600 Hz, Abklingen höchstens 0,5 s
 *   staccato, choke   die Dauer kommt aus dem Ereignis, das Ausklingen dauert 30 ms statt der Zeit der Zone (auch bei chuck)
 *   swell   blendet in `artTime` s ein (Pad)
 * `ring` (letRing, Arpeggio-Überlappung): der Ton wird nicht abgeschnitten, Ausklingen 2 s.
 */
export function playNote(ctx, out, t, { pack, midi, dur, vel, art, zone = pickArtZone(pack.meta.zones, midi, vel, art), gain = 1, timeScale = 1, filter = 20000, naturalDecay = 0, eq = null, cents = 0, oneShot = false, fadeOut = 0.15, artSemi, artTime, artTone = 9, artRate = 5.5, ring = false }) {
  if (!zone) return;
  let slideEnd = null; // Vorlauf des slideIn: Beginn vorziehen, das Notenende bleibt (auch mit eigenem Sample: der Zielton kommt pünktlich)
  const glideTime = artTime ?? 0.08;
  if (art === 'slideIn' || art === 'scoop' || art === 'slideChord') { const room = t - ctx.currentTime, lead = room > 0.02 ? Math.min(glideTime, room) : 0; if (lead) { slideEnd = t; t -= lead; dur += lead; } }
  if (zone.art) art = undefined; // eigene Samples für diese Artikulation: ohne die gerechnete Variante
  const glide = art === 'slideIn' || art === 'scoop' || art === 'slideChord';
  if (art === 'dead' || art === 'chuck') { dur = Math.min(dur, art === 'chuck' ? 0.04 : 0.05); filter = Math.min(filter, 900); }
  if (art === 'palmMute') { filter = Math.min(filter, 1600); naturalDecay = naturalDecay > 0 ? Math.min(naturalDecay, 0.5) : 0.5; }
  if (art === 'pull') art = 'hammer'; // Abzug wie Aufschlag: Folgeton ohne Anschlag
  if (art === 'hammer') gain *= 0.85;
  if (art === 'bend' || art === 'vibrato') naturalDecay = 0; // gezogene und bebende Töne brauchen Sustain: das zusätzliche Abklingen der Stimme entfällt
  const sample = pack.meta.samples[zone.sample];
  const src = ctx.createBufferSource();
  src.buffer = buffersFor(ctx, pack)[zone.sample];
  const rate = playbackRate(zone, midi) * 2 ** (cents / 1200);
  src.playbackRate.value = rate;
  if (zone.loop && !oneShot) { src.loop = true; src.loopStart = sample.loopStart / sample.rate; src.loopEnd = sample.loopEnd / sample.rate; }

  const velocity = zoneVelocity(zone, vel); // ungültig zählt wie kräftig (wie bei der Zonenwahl)
  const peak = Math.max(FLOOR, gain * zoneGain(zone.attenuationDb) * velocity);
  const sustain = Math.max(FLOOR, peak * dbToGain(zone.sustainDb));
  const attack = Math.max(art === 'swell' ? artTime ?? 0.5 : art === 'hammer' ? 0.02 : 0.003, zone.attack * timeScale), decay = Math.max(0.001, zone.decay * timeScale);
  let release = ring ? MAX_RELEASE : art === 'staccato' || art === 'choke' || art === 'chuck' ? 0.03 : Math.min(MAX_RELEASE, Math.max(MIN_RELEASE, zone.release * timeScale));
  let noteEnd = t + (Number.isFinite(dur) ? Math.max(0.02, dur) : 0.5);
  if (oneShot && zone.loop) { // ohne Schleife ist am Sample-Ende Stille: vorher ausklingen, statt abzureißen (Zonen ohne Schleife klingen wie bisher)
    const sampleEnd = t + sample.frames / sample.rate / rate;
    noteEnd = Math.min(noteEnd, Math.max(t + 0.02, sampleEnd - fadeOut));
    release = Math.min(release, Math.max(MIN_RELEASE, sampleEnd - noteEnd));
  }
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
  const span = noteEnd - t, semis = Number.isFinite(artSemi) ? artSemi : -2, from = rate * 2 ** (semis / 12);
  const hold = Math.min(0.04, 0.1 * span), bendStart = t + hold, ease = (x) => x * x * (3 - 2 * x);
  const bendTime = art === 'bend' && Number.isFinite(artTime) ? Math.max(0.02, Math.min(artTime, 0.5 * span) - hold) : Math.min(0.18, 0.35 * span);
  if (art === 'bend' && artTone > 0) { // Klangfarbe folgt dem Bend (Idee des Nutzers): die schlaffe Saite dunkler, die gespannte heller, zeitgleich mit der Tonhöhe
    const shelf = ctx.createBiquadFilter(), depth = (artTone * Math.abs(semis)) / 2, curve = new Float32Array(32);
    shelf.type = 'highshelf'; shelf.frequency.value = 1800;
    for (let i = 0; i < 32; i++) curve[i] = depth * (2 * ease(i / 31) - 1);
    shelf.gain.setValueAtTime(-depth, t);
    shelf.gain.setValueCurveAtTime(curve, bendStart, bendTime);
    node = node.connect(shelf);
  }
  if (art === 'fall' || art === 'slideOff') { // am Notenende abwärts rutschen und dabei ausblenden
    const start = noteEnd - Math.min(artTime ?? 0.2, 0.6 * span), fade = ctx.createGain();
    src.playbackRate.setValueAtTime(rate, start);
    src.playbackRate.exponentialRampToValueAtTime(from, noteEnd + 0.03);
    fade.gain.setValueAtTime(1, start);
    fade.gain.exponentialRampToValueAtTime(0.05, noteEnd);
    node = node.connect(fade);
  }
  node.connect(out);
  // Tonhöhen-Artikulationen über die Abspielgeschwindigkeit
  if (glide) { src.playbackRate.setValueAtTime(from, t); src.playbackRate.exponentialRampToValueAtTime(rate, slideEnd ?? t + Math.min(glideTime, span / 2)); }
  if (art === 'bend') { // weicher Verlauf (langsam los, schnell durch die Mitte, langsam ankommen) wie ein gezogener Finger, statt einer geraden Rampe
    const curve = new Float32Array(32);
    for (let i = 0; i < 32; i++) curve[i] = from * (rate / from) ** ease(i / 31);
    src.playbackRate.setValueAtTime(from, t);
    src.playbackRate.setValueCurveAtTime(curve, bendStart, bendTime);
  }
  if (art === 'vibrato' && span >= 0.3) {
    const start = Math.min(artTime ?? 0.2, 0.4 * span), length = span - start, depth = 100 * (Number.isFinite(artSemi) ? Math.abs(artSemi) : 0.15);
    const curve = new Float32Array(Math.ceil(length * 200));
    for (let i = 0; i < curve.length; i++) { const x = i / 200; curve[i] = rate * 2 ** ((depth * Math.min(1, x / 0.25) * Math.sin(2 * Math.PI * artRate * x)) / 1200); }
    src.playbackRate.setValueCurveAtTime(curve, t + start, length);
  }
  src.start(t, art === 'hammer' ? Math.min(0.03, sample.frames / sample.rate / 2) : 0);
  src.stop(noteEnd + release + 0.05);
  return g; // Hüllkurve der Note, damit der Aufrufer sie vorzeitig abwürgen kann (Hi-Hat-Choke, sample-hits.js)
}
