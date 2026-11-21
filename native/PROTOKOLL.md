# Protokoll der Sitzung (Kern ↔ Seite)

Stand Task 29. Die Sitzung (`native/core/include/btg/session.h`, `native/core/src/session.cpp`) hält den Zustand der Web-App aus `src/ui/state.js` und die Regeln der Handler, die ihn ändern (`src/ui/app.js` und die Panels). Die Seite schickt **Aktionen** als JSON-Text an `Session::apply` und zeigt, was `Session::state()` liefert. Die Namen hier gelten für Task 31 und 32.

Geprüft wird die Sitzung gegen die Web-App: `native/tools/export-logic.mjs` spielt Folgen von Aktionen auf der Referenz `native/tools/session-reference.mjs` ab (die echten Funktionen aus `src/ui/state.js` und den reinen Modulen, dazu Abschriften der Handler) und schreibt nach jeder Aktion die `Change`-Merker, `state()`, `track()` (was die Web-App ihrem Player gibt), `sound()` und `tuning()`; `native/core/tests/test_logic.cpp` (Funktion `session`) verlangt dasselbe vom Kern, Zahlen Bit für Bit.

## 1. Grundregeln

- Eine Aktion ist ein JSON-Objekt mit dem Feld `action` (Name) und den Feldern der Aktion. Weitere Felder werden nicht gelesen. Gelesen wird der Text wie mit `JSON.parse` (der Leser von `track.cpp`: ein Schlüssel doppelt gibt den letzten Wert, kein Byte-Order-Mark). **Grenze:** Text, der tiefer als 64 Ebenen verschachtelt ist, gilt dort als kein JSON; `JSON.parse` nimmt ihn (eine Aktion hat zwei Ebenen).
- **Ungültig** ist: Text, der kein JSON ist; kein Objekt; ein unbekannter Name; ein fehlendes Feld oder eines vom falschen Typ; ein Wert außerhalb dessen, was das Bedienelement der Web-App schicken kann (Liste, Bereich, Schrittweite); eine Aktion, deren Bedienelement im jetzigen Zustand verborgen oder ausgegraut ist, wo die Zeile der Aktion es nennt. Eine ungültige Aktion ändert nichts und liefert ein `Change`, in dem alles `false` ist. `apply` wirft nie.
- Die Tasten eines Teils, die die Web-App an ihren Grenzen ausgraut (nach links am Anfang, nach rechts am Ende, Kopie, Löschen und Hinzufügen an den Grenzen der Form, länger bei 512 Takten in der Summe), nimmt die Sitzung an: `form-ui.js` liefert dann kein Ergebnis, nichts ändert sich, alles ist `false`, die Auswahl bleibt. Das ist von einer Ablehnung nicht zu unterscheiden. Kürzer bei einem Takt und länger bei 64 Takten schickten eine Länge außerhalb von 1 bis 64: ungültig.
- **Die Merker folgen den Aufrufen des Handlers, nicht der Änderung:** eine gültige Aktion, deren Handler den Player ruft, setzt ihre Merker auch dann, wenn sich nichts ändert (derselbe Groove noch einmal gibt `events`, `sound`). Alles `false` liefern: ungültige Aktionen, die Wiederholungen der nächsten Regel, und Handler, die nichts tun (dieselbe Taktart, ein Akkord mehr bei voller Folge, „Neu würfeln“ mit lauter gesperrten Teilen, eine Bearbeitung, die `form-ui.js` ablehnt, die Wahl eines Teils).
- **Derselbe Wert noch einmal.** Ein Select oder Regler der Web-App meldet nichts, wenn man ihn auf den Wert stellt, den er zeigt. Zeigt das Bedienelement ein Feld von `state()` selbst, ist diese Wiederholung gültig und ändert nichts: kein Würfeln, keine fallende Sperre, keine neue Folge, kein Merker von „Überrasch mich“, alles `false`. Zeigt es einen abgeleiteten Wert (die Klangknöpfe zeigen `resolveTrackTimbre`, Pegel, Dichte und Übergang eines Teils `resolveSection`, der Groove `grooveIdFor`, die Knöpfe Komplexität, Lockerheit und Verzierungen und die Orgel-Zerre einen Ersatzwert, solange das Feld fehlt), oder ist es eine Taste, ein Chip oder eine Karte, die in der Web-App erneut auslöst, wirkt die Aktion wie sonst. Die Spalte „Gleicher Wert“ unten sagt für jede Aktion, was gilt: „nichts“ oder „wie sonst“.
- Werte von Reglern kommen so, wie das Bedienelement sie hat: Prozent als ganze Zahl (`value: 47` für 47 %), dB als ganze Zahl, bpm als ganze Zahl. Die Sitzung teilt wie der Handler (`Number(value) / 100`). „Zeigt“ heißt bei Prozent: `Math.round(Feld · 100)`.
- **Kein Zufall, keine Uhr im Kern.** Was die Web-App aus dem Browser nimmt, steht in der Aktion: das Ergebnis von `rollVariant()` (`crypto`) als `variant` (1 bis 9999), jedes `Math.random()` von „Überrasch mich“ als Zahl in [0, 1).

### Die Merker von `Change`

Sie sagen, was die Web-App nach der Änderung am laufenden Player tut (`applyLive`, `restartIfPlaying` in `app.js`, die Aufrufe der Handler und die von `render()`); während keine Wiedergabe läuft, tut sie nichts, und die Shell gibt der Engine vor dem nächsten Start den neuen Stand.

