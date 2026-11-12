# Songform Umsetzungsplan

> **Für ausführende Agenten:** PFLICHT-UNTERFÄHIGKEIT: superpowers:subagent-driven-development, Aufgabe für Aufgabe. Steps mit Checkboxen (`- [ ]`).

**Ziel:** Songs bekommen erkennbare Teile (Intro, Strophe, Aufbau, Refrain, Break, Outro) mit eigenem Charakter, Übergänge, Pausen, stärkere Dynamik und einen Zufallsregler; die Form wird nach Regeln gewürfelt und lässt sich in der Oberfläche anpassen.

**Architektur:** `track.form` (Teile mit Typ/Länge/Einstellungen + vier Regler) ist reine Daten. Ohne `form` läuft alles wie bisher, bit-gleich. Mit Form: `buildFormArrangement` liefert die Abschnitte, `withSection` verschiebt die Parameter (Dichte, Zufall), die Spieler bleiben unverändert; eine Nachbearbeitung der fertigen Ereignisse setzt Pegel, Übergänge, Stopps und Pausen um. Würfeln ist eine reine Kernfunktion (`rollForm`), die Oberfläche speichert das Ergebnis im Track.

**Tech Stack:** Reines ES-Module-JavaScript, `node --test tests/core`, Playwright, keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-11-12-song-structure-design.md` (inkl. des Abschnitts „Entscheidungen nach dem Builder-Check“; verbindlich sind die Grenzen, Reihenfolgen und Tests, die Zahlen der Tabelle sind Startwerte).

## Globale Randbedingungen

- Zweig `feat/song-structure` (bleibt, nicht wechseln, nicht pushen, nicht mergen); ein Commit je Aufgabe (mehrere erlaubt), Nachricht endet mit der Zeile `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Tracks ohne `form` ändern sich nicht:** `tests/core/golden.test.js` bleibt **unverändert** grün; im Pfad ohne Form keine zusätzlichen Zufallsziehungen auf `master`, den Schichtströmen und den Forks `tags`, `drift`, `arrangement`; `buildArrangement` bleibt unverändert; Ereignisform und Sortierung unverändert. Alles Neue läuft hinter `if (track.form)` und zieht Zufall aus **neuen** Forks (`createRng(hash(seed:'formgen'))` zum Würfeln, `master.fork('form')` für die Nachbearbeitung).
- Kern (`src/core/`) bleibt rein; Kommentare deutsch; Texte in `de` **und** `en` (`tests/core/i18n.test.js` prüft gleiche Schlüssel); Zielgrößen mindestens 44 px; 360 px ohne waagerechtes Scrollen; DOM nur bei Änderung schreiben (render läuft je Takt); Namen/Texte per `textContent`.
- Alle Zahlen der Formtypen und Regler-Formeln stehen in **einer** Tabelle `src/core/form-types.js` (Startwerte aus der Spec), damit sie nachgestellt werden können; niemand kann hören, also: keine Zahl fest in den Spielern oder der Oberfläche.
- Grenzen: bis 64 Teile, `bars` ganzzahlig 1 bis 64, Summe höchstens `MAX_LENGTH` (512, `src/core/track.js`); `level` −24 bis 0 dB; `density` −1 bis +1; Regler 0 bis 1 (Dynamik bis 1,3).
- Playwright: nur die betroffenen Spezifikationen mit `--no-deps`; den ganzen Lauf macht Aufgabe 9.
- Fertige Teile dürfen nur das Verhalten ändern, das die Spec nennt; Bass, Pad, Lead, Percussion, Stimmen und Klänge bleiben unverändert (außer dem neuen Schlag `crash`).

## Review-Fokus

1. Alte Tracks (ohne Form) sind byte-gleich; Profile ohne Teil `form` laden unverändert. (Aufgaben 1, 4, 8)
2. Jede Leitplanke gilt über viele Seeds × Vorlagen × Zielgrößen × Sperren; Würfeln ist reproduzierbar und ergibt für dieselbe Vorlage verschiedene Formen. (Aufgabe 2)
3. Stopps, Wirbel, Crash und Pausen erzeugen keine Ereignisse außerhalb ihres Takts, keine `vel` über 1, keine hängenden Töne (Dauer wird am Stopp gekürzt), und kein Takt verliert Bass **und** Schlagzeug außer im Break/Stopp. (Aufgabe 5)
4. Live-Änderungen ohne Längenänderung spielen weiter (`player.setTrack` liefert true), Längenänderung startet an der gleichen Position neu; Streifen und Spuren liegen auf derselben Takt-Achse. (Aufgaben 6, 7)
5. Bedienung ohne Maus (Streifen, Einstellungen, Würfeln), 360 px, Sprachwechsel, defekte gespeicherte/importierte Formen bringen die Oberfläche nicht durcheinander. (Aufgaben 7, 8)

---

### Task 1: Datenmodell, Prüfung, Länge und Akkordfolge je Teil (Kern)

**Dateien:**
- Erstellen: `src/core/form-types.js`, `src/core/form.js`, `tests/core/form.test.js`
- Ändern: `src/core/track.js` (`normalizeTrack` setzt `length` aus der Form; `checkForm` in `validateTrack`; Code `badForm`), `src/core/timeline.js` (`barTimeline`, `chordTimeline` nutzen `chordIndex`), `src/audio/play.js` (`loopSec`-Berechnung nutzt `chordIndex`), `src/core/fretboard.js` (`nextDistinctChord`, falls es die Folge über `length` laufen lässt), `src/i18n/de.js`, `en.js` (`err.badForm`), `tests/core/track.test.js` (15 Codes), `docs/interface.md` (Codezahl)

