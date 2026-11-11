// Die 9 Teile eines Profils: aus der Sitzung festhalten (captureParts), aus fremden Daten bereinigen (sanitizeParts) und auf eine
// Sitzung anwenden (applyParts). Reine Logik ohne DOM und Audio; die Sitzung hat die Form des Oberflächenzustands
// { track, scale, style, chordColor, chordColorFromStyle, mix } (src/ui/state.js).
import { normalizeTrack, validateTrack } from './track.js';
import { isValidKey, SCALE_NAMES, SCALE_MODE } from './music.js';
import { isMeter, meterKey, convertTempo, METERS, GROOVES } from './grooves.js';
import { isVoice, completeVoices, VOICE_LAYERS } from './voices.js';
import { isJob, completeJobs, LAYER_IDS } from './layers.js';
import { STYLE_PRESETS } from './tags.js';
import { CHORD_COLORS } from './harmony.js';
import { DEFAULT_TIMBRE } from './timbre.js';

/** Teile in der Reihenfolge der Oberfläche. */
export const PART_IDS = Object.freeze(['harmony', 'tempo', 'rhythm', 'style', 'sound', 'voices', 'layers', 'mixer', 'variant']);
export const PART_PRESETS = Object.freeze({
  all: PART_IDS,
  sound: Object.freeze(['sound', 'voices', 'mixer']),
  rhythm: Object.freeze(['tempo', 'rhythm']),
  none: Object.freeze([]),
});

const MIX_NAMES = [...LAYER_IDS, 'master'];
const FORBIDDEN = ['__proto__', 'constructor', 'prototype'];
const MAX_SEED = 4294967295;
const MAX_BARS = 512;

// ---------- festhalten ----------

const CAPTURE = {
  harmony: ({ track: t, scale, chordColor, chordColorFromStyle }) => ({ key: t.key, scale, bars: t.bars, chordColor, chordColorFromStyle, meter: t.meter }),
  tempo: ({ track: t }) => ({ bpm: t.bpm, meter: t.meter }), // bpm zählt den Puls dieser Taktart (applyParts rechnet um)
  rhythm: ({ track: t }) => ({ groove: t.groove ?? null, complexity: t.complexity ?? null, length: t.length }),
  style: ({ track: t, style }) => ({ style, tags: t.tags }),
  sound: ({ track: t }) => ({ timbre: t.timbre ?? {} }),
  // vollständig (auch die Standardwerte): Laden mischt je Schlüssel, ein leeres Objekt könnte den Standard nie zurückholen
  voices: ({ track: t }) => ({ voices: completeVoices(t.voices), jobs: completeJobs(t.jobs) }),
  layers: ({ track: t }) => ({ layers: t.layers }),
  mixer: ({ mix }) => ({ mix }),
  variant: ({ track: t }) => ({ seed: t.seed, variety: t.variety }),
};

/** Sitzung -> Teile (tiefe Kopie, in PART_IDS-Reihenfolge). Nicht gesetzte groove/complexity werden null ("Standard"). */
export function captureParts(session, ids = PART_IDS) {
  return structuredClone(Object.fromEntries(PART_IDS.filter((id) => ids.includes(id)).map((id) => [id, CAPTURE[id](session)])));
}

// ---------- bereinigen ----------

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const num01 = (v) => typeof v === 'number' && v >= 0 && v <= 1; // NaN und Infinity fallen durch
// Prüfung eines einzelnen Track-Felds mit validateTrack auf einem Mindest-Track (nur für schon geprüfte einfache Werte)
const BASE = { key: { root: 'A', mode: 'minor' }, bpm: 100, bars: [{ chord: { root: 'A', quality: 'min' }, beats: 4 }] };
const trackOk = (patch, code) => !validateTrack(normalizeTrack({ ...BASE, ...patch })).some((e) => e.code === code);

// harmony ist unteilbar: Tonart, Takte und Taktart müssen zusammen einen gültigen Teil-Track ergeben
function cleanHarmonyCore(h) {
  try {
    if (!isValidKey(h.key) || !isMeter(h.meter) || !Array.isArray(h.bars) || h.bars.length > MAX_BARS) return null;
    const key = { root: h.key.root, mode: h.key.mode };
    const meter = [h.meter[0], h.meter[1]];
    const bars = h.bars.map((b) => ({ chord: { root: b.chord.root, quality: b.chord.quality }, beats: b.beats }));
    if (!bars.every((b) => b.beats === METERS[meterKey(meter)].beats)) return null;
    if (validateTrack(normalizeTrack({ key, bars, meter, bpm: BASE.bpm })).length) return null;
    return { key, bars, meter };
  } catch { return null; }
}