| Merker | Web-App | Shell |
| --- | --- | --- |
| `events` | `player.setTrack({ ...track, layers: ALL_LAYERS })` (aus `applyLive({ patterns: true })`) | `Engine::setTrack(track())` (`track()` hat jede Schicht an) |
| `sound` | `player.setTimbre` (jedes `applyLive`, die Klangknöpfe) oder `player.setTuning` (`renderOrgan`, wenn sich `organTuning(state.organ)` geändert hat) | `Engine::setSound(sound())`, `Engine::setTuning(tuning())` |
| `voices` | `player.setVoices` (Stimmenwahl, und `renderVoices`, wenn sich eine Stimme oder Variante geändert hat) | `Engine::setVoices` mit `track().voices` |
| `tempo` | `player.setTempo` (`applyLive({ tempo: true })`, Tempo-Regler) | Transport auf `track().bpm` |
| `mix` | `setLevel`, `setMaster`, `setPan`, `setLayer` | `Engine::setLevel`, `setMaster`, `setPan` aus `state().mix` und `pan`; `Engine::setMuted` aus `state().track.layers` |
| `restart` | `restartIfPlaying`: Stopp und neuer Start mit allem (`play` mit `{ ...track, layers: ALL_LAYERS }`, danach `setLayer(name, false)` für jede stumme Schicht, `app.js` 128–139) | `Engine::setTrack(track())`, `setVoices`, `setSound`, `setTuning`, Pegel, Panorama, `setMuted` für jede stumme Schicht; eine laufende Wiedergabe neu starten |
| `inPlace` | nur mit `restart`: `restartIfPlaying({ inPlace: true })`, neu am Takt, der gerade spielt (`current.bar % loopBars(track)`); ohne: neu ab Takt 1 | Startpunkt des Neustarts |

Allgemeine Regeln: `applyLive({ patterns, tempo })` setzt `sound`, dazu `tempo` mit `tempo` und mit `patterns` `events`. Kann die Web-App den Track nicht live tauschen (`play.js` `setTrack` liefert `false` für einen Track anderer Länge, Dauer oder Taktart als der des Players), startet sie am selben Takt neu: dann sind die Merker die dieses Neustarts, `restart` und `inPlace` statt `events` (`sound` und `tempo` bleiben, `setTimbre` und `setTempo` gingen vorher an den Player). Von den Aktionen mit `applyLive({ patterns: true })` trifft das nur `setStyle`, wenn die Vorlage Auto die Form zu einer anderen Länge würfelt; die übrigen ändern weder Länge noch Taktart (`toggleTag`, `setGroove`, `setRhythmKnob`, `setJob`, `setFormFeel`) oder rufen `applyLive` nur bei gleicher Länge (die Übernahmen der Songform; jeder Takt hat die Schläge der Taktart, die Dauer folgt also der Länge). Nach jedem Handler setzt die Sitzung wie `render()` `voices`, wenn sich `completeVoices(track.voices)` in einer Schicht (Stimme oder Variante) geändert hat, und `sound`, wenn sich `organTuning(organ)` geändert hat.

## 2. Startzustand

Der Konstruktor legt den Startzustand der Web-App für die **Variante 1** an, mit den Standardwerten von Mischpult und Panorama (`loadMix`, `loadPan` bei leerem Speicher). Die Aktion `start` mit einer Variante setzt den Startzustand dieser Variante, so wie eine frisch geladene Web-App ihn hat (Literal in `state.js` 58 bis 90 mit `seed: rollVariant()`, dann `app.js` 484 und 485: `deriveBars()` und `setFormTemplate('auto')`, also die erste Form mit Vorlage Auto und 96 Takten; die Auswahl im Streifen auf dem ersten Teil, die Merker von „Überrasch mich“ alle `false`). **Mischpult und Panorama bleiben bei `start`, wie sie sind:** in der Web-App sind sie gespeicherte Einstellungen, die ein neues Laden behält.

Warum so: Der Kern würfelt nicht, die Variante muss von außen kommen. Ein Konstruktor ohne gültigen Zustand gäbe jeder Abfrage vor dem ersten `start` eine Sonderregel; mit Variante 1 ist jeder Zustand gültig, und eine Folge, die mit `start { variant: n }` beginnt, gleicht der frisch geladenen Web-App mit der Variante n. Die Shell schickt `start` mit einer selbst gewürfelten Variante nur, wenn sie keine gespeicherte Sitzung wiederhergestellt hat (das Wiederherstellen ist Task 30).

## 3. Aktionen

Quellen: Datei und Zeilen der Handler im Stand dieses Tasks. „R“ = in der Referenz als echte Funktion aufgerufen, „A“ = als Abschrift des Handlers (Liste in Abschnitt 6). Bei den Merkern heißt „`restart`, `inPlace`“ neu am Takt, „`restart`“ allein neu ab Takt 1.

### Variante, Tonart, Stil, Tempo