**Schnittstellen (Erzeugt):**
- `form-types.js`: `PART_TYPES = ['intro','verse','build','chorus','break','outro']`, `TRANSITIONS = ['none','fill','roll','stop']`, `FORM_LIMITS = { parts: 64, bars: 64, levelMin: -24, levelMax: 0, densityMin: -1, densityMax: 1 }`, `FEEL_DEFAULTS = { structure: 0.6, dynamics: 0.6, pauses: 0.4, randomness: 0.5 }`, `TYPE_TABLE` (je Typ: `layers: string[]` (aktive Ebenen-Ids ohne die folgenden Lead/Percussion), `density: [start, ende]`, `level: [start, ende]` (dB, ≤ 0), `transition`, `crash: boolean`; Werte der Spec-Tabelle), `resolveSection(section, feel): { type, bars, layers, density: [a,b], level: [a,b], transition, crash, locked }` (Standardwerte des Typs, auf die **Dynamik** skaliert: die Abweichung vom Refrain (Pegel und Dichte) wird mit dem Faktor `feel.dynamics / FEEL_DEFAULTS.dynamics` multipliziert, begrenzt auf 0 bis 1,3/0,6, so dass der Standard 0,6 genau die Tabelle ergibt; **ausdrücklich gesetzte** `level`/`density` werden nicht skaliert und gelten für den ganzen Teil als `[x, x]`), `levelAt(resolved, barInSection): number` und `densityAt(resolved, barInSection): number` (linear von Anfang zu Ende über die Takte des Teils, bei 1 Takt der Startwert).
- `form.js`: `formLength(form): number` (Summe der `bars`), `normalizeForm(form): Form | undefined` (liefert `undefined` für `undefined`/`null`; sonst Kopie mit `feel` aus Standardwerten ergänzt, unbekannte Felder verworfen, Teile nur mit bekannten Feldern; ungültiges bleibt für `checkForm` erkennbar, wirft nie), `sectionAt(form, bar): { index, section, start, barInSection } | null`, `chordIndex(track, barIndex): number` (mit gültiger Form: `(barIndex − Teilanfang) mod track.bars.length`, sonst `barIndex mod track.bars.length`), `checkForm(form, add)` (fügt `add('badForm', { reason })` für: kein Objekt/Array, `sections` kein Array oder leer oder über 64, ein Teil mit unbekanntem Typ/`bars` nicht ganzzahlig 1 bis 64/`level`, `density`, `transition`, `crash`, `locked` ungültig, `feel`-Wert kein endlicher Wert im Bereich, Summe über `MAX_LENGTH`; `reason` ist ein kurzer englischer Stichwort-Text wie `sections`, `type`, `bars`, `level`, `density`, `transition`, `feel`, `length`).
- `track.js`: `VALIDATION_CODES` bekommt `badForm` (jetzt 15); `normalizeTrack`: ist `form` ein Objekt mit nicht leerer `sections`-Liste gültiger Teile, gilt `length = formLength(form)` (überschreibt einen abweichenden Wert); `form` fehlt: nichts ändert sich.

**Regeln:** Der Pfad ohne `form` bleibt bit-gleich (kein Code im Pfad ohne Form ruft Neues auf, außer `chordIndex`, der dann `barIndex mod bars.length` liefert wie bisher). `play.js`/`timeline.js`/`fretboard.js` nutzen `chordIndex` an allen Stellen, an denen sie die Akkordfolge über die Takte abbilden (dort heute `i % bars.length`).

- [ ] **Schritt 1: Fehlschlagende Tests** (`tests/core/form.test.js`, plus Anpassungen): `formLength`; `normalizeForm` (Standard-`feel`, unbekannte Felder weg, `undefined`/`null`); `sectionAt` über Teilgrenzen (erster/letzter Takt, außerhalb → null); `chordIndex` ohne Form `i mod n`, mit Form beginnt jeder Teil bei 0 (Teile 4+6 mit 4 Akkorden: Takte 0..3 → 0..3, 4..9 → 0..3,0,1); `checkForm` je Grund (Tabelle der Fälle), gültige Formen ergeben keine Meldung, feindliche Eingaben (`__proto__`, Zahlen als Strings, 1000 Teile, NaN) werfen nie; `normalizeTrack` setzt `length` aus der Form, überschreibt einen abweichenden Wert und lässt Tracks ohne Form unverändert (`JSON.stringify`-gleich zu vorher); `validateTrack` meldet `badForm` über die öffentliche `validateTrack` aus `src/index.js`; `resolveSection`: Standardwerte aus der Tabelle bei `dynamics = 0.6`, `dynamics = 0` ergibt für alle Typen Pegel 0 und Dichte 0 (Abweichungen weg), ausdrücklich gesetzte Werte unskaliert, `levelAt`/`densityAt` rampen linear (Aufbau steigt, Outro fällt); `timeline`/`chordTimeline`/Gesamtdauer aus `play.js` mit Form (Akkordfolge beginnt je Teil neu) und ohne Form unverändert. `tests/core/track.test.js`: 15 Codes inkl. `badForm`; `i18n`-Test grün.
- [ ] **Schritt 2: Ausführen** — Fehlschlag.
- [ ] **Schritt 3: Implementieren** (Module, `normalizeTrack`, `checkForm`, `chordIndex` an den Stellen in `timeline.js`, `play.js`, `fretboard.js`; `err.badForm` de/en: „Die Songform ist ungültig (…).“ / „The song form is invalid (…).“ mit Platzhalter `{reason}`).
- [ ] **Schritt 4: Ausführen** `node --test tests/core` (alle grün, Golden unverändert) und `npx playwright test tests/e2e/play-page.spec.js tests/e2e/flow.spec.js --no-deps`.
- [ ] **Schritt 5: Doku** (`docs/interface.md`: Track-Feld `form`, Code `badForm`, 15 Codes, `length` abgeleitet) und **Commit** `feat: song form data model, validation and per-section chord index`.

