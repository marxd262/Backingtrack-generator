# Akkord-Register und mehr Akkordarten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 17 Akkordarten über ein einziges Register, eine zweistufige Akkordauswahl, eine Akkordfarbe für die ganze Folge, und Triaden bleiben bitgleich.

**Architecture:** `src/core/chords.js` ist die einzige Quelle für Intervalle, Symbole, Grundart und Erlaubnis je Akkordart. Tonartabhängiges (`stepBase`, `chordOptions`, `dominantRoot`) liegt in `music.js`, die Akkordfarbe in `src/core/harmony.js`. Prüfung, Muster, Rad, Griffbrett, Namen und Oberfläche lesen daraus; `allowedChords(key)` und die Fehlercodes bleiben unverändert.

**Tech Stack:** Reines JavaScript (ES-Module), `node:test` (`npm test`), Playwright (`npx playwright test`).

**Spec:** `docs/superpowers/specs/2026-11-09-chord-registry-design.md` (Grundlage: `…-variant-richness-design.md` und `…-guitar-styles-design.md`; die Branches dazu sind in `main`).

## Beim Planen getroffene Entscheidungen

- Dateizuschnitt (vom Dokument dem Bauenden überlassen): `chords.js` (Register, reine Funktionen je Akkord), `music.js` (tonartabhängig, ruft `chords.js`), `harmony.js` (Farben, ruft beide). So gibt es keinen Importkreis.
- Das Dokument nannte 16 Arten; aufgelistet sind 17, und `power` muss auf allen drei Grundarten stehen dürfen (Akkordfarbe `Powerchords` umfasst verminderte Stufen). Beides im Dokument korrigiert.
- Die zweistufige Auswahl: Wrapper `#add-chords` (bleibt, Gruppe `progression`) enthält `#add-roots` (Grundton-Chips) und `#add-qualities` (Chips der Akkordarten mit dem vollen Akkordnamen für den gewählten Grundton). Bestehende E2E-Tests, die `#add-chords button` als Akkordnamen-Knöpfe nutzen, gehen über einen Hilfsbaustein `tests/e2e/chord-helpers.js` (Task 6).

## Global Constraints

- Reines JavaScript, keine Laufzeit-Abhängigkeiten, lokal und offline. Tests vor Code.
- Alle sichtbaren Texte über `t` in `src/i18n/de.js` und `en.js` (Deutsch mit echten Umlauten, gleiche Schlüssel); `tests/core/i18n.test.js` bleibt grün; kein roher Schlüsselname sichtbar (die `RAW_KEY`-Muster in den e2e-Specs enthalten dazu `chord|chordGroup|chordColor`).
- Kein `Math.random`. Kein Browser-Objekt beim Import in `src/core`, `src/i18n`, `src/audio`, `src/index.js`.
- Bezeichner Englisch, Kommentare Deutsch, LF-Zeilenenden, kein Steuerzeichen in `src` (`tests/core/source-hygiene.test.js`).
- **Triaden bleiben bitgleich:** `tests/core/golden.test.js` bleibt unverändert grün (auch die Hashes für Tracks mit `maj`/`min`/`dim`); `allowedChords(key)` liefert genau die bisherigen Akkorde in gleicher Reihenfolge; `VALIDATION_CODES` und das Track-Format unverändert.
- Bestehende Tests sind Regressionsschutz: anpassen, nie abschwächen oder löschen; jede Änderung an einer bestehenden Prüfung im Bericht nennen.
- Befehle: `npm test` (Node), einzelne e2e-Datei `npx playwright test tests/e2e/<datei> --no-deps`, am Ende `npx playwright test` (etwa 11 Minuten; die Offline-Specs sind langsam).
- Commit-Nachrichten `feat:`/`test:`/`docs:` mit der Co-Authored-By-Zeile der Sitzung. Hörprobe entscheidet der Auftraggeber.

## Review Focus

