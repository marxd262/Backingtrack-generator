# Generator vollständig nach JUCE portieren (Gesamtplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Generator-Seite der nativen App spielt alles, was die Web-Version spielt: alle sechs Schichten, alle 41 Stimmen, alle Klangregler, Effekte und die Summe, und die App läuft ohne das Repository daneben.

**Architecture:** Die Oberfläche bleibt die Webseite aus `src/ui` in der WebView; sie rechnet weiter Zustand, Songform, Prüfung, Profile und das Klangmodell in JavaScript. Der Kern in C++ bekommt alles, was klingt: den Ereignisstrom aller Schichten (bitgleich zur Web-App), alle Stimmen, die Effektketten und die Summe. Zahlen, die der Nutzer nach Gehör einstellt (Feinwerte, abgeleitete Klangwerte), bleiben in JavaScript die einzige Quelle und kommen als Daten in den Kern.

**Tech Stack:** C++20 ohne JUCE im Kern (`native/core`), JUCE 9.0.5 nur in `native/app`, WebView2, Node 22 und Playwright für Referenz und Prüfläufe, CMake und ctest über `native\build.ps1`.

**Spec:** [native/PLAN_NATIV.md](../../../native/PLAN_NATIV.md) (Abschnitt 1 und Phasen C bis E), [native/MACHBARKEIT_JUCE.md](../../../native/MACHBARKEIT_JUCE.md) (Abschnitte 2 und 3), [docs/interface.md](../../interface.md) (Vertrag des Generators), [docs/PACK_FORMAT.md](../../PACK_FORMAT.md) und die Bestandsaufnahme unten. Dieser Plan ersetzt die Zeilen C, D und E der Phasentabelle in `PLAN_NATIV.md`.

**Wie dieser Plan gelesen wird:** Er umfasst sieben Phasen. Jede endet mit etwas, das in der App läuft und sich prüfen lässt, und bekommt einen eigenen Zweig. Phase 1 ist bis auf einzelne Schritte ausgearbeitet, weil sie vollständig durch den vorhandenen JavaScript-Code und die Gleichheitsprüfung bestimmt ist. Die Phasen 2 bis 7 nennen je Task Dateien, Schnittstellen und die Prüfung, an der der Task fertig ist; ihre Einzelschritte werden beim Start der Phase ausgeschrieben, weil sie von Messwerten der Phase davor abhängen.

## Bestandsaufnahme (2026-11-18, `develop` bei `47da234`)

Heute gemessen: `npm test` 746 von 746 grün; `native\build.ps1 -NoApp` baut, alle fünf Kerntests grün; Gleichheitsprüfung 387 Tracks, 271 052 Ereignisse, 100 % bitgleich. Nicht neu gelaufen: `npm run test:ui` (Stand 2026-11-17: 355 grün), die App selbst und ihre Prüfläufe.

### Was die native App heute kann

| Bereich | Stand |
|---|---|
| Hülle | Standalone-App (JUCE, WebView2), Leiste mit Seitenwechsel, Sprache und Messwerten; CI auf Windows, Linux, macOS |
| Generator-Seite | Die Web-Oberfläche aus `src/ui` läuft unverändert. Ersetzt sind zwei Dateien: `native/app/web/play.js` (Player) und `load-voices.js` |
| Zu hören | Schlagzeug (immer Naked Drums) und Bass (immer Finger-Bass), egal welche Stimme gewählt ist. Akkorde, Pad, Lead und Percussion sind stumm, ihre Lichter bleiben aus |
| Regler mit Wirkung | Start, Stopp, Tempo, Sprung, Pegel, Stumm und Pan für Schlagzeug und Bass, Gesamtpegel, Bass-Overdrive (vereinfacht) |
| Regler ohne Wirkung | Stimmenwahl, Feinwerte (Orgel), alle übrigen 46 Klangregler |
| Seite für eigene Tracks | fertig (Analyse, Griffbrett, Akkordrad, Spur, Schleife, Geschwindigkeit, Video); nicht Teil dieses Plans |

### Generator (Ereignisstrom): Web gegen Kern

| Baustein (`src/core`) | Im Kern | Fehlt |
|---|---|---|
| Zufall, Takte, Taktarten, 9 Grooves | portiert | nichts |
| Schlagworte, Streuung (`variety`), Komplexität | portiert | nichts |
| Arrangement ohne Form, Songform, Übergänge, Pausen, Crash | portiert (rechnet schon mit allen Schichten) | nichts |
| Mikrotiming | portiert (Werte aller Schichten schon enthalten) | nichts |
| Spieler Schlagzeug, Bass | portiert | nichts |
| Spieler Akkorde (Stabs, Arpeggios), Pad | fehlt | `events.js` |
| Spieler Lead (5 Aufgaben) | fehlt | `lead.js` |
| Spieler Percussion (7 Aufgaben) | fehlt | `percussion.js` |
| Artikulation: Gruppen `drums`, `bass`, `drumsB`, `bassB`, Band-Regeln | portiert | nichts |
| Artikulation: Gruppen `chords`, `keys`, `keysB`, `pad`, `lead` | fehlt | `articulation.js` |
| Orgel-Regeln (Leslie, Schweller) | fehlt | `organ.js` |
| Felder am Ereignis | `art`, `artSemi`, `artTime` | `artRate`, `strum`, `strumUp`, `ring`, `leslie`, `swell` |
| Prüfung des Tracks, Würfeln der Form, Klangmodell, Profile, Akkordfarbe | nicht im Kern | bleibt JavaScript (Abschnitt „Zuschnitt“) |

Der Kern wirft heute bei jeder anderen eingeschalteten Schicht („layer not ported yet“); die Brücke schaltet sie deshalb vor dem Senden aus. Die Referenz der Gleichheitsprüfung ist noch der Tag `port-base`; `src/core` hat sich seitdem geändert (drei neue Modi in `music.js`, `progressions.js`, `lead.js`).

### Klang: Web gegen Kern

