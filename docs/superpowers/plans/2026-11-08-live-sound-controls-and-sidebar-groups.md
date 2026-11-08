# Klangregler live und gegliederte Seitenleisten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Nutzer regelt jedes Klangfeld aller Instrumente (26 Felder) mit Schiebereglern, und Regler wie Schlagwort-Knöpfe wirken live, ohne Neustart; beide Seitenleisten werden in einklappbare Gruppen gegliedert.

**Architecture:** Das Klangmodell (`core/timbre.js`, Felder 0..1) bekommt eine zweite Quelle: `track.timbre` (nur die vom Nutzer gesetzten Felder) liegt über dem, was die Schlagworte ergeben. `synth.js` liest die Stimmparameter beim Anschlag aus veränderbaren Objekten und stellt feste Knoten (Hall, Echo, Helligkeit, Raum-Sendeweg) weich nach; `play()` bekommt `setTimbre` und `setTrack` (Ereignisstrom im laufenden Betrieb austauschen). Die Oberfläche gliedert beide Leisten mit `<details>`-Gruppen, deren Offen-Zustand im Layout gemerkt wird.

**Tech Stack:** Reines JavaScript (ES-Module), Web Audio API, `node:test` (`npm test`), Playwright (`npx playwright test`).

**Spec:** Es gibt kein eigenes Spec-Dokument; maßgeblich sind die im Chat vom 2026-11-08 abgestimmten Entscheidungen, zusammengefasst im Abschnitt "Entscheidungen". Grundlage: `docs/superpowers/specs/2026-11-07-sound-shaping-design.md`.

## Entscheidungen (abgestimmt bzw. als meine Wahl markiert)

- Regler für alle 26 Felder von `DEFAULT_TIMBRE` (drums 7, bass 6, chords 4, pad 6, master 3), nach Instrument in Gruppen. Abgestimmt.
- Quellen in fester Reihenfolge: Schlagworte setzen den Startwert, ein bewegter Regler überschreibt nur sein Feld und gewinnt immer. Ein Schlagwort-Wechsel lässt überschriebene Felder stehen. Abgestimmt.
- Live: Regler und reine Klang-Schlagworte über `setTimbre`; Schlagworte mit Mustereffekt und die Schnellauswahl über `setTrack` (Ereignisstrom tauschen, ab dem nächsten noch nicht geplanten Ereignis). Tonart, Skala, Akkordfolge, Variante, Länge starten weiter neu. Abgestimmt.
- Seitenleisten als `<details>`-Gruppen; offen/zu wird gemerkt. Links: Stil, Tempo & Länge, Schlagzeug-Klang, Bass-Klang, Akkord-Klang, Pad-Klang, Gesamtklang. Rechts: Tonart & Skala, Akkordfolge, Ansichten. Abgestimmt (die Instrument-Gruppen stehen flach statt in einer Obergruppe: **meine Vereinfachung**).
- Meine Wahl: `track.timbre` wird wie die Schlagworte nicht über das Neuladen hinaus gemerkt. Meine Wahl: die Schnellauswahl (`applyStyle`) leert die Überschreibungen. Meine Wahl: ungültige Überschreibungen (unbekannte Gruppe/Feld, keine endliche Zahl) werden still ignoriert, es gibt keinen neuen Fehlercode. Meine Wahl: keine Markierung "von Hand gesetzt" an den Reglern, nur ein Zurücksetzen-Knopf je Gruppe.
- Nicht Teil dieses Plans: Varianten (Seed-Drift, mehr Muster), Live-Umschalten von Tonart/Akkordfolge, Speichern der Regler im Browser.

## Global Constraints