1. Powerchord (2 Töne) und 5-Ton-Akkorde (`dom9`, `min9`) in allen Mustern (Arpeggio, Stabs, Pad, Bass): keine `NaN`/`undefined`-Noten, Töne im Bereich (Task 4).
2. Schreibweise und Tonhöhen-Gleichheit: Grundtöne aus `chordOptions` in der Schreibweise der Tonart (`Bb`, `F#`), Prüfung nach Tonhöhe (`A#` = `Bb`) auch für neue Arten (Task 1, 3).
3. Akkordfarbe: nach Variante, Tonart oder Skala wieder angewandt; Dorisch-Dominante auf IV; Moll-Dominante; `MAX_CHORDS`; von Hand Hinzugefügtes bleibt (Task 5, 7).
4. Rad: Hervorhebung und gestrichelter Weg mit gefärbten Akkorden (`Am7`, `E7`, `Dsus4`), nie ein Knoten für etwas, das nicht auf dem Rad steht (Task 3).
5. Tastatur und Sprecher bei der zweistufigen Auswahl (deaktivierte Arten, Fokus bleibt beim Rendern je Takt, Ablehnung bei voller Folge) und 360 px Breite mit 17 Chips ohne Überlauf (Task 6).

---

### Task 1: Register und tonartabhängige Funktionen

**Files:**
- Create: `src/core/chords.js`, `tests/core/chords.test.js`
- Modify: `src/core/music.js` (Zeilen 3-8, `chordMidi`, `MODES`), `tests/core/music.test.js:8-10`

**Interfaces:**
- Produces in `chords.js`: `CHORDS` (tief eingefroren, Schlüssel in dieser Reihenfolge: `maj min dim aug sus2 sus4 power dom7 maj7 min7 m7b5 dim7 maj6 min6 add9 dom9 min9`), `CHORD_GROUPS = ['triad','seventh','extended']`, `BASES = ['maj','min','dim']`, `isChordQuality(q): boolean`, `chordName(chord): string` (Grundton + `symbol`), `chordShort(chord): string` (Grundton + `short ?? symbol`), `chordTones(chord, octave): number[]` (MIDI = `12*(octave+1) + noteToPc(root) + interval`), `qualitiesFor(base): string[]` (Arten, deren `on` die Grundart enthält, in Registerreihenfolge). Eintragsfelder wie im Dokument: `intervals, symbol, short?, base (null bei sus2/sus4/power), on, group, fifth, seventh?`. Werte: `maj [0,4,7] ''`; `min [0,3,7] 'm'`; `dim [0,3,6] 'dim' short '°' fifth 6`; `aug [0,4,8] 'aug' fifth 8, base maj`; `sus2 [0,2,7]`; `sus4 [0,5,7]`; `power [0,7] '5' on alle drei`; `dom7 [0,4,7,10] '7' seventh 10`; `maj7 [0,4,7,11] seventh 11`; `min7 [0,3,7,10] 'm7'`; `m7b5 [0,3,6,10] fifth 6 seventh 10, base dim`; `dim7 [0,3,6,9] fifth 6 seventh 9, base dim`; `maj6 [0,4,7,9] '6'`; `min6 [0,3,7,9] 'm6'`; `add9 [0,4,7,14]`; `dom9 [0,4,7,10,14] '9' seventh 10`; `min9 [0,3,7,10,14] 'm9' seventh 10`. Gruppe `triad`: maj min dim aug sus2 sus4 power; `seventh`: dom7 maj7 min7 m7b5 dim7; `extended`: maj6 min6 add9 dom9 min9. `on`: wie im Dokument (Dur-Arten `['maj']`, Moll-Arten `['min']`, `dim`-Arten `['dim']`, `sus2`/`sus4` `['maj','min']`, `power` alle drei).
- Produces in `music.js`: `CHORD_QUALITIES` (abgeleitet: `{[id]: CHORDS[id].intervals}`, bleibt exportiert), `chordMidi(chord, octave)` bleibt als Alias auf `chordTones`, `MODES[*].dominant` (Index der Dominanten-Stufe: minor 4 (die zusätzliche Dur-Dominante, Grundart `maj`), major 4, dorian 3), `dominantRoot(key): string`, `stepBase(chord, key): 'maj'|'min'|'dim'|null` (genau eine erlaubte Grundart: diese; sonst Grundart der diatonischen Stufe auf diesem Grundton nach Tonhöhe; null, wenn der Grundton in der Tonart keine Stufe ist), `chordOptions(key): { root: string, qualities: string[] }[]` (ein Eintrag je Grundton in Stufenreihenfolge, Schreibweise wie `diatonicChords`; `qualities` = Vereinigung von `qualitiesFor(base)` über alle Stufen auf diesem Grundton, in Registerreihenfolge; in Moll vereint der Grundton der Dominante die Moll- und die Dur-Arten).
- Consumes: `noteToPc`, `diatonicChords`, `allowedChords`.