| Baustein (`src/audio`) | Web | Kern |
|---|---|---|
| Stimmen | 41 (Schlagzeug 9, Bass 5, Akkorde 17, Pad 3, Lead 5, Percussion 2) | 2, fest verdrahtet |
| Sample-Packs | 26 (24 im Format 1, 2 im Format 2; 66 MB) | Format 1 für Töne, Format 2 für Schläge; je ein Pack |
| Sampler | Zonen, Round-Robin, Raum-Mikrofon, Choke, Release-Samples, Artikulations-Zonen, Strum, Entzerrer der Gitarre, Kit-Panorama | Zonen, Round-Robin, Raum, Choke; Bass-Artikulationen gerechnet (Slide-Vorlauf vereinfacht) |
| Synth-Stimmen | klassisch (Bass, Akkorde, Pad, Lead), Schlagzeug, Percussion, FM-E-Piano, Tonewheel-Orgel mit Leslie, Saitenmodell | keine |
| Effekte je Schicht | Overdrive, Distortion, Fuzz, Box; Vibrato, Chorus (Bass, Akkorde, Pad, Lead) | ein einfacher Verzerrer auf dem Bass |
| Sendewege | Echo (punktierte Achtel), langer Hall, gemeinsamer Raum, Raum-Sendeweg des Schlagzeugs | keine |
| Summe | Helligkeit (Hochregal), Bus-Kompressor, Begrenzer, Breite | Begrenzer als Näherung |
| Klangregler | 47 Felder in 6 Gruppen | 1 (`bass.overdrive`) |
| Feinwerte (`tunables.js`) | 36 Stimmen-Tabellen, 5 Mix-Tabellen, live verstellbar | die Werte zweier Stimmen als feste Zahlen |

### Prüfstand

| Werkzeug | Zweck |
|---|---|
| `btg_parity_tests` mit `native/tools/export-events.mjs` | Ereignisstrom Kern gegen Web, Feld für Feld |
| `btg_render`, `native/tools/render-ab.mjs`, `web-render.mjs` | derselbe Track aus Web und Kern als WAV, für A/B |
| `native/tools/ui-check.mjs` | Oberfläche in der echten App: Fehler, Position, Pegel, Reaktionszeit (stumm) |
| `btg_engine_tests` | Engine: Transport, Schleife, Pegel |

## Zuschnitt

**In den Kern (C++):** Ereignisse aller Schichten, alle Stimmen, Effekte, Sendewege, Summe.

**Bleibt JavaScript in der WebView:** Zustand der Oberfläche, `validateTrack`, `rollForm`, Akkordfolge und Akkordfarbe, Profile, Sitzung, Klangmodell aus Schlagworten (`resolveTrackTimbre`), die Umrechnung der Klangregler in Stimmenwerte (`voice-params.js`, `fx-params.js`, `modParams`) und die Feinwerte. Der Ereignisstrom wird weiter zweimal gebaut (JavaScript für die Anzeige, Kern für den Klang); die Gleichheitsprüfung hält beide zusammen.

**Gestrichen, mit Grund:**

- `validateTrack`, `rollForm`, Klangmodell und Profile in C++ (standen in `MACHBARKEIT_JUCE.md`, Abschnitt 3): ohne Aufrufer, solange die Oberfläche die WebView ist. Kommt mit einem Plugin, das ohne offenes Fenster Tracks bauen muss.
- Alle Regler als JUCE-Parameter (`AudioProcessorValueTreeState`): nötig erst für die Automation in einer DAW. Die App merkt sich alles wie die Web-Version (`localStorage` im WebView-Profil).
- Eigenes Fenster für die Audio-Einstellungen: das Fenster der JUCE-Hülle reicht.
- Regelgruppe `chordsB` (Slide-Akkord, Verzierung): im Standard aus (`ART_DEFAULTS.chordsB = 0`) und in der Oberfläche nicht einschaltbar.
- Optionen `timing` und `ornaments` von `play`: nur die Hörprobe-Seite gibt sie mit, die Oberfläche nie.
- Hörprobe- und Spektrogramm-Seite (`render-harness.html`, `spectrogram.html`): bleiben Web-Werkzeuge.
- Installer, Signierung, Updates (Phase G in `PLAN_NATIV.md`) und der pausierte Sample-Wechsel (`docs/sound-v2/UEBERGABE_SAMPLES.md`): eigene Pläne.

## Global Constraints

- Der Kern bleibt C++20 ohne JUCE und baut unter Windows, Linux und macOS; `/fp:precise` und `-ffp-contract=off` bleiben.
- Ereignisstrom: gegen die Web-App im Arbeitsstand bitgleich, also `with differences: 0` und `close: 0, different: 0`.
- Der Code des Generators folgt dem JavaScript Zeile für Zeile; Namen der JavaScript-Funktionen bleiben (Regel aus `generator_internal.h`).
- Audio-Thread: keine Sperre, keine Speicheranforderung, kein Dateizugriff.
- Keine neue Abhängigkeit ohne Zustimmung des Nutzers, nichts unter GPL, AGPL oder NC; jede steht vor der Nutzung in `native/LICENSES.md`.
- `src/` darf geändert werden, solange die Web-Version nicht kaputtgeht: vor und nach jeder Änderung an `src/` `npm test` und `npm run test:ui`, beide grün.
- Bausteine, die Generator- und Backingtrack-Seite teilen, liegen in `src/`; die App ersetzt Dateien nur über die Liste `shims` in `native/app/PluginEditor.cpp`.
- Ein Zweig je Phase von `develop`; Commits auf Englisch, ein Thema je Commit; nicht pushen; nach `develop` nur auf Ansage des Nutzers per Squash.
- Prüfläufe der App laufen stumm (`BTG_MUTE=1`).
- Klangabgleich, Startwerte der Grenzen (gemessen von `native/tools/sound-compare.mjs`, Task 9): Sample-Stimmen Pegel ±0,5 dB, je Oktavband ±1,5 dB, Hüllkurve gleich zu mindestens 0,98; Synth-Stimmen und Effekte ±1 dB, ±3 dB, 0,95. Verfehlt eine Stimme die Grenze, steht die Zahl im Bericht; das letzte Wort hat das Gehör des Nutzers.
- Last der Engine höchstens 25 % eines Puffers von 480 Frames bei 48 kHz mit allen Schichten; `ui-check.mjs` meldet 0 Aussetzer.
- Die Seite scrollt nie seitwärts; die Visualisierung wird nicht verkleinert.
- Hörproben und App startet der Nutzer mit einem Schritt (`native\start.cmd`, ein Skript je Hörprobensatz).
- Einfache Lese- und Fleißaufgaben gehen an günstigere Subagenten.