- Reines JavaScript, keine Laufzeit-Abhängigkeiten, lokal und offline. Tests vor Code.
- Alle sichtbaren Texte über `t` in `src/i18n/de.js` und `en.js` (Deutsch mit echten Umlauten, beide Dateien gleiche Schlüssel); `tests/core/i18n.test.js` bleibt grün; kein roher Schlüsselname sichtbar (die `RAW_KEY`-Muster in den e2e-Specs um `group|timbre` erweitern, wo sie definiert sind).
- Kein `Math.random`. Kein Browser-Objekt beim Import in `src/core`, `src/i18n`, `src/audio`, `src/index.js` (Import in reinem Node muss funktionieren).
- Bezeichner Englisch, Kommentare Deutsch, LF-Zeilenenden. Commit-Nachrichten `feat:`/`test:`/`docs:` mit der Co-Authored-By-Zeile, die die Sitzung vorgibt.
- Der Ereignisstrom bleibt für gleiche Eingaben unverändert: `tests/core/golden.test.js` bleibt unverändert grün.
- Ohne Überschreibungen und mit denselben Schlagworten klingt alles exakt wie vorher: `tests/e2e/levels.spec.js`, `sound.spec.js`, `mix.spec.js` bleiben grün.
- Bestehende Tests sind Regressionsschutz: anpassen, nie abschwächen oder löschen. Die zwei Tests in `tuning.spec.js`, die den Neustart bei Schlagwort-Klicks festschreiben (ab Zeile 525), ändern ihre Erwartung bewusst (Task 5 und 6); das im Bericht nennen.
- Tests laufen so: `npm test` (Node), einzelne e2e-Datei `npx playwright test tests/e2e/<datei> --no-deps`, am Ende `npx playwright test`.
- Hörprobe entscheidet der Auftraggeber.

## Review Focus

1. Regler schnell durchziehen (viele `input`-Ereignisse je Sekunde, besonders Fuzz 0 nach 1) während der Wiedergabe: kein Fehler, kein Knacken (feste Knoten nur über Rampen), Fuzz-Kennlinie bleibt endlich (Task 2, 4).
2. Austausch des Ereignisstroms genau an der Durchlaufgrenze (alle Ereignisse geplant, Durchlauf noch nicht zu Ende) und direkt nach dem Umbruch: kein Takt doppelt, keiner übersprungen (Task 6).
3. `setTimbre`/`setTrack` nach `stop()` und `stop()` unmittelbar nach dem Aufruf: kein Fehler, keine übrig gebliebenen Timer (Task 2, 6).
4. Alle Felder auf 0 und alle auf 1, auch beim Hin- und Herschalten während der Wiedergabe: nur endliche Werte, Spitze nach dem Begrenzer unter 0,9 (Task 2).
5. Schmale Schublade mit allen Gruppen offen (26 Regler): Scrollen, Fokus und Escape funktionieren, `inert` bleibt richtig, das Layout springt beim Takt-Render nicht (Task 3, 4: `layout-stability.spec.js`).

---

### Task 1: Überschreibungen im Klangmodell

**Files:**
- Modify: `src/core/timbre.js`, `src/audio/play.js:42`, `src/audio/render.js:18`
- Test: `tests/core/timbre.test.js`, `tests/e2e/sound.spec.js`

**Interfaces:**
- Produces: `resolveTrackTimbre(track: { tags?, timbre?: Partial<Record<group, Partial<Record<field, number>>>> }): Timbre` in `src/core/timbre.js`. `resolveTimbre(track.tags)` als Basis, darüber je Feld in `track.timbre` jede endliche Zahl, auf [0,1] begrenzt. Unbekannte Gruppen/Felder, Nicht-Zahlen, Arrays und fehlendes `timbre` werden ignoriert und werfen nie; ungültige Schlagworte werfen wie `resolveTimbre`. Ergebnis ist eine neue Kopie.
- Consumes: `resolveTimbre`, `DEFAULT_TIMBRE`.

