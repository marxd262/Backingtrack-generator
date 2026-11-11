// Verzerrerkette für Bass, Akkorde, Pad und Lead: Werte aus den Reglern Overdrive, Distortion und Fuzz (je 0..1). Reine Rechnung ohne
// Audio-Objekte, damit in Node testbar; die Knoten baut guitar-fx.js.
//
// Vorbilder (siehe docs/superpowers/specs/2026-11-09-guitar-effects-design.md):
//  - Overdrive: Tube Screamer. Hochpass bei etwa 720 Hz in der Verstärkung, die Tiefen laufen fast sauber durch und nur die Mitten
//    werden getrieben; weiche, symmetrische Kappung (Dioden in der Rückkopplung), danach ein Tiefpass.
//  - Distortion: RAT. Bässe werden vor der Kappung beschnitten, viel Verstärkung mit begrenzter Bandbreite, harte Kappung, Filter danach.
//  - Fuzz: Fuzz Face (unsymmetrische, sputternde Transistorkappung) vor einer zweiten, weichen Stufe wie beim Big Muff, dann dessen
//    Klangregelung mit Mittensenke.
//  - Box: Lautsprecher mit Hochpass, Resonanzbuckel, Präsenz und steilem Abfall über etwa 5 kHz; erst sie macht aus der Kappung den Gitarrenklang.

const num = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const db = (x) => 10 ** (x / 20);
export const NOMINAL = 0.15;
// Pegelausgleich hinter den Kappungsstufen, gemessen an den Akkorden (rms gegen sauber ~1). Overdrive wird mit mehr Verstärkung lauter, weil
// das Signal sich einem Rechteck nähert; Distortion und Fuzz sind schon bei wenig Regler gekappt und bleiben gleich.
const OD_MAKEUP = 0.19, DIST_MAKEUP = 0.055, FUZZ_MAKEUP = 0.113;
const mix = (a) => Math.min(1, 8 * a); // schon bei einem Achtel des Reglers ganz in der Stufe, darunter blendet sie stetig ein

// Schichtprofile. ref: Faktor am Eingang der Kette, bringt die Spitze der Stimmen (gemessen: Bass 0.88, Akkorde 0.43, Pad 0.22, Lead 0.52) auf
// NOMINAL = 0.15, damit die Kappungsstufen Spielraum zum Treiben haben; am Ausgang gleicht 1 / ref das wieder aus. trim: Pegelausgleich
// je Stufe für diese Schicht (die Wellenformen haben verschiedene Scheitelfaktoren), gemessen als rms gegen den unverzerrten Klang;
// odSlope: wie stark der Overdrive-Ausgleich mit der Verstärkung fällt (beim Bass 0, seine Tiefen laufen sauber durch). Frequenzen in Hz.
export const LAYER_FX = Object.freeze({
  bass: Object.freeze({ ref: 0.17, trim: Object.freeze({ od: 1.43, dist: 1.4, fuzz: 1.12 }), odSlope: 0, distHp: 60, toneHz: 800, cabHp: 40, cabLp: 3200, cabPeakHz: 90, cabPeakDb: 3 }),
  chords: Object.freeze({ ref: 0.35, trim: Object.freeze({ od: 1, dist: 1, fuzz: 1 }), odSlope: 0.45, distHp: 150, toneHz: 1500, cabHp: 90, cabLp: 5000, cabPeakHz: 2500, cabPeakDb: 4 }),
  pad: Object.freeze({ ref: 0.68, trim: Object.freeze({ od: 0.7, dist: 0.78, fuzz: 0.86 }), odSlope: 0.45, distHp: 150, toneHz: 1500, cabHp: 90, cabLp: 5000, cabPeakHz: 2500, cabPeakDb: 4 }),
  lead: Object.freeze({ ref: 0.29, trim: Object.freeze({ od: 0.5, dist: 0.6, fuzz: 0.9 }), odSlope: 0.45, distHp: 150, toneHz: 1500, cabHp: 90, cabLp: 5000, cabPeakHz: 2500, cabPeakDb: 4 }),
});

/**
 * Kettenparameter aus { fuzz, overdrive, distortion } (fehlende oder ungültige Werte zählen 0, begrenzt auf 0..1).
 *  - je Stufe (od, dist, fuzz): mix 0..1 (0 = Stufe umgangen), drive = Verstärkung vor der Kappung, makeup = Pegelausgleich danach (für `layer`)
 *  - cab: Anteil der Box am Ausgang (0 = sauberer Durchgang), active: irgendein Regler über 0
 */
export function fxChainParams({ fuzz, overdrive, distortion } = {}, layer = 'chords') {
  const f = num(fuzz), o = num(overdrive), d = num(distortion);
  const { trim, odSlope } = LAYER_FX[layer];
  return {
    active: f > 0 || o > 0 || d > 0,
    od: { mix: mix(o), drive: db(30 * o), makeup: OD_MAKEUP * trim.od * (db(30 * o) / 3) ** -odSlope },
    dist: { mix: mix(d), drive: db(50 * d), makeup: DIST_MAKEUP * trim.dist },
    fuzz: { mix: mix(f), drive: db(6 + 40 * f), makeup: FUZZ_MAKEUP * trim.fuzz },
    cab: mix(Math.max(f, o, d)),
  };
}