- [ ] **Step 1: Tests schreiben** (`chords.test.js`): Registry-Konsistenz über alle Arten (Intervalle aufsteigend, eindeutig, beginnen bei 0; `symbol` eindeutig über alle Arten; `fifth` ist in `intervals`; `seventh`, wenn vorhanden, ist in `intervals`; `base` in `BASES` oder null; `on` nur gültige Grundarten und nicht leer, enthält `base`, wenn gesetzt; `group` in `CHORD_GROUPS`; tief eingefroren); `chordName({root:'A',quality:'m7b5'})` ergibt `Am7b5` für alle 17 Arten in der erwarteten Schreibweise (`C`, `Cm`, `Cdim`, `Caug`, `Csus2`, `Csus4`, `C5`, `C7`, `Cmaj7`, `Cm7`, `Cm7b5`, `Cdim7`, `C6`, `Cm6`, `Cadd9`, `C9`, `Cm9`); `chordShort` ergibt `B°` für dim und sonst gleich `chordName`; `chordTones({root:'A',quality:'dom7'},3)` ergibt `[57,61,64,67]`, `add9` `[57,61,64,71]`; `qualitiesFor('dim')` ist `['dim','power','m7b5','dim7']`, `qualitiesFor('min')` enthält `min7,min6,min9,sus2,sus4,power`, aber kein `dom7`; in `music`: `stepBase` für `Em7` in A-Moll `min`, `E` (`maj`) `maj`, `Esus4` in A-Moll `min`, `Dsus4` in A-Moll `min`, `D` in A-Dorisch `maj`, Grundton außerhalb der Tonart `null`; `dominantRoot` für A-Moll `E`, C-Dur `G`, A-Dorisch `D`; `chordOptions` für A-Moll hat 7 Einträge mit Grundtönen `A B C D E F G`, der Eintrag `E` enthält `min`-, `maj`- und `dom7`-Arten, `B` enthält `dim`, `m7b5`, `dim7` und kein `maj`; Schreibweise der Grundtöne wie `diatonicChords` (F-Dur enthält `Bb`, Es-Moll `Eb`). In `music.test.js` die Prüfung von `CHORD_QUALITIES` so anpassen, dass sie für `maj/min/dim` die alten Werte prüft und für alle Arten `deepEqual(CHORD_QUALITIES[id], CHORDS[id].intervals)`.
- [ ] **Step 2:** `npm test`. Erwartet: FAIL (`chords.js` fehlt).
- [ ] **Step 3: Implementieren.** `chords.js` mit den Signaturen oben (`deepFreeze` wie in `timbre.js`); `music.js` importiert `CHORDS`/`chordTones`, leitet `CHORD_QUALITIES` ab, ergänzt `dominant` in `MODES` und die drei Funktionen (Schreibweise über das vorhandene `spelling`). Der Kommentar "Neue Akkordart = ein Eintrag hier" zeigt auf `chords.js`.
- [ ] **Step 4:** `npm test`. Erwartet: PASS, einschließlich `golden.test.js`.
- [ ] **Step 5: Commit** `feat: chord registry with 17 qualities and key-aware helpers`.

### Task 2: Namen in beiden Sprachen und öffentliche Ausfuhr

**Files:**
- Modify: `src/i18n/de.js`, `src/i18n/en.js`, `src/index.js`, `tests/core/i18n.test.js`, `tests/core/index.test.js`

