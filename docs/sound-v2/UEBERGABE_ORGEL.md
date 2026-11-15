# Übergabe Orgel-Synth (Tonewheel + Leslie), Stand 2026-11-15

Branch `feat/organ-synth` (mit `feat/sound-v2` zusammengeführt), nicht gepusht. `npm test`: 708 bestanden. Browser-Tests sind nicht gelaufen. Nichts davon ist gehört: alle Zahlen sind Startwerte, belegt sind nur die Messungen unten.

## Was gebaut ist

Stimme `chords/organ`, seit dem Hörurteil im Stimmen-Menü der Akkorde („Orgel Jazz/Blues“, „Orgel Rock“, „Orgel Gospel“, „Orgel Ballade“). Die Sample-Orgel `chords/sample/organ` ist entfernt (samt Pack); wer sie noch nennt, bekommt `organ/jazz`. Die Varianten sind die Zugriegel-Presets: `jazz` 888000000, `rock` 888800000, `gospel` 888888888, `ballad` 838000000.

| Schritt | Commit | Inhalt | Dateien |
|---|---|---|---|
| 1 Grundklang | `3e8237d` | ein Oszillator je Ton auf der Sub-Oktave, neun Zugriegel als Teiltöne, Foldback oben und unten, Verstimmung der Tonräder (unter 0,8 Cent), keine Anschlagdynamik | `src/audio/voices/organ.js` |
| 2 Key-Click, Percussion | `88c1daf` | Rauschstoß bei Note-On, leiser bei Note-Off, je Klick leicht anders; Percussion mit gemeinsamer Hüllkurve, single-trigger | `organ.js` |
| 3 Leslie | `fbabe89` | Horn und Trommel hinter einer Weiche bei 800 Hz, je zwei Mikrofone, Lautstärke-Modulation und Doppler, Trägheit; Regel: schnell in Refrain, Aufbau und im Takt vor dem Refrain | `organ-leslie.js`, `src/core/organ.js` |
| 4 Zerre, Schweller | `e4cf7ee` | weiche Röhren-Kennlinie vor dem Leslie; das Pedal folgt dem Pegel der Songform und zieht im Takt vor dem Refrain auf | `organ.js`, `src/core/organ.js` |

Außerhalb der Stimme geändert: `src/core/articulation.js` (zwei Zeilen: Import und Aufruf von `organRules`), `scripts/render-step.mjs` (`main` nimmt Schritte, Renderer und Fälle entgegen), Register, Namen, `docs/interface.md`. Der Ereignisstrom anderer Stimmen ist unverändert (Golden-Tests grün). Neue Felder nur an Orgel-Tönen: `leslie: 1`, `swell` (dB), `art: 'swell'` mit `artTime`.

## Feinwerte (`TUNABLES['chords/organ/<preset>']`, Regler im render-harness)

- **Schalter je Schritt:** `click` 0, `perc` 0, `leslie` 0, `drive` 0, `swell` 0 schalten den Schritt ab.
- Grundklang: `d16` … `d1` (0 bis 8), `level` jazz 0,95 · rock 0,8 · gospel 0,65 · ballad 0,85.
- `click` 0,1 (rock 0,03, nach dem Hörtest von 0,2 gesenkt), `clickOff` 0,5, `perc` 0 (jazz 0,5), `percHarm` 3, `percDecay` 0,2 s (Zeit bis −20 dB).
- `leslie` 1 (1 folgt der Regel: schnell in Refrain, Aufbau und im Takt vor dem Refrain, 2 immer langsam, 3 immer schnell), Horn 0,8 / 6,7 Hz, Trommel 0,7 / 5,7 Hz, Trägheit bis 95 %: Horn 1 s hoch, 1,5 s runter, Trommel 3,5 s hoch, 5 s runter; `hornAm` 0,5, `drumAm` 0,25, `hornDoppler` 0,4 ms, `drumDoppler` 0,15 ms, `crossover` 800 Hz, `micAngle` 90°.
- `drive` 0,25 (rock 0,5), `swell` 1 (Anteil am Pegel der Songform: Strophe −3 dB, Refrain 0 dB).

## Hörproben

`node scripts/render-organ.mjs <o2|o3a|o3b|o4>` schreibt nach `.superpowers/audio-ab/` (Hörseite `.html` mit Sprungknöpfen). Fälle: Blues-Shuffle 90 (jazz) ab 0 s, Rock 120 mit Strophe und Refrain (rock) ab 35 s, Ballade 70 (ballad) ab 54 s. Band ohne Pad. Im Rock: Takt vor dem Refrain ab 41,2 s, Refrain ab 43,2 s.

