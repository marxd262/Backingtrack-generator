// Stimmparameter aus dem Klangmodell (core/timbre.js). Reine Rechnung ohne Audio-Objekte, damit in Node testbar.
// Beim neutralen Klangmodell ergeben sich exakt die bisherigen Konstanten der Stimmen.

// Stetig und monoton: x = 0 -> lo, 0.5 -> mid, 1 -> hi, dazwischen exponentiell (mid exakt bei 0.5)
const span = (x, lo, mid, hi) => (x < 0.5 ? mid * (lo / mid) ** (1 - 2 * x) : mid * (hi / mid) ** (2 * x - 1));

/** Bass: Timbre['bass'] (Felder 0..1) -> Parameter für bassNote in synth.js (neues Objekt je Aufruf). */
export function bassParams({ sub, fuzz, pluck, cutoff, resonance, roundness }) {
  // Grenzfrequenz: cutoff 0.35x..3x, sub senkt sie bis auf die Hälfte
  const tone = span(cutoff, 0.35, 1, 3) * (1 - 0.5 * sub);
  // sub nimmt den Obertonanteil zurück zugunsten des Sinus-Fundaments
  const harmonics = 1 - 0.6 * sub;
  return {
    sawDetune: 6, // Cent, je ein Oszillator bei -/+
    q: span(resonance, 1, 4, 14),
    lpStart: 2200 * tone * span(pluck, 0.5, 1, 2), // zupfender: tieferer Filterabfall
    lpEnd: 320 * tone,
    lpTime: span(pluck, 0.5, 0.15, 0.03) * span(resonance, 0.7, 1, 2.5), // zupfender: schneller; resonanter: langsamer
    sawMix: harmonics * (1 - roundness), // roundness blendet Sägezahn in Dreieck über
    triMix: harmonics * roundness,
    sineGain: (1 + 2 * sub) * span(resonance, 1.3, 1, 0.4), // resonanter: weniger Fundament, die Filterspitze tritt hervor
    drive: 1 + 19 * fuzz, // 1 = ohne Verzerrer
    peak: 0.5 / (1 + 1.2 * Math.tanh(6 * fuzz)), // Hüllkurvenspitze je Anschlagstärke; der Verzerrer hebt den Pegel schon bei wenig fuzz
    sustain: pluck > 0.5 ? 0.2 ** (2 * pluck - 1) : 1, // Pegel am Ende der Haltezeit relativ zur Spitze; zupfender klingt ab
    attack: 0.004,
    release: 0.05,
    holdMin: 0.03, // Haltezeit max(holdMin, dur - holdCut)
    holdCut: 0.06,
  };
}

/** Schlagzeug: Timbre['drums'] (Felder 0..1) -> Parameter für drumVoices in synth.js (neues Objekt je Aufruf). Toms bleiben unberührt. */
export function drumParams({ kickPunch, kickLength, snareTone, snareSnap, hatBright, hatLength, room }) {
  const hatTime = span(hatLength, 0.3, 1, 2.5); // Faktor auf beide Hi-Hat-Ausklänge
  return {
    kickStart: span(kickPunch, 110, 150, 260), // Hz
    kickEnd: 46 * span(kickLength, 1.15, 1, 0.8), // länger: tieferer Endton
    kickDrop: span(kickLength, 0.07, 0.12, 0.2), // länger: langsamerer Tonhöhenabfall
    kickDecay: span(kickLength, 0.15, 0.4, 0.9),
    kickPeak: 0.9 * span(kickLength, 1.1, 1, 0.75), // gleicht die längere Energie aus
    kickClick: 0.5 * Math.max(0, 2 * kickPunch - 1), // kurzer Rauschklick, erst oberhalb der Mitte
    snareFreq: span(snareTone, 1200, 1900, 3200) * span(snareSnap, 0.85, 1, 1.5), // knackiger: etwas höher
    snareQ: span(snareSnap, 0.6, 0.8, 2), // knackiger: schmaleres, spitzeres Band
    snareNoise: 0.55 * span(snareSnap, 0.6, 1, 2.5) * span(snareTone, 0.6, 1, 3), // knackiger und heller: lauter, weniger Dreieck
    snareClick: 1.6 * Math.max(0, 2 * snareSnap - 1), // heller Rauschklick am Anschlag, erst oberhalb der Mitte
    snareTone: 0.3 * span(snareSnap, 2, 1, 0.4),
    snareDecay: span(snareSnap, 0.3, 0.16, 0.07),
    hatFreq: span(hatBright, 4500, 7500, 11000),
    hatPeak: 0.3 * span(hatBright, 0.6, 1, 5) * hatTime ** -0.25, // heller: lauter; längere Ausklänge bekommen weniger Spitze
    hatClosedDecay: 0.04 * hatTime,
    hatOpenDecay: 0.2 * hatTime,
    roomSend: 7 * room, // Pegel der Schlagzeugsumme am Hall-Eingang (der Hall ist normalisiert und danach mit REVERB_WET gedämpft)
  };
}