**Interfaces:**
- Produces: Schlüssel `chord.<id>` (17), `chordGroup.<group>` (3: `triad` Dreiklänge / Triads, `seventh` Septakkorde / Seventh chords, `extended` Erweiterungen / Extended), `chordColor.<id>` (4: `triads` Dreiklänge / Triads, `sevenths` Septakkorde / Sevenths, `extended` Erweiterungen / Extended, `power` Powerchords / Power chords), `ui.addRoot` (Grundton / Root), `ui.addQuality` (Akkordart / Chord type), `ui.chordColor` (Akkordfarbe / Chord colour). Deutsche Namen der Arten: Dur, Moll, Vermindert, Übermäßig, Sus2, Sus4, Powerchord, Dominantseptakkord, Großer Septakkord, Mollseptakkord, Halbvermindert, Vermindert (Septakkord), Dur mit Sexte, Moll mit Sexte, Dur mit None (add9), Dominantnonenakkord, Mollnonenakkord; englisch Major, Minor, Diminished, Augmented, Sus2, Sus4, Power chord, Dominant seventh, Major seventh, Minor seventh, Half-diminished, Diminished seventh, Major sixth, Minor sixth, Add9, Dominant ninth, Minor ninth.
- Exports in `src/index.js` (additiv): `CHORDS`, `chordName`, `chordOptions`.

- [ ] **Step 1: Tests.** `i18n.test.js`: für jede Registerart `chord.<id>`, für jede Gruppe `chordGroup.<group>`, für jede Akkordfarbe aus der Liste `['triads','sevenths','extended','power']` `chordColor.<id>` in `de` und `en` vorhanden, nicht leer, nicht gleich dem Schlüssel; `index.test.js`: die drei Namen sind exportiert und `chordName({root:'C',quality:'maj7'})` ist `Cmaj7`.
- [ ] **Step 2:** `npm test`. Erwartet: FAIL.
- [ ] **Step 3:** Texte und Ausfuhr ergänzen.
- [ ] **Step 4:** `npm test`. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: chord names in both languages and registry exports`.

### Task 3: Prüfung, Namen und Rad lesen aus dem Register

**Files:**
- Modify: `src/core/track.js:5,75-91`, `src/ui/state.js:15-19`, `src/ui/wheel.js:8-30`, `src/ui/wheel-geometry.js`, `tests/core/track.test.js`, `tests/core/wheel-geometry.test.js`

**Interfaces:**
- Consumes: `chordName`, `isChordQuality`, `chordOptions`, `stepBase`, `qualitiesFor`.
- Produces: `validateTrack` akzeptiert jede Registerart auf einer Stufe, deren Grundart sie laut `on` zulässt (Prüfung nach Tonhöhe des Grundtons und `qualitiesFor(Grundart der Stufe)`, wobei die Stufen aus `allowedChords(key)` samt Dur-Dominante in Moll kommen); unbekannte Art `unknownQuality`, falsche Stufe `chordNotInKey`; `chordName` in `state.js` ist der Registername (`export { chordName }`); `nodeMatches(node, chord, key): boolean` in `wheel-geometry.js` (Grundton gleich nach Tonhöhe und `node.chord.quality === stepBase(chord, key)`); die Beschriftung der Knoten ist `chordShort(node.chord)`.

- [ ] **Step 1: Tests.** `track.test.js`: alle 17 Arten auf einer erlaubten Stufe gültig (A-Moll: `Am7`, `E7`, `Bm7b5`, `Dsus4`, `C5`, `Cadd9`, `Fmaj7`, `G9`; C-Dur: `G7`, `Em7`, `Bm7b5`), auf falscher Stufe `chordNotInKey` (in C-Dur ist `Am7` gültig, `Bmaj7` ungültig weil `B` eine verminderte Stufe ist, `D7` ungültig weil `D` eine Moll-Stufe ist, `G7` und `Cmaj7` gültig), `A#`/`Bb` gleichwertig (in F-Dur sind `Bb7` und `A#7` beide gültig), der Fehlerparameter `chord` nutzt `chordName` (der Fehler für `D7` in C-Dur nennt `D7`); die bestehenden Prüfungen (Dreiklänge) bleiben unverändert. `wheel-geometry.test.js`: `nodeMatches` für `Am7` auf Knoten `A` Moll wahr, auf Knoten `A` Dur falsch; `E7` in A-Moll auf Knoten `E` Dur wahr und auf Knoten `E` Moll falsch; `Dsus4` in A-Moll auf Knoten `D` Moll wahr; `Bm7b5` in A-Moll auf den Knoten `B` vermindert wahr.
- [ ] **Step 2:** `npm test`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.** `track.js` ersetzt `SYMBOLS` durch `chordName` und `known` durch `isChordQuality`; die Stufenprüfung baut die erlaubte Menge aus `allowedChords(key)` (Grundton nach Tonhöhe und Grundart) und `qualitiesFor`. `state.js` löscht `SYMBOLS` und re-exportiert `chordName`. `wheel.js` ersetzt `label`, `same` für Hervorhebung und `nodeOf` durch `nodeMatches`; `allowedAt` bleibt auf den Dreiklängen.
- [ ] **Step 4:** `npm test`. Erwartet: PASS (`golden`, `music`, `track`, `wheel-geometry` und `progressions` unverändert grün).
- [ ] **Step 5: Commit** `feat: validation, names and wheel read the chord registry`.