## Review Focus

1. **Pack fehlt oder ist beschädigt** (Datei gelöscht, JSON abgeschnitten): Die App läuft weiter, die Schicht bleibt stumm, die Leiste nennt Pack und Grund. Test in Task 10.
2. **Stimmenwechsel mitten im Ton**, auch mehrmals je Sekunde: alte Töne klingen aus, kein Knacken über −40 dBFS, kein Absturz. Test in Task 10.
3. **Tempo 20 und 400 bpm mit allen Schichten**: kein Aussetzer, kein NaN, kein Vollausschlag; das Echo bei 20 bpm (2,25 s) passt in seinen Speicher. Test in Task 15.
4. **Sprung und Schleife bei liegenden Tönen** (Pad, Orgel, ausklingende Gitarre): kein hängender Ton, nach dem Sprung klingt nur noch die Ausklingzeit. Test in Task 11.
5. **Andere Abtastraten als 48 kHz** (44,1 und 96 kHz): gleiche Tonhöhe, gleiche Länge, Hall und Raum gleich lang. Test in Task 14.

---

## Phase 1: Ereignisstrom aller Schichten (Zweig `feat/port-events`)

Fertig, wenn der Kern für jeden gültigen Track dieselben Ereignisse baut wie die Web-App. Zu hören ist danach noch nichts Neues.

### Task 1: Referenz ist der Arbeitsstand

**Files:**
- Modify: `native/tools/export-events.mjs` (Zeilen 1 bis 27: kein `git archive`, kein `tar`)
- Modify: `.github/workflows/native.yml` (Schritt „Fetch the tag port-base“ entfällt; `push` auf `develop`; `paths` um `src/core/**` ergänzt)
- Modify: `native/core/CMakeLists.txt` (Kommentar am Test `parity`)

**Interfaces:**
- Produces: `node native/tools/export-events.mjs <outDir> [--data]` liest `src/` des Arbeitsbaums und schreibt `<outDir>/cases.json` wie bisher.

- [ ] **Step 1:** In `export-events.mjs` die Zeilen mit `base`, `rmSync`, `execFileSync('git', …)` und `execFileSync('tar', …)` entfernen; `load` importiert aus `join(repo, 'src', file)`. Kopfkommentar anpassen.
- [ ] **Step 2:** `native\build.ps1 -NoApp`, dann `native\build\core\Release\btg_parity_tests.exe native\build\parity\cases.json`. Erwartet: `tracks: 387, bit-identical: 387, with differences: 0`. Weicht etwas ab, hat sich `src/core` seit `port-base` für Schlagzeug oder Bass geändert: die Abweichung im Kern nachziehen, nicht die Referenz zurückdrehen.
- [ ] **Step 3:** `native.yml` anpassen (siehe Files).
- [ ] **Step 4:** Commit `test(native): the parity reference is the working tree, not the tag port-base`.

### Task 2: Die Prüfung vergleicht jedes Feld, das die Referenz schreibt

**Files:**
- Modify: `native/core/include/btg/generator.h` (Felder an `Event`)
- Modify: `native/core/tests/test_parity.cpp` (`compare`)
- Modify: `native/tools/export-events.mjs` (`add` nimmt `extra.layers`)

**Interfaces:**
- Produces, an `btg::Event`: `std::optional<double> artRate;` `std::optional<std::pair<int, int>> strum;` (Index und Anzahl im Stab) `std::optional<double> strumUp, leslie, swell;` `bool ring = false;`
- Produces, in `export-events.mjs`: `add(name, style, seed, extra)` setzt `layers: extra.layers ?? ONLY`.

- [ ] **Step 1:** In `test_parity.cpp` jedes Ereignis des Kerns in ein JSON-Objekt schreiben (nur gesetzte Felder; `ring` nur wenn wahr) und gegen das Referenzobjekt vergleichen: gleiche Schlüsselmenge, Texte gleich, Zahlen wie bisher (`identical`, `close`, `different`). Ein Schlüssel, der nur auf einer Seite steht, ist `different` mit dem Namen des Schlüssels.
- [ ] **Step 2:** Probe, dass die Prüfung fehlende Felder sieht: in `export-events.mjs` vorübergehend einen Fall mit `layers: { ...ONLY, pad: true }` anhängen, bauen, Prüfung laufen lassen. Erwartet: `FAIL …: layer not ported yet: pad`. Den Fall wieder entfernen.
- [ ] **Step 3:** Die neuen Felder an `Event` ergänzen (siehe Interfaces). Prüfung: 387 von 387 bitgleich.
- [ ] **Step 4:** Commit `test(native): the parity test compares every field the reference writes`.

### Task 3: Alle Schichten im Arrangement, Stimmen und Aufgaben im Track, Pad

**Files:**
- Modify: `native/core/src/generator_internal.h` (`Track`, `Section`)
- Modify: `native/core/src/generator.cpp` (`parseTrack`, `buildArrangement`, `buildFormArrangement`, `buildSong`, neuer Spieler `playPad`)
- Modify: `native/core/src/articulation.cpp` (Aufrufer von `bassVariant`, `drumsVoice` in den Zeilen 187, 221, 350; Regelgruppe `pad`)
- Modify: `native/tools/export-events.mjs` (Fallgruppe `pad`)