| Aktion | Felder | Ändert | Merker | Gleicher Wert | Quelle |
| --- | --- | --- | --- | --- | --- |
| `start` | `variant`: ganze Zahl 1 bis 9999 | alles außer Mischpult und Panorama: der Startzustand dieser Variante (Abschnitt 2) | `events`, `sound`, `voices`, `tempo`, `mix` (kein `restart`: nach dem Laden spielt nichts) | — | `state.js` 58–90 (R), `app.js` 484–485 (R) |
| `newVariant` | `variant`: 1 bis 9999 (das `rollVariant()` der Shell) | `setVariant`: `track.seed`, `deriveBars()` (eigene Folge entfällt, Farbe vom Stil folgt der Variante), `rollNewForm()` (nicht gesperrte Teile) | `restart`, `inPlace` | wie sonst (Tasten „Neue Variante“, „Zufall“) | `app.js` 340–348 (A, `deriveBars`/`rollNewForm` R) |
| `stepVariant` | `dir`: -1 oder 1 | wie `newVariant` mit `stepVariant(seed, dir)` (9999 → 1, 1 → 9999) | `restart`, `inPlace` | — (Tasten) | `app.js` 349–350, `variant.js` (R) |
| `enterVariant` | `variant`: 1 bis 9999 | wie `newVariant`, dazu `touched.variant = true` | `restart`, `inPlace` | wie sonst (das Feld meldet geänderten Text, auch „0012“ für 12) | `app.js` 353–356 (A) |
| `setRoot` | `root`: einer von `ROOTS`; `from`: `"start"` (Chips im Popover der Startseite) oder `"play"` (Auswahl im Modul Harmonie) | `chooseRoot`: `track.key = { root, mode: SCALE_MODE[scale] }`, `deriveBars()`; mit `"start"` `touched.key = true` | `restart` | `"play"`: nichts; `"start"`: wie sonst (der Chip löst erneut aus) | `key-scale.js` 7–10 (R), 25, 29, 52, 56; `app.js` 206 |
| `setScale` | `scale`: einer von `SCALE_NAMES`; `from` wie oben | `chooseScale`: `scale`, Modus der Tonart, `deriveBars()`; mit `"start"` `touched.key = true` | `restart` | wie `setRoot` | `key-scale.js` 12–16 (R), 30, 53, 57; `app.js` 206 |
| `setStyle` | `style`: eine id der Tabelle `STYLE_PRESETS` (`music.json` `styles`); `from`: `"start"` (Stilkarten) oder `"play"` (Auswahl im Modul Charakter) | `applyStyle`: Stil, Farbe vom Stil (Folge umgefärbt oder neu abgeleitet), Stiltempo in der Taktart (`convertTempo`), Schlagworte, Stimmen von Bass, Akkorden, Schlagzeug, Klangknöpfe leer, mit Vorlage Auto die nicht gesperrten Teile neu; mit `"start"` `touched.style = true` | `events`, `sound`, `tempo`; würfelt Auto die Form zu einer anderen Länge: `restart`, `inPlace`, `sound`, `tempo` (Abschnitt 1); `voices`, wenn sich eine Stimme ändert | `"play"`: nichts; `"start"`: wie sonst (die Karte löst erneut aus) | `state.js` 118–130 (R); `app.js` 256–261, 275–279, 418 (A) |
| `setTempo` | `bpm`: ganze Zahl 40 bis 200; `from`: `"start"` (Regler im Popover) oder `"play"` (Knopf im Modul Rhythmus) | `track.bpm`; mit `"start"` `touched.tempo = true` | `tempo` | nichts (beide Regler zeigen `track.bpm`; auch kein Merker) | `app.js` 282–289, 415; `tuning.js` 141 (A) |
| `surprise` | `variant`: 1 bis 9999; `style`, `tempo`, `scale`, `root`: Zahlen in [0, 1) (die `Math.random()` der Web-App) | „Überrasch mich“: ohne `touched.style` `applyStyle` mit dem Eintrag `⌊style · Länge⌋` der Tabelle `STYLE_PRESETS`; Tempo ohne `touched.tempo` `round(Stiltempo · (0,9 + tempo · 0,2))`, auf 40 bis 200 begrenzt, sonst das alte; ohne `touched.variant` `track.seed = variant`; ohne `touched.key` die Skala `⌊scale · Länge⌋` von `SCALE_NAMES` und `chooseRoot` mit dem Grundton `⌊root · Länge⌋` von `ROOTS`, sonst `deriveBars()`; dann `rollNewForm()`. Die Felder sind immer nötig, auch wenn ein Merker sie unbenutzt lässt. | `restart`, `inPlace`; `voices`, wenn sich eine Stimme ändert | — (Taste) | `app.js` 209–223 (A) |

### Schlagworte, Akkordfolge, Rhythmus