### Task 4: Muster nutzen die Intervalle des Registers

**Files:**
- Modify: `src/core/events.js:4,135,157,179` (Quinte, Arpeggio-Vorrat, Stabs, Pad), `tests/core/events.test.js`, `tests/e2e/sound.spec.js`
- Test: `tests/core/chord-events.test.js` (neu)

**Interfaces:**
- Consumes: `CHORDS`, `chordTones`.
- Produces: Bass-Grad `5` = Grundton + `CHORDS[q].fifth`; Grad `b7` = Grundton + `(CHORDS[q].seventh ?? 10)`; Arpeggio-Vorrat `pool[i] = tones[i % n] + 12 * Math.floor(i / n) + 12` für `i` 0..3 (n = Tonzahl); Stabs und Pad spielen alle `chordTones(chord, 3)`.

- [ ] **Step 1: Tests.** `chord-events.test.js`: (a) bitgleich für Dreiklänge: `buildEvents` für `maj/min/dim`-Tracks gleich dem Strom vor der Änderung, geprüft über die vorhandenen Golden-Hashes und einen direkten Vergleich des Arpeggio-Vorrats `pool(tones)` für n = 3 mit `[...tones, tones[0]+12].map(m=>m+12)`; (b) Powerchord: für jede der 9 Stil-Vorlagen mit `arpeggio` und ohne, mit und ohne `variety`, über 20 Seeds: alle Noten endlich, ganzzahlig, Bass 28..52, Akkordtöne 24..110, `vel` in (0,1]; (c) Septimen im Bass: Takt `Cmaj7` gefolgt von `F` (der Anlauf `ap` zielt dann auf `E` oder `F#`, nie auf die Septime): über viele Seeds mit `bouncy` und `variety` kommt im Bass die Tonhöhenklasse 11 vor und die Klasse 10 nie; ebenso `C7` gefolgt von `F` (Klasse 10 kommt vor, 11 nie) und `Cdim7` gefolgt von `F` (Klasse 9 kommt vor); Bass-Quinte über `Caug` ist Klasse 8 und über `C5` Klasse 7; (d) Generatortest über alle 17 Arten: für jede Art alle (Tonart, Grundton)-Paare der 12 Grundtöne mal 3 Modi, in denen `chordOptions` sie anbietet, ein Track mit bis zu vier solchen Takten, drei Stile (`funk`, `hardrock`, `dreamy`) mal `variety` an/aus: `validateTrack` leer, Ereignisse sortiert, endlich, in den Bereichen aus (b). `sound.spec.js` (Offline): Track `Am7 Dm7 E7 Am9` und Track `Am5 Dm5 E5 A5` mit Stil `funk`, `fullFromStart`: Spitze nach dem Begrenzer unter 0,9 und jede Schicht mit Effektivwert über 0,005.
- [ ] **Step 2:** `npm test` und `npx playwright test tests/e2e/sound.spec.js --no-deps -g "Septakkord"`. Erwartet: FAIL für (b) bis (d) (Powerchord liefert `undefined`/`NaN` im Arpeggio, Quinte fehlt).
- [ ] **Step 3: Implementieren** in `events.js` wie oben. Bei Pegelabweichung (Spitze 0,9 oder mehr) den Mess-Test entscheiden lassen und nur dann `TRIM`/`peak` anpassen, mit Messwerten im Kommentar.
- [ ] **Step 4:** `npm test` (inklusive `golden`) und der Playwright-Lauf. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: bass, arpeggio, stabs and pad use the registry intervals`.

### Task 5: Akkordfarbe (Logik und Zustand)

**Files:**
- Create: `src/core/harmony.js`, `tests/core/harmony.test.js`
- Modify: `src/ui/state.js` (`chordColor`, `deriveBars`)

**Interfaces:**
- Produces in `harmony.js`: `CHORD_COLORS = ['triads','sevenths','extended','power']`, `colorChord(chord, color, key): chord` (neues Objekt; `stepBase` bestimmt die Grundart; ist sie `maj` und der Grundton die `dominantRoot(key)`, gelten `dom7` (`sevenths`) bzw. `dom9` (`extended`); Tabelle `triads` maj/min/dim; `sevenths` maj7/min7/m7b5; `extended` add9/min9/dim7; `power` power für alle; unbekannte Farbe oder ein Akkord ohne Stufe (`stepBase` null) bleibt unverändert), `colorProgression(bars, color, key): bars` (neue Takte, `beats` unverändert).
- Produces in `state.js`: `state.chordColor` (Standard `'triads'`); `deriveBars()` wendet nach dem Erzeugen die Farbe an.
- Consumes: `stepBase`, `dominantRoot`, `validateTrack`.

- [ ] **Step 1: Tests.** `harmony.test.js`: A-Moll `Am Am Dm E` mit `sevenths` ergibt `Am7 Am7 Dm7 E7`, mit `extended` `Am9 Am9 Dm9 E9`, mit `power` `A5 A5 D5 E5`, mit `triads` zurück `Am Am Dm E`; C-Dur `C F G Am` mit `sevenths` `Cmaj7 Fmaj7 G7 Am7`; A-Dorisch (`Am Bm C D Em F#dim G`): D mit `sevenths` `D7`, `C` `Cmaj7`, `Em` `Em7`, `F#dim` `F#m7b5`; `Esus4` in A-Moll mit `sevenths` `Em7`; `E7` bleibt bei `sevenths` `E7` und wird bei `triads` `E`; `F#dim` mit `extended` `F#dim7`; unbekannte Farbe gibt den Akkord unverändert zurück; **Gesamttest:** für jede Farbe, alle 12 Grundtöne, 3 Modi und die `progressionFor`-Folgen über 40 Seeds besteht `validateTrack` ohne Fehler, und `colorProgression` ändert `beats` nie. Das Wirken von `deriveBars` prüft der E2E-Test in Task 7.
- [ ] **Step 2:** `npm test`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren** `harmony.js`; `state.js` ergänzt `chordColor: 'triads'` und `deriveBars` ruft `colorProgression(..., state.chordColor, state.track.key)`.
- [ ] **Step 4:** `npm test`. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: chord colours (triads, sevenths, extended, power)`.

### Task 6: Zweistufige Akkordauswahl

**Files:**
- Create: `tests/e2e/chord-helpers.js`, `tests/e2e/chord-picker.spec.js`
- Modify: `src/ui/index.html` (Block `#add-chords`), `src/ui/progression-editor.js`, `src/ui/app.css`, `src/i18n/de.js`/`en.js` (falls Beschriftungen fehlen), E2E-Specs: `flow.spec.js:53`, `fretboard.spec.js:39`, `layout-stability.spec.js:32`, `play-page.spec.js:174,203`, `tuning.spec.js:299-302,351,364,384-385,398,407`, `ui.spec.js:206`, `views.spec.js:141`, `groups.spec.js:51`