**Interfaces:**
- Produces, in `Track`: `struct Voice { std::string id, variant; }; std::map<std::string, Voice> voices;` (ersetzt `bassVariant`, `drumsVoice`) und `std::map<std::string, std::string> jobs;`
- Produces, in `Section`: `std::map<std::string, bool> layers;` (ersetzt `drums`, `bass`) mit `bool plays(const std::string& layer) const`.
- Produces: `std::vector<int> chordTones(const Chord& chord, int octave);` in `generator_internal.h` (nach `music.js`), mit den Intervallen der 17 Akkordarten aus `src/core/chords.js`.

- [ ] **Step 1:** Fallgruppe `pad` in `export-events.mjs`: je Stil sechs Seeds mit gewürfelter Form und zwei ohne Form, `layers` Schlagzeug, Bass, Pad; die Pad-Stimme wechselt über `sample/strings`, `sample/warm`, `synth/classic`; die Tonart läuft zusätzlich über `phrygian`, `lydian`, `mixolydian` (`KEYS` ergänzen); zwei Stile mit `tags.mood: ['dreamy']`, damit `padWidth` über 0,6 das Voicing verdoppelt.
- [ ] **Step 2:** Prüfung laufen lassen. Erwartet: die 72 neuen Fälle scheitern mit `layer not ported yet: pad`.
- [ ] **Step 3:** `Track` und `Section` umbauen (siehe Interfaces), `parseTrack` liest `voices` und `jobs` aller Schichten. `lead` spielt, wo `chords` spielt, `percussion`, wo `drums` spielt (`follows` in `src/core/layers.js`). Im Lambda `run` von `buildSong`: Schichten mit `follows` haben keine Münze, also kein `coinHit` und keine Neuwahl bei Dichtewechsel.
- [ ] **Step 4:** `playPad` nach `events.js` und die Regelgruppe `pad` nach `articulation.js` (Zeile 314). Reihenfolge der Gruppen in `articulate` wie `RULES` in JavaScript: `drums`, `bass`, `keys`, `lead`, `pad`, `chords`, `keysB`, `drumsB`, `bassB`, danach `organRules`. Die Sperre in `buildSong` lässt `pad` durch.
- [ ] **Step 5:** Prüfung: alle Fälle bitgleich.
- [ ] **Step 6:** Commit `feat(native): the generator plays the pad; tracks carry voices and jobs of every layer`.

### Task 4: Akkorde mit den Gitarren-Regeln

**Files:**
- Modify: `native/core/src/generator.cpp` (`chordsSection`, `playChords`, `arpPool`)
- Create: `native/core/src/articulation_internal.h` (`Context`, `Env`, `barContexts`, `profileOf` aus `articulation.cpp`)
- Create: `native/core/src/articulation_harmony.cpp` (Regelgruppe `chords`; später `keys`, `keysB`, `lead`)
- Modify: `native/core/src/articulation.cpp`, `native/core/CMakeLists.txt`, `native/tools/export-events.mjs`

**Interfaces:**
- Consumes: `chordTones`, `Section::plays`, `Track::voices` aus Task 3.
- Produces: `void chordRules(Env& env);` in `articulation_internal.h`.

- [ ] **Step 1:** Fallgruppe `chords`: `layers` Schlagzeug, Bass, Akkorde, Pad; je Stil die elf Stimmen `sample/guitar`, `muted`, `jazz`, `funk`, `steel`, `nylon`, `twelve`, `freepats`, `freepatsjazz`, `synth/classic`, `string/electric` (das E-Piano hat eigene Regeln, Task 5); die Akkordfarbe läuft über die vier Farben (`colorProgression` aus `src/core/harmony.js`); je Groove ein Fall mit `tags.synths: ['arpeggio']` (Kategorie nach `EFFECTS` in `tags.js`), damit Arpeggios vorkommen; `ornaments` 0, 0,5 und 1.
- [ ] **Step 2:** Prüfung: die neuen Fälle scheitern mit `layer not ported yet: chords`.
- [ ] **Step 3:** Spieler und Regelgruppe `chords` portieren (`articulation.js` ab Zeile 344, Profile `PROFILES…guitar`, Menge `GUITARS`, Band-Regeln für die Gitarre). Felder `strum`, `strumUp`, `ring` setzen.
- [ ] **Step 4:** Prüfung: alle Fälle bitgleich.
- [ ] **Step 5:** Commit `feat(native): the generator plays the chords with the guitar rules`.

### Task 5: Tasten-Regeln und Orgel

**Files:**
- Modify: `native/core/src/articulation_harmony.cpp` (Gruppen `keys`, `keysB`)
- Create: `native/core/src/organ.cpp` (`organRules` nach `src/core/organ.js`)
- Modify: `native/core/CMakeLists.txt`, `native/tools/export-events.mjs`

**Interfaces:**
- Produces: `void keyRules(Env& env); void keyRulesB(Env& env); void organRules(Env& env, const std::vector<Section>& sections);`

- [ ] **Step 1:** Fallgruppe `keys`: Akkord-Stimmen `epiano/rhodes`, `sample/epiano`, `organ/jazz`, `organ/rock`, `organ/gospel`, `organ/ballad` mal neun Stile, mit Form (Refrain und Aufbau kommen vor) und einmal ohne.
- [ ] **Step 2:** Prüfung: Abweichungen in `art`, `leslie`, `swell`.
- [ ] **Step 3:** Die drei Regeln portieren. `leslie` und `swell` nur bei `voices.chords.id == "organ"`.
- [ ] **Step 4:** Prüfung: alle Fälle bitgleich. Commit `feat(native): key rules and the organ's leslie and swell`.

### Task 6: Lead

**Files:**
- Create: `native/core/src/lead.cpp` (`lead.js`: `fills`, `arpeggio`, `melody`, `callResponse`, `riff`, `LEAD_SCALE`)
- Modify: `native/core/src/generator_internal.h`, `generator.cpp` (`buildSong`), `articulation_harmony.cpp` (Gruppe `lead`), `CMakeLists.txt`, `export-events.mjs`