| Aktion | Felder | Ändert | Merker | Gleicher Wert | Quelle |
| --- | --- | --- | --- | --- | --- |
| `toggleTag` | `category`: id aus `TAG_CATEGORIES`; `tag`: ein Wort dieser Kategorie | `track.tags = toggleTag(tags, category, tag)` (Reihenfolge der Kategorien und Wörter wie `TAG_CATEGORIES`, leere Kategorien entfallen) | `sound`; `events`, außer es ist ein reiner Klangwechsel (`isSoundOnlyChange`) | — (Umschalter) | `tuning.js` 29–35 (A), `tags-ui.js` 9–16 (R) |
| `addChord` | `root`, `quality`: ein Akkord aus `chordOptions(track.key)` (Grundton in der Schreibweise der Tonart, Art aus seinen `qualities`; das Akkordrad schickt die Teilmenge `allowedChords`) | hängt `{ chord: { root, quality }, beats }` an; bei 8 Akkorden (`MAX_CHORDS`) nichts (Hinweis „Folge voll“, Abschnitt 6) | `restart`, wenn angehängt; sonst nichts | — (Chips, Rad) | `progression-editor.js` 13–22 (R), 55; `tuning.js` 19, 85 |
| `removeChord` | `index`: ganze Zahl 0 bis Zahl der Akkorde − 1; ungültig bei einem Akkord (Knopf ausgegraut) | entfernt den Akkord | `restart` | — (Knopf) | `progression-editor.js` 24–29, 82–85, 102 (A) |
| `setChordColor` | `color`: eine von `CHORD_COLORS` | `chordColorFromStyle = false`, `setChordColor(color)` (unveränderte Folge neu abgeleitet, sonst umgefärbt) | `restart` | wie sonst (der Chip löst erneut aus) | `chord-color.js` 13–17 (A), `state.js` 109–115 (R) |
| `setMeter` | `meter`: ein Schlüssel von `METERS` (`"4/4"`, `"3/4"`, `"6/8"`, `"12/8"`, `"5/4"`) | `setMeter`: Taktart, Standard-Groove, Tempo umgerechnet (über `tempoRef` verlustfrei), Schläge der Takte | `restart`, `inPlace`, wenn sie sich ändert | nichts (`setMeter` lehnt dieselbe Taktart ab; der Chip löst aus) | `rhythm.js` 15–18 (A), `state.js` 134–149 (R) |
| `setGroove` | `groove`: einer von `groovesFor(Taktart)` | `track.groove` | `events`, `sound` | wie sonst (die Auswahl zeigt `grooveIdFor`, abgeleitet) | `rhythm.js` 28–32 (A) |
| `setRhythmKnob` | `knob`: `"complexity"`, `"loose"` oder `"ornaments"`; `value`: ganze Zahl 0 bis 100 | `track[knob] = value / 100` | `events`, `sound` | wie sonst (der Knopf zeigt 50 %, solange das Feld fehlt) | `rhythm.js` 36–49 (A) |

### Songform

Die Felder „ganzes Lied“ (`form-panel.js`) und die Teile (`form-strip.js`). „Länge gleich“ heißt: `track.length` nach der Aktion wie davor. Die Aktionen des Streifens und der Einstellungen des Teils wirken auf den gewählten Teil, `state().selectedPart`, wie in `form-strip.js`.

**Die Auswahl** (`selectedPart`, in der Web-App `selected` in `form-strip.js`): `start` setzt sie auf 0. Ein Klick auf einen Teil oder eine Taste im Streifen (Pfeile, Pos1, Ende, Eingabe) setzt sie (`selectPart`). Jede Übernahme einer Bearbeitung setzt sie auf das `index` des Ergebnisses von `form-ui.js` (in den Zeilen unten). Nach jeder Aktion wird sie, wie `renderStrip`, auf die Teile einer gültigen Form begrenzt (0 bis Teile − 1); ohne Form bleibt sie stehen. Würfeln, Vorlage, Zielgröße und „Ohne Form“ setzen sie nicht, nur die Begrenzung wirkt. **Grenze:** die Web-App begrenzt nur, während die Spielseite den Streifen zeigt; die Sitzung begrenzt nach jeder Aktion, als wäre er zu sehen. Das kann einen anderen Teil ergeben als in der Web-App: Ist Teil 8 gewählt und würfelt man auf der Startseite erst eine Form mit 7 Teilen und dann eine mit 12 (neue Variante, „Überrasch mich“, Stilkarte), steht die Auswahl in der Web-App danach auf Teil 8, in der Sitzung auf Teil 6. Der Streifen zeigt die Auswahl, bevor jemand bearbeitet.