### Task 2: Würfeln nach Regeln (Kern)

**Dateien:**
- Erstellen: `src/core/form-roll.js`, `tests/core/form-roll.test.js`
- Ändern: `src/core/form-types.js` (Vorlagen-Daten) falls sinnvoll dorthin gelegt, sonst in `form-roll.js`

**Schnittstellen:**
- Erzeugt: `TEMPLATE_IDS = ['jam','pop','buildDrop','blues','rock']`, `STYLE_TEMPLATE` (Auto-Zuordnung: funk, reggae = jam; psych = buildDrop; dreamy, country, poppunk = pop; blues = blues; rock, hardrock = rock), `TARGET_SIZES = [24, 32, 48, 64, 96, 128, 192]`, `resolveTemplate(templateOrAuto, styleId, tags): { template, auto }` (Bias aus `tags.development`: bei bekanntem Stil gewinnt die Stil-Zuordnung; nur bei unbekanntem Stil: `buildsSlowly` ohne `fullFromStart` → buildDrop, sonst pop), `rollForm({ template, style, targetBars, feel, seed, tags, previous }): Form` mit `Form = { template, auto, feel, sections }` (`template` ist nie `'auto'`, `auto` ist true wenn der Aufrufer `'auto'` wählte; `feel` vollständig; `previous` ist optional: eine Form mit gesperrten Teilen, die an ihrer Stelle (Index) erhalten bleiben; ohne gesperrte Teile würfelt alles neu; Wechsel von Vorlage/Zielgröße ruft der Aufrufer ohne `previous` auf).
- Vorlage = Liste von **Plätzen** `{ type | types[], bars: [wahl...], p: Wahrscheinlichkeit, repeat?: [min,max] }` (siehe Spec „Würfeln nach Regeln“); Zufall nur aus `createRng(hash(seed:'formgen'))` (siehe `src/core/rng.js`).
- Entwicklungs-Schlagworte (Spec, Entscheidung 1): `buildsSlowly` erhöht p für Intro/Aufbau, `fullFromStart` senkt sie (der Song beginnt mit Strophe oder Refrain), `withBreakouts` erhöht p für Breaks; Struktur-Regler skaliert die Wahrscheinlichkeiten optionaler Teile und den Kontrast.
- Anpassung an die Zielgröße: Summe höchstens 4 Takte neben `targetBars` (Blues: Plätze zu 12 Takten, Summe das nächste Vielfache); Längen in Schritten von 2 Takten innerhalb der Wahl des Platzes; optionale Plätze ein-/ausschalten; wenn die Summe nicht passt, wird die Länge des **längsten nicht gesperrten** Teils angepasst; gibt es keinen, bleibt die Form unverändert.

**Leitplanken (jede ein Test über Seeds × Vorlagen × Zielgrößen × Sperren):** wie in der Spec (1 bis 7: Erster Teil Intro/Strophe, letzter Outro/Refrain; Aufbau nur direkt vor Refrain, Refrain nie erster Teil; Break nie am Anfang/Ende und nie doppelt hintereinander; nie mehr als zwei gleiche Typen hintereinander (Jam ausgenommen); mindestens ein Refrain ab 24 Takten außer Jam; Mindestlängen Aufbau/Break/Intro/Outro 2, Strophe/Refrain 4, Höchstlänge 32; Reproduzierbarkeit und Vielfalt: Pop, Ziel 96, 200 Seeds ⇒ mehr als 10 verschiedene Formen).

- [ ] **Schritt 1: Fehlschlagende Tests** (`form-roll.test.js`): jede Leitplanke über Schleifen (z. B. 300 Seeds × 5 Vorlagen × alle Zielgrößen × beide Schlagwortlagen), Summe nahe Ziel, Blues in 12er-Teilen, Auto-Zuordnung je Stil, Entwicklungs-Schlagworte verschieben die Häufigkeiten (statistisch über 300 Seeds), Reproduzierbarkeit, Vielfalt, gesperrte Teile bleiben bit-gleich an ihrer Stelle und Leitplanken gelten rund um sie, kein Würfeln mit `targetBars` außerhalb (Rückfall auf nächste Zielgröße), `feel.structure = 0` ergibt weniger verschiedene Teile als `1` (Mittelwert über Seeds), feindliche Eingaben (fehlende Felder, unbekannte Vorlage → Pop) werfen nie, das Ergebnis besteht `checkForm` ohne Meldung.
- [ ] **Schritt 2: Ausführen** — Fehlschlag. **Schritt 3: Implementieren.** **Schritt 4: `node --test tests/core` grün.**
- [ ] **Schritt 5: Commit** `feat: roll song forms from templates with guardrails`.

