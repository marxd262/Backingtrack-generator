# Klangformung je Instrument: Design

Stand 2026-11-07. Ergänzt `2026-11-07-backingtrack-generator-design.md`. Kennzeichnung: **[E]** = Entscheidung des Auftraggebers, **[A]** = Annahme von Claude, nicht bestätigt.

## 1. Absicht und Warum

Die Instrumente unterscheiden sich zwar voneinander, klingen aber innerhalb eines Instruments zu ähnlich. Es fehlen Wege, den Ton der einzelnen Instrumente (besonders des Basses) weiter zu formen. **[E]** Die Schlagworte sollen dafür der Weg sein: Die bisher wirkungslosen Klang-Schlagworte (`gritty`, `warm`, `dark`, `bright`, `psychedelic`) bekommen eine Wirkung, und es kommen zusätzliche Schlagworte hinzu. **[E]**

Erfolg heißt: Jedes neue Schlagwort ist beim Anhören des einzelnen Instruments deutlich hörbar, auch ohne Vergleich mit Zahlen. Das ist messbar (siehe Abschnitt 4), die Hörprobe entscheidet der Auftraggeber.

## 2. Ziele

- Pro Instrument (Schlagzeug, Bass, Akkorde, Pad) fünf neue Klang-Schlagworte in eigenen Kategorien `drumSound`, `bassSound`, `chordSound`, `padSound`. **[A]**
- Die bisher wirkungslosen Schlagworte `gritty`, `warm`, `dark`, `bright`, `psychedelic` wirken (und `dreamy` bekommt zusätzlich eine Klangwirkung). **[E]**
- Schlagworte lassen sich frei kombinieren und addieren sich begrenzt (kein Zufall im Klang, gleiche Schlagworte klingen gleich; die Zufälligkeit bleibt im Muster über den Seed). **[A]**
- Ohne klangformende Schlagworte klingt jeder Track exakt wie bisher. **[A]**
- Die Stil-Schnellwahl (Funk-Rock, Psychedelischer Indie, Träumerisch) nutzt die neuen Schlagworte, damit die Stile hörbar verschiedener klingen. **[A]**

## 3. Entscheidungen von Claude (A)

- **Eigenes Klangmodell statt Muster:** Aus den Schlagworten entsteht reine Logik `resolveTimbre(tags)` (ohne Zufall, ohne Audio) mit Zahlen je Instrument. Der Ereignisstrom (Töne und Zeiten) bleibt unverändert, damit die Golden-Hashes gelten. Die Synthese liest das Klangmodell.
- **Neue Kategorien (ID, Schlagworte):**
  - `drumSound`: `punchy` (kräftig), `boomy` (dröhnend), `snappy` (knackig), `crisp` (klar), `roomy` (räumlich).
  - `bassSound`: `sub`, `fuzz`, `plucky` (zupfend), `round` (rund), `resonant` (resonant).
  - `chordSound`: `mellow` (sanft), `biting` (bissig), `chorused` (breit), `tremolo` (zitternd), `ringing` (klingend).
  - `padSound`: `swelling` (anschwellend), `airy` (luftig), `glassy` (glasig), `thick` (dick), `moving` (bewegt).
- **Wirkung der bestehenden Schlagworte:** `gritty` leichte Verzerrung am Bass; `warm` weicher, weniger Höhen bei Akkorden und Pad, runderer Bass; `dark` und `bright` verschieben die Helligkeit der ganzen Mischung; `psychedelic` mehr Echo und Hall, breitere Akkorde, bewegteres Pad; `dreamy` mehr Hall und langsameres Anschwellen des Pads.
- **Messbar hörbar:** Jedes neue Schlagwort verändert das Signal seines Instruments gegenüber dem Standard um mindestens 25 % (normierte Differenz) und verschiebt den Spektralschwerpunkt in die erwartete Richtung, wo eine Richtung gemeint ist (zum Beispiel `dark` tiefer, `bright` höher, `sub` tiefer, `fuzz` höher).
- `withBreakouts` bleibt vorerst ohne Wirkung, weil es den Aufbau des Tracks betrifft, nicht den Ton. Es bleibt als wirkungslos markiert.
- Die Oberfläche braucht keinen Umbau: Kategorien und Schlagworte erscheinen über die vorhandene Liste. Eine einklappbare Kategorienliste wäre eine spätere Verbesserung.

## 4. Nicht-Ziele

- Echte Instrument-Samples, Equalizer-Regler, freie Zahlenregler, ein Mixer mit Lautstärkeregler je Schicht.
- Änderungen am Ereignisstrom, Arrangement oder den Mustern.
- Bit-genau gleiches Audio über Browser und Rechner hinweg.
- `withBreakouts` umsetzen.

## 5. Anti-Ziele

- Ein Schlagwort, das man nicht hört oder nur mit Messgerät.
- Ein Schlagwort, das die Mischung übersteuert, den Bass verschwinden lässt oder die Pegelverhältnisse der Schichten kippt.
- Ohne neue Schlagworte klingt der Track anders als bisher.
- Die Schnittstelle zu Interactive Scales bricht (neue Kategorien sind abwärtskompatibel, alte Tracks bleiben gültig).

## 6. Randbedingungen

- Reines JavaScript, keine Laufzeit-Abhängigkeiten, lokal und offline. Tests vor Code.
- Alle sichtbaren Texte über `t` in `src/i18n/de.js` und `en.js` mit Paritätstests (Deutsch mit Umlauten).
- Kein `Math.random` im Klangmodell und in der Synthese (das Rauschen kommt weiter aus dem Seed).
- `tests/core/golden.test.js` bleibt unverändert grün (der Ereignisstrom ändert sich nicht).
- Bestehende Tests sind Regressionsschutz: anpassen, nie abschwächen; jede Änderung im Bericht nennen.
- Hörprobe entscheidet der Auftraggeber; Pegelmessungen per Offline-Render bleiben Pflicht.