| Aktion | Felder | Ändert | Merker | Gleicher Wert | Quelle |
| --- | --- | --- | --- | --- | --- |
| `setFormTemplate` | `template`: `"auto"`, eine von `TEMPLATE_IDS` oder `"off"` | `setFormTemplate`: würfelt alles neu (Sperren fallen); `"off"` entfernt die Form, die Länge ist die Zielgröße. Auswahl: begrenzt | Länge gleich: `events`, `sound`; sonst `restart`, `inPlace` | nichts (die Auswahl zeigt `formChoice()`) | `form-panel.js` 19, 24–29, 73 (A), `state.js` 174–179 (R) |
| `setFormTarget` | `bars`: eine von `TARGET_SIZES` | `setFormTarget`: Zielgröße; mit Form alles neu, ohne Form die Länge. Auswahl: begrenzt | wie oben | nichts (die Auswahl zeigt die Zielgröße, ohne Form die Länge) | `form-panel.js` 34–39, 76–77 (A), `state.js` 182–186 (R) |
| `setFormFeel` | `knob`: `"structure"`, `"dynamics"`, `"pauses"` oder `"randomness"`; `value`: ganze Zahl 0 bis 100 (`dynamics` bis 130); ungültig ohne Form (Knöpfe ausgegraut) | `setFormFeel(knob, value / 100)`: würfelt nicht | `structure`: nichts; sonst `events`, `sound` | nichts (der Knopf zeigt `form.feel`) | `form-panel.js` 41–54, 79–83 (A), `state.js` 189–192 (R) |
| `releaseStructure` | keine; ungültig ohne Form | das Loslassen des Knopfs Struktur (sein `change`): `rollNewForm()`. Auswahl: begrenzt | wie `setFormTemplate` | — (meldet sich nach einer Bewegung, auch zurück auf den alten Wert) | `form-panel.js` 55–61 (A) |
| `selectPart` | `index`: ganze Zahl 0 bis Teile − 1; ungültig ohne gültige Form (der Streifen fehlt) | `selectedPart = index` | nichts | wie sonst (ändert nichts) | `form-strip.js` 66–77, 104–112 (A) |
| `editPart` | `field` und `value`: `"type"` mit einer von `PART_TYPES`, `"transition"` mit einer von `TRANSITIONS`, `"crash"` mit `true`/`false`, `"level"` mit ganzer Zahl −24 bis 0 (dB), `"density"` mit ganzer Zahl −100 bis 100 (Prozent), `"bars"` mit ganzer Zahl 1 bis 64; `"level"`/`"density"` mit `null` setzen zurück (ungültig, solange der Teil keinen eigenen Wert hat: die Taste ist ausgegraut); ungültig ohne gültige Form | `editPart(form, selectedPart, { field: value })`: setzt das Feld und sperrt den Teil; eine Summe über 512 ändert nichts. Auswahl: `index` des Ergebnisses (derselbe Teil) | ohne Ergebnis nichts; Länge gleich: `events`, `sound`; sonst `restart`, `inPlace` | `type`, `bars`: nichts (die Auswahl zeigt den Typ, der Griff meldet nur eine andere Länge); `transition`, `level`, `density`: wie sonst (abgeleitet); `crash`: — (Taste) | `form-strip.js` 49–63, 94, 114–123, 195 (A), `form-ui.js` 88–109 (R) |
| `toggleLock` | keine; ungültig ohne gültige Form | `setLocked(form, selectedPart, !locked)`. Auswahl: derselbe Teil | wie `editPart` | — (Taste) | `form-strip.js` 124 (A), `form-ui.js` 112–115 (R) |
| `deletePart` | keine; ungültig ohne gültige Form | `deletePart` (der letzte Teil bleibt). Auswahl: der Nachbar, `min(index, Teile − 2)` | wie `editPart` | — (Taste) | `form-strip.js` 125 (A), `form-ui.js` 133–136 (R) |
| `movePart` | `dir`: -1 oder 1; ungültig ohne gültige Form | `movePart` (sperrt den Teil). Auswahl: folgt dem Teil, `index + dir` | wie `editPart` | — (Tasten) | `form-strip.js` 126–127 (A), `form-ui.js` 139–145 (R) |
| `copyPart` | keine; ungültig ohne gültige Form | `copyPart` (gesperrte Kopie dahinter). Auswahl: die Kopie, `index + 1` | wie `editPart` | — (Taste) | `form-strip.js` 128 (A), `form-ui.js` 124–130 (R) |
| `addPart` | keine; ungültig ohne gültige Form | `addPart` (gesperrte Strophe, 8 Takte). Auswahl: der neue letzte Teil | wie `editPart` | — (Taste) | `form-strip.js` 129 (A), `form-ui.js` 118–121 (R) |
| `rerollForm` | keine; ungültig ohne gültige Form (die Taste steht nur mit Form da) | „Neu würfeln“: `rollNewForm({ reroll: true })` (`formSalt + 1`); sind alle Teile gesperrt, nichts (Hinweis „alle gesperrt“, Abschnitt 6). Auswahl: begrenzt | wie `editPart` | — (Taste) | `form-strip.js` 130–147 (A) |

Das Ziehen der Länge am Griff ist ein `editPart` mit `field: "bars"`; die Web-App ändert die Form beim Ziehen und startet erst beim Loslassen neu, die Seite schickt den Wert beim Loslassen (oder je Schritt, dann mit `restart` je Schritt).

### Mischpult, Stimmen, Aufgaben, Klang, Orgel