### Task 3: Neuer Schlag `crash` (Synth, Samples, Packs)

**Dateien:**
- Ändern: `src/core/events.js` (`DRUM_NAMES`), `src/index.js` (Export folgt), `src/audio/voices/drums.js` (Synth-Crash), `src/audio/voices/sample-hits.js` (`HIT_KEYS.drums.crash = 49`), `scripts/extract-samples.mjs` (`DRUM_KEYS` + 49), `src/assets/samples/drums-*.json/.pcm` (5 Packs neu), Tests (`tests/core/index.test.js`, `sample-packs.test.js`, `voices-impl.test.js`, `grooves.test.js`, `variety.test.js`, `tests/e2e/voices-sample-sound.spec.js`, `voices-sound.spec.js`), `src/audio/voices/tunables.js` (Pegel je Kit prüfen), `docs/interface.md` (Packzahl/-größe, Schlagnamen), `README.md`

**Regeln:**
- `crash` kommt in `DRUM_NAMES` **nach** den bisherigen Namen (Reihenfolge der Liste ändert sich sonst in Tests); Synth-Crash: Rauschen durch Hochpass, langes Ausklingen (etwa 1,5 s), hell, ohne zu übersteuern; Spitze unter 1 in der Summe.
- Samples: MIDI-Taste 49 „Crsh 1“ in allen fünf Kits (steht in der SoundFont, siehe Preset-Liste; fehlt sie, **bricht der Extraktor mit Fehler ab**). Extraktor mit `C:\Users\lorda\AppData\Local\Temp\claude\84ff408a5aa68f0a\fc301f97-2e50-40f9-9893-843209376b8c\scratchpad\msg.sf3` ausführen; die Pack-**Bytes** dürfen sich ändern (Sample-Reihenfolge), der **Klang der bisherigen Tasten nicht**: ein Test vergleicht die dekodierten Samples (Frames, Rate, Prüfsumme der PCM-Bytes je Taste) der bisherigen Tasten vor/nach (Referenz vorher aufnehmen). Andere Packs bleiben byte-identisch (`git status` zeigt nur die 5 Drum-Packs).
- Der Crash darf die Gesamtgröße der Packs um höchstens etwa 1,5 MB erhöhen; Größe berichten.
- Pegel: `level` je Kit gilt für die Folge der bisherigen Schläge; der Crash wird nicht in die Messfolge der Kits einbezogen, bekommt aber im e2e-Test (`jeder Schlag hörbar, endlich, Spitze unter 0,95`) seinen Platz.

- [ ] **Schritt 1: Fehlschlagende Tests** (Listen/Zahlen anpassen; neuer Test: Synth-`crash` hörbar, endlich, Spitze < 1, klingt länger aus als `openHat` (rms der letzten Zeit); Samples: jedes Kit spielt `crash` hörbar und endlich; Taste 49 hat in jedem Drum-Pack eine Zone; bisherige Tasten klingen gleich (Prüfsummen)).
- [ ] **Schritt 2: Ausführen** — Fehlschlag. **Schritt 3: Implementieren** (Synth, Taste, Extraktor, Packs neu bauen, Pegel prüfen).
- [ ] **Schritt 4: Ausführen** `node --test tests/core` und `npx playwright test tests/e2e/voices-sample-sound.spec.js tests/e2e/voices-sound.spec.js tests/e2e/audition.spec.js tests/e2e/voices-ui.spec.js --no-deps` (im Hintergrund, langes Timeout).
- [ ] **Schritt 5: Commit** `feat: crash hit for the drum kits (synth and samples)`.

### Task 4: Form im Ereignisstrom (Abschnitte, Dichte, Zufall, Marker)

**Dateien:**
- Erstellen: `src/core/form-arrange.js`, `tests/core/form-events.test.js`
- Ändern: `src/core/events.js` (nur hinter `if (track.form)`), `src/core/lead.js` bzw. Spieler nur wenn nötig (Spec: Spieler bleiben unverändert; Ausnahme Schlagzeug-Abschnitt: offene Hi-Hat im Refrain)

**Schnittstellen:**
- Erzeugt: `buildFormArrangement(track): { sections: [{ start, bars, layers: {id: bool}, fillAtEnd, kind, index, resolved }] }` (Ebenen aus `resolveSection(...).layers`, **Lead und Percussion folgen** wie bisher über `LAYERS[id].follows`; `fillAtEnd` ist true, wenn der **nächste** Teil `transition === 'fill'` hat; der letzte Teil hat nie `fillAtEnd`), `withSection(params, resolved, barInSection, feel): params` (Kopie: `drive += densityAt·1,0`, `bassMovement += densityAt·0,6`, `syncopation += densityAt·0,4 + (feel.randomness − 0,5)·0,4`, geklemmt auf 0 bis 1; unverändert, wenn alles 0), `phrasesOf(sec): [{ start, bars }]` (Phrasen zu 4 Takten ab Teilanfang, letzte kürzer).
- `events.js`, Pfad mit Form: die Abschnittsliste kommt aus `buildFormArrangement`; für jeden Abschnitt und jede Schicht wird `section(...)` **je Phrase** aufgerufen: die erste Phrase immer, jede weitere mit der Wahrscheinlichkeit `feel.randomness` neu (sonst das vorige `v` behalten); `withSection` wird **je Takt** angewendet (Dichte rampt); der Marker `fill` wie bisher im letzten Takt vor einem Teil mit `transition === 'fill'`; neuer Marker `{ t, bar, beat: 0, type: 'marker', name: 'section', kind: <Typ>, index }` am Anfang jedes Teils (nur mit Form); `drumSection` setzt im Refrain die offene Hi-Hat sicher (`openHat: true`) und in Strophe/Break/Intro nicht (über `sec.kind`, nur im Form-Pfad; die Zahl der Ziehungen bleibt gleich).

