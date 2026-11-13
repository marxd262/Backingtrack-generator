# Rack-Oberfläche, Schritt 1: Spielseite neu ordnen und Rack-Look (Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Spielseite wird ein Bildschirm mit Kopfleiste, fester Visualisierung (Tonart, Griffbrett, Akkorde, Form & Spuren) und einem Rack aus Modulen darunter, umschaltbar zwischen Fokus und Einstellen, im Look von Mutable Instruments.

**Architecture:** „Umziehen, nicht neu schreiben“: Die bestehenden `init*`-Module bauen ihre Bedienelemente weiter in Behälter mit festen IDs; `index.html` und `app.css` bekommen den neuen Aufbau. Zwei kleine Bausteine verwandeln vorhandene native Elemente: `knob.js` legt einen Drehknopf über ein `<input type="range">` (das Input bleibt fokussierbar und trägt Wert, Tastatur und Zugänglichkeit), `lcd-select.js` macht aus einem `<select>` ein LCD mit ‹ ›. Seitenleisten, Klappgruppen und Ansichten-Schalter entfallen.

**Tech Stack:** Plain JavaScript (ES-Module, kein Build), Web Audio, SVG/Canvas, `node:test` für Logik, Playwright (Chromium) für die Oberfläche.

**Spec:** [docs/superpowers/specs/2026-11-13-rack-ui-design.md](../specs/2026-11-13-rack-ui-design.md), Entwürfe [rack.html](../specs/2026-11-13-rack-ui/rack.html) und [start.html](../specs/2026-11-13-rack-ui/start.html). Dieser Plan setzt nur den Abschnitt „Reihenfolge, Schritt 1“ um; Pan, Pegelmessung, Makros, Klangbearbeitung und die neue Startseite sind spätere Pläne.

## Global Constraints

- Keine Laufzeit-Abhängigkeiten, kein Build-Schritt; alles läuft offline. Schriften werden als Dateien mitgeliefert (siehe Task 1), nie von einem CDN geladen.
- Jeder sichtbare Text über `t()` mit Schlüssel in `src/i18n/de.js` **und** `src/i18n/en.js`; Beschriftung über `data-i18n` / `data-i18n-label` wie bisher.
- Akzentfarben nur Türkis `#18a2a6` und Pink `#e3465e`; Platte `#e9e9e6`; LCD `#161a14` mit Schrift `#b9f26b`, Zweitfarbe `#6fe3e6`; alles als CSS-Variablen in `:root` von `src/ui/app.css`.
- Kein Text unter **11 px** (auch nicht Beschriftungen an Drehknöpfen).
- Maßstab ist die Fenster-Innengröße **1600 × 960**: Die Seite scrollt nie; Kopfleiste und Visualisierung bleiben sichtbar; das Rack bekommt den Rest der Höhe und scrollt in sich (senkrecht und waagerecht). Fenster schmaler als das Rack: nur das Rack scrollt waagerecht. Keine Schubladen mehr.
- **IDs bestehender Bedienelemente bleiben**, solange das Element weiter existiert (z. B. `#play-go`, `#play-position`, `#variant-prev`, `#tuning-tempo`, `#complexity`, `#form-template`, `#part-type`, `#mixer`, `#profiles-btn`, `#progression`, `#lanes`, `#wheel`, `#fretboard`, `#play-back`). Tests folgen dem Verhalten, nicht dem alten Aufbau.
- Gleicher Track + gleicher Seed ergibt dieselben Ereignisse: `tests/core/golden.test.js` bleibt unverändert grün.
- Zugänglichkeit nicht schlechter als heute: jeder Drehknopf ist ein natives Range-Input mit Beschriftung und `aria-valuetext`; jede Taste beschriftet; sichtbarer Fokus (`:focus-visible`) auch am Drehknopf.
- Bogen am Drehknopf: Ursprung `center` (12 Uhr; links türkis, rechts pink), `start` (linker Anschlag; pink) oder `none`. Klangfelder: `center`, wenn `DEFAULT_TIMBRE[gruppe][feld] === 0.5`, sonst `start`.
- Akkordfarben überall gleich: Pink = jetzt, Hellpink mit pinkem Rand = derselbe Akkord geht weiter, Türkis = nächster Wechsel, Weiß = später.
- Ausführung: Implementierer mit **Sonnet**, außer wo bei der Task „Modell: Opus“ steht. Spec-Reviews mit Sonnet; die abschließende Prüfung des ganzen Branches mit Opus.
- Nach jeder Task: `npm test` grün und die von der Task berührten e2e-Dateien grün (`npx playwright test <dateien> --no-deps`, für Klang-Dateien ohne `--no-deps`).

## Review Focus

1. **Laptop-Fenster 1366 × 768:** Kopfleiste, Griffbrett, Akkordkreis und alle Spuren bleiben sichtbar und überlappen nicht; das Rack scrollt in sich, die Seite nicht. Test in Task 2.
2. **Drehen, während die Wiedergabe läuft:** `render()` läuft je Takt; ein gerade gezogener Knopf oder Fader darf nicht zurückspringen. Test in Task 1 (Knopf) und Task 4 (Fader).
3. **Nur Tastatur:** Tab erreicht jeden Knopf, Fader und jedes LCD in Lesereihenfolge (Kopfleiste, Visualisierung, Rack links nach rechts), der Fokus ist am Knopf sichtbar. Test in Task 1 und Task 3.
4. **„Alle Samples“, während ein Sample-Pack nicht lädt:** Der Schalter zeigt danach „gemischt“ oder bleibt bei „Samples“, die Fehleranzeige steht im Display des Instruments, nichts hängt. Test in Task 4.
5. **Fokus ⇄ Einstellen während der Wiedergabe:** kein Neustart (gleiche Zahl AudioContexts und Instrumentensätze), Griffbrett, Akkordkreis und Spuren zeichnen in der neuen Größe. Test in Task 2.

---

### Task 1: Rack-Look, Drehknopf und LCD-Auswahl