**Interfaces:**
- Produces: `#add-chords` bleibt Gruppe (`role="group"`, `aria-labelledby="add-title"`) und enthält `#add-roots` (ein Chip je Grundton aus `chordOptions(key)`, `aria-pressed` für den gewählten, vorbelegt mit dem ersten, beim Wechsel der Tonart wieder der erste) und `#add-qualities` (je Gruppe `triad`/`seventh`/`extended` eine beschriftete Chipreihe mit `chordGroup.<group>`; Chip-Text `chordName({root: gewählt, quality})`, `aria-label` `ui.addChordNamed`; `disabled`, wenn die Art für den gewählten Grundton nicht in `qualities` steht). Ein Klick auf einen aktiven Chip ruft `addChord({ root, quality })`, danach wie bisher `changed()` oder bei Ablehnung `render()`. Chips werden wiederverwendet (Fokus bleibt beim Rendern je Takt). Der Hilfsbaustein `addChordByName(page, name, scope = '')` in `chord-helpers.js` zerlegt `name` in Grundton und Art über das Register (`symbol`), klickt den Grundton-Chip und danach den Art-Chip mit dem exakten Text `name` (innerhalb von `scope + ' #add-chords'`).
- Consumes: `chordOptions`, `qualitiesFor`, `chordName`, `addChord`.