- [ ] **Step 1: Tests schreiben.** In `timbre.test.js`: `resolveTrackTimbre` ohne `timbre` gleich `resolveTimbre(tags)`; `{ bass: { fuzz: 0.9 } }` setzt nur `bass.fuzz` (alle anderen Felder gleich dem Schlagwort-Ergebnis) und schlägt das Schlagwort `fuzz` (0,6); `1.5` ergibt `1`, `-1` ergibt `0`; `NaN`, `'x'`, `null`, `{ nope: { x: 1 } }`, `{ bass: { nope: 1 } }`, `timbre: []` ändern nichts und werfen nicht; Aufruf mit `null`/`undefined` als Track wirft nicht und liefert `DEFAULT_TIMBRE`-Werte; ungültiges Schlagwort wirft wie `resolveTimbre`; Ergebnis teilt keine Objekte mit `DEFAULT_TIMBRE`. In `sound.spec.js` (Harness `__compare`): Track mit Schlagwort `bassSound: ['fuzz']` und Track ohne Schlagwort mit `timbre: { bass: { fuzz: 0.6 } }` ergeben `diff < 1e-6` auf der Schicht `bass`; `timbre: { bass: { fuzz: 1 } }` gegen ohne ergibt `diff > 0.25`.
- [ ] **Step 2:** `npm test` und `npx playwright test tests/e2e/sound.spec.js --no-deps` laufen lassen. Erwartet: FAIL (`resolveTrackTimbre` fehlt, Überschreibung wirkungslos).
- [ ] **Step 3: `resolveTrackTimbre` in `src/core/timbre.js`** (eigene Schleife über `resolveTimbre`-Ergebnis, `clamp01` und die vorhandene Record-Prüfung wiederverwenden). `play.js` und `render.js` rufen `resolveTrackTimbre(track)` bzw. `resolveTrackTimbre(trackInput)` statt `resolveTimbre(...tags)`. `normalizeTrack` bleibt unverändert (`timbre` bleibt über `...t` erhalten).
- [ ] **Step 4:** Beide Läufe aus Step 2 und danach `npx playwright test tests/e2e/levels.spec.js --no-deps`. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: per-field timbre overrides on the track`.

### Task 2: Stimmen live umstellbar (`setTimbre`)

**Files:**
- Modify: `src/audio/synth.js` (`createInstruments`, `drumVoices`-Aufruf), `src/audio/play.js`, Kommentar in `src/audio/voice-params.js:108-113`
- Test: `tests/e2e/sound.spec.js`, `tests/core/play-live.test.js` (neu)

**Interfaces:**
- Produces: `createInstruments(...)` liefert zusätzlich `setTimbre(timbre): void` (Eingabe wird wie die Option `timbre` mit `completeTimbre` aufgefüllt). Es rechnet `drumParams/bassParams/chordParams/padParams` neu und schreibt sie in die bestehenden Parameterobjekte (`Object.assign`, dieselben Objekte), baut die Fuzz-Kennlinie neu und stellt über das vorhandene `ramp` nach: `master.gain` (`MASTER * level`), `reverbWet`, `echoWet`, Echo-Rückkopplung, Hochregal-`gain`, Raum-Sendeweg. Schon laufende Töne bleiben unverändert.
- Produces: Player-Handle `setTimbre(timbre): void` in `play.js`; ruft `instruments.setTimbre?.(timbre)`; nach `stop()` ohne Wirkung.
- Consumes: `completeTimbre`, `resolveTrackTimbre` (Task 1).

- [ ] **Step 1: Tests schreiben.** `sound.spec.js` (Offline, in `page.evaluate` mit `OfflineAudioContext` und `import('/audio/synth.js')`, Ereignisse aus `buildEvents`, alle Töne mit 1 s Vorlauf, verglichen wird ab 1 s, weil `ramp` erst nach 0,2 s exakt ist): (a) Instrumente mit `DEFAULT_TIMBRE` erzeugt, `setTimbre(resolveTimbre(T))` vor dem ersten Ton, ergibt höchstens `1e-6` Abweichung (größter Betrag der Differenz) zu Instrumenten, die direkt mit `timbre: resolveTimbre(T)` erzeugt wurden; `T` enthält Schlagworte für Fuzz, Sub, Raum, Echo/Hall (`psychedelic`), Helligkeit (`bright`), Chorus, Tremolo, Schimmer. (b) Gegenrichtung: mit `resolveTimbre(T)` erzeugt, `setTimbre(DEFAULT_TIMBRE)` entspricht dem neutralen Klang (deckt Hochregal und Raum zurück auf 0). (c) Alle Felder 0 und alle 1, hin und her: Ergebnis endlich (kein NaN), Spitze unter 0,9 mit Begrenzer. `tests/core/play-live.test.js` (Node, Attrappen-Kontext mit `currentTime` (selbst gesetzt), `destination`, `createGain` und Spion-Instrumente über die Option `createInstruments`; Hilfsfunktion `advance(ctx, seconds)` setzt `currentTime` und wartet zwei Planer-Takte): `h.setTimbre(x)` ruft `setTimbre(x)` der Instrumente genau einmal; nach `h.stop()` ruft es nichts mehr auf und wirft nicht.
- [ ] **Step 2:** Beide Dateien laufen lassen. Erwartet: FAIL (`setTimbre` fehlt).
- [ ] **Step 3: `setTimbre` implementieren.** In `createInstruments` die Parameter als veränderbare Objekte halten (`drum`, `bass`, `chord`, `pad`, `mix`), `curve` als `let`. Den Hochregal-Knoten immer anlegen (auch bei 0 dB) und den Raum-Sendeweg der Drums immer (Verstärkung 0 statt kein Knoten), sonst ließen sie sich nicht live aufdrehen; der Kommentar in `voice-params.js` ("exakt 0 = ohne Filterknoten") wird angepasst. `play.js`: `setTimbre` im Handle, `stopped` prüfen.
- [ ] **Step 4:** Beide Läufe plus `levels.spec.js`, `sound.spec.js`, `mix.spec.js` (der immer vorhandene Filter darf den neutralen Klang nicht hörbar ändern; weicht ein bestehender Messwert ab, den Grund im Bericht nennen, nicht die Grenze lockern).
- [ ] **Step 5: Commit** `feat: live timbre changes via setTimbre`.

### Task 3: Gegliederte Seitenleisten

**Files:**
- Create: `src/ui/groups.js`, `tests/e2e/groups.spec.js`
- Modify: `src/ui/index.html:131-167`, `src/ui/layout-state.js`, `src/ui/app.css`, `src/ui/app.js`, `src/i18n/de.js`, `src/i18n/en.js`, `tests/core/layout-state.test.js`

**Interfaces:**
- Produces: `DEFAULT_LAYOUT.groups` (eingefroren, Schlüssel und Standard: `style: true, tempo: true, drums: false, bass: false, chords: false, pad: false, master: false, key: true, progression: true, views: true`); `loadLayout/saveLayout` geben `groups` über `pickBooleans` weiter (Unbekanntes fällt weg, Nicht-Boolesches auf Standard).
- Produces: `initGroups(root: Element, { get(id): boolean, set(id, open): void }): void` in `src/ui/groups.js`. Setzt `open` jedes `details[data-group]` unterhalb von `root` aus `get(id)`; bei `toggle` ruft es `set(id, el.open)` nur, wenn sich der Wert gegenüber `get(id)` unterscheidet. Task 4 ruft es für die Klang-Gruppen noch einmal auf; mehrfaches Aufrufen für verschiedene Wurzeln ist erlaubt.
- Markup: `<details class="group" data-group="<id>"><summary>…</summary>…</details>`. Gruppen: `style` (Schnellauswahl und Schlagworte), `tempo` (die `.settings` mit Tempo und Länge), links danach die Klang-Gruppen aus Task 4; rechts `key` (Tonart und Skala), `progression` (Folge, Meldung `#tuning-message`, Akkord hinzufügen), `views`. In `progression` und `views` steht das vorhandene `<h4 class="label" id="…-title">` in der `summary`, damit Ids, `aria-labelledby` und Texte unverändert bleiben; die anderen Zusammenfassungen sind neue Schlüssel `group.style` ("Stil"/"Style"), `group.tempo` ("Tempo & Länge"/"Tempo & length"), `group.key` ("Tonart & Skala"/"Key & scale"). Vorhandene Ids (`quick-pick`, `tags`, `length`, `tuning-tempo`, `side-key-chips`, `progression`, `add-chords`, `views`) bleiben.