| Aktion | Felder | Ändert | Merker | Gleicher Wert | Quelle |
| --- | --- | --- | --- | --- | --- |
| `setLevel` | `channel`: eine Schicht (`LAYER_IDS`) oder `"master"`; `value`: ganze Zahl 0 bis 100 | `mix[channel] = value / 100` | `mix` | nichts | `mixer.js` 34–41, 101–103 (A) |
| `setPan` | `layer`: eine von `LAYER_IDS`; `value`: ganze Zahl −100 bis 100 | `pan[layer] = value / 100` | `mix` | nichts | `mixer.js` 54–60, 111–112 (A) |
| `toggleMute` | `layer`: eine von `LAYER_IDS` | `track.layers[layer]` umgeschaltet; `track()` bleibt (jede Schicht an), der Schalter wirkt über `Engine::setMuted` | `mix` | — (Taste) | `mixer.js` 64, `app.js` 198–202 (A) |
| `toggleAllVoices` | keine | `setAllVoices(voices, voiceKind(voices) === 'sample' ? 'synth' : 'sample')` | `voices` | — (Taste) | `mixer.js` 79, `voices-panel.js` 48–53 (A), `voices.js` (R) |
| `setVoice` | `layer`: eine von `VOICE_LAYERS`; `id`: eine nicht verborgene Stimme der Schicht; `variant`: eine ihrer Varianten | `track.voices = completeVoices({ ...voices, [layer]: { id, variant } })` | `voices` | nichts (die Auswahl zeigt `id/variant`) | `voices-panel.js` 40–45, 81–84, 100 (A) |
| `setJob` | `layer`: eine Schicht mit Aufgaben (`lead`, `percussion`); `job`: eine von `jobsFor(layer)` | `track.jobs[layer]` | `events`, `sound` | nichts | `jobs-panel.js` 17–21, 29–33, `app.js` 387 (A) |
| `setTimbre` | `group`: eine Gruppe von `DEFAULT_TIMBRE`; `field`: ein Feld der Gruppe; `value`: ganze Zahl 0 bis 100; ungültig, wenn die gewählte Stimme das Feld nicht benutzt (`usesTimbreField`, der Knopf ist ausgegraut) | `track.timbre[group][field] = value / 100` | `sound` | wie sonst (abgeleitet) | `timbre-panel.js` 39–44, 108–109 (A) |
| `resetTimbre` | `group` wie oben; ungültig, solange die Gruppe keinen gesetzten Knopf hat (Taste ausgegraut) | entfernt `track.timbre[group]` | `sound` | — (Taste) | `timbre-panel.js` 55–59, 115–116 (A) |
| `setLeslie` | `mode`: eine von `LESLIE_MODES` (`off`, `slow`, `auto`, `fast`); ungültig, wenn die Akkorde nicht die Orgel spielen (die Knöpfe sind verborgen) | `organ.leslie` | `sound`, wenn sich `organTuning` ändert | nichts (der Knopf zeigt den Platz des Modus) | `organ-panel.js` 32–35, 48–52 (A) |
| `setOrganDrive` | `value`: ganze Zahl 0 bis 100, oder `null` (Doppelklick: zurück zur Zerre des Presets); ungültig wie `setLeslie` | `organ.drive = value / 100` bzw. `null`. Der Doppelklick stellt in der Web-App erst den Knopf auf 0 (knob.js, ein eigener Schritt mit `render()`, wenn er nicht schon 0 zeigt), dann `null`: beide Schritte zählen für `sound` | `sound`, wenn sich `organTuning` in einem der Schritte ändert | wie sonst (der Knopf zeigt die Zerre des Presets, solange `drive` `null` ist) | `organ-panel.js` 36–44, `knob.js` 103–108 (A) |

## 4. Felder von `state()`

`state()` ist der Zustand der Sitzung selbst, dazu `errors`. Abgeleitete Daten (Abschnitt 5) kommen erst mit Task 31 und 32 hinzu, jedes mit seinem Fall.

| Feld | Typ | Bedeutung | Web-App |
| --- | --- | --- | --- |
| `track` | Objekt | der Track: `key`, `bpm`, `bars`, `tags`, `voices`, `timbre`, `layers` (die Schalter des Nutzers), `jobs`, `seed`, `variety`, `length`, `meter`, bei Bedarf `groove`, `complexity`, `loose`, `ornaments`, `form` | `state.track` |
| `formTarget` | Zahl aus `TARGET_SIZES` | Zielgröße der Songform; ohne Form die Länge | `state.formTarget` |
| `formSalt` | ganze Zahl ≥ 0 | wie oft „Neu würfeln“ bei dieser Variante gedrückt wurde (Seed des Würfelns: Variante + 10000 · formSalt) | `state.formSalt` |
| `formFeel` | `{ structure, dynamics, pauses, randomness }` | die Reglerwerte der Form; bleiben ohne Form stehen | `state.formFeel` |
| `scale` | id aus `SCALE_NAMES` | Skala | `state.scale` |
| `chordColor` | id aus `CHORD_COLORS` | Akkordfarbe | `state.chordColor` |
| `chordColorFromStyle` | Wahrheitswert | `true`: die Farbe kommt vom Stil und folgt der Variante | `state.chordColorFromStyle` |
| `style` | Stil-id | Stil | `state.style` |
| `mix` | `{ <Schicht>, master }` je 0 bis 1 | Fader des Mischpults | `state.mix` |
| `pan` | `{ <Schicht> }` je −1 bis 1 | Panorama | `state.pan` |
| `organ` | `{ leslie, drive }` | Orgel: Leslie-Wähler, Zerre (`null` = die des Presets) | `state.organ` |
| `tempoRef` | `null` oder `{ key, quarter, shown }` | der Tempo-Merker des letzten Taktartwechsels (unabgerundetes Viertel-Tempo) | `state.tempoRef` (fehlt dort statt `null`) |
| `touched` | `{ key, style, tempo, variant }` je Wahrheitswert | was der Nutzer auf der Startseite selbst gewählt hat; „Überrasch mich“ lässt es stehen | `touched` in `app.js` 205 |
| `selectedPart` | ganze Zahl ≥ 0 | der gewählte Teil des Streifens, den die Einstellungen des Teils zeigen und bearbeiten (Regeln in Abschnitt 3) | `selected` in `form-strip.js` 35 |
| `errors` | Liste `{ code, params }` | `validateTrack(track)` (wie `app.js` es nach einem gescheiterten Start zeigt; die Aktionen der Sitzung halten den Track gültig, also leer) | `state.errors` |

`track()` ist, was die Web-App ihrem Player gibt: `{ ...state.track, layers: ALL_LAYERS }`, jede Schicht an (`app.js` 128 und 191); die Stummschaltung geht als `setLayer` an den Player (`app.js` 139 und 200), damit Einschalten ohne Neustart klingt. Der Generator des Kerns lässt eine ausgeschaltete Schicht weg, darum braucht die Engine den Track mit allen Schichten und `Engine::setMuted` aus `state().track.layers`. `sound()` ist `resolveTrackTimbre(track)` (was `applyLive` an `setTimbre` gibt), `tuning()` ist `organTuning(organ)` (was `renderOrgan` an `setTuning` gibt).

