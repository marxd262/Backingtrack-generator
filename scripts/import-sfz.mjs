// Importiert SFZ-Libraries (WAV/FLAC, auch ARIA-Mappings mit #include, #define und Mikrofon-Kanälen) in Sample-Packs im Format 2:
// <id>.json (Zonen), <id>.<hash>.flac (alle Samples hintereinander, 16 Bit, 44,1 kHz, mono oder stereo) und LICENSE-<id>.md.
// Nur zum Bauen der Packs (braucht ffmpeg); zur Laufzeit lädt src/audio/voices/sampler.js die Dateien.
//
// Aufruf: node scripts/import-sfz.mjs <ordner-der-library> <pack-id> [ausgabeordner]   (Standard: src/assets/samples)
// Die Library liegt außerhalb des Repos (z. B. C:\dev\samples-raw\muldjord); was je Pack gewählt wird, steht in SFZ_PACKS.
//
// Gelesen wird der Standard-Mix, wie ihn ein SFZ-Player ohne MIDI-Steuerung spielt: Controller auf set_cc/set_hdcc (sonst 0, Lautstärke 100,
// Panorama Mitte), Keyswitches auf sw_default; Regionen, die nur ein Controller auslöst (on_locc), fallen weg. Regionen mit gleicher Taste,
// gleichem Anschlag, gleichem Round-Robin und gleichem Trigger klingen zusammen (Mikrofone) und werden zu einem Sample gemischt, getrennt
// nach Direkt und Raum (spec.room). Lautstärke, Panorama und Pegelverhältnisse der Library stecken danach im Audio (ein Faktor für das ganze
// Pack auf -1 dBFS Spitze, kein Normalisieren je Sample); die Anschlagkurve (amp_velcurve_N, amp_veltrack) steht als velGain an der Zone.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RATE = 44100;
const MAX_MB = 12; // Grenze je Pack (Nutzer, 2026-11-15)

// Je Pack: sfz (Pfad in der Library), Angaben für Lizenzdatei und Credits, Auswahl.
//   hits: Schlagname -> Taste der Library (Schlagzeug); keys: [tiefste, höchste] Taste (Töne)
//   select: { name|default: [Anschlagstufen, Round-Robins] }, seconds: { name|default: höchstens s } (Töne: Zahl)
//   room / skip: Muster für Sample-Pfade (Raum-Mikrofone als eigenes Sample; Kanäle, die nicht hineingehören)
//   mirror: links und rechts tauschen (die App legt das Kit aus Sicht des Publikums, Hi-Hat rechts); trimDb: { name: dB } Pegel einzelner Schläge
//   art: [[Muster, art]] Sample-Gruppen für Artikulationen; releases: Round-Robins der Release-Samples (0 = keine)
export const SFZ_PACKS = {
  'drums-muldjord': {
    sfz: 'DrumGizmo/MuldjordKit/Stereo/DrumGizmo MuldjordKit.sfz',
    title: 'MuldjordKit v1.0 (SFZ)', author: 'Lars Muldjord (Aufnahme), kinwie (SFZ-Mapping)', license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', url: 'https://github.com/sfzinstruments/DrumGizmo.MuldjordKit', licenseFile: 'LICENSE',
    channels: 2, mirror: true,
    // Data/keymap.txt: Kick rechts 36, Snare 38, 37 "SnareRest" (Stock auf dem Fell; als sideStick, nach Gehör zu prüfen), Toms 48/47/45/41,
    // Hi-Hat 42/46, Ride rechts 51 mit Glocke 53, Crash links 49. Eine getretene oder halboffene Hi-Hat hat das Kit nicht.
    hits: { kick: 36, snare: 38, sideStick: 37, hat: 42, openHat: 46, tomHigh: 48, tomMid: 45, tomLow: 41, crash: 49, ride: 51, rideBell: 53 },
    room: /-Amb[LR]\.flac$/i,
    skip: /-Trigger\.flac$/i, // Triggersignal der Kick (DrumGizmo-Kanal 16), kein Mikrofon
    select: { default: [3, 2], kick: [4, 3], snare: [4, 4], hat: [4, 4], sideStick: [2, 2] },
    // Crash nur über Overheads und Raum: 3,2 dB leiser als der Crash der anderen Kits (rms der ersten Sekunde bei vel 0,8; die sind seit 2026-11-12 auf ±3 dB gleich)
    trimDb: { crash: 3 },
    seconds: { default: 1.2, kick: 0.8, snare: 1, sideStick: 0.5, hat: 0.5, crash: 2.5, ride: 2, rideBell: 2 },
  },
};