/** Beliebige Daten -> { parts, skipped }. Wirft nie; Ungültiges fällt feldweise weg und wird in `skipped` gezählt. */
export function sanitizeParts(raw) {
  try { return sanitize(raw); } catch { return { parts: {}, skipped: 1 }; } // werfende Getter oder Proxys
}

function sanitize(raw) {
  let skipped = 0;
  const bad = () => { skipped++; };
  // eigene Einträge ohne die Schlüssel, die den Prototyp erreichen könnten (die zählen als ungültig); Nullprototyp: Zugriffe sind sicher
  const fields = (o) => {
    const out = Object.create(null);
    for (const [k, v] of Object.entries(o)) { if (FORBIDDEN.includes(k)) bad(); else out[k] = v; }
    return out;
  };
  // Wörterbuch { id: Wert }: nur bekannte ids, jeder Eintrag einzeln geprüft; unbekannte ids werden still ignoriert
  const dict = (rawDict, ids, ok, pick = (v) => v) => {
    if (!isPlain(rawDict)) { bad(); return undefined; }
    const d = fields(rawDict);
    const out = {};
    for (const id of ids) if (id in d) { if (ok(d[id], id)) out[id] = pick(d[id], id); else bad(); }
    return out;
  };
  const nonEmpty = (o) => o !== undefined && Object.keys(o).length > 0;
  const voiceOk = (v, layer) => {
    if (typeof v === 'string') return isVoice(layer, v);
    if (!isPlain(v)) return false;
    const r = fields(v);
    return isVoice(layer, r.id, r.variant);
  };
  const voicePick = (v) => {
    if (typeof v === 'string') return { id: v };
    return v.variant === undefined ? { id: v.id } : { id: v.id, variant: v.variant };
  };

  const CLEAN = {
    harmony(f, out) {
      const core = cleanHarmonyCore(f);
      if (!core) return bad();
      Object.assign(out, core);
      for (const [name, ok] of [['scale', (v) => SCALE_NAMES.includes(v)], ['chordColor', (v) => CHORD_COLORS.includes(v)], ['chordColorFromStyle', (v) => typeof v === 'boolean']]) {
        if (name in f) { if (ok(f[name])) out[name] = f[name]; else bad(); }
      }
    },
    tempo(f, out) {
      if ('bpm' in f) { if (typeof f.bpm === 'number' && trackOk({ bpm: f.bpm }, 'badBpm')) out.bpm = f.bpm; else bad(); }
      // die Taktart, in der bpm gilt; ohne bpm sagt sie nichts
      if ('meter' in f) { if (!isMeter(f.meter)) bad(); else if ('bpm' in out) out.meter = [f.meter[0], f.meter[1]]; }
    },
    rhythm(f, out) {
      if ('groove' in f) { if (f.groove === null || (typeof f.groove === 'string' && Object.hasOwn(GROOVES, f.groove))) out.groove = f.groove; else bad(); }
      if ('complexity' in f) { if (f.complexity === null || num01(f.complexity)) out.complexity = f.complexity; else bad(); }
      if ('length' in f) { if (typeof f.length === 'number' && trackOk({ length: f.length }, 'badLength')) out.length = f.length; else bad(); }
    },
    style(f, out) {
      if ('style' in f) { if (STYLE_PRESETS.some((p) => p.id === f.style)) out.style = f.style; else bad(); }
      if ('tags' in f) {
        let tags = null;
        try {
          if (isPlain(f.tags) && trackOk({ tags: f.tags }, 'badTags')) tags = Object.fromEntries(Object.entries(f.tags).map(([k, list]) => [k, [...list]]));
        } catch { /* ungültig */ }
        if (tags) out.tags = tags; else bad();
      }
    },
    sound(f, out) {
      if (!('timbre' in f)) return;
      if (!isPlain(f.timbre)) return bad();
      const groups = dict(f.timbre, Object.keys(DEFAULT_TIMBRE), isPlain, (g, group) => dict(g, Object.keys(DEFAULT_TIMBRE[group]), num01));
      // dict meldet Untergruppen, die keine Objekte sind, schon selbst; leere Gruppen weglassen
      const timbre = Object.fromEntries(Object.entries(groups).filter(([, g]) => nonEmpty(g)));
      // {} setzt beim Laden zurück: nur gültig, wenn es auch so gemeint war (leer angegeben), nicht wenn alles ungültig war
      if (nonEmpty(timbre) || Object.keys(f.timbre).length === 0) out.timbre = timbre;
    },
    voices(f, out) {
      if ('voices' in f) { const v = dict(f.voices, VOICE_LAYERS, voiceOk, voicePick); if (nonEmpty(v)) out.voices = v; }
      if ('jobs' in f) { const j = dict(f.jobs, LAYER_IDS, (v, layer) => isJob(layer, v)); if (nonEmpty(j)) out.jobs = j; }
    },
    layers(f, out) {
      if ('layers' in f) { const l = dict(f.layers, LAYER_IDS, (v) => typeof v === 'boolean'); if (nonEmpty(l)) out.layers = l; }
    },
    mixer(f, out) {
      if ('mix' in f) { const m = dict(f.mix, MIX_NAMES, num01); if (nonEmpty(m)) out.mix = m; }
    },
    variant(f, out) {
      if ('seed' in f) { if (Number.isInteger(f.seed) && f.seed >= 0 && f.seed <= MAX_SEED) out.seed = f.seed; else bad(); }
      if ('variety' in f) { if (typeof f.variety === 'boolean') out.variety = f.variety; else bad(); }
    },
  };

  const parts = {};
  if (!isPlain(raw)) return { parts, skipped: 1 };
  const top = fields(raw);
  for (const id of PART_IDS) {
    if (!(id in top)) continue;
    if (!isPlain(top[id])) { bad(); continue; }
    const out = {};
    CLEAN[id](fields(top[id]), out);
    if (Object.keys(out).length) parts[id] = out;
  }
  return { parts, skipped };
}