**Modell:** Sonnet

**Files:**
- Create: `src/assets/fonts/` mit `barlow-400.woff2`, `barlow-500.woff2`, `barlow-600.woff2`, `share-tech-mono-400.woff2`, `OFL.txt` (beide Schriften stehen unter der SIL Open Font License; Quelle z. B. die npm-Pakete `@fontsource/barlow` und `@fontsource/share-tech-mono`, nur die Dateien kopieren, kein Paket ins Projekt aufnehmen)
- Create: `src/ui/knob-geometry.js`, `src/ui/knob.js`, `src/ui/lcd-select.js`
- Modify: `src/ui/app.css` (neue Variablen und Bausteine; die Notenheft-Optik wird ersetzt)
- Modify: `src/ui/rhythm.js` (Komplexität als erster echter Drehknopf, Beweis im laufenden System)
- Test: `tests/core/knob-geometry.test.js`, `tests/e2e/knob.spec.js`

**Interfaces:**
- Produces:
  - `knobAngle(value: number, min: number, max: number): number` → Grad in [-135, 135]
  - `knobArc(value: number, min: number, max: number, origin: 'center'|'start'|'none'): { from: number, to: number, side: 'left'|'right' } | null` (null bei `none` oder wenn Zeiger und Ursprung weniger als 1° auseinander liegen; `from < to`; `side` = Seite des Zeigers vom Ursprung aus, bei `start` immer `'right'`)
  - `createKnob(input: HTMLInputElement, { origin = 'start', size = 'm', kind = 'black', resetValue }): { sync(): void }`; `size`: `'s'|'m'|'l'`, `kind`: `'black'|'white'|'teal'|'pink'`; `resetValue` Standard: Mitte bei `center`, `min` sonst; hat das Input `data-reset="<button-id>"`, klickt Doppelklick diesen Knopf statt den Wert zu setzen
  - `syncKnobs(): void` (alle erzeugten Knöpfe; nur geänderte zeichnen neu)
  - `createLcdSelect(select: HTMLSelectElement, { prevKey: string, nextKey: string }): void` und `syncLcdSelects(): void`
  - CSS-Klassen: `.module` (Platte, Schrauben, `.module-title` oben rechts), `.lcd`, `.led`, `.led.on`, `.chip[aria-pressed]` als LED-Taste, `.push` (runder Taster), `.dots` (gepunktete Trennlinie), `.knob`, `.lcd-select`

- [ ] **Step 1: Failing unit tests** in `tests/core/knob-geometry.test.js`

```js
assert.equal(knobAngle(0, 0, 100), -135);
assert.equal(knobAngle(50, 0, 100), 0);
assert.equal(knobAngle(100, 0, 100), 135);
assert.deepEqual(knobArc(25, 0, 100, 'center'), { from: -67.5, to: 0, side: 'left' });
assert.deepEqual(knobArc(80, 0, 100, 'center'), { from: 0, to: 81, side: 'right' });
assert.equal(knobArc(50, 0, 100, 'center'), null);
assert.deepEqual(knobArc(30, 0, 100, 'start'), { from: -135, to: -54, side: 'right' });
assert.equal(knobArc(0, 0, 100, 'start'), null);
assert.equal(knobArc(70, 0, 100, 'none'), null);
assert.equal(knobAngle(120, 40, 200), knobAngle(120, 40, 200)); // Wertebereich ≠ 0..100 funktioniert
```

- [ ] **Step 2:** `node --test tests/core/knob-geometry.test.js` → FAIL (Modul fehlt).
- [ ] **Step 3:** `src/ui/knob-geometry.js` umsetzen (rein, keine DOM-Importe, wie `wheel-geometry.js`).
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: `knob.js`.** Ein `<span class="knob knob--{size} knob--{kind}">` umschließt das Input; darin ein SVG (Kappe, Zeiger, Bogen nach `knobArc`, Farbe nach `side`: `left` → `var(--teal)`, `right` → `var(--pink)`). Das Input liegt deckungsgleich darüber, `opacity: 0`, bleibt fokussierbar; `.knob:has(input:focus-visible)` zeigt den Fokusring. Ziehen mit Zeiger senkrecht (nach oben = mehr; volle Spanne auf 200 px; Pointer-Capture), Mausrad je Raste ein `step` (bei `step="any"` 1 % der Spanne), Doppelklick siehe `resetValue`. Jede Änderung setzt `input.value` und löst `input` aus (beim Loslassen zusätzlich `change`). Während des Ziehens ignoriert `sync()` den Knopf (Review Focus 2). Beschriftung bleibt das vorhandene `<label for>`.
- [ ] **Step 6: `lcd-select.js`.** Umschließt das Select mit `.lcd-select`, davor und dahinter je eine Taste ‹ › (`type="button"`, `data-i18n-label` = `prevKey`/`nextKey`); sie wählen den vorigen/nächsten nicht deaktivierten Eintrag und lösen `change` aus; am Listenende deaktiviert (kein Umlauf). Das Select selbst ist als LCD gestaltet (`appearance: none`), bleibt ein echtes Select.
- [ ] **Step 7: Look.** In `app.css` die Variablen aus Global Constraints, `@font-face` für die vier Dateien (Fallback `system-ui` / `ui-monospace`), Rack-Hintergrund, `.module`, `.lcd`, `.led`, LED-Tasten, Taster, `.dots`, Knopf- und LCD-Stile nach `rack.html`. Start- und Spielseite bleiben benutzbar (Feinschliff der Startseite ist Schritt 4).
- [ ] **Step 8: Beweis im System.** In `rhythm.js` `#complexity` mit `createKnob(…, { origin: 'center', kind: 'teal' })` umhüllen; `render()` in `app.js` ruft am Ende `syncKnobs()` und `syncLcdSelects()`. i18n-Schlüssel `ui.lcdPrev`/`ui.lcdNext` („Vorheriger Eintrag“/„Nächster Eintrag“, „Previous entry“/„Next entry“).
- [ ] **Step 9: e2e** `tests/e2e/knob.spec.js` (Spielseite über `#tune-btn` öffnen):
  - `#complexity` hat `role` slider (natives Range), Tab erreicht es, `.knob` zeigt Fokusring (`outline-style` ≠ `none` am Wrapper).
  - Pfeil hoch ändert den Wert um 1 und `aria-valuetext` folgt.
  - Ziehen am Knopf 100 px nach oben erhöht den Wert um 50; Doppelklick setzt auf 50.
  - Während `#play-go` läuft: Ziehen auf 80 halten, zwei Takte warten, Wert bleibt 80.
  - Der Bogen-Pfad ist bei 50 nicht vorhanden, bei 80 pink (`stroke` = `var(--pink)` berechnet `rgb(227, 70, 94)`).