## 5. Bausteine unter `src/ui`: was sie lesen

Je Modul, das `state` liest: die Felder von `state()` und die abgeleiteten Daten, mit der Funktion des Kerns, die sie liefert. „fehlt“: noch keine Funktion im Kern, Task 31 oder 32 portiert sie, wenn die Seite sie braucht.

| Baustein | liest aus `state()` | braucht abgeleitet (Funktion im Kern) |
| --- | --- | --- |
| `app.js` (Kopfleiste, Startseite) | `track.key.root`, `bpm`, `seed`, `bars`, `style`, `scale`, `errors`; Seite, Wiedergabe, Sprache (außerhalb) | Akkordnamen: `chordName` (`track_internal.h`); Takte eines Durchlaufs `loopBars`: `isValidFormValue`, `formLengthOf` (`track_internal.h`); Akkord und Teil am Takt `chordAtBar`, `partLabel`: `chordIndex`, `sectionAt` (fehlt öffentlich, in `harmony.cpp` intern); Countdown: `beatsUntilChange` (`harmony.h`); Stiltempo der Karten: `music.json` `styles` |
| `key-scale.js` | `track.key.root`, `scale` | Listen `ROOTS`, `SCALE_NAMES`: `music.json` `roots`, `scaleModes` |
| `tuning.js` (Rack, Visualisierung) | `track` (`tags`, `bpm`, `layers`, `bars`, `key`, `length`, `form`), `scale`; Takt der Wiedergabe (außerhalb) | Wirkung eines Worts `tagEffect` (`timbre.h`); folgender Akkord `nextDistinctChord`, Rollen `progressionRoles`, Stufe `romanDegree` (`harmony.h`); Verlauf und LEDs: `buildEvents` (`btg/generator.h` über die Engine), `activeLayers`, `laneKey` (fehlt) |
| `tags-ui.js` | `track.tags` | `tagEffect` (`timbre.h`); `TAG_CATEGORIES`: `music.json` `tags`; Texte der Anzeige (Seite) |
| `progression-editor.js` | `track.bars`, `track.key`; Hinweis „Folge voll“ (außerhalb, Abschnitt 6) | Akkordarten je Grundton `chordOptions` (`track_internal.h`); `chordIndex` (fehlt öffentlich); `progressionRoles`, `romanDegree` (`harmony.h`) |
| `chord-color.js` | `chordColor` | `CHORD_COLORS`: `music.json` `chordColors.table` |
| `fretboard.js` | über `tuning.js`: `track.key`, `scale`, jetziger und folgender Akkord | Töne `fretboardNotes` (`harmony.h`); `chordMidi`, `noteName` (fehlt) |
| `wheel.js` | über `tuning.js`: `track.key`, Akkorde der Folge, jetziger und folgender Akkord | `allowedChords` (`track_internal.h`), `diatonicChords` (fehlt öffentlich, in `track.cpp` intern), `noteToPcOf` (`track_internal.h`), `chordShort` (fehlt); Geometrie (Seite) |
| `mixer.js` | `mix`, `pan`, `track.layers`, `track.voices` | Schalter „Alle Samples“ `voiceKind` (in `session.cpp` intern, fehlt öffentlich); Standard-Panorama: `sound.json` `tunables["mix/pan"]` |
| `rhythm.js` | `track.meter`, `groove`, `complexity`, `loose`, `ornaments`, `bpm` | gewählter Groove `grooveIdFor` (in `generator.cpp` auf dem typisierten Track, fehlt auf JSON); Grooves der Taktart `groovesFor`: `grooves.json` |
| `form-panel.js` | `track.form` (`auto`, `template`, `feel`), `track.length`, `formTarget`, `formFeel` | `formChoice` (in `session.cpp` intern); `TEMPLATE_IDS`, `TARGET_SIZES`, `FEEL_DEFAULTS`, `DYNAMICS_MAX`: `music.json` `form` |
| `form-strip.js`, `form-ui.js` | `track.form`, `track.length`, `selectedPart`; Takt der Wiedergabe (außerhalb); Hinweis „alle gesperrt“ (außerhalb, Abschnitt 6) | Blöcke, Pegel- und Dichtewerte und -texte `stripBlocks`, `levelValue`, `densityValue`, `levelLabel`, `densityLabel` (fehlt, Urteil Task 27); `resolveSection` (in `generator.cpp` typisiert, fehlt auf JSON); was geht `limits` (`form_internal.h`); `sectionAt` (fehlt öffentlich); `isValidFormValue`, `formLengthOf` |
| `timbre-panel.js` | `track.timbre`, `track.voices`, `track.tags` | wirksame Knopfwerte `resolveTrackTimbre` (`timbre.h`, auch `sound()`); ausgegraut `usesTimbreField` (`timbre.h`); Felder `DEFAULT_TIMBRE`: `forEachField` (`sound_model.h`) |
| `voices-panel.js` | `track.voices` | `completeVoices` (`track_internal.h`); Liste der Stimmen: `music.json` `voices`, `voiceKinds`; `usesTimbreField`; Ladezustand: `Engine::voiceStatus` |
| `jobs-panel.js` | `track.jobs` | `completeJobs` (`track_internal.h`); `jobsFor`: `music.json` `layers` |
| `organ-panel.js` | `organ`, `track.voices` | `presetDrive`, `organTuning` (`timbre.h`; `organTuning` auch `tuning()`) |
| `lanes.js` | über `tuning.js`: Ereignisse, `track.layers` | `buildEvents`, `activeLayers` (fehlt) |
| `position.js` | `track` | `loopBars`, `chordAtBar` (siehe `app.js`); Text (Seite) |
| `profiles.js`, `profile-session.js`, `session-store.js` | `track`, `scale`, `style`, `chordColor`, `chordColorFromStyle`, `mix`, `pan`, `organ` (`readSession`) | Task 30 |
| `layout-state.js`, `knob.js`, `knob-geometry.js`, `knob-slots.js`, `lcd-select.js`, `canvas.js`, `wheel-geometry.js`, `profile-tree-view.js`, `profile-drag.js`, `profile-parts-picker.js`, `profile-factory.js`, `profile-store.js`, `organ-tuning.js`, `tag-effects.js`, `variant.js`, `mix-state.js` | keine Felder von `state` (reine Rechnung, Geometrie, Speicher oder Bauteile; `organ-tuning.js`, `tag-effects.js`, `variant.js` sind die Funktionen oben) | — |

