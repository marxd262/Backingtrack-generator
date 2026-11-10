// Feinwerte der Stimmen (nur Stimmen, die welche haben): je Stimme `${instrument}/${id}/${variante}` eine Tabelle { Name: { min, max, step, value } }.
// `value` ist der ausgelieferte Standard. Die Hörprobe-Seite verstellt die Werte live (Tuning-Panel) und exportiert sie; was dort gut klingt,
// wird hier als neuer Standard eingetragen. Stimmen lesen den Wert beim Anschlag über tunedValue.

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
};

const spec = (min, max, step, value) => ({ min, max, step, value });
// Gemeinsame Namen der Saitenstimmen (Bedeutung: string-model.js STRING_DEFAULTS); die Startwerte sind nach bestem Wissen gesetzt und
// werden in der Hörprobe nach Gehör verändert. level gleicht den Pegel an den klassischen Synth an (gemessen, siehe voices-string-sound.spec.js).
export const TUNABLES = deepFreeze({
  'bass/string/finger': {
    pluckPos: spec(0, 0.5, 0.01, 0.28), brightness: spec(0, 1, 0.01, 0.45), decay: spec(0.2, 6, 0.05, 1.2), excite: spec(0, 1, 0.01, 0.25),
    stiffness: spec(0, 1, 0.01, 0.05), pickupPos: spec(0, 0.5, 0.01, 0.12), pickupLp: spec(500, 12000, 100, 2500), body: spec(0, 1, 0.01, 0.25),
    level: spec(0.5, 24, 0.1, 4.5),
  },
  'chords/string/electric': {
    pluckPos: spec(0, 0.5, 0.01, 0.15), brightness: spec(0, 1, 0.01, 0.6), decay: spec(0.2, 6, 0.05, 1.5), excite: spec(0, 1, 0.01, 0.7),
    stiffness: spec(0, 1, 0.01, 0.1), pickupPos: spec(0, 0.5, 0.01, 0.2), pickupLp: spec(500, 12000, 100, 4500), body: spec(0, 1, 0.01, 0.1),
    level: spec(0.2, 10, 0.05, 0.85), strum: spec(0, 0.05, 0.002, 0.012),
  },
  // Sample-Stimmen: level gleicht den Pegel an den klassischen Synth an (gemessen 2026-11-10, rms gegen den Synth bei level 1 und ohne zusätzliches Abklingen: bass finger 0.355, pick 0.350,
// guitar 1.46, epiano 0.567, strings 0.519, warm 0.861; mit den ausgelieferten Werten einschließlich decay 0.99 bis 1.01); strum staffelt Akkordtöne
  'bass/sample/finger': { level: spec(0.05, 8, 0.05, 4), decay: spec(0.2, 10, 0.1, 2.5) },
  'bass/sample/pick': { level: spec(0.05, 8, 0.05, 4.65), decay: spec(0.2, 10, 0.1, 2) },
  // Gitarre: Entzerrer gegen die nasale Mitte des Presets. Gemessen (volle FFT, dB relativ zu 317 bis 635 Hz): ohne Entzerrung liegen 1,6 bis 3,2 kHz bei +2 bis 0
  // dB, Synth bei -10 bis -23, Saitenmodell bei -19 bis -35; mit den Standardwerten bei -12 bis -16, die Tiefen unter 200 Hz fehlen im Preset und kommen teilweise zurück
  'chords/sample/guitar': {
    level: spec(0.05, 8, 0.05, 1.7), decay: spec(0.2, 10, 0.1, 3), strum: spec(0, 0.05, 0.002, 0.012),
    lowDb: spec(-12, 12, 0.5, 9), midDb: spec(-12, 6, 0.5, -12), midHz: spec(500, 5000, 50, 2400), highDb: spec(-12, 6, 0.5, -10), highHz: spec(1500, 8000, 100, 2600),
  },
  'chords/sample/epiano': { level: spec(0.05, 8, 0.05, 2.25), decay: spec(0.2, 10, 0.1, 3) },
  'pad/sample/strings': { level: spec(0.05, 8, 0.05, 1.95) },
  'pad/sample/warm': { level: spec(0.05, 8, 0.05, 1.15) },
  'chords/epiano/rhodes': {
    ratio: spec(0.5, 4, 0.01, 1), index: spec(0, 8, 0.05, 2.2), indexDecay: spec(0.05, 2, 0.01, 0.35), bell: spec(0, 1, 0.01, 0.2),
    bellRatio: spec(4, 20, 0.5, 14), decay: spec(0.2, 8, 0.1, 2.5), level: spec(0.1, 6, 0.05, 1.1),
  },
});

const isRecord = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Aktueller Wert von `name` für die Stimme `key`: der Standard aus TUNABLES, überschrieben durch `tuning[key][name]`, auf [min, max] begrenzt.
 * Unbekannter Schlüssel oder Name ergibt NaN (wirft nicht); ungültige Überschreibungen zählen nicht.
 */
export function tunedValue(key, name, tuning) {
  const spec = TUNABLES[key]?.[name];
  if (!spec) return NaN;
  const over = isRecord(tuning) && isRecord(tuning[key]) ? tuning[key][name] : undefined;
  const v = Number.isFinite(over) ? over : spec.value;
  return Math.min(spec.max, Math.max(spec.min, v));
}