- [ ] **Step 1: Tests schreiben.** `layout-state.test.js`: Standardgruppen wie oben; unbekannter Schlüssel fällt weg; `groups: { style: 'x' }` fällt auf `true` zurück; Rundlauf `save`/`load` merkt `style: false`; kaputtes JSON liefert den Standard. `groups.spec.js` (Spielseite wie in `tuning.spec.js` öffnen): Standard offen/zu stimmt (`style`, `tempo`, `key`, `progression`, `views` offen); Klick auf die Zusammenfassung von `style` schließt, nach `page.reload()` bleibt sie zu; Enter auf fokussierter Zusammenfassung klappt um; bei 800 px Breite: linke Schublade öffnen, Gruppe schließen, Escape schließt die Schublade und der Fokus kehrt zum Knopf zurück; kein roher Schlüsselname sichtbar.
- [ ] **Step 2:** Tests laufen lassen. Erwartet: FAIL.
- [ ] **Step 3: Umsetzen.** `groups.js` und `layout-state.js` wie oben. `index.html` umbauen. `app.js`: nach den `init*`-Aufrufen `initGroups(document, …)` mit `get: (id) => state.layout.groups[id]` und `set`, das `state.layout` ersetzt und mit `saveLayout(layoutStorage, …)` speichert. `app.css`: `.group` mit Haarlinie oben, `summary` mit Mindesthöhe `var(--target)`, Zeiger, sichtbarer Fokus, ein Pfeil, der sich dreht (ohne Animation, damit `prefers-reduced-motion` nichts tun muss); Überschrift in `summary` ohne eigenen Außenabstand. Reihenfolge links: Stil, Tempo & Länge; rechts wie bisher.
- [ ] **Step 4:** `npm test`, dann `npx playwright test tests/e2e/groups.spec.js tests/e2e/tuning.spec.js tests/e2e/ui.spec.js tests/e2e/layout-stability.spec.js tests/e2e/views.spec.js --no-deps`. Erwartet: PASS. Bestehende Ids/Rollen bleiben gültig; trifft ein Selektor die geänderte Struktur, den Selektor anpassen, nie die Prüfung abschwächen.
- [ ] **Step 5: Commit** `feat: collapsible groups in both sidebars`.