**Interfaces:**
- Produces: `struct LeadState { int start = 0, bars = 0; /* dazu, was die Aufgaben über den Teil merken */ };` und `void playLead(std::vector<Event>& events, const Bar& b, LeadState& v, Rng& rng, const Params& params, bool fill, const Groove& g, const Track& track);` Die Aufgabe `off` schreibt nichts und zieht keine Zufallszahl.
- Produces: `std::vector<int> scalePcs(const std::string& keyRoot, const std::string& scale);` und `std::vector<Chord> diatonicChords(const std::string& keyRoot, const std::string& keyMode);` nach `music.js` (Leitern, die `LEAD_SCALE` nennt; alle sechs Modi). Die Regelgruppe `lead` unterscheidet die Stimmen `sax` und `sample/guitar`.

- [ ] **Step 1:** Fallgruppe `lead`: fünf Aufgaben mal sechs Modi mal drei Stile, die Lead-Stimme läuft über die fünf Stimmen; dazu je Groove ein Fall mit `riff` (im Shuffle gilt eine eigene Regel).
- [ ] **Step 2:** Prüfung: `layer not ported yet: lead`.
- [ ] **Step 3:** Spieler und Regelgruppe `lead` portieren (Artikulationen `scoop`, `fall`, `slideIn`, `vibrato` mit `artRate`).
- [ ] **Step 4:** Prüfung: alle Fälle bitgleich. Commit `feat(native): the generator plays the lead`.

### Task 7: Percussion

**Files:**
- Create: `native/core/src/percussion.cpp` (`percussion.js`: sieben Aufgaben, Tabellen `CONGAS`, `BONGOS`)
- Modify: `generator_internal.h`, `generator.cpp`, `CMakeLists.txt`, `export-events.mjs`

**Interfaces:**
- Produces: `void playPercussion(std::vector<Event>& events, const Bar& b, Rng& rng, const Params& params, const Groove& g, const std::string& job);`

- [ ] **Step 1:** Fallgruppe `percussion`: sieben Aufgaben mal neun Grooves, Komplexität 0,1, 0,5 und 0,9.
- [ ] **Step 2:** Prüfung: `layer not ported yet: percussion`.
- [ ] **Step 3:** Portieren; die Sperre in `buildSong` entfällt ganz.
- [ ] **Step 4:** Prüfung: alle Fälle bitgleich. Commit `feat(native): the generator plays the percussion`.

### Task 8: Alles zusammen

**Files:**
- Modify: `native/tools/export-events.mjs`, `native/core/include/btg/generator.h` (Kommentar), `native/UEBERGABE.md`

- [ ] **Step 1:** Fallgruppe `full`: alle Schichten an, je Stil zehn Seeds mit Form (Stimmen des Stils) und vier ohne, dazu je Groove zwei Fälle mit Takten anderer Länge (`oddBeats`). Die alten Gruppen bekommen keine neuen Schichten, sie bleiben die Sicherung für Schlagzeug und Bass allein.
- [ ] **Step 2:** Prüfung: `with differences: 0`, `close: 0`. Laufzeit von Export und Prüfung zusammen unter 60 s, sonst die Seeds der Gruppe `full` halbieren.
- [ ] **Step 3:** `native\build.ps1` (mit App) und `node native/tools/ui-check.mjs`: 0 Fehler. Die App klingt unverändert, weil die Brücke die neuen Schichten noch ausschaltet.
- [ ] **Step 4:** `native/UEBERGABE.md` um den Stand ergänzen. Commit `test(native): parity over all six layers`.

---

## Phase 2: Die ganze Band mit Samples (Zweig `feat/port-samples`)

Fertig, wenn in der App alle sechs Schichten mit ihren Sample-Stimmen spielen und die Stimmenwahl wirkt. Ohne Hall, Echo und Schicht-Effekte; Synth-Stimmen bleiben bis Phase 5 stumm.

### Task 9: Messwerkzeug für den Klangabgleich

**Files:**
- Create: `native/tools/sound-compare.mjs`
- Modify: `native/core/tools/render.cpp` (Schalter `--dry`: ohne Begrenzer)
- Modify: `native/tools/web-render.mjs` (Option für Klangmodell, Feinwerte und `limiter: false`)

**Interfaces:**
- Produces: `node native/tools/sound-compare.mjs <fälle.json> [ordner]` rendert jeden Fall (`{ name, track, sound?, tuning?, dry? }`) mit Web und Kern, schreibt `<name>-web.wav` und `<name>-nativ.wav` und eine Zeile je Fall: Pegelunterschied in dB, größter Unterschied der acht Oktavbänder von 63 Hz bis 8 kHz, Gleichheit der Hüllkurve (Korrelation der Pegel in 50-ms-Fenstern), bestanden oder nicht nach den Grenzen der Global Constraints. Endet mit Fehlercode, wenn ein Fall durchfällt.
- „Trocken“ heißt auf beiden Seiten: `master.reverb` 0, `master.echo` 0, Feinwert `mix/room.wet` 0, kein Begrenzer.

**Prüfung:** Der vorhandene Fall `native/core/tests/track-funk.json` (Schlagzeug und Bass) besteht trocken; ein absichtlich um 2 dB leiser gestellter Bass fällt durch.

### Task 10: Stimmen und Packs wählen, laden, wechseln

**Files:**
- Modify: `native/core/include/btg/engine.h`, `native/core/src/engine.cpp`
- Create: `native/core/data/sound.json` (erzeugt), `native/core/src/sound_data.cpp` (liest sie)
- Modify: `native/tools/export-events.mjs` (`--data` schreibt auch `sound.json`), `native/core/CMakeLists.txt` (zweite Datendatei wie `grooves.json`)
- Modify: `native/app/PluginProcessor.cpp`, `PluginProcessor.h`, `PluginEditor.cpp`
- Test: `native/core/tests/test_engine.cpp`