// ---------- SFZ lesen ----------

const DIRECTIVE = /#include\s+"([^"]+)"|#define\s+(\$[A-Za-z0-9_]+)\s+(\S+)/g;

/**
 * Text der SFZ-Datei mit allen #include (Pfade relativ zur Hauptdatei) und #define (in Reihenfolge, auch mehrere je Zeile; $NAME wird durch den
 * längsten definierten Namen ersetzt, mit dem das Wort beginnt: $MIC_$ART ist $MIC, "_", $ART). Kommentare entfernt.
 */
export function expandSfz(mainPath, read = (p) => readFileSync(p, 'utf8')) {
  const root = dirname(mainPath), defines = new Map();
  let names = [];
  const subst = (s) => s.replace(/\$[A-Za-z0-9_]+/g, (word) => {
    const name = names.find((n) => word.startsWith(n));
    return name ? defines.get(name) + word.slice(name.length) : word;
  });
  const expand = (path) => {
    const text = read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    let out = '', last = 0;
    for (const m of text.matchAll(DIRECTIVE)) {
      out += subst(text.slice(last, m.index));
      if (m[1]) out += `\n${expand(resolve(root, subst(m[1]).replace(/\\/g, '/')))}\n`;
      else { defines.set(m[2], subst(m[3])); names = [...defines.keys()].sort((a, b) => b.length - a.length); }
      last = m.index + m[0].length;
    }
    return out + subst(text.slice(last));
  };
  return expand(mainPath);
}

const ADDITIVE = { global_volume: 'volume', master_volume: 'volume', group_volume: 'volume', global_amplitude: 'amplitude', master_amplitude: 'amplitude', group_amplitude: 'amplitude' };

/** Regionen mit allen geerbten Opcodes (control, global, master, group, region) aus dem erweiterten Text. Lautstärke-Stufen addieren sich. */
export function parseSfz(text) {
  const control = {}, regions = [];
  let global = {}, master = {}, group = {}, current = {};
  for (const [, header, body] of text.matchAll(/(?:<(\w+)>)?([^<]*)/g)) {
    if (header === 'control') current = control;
    else if (header === 'global') current = global = {}, master = {}, group = {};
    else if (header === 'master') current = master = {}, group = {};
    else if (header === 'group') current = group = {};
    else if (header === 'region') regions.push({ levels: [global, master, group], own: (current = {}) });
    else if (header) current = {}; // <curve>, <effect>, <midi>: nicht ausgewertet
    const ops = [...body.matchAll(/(?<=^|\s)([A-Za-z0-9_]+)=/g)];
    ops.forEach((m, i) => { current[m[1]] = body.slice(m.index + m[0].length, ops[i + 1]?.index ?? body.length).trim(); });
  }
  return {
    control,
    regions: regions.map(({ levels, own }) => {
      const r = {};
      for (const level of [...levels, own]) for (const [k, v] of Object.entries(level)) {
        const sum = ADDITIVE[k] ?? (k === 'volume' || k === 'amplitude' ? k : null);
        if (sum === 'volume') r.volume = (r.volume ?? 0) + Number(v);
        else if (sum === 'amplitude') r.amplitude = (r.amplitude ?? 100) * Number(v) / 100;
        else r[k] = v;
      }
      return r;
    }),
  };
}