**Regeln:** Pfad ohne Form bleibt bit-gleich (Golden). Mit Form gleiche Ereignisformen wie bisher (nur der neue Marker kommt dazu). Die Summe der Teile ist `track.length` (Aufgabe 1).

- [ ] **Schritt 1: Fehlschlagende Tests** (`form-events.test.js`): Tracks mit Form (Pop, 48 Takte) liefern Abschnitte in den Teilgrenzen (nicht in 8-Takt-Blöcken); Schichten je Typ (Intro ohne Schlagzeug, Break ohne Schlagzeug; Refrain mit allen vier); Dichte: Schlagzeug-Treffer pro Takt im Refrain **größer** als in der Strophe (Mittel über Seeds), im Break kleiner; Aufbau rampt (letzter Takt dichter als der erste); `randomness = 0` ergibt je Teil dasselbe Muster in allen Phrasen, `1` wechselt (Mittel über Seeds); gleicher Track+Seed zweimal gleich; ungültige Form wirft wie `buildEvents` bei ungültigem Track; Marker `section` an den Teilanfängen; `fill`-Marker nur vor Teilen mit `fill`; Golden und alle bisherigen Tests unverändert; Tracks mit Form und `layers` aus erzeugen nichts für abgeschaltete Schichten.
- [ ] **Schritt 2: Ausführen** — Fehlschlag. **Schritt 3: Implementieren.**
- [ ] **Schritt 4: Ausführen** `node --test tests/core` (Golden unverändert).
- [ ] **Schritt 5: Commit** `feat: sections, density and phrase variation driven by the song form`.

### Task 5: Nachbearbeitung: Pegel, Übergänge, Stopps, Pausen, Crash

**Dateien:**
- Erstellen: `src/core/form-post.js`, `tests/core/form-post.test.js`
- Ändern: `src/core/events.js` (ruft `postProcess` am Ende hinter `if (track.form)`)

**Schnittstellen:**
- Erzeugt: `postProcess(events, track, bars, sections, rng): Event[]` (rein, neues Array; `rng` ist `master.fork('form')`), in dieser Reihenfolge: (1) **Pausen** (Regler `feel.pauses`): an jedem 4. Takt eines Teils (nicht im letzten Takt vor einem Stopp, nicht im ersten Takt eines Teils) mit der Wahrscheinlichkeit `pauses · Typfaktor` (Strophe 0,6; Refrain 0,25; Intro/Outro 0,5; Aufbau/Break 0) fällt **eine** Schicht für diesen Takt aus: gewählt aus Akkorde, Pad, Lead, Percussion; Bass nur im Break; das Schlagzeug nie ganz (nur Treffer außer Hi-Hat/Kick entfallen → Ereignisse von Snare/Toms/Becken weg); höchstens eine Schicht je Takt; (2) **Wirbel** (`transition === 'roll'` des folgenden Teils): im letzten Takt davor ersetzt ein Snare-Wirbel (erste Hälfte Achtel, zweite Hälfte Sechzehntel, crescendo von 0,45 auf 0,95) das Schlagzeugmuster ab der Taktmitte (Kick im Takt bleibt); (3) **Stopp** (`stop`): im letzten Takt vor dem Teil entfallen alle Ereignisse ab dem letzten Schlag (bei `pauses ≥ 0,6` ab den letzten zwei Schlägen); Noten, die in die Stille hineinreichen, werden auf den Stoppbeginn gekürzt; (4) **Crash**: ein `hit` `name: 'crash'` mit `vel` 0,9 zur Eins jedes Teils mit `crash === true` (nicht im allerersten Takt des Songs), `layer: 'drums'`; (5) **Pegel**: `vel` aller `note`/`hit`-Ereignisse mal `10^(levelAt/20)` (je Takt mit `levelAt`, Pegel ≤ 0, Ergebnis geklemmt auf 0,05..1, Dreistellige Rundung wie `humanVel`). Marker und `chord`-Ereignisse bleiben unverändert; die Sortierung entspricht `buildEvents`.
- Alle Ereignisse bleiben in ihrem Takt (`t` zwischen Taktanfang und -ende, siehe `tests/core/contract.test.js`), `dur` wird nie über das Taktende verlängert.