- [ ] **Step 10:** `npm test` und `npx playwright test tests/e2e/knob.spec.js tests/e2e/rhythm.spec.js --no-deps` → PASS (rhythm.spec bei Bedarf auf das umhüllte Input anpassen, das Verhalten bleibt).
- [ ] **Step 11: Commit** `feat: rack look, knob and lcd select building blocks`

---

### Task 2: Seitengerüst, Fokus/Einstellen, Leisten entfernen

**Modell:** Opus (größter Umbau, viele Testumstellungen)

**Files:**
- Modify: `src/ui/index.html` (Spielseite neu), `src/ui/app.css`, `src/ui/app.js`, `src/ui/layout-state.js`, `src/ui/tuning.js` (Akkordrad-Sichtbarkeit), `src/i18n/de.js`, `src/i18n/en.js`
- Delete: `src/ui/sidebar.js`, `src/ui/groups.js`, `src/ui/blocks.js`, `src/ui/views.js`, `tests/core/blocks.test.js`, `tests/e2e/groups.spec.js`, `tests/e2e/views.spec.js`, `tests/e2e/sidebar-scroll.spec.js`
- Modify: `tests/core/layout-state.test.js`, `tests/e2e/play-page.spec.js`, `tests/e2e/layout-stability.spec.js`, `tests/e2e/style-helpers.js` (keine Schubladen mehr), alle e2e-Dateien, die `#toggle-left|right`, `#side-*`, `details[data-group]` oder `#views` benutzen (Liste: `grep -ln "toggle-\|side-left\|side-right\|data-group\|#views" tests/e2e`)
- Test: `tests/e2e/layout.spec.js` (neu)

**Interfaces:**
- Consumes: `.module`, `syncKnobs`, `syncLcdSelects` (Task 1)
- Produces:
  - `DEFAULT_LAYOUT = { mode: 'focus', labels: 'names', frets: 'real' }`; `loadLayout`/`saveLayout` behalten Signatur und Schlüssel `backingtrack.layout`, verwerfen alte Felder (`sidebars`, `views`, `groups`)
  - Seitengerüst (IDs für spätere Tasks): `header.play-head` mit `#play-go`, `#play-position`, `#play-part` (neu, LCD Teil), `#play-now`, `#variant-prev`, `#play-variant`, `#variant-next`, `#variant-random`, `#play-back` (jetzt der App-Name, führt zur Startseite), `#mode-switch`, `#profiles-btn`, Sprachtasten, `#play-message`; `#viz` mit `#mod-key`, `#mod-fretboard` (enthält `#fretboard`), `#mod-wheel` (enthält `#wheel`), `#mod-song` (enthält `#form-song` links, Streifen/Spuren Mitte, `#form-insp` rechts); `#rack` mit `#mod-harmony`, `#mod-rhythm`, `#mod-character`, `#rack-instruments`, `#mod-mixer`
  - `state.layout.mode` (`'focus'|'setup'`); `body`/`#play` trägt `data-mode`

- [ ] **Step 1: Failing tests.** `tests/core/layout-state.test.js` auf das neue `DEFAULT_LAYOUT` umstellen (alte Felder werden verworfen, ungültiges `mode`/`frets` fällt auf Standard). Neue `tests/e2e/layout.spec.js`:
  - Bei 1600 × 960 im Zustand Einstellen: `document.documentElement.scrollHeight <= innerHeight` und keine waagerechte Seitenscrollleiste; `#viz` und `#rack` überlappen nicht; `#rack` hat `overflow` auto.
  - Bei 1366 × 768 (Review Focus 1): `#fretboard`, `#wheel`, `#lanes` vollständig im Viewport, Seite scrollt nicht, `#rack` scrollbar (`scrollHeight > clientHeight` oder `scrollWidth > clientWidth`).
  - `#mode-switch` ist `role="switch"`; Klick schaltet `aria-checked`, `#rack` wird unsichtbar/sichtbar, `#form-song` und `#form-insp` nur im Zustand Einstellen sichtbar; der Zustand steht nach Neuladen wieder da (`backingtrack.layout`).
  - Los öffnet die Spielseite im Fokus, `#tune-btn` im Zustand Einstellen.
  - Während der Wiedergabe umschalten (Review Focus 5): `__audioContexts` und `__instrumentSets` (Helfer `countingScript` aus `count-helpers.js`) unverändert; `#wheel` und `#lanes` haben danach eine andere `clientHeight` und eine Canvas-Größe passend dazu (`canvas.width === Math.round(clientWidth * devicePixelRatio)`).
  - `#play-back` (App-Name) führt zur Startseite, Wiedergabe läuft weiter.