**Interfaces:**
- Produces, `btg::Engine`:
  - `enum Layer { drums, bass, chords, pad, lead, percussion, layerCount };`
  - `void setPackFolder(const std::string& folder);` ersetzt `setPack`; `btg_render`, `test_engine.cpp` und `PluginProcessor.cpp` ziehen nach.
  - `void setVoices(const std::string& voicesJson);` lädt fehlende Packs auf dem rufenden Thread (nie dem Audio-Thread) und tauscht sie wie den Song; `setTrack` ruft es mit `track.voices`.
  - `void setTuning(const std::string& tuningJson);` Überschreibungen der Feinwerte, Form wie `setTuning` der Web-App.
  - `std::string voiceStatus() const;` JSON `{ schicht: "ready" | "error: <grund>" | "silent" }`
- Produces, `sound.json`: `tunables` (Standardwerte aus `TUNABLES` und `MIX_TUNABLES`), `packs` (Stimme zu Pack-ID nach `packIdFor`, samt der geteilten Packs), `hitKeys` (`HIT_KEYS`, Rimshot-Kit mit Taste 37 als Snare), `layerAudio` (`LAYER_AUDIO`), `kitPan` (`KIT_PAN`).
- Die App lädt auf einem eigenen Thread (nicht dem der Oberfläche) und meldet der Seite das Ergebnis als Ereignis `voices`.

**Entscheidung:** Solange ein Pack lädt, spielt die bisherige Stimme der Schicht weiter. Den Rückfall der Web-Version auf den Synth gibt es nicht, weil die Packs von der Platte in unter einer Sekunde da sind.

**Prüfung:** Engine-Test: Stimmenwechsel in jedem Block über 10 s Spielzeit, Ausgabe endlich und ohne Sprung über −40 dBFS; ein Pack-Ordner ohne `pad-strings.json` ergibt `voiceStatus().pad` mit `error:` und die anderen Schichten spielen (Review Focus 1 und 2). Ein Test hält `sound.json` aktuell: Export in einen Zwischenordner, Vergleich mit der eingecheckten Datei.

### Task 11: Ton-Stimmen aus Samples (Bass, Akkorde, Pad, Lead)

**Files:**
- Modify: `native/core/src/engine.cpp`; bei über 800 Zeilen den Sampler nach `native/core/src/sampler.cpp` mit `sampler.h` auslagern
- Test: `native/core/tests/test_engine.cpp`, Fälle für `sound-compare.mjs` unter `native/tools/sound-cases/samples.json`

**Inhalt** (nach `src/audio/voices/sample.js`, `sampler.js`, `sample-zones.js`): Feinwerte je Stimme aus `sound.json` (`level`, `decay`, `velExp`, `softHz`, `oneShot`, `humanCents`, `humanDb`, `strum`, `release`); Strum aus `strum` und `strumUp`; `ring`; Entzerrer der Gitarre (`lowDb`, `midDb`, `midHz`, `highDb`, `highHz`, Hochpass 50 Hz); Zonen mit eigener Artikulation (`pickArtZone`) und Release-Samples im Format 2; gerechnete Artikulationen `palmMute`, `dead`, `staccato`, `hammer`, `pull`, `slideIn`, `slideOff`, `chuck`, `choke`, `scoop`, `fall`, `vibrato` (`artRate`), `swell`; der Slide beginnt `artTime` vor dem Ton (heute im Kern als `shortcut:` vermerkt). `lead/sample/guitar` spielt das Pack `chords-freepats`. Bei einem Sprung enden die Töne aller Ton-Schichten.

**Prüfung:** `sound-compare.mjs` trocken, je Stimme ein Solo-Fall (3 Bass, 10 Akkorde, 2 Pad, 4 Lead) im Stil, der die Stimme vorschlägt, dazu je ein Fall mit `ornaments: 1`. Engine-Test zu Review Focus 4: Sprung während eines Pad-Akkords, 2,5 s später liegt die Ausgabe unter −60 dBFS.

### Task 12: Schlag-Stimmen aus Samples (alle Kits, Percussion)

**Files:**
- Modify: `native/core/src/engine.cpp` oder `sampler.cpp`
- Test: Fälle `native/tools/sound-cases/kits.json`

**Inhalt** (nach `sample-hits.js`): Format-1-Kits über `hitKeys` (`brushes`, `jazz`, `electronic`, `808`, `legacy`, `percussion/studio`) mit `layerSpread` und dem Choke der geschlossenen Hi-Hat; Format 2 mit den Feinwerten je Kit (`level`, `velCurve`, `roomMic`, `kitPan`) für `standard`, `rimshot`, `muldjord`; Rückfall der Schlagarten nach `DRUM_FALLBACK`; `flam` und `choke`.

**Prüfung:** `sound-compare.mjs` trocken, je Kit ein Solo-Fall mit Fill und Crash (acht Kits, Percussion mit `mixed`).

### Task 13: Sechs Kanäle, und die App spielt die Band

**Files:**
- Modify: `native/core/src/engine.cpp` (Kanal je Schicht: Stumm, Pegel, `trim` aus `layerAudio`, Balance)
- Modify: `native/app/web/play.js` (kein `playable` mehr; `setVoices`, `setTuning`, Pegel und Pan aller Schichten), `native/app/web/load-voices.js` (wartet auf das Ereignis `voices`)
- Create: `native/app/web/sampler.js` (ersetzt `/audio/voices/sampler.js` für `voices-panel.js`: `loadPack`, `peekPack` fragen die Engine)
- Modify: `native/app/PluginEditor.cpp` (`shims`, Nachrichten `voices`, `tuning`, Pegel für sechs Schichten)
- Modify: `native/tools/ui-check.mjs`
- Create: `native/tools/ab-samples.cmd` (ein Schritt: rendert den A/B-Satz und öffnet den Ordner)

**Inhalt:** Die Balance rechnet wie die Web-Version (links `1 − p`, rechts `1 + p`; die heutige Formel im Kern weicht ab), die Lage ohne Angabe kommt aus `mix/pan`. Kit-Panorama je Schlag für Kits mit `kitPan` ungleich 0.