- [ ] **Schritt 1: Fehlschlagende Tests** (`form-post.test.js`, Eigenschaftstests über Seeds und Formen): Pegel: Refrain 0 dB (vel unverändert), Break/Intro/Outro niedriger, Aufbau rampt (zweiter Takt lauter als erster), nie über 1, Dynamik 0 → alle Pegel gleich; `stop`: im Stoppfenster keine Ereignisse, `dur` der Noten davor endet spätestens am Fensteranfang, der folgende Teil beginnt normal (Crash/Kick auf der Eins vorhanden), bei `pauses ≥ 0,6` zwei Schläge; `roll`: Treffer in der zweiten Takthälfte sind nur Snare (und Kick wie vorher), Achtel dann Sechzehntel, vel steigt monoton; `crash`: genau ein Crash zur Eins der Teile mit `crash`, nie im ersten Takt des Songs; Pausen: nie zwei Schichten im selben Takt, Bass nur im Break, Schlagzeug behält Hi-Hat/Kick, Wahrscheinlichkeit wächst mit dem Regler (`pauses = 0` → keine Pausen, 1 → mehr als 0,4 → mehr als 0 über Seeds), nie im letzten Takt vor einem Stopp; kein Ereignis außerhalb seines Takts; reproduzierbar; `contract.test.js` und `groove-events.test.js` mit Form grün.
- [ ] **Schritt 2: Ausführen** — Fehlschlag. **Schritt 3: Implementieren.** **Schritt 4: `node --test tests/core` grün (Golden unverändert).**
- [ ] **Schritt 5: Commit** `feat: levels, rolls, stops, pauses and crash for the song form`.

### Task 6: Zustand und Würfeln in der App; Regler und Vorlagenwahl

**Dateien:**
- Ändern: `src/ui/state.js` (`state.track.form`, `state.formFeel`, Hilfen `rollNewForm`, `setFormTemplate`, `setFormTarget`), `src/ui/app.js` (Startform würfeln, Variante weiterschalten, Stilwechsel), `src/ui/tuning.js` (Länge-Auswahl wird Zielgröße; `laneEvents()`-Memo-Schlüssel um `form`, `jobs`, `voices`, `variety` erweitern; `--lanes` unverändert), `src/ui/rhythm.js` oder neues Modul `src/ui/form-panel.js` (Gruppe „Songform“ in der linken Leiste: Vorlage, Zielgröße, vier Regler), `src/ui/index.html`, `src/ui/layout-state.js` (Gruppe `form` offen/zu), `src/ui/app.css`, `src/i18n/de.js`, `en.js`, Tests (`tests/e2e/form-panel.spec.js`, angepasste `tuning.spec.js`, `groups.spec.js`, `layout-state.test.js`)
- Verbraucht: `rollForm`, `resolveTemplate`, `TARGET_SIZES` (Aufgabe 2), `formLength` (Aufgabe 1), `applyLive`/`restartIfPlaying` (`src/ui/app.js`).

**Zusätzlich (aus dem Review von Aufgabe 1):** `src/ui/app.js:72` (`restartIfPlaying`: Akkord der aktuellen Position) und `src/ui/progression-editor.js:92` (Hervorhebung des laufenden Akkords) rechnen noch `bar % bars.length`; beide auf `chordIndex(state.track, bar)` umstellen, mit Test (Track mit Form, Position in Teil 2).

**Verhalten (Spec „Oberfläche“ und Entscheidung 2):**
- Beim Start (und bei „Variante weiter/zufällig“, Stilwechsel mit Vorlage Auto, Struktur-Regler loslassen) würfelt die App die **nicht gesperrten** Teile neu mit `rollForm({ template, style: state.style, targetBars: <Zielgröße>, feel, seed: state.track.seed, tags: state.track.tags, previous: state.track.form })` und setzt `state.track.form` und `state.track.length = formLength(form)`; Wechsel von Vorlage/Zielgröße ohne `previous` (hebt Sperren auf). Standard: Vorlage Auto, Ziel 96.
- „Ohne Form“ (Vorlage-Auswahl) entfernt `state.track.form` (Verhalten wie bisher, `length` = die Zielgröße), die vier Regler sind ausgegraut, `state.formFeel` behält die Werte.
- Die vier Regler (Struktur, Dynamik, Pausen, Zufall) schreiben in `state.track.form.feel`; Dynamik/Pausen/Zufall wirken über `applyLive({ patterns: true })` (live, die Gesamtlänge bleibt); Struktur würfelt beim Loslassen neu; jede Reglerbewegung höchstens einmal je Frame (wie der Komplexitätsregler in `rhythm.js`).
- Längenänderung durch Würfeln/Zielgröße: `restartIfPlaying({ inPlace: true })` (an der gleichen Position neu) statt `applyLive`.
- `positionLabel` zeigt weiter „Takt n von <Summe>“.