### Task 4: Klangregler

**Files:**
- Create: `src/ui/timbre-panel.js`, `tests/e2e/timbre.spec.js`
- Modify: `src/ui/state.js` (`state.track.timbre = {}`, `applyStyle` leert es), `src/ui/index.html` (leerer Container `<div id="timbre-groups"></div>` links nach `tempo`), `src/ui/app.js`, `src/ui/app.css`, `src/i18n/de.js`, `src/i18n/en.js`

**Interfaces:**
- Produces: `initTimbrePanel({ render, player }): () => void` in `src/ui/timbre-panel.js` (Muster wie `initMixer`; `player` ist `() => player`). Baut in `#timbre-groups` je Gruppe aus `Object.keys(DEFAULT_TIMBRE)` ein `<details class="group" data-group="<gruppe>">` mit `summary` `group.<gruppe>`, je Feld eine Zeile (Label `timbre.<gruppe>.<feld>`, `<input type="range" id="timbre-<gruppe>-<feld>" min="0" max="100" step="1">`, `<output>` mit `ui.percent`, `aria-valuetext` wie im Mischpult) und einen Knopf `ui.timbreReset` ("Zurücksetzen"/"Reset"), der nur aktiv ist, wenn die Gruppe Überschreibungen hat. Danach `initGroups` für diese Gruppen aufrufen. Die zurückgegebene Funktion (in `render()` einhängen) setzt jeden Regler auf `resolveTrackTimbre(state.track)[gruppe][feld]`, nur bei Änderung des Werts (ein gezogener Regler wird nicht neu gesetzt).
- Verhalten: `input` setzt `state.track.timbre[gruppe][feld] = Wert/100` (neues Objekt, nichts mutieren), ruft `player()?.setTimbre(resolveTrackTimbre(state.track))` und `render()`. Zurücksetzen entfernt die Gruppe aus `state.track.timbre` und ruft dasselbe. `start()` in `app.js` übergibt `state.track` samt `timbre` an `play`, die Regler gelten also ab der ersten Note.
- Texte (de / en), Schlüssel `timbre.<gruppe>.<feld>`: drums: kickPunch Kick-Punch / Kick punch, kickLength Kick-Länge / Kick length, snareTone Snare-Ton / Snare tone, snareSnap Snare-Knack / Snare snap, hatBright Hi-Hat-Glanz / Hi-hat brightness, hatLength Hi-Hat-Länge / Hi-hat length, room Raum / Room. bass: sub Sub / Sub, fuzz Fuzz / Fuzz, pluck Zupfen / Pluck, cutoff Grenzfrequenz / Cutoff, resonance Resonanz / Resonance, roundness Rundung / Roundness. chords: brightness Helligkeit / Brightness, length Länge / Length, chorus Chorus / Chorus, tremolo Tremolo / Tremolo. pad: attack Einsatz / Attack, cutoff Grenzfrequenz / Cutoff, lfoSpeed LFO-Tempo / LFO speed, lfoDepth LFO-Tiefe / LFO depth, shimmer Schimmer / Shimmer, thickness Dichte / Thickness. master: brightness Helligkeit / Brightness, echo Echo / Echo, reverb Hall / Reverb. Gruppen `group.drums` Schlagzeug-Klang / Drum sound, `group.bass` Bass-Klang / Bass sound, `group.chords` Akkord-Klang / Chord sound, `group.pad` Pad-Klang / Pad sound, `group.master` Gesamtklang / Master sound.

