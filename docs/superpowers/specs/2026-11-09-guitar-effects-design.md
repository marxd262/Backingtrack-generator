# Gitarren-Verzerrer: Fuzz, Overdrive, Distortion (Entwurf)

Stand: 2026-11-09. Für Bass, Akkorde und Pad (nicht Schlagzeug). Der Auftrag: stärkerer Fuzz, dazu Overdrive und Distortion, die sich
wie die Effekte einer Gitarre anhören. Die erste Umsetzung (eine Kennlinie je Ton direkt am Oszillator) klang nicht nach Gitarre;
diese Fassung ersetzt sie.

## Warum die erste Fassung nicht reichte

- Jeder Ton lief **einzeln** durch eine feste Kennlinie. Eine Gitarre verzerrt die **Summe** aller Saiten: Akkordtöne mischen sich in der
  Kappung (Intermodulation, Powerchord-Crunch), und der Pegel der Hüllkurve steuert die Kappung (Ausklingen räumt auf, Sputtern).
- Es gab **keine Filter vor und hinter der Kappung**. Genau sie machen den Charakter der Pedale aus.
- Es gab **keine Lautsprecherbox**. Ohne ihren steilen Abfall über etwa 5 kHz klingt jede Kappung nach Rauschen und Brummen, nicht nach Gitarre.

## Vorbilder (Recherche)

- **Overdrive, Tube Screamer:** Dioden in der Rückkopplung des Operationsverstärkers (weiche, symmetrische Kappung); ein Hochpass bei
  etwa 720 Hz (4,7 kΩ mit 0,047 µF) in der Rückkopplung, die Tiefen haben Verstärkung 1 und laufen fast sauber, die Mitten werden getrieben
  (der „Mitten-Buckel“); dahinter ein Tiefpass bei etwa 720 Hz mit Klangregler.
  Quellen: [Electrosmash, Tube Screamer](https://electrosmash.com/tube-screamer-analysis),
  [SPICE-Analyse des Frequenzgangs (DIY Stompboxes)](https://diystompboxes.com/smfforum/index.php?msg=617977).
- **Distortion, ProCo RAT:** Eingangsfilter beschneidet die Bässe **vor** der Kappung, viel Verstärkung bei begrenzter Bandbreite des
  Operationsverstärkers (LM308), harte Dioden gegen Masse, danach ein Tiefpass („Filter“).
  Quellen: [Electrosmash, ProCo RAT](https://electrosmash.com/proco-rat), [MusicRadar, The FX files: Pro Co Rat](https://musicradar.com/news/the-fx-files-pro-co-rat).
- **Fuzz:** Fuzz Face (zwei Transistoren, unsymmetrisch, sputternd, ohne Klangregelung, Germanium mit schwachen Höhen);
  Big Muff (vier Transistorstufen, die Kappung in Dioden, passive Klangregelung mit Mittensenke).
  Quellen: [Electrosmash, Big Muff Pi](https://electrosmash.com/big-muff-pi-analysis), [Guitar World, Big Muff vs Fuzz Face](https://www.guitarworld.com/features/big-muff-vs-fuzz-face).
- **Web Audio:** `WaveShaperNode` mit `oversample` gegen Aliasing; die Kennlinie braucht genug Stützpunkte.
  Quelle: [MDN, WaveShaperNode.oversample](https://developer.mozilla.org/en-US/docs/Web/API/WaveShaperNode/oversample).
- Für die Box hat die Suche nichts Brauchbares ergeben; die Werte unten sind meine Schätzung aus allgemeinem Wissen über Gitarrenboxen.

## Aufbau

Eine feste Knotenkette **hinter den Stimmen jeder Schicht** (`src/audio/guitar-fx.js`), Werte rein berechnet in `src/audio/fx-params.js`:

```
Stimmen -> [Eingang x ref] -> Overdrive -> Distortion -> Fuzz -> Box -> [x 1/ref] -> Schicht-Pegel
```

- Jede Stufe hat Umgehung und Wet-Pfad; der Regler blendet sie ein (Mischung = min(1, 8 x Regler)), die Verstärkung steigt dazu.
- **Overdrive:** `Eingang + Hochpass 720 Hz x Verstärkung` -> weiche tanh-Kennlinie -> Tiefpass 3,5 kHz. Verstärkung 0 bis 30 dB.
- **Distortion:** Hochpass (150 Hz, Bass 60 Hz) -> Verstärkung 0 bis 50 dB -> Tiefpass 6 kHz (Bandbreite) -> harte Kennlinie mit Knie bei
  0,1 -> Tiefpass 4,5 kHz.
- **Fuzz:** feste Vorspannung (ein Bruchteil des Eingangspegels, so verschiebt sie die Nulldurchgänge unabhängig von der Verstärkung und lässt
  leise Ausklänge sputtern) -> Verstärkung 6 bis 46 dB -> unsymmetrische Transistorkennlinie (Quadrat-Beimischung: gerade Obertöne,
  Oktavklang) -> Hochpass 35 Hz (Gleichanteil) -> zweite, weiche Stufe wie beim Big Muff -> Klangregelung aus Tief- und Hochpass
  (Mittensenke). Die Vorspannung läuft weich ein, sonst schwingt ihr Gleichanteil lange in den Hochpässen nach.
- **Box:** Hochpass, Buckel (Gitarre: Präsenz 2,5 kHz +4 dB; Bass: Resonanz 90 Hz +3 dB), zwei Tiefpässe hintereinander (5 kHz, Bass 3,2 kHz).
- Alle Kennlinien sind bei Eingang 0 genau 0 (sonst läge vor dem Anschlag ein Gleichanteil an der Hüllkurve; die erste Fassung hatte
  diesen Fehler, die Spitze stieg auf über 30).
- Die Kette entsteht erst beim ersten Regler über 0 und wird nach 0,15 s eingeblendet. Davor geht das Signal unverändert durch einen
  Verstärkungsknoten mit 1.
- WaveShaper mit 2- bis 4-fachem Oversampling.
- Der Pegelausgleich ist je Schicht und Stufe aus Messungen des rms gegen den sauberen Klang angeglichen (0,7 bis 1,26).

## Nicht Teil dieser Fassung

- Keine neuen Schlagworte (nur die Regler; `fuzz` und `gritty` wirken weiter auf `bass.fuzz`, jetzt deutlich härter).
- Keine einstellbare Box oder Klangregelung, keine Einstellung von Vorspannung oder Charakter je Stufe.
- Nicht gehört: Pegel und Spektren sind gemessen (Obertöne eines Sinus, Bänder, rms), der Klang selbst nicht.