// Stückweise linear: x = 0 -> lo, 0.5 -> mid, 1 -> hi (mid exakt bei 0.5); für Größen, die 0 erreichen dürfen
const lin = (x, lo, mid, hi) => (x < 0.5 ? lo + (mid - lo) * 2 * x : mid + (hi - mid) * (2 * x - 1));

/** Akkorde: Timbre['chords'] (Felder 0..1) -> Parameter für chordNote in synth.js (neues Objekt je Aufruf). */
export function chordParams({ brightness, length, chorus, tremolo }) {
  const bright = span(brightness, 0.2, 1, 2.5); // Faktor auf den Start des Filterabfalls
  // Ende: nach unten flacher (0.5x statt 0.2x), also nie unter 450 Hz, denn die Grundtöne der Akkorde liegen bei 220-330 Hz;
  // der Start bleibt dabei mindestens 1.6x über dem Ende. Statt einer harten Grenze, damit das Ende streng monoton bleibt.
  const brightEnd = span(brightness, 0.5, 1, 2.5);
  const long = span(length, 0.3, 1, 3);
  const chorusMix = 1.6 * chorus; // Pegel der zusätzlichen verstimmten, links und rechts gepannten Oszillatoren (die Breite kommt aus Verstimmung und Panning, nicht aus einer Verzögerung)
  const tremDepth = 0.95 * (1 - (1 - tremolo) ** 2); // Amplituden-LFO schwingt zwischen 1 - tremDepth und 1; schon bei tremolo 0.5 deutlich
  const tremBase = 1 - tremDepth / 2;
  return {
    lpStart: 3600 * bright,
    lpEnd: 900 * brightEnd,
    lpTime: 0.25 * span(length, 0.5, 1, 2),
    holdScale: span(length, 0.5, 1, 3), // Faktor auf die Haltezeit
    release: 0.2 * long,
    // Chorus und Tremolo gleichen ihre Zusatzenergie über die Spitze aus (Tremolo-Mittel 1 - Tiefe / 2, Leistung + Tiefe² / 8)
    peak: 0.16 / (Math.sqrt(1 + chorusMix ** 2) * Math.sqrt(tremBase ** 2 + tremDepth ** 2 / 8)),
    attack: 0.003,
    chorusMix, // 0 = ohne zusätzliche Oszillatoren
    chorusDetune: 12, // Cent
    tremRate: 6, // Hz
    tremDepth, // 0 = ohne Tremolo-Knoten
    tremBase,
  };
}

/** Pad: Timbre['pad'] (Felder 0..1) -> Parameter für padNote in synth.js (neues Objekt je Aufruf). */
export function padParams({ attack, cutoff, lfoSpeed, lfoDepth, shimmer, thickness }) {
  const extraMix = Math.max(0, 2 * thickness - 1); // zwei weitere Sägezähne erst oberhalb der Mitte
  const shimmerMix = 2 * shimmer; // Pegel der Oktav-Anteile (Sinus bei 2f und 4f)
  const lp = span(cutoff, 350, 1100, 3500) * span(thickness, 1.2, 1, 0.75); // dicker: etwas dunkler
  return {
    attack: span(attack, 0.05, 0.45, 1.6),
    peak: 0.1 / (1 + 0.3 * extraMix) / (1 + 0.3 * shimmerMix), // gleicht die Zusatzenergie aus
    holdMin: 0.1, // Haltezeit max(holdMin, dur - holdCut - max(0, attack - holdAttack))
    holdCut: 0.5,
    holdAttack: 0.45, // neutraler Einsatz: neutral gilt attack + Haltezeit = dur - 0,05 s, die Note klingt vor dem Taktstrich aus
    release: 0.9,
    cutoff: lp,
    q: 0.8,
    lfoSpeed: span(lfoSpeed, 0.05, 0.18, 1.2), // Hz
    lfoDepth: Math.min(span(lfoDepth, 100, 450, 1500), 0.8 * lp), // Hz; höchstens 0.8 x cutoff, sonst sinkt das Filter unter 0 Hz und pumpt
    spread: span(thickness, 3, 9, 25), // Cent, Sägezähne bei -/0/+
    extraMix, // 0 = ohne zusätzliche Oszillatoren
    shimmerMix, // 0 = ohne Oktav-Anteile
  };
}

/** Summe: Timbre['master'] (Felder 0..1) -> Parameter für die Summenkette in synth.js (neues Objekt je Aufruf). */
export function masterParams({ brightness, echo, reverb }) {
  const shelfDb = lin(brightness, -15, 0, 9);
  return {
    shelfDb, // Hochregal; exakt 0 = ohne Filterknoten
    level: 1 / (1 + 0.05 * Math.max(0, shelfDb)), // Faktor auf den Summenpegel: hell hebt die Höhen, also bleibt die Spitze nicht höher
    shelfFreq: 800, // tiefer als die erwarteten 3 kHz: erst so verändert das Schlagwort die Summe hörbar (diff >= 0.25)
    echoWet: lin(echo, 0, 0.3, 1),
    echoFeedback: lin(echo, 0.1, 0.38, 0.7),
    echoTone: 2400,
    reverbWet: lin(reverb, 0, 0.15, 0.6),
  };
}