**Prüfung:** `ui-check.mjs`: nach „Los“ haben alle eingeschalteten Schichten einen Pegel über 0, ihre Lichter leuchten, ein Stimmenwechsel im Spiel ändert den Klang ohne Fehler, 0 Konsolenfehler, 0 Aussetzer, Last unter 25 %. Danach A/B-Satz für den Nutzer: je Stil ein Track, trocken, Web und nativ (`native\tools\ab-samples.cmd`).

---

## Phase 3: Sendewege und Summe (Zweig `feat/port-mix`)

Fertig, wenn ein ganzer Track mit Sample-Stimmen aus Web und Kern innerhalb der Grenzen gleich klingt, mit Hall, Raum, Echo und Summe.

### Task 14: Faltungshall und Raum

**Files:**
- Create: `native/core/src/convolver.h`, `convolver.cpp` (Faltung in gleich langen Blöcken über `fft.h`, ohne Speicheranforderung beim Rendern)
- Modify: `native/core/src/engine.cpp`

**Inhalt** (nach `synth.js`): langer Hall (Rauschen aus dem Seed, 2 s, als Impulsantwort; `noiseBuffer` in `src/audio/nodes.js`) für die Summe und den Raum-Sendeweg von Schlagzeug und Percussion; gemeinsamer Raum (Länge aus `master.roomSize`, Sendeanteil je Schicht hinter der Balance, Rückweg mit Hochpass 120 Hz und Tiefpass). Der Browser normiert Impulsantworten; die Normierung steht im Chromium-Quelltext (`Reverb.cpp`, `calculateNormalizationScale`) und wird dort nachgelesen, nicht aus dem Gedächtnis gesetzt.

**Prüfung:** `sound-compare.mjs` mit Hall und Raum an, Schlagzeug solo und ganzer Track. `btg_render` bei 44 100 und 96 000 Hz: Grundton eines Bass-Tons auf 2 Cent gleich, Länge der Datei auf 1 ms gleich (Review Focus 5).

### Task 15: Echo

**Inhalt:** punktierte Achtel für Akkorde, Pad und Lead, hinter dem `trim` abgegriffen; Rückkopplung, Tiefpass; folgt einem Tempowechsel mit 50 ms Zeitkonstante; Speicher 3 s.

**Prüfung:** `sound-compare.mjs` mit Echo; `btg_render` bei 20 und 400 bpm mit allen Schichten: keine NaN, Spitze unter 1,0, Last unter der Grenze (Review Focus 3).

### Task 16: Klangmodell der Summe und der Sample-Stimmen

**Files:**
- Modify: `native/core/include/btg/engine.h` (`void setSound(const std::string& soundJson);`), `engine.cpp`
- Modify: `native/app/web/play.js` (`sendTimbre` schickt die abgeleiteten Werte), `native/app/PluginEditor.cpp`
- Modify: `native/tools/export-events.mjs` (`sound.json` bekommt `neutral`: die abgeleiteten Werte bei `DEFAULT_TIMBRE`)

**Interfaces:**
- `soundJson`: `{ master: masterParams(...), drums: drumParams(...), bass: bassParams(...), chords: chordParams(...), pad: padParams(...), raw: <Klangmodell 0 bis 1>, fx: { schicht: fxChainParams(...) }, mod: { schicht: modParams(...) } }`. Die Brücke rechnet es aus `resolveTrackTimbre(track)` und dem Tempo; der Kern rechnet nichts davon selbst.

**Inhalt:** Helligkeit (Hochregal), Hall- und Echo-Anteil, Breite, Raumgröße und Raumanteil, Raum-Sendeweg des Schlagzeugs; an den Sample-Stimmen Tiefpass (`bass.cutoff`, `chords.brightness`, `pad.cutoff`) und Hüllkurvenzeiten (`chords.length`, `pad.attack`). Der bisherige Parameter `bassDrive` und der einfache Verzerrer entfallen mit Task 18.

**Prüfung:** `sound-compare.mjs` mit drei Klangmodellen (neutral, Stil Psych, Stil Träumerisch) auf dem ganzen Track.

### Task 17: Bus-Kompressor und Begrenzer

**Files:**
- Create: `native/core/src/compressor.h`, `compressor.cpp`
- Modify: `native/core/src/engine.cpp`, `native/LICENSES.md`
- Create: `native/tools/ab-mix.cmd`

**Inhalt:** Nachbau des Kompressors des Browsers (Vorlauf 6 ms, Knie, anpassende Rückstellzeit, automatische Anhebung) zweimal hintereinander wie in `synth.js` (`applyBus`), mit den Feinwerten `mix/bus`. **Braucht vorher die Zustimmung des Nutzers** (offene Entscheidung 2): Der Nachbau folgt dem Chromium-Quelltext (BSD-3-Clause), das ist eine neue Quelle mit Namensnennung.

**Prüfung:** `sound-compare.mjs` auf ganzen Tracks aller neun Stile mit Begrenzer: Pegel ±0,5 dB, Spitzen ±1 dB. Danach A/B-Satz für den Nutzer (`native\tools\ab-mix.cmd`).

---

## Phase 4: Effekte der Schichten (Zweig `feat/port-fx`)

### Task 18: Verzerrerkette

**Files:** Create `native/core/src/guitar_fx.h`, `guitar_fx.cpp`; Modify `engine.cpp`, `native/app/PluginProcessor.cpp` (Parameter `bassDrive` entfällt).

**Inhalt** (nach `guitar-fx.js`, Werte aus `soundJson.fx`): Overdrive, Distortion, Fuzz, Box je Schicht für Bass, Akkorde, Pad und Lead; Kennlinien und Überabtastung wie dort; alle Regler auf 0 lassen das Signal unverändert (bitgleich zum Eingang).

**Prüfung:** Engine-Test „alle Regler 0: Ausgang gleich Eingang“; `sound-compare.mjs` je Stufe einzeln bei 0,3 und 1,0 auf der Sample-Gitarre und dem Bass (Grenzen der Synth-Stimmen).