- [ ] **Step 2:** Tests laufen → FAIL.
- [ ] **Step 3: `index.html`.** Spielseite nach dem Gerüst oben. Bestehende Behälter ziehen in die Module (vorerst unverändert in ihrer Bedienung): Tonart/Skala-Chips (`#side-key-chips`, `#side-scale-chips`), Progression, Akkordfarbe und Akkord-hinzufügen nach `#mod-harmony`; Tempo, Taktart, Groove, Komplexität nach `#mod-rhythm`; `#tags` nach `#mod-character`; `#timbre-groups` nach `#rack-instruments`; `#mixer` nach `#mod-mixer` (kein Popover und kein `#mixer-btn` mehr); Form-Gruppe der Leiste nach `#form-song`. Abschnitt „Ansichten“, Leisten, Schubladen-Hintergrund und Klapp-`<details>` (außer dem Profil-Fenster) entfallen. Die Spielseite hat genau eine `h2` (versteckt, wie heute `#play-title`), Module sind `section` mit `aria-labelledby` auf ihren Titel.
- [ ] **Step 4: `app.js`.** `initSidebar`, `initGroups`, `initViews` und ihre Aufrufe entfernen; `showPage` ohne `sidebars`; Los setzt `mode: 'focus'`, `#tune-btn` setzt `mode: 'setup'` (gemerkt); `#mode-switch` schaltet und merkt; `render()` setzt `data-mode` und `aria-checked`. `#play-back` behält sein Verhalten (Startseite, Fokus auf den Auslöser). Die Initialisierung, die Klang-Gruppen als `<details>` erwartet, wird in Task 3 ersetzt: bis dahin dürfen `timbre-panel.js`/`voices-panel.js`/`jobs-panel.js` ihre `<details>` weiter bauen, aber `initGroups` öffnet sie nicht mehr – setze in Task 2 `open` fest auf `true`.
- [ ] **Step 5: `tuning.js`.** `wheelShown()` prüft nicht mehr `section[data-view]`, sondern ob `#wheel` sichtbar ist (`checkVisibility()`); ResizeObserver auf `#fretboard`, `#wheel`, `#lanes` zeichnet neu.
- [ ] **Step 6: CSS-Gerüst.** `#play` als Spalte über die Fensterhöhe (`height: 100dvh`): Kopfleiste fest, `#viz` mit zwei Reihen (oben Tonart · Griffbrett · Akkorde, unten Form & Spuren), `#rack` `flex: 1; min-height: 0; overflow: auto`, Module in einer Reihe (`display: flex; gap: 3px`), Rack-Schienen oben und unten. Im Fokus `#rack`, `#form-song`, `#form-insp` `display: none` und die Visualisierung füllt die Höhe. Mindesthöhen: Griffbrett 240 px, Spurenbereich 6 × 14 px plus Streifen.
- [ ] **Step 7: Tests umstellen.** Gelöschte Spezifikationen sind ersetzt durch `layout.spec.js`. In den übrigen e2e-Dateien Schubladen-/Gruppen-Schritte entfernen (Elemente sind im Zustand Einstellen direkt sichtbar; Helfer `openSetup(page)` in `tests/e2e/style-helpers.js` ergänzen: `#tune-btn` klicken und auf `#rack` sichtbar warten). Assertions zu Leisten (`expectSides`, `savedLayout().sidebars`) entfallen, die zum Verhalten (Wiedergabe läuft beim Seitenwechsel, Fokus nach Seitenwechsel, Variante, Tonart) bleiben.
- [ ] **Step 8:** `npm test` und `npx playwright test` (komplett) → PASS.
- [ ] **Step 9: Commit** `feat: play page skeleton with focus and setup modes, drop sidebars`

---

### Task 3: Instrument-Module

**Modell:** Sonnet

**Files:**
- Modify: `src/ui/timbre-panel.js`, `src/ui/voices-panel.js`, `src/ui/jobs-panel.js`, `src/ui/lanes.js`, `src/ui/tuning.js`, `src/ui/app.css`, `src/i18n/de.js`, `src/i18n/en.js`
- Test: `tests/e2e/timbre.spec.js`, `tests/e2e/voices-ui.spec.js`, `tests/e2e/jobs-ui.spec.js`, `tests/core/lanes-activity.test.js` (neu)

**Interfaces:**
- Consumes: `createKnob`, `createLcdSelect` (Task 1); `#rack-instruments`, `#mod-mixer` (Task 2)
- Produces:
  - je Schicht aus `LAYER_IDS` ein `section.module.instrument[data-layer]` in `#rack-instruments` mit `.module-title` und `.led[data-activity]`; Stimmen-Select `#voice-${layer}` (Werte `"${id}/${variant}"`, `optgroup` je Art, Text = Variantenname), Art-Kennung `#voice-kind-${layer}` (`SMP`/`SYN`), Status `#voice-status-${layer}`, Hinweis `#voice-hint-${layer}`, Aufgabe `#job-${layer}` (wo vorhanden), Detail-Knöpfe `#timbre-${layer}-${field}`, Zurücksetzen `.timbre-reset`
  - Gesamt-Klangfelder (`master.*`) als Knöpfe in `#mixer-master` (Behälter legt Task 4 an; bis dahin hängt Task 3 ihn als leeres `div#mixer-master` in `#mod-mixer` ein)
  - `activeLayers(events, bar: number): Set<string>` in `src/ui/lanes.js` (Schichten mit mindestens einem Ereignis in diesem Takt; nutzt die vorhandene Zusammenfassung)