- [ ] **Step 1: Tests schreiben** (`timbre.spec.js`, Spielseite, Zähler für `AudioContext` und Aufzeichnung von `AudioParam.prototype.setTargetAtTime` wie in `mixer.spec.js`): 26 Regler in 5 Gruppen (Anzahl aus `DEFAULT_TIMBRE` abgeleitet), alle mit Label ohne rohen Schlüssel; Startwert von `#timbre-bass-fuzz` mit der Funk-Vorlage ist `round(resolveTimbre(funk.tags).bass.fuzz * 100)`; während der Wiedergabe `#timbre-master-reverb` auf 100 setzen: ein `setTargetAtTime`-Ziel gleich `masterParams({ …, reverb: 1 }).reverbWet` (0,6) erscheint, `window.__audioContexts` bleibt 1, die Taktzeile läuft ohne Rücksprung weiter; Überschreibung gewinnt: Fuzz-Regler auf 80, dann das Schlagwort `gritty` umschalten, Regler bleibt 80, "Zurücksetzen" der Gruppe `bass` bringt den Schlagwort-Wert zurück; Schnellauswahl leert Überschreibungen; Regler vor dem Start bewegen, dann Start: kein Fehler; 20 schnelle `input`-Ereignisse in Folge (Fuzz 0 bis 100) während der Wiedergabe: keine Konsolenfehler.
- [ ] **Step 2:** `npx playwright test tests/e2e/timbre.spec.js --no-deps`. Erwartet: FAIL.
- [ ] **Step 3: Umsetzen** wie oben. CSS: Zeile als Raster `minmax(0, 7rem) 1fr 5.5ch` analog `.mix-row`, Regler mit `accent-color: var(--ink)` und Höhe `var(--target)`; die Beschriftungen dürfen umbrechen, damit die schmale Leiste nicht überläuft.
- [ ] **Step 4:** `timbre.spec.js`, `groups.spec.js`, `layout-stability.spec.js`, `mixer.spec.js` laufen lassen, `npm test`. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: sound sliders for every instrument`.

### Task 5: Reine Klang-Schlagworte live

**Files:**
- Modify: `src/ui/tuning.js:15,35-40`, `src/ui/app.js` (`initTuning`-Aufruf), `tests/e2e/tuning.spec.js:525-554`

**Interfaces:**
- Consumes: `isSoundOnlyChange` (vorhanden), `resolveTrackTimbre`, Player-`setTimbre`.
- Produces: `initTuning({ render, restartIfPlaying, toggleLayer, player })`, `player` ist `() => player`. Bei einem Schlagwort-Klick mit `isSoundOnlyChange(before, after)` ruft der Handler `player()?.setTimbre(resolveTrackTimbre(state.track))` statt `restartIfPlaying`.

- [ ] **Step 1: Test ändern.** Den Test "Klang-Schlagwort während der Wiedergabe" (Zeile 533) auf die neue Erwartung umschreiben: Hilfsfunktion `expectInPlace` wird `expectContinuous` und prüft zusätzlich, dass in `window.__positions` nie ein leerer Text steht (kein Neustart) und die Takte nur aufsteigen; `genau ein Player` und `kein neuer AudioContext` bleiben. Gleiches für die Klang-Klicks im Test ab Zeile 556 (`glassy`, `tremolo`). Die Muster-Klicks darin bleiben bis Task 6 unverändert.
- [ ] **Step 2:** `npx playwright test tests/e2e/tuning.spec.js --no-deps`. Erwartet: FAIL (leere Taktzeile durch den Neustart).
- [ ] **Step 3: Umsetzen** wie oben.
- [ ] **Step 4:** `tuning.spec.js`, `timbre.spec.js`. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: sound-only tag buttons change the sound live`.