// ---------- anwenden ----------

const defaultScale = (mode) => Object.keys(SCALE_MODE).find((name) => SCALE_MODE[name] === mode);

/**
 * Teile auf eine Sitzung anwenden. Rein: die Eingabe bleibt unverändert; Ergebnis { ok: true, session } oder
 * { ok: false, errors } (validateTrack des zusammengesetzten Tracks). Werte von scale, style, chordColor und mix werden
 * hier nicht mehr geprüft: sanitizeParts ist das Tor.
 */
export function applyParts(session, parts) {
  const s = structuredClone(session);
  const p = structuredClone(parts ?? {});
  const t = s.track;
  const has = (o, k) => o[k] !== undefined;
  const { harmony: h, tempo, rhythm: r, style, sound, voices, layers, mixer, variant } = p;

  if (h) {
    if (h.key) {
      t.key = h.key;
      // Skala nur, wenn sie zum Modus der Tonart passt; sonst die Standardskala des Modus
      s.scale = Object.hasOwn(SCALE_MODE, h.scale) && SCALE_MODE[h.scale] === h.key.mode ? h.scale : defaultScale(h.key.mode);
    } else if (has(h, 'scale')) s.scale = h.scale;
    for (const k of ['meter', 'bars']) if (has(h, k)) t[k] = h[k];
    for (const k of ['chordColor', 'chordColorFromStyle']) if (has(h, k)) s[k] = h[k];
  }
  // bpm in der Taktart des Profils -> Taktart nach dem Laden (harmony ist schon angewendet); ohne meter (ältere Profile) wie gespeichert
  if (tempo && has(tempo, 'bpm')) t.bpm = has(tempo, 'meter') ? convertTempo(tempo.bpm, meterKey(tempo.meter), meterKey(t.meter)) : tempo.bpm;
  if (r) {
    for (const k of ['groove', 'complexity']) if (has(r, k)) { if (r[k] === null) delete t[k]; else t[k] = r[k]; }
    if (has(r, 'length')) t.length = r.length;
  }
  if (style) {
    if (has(style, 'style')) s.style = style.style;
    if (has(style, 'tags')) t.tags = style.tags;
  }
  if (sound && has(sound, 'timbre')) t.timbre = sound.timbre;
  if (voices) {
    if (has(voices, 'voices')) t.voices = { ...t.voices, ...voices.voices };
    if (has(voices, 'jobs')) t.jobs = { ...t.jobs, ...voices.jobs };
  }
  if (layers && has(layers, 'layers')) t.layers = { ...t.layers, ...layers.layers };
  if (mixer && has(mixer, 'mix')) s.mix = { ...s.mix, ...mixer.mix };
  if (variant) for (const k of ['seed', 'variety']) if (has(variant, k)) t[k] = variant[k];

  const errors = validateTrack(normalizeTrack(t));
  return errors.length ? { ok: false, errors } : { ok: true, session: s };
}

// ---------- Hilfen ----------

/** Welche Teile ein Profil hat, in PART_IDS-Reihenfolge. */
export const partIdsOf = (parts) => PART_IDS.filter((id) => parts != null && Object.hasOwn(parts, id));

/** Teile aus `over` ersetzen die in `base`, die anderen bleiben (neue Kopie). */
export function mergeParts(base, over) {
  const out = {};
  for (const id of PART_IDS) {
    if (Object.hasOwn(over ?? {}, id)) out[id] = over[id];
    else if (Object.hasOwn(base ?? {}, id)) out[id] = base[id];
  }
  return structuredClone(out);
}