- [ ] **Step 1: Failing unit test** `tests/core/lanes-activity.test.js`: Ereignisliste mit `drums` in Takt 0 und 1, `bass` nur in Takt 1 → `activeLayers(ev, 0)` ist `{drums}`, `activeLayers(ev, 1)` ist `{drums, bass}`, Takt ohne Ereignisse → leere Menge.
- [ ] **Step 2:** FAIL → **Step 3:** umsetzen → **Step 4:** PASS.
- [ ] **Step 5: `timbre-panel.js`** baut statt `<details>` die Module (Reihenfolge `LAYER_IDS`); Felder als Range-Inputs 0..100 mit `createKnob(input, { size: 's', origin })`, `origin` nach Global Constraints; Beschriftung ≥ 11 px unter dem Knopf; gedimmt (`disabled`) wie heute über `usesTimbreField`. Percussion: Modul ohne Klangfelder mit dem Hinweistext von heute (teilt den Raum mit dem Schlagzeug). `master`-Felder als `size: 'm'` Knöpfe in `#mixer-master`.
- [ ] **Step 6: `voices-panel.js`.** Ein Select je Schicht für Stimme **und** Variante (meine Spec-Entscheidung), `createLcdSelect`; `change` ruft das vorhandene `choose(layer, { id, variant })`. Versteckte Stimmen bleiben draußen. Art-Kennung `SMP` für `kind === 'sample'`, sonst `SYN` (i18n `voice.kindShort.sample`/`voice.kindShort.synth`). Ladezustand steht in `#voice-status-${layer}` im LCD (Texte wie heute).
- [ ] **Step 7: `jobs-panel.js`.** Aufgabe als LCD-Select im Modul der Schicht.
- [ ] **Step 8: Aktivitäts-LED.** In `tuning.js` beim Zeichnen: `.led[data-activity]` eines Moduls und die LED vor der Spur bekommen `on`, wenn die Wiedergabe läuft, die Schicht nicht stumm ist und `activeLayers(events, current.bar % loopBars)` sie enthält.
- [ ] **Step 9: Tests umstellen** (`timbre.spec.js`, `voices-ui.spec.js`, `jobs-ui.spec.js`): Gruppen öffnen entfällt; Varianten-Select `#variant-${layer}` ersetzt durch `#voice-${layer}` mit `"sample/finger"` usw.; Knöpfe per `fill` auf das Input oder Pfeiltasten. Neu: Tab-Reihenfolge innerhalb eines Moduls ist Stimme → Aufgabe → Detailknöpfe in Lesereihenfolge → Zurücksetzen (Review Focus 3); bei laufender Wiedergabe hat das Schlagzeug-Modul `.led.on`, das stumme Percussion-Modul nicht.
- [ ] **Step 10:** `npm test`; `npx playwright test tests/e2e/timbre.spec.js tests/e2e/voices-ui.spec.js tests/e2e/jobs-ui.spec.js --no-deps`; danach `npx playwright test tests/e2e/voices-sample-sound.spec.js tests/e2e/voices-sound.spec.js` → PASS.
- [ ] **Step 11: Commit** `feat: instrument modules with knobs and lcd voice select`

---

### Task 4: Mixer-Modul und „alle Samples“

**Modell:** Sonnet

**Files:**
- Modify: `src/core/voices.js`, `src/ui/mixer.js`, `src/ui/voices-panel.js`, `src/ui/app.css`, `src/i18n/de.js`, `src/i18n/en.js`
- Test: `tests/core/voices.test.js`, `tests/e2e/mixer.spec.js`

**Interfaces:**
- Consumes: `#mod-mixer`, `#mixer-master` (Task 2/3), `choose` in `voices-panel.js`
- Produces:
  - `setAllVoices(voices, kind: 'synth'|'sample'): Voices` in `src/core/voices.js`: jede Schicht auf `{ id: 'sample', variant: erste }` bzw. `DEFAULT_VOICE`; neue Kopie
  - `voiceKind(voices): 'synth'|'sample'|'mixed'`: `'sample'`, wenn jede Schicht eine Stimme mit `kind === 'sample'` hat; `'synth'`, wenn keine; sonst `'mixed'`
  - `chooseAll(kind)` exportiert aus `initVoices`' Rückgabe oder als zweite Rückgabe (`initVoices` liefert dann `{ render, chooseAll }`; `app.js` anpassen)
  - Kanal je Schicht: Fader `#mix-${layer}` (Range 0..100, senkrecht), Stumm `button[data-mute="${layer}"]` mit LED; Gesamt `#mix-master`; Schalter `#all-voices` (`role="switch"`, `aria-checked` = alle Samples, bei gemischt `aria-checked="mixed"`)

- [ ] **Step 1: Failing unit tests** in `tests/core/voices.test.js`:

```js
assert.deepEqual(setAllVoices({}, 'sample').bass, { id: 'sample', variant: 'finger' });
assert.deepEqual(setAllVoices({ bass: { id: 'sample', variant: 'pick' } }, 'synth').bass, { id: 'synth', variant: 'classic' });
assert.equal(voiceKind(setAllVoices({}, 'sample')), 'sample');
assert.equal(voiceKind({}), 'synth');
assert.equal(voiceKind({ bass: { id: 'sample', variant: 'pick' } }), 'mixed');
assert.equal(voiceKind({ bass: { id: 'string', variant: 'finger' } }), 'synth'); // Modell zählt als Synth
```

- [ ] **Step 2:** FAIL → **Step 3:** umsetzen → **Step 4:** PASS.
- [ ] **Step 5: `mixer.js`.** Kanäle nebeneinander in `#mod-mixer`: Name (≥ 11 px), Fader senkrecht (`writing-mode: vertical-lr; direction: rtl`, Daumen als weiße Kappe nach `rack.html`), Stumm-Taste mit LED (pink = stumm; gleicher Zustand wie heute über `toggleLayer`). Rechts der Gesamtkanal: `#all-voices`, die Knöpfe aus `#mixer-master`, Gesamtfader. Verhalten der Fader wie heute (`saveMix`, `setLevel`, `setMaster`, nur bei Änderung schreiben, gezogener Fader springt nicht).
- [ ] **Step 6: `#all-voices`.** Klick: bei `voiceKind === 'sample'` → `chooseAll('synth')`, sonst `chooseAll('sample')`; danach `render()`. Anzeige `SYN`/`SMP`/gemischt (i18n `ui.allVoices`, `ui.allVoices.synth`, `.sample`, `.mixed`).
- [ ] **Step 7: Tests** `tests/e2e/mixer.spec.js` umstellen (kein Popover, kein `#mixer-btn`) und ergänzen:
  - `#all-voices` auf Samples: jedes `#voice-${layer}` hat danach einen Wert `sample/…`, Schalter `aria-checked="true"`; ein Instrument zurück auf Synth → `aria-checked="mixed"`.
  - Review Focus 4: Route für ein Pack (`**/assets/samples/bass-finger.*`) mit Status 500; `#all-voices` klicken; `#voice-status-bass` zeigt den Fehlertext von heute, die anderen Instrumente werden „bereit“, die Seite bleibt bedienbar, keine `pageerror`.
  - Review Focus 2: Während der Wiedergabe Fader `#mix-drums` per Tastatur auf 40, zwei Takte warten, Wert bleibt 40.