const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/** Taste als Zahl oder Notenname (c4 = 60, c#4, db4). */
export function keyNumber(v) {
  if (v === undefined) return undefined;
  if (/^-?\d+$/.test(v)) return Number(v);
  const m = /^([a-g])([#b]?)(-?\d+)$/i.exec(v);
  if (!m) throw new Error(`Taste "${v}" unbekannt`);
  return NOTE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1);
}

// Eingebaute Kurven der ARIA-Player für *_curveccN
const CURVES = [(x) => x, (x) => 2 * x - 1, (x) => 1 - x, (x) => 1 - 2 * x, (x) => x * x, (x) => Math.sqrt(x), (x) => Math.sqrt(1 - x)];

/** Controller-Werte 0..1 aus <control> (set_ccN: 0..127, set_hdccN: 0..1); ohne Angabe 0, nur Lautstärke (7) 100 und Panorama (10) Mitte. */
export function controllers(control) {
  const cc = new Map([[7, 100 / 127], [10, 0.5], [11, 1]]);
  for (const [k, v] of Object.entries(control)) {
    const m = /^set_(hd)?cc(\d+)$/.exec(k);
    if (m) cc.set(Number(m[2]), m[1] ? Number(v) : Number(v) / 127);
  }
  return cc;
}

/** Anschlagkurve der Region bei vel (0..127): amp_velcurve_N-Punkte (linear dazwischen, 0 bei 0 und 1 bei 127, wenn nicht gesetzt), sonst (vel/127)², gemischt mit amp_veltrack (%). */
export function velAmp(r, vel) {
  const points = new Map([[0, 0], [127, 1]]);
  let own = false;
  for (const [k, v] of Object.entries(r)) { const m = /^amp_velcurve_(\d+)$/.exec(k); if (m) { points.set(Number(m[1]), Number(v)); own = true; } }
  let curve = (vel / 127) ** 2;
  if (own) {
    const p = [...points].sort((a, b) => a[0] - b[0]), i = Math.max(1, p.findIndex(([x]) => x >= vel));
    const [[x0, y0], [x1, y1]] = [p[i - 1], p[Math.min(i, p.length - 1)]];
    curve = x1 > x0 ? y0 + ((y1 - y0) * (vel - x0)) / (x1 - x0) : y1;
  }
  return 1 - (Number(r.amp_veltrack ?? 100) / 100) * (1 - curve);
}

const KNOWN = new Set(['sample', 'key', 'lokey', 'hikey', 'pitch_keycenter', 'pitch_keytrack', 'lovel', 'hivel', 'lorand', 'hirand', 'seq_length', 'seq_position', 'trigger',
  'rt_decay', 'volume', 'amplitude', 'pan', 'tune', 'transpose', 'ampeg_attack', 'ampeg_release', 'group', 'off_by', 'off_time', 'loop_mode', 'loop_start', 'loop_end',
  'offset', 'end', 'amp_veltrack', 'sw_last', 'sw_default', 'default_path', 'note_offset', 'octave_offset', 'phase']);
// Ausgewertet, aber nicht in KNOWN: Controller-Bedingungen und -Modulation, Anschlagkurve. Ohne Wirkung auf den Standard-Mix: Namen, Stimmenzahl
const IGNORED_SILENTLY = /_label$|^label_cc|^set_(hd)?cc|polyphony$|^(lo|hi)cc\d+$|^on_(lo|hi)cc\d+$|^(amplitude|volume|pan)_(on)?(cc|curvecc)\d+$|^amp_velcurve_\d+$/;

/**
 * Regionen, die im Standardzustand klingen, mit ausgewerteten Werten: Tasten, Anschlag, Round-Robin (seq_position oder lorand), Trigger
 * (attack oder release), linearer Pegel und Panorama (-100..100) samt Controller-Modulation, Pfad des Samples. Dazu die Liste nicht ausgewerteter Opcodes.
 */
export function defaultRegions({ control, regions }, sfzDir) {
  const cc = controllers(control), ignored = new Set();
  const offset = Number(control.note_offset ?? 0) + 12 * Number(control.octave_offset ?? 0);
  const ccOf = (n) => cc.get(Number(n)) ?? 0;
  const out = [];
  for (const r of regions) {
    for (const k of Object.keys(r)) if (!KNOWN.has(k) && !IGNORED_SILENTLY.test(k)) ignored.add(k);
    if (!r.sample || r.sample.startsWith('*')) continue;
    const trigger = r.trigger ?? 'attack';
    if (!['attack', 'first', 'release', 'release_key'].includes(trigger)) continue;
    if (Object.keys(r).some((k) => /^on_(lo|hi)cc\d+$/.test(k))) continue;
    let active = true;
    for (const [k, v] of Object.entries(r)) {
      const m = /^(lo|hi)cc(\d+)$/.exec(k);
      if (m) { const value = Math.round(ccOf(m[2]) * 127); if (m[1] === 'lo' ? value < Number(v) : value > Number(v)) active = false; }
    }
    if (r.sw_last !== undefined && (r.sw_default === undefined || keyNumber(r.sw_last) !== keyNumber(r.sw_default))) active = false;
    if (!active) continue;
    // phase=invert: umgepoltes Mikrofon (Snare unten), sonst löschen sich die Mikrofone in der Summe teilweise aus
    let gain = 10 ** (Number(r.volume ?? 0) / 20) * (Number(r.amplitude ?? 100) / 100) * (r.phase === 'invert' ? -1 : 1), pan = Number(r.pan ?? 0);
    for (const [k, v] of Object.entries(r)) {
      const m = /^(amplitude|volume|pan)_oncc(\d+)$/.exec(k);
      if (!m) continue;
      const x = CURVES[Number(r[`${m[1]}_curvecc${m[2]}`] ?? 0)]?.(ccOf(m[2])) ?? ccOf(m[2]);
      if (m[1] === 'amplitude') gain *= (x * Number(v)) / 100;
      else if (m[1] === 'volume') gain *= 10 ** ((x * Number(v)) / 20);
      else pan += x * Number(v);
    }
    const key = keyNumber(r.key);
    const lokey = (keyNumber(r.lokey) ?? key ?? 0) + offset, hikey = (keyNumber(r.hikey) ?? key ?? 127) + offset;
    const center = (keyNumber(r.pitch_keycenter) ?? key ?? 60) + offset - Number(r.transpose ?? 0);
    const path = resolve(sfzDir, `${control.default_path ?? ''}${r.sample}`.replace(/\\/g, '/'));
    out.push({
      ...r, path, trigger: trigger.startsWith('release') ? 'release' : 'attack', lokey, hikey, center, gain, pan: Math.max(-100, Math.min(100, pan)),
      lovel: Number(r.lovel ?? 0), hivel: Number(r.hivel ?? 127), rr: Number(r.seq_position ?? r.lorand ?? 0),
    });
  }
  return { regions: out, ignored: [...ignored].sort() };
}

// ---------- Auswahl ----------

/** Teilt die nach Anschlag sortierten Bereiche in höchstens n zusammenhängende Gruppen (Anschlagstufen des Packs). */
export function binRanges(ranges, n) {
  const k = Math.min(n, ranges.length);
  return Array.from({ length: k }, (_, i) => ranges.slice(Math.round((i * ranges.length) / k), Math.round(((i + 1) * ranges.length) / k)));
}

/**
 * Zonen einer Gruppe gleich gespielter Regionen (eine Taste oder ein Tastenbereich, ein Trigger, eine Artikulation): je Anschlagstufe die
 * Round-Robins, bevorzugt aus dem lautesten Bereich der Stufe (gibt es dort zu wenige, aus den nächstleiseren). Jede Zone: Regionen, die zusammen klingen.
 */
export function selectZones(regions, [layers, roundRobins]) {
  const hits = new Map();
  for (const r of regions) { const k = `${r.lovel} ${r.hivel} ${r.rr}`; if (!hits.has(k)) hits.set(k, []); hits.get(k).push(r); }
  const ranges = [...new Set([...hits.values()].map(([r]) => `${r.lovel} ${r.hivel}`))].map((s) => s.split(' ').map(Number)).sort((a, b) => a[0] - b[0]);
  return binRanges(ranges, layers).flatMap((bin) => {
    const inBin = [...hits.values()].filter(([r]) => bin.some(([lo, hi]) => r.lovel === lo && r.hivel === hi)).sort(([a], [b]) => b.hivel - a.hivel || a.rr - b.rr);
    const velLo = Math.min(...bin.map(([lo]) => lo)), velHi = Math.max(...bin.map(([, hi]) => hi));
    return inBin.slice(0, roundRobins).map((sounding) => ({ velLo, velHi, regions: sounding }));
  });
}

/** Choke-Gruppen der Schläge: B wird von A abgewürgt, wenn ein off_by von B eine group von A ist (je Mikrofon eigene Nummern). Ergebnis: name -> { group, offBy, offTime }. */
export function chokeGroups(byName) {
  const names = Object.keys(byName), out = Object.fromEntries(names.map((n) => [n, {}]));
  const set = (name, key) => new Set(byName[name].map((r) => r[key]).filter((x) => x !== undefined));
  for (const victim of names) {
    const offBy = set(victim, 'off_by');
    const chokers = names.filter((n) => n !== victim && [...set(n, 'group')].some((g) => offBy.has(g)));
    if (!chokers.length) continue;
    const id = names.indexOf(chokers[0]) + 1;
    out[victim].offBy = id;
    out[victim].offTime = Number(byName[victim].find((r) => r.off_time !== undefined)?.off_time ?? 0.006);
    for (const c of chokers) { if (out[c].group && out[c].group !== id) console.warn(`Choke: ${c} würgt mehrere Gruppen ab, nur die erste bleibt`); out[c].group ??= id; }
  }
  return out;
}

// ---------- Audio ----------

/** Dekodiert eine Datei mit ffmpeg zu Float32 je Kanal (44,1 kHz). */
function decode(path) {
  const wav = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'wav', '-c:a', 'pcm_f32le', '-ar', String(RATE), '-'], { maxBuffer: 1 << 30 });
  let o = 12, channels = 1;
  while (o < wav.length - 8) {
    const id = wav.toString('ascii', o, o + 4), size = wav.readUInt32LE(o + 4);
    if (id === 'fmt ') channels = wav.readUInt16LE(o + 10);
    if (id === 'data') { o += 8; break; }
    o += 8 + size;
  }
  const all = new Float32Array(wav.buffer.slice(wav.byteOffset + o, wav.byteOffset + o + Math.floor((wav.length - o) / (4 * channels)) * 4 * channels));
  return Array.from({ length: channels }, (_, c) => all.filter((_, i) => i % channels === c));
}