## 6. Außerhalb der Sitzung

| Was | Warum | Wo bis Phase 7 |
| --- | --- | --- |
| `lang` | Einstellung der Seite, kein Musikzustand | Seite (`readLang`, `saveLang`, Speicher `backingtrack.lang`) |
| `page` | welche Seite sichtbar ist | Seite |
| `layout` | Fokus/Einstellen, Beschriftung und Bünde des Griffbretts | Seite (`layout-state.js`, Speicher `backingtrack.layout`) |
| `playing`, `current` | Lage der Wiedergabe, kommt vom Transport | Shell (Transport) |
| Hinweis „Folge voll“ (`notice`) | Meldung der Seite (unten) | Seite |
| Hinweis „alle gesperrt“ (`rollNote` in `form-strip.js`) | Meldung der Seite (unten) | Seite |
| Fehler eines gescheiterten Starts (`playFailed`) | Laufzeit der Wiedergabe | Shell; `state().errors` sind allein `validateTrack(track)` |
| gewählter Grundton (`progression-editor.js`), gezeigtes Schlagwort (`tags-ui.js`), Ladezustand der Packs (`voices-panel.js`) | Bedienzustand eines Bauteils, kein Zustand der Musik | Seite; der Ladezustand bei `Engine::voiceStatus` |
| „Weitermachen“, Profile laden und speichern | Task 30 (Teile, `applyParts`, Speicher) | Web-App |
| Mischpult und Panorama im Speicher (`saveMix`), zuletzt gespielte Sitzung | Task 30 (`Storage`) | Web-App; die Sitzung liest und schreibt in Task 29 nichts |

**Die Hinweise der Web-App**, wann sie kommen und wie lange sie stehen:

- „Folge voll“ (`state.notice = 'ui.progressionFull'`, `progression-editor.js` 14–17): kommt, wenn ein `addChord` 8 Akkorde vorfindet; die Sitzung ändert dann nichts (alles `false`), die Seite erkennt es daran, dass sie `addChord` schickte und die Folge 8 Akkorde hat. Ein zweites `addChord` bei voller Folge sagt den Hinweis erneut an (`refusals`, Seite). Er steht bis zur nächsten dieser Aktionen, deren `Change` nicht ganz `false` ist: `setRoot`, `setScale`, `newVariant`, `stepVariant`, `enterVariant`, `surprise`, `start` (über `deriveBars`, `state.js` 101), `setChordColor` und `setStyle` (`setChordColor`, `state.js` 114), `removeChord` (`progression-editor.js` 27) und ein `addChord`, das anhängt (20). Eine Wiederholung eines gezeigten Werts (alles `false`) löscht ihn nicht, wie in der Web-App.
- „alle gesperrt“ (`rollNote = true`, `form-strip.js` 132–135): kommt, wenn `rerollForm` lauter gesperrte Teile vorfindet; die Sitzung ändert dann nichts, die Seite erkennt es daran, dass jeder Teil von `track.form` gesperrt ist. Er steht bis zur nächsten gültigen Aktion des Streifens: `selectPart` (`choose`, 67), `editPart`, `toggleLock`, `deletePart`, `movePart`, `copyPart`, `addPart` (`commit`, 50, auch wenn `form-ui.js` kein Ergebnis gibt, nicht aber eine Wiederholung von `editPart`: die Web-App meldet sie nicht) und ein `rerollForm`, das würfelt (136). Vorlage, Zielgröße, Regler und alle anderen Aktionen lassen ihn stehen.

Die Referenz der Prüfung ruft die Handler, die nur im Browser laufen, als Abschriften auf (`native/tools/session-reference.mjs`, jede mit Datei und Zeilen ihrer Quelle): `app.js` (Variante, Stil, Tempo, „Überrasch mich“, Stummschalten, `applyLive`, `restartIfPlaying`), `play.js` (was der Player spielt und wann `setTrack` ablehnt), `rhythm.js`, `form-panel.js`, `form-strip.js` (Auswahl, `commit`, `renderStrip`), `mixer.js`, `voices-panel.js`, `jobs-panel.js`, `timbre-panel.js`, `organ-panel.js` mit `knob.js`, `chord-color.js`, `tuning.js` (Schlagworte) und `removeChord` aus `progression-editor.js` (nicht exportiert). Alles andere ist die echte Funktion.