- [ ] **Step 8:** `npm test`; `npx playwright test tests/e2e/mixer.spec.js --no-deps`; `npx playwright test tests/e2e/mix.spec.js` → PASS.
- [ ] **Step 9: Commit** `feat: mixer module with faders and all-samples switch`

---

### Task 5: Harmonie, Rhythmus, Charakter

**Modell:** Sonnet

**Files:**
- Modify: `src/core/fretboard.js` (Rollen der Progression), `src/ui/key-scale.js`, `src/ui/progression-editor.js`, `src/ui/chord-color.js`, `src/ui/rhythm.js`, `src/ui/app.js`, `src/ui/index.html`, `src/ui/app.css`, `src/i18n/de.js`, `src/i18n/en.js`
- Test: `tests/core/fretboard.test.js`, `tests/e2e/tuning.spec.js`, `tests/e2e/rhythm.spec.js`, `tests/e2e/chord-color.spec.js`, `tests/e2e/chord-picker.spec.js`, `tests/e2e/style-color.spec.js`

**Interfaces:**
- Consumes: `createKnob`, `createLcdSelect` (Task 1); `#mod-harmony`, `#mod-rhythm`, `#mod-character` (Task 2)
- Produces:
  - `progressionRoles(track, bar: number|null): Array<'now'|'hold'|'next'|'later'>` in `src/core/fretboard.js`, Länge = `track.bars.length`. `now` = `chordIndex(track, bar ?? 0)`; dann Takt für Takt vorwärts (`chordIndex`, über das Ende hinaus im Kreis): Einträge mit demselben Akkord wie `now` werden `hold`, der erste mit anderem Akkord wird `next`, danach Abbruch; alles übrige `later`. Gleiche Akkorde vergleicht `sameChord` (schon in der Datei).
  - `chooseRoot(root: string)`, `chooseScale(scale: string)` exportiert aus `key-scale.js` (bisherige Chip-Logik); Selects `#key-select`, `#scale-select`
  - `#groove-select` (LCD-Select), `#style-select` (LCD-Select, ruft `applyStyle(id)` und `applyLive({ patterns: true, tempo: true })` wie die Stilkarten), `#tags-btn` öffnet `#tags-pop` (Popover mit dem vorhandenen `#tags`), `#char-words` (gewählte Wörter als Text-Schilder, nur Anzeige), `#add-btn` öffnet `#add-pop` (Popover mit dem vorhandenen `#add-chords`)

- [ ] **Step 1: Failing unit tests** in `tests/core/fretboard.test.js`:

```js
const am = { root: 'A', quality: 'min' }, dm = { root: 'D', quality: 'min' }, e = { root: 'E', quality: 'maj' };
const track = { bars: [{ chord: am }, { chord: am }, { chord: dm }, { chord: e }], length: 16 };
assert.deepEqual(progressionRoles(track, 0), ['now', 'hold', 'next', 'later']);
assert.deepEqual(progressionRoles(track, 2), ['later', 'later', 'now', 'next']);
assert.deepEqual(progressionRoles(track, 3), ['next', 'later', 'later', 'now']); // E jetzt, danach im Kreis Am
assert.deepEqual(progressionRoles(track, null), ['now', 'hold', 'next', 'later']);
assert.deepEqual(progressionRoles({ bars: [{ chord: am }], length: 8 }, 3), ['now']);
```
- [ ] **Step 2:** FAIL → **Step 3:** umsetzen → **Step 4:** PASS.
- [ ] **Step 5: Harmonie.** Tonart und Skala als LCD-Selects (`chooseRoot`/`chooseScale`; die Chips der Startseite nutzen dieselben Funktionen). Akkordfarbe: vorhandene Tasten als LED-Reihe. Progression: vorhandene Tasten in `#progression` (Klick entfernt weiter) mit Stufe darunter (`degreeLabel`) und Klasse `role-now|role-hold|role-next|role-later` aus `progressionRoles(state.track, state.current?.bar ?? null)`; `aria-current` wie heute. `#add-btn` („+“, Label „Akkord hinzufügen“) öffnet `#add-pop` mit der zweistufigen Auswahl von heute. Die Progression im Akkorde-Modul der Visualisierung (Task 7) nutzt dieselben Klassen.
- [ ] **Step 6: Rhythmus.** `#tuning-tempo` als großer weißer Knopf (`origin: 'none'`, Bereich 40..200) mit LCD-Anzeige `#tuning-tempo-out` „100 BPM“; Taktart als LED-Tasten; Groove als `#groove-select` (Einträge aus `groovesFor(meter)`, neu gebaut bei Taktartwechsel); Komplexität aus Task 1.
- [ ] **Step 7: Charakter.** `#style-select` (alle `STYLE_PRESETS`), `#char-words` zeigt die gewählten Schlagworte übersetzt (`tag.<kategorie>.<wort>`), `#tags-btn` öffnet `#tags-pop`. Neue i18n-Schlüssel für Modultitel und Tasten.
- [ ] **Step 8: Tests umstellen** (Chips → Selects/Popover; Verhalten bleibt) und ergänzen: Progression bei Takt 1 (gestoppt) zeigt die Klassen `role-now, role-hold, role-next, role-later` für Am Am Dm E (Folge über `addChordByName` aufbauen).
- [ ] **Step 9:** `npm test`; `npx playwright test tests/e2e/tuning.spec.js tests/e2e/rhythm.spec.js tests/e2e/chord-color.spec.js tests/e2e/chord-picker.spec.js tests/e2e/style-color.spec.js --no-deps` → PASS.
- [ ] **Step 10: Commit** `feat: harmony, rhythm and character modules`