- [ ] **Step 1: Tests.** `chord-picker.spec.js` (Spielseite, 1280 px und 360 px): `#add-roots` in A-Moll zeigt `A B C D E F G`, `A` ist zu Beginn gewählt, in `#add-qualities` sind `Am`, `Asus2`, `Asus4`, `A5`, `Am7`, `Am6`, `Am9` aktiv und z. B. `A`, `Aaug`, `A7`, `Amaj7`, `Am7b5` deaktiviert; Wahl von `E` aktiviert `E`, `E7`, `E9`, `Emaj7` und `Em7`; Klick auf `Em7` hängt `Em7` an (Folge zeigt `Em7`, Taktzeile und Griffbrett nennen `Em7`, Fehlerzeile leer, ein Takt mehr); Wahl von `B` aktiviert `Bdim`, `B5`, `Bm7b5`, `Bdim7`; Tastatur: Tab erreicht Grundton-Chips, Leertaste wählt, Tab erreicht aktive Art-Chips, Enter fügt an und der Fokus bleibt auf dem Chip; bei acht Akkorden meldet ein weiterer Klick `ui.progressionFull` (Live-Region) und fügt nichts an; Wechsel der Tonart auf D-Dorisch zeigt die Grundtöne aus `chordOptions`; kein roher Schlüssel in beiden Sprachen (`RAW_KEY`); 360 px: kein waagerechtes Scrollen, alle Chips mindestens 44 px hoch. Die aufgeführten bestehenden Specs auf `addChordByName` bzw. `#add-roots` umstellen (Erwartungen `['Dm','Edim','F','Gm','Am','Bb','C','A']` werden zu den Grundtönen `['D','E','F','G','A','Bb','C']`, `ui.spec.js:206` zu `chordOptions(...).map(o => o.root)`).
- [ ] **Step 2:** `npx playwright test tests/e2e/chord-picker.spec.js --no-deps`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren** (Markup, Editor, CSS: Chipreihen wie `.chips`, Gruppen-Beschriftung klein, `disabled` gedämpft).
- [ ] **Step 4:** `chord-picker`, `tuning`, `play-page`, `flow`, `fretboard`, `layout-stability`, `ui`, `views`, `groups` je mit `--no-deps`. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: two-step chord picker (root, then chord type)`.

### Task 7: Akkordfarbe in der Oberfläche, Rad und Griffbrett

**Files:**
- Modify: `src/ui/index.html` (Gruppe `progression`), `src/ui/progression-editor.js` oder neues `src/ui/chord-color.js`, `src/ui/app.js` (Aufbau und `render`), `src/ui/app.css`
- Test: `tests/e2e/chord-color.spec.js` (neu)

**Interfaces:**
- Produces: Chips `#chord-color` (Gruppe `role="group"`, Überschrift `ui.chordColor`), je Farbe einer mit `data-color` und `chordColor.<id>`, `aria-pressed` = `state.chordColor`. Klick: `state.chordColor = id`, `state.track.bars = colorProgression(bars, id, key)`, danach `changed()` (Neustart bei laufender Wiedergabe, Rendern). Von Hand Hinzugefügtes bleibt unverändert, bis die Farbe erneut gewählt oder die Folge neu erzeugt wird.
- Consumes: `colorProgression`, `CHORD_COLORS`.

