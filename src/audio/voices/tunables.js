// Feinwerte der Stimmen (nur Stimmen, die welche haben): je Stimme `${instrument}/${id}/${variante}` eine Tabelle { Name: { min, max, step, value } }.
// `value` ist der ausgelieferte Standard. Die Hörprobe-Seite verstellt die Werte live (Tuning-Panel) und exportiert sie; was dort gut klingt,
// wird hier als neuer Standard eingetragen. Stimmen lesen den Wert beim Anschlag über tunedValue.

import { TIMING_DEFAULTS } from '../../core/microtiming.js';
import { ART_DEFAULTS } from '../../core/articulation.js';

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
};

const spec = (min, max, step, value) => ({ min, max, step, value });
// Natürlichere Sample-Gitarren (sample.js, nach Wissen gesetzt, nicht gehört): velExp Anschlagkurve (Pegel = Anschlag ** velExp, 1 = linear wie
// früher), softHz Tiefpass bei leisem Anschlag (Anschlag 0,2; 20000 = aus), oneShot 1 spielt nie die kurze Endschleife (das Sample klingt am Ende
// aus, 0 = Schleife wie früher), humanCents und humanDb zufällige Abweichung je Anschlag (gleichverteilt in ±, aus dem Seed der Stimme)
const REALISM = { velExp: spec(0.5, 3, 0.05, 1.6), softHz: spec(800, 20000, 100, 3500), oneShot: spec(0, 1, 1, 1), humanCents: spec(0, 10, 0.5, 2.5), humanDb: spec(0, 3, 0.1, 0.8) };
// Klang v2, Schritt 5 (Werte nach Wissen gesetzt; Urteil des Nutzers 2026-11-13 an Standard-Kit, Finger-Bass und Studio-Percussion: kein deutlicher
// Unterschied, fühlt sich aber in allen drei Proben besser an). HIT_HUMAN für Schlagzeug-Kits und Percussion (sample-hits.js): humanCents/humanDb
// Zufall je Schlag, layerSpread Streuung des Anschlags für die Zonenwahl (Pseudo-Round-Robin über benachbarte Anschlagstufen), choke 1 =
// geschlossene Hi-Hat würgt die offene ab. BASS_HUMAN für die Bässe: dieselben Namen wie REALISM (oneShot bleibt 0: die Schleife wird gebraucht).
// NOTE_NEUTRAL fürs E-Piano: dieselben Regler, aber neutral (aus), weil es in keiner Hörprobe vorkam. 0 bzw. velExp 1 und softHz 20000 = aus.
const HIT_HUMAN = { humanCents: spec(0, 30, 1, 6), humanDb: spec(0, 3, 0.1, 0.7), layerSpread: spec(0, 0.3, 0.01, 0.08) };
const KIT_HUMAN = { ...HIT_HUMAN, choke: spec(0, 1, 1, 1) };
// Kits im Format 2 (scripts/import-sfz.mjs): Round-Robins und Choke kommen aus dem Pack, darum ohne layerSpread und choke. roomMic Pegel des Raum-Samples
// (0 = nur Direkt), velCurve Anschlag hoch velCurve vor Zonenwahl und Pegel (1 = wie die Library, darunter klingen leise Schläge lauter), kitPan 0: keine
// Lage je Schlag (das Stereo-Sample hat sein eigenes Bild)
const kitV2 = (level, velCurve) => ({ level: spec(0.05, 8, 0.05, level), humanCents: HIT_HUMAN.humanCents, humanDb: HIT_HUMAN.humanDb, roomMic: spec(0, 2, 0.05, 1), velCurve: spec(0.3, 1.5, 0.05, velCurve), kitPan: spec(0, 1, 1, 0) });
const BASS_HUMAN = { velExp: spec(0.5, 3, 0.05, 1.3), softHz: spec(800, 20000, 100, 2500), oneShot: spec(0, 1, 1, 0), humanCents: spec(0, 10, 0.5, 1.5), humanDb: spec(0, 3, 0.1, 0.6) };
const NOTE_NEUTRAL = { velExp: spec(0.5, 3, 0.05, 1), softHz: spec(800, 20000, 100, 20000), oneShot: spec(0, 1, 1, 0), humanCents: spec(0, 10, 0.5, 0), humanDb: spec(0, 3, 0.1, 0) };
// Strum der Sample-Gitarren (sample.js): strum Abstand der Akkordtöne in s. Klang v2, Schritt 6 (Urteil des Nutzers 2026-11-14 an der Clean
// Guitar: klingt um einiges besser, besonders im Funk): strumUp 0 = immer Abschlag wie bisher,
// 1 = Aufschlag auf 16tel-Zwischenschlägen, 2 = Aufschlag auf allem außer den Zählzeiten (dann auch Strum-Zeit nach Anschlag und Notenlänge);
// strumTilt = wie viel leiser die zuletzt angeschlagene Saite ist (0,25 = -2,5 dB)
const STRUM = { strum: spec(0, 0.05, 0.002, 0.012), strumUp: spec(0, 2, 1, 2), strumTilt: spec(0, 0.6, 0.05, 0.25) };
// Tonewheel-Orgel (organ.js; alles Startwerte, nicht gehört): je Variante ein Zugriegel-Preset. d16 … d1 sind die neun Zugriegel (0 bis 8, je Stufe
// 3 dB) in der Reihenfolge 16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1'. level glich den Pegel an die frühere Sample-Orgel
// (chords/sample/organ, entfernt 2026-11-15) an, Werte bei den Tabellen unten.
// Schritt 2: click Pegel des Key-Clicks (0 = aus; SPIELREGELN 4.6: immer leicht, stärker bei Rock), clickOff Anteil davon bei Note-Off;
// gemessen 2026-11-15 (Akkord-Schicht allein, Click gegen Orgel bei click 0,1): Blues -39,0 dB, Ballade -40,1, Rock -24,4 (kurze Akkorde, Klangkette
// der Schicht hebt die Höhen). Der Rock-Wert 0,2 (-18,4 dB) war im Hörtest irritierend, 0,05 (-30,4 dB) noch leicht störend, darum 0,03 (-34,9 dB): die Mitte in dB zwischen 0,05 und dem Blues-Abstand (-39,0 dB, wäre 0,02);
// perc Pegel der Percussion relativ zu einem Ton (0 = aus; nur das Preset jazz hat sie an: Jazz/Blues-Staccato, aus bei Flächen),
// percHarm 2 oder 3 (Teilton der 8'-Lage), percDecay Zeit bis -20 dB in s (schnell etwa 0,2, langsam etwa 1).
// Schritt 3, Leslie (organ-leslie.js): leslie 0 = aus, 1 = folgt den Regeln (schnell in Refrain, Aufbau und im Takt vor dem Refrain, core/organ.js), 2 = immer
// langsam, 3 = immer schnell; hornSlow/hornFast/drumSlow/drumFast Drehzahl in Hz; hornUp/hornDown/drumUp/drumDown Trägheit beim Beschleunigen und
// Bremsen (Zeit in s bis etwa 95 % der neuen Drehzahl); hornAm/drumAm Tiefe der Lautstärke-Modulation (1 ± Wert); hornDoppler/drumDoppler Hub der
// Verzögerung in ms (0,4 ms sind bei 6,7 Hz etwa ±29 Cent, bei 0,8 Hz ±3,5 Cent); crossover Frequenzweiche in Hz; micAngle Winkel zwischen den
// beiden Mikrofonen in Grad (wirkt beim Aufbau der Kette, also nach Stopp und Start).
// Schritt 4: drive Vorstufen-Zerre (0 = aus, 1 = Verstärkung 6 vor der Röhren-Kennlinie; für Rock stärker), swell Schweller (0 = aus, 1 = das
// Pedal folgt dem Pegel der Songform voll: Strophe -3 dB, Refrain 0 dB, im Takt vor dem Refrain zieht es auf).
export const DRAWBARS = Object.freeze(['d16', 'd513', 'd8', 'd4', 'd223', 'd2', 'd135', 'd113', 'd1']);
const organ = (bars, level, over) => ({
  level: spec(0.05, 8, 0.05, level), ...Object.fromEntries(DRAWBARS.map((name, i) => [name, spec(0, 8, 1, Number(bars[i]))])),
  click: spec(0, 1, 0.01, 0.1), clickOff: spec(0, 1, 0.05, 0.5), perc: spec(0, 1, 0.05, 0), percHarm: spec(2, 3, 1, 3), percDecay: spec(0.05, 2, 0.05, 0.2),
  leslie: spec(0, 3, 1, 1), hornSlow: spec(0.1, 2, 0.05, 0.8), hornFast: spec(3, 10, 0.1, 6.7), drumSlow: spec(0.1, 2, 0.05, 0.7), drumFast: spec(3, 10, 0.1, 5.7),
  hornUp: spec(0.1, 6, 0.1, 1), hornDown: spec(0.1, 8, 0.1, 1.5), drumUp: spec(0.5, 10, 0.1, 3.5), drumDown: spec(0.5, 12, 0.1, 5),
  hornAm: spec(0, 0.9, 0.05, 0.5), drumAm: spec(0, 0.9, 0.05, 0.25), hornDoppler: spec(0, 1, 0.05, 0.4), drumDoppler: spec(0, 1, 0.05, 0.15),
  crossover: spec(200, 2000, 50, 800), micAngle: spec(0, 180, 5, 90),
  drive: spec(0, 1, 0.05, 0.25), swell: spec(0, 1, 0.05, 1),
  ...over,
});
// Gemeinsame Namen der Saitenstimmen (Bedeutung: string-model.js STRING_DEFAULTS); die Startwerte sind nach bestem Wissen gesetzt und
// werden in der Hörprobe nach Gehör verändert. level gleicht den Pegel an den klassischen Synth an (gemessen, siehe voices-string-sound.spec.js).
export const TUNABLES = deepFreeze({
  // Synth-Kit, Schlagarten ohne eigenen Klang (Urteil des Nutzers 2026-11-15: fehlt die Artikulation, entfällt die Verzierung): sideStick Faktor auf die
  // Lautstärke der Snare, die ihn vertritt (1 = volle Snare wie bisher); hatPedal 0 = entfällt, 1 = geschlossene Hi-Hat wie bisher
  'drums/synth/classic': { sideStick: spec(0, 1, 0.05, 0.45), hatPedal: spec(0, 1, 1, 0) },
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
  'bass/sample/finger': { level: spec(0.05, 8, 0.05, 4), decay: spec(0.2, 10, 0.1, 2.5), ...BASS_HUMAN },
  'bass/sample/pick': { level: spec(0.05, 8, 0.05, 4.65), decay: spec(0.2, 10, 0.1, 2), ...BASS_HUMAN },
  // Gitarre: Entzerrer gegen die nasale Mitte des Presets. Gemessen (volle FFT, dB relativ zu 317 bis 635 Hz): ohne Entzerrung liegen 1,6 bis 3,2 kHz bei +2 bis 0
  // dB, Synth bei -10 bis -23, Saitenmodell bei -19 bis -35; mit den damaligen Werten (lowDb 9, midDb -12, highDb -10) bei -12 bis -16, die Tiefen unter 200 Hz fehlen im Preset und kommen teilweise zurück.
  // Seit Stufe 1 milder (lowDb 5, midDb -6, highDb -4): die Quelle hat nur 22 050 Hz, die Höhen fehlten sonst ganz.
  // Pegel der sieben Gitarren nach Stufe 1 neu gemessen (2026-11-12, Track aus voices-sample-sound.spec.js, 8 s, Schicht allein, ohne Begrenzer):
  // rms Sample / Synth mit den neuen Standardwerten und dem alten level (guitar 1.7, muted 1.2, jazz 4.25, funk 0.9, steel 5, nylon 1.85,
  // twelve 6.5): guitar 1.147, muted 0.885, jazz 0.869, funk 0.918, steel 0.892, nylon 0.873, twelve 0.885; level = altes level / Verhältnis,
  // auf 0.05 gerundet; mit den ausgelieferten Werten 0.991 bis 1.020
  'chords/sample/guitar': {
    level: spec(0.05, 8, 0.05, 1.5), decay: spec(0.2, 10, 0.1, 3), ...STRUM,
    lowDb: spec(-12, 12, 0.5, 5), midDb: spec(-12, 6, 0.5, -6), midHz: spec(500, 5000, 50, 2400), highDb: spec(-12, 6, 0.5, -4), highHz: spec(1500, 8000, 100, 2600),
    ...REALISM,
  },
  'chords/sample/epiano': { level: spec(0.05, 8, 0.05, 2.25), decay: spec(0.2, 10, 0.1, 3), ...NOTE_NEUTRAL },
  'pad/sample/strings': { level: spec(0.05, 8, 0.05, 1.95) },
  'pad/sample/warm': { level: spec(0.05, 8, 0.05, 1.15) },
  // Neue Varianten, gleiches Verfahren (gemessen 2026-11-10, Track aus voices-sample-sound.spec.js, 8 s, Schicht allein, ohne Begrenzer; Lead mit Job
  // melody, Percussion mit Job mixed): rms Sample / Synth bei level 1 (decay auf dem Maximum 10): upright 0.422, muted 0.989, flute 0.413,
  // sax 0.776, synth 0.232, Kits standard 0.832, brushes 0.850, rimshot 0.755, jazz 0.854, electronic 0.948, 808 1.400, percussion studio 0.518;
  // mit decay 2.5 (upright) und 1.5 (muted) bei level 1: 0.334 und 0.839; level = 1 / Verhältnis, mit den ausgelieferten Werten 0.98 bis 1.02.
  // Kits: die Balance der Schläge folgt der SoundFont, einzeln (rms je Schlag gegen den Synth-Schlag gleichen Namens, mit level) z. B. Snare 1.4
  // bis 2.9, Hi-Hat 0.5 bis 1.7, Shaker 2.3, Tamburin 2.9, Kuhglocke 0.55
  'bass/sample/upright': { level: spec(0.05, 8, 0.05, 3), decay: spec(0.2, 10, 0.1, 2.5), ...BASS_HUMAN },
  'chords/sample/muted': { level: spec(0.05, 8, 0.05, 1.35), decay: spec(0.2, 10, 0.1, 1.5), ...REALISM },
  // Jazz- und Funk-Gitarre (gemessen 2026-11-11, Track wie oben, rms Sample / Synth bei level 1.7 und decay 3: jazz 0.398, funk 1.930, steel 0.341, nylon 0.907, twelve 0.262; level = 1.7 / Verhältnis; mit den ausgelieferten Werten 0.91 bis 1.02);
  // strum wie bei der Clean Guitar, ohne Entzerrer (Klang unbeurteilt, nicht gehört)
  'chords/sample/jazz': { level: spec(0.05, 8, 0.05, 4.9), decay: spec(0.2, 10, 0.1, 3), ...STRUM, ...REALISM },
  'chords/sample/steel': { level: spec(0.05, 8, 0.05, 5.6), decay: spec(0.2, 10, 0.1, 3), ...STRUM, ...REALISM },
  'chords/sample/nylon': { level: spec(0.05, 8, 0.05, 2.1), decay: spec(0.2, 10, 0.1, 3), ...STRUM, ...REALISM },
  'chords/sample/twelve': { level: spec(0.05, 8, 0.05, 7.35), decay: spec(0.2, 10, 0.1, 3), ...STRUM, ...REALISM },
  'chords/sample/funk': { level: spec(0.05, 8, 0.05, 1), decay: spec(0.2, 10, 0.1, 3), ...STRUM, ...REALISM },
  // Freepats FSBS Clean und Jazz (Stufe 2, CC0, 44,1 kHz, eine Anschlagstufe): Feinwerte wie die anderen Gitarren, ohne Entzerrer. Pegel gleiches
  // Verfahren (gemessen 2026-11-12, Track aus voices-sample-sound.spec.js, 8 s, Schicht allein, ohne Begrenzer): rms Sample / Synth bei level 1:
  // freepats 1.337, freepatsjazz 1.649; level = 1 / Verhältnis, auf 0.05 gerundet; mit den ausgelieferten Werten freepats 1.004, freepatsjazz 0.991
  'chords/sample/freepats': { level: spec(0.05, 8, 0.05, 0.75), decay: spec(0.2, 10, 0.1, 3), ...STRUM, ...REALISM },
  'chords/sample/freepatsjazz': { level: spec(0.05, 8, 0.05, 0.6), decay: spec(0.2, 10, 0.1, 3), ...STRUM, ...REALISM },
  'lead/sample/flute': { level: spec(0.05, 8, 0.05, 2.4) },
  'lead/sample/sax': { level: spec(0.05, 8, 0.05, 1.3) },
  'lead/sample/synth': { level: spec(0.05, 8, 0.05, 4.3) },
  // Lead-Gitarre: die Samples von chords/sample/freepats, einstimmig; Natürlichkeit wie die Gitarren, ohne Strum. Pegel gleiches Verfahren (gemessen
  // 2026-11-14, Job melody, 8 s, Schicht allein, ohne Begrenzer): rms Sample / Synth bei level 1 und decay 10: 0.460 (decay 3: 0.342); level = 1 / Verhältnis.
  // decay 10 statt 3 wie bei den Akkorden: gezogene und bebende Töne klingen im Sampler gar nicht zusätzlich ab (Urteil des Nutzers: dem Bend fehlt
  // Sustain); mit decay 3 waren sie in der Melodie viel lauter als die übrigen Töne (Schritt 24: Unterschied B-A bis +0,5 dB, Spitze vor der Summe +5 dB)
  'lead/sample/guitar': { level: spec(0.05, 8, 0.05, 2.15), decay: spec(0.2, 10, 0.1, 10), ...REALISM },
  // Standard- und Rimshot-Kit spielen Naked Drums (Format 2, pack-id.js; bis 2026-11-16 das MuseScore-Kit mit level 1,2 bzw. 1,3). velCurve 0,5 = Pegel
  // bei vel 0,2 bis 0,8 im Mittel 1,5 dB vom MuseScore-Kit (mit 1: 6,4 dB; das Mapping nutzt die quadratische SFZ-Kurve). Gemessen, nicht gehört
  'drums/sample/standard': kitV2(2.5, 0.5),
  'drums/sample/brushes': { level: spec(0.05, 8, 0.05, 1.2), ...KIT_HUMAN },
  'drums/sample/rimshot': kitV2(2.5, 0.5),
  'drums/sample/jazz': { level: spec(0.05, 8, 0.05, 1.15), ...KIT_HUMAN },
  'drums/sample/electronic': { level: spec(0.05, 8, 0.05, 1.05), ...KIT_HUMAN },
  'drums/sample/808': { level: spec(0.05, 8, 0.05, 0.7), ...KIT_HUMAN },
  // Muldjord (Urteil des Nutzers 2026-11-16: im Mix Proberaum, passt). level 1,9 = RMS des MuseScore-Standard-Kits allein (mit 1,2 2,7 dB leiser; 1,65 blieb
  // hinter dem Begrenzer 0,5 bis 0,9 dB darunter, dazu 0,7 dB weniger Pack-Faktor durch den angehobenen Crash), velCurve 0,8 = Pegel bei vel 0,2 bis 0,8 im
  // Mittel 1,7 dB vom MuseScore-Kit (mit 1: 2,4 dB; Hi-Hat 1,1 statt 5,1 dB)
  'drums/sample/muldjord': kitV2(1.9, 0.8),
  // Legacy Drums: das MuseScore-Standard-Kit (bis 2026-11-16 drums/sample/standard), auf Wunsch des Nutzers weiter wählbar, Werte wie damals
  'drums/sample/legacy': { level: spec(0.05, 8, 0.05, 1.2), ...KIT_HUMAN },
  'percussion/sample/studio': { level: spec(0.05, 8, 0.05, 1.95), ...HIT_HUMAN },
  'chords/epiano/rhodes': {
    ratio: spec(0.5, 4, 0.01, 1), index: spec(0, 8, 0.05, 2.2), indexDecay: spec(0.05, 2, 0.01, 0.35), bell: spec(0, 1, 0.01, 0.2),
    bellRatio: spec(4, 20, 0.5, 14), decay: spec(0.2, 8, 0.1, 2.5), level: spec(0.1, 6, 0.05, 1.1),
  },
  // Pegel gemessen 2026-11-15 mit allen Standardwerten (Fälle aus render-organ.mjs ohne Songform, je Preset sein Fall, gospel im Rock-Fall;
  // Akkord-Schicht allein, ohne Begrenzer): rms Synth gegen chords/sample/organ bei level 1: jazz +0,27 dB, rock +1,99, ballad +1,21, gospel +3,43;
  // level = 10 ** (-dB / 20), auf 0,05 gerundet (Rest -0,3 bis +0,1 dB). Ohne Songform gemessen, weil die Orgel der Anschlagstärke nicht folgt:
  // den Pegel der Songteile übernimmt der Schweller. Im Rock hebt die Klangkette der Schicht die hohen Zugriegel an (darum gospel leiser).
  'chords/organ/jazz': organ('888000000', 0.95, { perc: spec(0, 1, 0.05, 0.5) }),
  'chords/organ/rock': organ('888800000', 0.8, { click: spec(0, 1, 0.01, 0.03), drive: spec(0, 1, 0.05, 0.5) }),
  'chords/organ/gospel': organ('888888888', 0.65),
  'chords/organ/ballad': organ('838000000', 0.85),
});