### Task 6: Ereignisstrom live tauschen (`setTrack`) für Muster-Schlagworte und Schnellauswahl

**Files:**
- Modify: `src/audio/play.js` (`events` wird `let`), `src/ui/app.js`, `src/ui/tuning.js`, `tests/e2e/tuning.spec.js:556-586`
- Test: `tests/core/play-live.test.js`

**Interfaces:**
- Produces: Player-Handle `setTrack(trackInput): boolean` in `play.js`. Baut `buildEvents({ ...trackInput, bpm: <Starttempo von play> })` (das Starttempo, weil Zeiten in Liedzeit beim Originaltempo laufen und `setTempo` über `rate` wirkt; wirft bei ungültigem Track wie `buildEvents` und ändert dann nichts). Gibt `false` ohne Änderung zurück, wenn `length` oder die Liedzeit eines Durchlaufs (Summe der Taktdauern bei Starttempo, Toleranz `1e-9`) abweicht oder der Player gestoppt ist. Sonst ersetzt es den Strom und setzt `next` auf den ersten Index des neuen Stroms mit `e.t > tLast`, wobei `tLast = next > 0 ? alterStrom[next - 1].t : -Infinity` (gleichzeitige Ereignisse werden im selben Planerlauf geplant, also nie getrennt) und gibt `true` zurück. Schon geplante Töne laufen weiter.
- Produces: in `app.js` `applyLive({ patterns, tempo })` und als Option an `initTuning` (ersetzt dort `restartIfPlaying` für Schlagwort- und Stil-Klicks): ohne Player nichts; sonst `player.setTimbre(resolveTrackTimbre(state.track))`, bei `tempo` `player.setTempo(state.track.bpm)`, bei `patterns` `player.setTrack({ ...state.track, layers: ALL_LAYERS })`; liefert das `false` oder wirft es, `restartIfPlaying()`. Schlagwort-Klick: `patterns = !isSoundOnlyChange(before, after)`. Stil-Klick (`applyStyle`): `patterns` und `tempo` wahr. Länge, Akkordfolge, Tonart, Variante bleiben bei `restartIfPlaying`.