/** Mischt die Regionen zu `channels` Kanälen: Pegel der Region, Panorama (mono gleiche Leistung, stereo Balance), offset/end der Region. */
function mix(regions, channels) {
  const out = Array.from({ length: channels }, () => new Float32Array(0));
  for (const r of regions) {
    let src = decode(r.path);
    const from = Number(r.offset ?? 0), to = r.end !== undefined ? Number(r.end) + 1 : src[0].length;
    src = src.map((ch) => ch.subarray(from, to));
    const p = r.pan / 100, angle = ((p + 1) * Math.PI) / 4;
    const gains = channels === 1 ? src.map(() => 1 / src.length)
      : src.length === 1 ? [[Math.cos(angle), Math.sin(angle)]] : [[Math.min(1, 1 - p), 0], [0, Math.min(1, 1 + p)]];
    for (let c = 0; c < channels; c++) {
      if (out[c].length < src[0].length) { const grown = new Float32Array(src[0].length); grown.set(out[c]); out[c] = grown; }
      src.forEach((ch, s) => { const g = r.gain * (channels === 1 ? gains[s] : gains[s][c]); if (g) for (let i = 0; i < ch.length; i++) out[c][i] += g * ch[i]; });
    }
  }
  return out;
}

/** Kürzt hinter dem letzten Wert über -60 dB der Spitze, höchstens auf `seconds`; die letzten 30 ms (höchstens ein Zehntel) blenden aus. */
function trim(chs, seconds) {
  let peak = 0, end = 0;
  for (const ch of chs) for (const x of ch) peak = Math.max(peak, Math.abs(x));
  for (const ch of chs) for (let i = ch.length - 1; i > end; i--) if (Math.abs(ch[i]) > peak * 1e-3) { end = i + 1; break; }
  const n = Math.max(1, Math.min(end, Math.round(seconds * RATE))), fade = Math.min(Math.round(0.03 * RATE), Math.floor(n / 10));
  return chs.map((ch) => { const o = ch.slice(0, n); for (let i = 0; i < fade; i++) o[n - 1 - i] *= i / fade; return o; });
}