---

### Task 6: Form & Spuren mit Feldern am Streifen

**Modell:** Sonnet

**Files:**
- Modify: `src/ui/form-panel.js`, `src/ui/form-strip.js`, `src/ui/form-ui.js`, `src/ui/tuning.js` (Spurbeschriftung), `src/ui/index.html`, `src/ui/app.css`, `src/i18n/de.js`, `src/i18n/en.js`
- Test: `tests/core/form-ui.test.js`, `tests/e2e/form-panel.spec.js`, `tests/e2e/form-strip.spec.js`

**Interfaces:**
- Consumes: `createKnob`, `createLcdSelect` (Task 1); `#form-song`, `#form-insp` (Task 2); `editPart`, `limits` in `form-ui.js`
- Produces:
  - `barsFromDrag(startBars: number, dx: number, pxPerBar: number, { min, max }): number` in `form-ui.js` (rundet auf ganze Takte, begrenzt auf `limits`)
  - Griffe `.part-grip[data-edge="end"]` am gewählten Teil im Streifen

- [ ] **Step 1: Failing unit tests** in `tests/core/form-ui.test.js`: `barsFromDrag(8, 35, 10, { min: 1, max: 64 }) === 12` (3,5 → 4 Takte dazu); `barsFromDrag(8, -200, 10, { min: 1, max: 64 }) === 1`; `barsFromDrag(60, 100, 10, { min: 1, max: 64 }) === 64`.
- [ ] **Step 2:** FAIL → **Step 3:** umsetzen → **Step 4:** PASS.
- [ ] **Step 5: Linkes Feld „ganzes Lied“** (`#form-song`): Titel, `#form-template` und `#length` als LCD-Selects, darunter die vier Knöpfe (`#form-structure` und `#form-dynamics` `origin: 'center'`, `#form-pauses` und `#form-randomness` `origin: 'start'`), unten hinter `.dots` die Tasten `#form-roll` (würfeln) und `#form-add` (+ Teil). Verhalten wie heute (Struktur würfelt beim Loslassen: `change`).
- [ ] **Step 6: Rechtes Feld „gewählter Teil“** (`#form-insp`), gleich aufgebaut: Titel „gewählt: TEIL N“, wobei nur das Schild „TEIL N“ die Farbe des Blocks trägt; `#part-type`, Länge (`#part-shorter`, `#part-len-out`, `#part-longer` als LCD mit −/+), `#part-transition` als LCD-Selects; darunter `#part-level` und `#part-density` als Knöpfe (`origin: 'center'`, `data-reset` auf `#part-level-reset` bzw. `#part-density-reset`; die Reset-Tasten bleiben als kleine Tasten); unten zwei Reihen: schieben (`#part-left`, `#part-right`), kopieren/löschen (`#part-copy`, `#part-delete`), Crash (`#part-crash` als LED-Taste statt Checkbox, `aria-pressed`), Sperre (`#part-lock`). Hinweistexte von heute bleiben.
- [ ] **Step 7: Streifen.** Gesperrte Teile mit schwarzer Ecke; der gewählte Teil bekommt einen Griff an der rechten Kante: Ziehen ändert die Länge über `barsFromDrag` und `editPart` (sperrt den Teil wie jede Bearbeitung), mit Zeiger-Capture; Tastatur bleibt −/+. Spurbeschriftungen links vor `#lanes` (die vorhandenen `#lane-buttons`, Stumm-Zustand wie heute) mit LED aus Task 3.
- [ ] **Step 8: Tests umstellen und ergänzen:** Griff am gewählten Verse (16 Takte) um 4 Taktbreiten nach rechts ziehen → `#part-len-out` zeigt 20 Takte, Teil ist gesperrt, Gesamtlänge in `#play-position` stimmt; Teil wählen färbt nur das Schild „TEIL N“.
- [ ] **Step 9:** `npm test`; `npx playwright test tests/e2e/form-panel.spec.js tests/e2e/form-strip.spec.js --no-deps` → PASS.
- [ ] **Step 10: Commit** `feat: song form fields beside the strip, drag to resize parts`

---

### Task 7: Visualisierung: Tonart, Countdown, Griffbrett, Akkordkreis

**Modell:** Sonnet

**Files:**
- Modify: `src/audio/play.js`, `src/core/fretboard.js`, `src/ui/fretboard.js`, `src/ui/wheel.js`, `src/ui/tuning.js`, `src/ui/app.js`, `src/ui/index.html`, `src/ui/app.css`, `src/i18n/de.js`, `src/i18n/en.js`
- Test: `tests/core/play-live.test.js`, `tests/core/fretboard.test.js`, `tests/e2e/fretboard.spec.js`, `tests/e2e/play-page.spec.js`

**Interfaces:**
- Consumes: `progressionRoles` (Task 5), `#mod-key`, `#mod-fretboard`, `#mod-wheel`, `#play-part` (Task 2), `state.layout.frets`
- Produces:
  - `player.songTime(): number` (Liedzeit in Sekunden ab Liedanfang, über Durchläufe weiterzählend, mit Tempo-Anker wie die Planung; nach `stop()` der letzte Wert)
  - `beatsUntilChange(track, songSec: number): number | null` in `src/core/fretboard.js`: ganze Schläge bis zum Beginn des nächsten Takts mit anderem Akkord (aufgerundet, mindestens 1), `null` wenn die Folge nur einen Akkord hat; Taktdauer = `beats * 60 / track.bpm`, Takt über die Schleife mit `loopBars`
  - `FRETS = 22` in `src/core/fretboard.js`
  - `fretboard.update({ key, scale, current, next, labels, spacing: 'real'|'even' })`; Umschalter `button[data-frets="real"|"even"]` im Griffbrett-Modul