- [ ] **Schritt 1: Fehlschlagende e2e-Tests** (`form-panel.spec.js`): Beim Laden hat der Track eine Form (Summe = Länge, Vorlage Auto); die Gruppe „Songform“ ist erreichbar (Tastatur) mit Vorlagen-Auswahl, Zielgröße und vier Reglern mit sichtbarem Prozentwert (`aria-valuetext`); „Neu würfeln“ (kommt in Aufgabe 7; hier die Variante weiterschalten) ändert die Form bei gleichen Eingaben nicht, bei neuer Variante schon; Vorlage Blues → alle Teile 12 Takte (außer der Anpassung); Zielgröße 48 → Summe nahe 48; Wechsel der Vorlage hebt Sperren auf (Sperren kommen in Aufgabe 7: hier als Zustandstest); „Ohne Form“ → Regler ausgegraut und `length` entspricht der Zielgröße; Regler Zufall während der Wiedergabe: Wiedergabe läuft weiter, ein AudioContext; Sprache wechseln relabelt; 360 px kein waagerechtes Scrollen; `laneEvents` zeichnet nach Form-/Jobs-Änderung neu. Unit: `layout-state.test.js` kennt die Gruppe `form`.
- [ ] **Schritt 2: Ausführen** — Fehlschlag. **Schritt 3: Implementieren.**
- [ ] **Schritt 4: Ausführen** `node --test tests/core` und `npx playwright test tests/e2e/form-panel.spec.js tests/e2e/tuning.spec.js tests/e2e/groups.spec.js tests/e2e/play-page.spec.js tests/e2e/flow.spec.js tests/e2e/rhythm.spec.js --no-deps`.
- [ ] **Schritt 5: Commit** `feat: song form in the app state with template, target size and feel sliders`.

### Task 7: Streifen und Einstellungen der Teile (Oberfläche, Variante A)

**Dateien:**
- Erstellen: `src/ui/form-strip.js`, `src/ui/form-inspector.js` (oder ein Modul), Tests (`tests/e2e/form-strip.spec.js`, `tests/core/form-ui.test.js` für reine Helfer)
- Ändern: `src/ui/index.html` (Streifen im Block der Spuren, gleiche Takt-Achse wie die Leinwand), `src/ui/lanes.js` (Teilgrenzen aus den `section`-Markern statt alle 8 Takte; nur Marker `fill` als Dreieck; Beschriftung der Teile optional), `src/ui/app.css`, `src/ui/app.js`, `src/ui/tuning.js` (Aufruf von `renderFormStrip`), `src/i18n/de.js`, `en.js`

**Verhalten (Spec „Oberfläche“):**
- Streifen: Teile als Blöcke (Breite proportional zu den Takten, Höhe proportional zum wirksamen Pegel, Farbe nach Typ, Name + Takte als Text), **ausgerichtet** an der Leinwand der Spuren; als `role="listbox"` mit `option`-Elementen (oder Toolbar), roving tabindex, Pfeile/Pos1/Ende, Enter/Leertaste wählt; ausgewählter Teil hervorgehoben; Namen per `textContent`.
- Einstellungen des gewählten Teils unter dem Streifen: Typ (Auswahl), Länge (Takte, Stepper 1 bis 64), Pegel (Regler −24 bis 0 dB, Beschriftung „Standard (−3 dB)“ solange nicht gesetzt, mit „Zurücksetzen“), Dichte (Regler −100 bis +100 %), Übergang davor (Auswahl: keiner, Fill, Wirbel, Stopp), Crash (Kontrollkästchen), Sperren (Schalter), Löschen, nach links/rechts, Kopie. Jede Änderung sperrt den Teil und setzt `track.length`; Länge/Typ/Reihenfolge ändern die Gesamtlänge (`restartIfPlaying({ inPlace: true })`), Pegel/Dichte/Übergang/Crash gehen live (`applyLive({ patterns: true })`).
- Schaltflächen: „Neu würfeln“ (nicht gesperrte Teile), „Teil hinzufügen“ (am Ende, Typ Strophe, 8 Takte). Bei „Ohne Form“ ist der Streifen ausgeblendet (statt dessen Hinweis).
- Lanes: die grauen Linien folgen den Teilgrenzen, die Spur zeigt weiter Dichte je Takt.

- [ ] **Schritt 1: Fehlschlagende Tests** (e2e): Streifen zeigt die Teile in Reihenfolge mit Breiten proportional zu den Takten (±2 px) und dieselbe x-Achse wie die Leinwand (linke/rechte Kante gleich); Tastatur: Pfeile wählen, Einstellungen erreichbar; Typ ändern sperrt den Teil; Länge ändern passt die Gesamtlänge und „Takt n von …“ an; Pegel/Dichte ändern bei laufender Wiedergabe ohne Neustart (ein AudioContext, `setTrack` true: z. B. Takt läuft weiter); „Neu würfeln“ lässt gesperrte Teile unverändert und ändert andere; Löschen des letzten verbleibenden Teils nicht erlaubt (mindestens ein Teil); nach links/rechts; Kopie; Sprachwechsel; 360 px (Streifen scrollt innerhalb oder skaliert, kein waagerechtes Scrollen der Seite); Teilnamen mit `<b>` sind nicht möglich (Typ aus fester Liste); Lanes zeigen Teilgrenzen (Pixelprobe oder Zustandsprüfung). Unit: reine Helfer (Breiten/Höhen aus Teilen, Beschriftung „Standard“).
- [ ] **Schritt 2: Ausführen** — Fehlschlag. **Schritt 3: Implementieren.**
- [ ] **Schritt 4: Ausführen** `npx playwright test tests/e2e/form-strip.spec.js tests/e2e/form-panel.spec.js tests/e2e/tuning.spec.js tests/e2e/play-page.spec.js tests/e2e/views.spec.js tests/e2e/layout-stability.spec.js --no-deps` und `node --test tests/core`.
- [ ] **Schritt 5: Commit** `feat: song form strip and part settings in the play page`.

### Task 8: Profile: zehnter Teil „Songform“