// ---------- Pack bauen ----------

/** Baut das Pack `id` aus der Library; `spec` (Standard: SFZ_PACKS[id]) wie dort beschrieben. */
export function buildSfzPack(libDir, id, outDir, spec = SFZ_PACKS[id]) {
  if (!spec) throw new Error(`Pack ${id} steht nicht in SFZ_PACKS`);
  const sfzPath = resolve(libDir, spec.sfz);
  const { regions, ignored } = defaultRegions(parseSfz(expandSfz(sfzPath)), dirname(sfzPath));
  const usable = regions.filter((r) => !spec.skip?.test(r.path));
  const pick = (name) => spec.select[name] ?? spec.select.default, seconds = (name) => (typeof spec.seconds === 'number' ? spec.seconds : spec.seconds[name] ?? spec.seconds.default);

  // Gruppen: je Schlagname die Regionen seiner Taste; bei Tönen je Tastenbereich, Trigger und Artikulation
  const groups = [];
  if (spec.hits) {
    for (const [name, key] of Object.entries(spec.hits)) {
      const own = usable.filter((r) => r.trigger === 'attack' && r.lokey <= key && key <= r.hikey);
      if (!own.length) throw new Error(`${name}: keine Region auf Taste ${key}`);
      groups.push({ name, keyLo: key, keyHi: key, rootKey: key, trigger: 'attack', regions: own });
    }
  } else {
    const [lo, hi] = spec.keys, byKey = new Map();
    for (const r of usable) {
      if (r.hikey < lo || r.lokey > hi || (r.trigger === 'release' && !spec.releases)) continue;
      const art = spec.art?.find(([pattern]) => pattern.test(r.path))?.[1] ?? null, k = `${r.lokey} ${r.hikey} ${r.center} ${r.trigger} ${art}`;
      if (!byKey.has(k)) byKey.set(k, { name: art ?? r.trigger, keyLo: r.lokey, keyHi: r.hikey, rootKey: r.center, tuneCents: Number(r.tune ?? 0), trigger: r.trigger, art, regions: [] });
      byKey.get(k).regions.push(r);
    }
    groups.push(...byKey.values());
  }
  const chokes = spec.hits ? chokeGroups(Object.fromEntries(groups.map((g) => [g.name, g.regions]))) : {};

  // Audio je Zone: Direkt und (falls da) Raum als eigene Samples
  const audio = [], zones = [], report = {};
  for (const g of groups) {
    const choice = g.trigger === 'release' ? [1, spec.releases] : pick(g.name);
    for (const z of selectZones(g.regions, choice)) {
      const room = z.regions.filter((r) => spec.room?.test(r.path)), close = z.regions.filter((r) => !spec.room?.test(r.path));
      const gain = 10 ** ((spec.trimDb?.[g.name] ?? 0) / 20);
      const sampleOf = (rs) => { audio.push(trim(mix(rs, spec.channels), seconds(g.name)).map((ch) => ch.map((x) => x * gain))); return audio.length - 1; };
      const first = z.regions[0];
      zones.push({
        keyLo: g.keyLo, keyHi: g.keyHi, velLo: z.velLo, velHi: z.velHi, sample: sampleOf(close.length ? close : room), rootKey: g.rootKey, tuneCents: g.tuneCents ?? 0,
        loop: false, attenuationDb: 0, attack: Number(first.ampeg_attack ?? 0), hold: 0, decay: 0, release: Number(first.ampeg_release ?? 0.04), sustainDb: 0,
        // shortcut: velGain hat nur die zwei Randwerte (der Sampler rechnet linear dazwischen); bei breiten Stufen ohne amp_velcurve (Quadrat) Stützpunkte ergänzen
        velGain: [velAmp(first, z.velLo), velAmp(first, z.velHi)].map((x) => Math.round(x * 1e4) / 1e4),
        ...(g.trigger === 'release' && { trigger: 'release', rtDecay: Number(first.rt_decay ?? 0) }), ...(g.art && { art: g.art }),
        ...chokes[g.name], ...(close.length && room.length && { room: sampleOf(room) }),
      });
      const r = (report[g.name] ??= { zones: 0, layers: new Set(), mics: new Set() });
      r.zones++; r.layers.add(`${z.velLo}-${z.velHi}`);
      for (const x of z.regions) r.mics.add(x.path.split(/[\\/]/).pop().replace(/^\d+-[^-]+-/, '').replace(/\.\w+$/, ''));
    }
  }

  // Ein Faktor für das ganze Pack (Spitze -1 dBFS), 16 Bit, alles hintereinander, FLAC
  let peak = 0;
  for (const chs of audio) for (const ch of chs) for (const x of ch) peak = Math.max(peak, Math.abs(x));
  const scale = 10 ** (-1 / 20) / peak, frames = audio.reduce((n, chs) => n + chs[0].length, 0), C = spec.channels;
  const pcm = new Int16Array(frames * C), samples = [];
  let at = 0;
  for (const chs of audio) {
    const order = spec.mirror && C === 2 ? [chs[1], chs[0]] : chs;
    for (let i = 0; i < chs[0].length; i++) for (let c = 0; c < C; c++) pcm[(at + i) * C + c] = Math.round(Math.max(-1, Math.min(1, order[c][i] * scale)) * 32767);
    samples.push({ offset: at, frames: chs[0].length, rate: RATE, loopStart: 0, loopEnd: 0 });
    at += chs[0].length;
  }
  const tmp = join(mkdtempSync(join(tmpdir(), 'import-sfz-')), 'pack.flac'); // in eine Datei, damit ffmpeg den FLAC-Kopf mit der Länge zurückschreiben kann
  execFileSync('ffmpeg', ['-v', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', String(C), '-i', '-', '-c:a', 'flac', '-compression_level', '8', tmp], { input: Buffer.from(pcm.buffer), maxBuffer: 1 << 30 });
  const flac = readFileSync(tmp);
  rmSync(dirname(tmp), { recursive: true });
  const mb = flac.length / 1e6;
  for (const [name, r] of Object.entries(report)) console.log(`${name.padEnd(10)} ${String(r.zones).padStart(3)} Zonen, Stufen ${[...r.layers].join(' ')}, Mikrofone ${[...r.mics].join(' ')}`);
  console.log(`${id}: ${samples.length} Samples, ${zones.length} Zonen, ${(frames / RATE).toFixed(1)} s ${C === 2 ? 'stereo' : 'mono'}, FLAC ${mb.toFixed(2)} MB (PCM ${((frames * C * 2) / 1e6).toFixed(1)} MB), Pack-Faktor ${(20 * Math.log10(scale)).toFixed(1)} dB`);
  console.log(`nicht ausgewertet: ${ignored.join(' ') || '-'}`);
  if (mb > MAX_MB) throw new Error(`${id}: ${mb.toFixed(1)} MB über der Grenze von ${MAX_MB} MB, Auswahl verkleinern (select, seconds)`);

  const file = `${id}.${createHash('sha256').update(flac).digest('hex').slice(0, 10)}.flac`;
  for (const old of readdirSync(outDir)) if (old.startsWith(`${id}.`) && old.endsWith('.flac')) unlinkSync(join(outDir, old));
  writeFileSync(join(outDir, file), flac);
  const meta = { id, version: 2, source: spec.title, author: spec.author, license: spec.license, url: spec.url, file, rate: RATE, channels: C, ...(spec.hits && { keys: spec.hits }), samples, zones };
  writeFileSync(join(outDir, `${id}.json`), `${JSON.stringify(meta)}\n`);
  const changes = `Auswahl (${zones.length} Zonen aus ${regions.length} Regionen), Mikrofone nach dem Standard-Mix des Mappings gemischt${spec.room ? ' (Direkt und Raum getrennt)' : ''}${spec.mirror ? ', links und rechts getauscht' : ''}, gekürzt mit Ausblendung, ein Pegelfaktor für das ganze Pack, 16 Bit / 44,1 kHz, FLAC (scripts/import-sfz.mjs)`;
  writeFileSync(join(outDir, `LICENSE-${id}.md`), `# ${spec.title}\n\n- Urheber: ${spec.author}\n- Quelle: ${spec.url}\n- Lizenz: ${spec.license} (${spec.licenseUrl})\n- Verändert: ${changes}\n\n---\n\n${readFileSync(join(libDir, spec.licenseFile), 'utf8')}`);
  console.log(`geschrieben: ${join(outDir, file)}, ${id}.json, LICENSE-${id}.md`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [libDir, id, outDir = fileURLToPath(new URL('../src/assets/samples', import.meta.url))] = process.argv.slice(2);
  if (!libDir || !id) { console.error('Aufruf: node scripts/import-sfz.mjs <ordner-der-library> <pack-id> [ausgabeordner]'); process.exit(2); }
  buildSfzPack(resolve(libDir), id, resolve(outDir));
}