- [ ] **Step 1: Tests schreiben.** `play-live.test.js` (Attrappen-Kontext aus Task 2; Strom A und B unterscheiden sich in einem Muster-Schlagwort, z. B. `swing` oder `arpeggio`, gleiche Takte, 240 bpm): (a) Tausch mitten im Durchlauf: `onBar` meldet die Takte lückenlos und ohne Wiederholung; die Spion-Aufrufe ab dem Tausch (Ereignisse mit `bar` größer als der Takt beim Tausch) entsprechen als Menge (Schicht, Name bzw. MIDI, Takt) genau den Ereignissen von `buildEvents(B)` für diese Takte; (b) Tausch, wenn alle Ereignisse eines Durchlaufs geplant sind und der Durchlauf noch läuft: der nächste Durchlauf spielt B ab Index 0 ohne Doppelung; (c) Tausch direkt nach dem Umbruch (`next` ist 0); (d) `false` und keine Änderung bei anderer `length` und bei anderen `beats` eines Takts; (e) ungültiges Schlagwort wirft und der Strom bleibt A; (f) nach `h.setTempo(2 * bpm)` liefert `setTrack` weiter Ereignisse mit denselben Liedzeiten wie `buildEvents(B)` beim Starttempo; (g) nach `stop()` gibt es `false` zurück und wirft nicht. `tuning.spec.js`: der Test ab Zeile 556 erwartet jetzt auch für das Muster-Schlagwort `driving` und den Klick auf die Funk-Vorlage keinen Neustart (Taktzeile läuft weiter, nie "Takt 1" zurück, nie leer, `__audioContexts` bleibt 1); die Tempo-Änderung der Vorlage zeigt sich im laufenden Tempo-Regler.
- [ ] **Step 2:** `npm test`, `npx playwright test tests/e2e/tuning.spec.js --no-deps`. Erwartet: FAIL.
- [ ] **Step 3: Umsetzen** wie oben.
- [ ] **Step 4:** `npm test`, `tuning.spec.js`, `play.spec.js`, `play-page.spec.js`, `flow.spec.js`. Erwartet: PASS.
- [ ] **Step 5: Commit** `feat: pattern tags and style presets swap the event stream live`.

### Task 7: Schnittstelle dokumentieren und Gesamtlauf

**Files:**
- Modify: `docs/interface.md` (Track-Beispiel und Abschnitt zum Player-Handle ab Zeile 132, Handle-Signatur im Kommentar und in der Tabelle ab Zeile 163), `README.md` nur, wo es Schlagworte oder Klang beschreibt

- [ ] **Step 1:** In `interface.md` das Feld `timbre` (Aufbau, Wirkung über den Schlagworten, ungültiges wird ignoriert) und die Handle-Methoden `setTimbre(timbre)` und `setTrack(track)` (Rückgabe `true`/`false`, Starttempo, was gleich bleiben muss) beschreiben; die Handle-Signaturzeilen ergänzen.
- [ ] **Step 2:** `npm test` und `npx playwright test` komplett. Erwartet: alles PASS; Abweichungen einzeln benennen.
- [ ] **Step 3: Commit** `docs: timbre overrides and live player methods`.

---

## Selbstprüfung

- Abdeckung: Regler für alle Instrumente (Task 1, 2, 4), Gruppierung beider Leisten (Task 3, 4), Regler live (Task 2, 4), Schlagwort-Knöpfe live (Task 5, 6), Schnittstelle (Task 7). Varianten bewusst nicht enthalten.
- Namen: `resolveTrackTimbre`, `setTimbre`, `setTrack`, `initGroups`, `initTimbrePanel`, `applyLive`, `DEFAULT_LAYOUT.groups`, Schlüssel `group.*`/`timbre.*` sind in den Tasks einheitlich.
- Reihenfolge: Nach Task 2 klingen Überschreibungen schon im Player, nach Task 4 hörst du die Regler, Task 5 und 6 machen die Knöpfe live.