**Dateien:**
- Ändern: `src/core/profile-parts.js` (`PART_IDS` + `form`, `CAPTURE.form`, `CLEAN.form`, Apply), `src/core/profile.js` (Alt-Import: Teil `form` fehlt in v1-Dateien: nicht angefasst), `src/ui/profile-parts-picker.js` (nur falls nötig), `src/ui/profiles.js` (beim Laden eines Profils ohne Teil `form` mit geänderter `rhythm.length`: Form für die neue Länge neu würfeln), `src/i18n/de.js`, `en.js` (`part.form`, `part.form.hint`), Tests (`tests/core/profile-parts.test.js`, `profile.test.js`, `profile-store.test.js`, `profile-ui.test.js`, `tests/e2e/profiles.spec.js`: die Zahl 9 → 10), `docs/interface.md`, `README.md`

**Regeln:**
- `form`-Teil: `{ form: { template, auto, feel, sections } }`; Capture kopiert tief; `sanitizeParts`: ungültige Teile der Liste werden einzeln verworfen und gezählt (`skipped`), unbekannte Felder ignoriert, leere Liste → der Teil fällt weg; Typ/Zahlen werden wie in `checkForm` geprüft (bei Bedarf die Prüfung aus `form.js` wiederverwenden); `applyParts` setzt `track.form` (und damit `length` über `normalizeTrack`), Profile ohne diesen Teil lassen die Form unberührt.
- „Ohne Form“ speichern: Capture liefert `form: null`? **Nein:** ist keine Form da, wird der Teil beim Speichern übersprungen (nicht angehakt/leer); `captureParts(session, ['form'])` ohne Form liefert keinen Teil.
- Profile mit `rhythm.length`, aber ohne Teil `form`: Die Form (falls vorhanden) wird für die geladene Länge (nächste Zielgröße) neu gewürfelt (Spec Entscheidung 2).

- [ ] **Schritt 1: Fehlschlagende Tests** (Kern: Capture/Sanitize/Apply des Teils, feindliche Eingaben, Rundlauf, `PART_IDS.length === 10`, `partsSummary`-Texte „n von 10“; e2e: Profil mit Form speichern, Form ändern, Profil laden stellt die Form wieder her; Profil ohne Teil Songform lässt sie unberührt; geladenes `rhythm.length` ohne Teil `form` würfelt neu; alte Dateien importierbar).
- [ ] **Schritt 2: Ausführen** — Fehlschlag. **Schritt 3: Implementieren.**
- [ ] **Schritt 4: Ausführen** `node --test tests/core` und `npx playwright test tests/e2e/profiles.spec.js --no-deps`.
- [ ] **Schritt 5: Commit** `feat: song form as the tenth profile part`.

### Task 9: Doku und Gesamtlauf

**Dateien:** `README.md` (Abschnitt Songform: Teile, Übergänge, Pausen, Dynamik, Zufall, Vorlagen, Regler, „Ohne Form“), `docs/interface.md` (Track-Feld `form` mit allen Feldern, Marker `section`, `crash`, Regler, Würfeln, Profile-Teil, Grenzen, Fehlercode, Ereignisse, `chordIndex`)

- [ ] **Schritt 1: Doku schreiben** (Aussagen gegen den Code prüfen, Beispiel-JSON mit `parseFile`/`validateTrack` prüfen).
- [ ] **Schritt 2: Gesamtlauf** `node --test tests/core` und `npx playwright test` (etwa 19 Minuten, im Hintergrund mit langem Timeout, kein kurzes Abfragen); Zahlen berichten; echte Regressionen beheben (häufigste Ursachen: Tests, die 8-Takt-Blöcke, `length` als Auswahl 24/48/96/192 oder 9 Profil-Teile annehmen).
- [ ] **Schritt 3: WAV-Probe** (`node scripts/render-ab.mjs`-Muster): Ein Skript im Scratchpad rendert für 3 Stile je einen Song von 96 Takten mit Form (Pop, Build & Drop, Jam) **und** denselben Track ohne Form als WAV nach `.superpowers/audio-ab/form-<stil>-mit.wav` / `-ohne.wav`, damit der Nutzer vergleichen kann; Spitzenpegel und Pegel je Teil (RMS pro Teil) im Bericht.
- [ ] **Schritt 4: Commit** `docs: song form`.

---

## Selbstprüfung

- **Spec-Abdeckung:** Datenmodell/Prüfung/Länge/Akkordfolge (1), Würfeln und Leitplanken (2), Crash (3), Abschnitte/Dichte/Zufall/Marker (4), Pegel/Übergänge/Stopp/Pausen (5), Zustand/Regler/Vorlagen/Auslöser (6), Streifen/Einstellungen (7), Profile (8), Doku/Gesamtlauf/WAV (9). Entscheidungen 1 bis 5 des Builder-Checks sind in den Aufgaben 2, 3, 6, 7, 8 verankert.
- **Typkonsistenz:** `resolveSection`/`levelAt`/`densityAt` (1) werden in 4, 5, 7 benutzt; `rollForm`/`resolveTemplate`/`TARGET_SIZES` (2) in 6, 8; `formLength`/`normalizeForm`/`checkForm`/`chordIndex` (1) in 4, 6, 8; `buildFormArrangement`/`withSection` (4); `postProcess` (5); `crash` (3) in 5.
- **Verhältnis:** Der Plan beschreibt Schnittstellen, Regeln und Tests, keine Funktionskörper.