- [ ] **Step 1: Failing unit tests.**
  - `tests/core/fretboard.test.js`: Folge Am Am Dm E in 4/4 bei 60 bpm (1 Schlag = 1 s): `beatsUntilChange(track, 0) === 8`, `(track, 0.5) === 8` (aufgerundet: 7,5 → 8), `(track, 7.2) === 1`, `(track, 8) === 4`; Folge nur aus Am → `null`. Bestehende Tests, die 15 Bünde annehmen, auf 22 umstellen (höchster Bund in `fretboardNotes(...)` ist 22).
  - `tests/core/play-live.test.js` (vorhandene Fake-Context-Hilfen): nach Start bei `ctx.currentTime = LEAD + 2` liefert `songTime()` ≈ 2; nach `setTempo(2 * bpm)` und einer weiteren Sekunde ≈ 4.
- [ ] **Step 2:** FAIL → **Step 3:** umsetzen (`songTime` aus `anchor` und dem Tempofaktor, die `play.js` schon führt; `FRETS` erhöhen) → **Step 4:** PASS.
- [ ] **Step 5: Tonart-Modul** (`#mod-key`): Tonart groß als LCD `#play-key` („Am“, aus `track.key`), Skala darunter, `.dots`, dann „nächster“ mit LCD `#play-next` (türkis) und `#play-countdown` („in 3 Schlägen“, i18n mit Einzahl/Mehrzahl). Der Countdown aktualisiert sich nur bei laufender Wiedergabe über `requestAnimationFrame` mit `player.songTime()` und schreibt nur bei Änderung (nicht über `render()`); gestoppt ist er leer. Im Fokus größere Schrift.
- [ ] **Step 6: Kopfleiste.** `#play-part` zeigt den Teil am aktuellen Takt (`sectionAt(form, bar)`, Typname übersetzt plus laufende Nummer dieses Typs, z. B. „Verse 1“); ohne Form leer.
- [ ] **Step 7: Griffbrett.** 22 Bünde; Geometrie neu berechnen, wenn `spacing` wechselt (echte Abstände nach 12tel-Teilung wie heute, sonst gleich breit); Notenradius höchstens 40 % der Bundbreite, sonst wie heute; markierte Bünde (3, 5, 7, 9, 12, 15, 17, 19, 21) als dunkler hinterlegte Spalte, größere dunkle Punkte (12 doppelt), Bundzahlen in eigener Zeile unter dem Brett (≥ 12 px, halbfett). Umschalter Namen/Stufen und echte/gleich breite Bünde als LED-Tasten im Modulkopf, beide gemerkt (`state.layout.labels`, `state.layout.frets`). Farben nach Global Constraints. Legende nur im Fokus.
- [ ] **Step 8: Akkordkreis.** Vorhandene Geometrie bleibt (Knoten anklickbar zum Hinzufügen); `wheelState` bekommt `next`; aktueller Akkord pink gefüllt, nächster türkis gefüllt, Leiterakkorde grau hinterlegt, weitere Akkorde der Folge umrandet; Tonart in der Mitte als LCD-Kreis. Darunter die Progression mit den Rollen-Klassen aus Task 5 (nur Anzeige, `aria-hidden` nicht nötig, aber keine zweite Bedienung: es sind `span`, keine Tasten).
- [ ] **Step 9: Tests** `tests/e2e/fretboard.spec.js` und `tests/e2e/play-page.spec.js` umstellen und ergänzen: 22 Bundzahlen-Positionen (Text 21 vorhanden); Umschalter „gleich breit“ macht Abstand Bund 1 und Bund 21 gleich (±1 px), Wahl übersteht Neuladen; bei laufender Wiedergabe zeigt `#play-countdown` eine Zahl zwischen 1 und der Schlagzahl bis zum Wechsel und `#play-next` den Akkord aus `nextDistinctChord`.
- [ ] **Step 10:** `npm test`; `npx playwright test tests/e2e/fretboard.spec.js tests/e2e/play-page.spec.js --no-deps` → PASS.
- [ ] **Step 11: Commit** `feat: key module with countdown, 22-fret board with spacing switch, wheel colors`

---

### Task 8: Profile-Fenster, Feinschliff, Gesamtlauf, Doku

**Modell:** Sonnet

**Files:**
- Modify: `src/ui/app.css` (Profil-Fenster im Rack-Look, Startseite mit neuen Variablen lesbar), `README.md` (Abschnitt „The interface“: Spielseite, Mixer, Fokus/Einstellen, 22 Bünde), `docs/interface.md` (falls dort Oberflächen-IDs oder Layout-Schlüssel stehen)
- Test: `tests/e2e/ui.spec.js`, `tests/e2e/profiles.spec.js`, gesamte Suite

- [ ] **Step 1: Failing test** in `tests/e2e/ui.spec.js` (Englisch und Deutsch, Spielseite im Zustand Einstellen): kein sichtbarer Text entspricht `RAW_KEY` (Muster aus `views.spec.js` übernehmen, erweitert um `form|voice|job|timbre|groove|chordColor`); kein sichtbares Element mit Text hat eine berechnete `font-size` unter 11 px.
- [ ] **Step 2:** FAIL (falls etwas fehlt) → **Step 3:** fehlende Übersetzungen und zu kleine Schriften beheben → **Step 4:** PASS.
- [ ] **Step 5: Profil-Fenster** als Modul-Platte gestalten (Baum, Felder, Tasten im Rack-Look); Inhalt und IDs unverändert.
- [ ] **Step 6: Doku** README und `docs/interface.md` nachziehen (englisch bzw. deutsch wie die Dateien).
- [ ] **Step 7: Gesamtlauf** `npm test` und `npm run test:e2e` → PASS. Sichtprüfung per Screenshot bei 1600 × 960 und 1366 × 768 in beiden Zuständen gegen `rack.html` (Ablage im Scratchpad, nicht im Repo).
- [ ] **Step 8: Commit** `feat: profile window in rack look, docs for the new play page`