- [ ] **Step 1: Tests** (`chord-color.spec.js`): A-Moll Standard `Am Am Dm E` (oder die vom Seed gewählte Folge, geprüft über `shownChords`) mit "Septakkorde" gibt `Am7`, `Dm7`, `E7` an den passenden Stellen, der Chip ist gedrückt; Variantenwechsel behält die Farbe (die neue Folge ist gefärbt); Tonartwechsel nach D-Moll behält die Farbe (`Dm7`, `Gm7`, `A7`); "Dreiklänge" stellt zurück; ein von Hand angehängter `G` bleibt nach Variantenwechsel nicht (neue Folge), nach erneutem Wählen der Farbe wird er gefärbt; Griffbrett: die Textfassung nennt für `Am7` die Töne `A, C, E, G` und für `E7` `E, G#, B, D` (die Hervorhebung am Rad ist in Task 3 durch `nodeMatches` abgedeckt, das Canvas ist nicht lesbar); während der Wiedergabe startet die Farbwahl neu im gleichen AudioContext (`__audioContexts` bleibt 1); beide Sprachen ohne rohen Schlüssel; Tastatur erreicht die Chips.
- [ ] **Step 2:** `npx playwright test tests/e2e/chord-color.spec.js --no-deps`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.** Wheel-Hervorhebung und Weg laufen schon über `nodeMatches` (Task 3); hier nur Chips, Zustand, `render`-Anbindung.
- [ ] **Step 4:** `chord-color`, `chord-picker`, `tuning`, `fretboard`, `play-page` je mit `--no-deps`. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: chord colour chips for the whole progression`.

### Task 8: Doku und Gesamtlauf

**Files:**
- Modify: `docs/interface.md`, `README.md`

- [ ] **Step 1:** `docs/interface.md`: neue Abschnitte "Akkordarten" (Tabelle der 17 mit Symbol, Intervallen, erlaubten Stufen), "Akkordfarbe" (nur Oberfläche und `colorProgression` in `src/core/harmony.js`, nicht aus `src/index.js`), "So ergänzt man eine Akkordart" (ein Eintrag in `CHORDS`, `chord.<id>` in `de.js` und `en.js`, optional `short`; `npm test` prüft Vollständigkeit; keine Änderung an Prüfung, Mustern, Rad, Griffbrett oder Oberfläche), und die Zeile zur Gültigkeit in der Track-Tabelle (Art aus dem Register, Stufe nach `on`); `allowedChords` bleibt dokumentiert als die bisherigen Dreiklänge. `README.md`: ein Absatz zu Akkordauswahl und Akkordfarbe.
- [ ] **Step 2:** `npm test` und `npx playwright test` komplett. Erwartet: alles PASS; Abweichungen einzeln benennen.
- [ ] **Step 3: Commit** `docs: chord qualities, colours and how to add a chord type`.

---

## Selbstprüfung

- Abdeckung: Register (T1), Namen/Ausfuhr (T2), Prüfung/Rad/Namen (T3), Muster inkl. Pegel (T4), Akkordfarbe-Logik und Einstellung (T5), zweistufige Auswahl und Test-Umbau (T6), Farbe-Oberfläche (T7), Doku (T8); Akzeptanz 1 (Golden grün) in jedem Node-Lauf, Akzeptanz 2 in T1 und T4, Akzeptanz 3 in T5, Akzeptanz 4 in T6/T7, Akzeptanz 5 in T8.
- Namen: `CHORDS`, `chordName`, `chordShort`, `chordTones`, `qualitiesFor`, `isChordQuality`, `stepBase`, `dominantRoot`, `chordOptions`, `nodeMatches`, `CHORD_COLORS`, `colorChord`, `colorProgression`, `state.chordColor`, `#add-roots`, `#add-qualities`, `#chord-color` sind in allen Tasks gleich.
- Review-Fokus-Zuordnung: 1 in T4, 2 in T1/T3, 3 in T5/T7, 4 in T3/T7, 5 in T6.
