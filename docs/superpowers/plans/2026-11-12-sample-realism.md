# Natürlichere Gitarren-Samples Umsetzungsplan

> **Für ausführende Agenten:** PFLICHT-UNTERFÄHIGKEIT: superpowers:subagent-driven-development, Aufgabe für Aufgabe.

**Ziel:** Die Sample-Gitarren der Akkorde klingen weniger künstlich: Stufe 1 verbessert das Abspielen (Anschlagkurve, Helligkeit nach Anschlag, kleine Zufallsabweichung, kein Brummen durch kurze Endschleifen, milderer Entzerrer), Stufe 2 nimmt eine bessere, frei lizenzierte Quelle (Freepats FSBS Clean Electric Guitar, CC0) auf.

**Anlass:** Der Nutzer findet die Gitarren im Mix künstlich. Befund aus den Packs (gemessen, nicht gehört): Clean, Jazz, Funk (und E-Piano, Bass finger/pick) sind nur 22 050 Hz; alle 9 Anschlagstufen teilen sich ein Sample (nur Lautstärke); die Endschleifen sind nur 10 bis 60 ms lang (Brummen bei gehaltenen Tönen); die Clean Guitar hat einen starken Entzerrer (Mitten −12 dB, Höhen −10 dB) auf einer ohnehin dumpfen Quelle; alles mono; Quelle ist die verlustbehaftete `.sf3`. Recherche: mehrere Anschlagstufen mit verschiedenen Aufnahmen, Round Robin, nicht loopen bei gezupften Tönen, SoundFont-Standardkurven (Geschwindigkeit zu Lautstärke/Filter) beachten.

**Wichtig für alle Aufgaben:** Niemand kann hören. Darum sind alle neuen Klangwerte als **Feinwerte (`tunables.js`)** ausgelegt, die der Nutzer in der Hörprobe (`render-harness.html`) verstellen kann, und es wird **vorher/nachher als WAV** gerendert, damit der Nutzer vergleichen kann.

## Globale Randbedingungen