### Task 19: Vibrato und Chorus

**Files:** Create `native/core/src/mod_fx.h`, `mod_fx.cpp`; Modify `engine.cpp`.

**Inhalt** (nach `mod-fx.js`, Werte aus `soundJson.mod`): Vibrato über eine bewegte Verzögerung, Tempo folgt dem Songtempo; Chorus mit zwei Kopien links und rechts; beide 0: unverändert.

**Prüfung:** wie Task 18; dazu der Stil Psych (Chorus auf der Sample-Gitarre aus den Schlagworten). A/B-Satz für den Nutzer.

---

## Phase 5: Synth-Stimmen (Zweig `feat/port-synths`)

Je Stimme eine Datei unter `native/core/src/voices/`, alle hinter derselben Schnittstelle wie die Sample-Stimmen (die Phase 2 festlegt). Reihenfolge nach Nutzen; nach jedem Task ein A/B-Satz.

| Task | Stimmen | Vorlage | Besonderheit |
|---|---|---|---|
| 20 | Tonewheel-Orgel, vier Zugriegel-Presets, mit Leslie | `voices/organ.js`, `organ-leslie.js` | Felder `leslie`, `swell`, `art: swell`; Feinwerte der Oberfläche (Leslie, Zerre) über `setTuning` |
| 21 | FM-E-Piano | `voices/epiano.js` | Tremolo aus `chords.tremolo` |
| 22 | klassischer Synth: Bass, Akkorde, Pad, Lead | `voices/classic.js`, `voice-params.js` | bandbegrenzte Oszillatoren; der Akkord-Synth macht seinen Chorus selbst, die Kette lässt ihn dann aus |
| 23 | Synth-Schlagzeug und Synth-Percussion | `voices/drums.js`, `percussion.js` | Rauschen aus dem Seed wie im Web (`noiseBuffer`) |
| 24 | Saitenmodell: Bass und E-Gitarre (in der Oberfläche versteckt) | `string-model.js`, `voices/string.js` | reine Rechnung ohne Browser, Töne vorab als Puffer, nicht auf dem Audio-Thread |

**Prüfung je Task:** `sound-compare.mjs` trocken, Solo-Fälle je Stimme mit den Grenzen der Synth-Stimmen; für Task 22 zusätzlich je Klangregler der Stimme die Werte 0, 0,5 und 1. Nach Task 23: die Taste „Alle Samples“ auf „alle Synth“ in `ui-check.mjs`, alle Schichten haben Pegel.

---

## Phase 6: Die App ohne Repository (Zweig `feat/port-app`)

### Task 25: Dateien neben dem Programm

**Files:** Modify `native/app/CMakeLists.txt`, `PluginEditor.cpp`, `PluginProcessor.cpp`.

**Inhalt:** Der Build kopiert `src/` (ohne `assets/samples`) nach `web/`, `native/app/web` nach `web-native/` und die Packs nach `samples/` neben das Programm. Die App sucht zuerst dort, dann im Repository (die beiden `shortcut:`-Stellen mit den Pfaden des Build-Rechners).

**Prüfung:** Den Ordner `Standalone` an einen Ort außerhalb des Repositorys kopieren, das Repository für den Lauf umbenennen, `ui-check.mjs` gegen die Kopie: 0 Fehler.

### Task 26: Was die Oberfläche vom Browser erwartet

**Inhalt:** In der App prüfen und, wo nötig, richten: Profile als Datei speichern und laden (`src/ui/profiles.js` nutzt einen Download-Link und ein Datei-Feld), „Weitermachen“ nach Neustart der App, die Seite „Credits“, ein Profil aus der Web-Version mit der entfernten Stimme `chords sample/organ`. Der unbenutzte `AudioContext` der Seite wird in der App nicht mehr angelegt.

**Prüfung:** `ui-check.mjs` um diese vier Wege erweitert.

### Task 27: Abschluss

**Inhalt:** A/B-Gesamtsatz (neun Stile, Sample-Stimmen und Synth), Bericht mit allen Zahlen aus `sound-compare.mjs`, `native/UEBERGABE.md`, `PLAN_NATIV.md` und `MACHBARKEIT_JUCE.md` (Risiko 1) auf Stand, die `shortcut:`-Kommentare im Kern durchgehen und erledigte entfernen.

---

## Aufwand

In Arbeitstagen der KI, ohne Hör- und Testzeit des Nutzers; Grundlage sind die Zahlen aus `MACHBARKEIT_JUCE.md`, Abschnitt 3.

| Phase | Tage |
|---|---|
| 1 Ereignisstrom | 2 bis 3 |
| 2 Band mit Samples | 3 bis 4 |
| 3 Sendewege und Summe | 3 bis 4 |
| 4 Effekte | 2 bis 3 |
| 5 Synth-Stimmen | 5 bis 7 |
| 6 App ohne Repository | 2 bis 3 |
| **Summe** | **17 bis 24** |

## Offene Entscheidungen des Nutzers

Keine davon hält Phase 1 auf.

1. **Zuschnitt:** Prüfung, Würfeln der Form, Klangmodell und Profile bleiben JavaScript; Regler werden keine JUCE-Parameter. Einverstanden? (Vor Phase 2.)
2. **Kompressor:** Nachbau nach dem Chromium-Quelltext (BSD-3-Clause, Namensnennung in `LICENSES.md`)? Sonst nach der W3C-Beschreibung mit größerer Abweichung im Pegel. (Vor Task 17.)
3. **Versteckte Stimmen:** Das Saitenmodell (Task 24) ist in der Oberfläche nicht wählbar. Portieren oder streichen? Vorschlag: zuletzt portieren, weil gespeicherte Profile es nennen können. (Vor Phase 5.)
4. **Web-Version danach:** eingefroren als Demo auf GitHub Pages lassen oder abschalten? `src/audio` bleibt in jedem Fall als Referenz für den Klangabgleich, solange Stimmen portiert werden.