// Feinwerte der Summe (Klang v2, synth.js; nach Wissen gesetzt, nicht gehört). 'mix/bus': on 0 = alter Begrenzer (-10 dB, Ratio 20), 1 = neue Kette;
// glueDb/glueRatio/glueAttack/glueRelease Bus-Kompressor (Schwelle dB, Ratio 1 = aus, Zeiten in s), gainDb Pegel vor dem Sicherheits-Begrenzer,
// ceilingDb dessen Schwelle (dBFS). Eigene Tabelle, weil TUNABLES nur Stimmen des Registers enthält.
export const MIX_TUNABLES = deepFreeze({
  'mix/bus': {
    on: spec(0, 1, 1, 0), glueDb: spec(-40, 0, 0.5, -14), glueRatio: spec(1, 6, 0.1, 2), glueAttack: spec(0.001, 0.2, 0.001, 0.03),
    glueRelease: spec(0.05, 1, 0.01, 0.25), gainDb: spec(-6, 12, 0.5, 3), ceilingDb: spec(-12, -0.5, 0.5, -2),
  },
  // Panorama (Schritt 2, nach Wissen gesetzt, nicht gehört): je Schicht -1 (links) .. 1 (rechts), mal Klangregler master.width (Mitte = 1, ganz links = mono, ganz rechts = doppelt),
  // Publikumssicht; kit spreizt Hi-Hat, Toms und Crash um die Schlagzeug-Lage (Faktoren KIT_PAN in synth.js)
  'mix/pan': {
    drums: spec(-1, 1, 0.05, 0), bass: spec(-1, 1, 0.05, 0), chords: spec(-1, 1, 0.05, 0.3), pad: spec(-1, 1, 0.05, -0.2),
    lead: spec(-1, 1, 0.05, 0), percussion: spec(-1, 1, 0.05, -0.4), kit: spec(0, 1, 0.05, 0.25),
  },
  // Mikrotiming (Schritt 4, core/microtiming.js; Standardwerte von dort): amount Faktor auf Lage und Drift, tight Rest des Zufalls je Note (beide ohne Angabe aus dem Track-Feld loose, Standard 1,5 und 0,3)
  // (1 = ±7 ms wie bisher), layback Faktor auf die feste Lage je Instrument, drift Faktor auf den langsamen Drift. Wirkt beim Bauen des
  // Ereignisstroms (in der Hörprobe: nach Stopp und Start).
  'mix/timing': {
    amount: spec(0, 5, 0.05, TIMING_DEFAULTS.amount), tight: spec(0, 1, 0.05, TIMING_DEFAULTS.tight), layback: spec(0, 2, 0.05, TIMING_DEFAULTS.layback),
    drift: spec(0, 2, 0.05, TIMING_DEFAULTS.drift),
  },
  // Artikulations-Schicht (Phase 3, core/articulation.js; Standardwerte von dort): on 0 = aus (Standard an seit dem Urteil des Nutzers 2026-11-14 zu Bass und Gitarre: B etwas besser), bass und
  // chords Faktor auf die Wahrscheinlichkeiten der Schicht (0 = Schicht ohne Artikulationen). Wirkt beim Bauen des Ereignisstroms.
  // drums, keys (Tasten auf der Akkord-Schicht) und pad sind gebaut, aber aus, bis der Nutzer sie gehört hat
  'mix/art': Object.fromEntries(Object.entries(ART_DEFAULTS).map(([name, value]) => [name, name === 'on' ? spec(0, 1, 1, value) : spec(0, 2, 0.05, value)])),
  // Gemeinsamer Raum (Schritt 3, nach Wissen gesetzt, nicht gehört): wet Faktor auf den Pegel des Raums (Klangregler master.roomWet; 0 = aus, für Messungen und A/B), tone Tiefpass des
  // Rückwegs in Hz; je Schicht der Sendeanteil 0..1 (Schlagzeug und Percussion voll, Bass fast trocken). Die Größe ist der Klangregler master.roomSize (Mitte 0,4 s).
  'mix/room': {
    wet: spec(0, 4, 0.05, 1), tone: spec(1000, 16000, 100, 7000),
    drums: spec(0, 1, 0.05, 1), bass: spec(0, 1, 0.05, 0.15), chords: spec(0, 1, 0.05, 0.7), pad: spec(0, 1, 0.05, 0.4),
    lead: spec(0, 1, 0.05, 0.6), percussion: spec(0, 1, 0.05, 1),
  },
});

const isRecord = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Aktueller Wert von `name` für die Stimme `key`: der Standard aus TUNABLES, überschrieben durch `tuning[key][name]`, auf [min, max] begrenzt.
 * Unbekannter Schlüssel oder Name ergibt NaN (wirft nicht); ungültige Überschreibungen zählen nicht.
 */
export function tunedValue(key, name, tuning) {
  const spec = (TUNABLES[key] ?? MIX_TUNABLES[key])?.[name];
  if (!spec) return NaN;
  const over = isRecord(tuning) && isRecord(tuning[key]) ? tuning[key][name] : undefined;
  const v = Number.isFinite(over) ? over : spec.value;
  return Math.min(spec.max, Math.max(spec.min, v));
}