- Arbeit auf dem Zweig `feat/sample-realism` (von `main`, `e93653a`); ein Commit je Aufgabe (mehrere sind erlaubt), Nachricht endet mit der Zeile `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Nicht pushen, nicht mergen.
- Betroffen sind nur die **Gitarren-Varianten der Akkorde**: `chords/sample/` `guitar`, `muted`, `jazz`, `funk`, `steel`, `nylon`, `twelve` (und die neuen aus Stufe 2). Bass, Pad, Lead, E-Piano, Orgel, Schlagzeug, Percussion und die Synth/Saitenmodell-Stimmen bleiben **bit-gleich** wie heute (Standardwerte der neuen Feinwerte dort = altes Verhalten oder die Feinwerte existieren dort nicht).
- Kern bleibt rein; Kommentare deutsch; Texte in `de` und `en`; `tests/core/golden.test.js` bleibt grün (Ereignisse ändern sich nicht).
- Neue Klangparameter sind **Feinwerte** mit `spec(min, max, step, value)` in `src/audio/voices/tunables.js`; „Zufall“ kommt aus `deps.rng` der Stimme (seedbar, damit Offline-Renders reproduzierbar bleiben).
- Sample-Packs: `src/assets/samples/` enthält nur fertige Packs; Rohdateien (SoundFonts, Archive) bleiben **außerhalb** des Repos. Die bestehenden Packs müssen nach einem erneuten Lauf des Extraktors **byte-identisch** bleiben.
- Playwright: nur betroffene Spezifikationen mit `--no-deps`; den ganzen Lauf macht der Controller am Ende.

## Review-Fokus

1. Nicht betroffene Stimmen (Bass, Pad, Lead, E-Piano, Orgel, Drums, Percussion) klingen bit-gleich: Offline-Render vorher/nachher gleich. (Aufgabe 1)
2. Der „Vorher“-Zustand lässt sich allein durch Feinwerte wiederherstellen (alte Werte), das A/B-Rendern hängt daran. (Aufgabe 1)
3. Gehaltene Töne länger als das Sample: kein Dauerton aus der Endschleife, kein Knacken am Ende, keine Stille mitten in einer Note, die kürzer als das Sample ist. (Aufgabe 1)
4. Zufall ist reproduzierbar (gleicher Track + Seed ergibt gleichen Render), die Abweichung bleibt klein (±3 Cent, ±1 dB). (Aufgabe 1)
5. Neue Quelle: Lizenz (CC0) im Repo vermerkt, Packgröße, Tonhöhe stimmt, Pegel zum Synth angeglichen, alte Packs unverändert, Rohdateien nicht im Repo. (Aufgabe 2)

---

### Task 1: Stufe 1, natürlicheres Abspielen der Sample-Gitarren

**Dateien:**
- Ändern: `src/audio/voices/sampler.js` (`playNote`), `src/audio/voices/sample-zones.js` (reine Hilfsfunktionen), `src/audio/voices/sample.js`, `src/audio/voices/tunables.js`, `src/i18n/*` falls die Hörprobe Beschriftungen für Feinwerte braucht (prüfen, wie `render-harness.html` Namen anzeigt), `docs/interface.md` und `README.md` (Feinwerte kurz erwähnen)
- Erstellen: `scripts/render-ab.mjs` (Entwicklerwerkzeug, siehe unten), Tests
- Test: `tests/core/sample-zones.test.js`, `tests/core/voices-impl.test.js`, `tests/e2e/voices-sample-sound.spec.js`

**Schnittstellen:**
- Erzeugt in `sample-zones.js` (rein, mit Unit-Tests): `velocityGain(vel01, exponent): number` (`clamp(vel,1/127,1) ** exponent`; Exponent 1 ist das heutige Verhalten, SoundFont-Standard wäre 2), `velocityBrightnessHz(vel01, softHz): number` (Tiefpass-Grenzfrequenz nach Anschlag: bei Anschlag 1 keine Wirkung (20000), bei 0.5 etwa die geometrische Mitte zwischen `softHz` und 20000, bei 0.2 etwa `softHz`; stetig und monoton; `softHz >= 20000` heißt aus).
- Neue Feinwerte (je Gitarren-Stimme in `tunables.js`; Name, Bereich, Standard): `velExp` (0.5 bis 3, 1.6), `softHz` (800 bis 20000, 3500; 20000 = aus), `oneShot` (0 oder 1, 1: 1 = nie die Endschleife spielen, das Sample klingt am Ende aus), `humanCents` (0 bis 10, 2.5), `humanDb` (0 bis 3, 0.8). Der „Vorher“-Zustand = `velExp 1`, `softHz 20000`, `oneShot 0`, `humanCents 0`, `humanDb 0` plus die alten Entzerrerwerte der Clean Guitar.
- Entzerrer der `chords/sample/guitar` (neue Standardwerte): `lowDb 5`, `midDb -6`, `midHz 2400`, `highDb -4`, `highHz 2600` (vorher 9, −12, 2400, −10, 2600), weil die Quelle nur 22 050 Hz hat und die Höhen sonst fehlen; alle sechs anderen Gitarren haben bisher keinen Entzerrer und bleiben ohne.
- `playNote(ctx, out, t, opts)` bekommt `oneShot` (bool), `fadeOut` (Sekunden, Standard 0.15) und `cents` (Zusatz-Stimmung) und die Anschlagkurve/Helligkeit werden **vom Aufrufer** (`sample.js`) in `gain` und `filter` gerechnet; Verhalten ohne die neuen Optionen unverändert. Mit `oneShot`: Quelle ohne `loop`; Hüllkurve endet spätestens `fadeOut` vor dem Ende des Samples auf `FLOOR`; die Quelle wird nach dem Sample-Ende gestoppt; ist die Note kürzer als das Sample, gilt wie bisher das Notenende plus Ausklingen.

**Regeln:**
- Alle Änderungen sind nur aktiv, wenn die Stimme die neuen Feinwerte hat (`Number.isFinite(tuned('velExp'))`), sonst bleibt der Pfad wie heute (Review-Fokus 1).
- Zufall: `deps.rng` der Stimme (`rng.next()`), je Anschlag zwei Ziehungen (Stimmung, Lautstärke), immer gezogen, auch wenn die Werte 0 sind (damit die Folge gleich bleibt); gleichverteilt in ±`humanCents` und ±`humanDb`.
- Pegel: Die neue Anschlagkurve ändert die mittlere Lautstärke der Gitarren. Die `level`-Feinwerte der 7 Gitarren müssen **neu gemessen** werden (Verfahren und Band: `tests/e2e/voices-sample-sound.spec.js` „Pegel gegen den klassischen Synth im Band 0,7 bis 1,4“, Kommentar in `tunables.js`; Ziel Verhältnis nahe 1,0). Messwerte in den Kommentar schreiben.

**Hilfswerkzeug `scripts/render-ab.mjs`:** startet den Server und Chromium über Playwright (siehe `playwright.config.js`, `scripts/serve.js`), lädt `/ui/render-harness.html` und rendert für jede der 7 Gitarren den **gleichen** 8-Takt-Akkordlauf (Track wie in `voices-sample-sound.spec.js`, nur Akkorde, `layers` nur chords, ohne Echo/Hall: `timbre.master` Echo und Hall 0, 100 bpm, A-Moll Folge Am Am Dm E, gehaltene Akkorde mit `complexity 0`, ein zweiter Durchlauf mit `complexity 1`) einmal mit den **alten** Werten (über `tuning` Überschreibung, siehe oben) und einmal mit den neuen Standardwerten, und schreibt 16-Bit-Mono-WAVs (44,1 kHz) nach `.superpowers/audio-ab/<stimme>-vorher.wav` und `-nachher.wav` (dieser Ordner ist per `.superpowers/` bereits ignoriert). Aufruf: `node scripts/render-ab.mjs [ausgabeordner]`. Das Skript wird in Aufgabe 2 um die neuen Stimmen erweitert (Stimmenliste aus `VOICES.chords.sample.variants`, nur Gitarren).

- [ ] **Schritt 1: Fehlschlagende Tests**: Unit (`sample-zones.test.js`): `velocityGain` Exponent 1 gleich Anschlag, Exponent 2 gleich Quadrat, monoton, Grenzen (0, NaN, >1); `velocityBrightnessHz` bei 1 gleich 20000, `softHz >= 20000` gleich 20000, monoton, stetig, bei 0.2 nahe `softHz`; `voices-impl.test.js`: jede der 7 Gitarren hat die 5 neuen Feinwerte mit den Standardwerten oben, andere Sample-Stimmen haben sie nicht, die Standardwerte der Clean-Guitar-EQ. e2e (`voices-sample-sound.spec.js`): (a) eine 6 s gehaltene Note jeder Gitarre: Energie (rms) der letzten 1,5 s ist **viel kleiner** als die des Anfangs und es gibt keine Dauerlinie (mit `oneShot 0` zum Vergleich ist die Energie am Ende deutlich höher: der Test muss mit dem alten Verhalten scheitern); (b) weicher Anschlag (vel 0.3) hat einen niedrigeren Spektralschwerpunkt (`spectralCentroid` in `src/audio/spectrum.js`) als harter (vel 1.0) und ist leiser; mit `softHz 20000` und `velExp 1` ist der Unterschied nur die Lautstärke; (c) zwei gleiche Anschläge nacheinander klingen mit `humanCents/humanDb > 0` nicht bit-gleich, ein identischer Track zweimal gerendert aber schon (Reproduzierbarkeit); (d) nicht betroffene Stimmen (z. B. `chords/sample/epiano`, `bass/sample/finger`, `pad/sample/strings`, `lead/sample/flute`, `drums/sample/standard`) rendern **bit-gleich** zum Stand vor der Änderung (Vorher-Werte vor Beginn der Arbeit mit einem kurzen Skript aufnehmen und als Referenz in den Test eintragen, z. B. Summe/Prüfsumme der ersten Sekunde) — oder, wenn das zu starr ist, `peak`/`rms` auf 1e-9 gleich; (e) Pegelband 0,7 bis 1,4 für alle 7 Gitarren (bestehender Test, ggf. angepasst).
- [ ] **Schritt 2: Ausführen** — Fehlschlag.
- [ ] **Schritt 3: Implementieren** (Hilfsfunktionen, `playNote`-Optionen, `sample.js`, Feinwerte, EQ-Standardwerte, Pegel neu messen).
- [ ] **Schritt 4: `scripts/render-ab.mjs`** schreiben und einmal laufen lassen; die Ausgabe (Dateinamen, Länge, Spitzenpegel, Schwerpunkt vorher/nachher) in den Bericht.
- [ ] **Schritt 5: Ausführen** `node --test tests/core` und `npx playwright test tests/e2e/voices-sample-sound.spec.js tests/e2e/voices-ui.spec.js tests/e2e/audition.spec.js --no-deps` (im Hintergrund, langes Timeout) — grün.
- [ ] **Schritt 6: Doku** (`docs/interface.md` Abschnitt Samples, `README.md` ein Satz) und **Commit** `feat: more natural sample guitars (velocity curve and brightness, no loop buzz, humanize, softer EQ)`.

### Task 2: Stufe 2, Freepats FSBS Clean Electric Guitar als zusätzliche Quelle

**Dateien:**
- Ändern: `scripts/extract-samples.mjs` (SF2 lesen, Quelle je Pack), `scripts/soundfont.mjs` falls nötig, `src/core/voices.js`, `src/audio/voices/index.js`, `src/audio/voices/tunables.js`, `src/i18n/de.js`, `en.js`, `tests/core/sample-packs.test.js`, `tests/core/voices-impl.test.js`, `tests/e2e/voices-sample-sound.spec.js`, `scripts/render-ab.mjs`, `README.md`, `docs/interface.md`
- Erstellen: `src/assets/samples/chords-freepats.json` und `.pcm` (Name der Stimme `freepats`), optional `chords-freepatsjazz.json`/`.pcm` (Stimme `freepatsjazz`), `src/assets/samples/LICENSE-Freepats-FSBS.md`

**Quelle (geprüft auf der Seite https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html, Lizenz CC0 1.0):** „FSBS Electric Guitar Clean #1“, Version 2026-08-07, Fender-E-Gitarre, Steg-Tonabnehmer, durch Verstärker und Effektgerät zu einem Cleanklang verarbeitet. Kleine SF2-Fassung („Small size“): https://github.com/freepats/electric-guitar-FSBS-clean/releases/download/2026-08-07/EGuitarFSBS-clean-bridge-small-SF2-20260807.7z (6,3 MiB gepackt, 10 MiB entpackt). Jazz-Fassung, kleine SF2: https://github.com/freepats/electric-guitar-FSBS-jazz/releases/download/2026-08-07/EGuitarFSBS-jazz-bridge-small-SF2-20260807.7z (5,0 MiB, 7,5 MiB entpackt). Die Seite nennt weder Abtastrate noch Anschlagstufen noch Schleifen; **das musst du an der Datei selbst feststellen.** Namensnennung ist laut Seite nicht verlangt (CC0), wird aber im Repo vermerkt.

**Schnittstellen / Verhalten:**
- Herunterladen **nach außerhalb des Repos** (z. B. in das Scratchpad-Verzeichnis `C:\Users\lorda\AppData\Local\Temp\claude\84ff408a5aa68f0a\fc301f97-2e50-40f9-9893-843209376b8c\scratchpad\freepats\`), entpacken mit `7z` (liegt unter `C:\Users\lorda\scoop\shims\7z`). Die Datei ist untrusted: in ein eigenes leeres Verzeichnis entpacken, Skripte nicht darin ausführen.
- `scripts/extract-samples.mjs` kann zusätzlich **unkomprimierte SF2** lesen (16-Bit-PCM aus dem `smpl`-Chunk; 24-Bit-`sm24` darf ignoriert werden, dann 16 Bit nutzen) und hat je Pack eine Quelle: `PACKS`-Einträge bekommen optional `source` (`'msg'` ist der Standard = MuseScore_General `.sf3`, neu `'fsbs-clean'` und `'fsbs-jazz'`). CLI: `node scripts/extract-samples.mjs <MuseScore_General.sf3> [ausgabeordner] [--fsbs-clean <datei.sf2>] [--fsbs-jazz <datei.sf2>]`; Packs, deren Quelle nicht angegeben ist, werden übersprungen (kein Fehler). Die **bestehenden Packs müssen byte-identisch bleiben** (`git status` nach dem Lauf: keine Änderung an ihnen).
- Neue Stimmen in `VOICES.chords.sample.variants`: `freepats` (Clean #1, Bridge, klein), optional `freepatsjazz` (Jazz #2); `uses: ['chords.brightness','chords.length']` wie die anderen; `IMPLS`, `tunables` (`level` gemessen gegen den Synth wie bei den anderen Gitarren, `decay`, `strum`, dazu die **Feinwerte aus Aufgabe 1** mit denselben Standardwerten, kein Entzerrer), `de`/`en`-Namen: `E-Gitarre clean (Freepats, Sample)` / `Electric guitar, clean (Freepats, sample)` und `E-Gitarre Jazz (Freepats, Sample)` / `Electric guitar, jazz (Freepats, sample)`.
- Das Pack behält die **Originalabtastrate** (wie bisher), 16-Bit-Mono; hat die Quelle Stereo-Paare, nimm wie bisher die erste Zone (Stereo bleibt außerhalb des Umfangs). Hat die Quelle mehrere Anschlagstufen mit **verschiedenen** Samples, behalte sie alle (das war der Grund für die Quelle); mehrere Round-Robin-Zonen derselben Taste/Stufe: nimm sie ebenfalls mit, wenn der Sampler sie verträgt (`pickZone` nimmt bei Gleichstand die erste: dann nur die erste, und das im Bericht vermerken).
- Packgröße: Das Limit „jedes Pack unter 6 MB“ in `tests/core/sample-packs.test.js` darf für diese Packs auf **12 MB** angehoben werden (mit Kommentar), **ohne** Samples auszudünnen. Meldet die Gesamtgröße im Bericht (vorher 27,8 MB).
- `LICENSE-Freepats-FSBS.md`: CC0-1.0-Vermerk, Quelle (URL der Seite und der Release-Dateien), Versionsdatum, Hinweis auf Verarbeitung (Samples unverändert außer Abtastratenerhalt, 16 Bit Mono); keine Namensnennung nötig.
- `scripts/render-ab.mjs` (aus Aufgabe 1) erweitern: rendert auch die neuen Stimmen (nur „nachher“, mit den neuen Standardwerten) in dieselbe Ordner-/Namensstruktur, damit der Nutzer **Clean (MuseScore) gegen Clean (Freepats)** vergleichen kann.

- [ ] **Schritt 1: Quelle prüfen und herunterladen** (Lizenzseite lesen und im Bericht zitieren; SF2 untersuchen: Presets, Anzahl Samples, Abtastraten, Tastenbereiche, Anschlagstufen, Schleifen, Dauer; Ergebnis in den Bericht).
- [ ] **Schritt 2: Fehlschlagende Tests**: `sample-packs.test.js` (neue Packs vorhanden, gültig, Tastenabdeckung des Bereichs, den die Quelle abdeckt, ohne unbenutzte Samples, Größenlimit), `voices-impl.test.js` (neue Stimmen im Register, `hasVoice`, Feinwerte, Pack-IDs in `PACKS`), e2e `voices-sample-sound.spec.js` (neue Zeilen in `SAMPLES`: hörbar, Spitze unter 1, Tonhöhe auf 15 Cent, Pegelband 0,7 bis 1,4, Hüllkurve endet sauber); Test, dass der Extraktor eine SF2-Datei liest (kleine synthetische SF2 im Test erzeugen oder ein Auszug des echten Packs prüfen).
- [ ] **Schritt 3: Extraktor erweitern, Packs bauen, Stimmen eintragen, Pegel messen.**
- [ ] **Schritt 4: `render-ab.mjs` erweitern und laufen lassen.**
- [ ] **Schritt 5: Ausführen** `node --test tests/core` und `npx playwright test tests/e2e/voices-sample-sound.spec.js tests/e2e/voices-ui.spec.js tests/e2e/audition.spec.js --no-deps` — grün.
- [ ] **Schritt 6: Doku und Commit** `feat: Freepats FSBS clean electric guitar (CC0) as additional chord voice`.