| Datei | A / B | Worauf hören | Messung |
|---|---|---|---|
| `stepo1-tonewheel-A/B.wav` (nicht mehr renderbar: die Sample-Orgel ist entfernt) | Orgel-Sample / Synth, alles Weitere aus | Klangfarbe der Akkorde; in der Rock-Strophe ist B lauter (ohne Schweller keine Dynamik) | Mischpegel A und B innerhalb 0,6 dB |
| `stepo2-click-A/B.wav` | ohne / mit | Anschlag jedes Akkords; Percussion nur im Blues | B−A: Blues −21,9, Rock −38,4 (vorher −22,0), Ballade −41,6 dB |
| `stepo3a-leslie-A/B.wav` | aus / dauerhaft langsam | Schweben und Wandern gehaltener Akkorde | Pegel ±0,2 dB; Seite/Mitte der Orgel allein −10,3 → −8,8 dB |
| `stepo3b-leslieswitch-A/B.wav` | dauerhaft langsam / Umschalten | nur Rock: Hochlaufen ab 41,2 s, schnell im Refrain | B−A Rock −14,3 dB, sonst gleich |
| `stepo4-driveswell-A/B.wav` | ohne / mit | Rauheit der Akkorde, am stärksten im Rock; Rock-Strophe leiser, Anschwellen ab 41,2 s | Orgel allein: Zerre rms −0,8 bis +0,6 dB, Schweller im Rock −1,0 dB; Spitze der Mischung im Blues +4,8 → +0,4 dB |

Leslie einzeln gemessen (reiner Ton): Horn 0,80 → 6,64 Hz in der zweiten Sekunde nach dem Umschalten, zurück bei 0,86 Hz nach 5 bis 8 s; Trommel 0,70 → 5,65 Hz (4,29 Hz in der zweiten Sekunde); Modulationstiefe 0,48 und 0,25; Doppler am Horn ±3,5 Cent langsam, ±28 Cent schnell; rechts 90° gegen links versetzt.

## Hörurteil 2026-11-15

o1: B (Synth) besser als das Sample. o2: der hörbare Tastendruck gefällt, das Klicken im Rock irritiert. o3a, o3b: B besser. o4: B ein wenig besser. Folge: `click` im Preset rock 0,2 → 0,05 (noch leicht störend) → 0,03. Gemessen (Orgel allein, Click gegen Orgel bei gleichem `click` 0,1): Blues −39,0 dB, Ballade −40,1, Rock −24,4; der Click sitzt im Rock also rund 15 dB höher (Klang-Schlagwort `biting` statt `mellow`, kurze und leisere Akkorde), mit 0,2 waren es 21 dB. 0,03 ist die Mitte in dB zwischen 0,05 und dem Blues-Abstand: 4 dB über dem Blues; 0,02 wäre gleichauf. Die Tastenhüllkurve allein liegt 32 dB unter dem Rauschstoß. Urteil zu 0,03: noch da, aber nicht mehr störend. Alle Proben ab o2 sind mit diesem Wert neu gerendert.

## Entscheidungen des Nutzers (2026-11-15, nach dem Live-Hören: „zufrieden“)

1. Die Presets bleiben vier Varianten.
2. Die Presets bleiben gleich laut (auf gleichen rms normiert); die Lautstärke regelt der Mixer.
3. Das Leslie folgt SPIELREGELN 4.6: schnell auch im Aufbau. Ohne Songform bleibt es langsam.
4. Stereo reicht vorerst (mit 888000000 liegt fast alles unter 800 Hz, also auf der Trommel).
5. Die Orgel ist sichtbar, die Sample-Orgel entfernt; `feat/sound-v2` ist eingemischt, der Eintrag im Änderungslog von `SOUND_CONTEXT.md` steht.

Weiter offen: der Schweller folgt nur dem Pegel der Songform (ein Decrescendo zum Ende gibt es nur über ein Outro); der Key-Click in der Ballade (−41,6 dB) ist vermutlich unhörbar; `percDecay` als Zeit bis −20 dB ist meine Festlegung.

## Bekannte Grenzen

- Kein Vibrato-/Chorus-Scanner, kein Übersprechen der Tonräder, keine Pegelkurve des Generators.
- Quint- und Terz-Zugriegel sind reine Obertöne (eine Welle je Ton), am Original temperierte Räder.
- Percussion schaltet den 1'-Zugriegel nicht ab und senkt die Zugriegel nicht.
- Leslie ohne Gehäuseklang und ohne frequenzabhängige Richtwirkung. Es schaltet nur mit einem Anschlag um, nicht in einer Pause. 10 s nach dem letzten Ton halten die LFOs an, der nächste Ton startet mit der Zieldrehzahl.
- Die Klangregler der Akkorde wirken nicht (`uses: []`); der Verzerrer der Schicht liegt hinter dem Leslie.
- Keine Spielweisen (Stabs gegen Fläche, Bubble, Smear).
- `package-lock.json` war schon vor der Arbeit geändert und ist nicht eingecheckt.
