# Griffbrett und Spielseite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Oberfläche bekommt ein Griffbrett (Leiter, jetziger und folgender Akkord) und eine neue Seitenstruktur: schlanke Startseite, Spielseite mit Visualisierungsblöcken in der Mitte und zwei einklappbaren Seitenleisten für die Konfiguration.

**Architecture:** Neue reine Logik in `src/core/fretboard.js` (Töne, Rollen, folgender Akkord, Stufen) und `src/ui/layout-state.js` (gemerkter Layoutzustand, mit Node-Tests). Die Oberfläche (`src/ui`) behält ihren einen Zustand und `render()`; die bisherige Feintuning-Ansicht wird zur Spielseite umgebaut, Blöcke und Leisten sind kleine Module. Der Generator bleibt unverändert.

**Tech Stack:** Reines JavaScript (ES-Module), SVG für das Griffbrett, bestehendes Canvas für Verlauf und Akkordrad, `node:test` und Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-fretboard-and-play-page-design.md` (dazu `docs/superpowers/specs/2026-11-07-backingtrack-generator-design.md`)

## Global Constraints

- Reines JavaScript, keine Laufzeit-Abhängigkeiten, lokal und offline, Chrome auf Windows. Tests vor Code.
- Alle sichtbaren Texte über `t` in `src/i18n/de.js` und `en.js` (Deutsch mit echten Umlauten); die Paritätstests in `tests/core/i18n.test.js` bleiben grün. Kein roher Schlüsselname darf sichtbar sein, auch nicht in `aria-label`, `title` oder SVG-Text.
- Kein `Math.random`, kein `innerHTML` mit dynamischem Text. Kein Browser-Objekt beim Import in `src/core`, `src/i18n`, `src/audio`, `src/index.js` und in den rein berechnenden UI-Modulen, die Node-Tests laden (`wheel-geometry.js`, `layout-state.js`).
- Bezeichner Englisch, Kommentare Deutsch, LF-Zeilenenden.
- Der Generator (Ereignisstrom, Arrangement, Klang) bleibt unverändert; `tests/core/golden.test.js` bleibt unverändert grün.
- Bestehende Tests (152 Node, 58 Browser) sind Regressionsschutz: bei Layoutänderung anpassen, nie abschwächen oder löschen; jede Änderung an einer bestehenden Prüfung im Bericht nennen.
- Bestehende Zugänglichkeit bleibt: Fokusführung, Live-Regionen nur bei Änderung beschreiben (DOM-Schreiben nur bei Änderung über `setText`/`setAttr`), 360 px ohne horizontales Scrollen, keine externen Anfragen, `prefers-reduced-motion` beachten.
- Optik vorläufig: CSS-Variablen in `app.css` (`--paper`, `--ink`, `--accent #c8452d`); neu `--accent2: #2f6f8f` für den folgenden Akkord. Beim Griffbrett gilt "ein farbiges Objekt" ausdrücklich nicht, Bedeutung nie nur durch Farbe.
- Hörprobe und Sichtprobe entscheidet der Auftraggeber.

## Review Focus

1. Akkordfolge mit nur einer verschiedenen Akkordart oder `length`, die kein Vielfaches der Folge ist: kein "folgender" Akkord bzw. der hörbare, nicht der zyklische Nachfolger; keine Ausnahme, Griffbrett zeigt nur den jetzigen (Task 1, 5).
2. Gemerkter Layoutzustand kaputt (ungültiges JSON, unbekannte Schlüssel, falsche Typen, `localStorage` wirft oder fehlt): Standardwerte, kein Absturz (Task 2, 4, 6).
3. Akkordton außerhalb der Leiter (F über Dm in der Pentatonik) und Tonarten mit Bs (c-Moll): Notennamen und Stufen stimmen, der Ton bleibt sichtbar (Task 1, 5).
4. Schmales Fenster (360 und etwa 800 px): überlagernde Leiste, Escape, Fokus zurück zum Auslöser, nur eine Leiste zugleich, kein horizontales Scrollen (Task 4, 7).
5. Sprachwechsel, Akkordwechsel und Seitenwechsel bei offener Leiste und laufender Wiedergabe: kein sichtbarer Schlüsselname, kein Fokusverlust, keine DOM-Schreibvorgänge je Takt außer bei echter Änderung (Task 5, 7).

---

## File Structure

```
src/core/music.js            + export noteName(key, pc)
src/core/fretboard.js        STANDARD_TUNING, FRETS, degreeLabel, nextDistinctChord, fretboardNotes (rein)
src/ui/layout-state.js       LAYOUT_KEY, DEFAULT_LAYOUT, loadLayout, saveLayout (rein, Speicher wird übergeben)
src/ui/key-scale.js          Tonart- und Skala-Chips (aus app.js herausgelöst, für Popover und Leiste)
src/ui/sidebar.js            einklappbare Seitenleiste (docked oder überlagernd)
src/ui/blocks.js             VIEWS-Registry, Ansichten ein/aus
src/ui/fretboard.js          Griffbrett-Block (SVG)
src/ui/index.html, app.css, app.js, state.js, tuning.js   Umbau zu Start- und Spielseite
tests/core/fretboard.test.js, layout-state.test.js
tests/e2e/play-page.spec.js  neu; ui.spec.js und tuning.spec.js angepasst
```

### Task 1: Griffbrett-Logik (rein)

**Files:** Create `src/core/fretboard.js`, `tests/core/fretboard.test.js`; Modify `src/core/music.js` (nur `noteName` exportieren), `src/index.js` unverändert.

**Interfaces:**
- Consumes: `scalePcs(key, scale)`, `chordMidi(chord, octave)`, `noteToPc`, die bestehende nicht exportierte `spelling(key, root)` in `music.js`.
- Produces:
  - `noteName(key: Key, pc: number): string` in `music.js` (Kreuz oder B nach der Tonart wie bei den Akkorden; c-Moll: pc 10 = `'Bb'`, a-Moll: pc 10 = `'A#'`).
  - `STANDARD_TUNING = [64, 59, 55, 50, 45, 40]` (MIDI, hohe e-Saite zuerst), `FRETS = 15`.
  - `degreeLabel(key: Key, pc: number): string` mit `['1','b2','2','b3','3','4','b5','5','b6','6','b7','7'][(pc - rootPc + 12) % 12]`.
  - `nextDistinctChord(bars: {chord: Chord, beats: number}[], length: number, barIndex: number): Chord | null`: Takt `i` hat den Akkord `bars[i % bars.length]` für `i` in `0..length-1`, danach springt der Track zu Takt 0; gesucht wird ab `barIndex % length + 1` (zyklisch über `length`) höchstens `length` Takte weit der erste Akkord, der sich in Grundton-Tonhöhenklasse oder Akkordart vom jetzigen unterscheidet; sonst `null`. Leere Folge, `length < 1` oder ungültige Eingabe ergeben `null`, nie eine Ausnahme.
  - `fretboardNotes({ key, scale, current, next, tuning = STANDARD_TUNING, frets = FRETS }): FretNote[]` mit `FretNote = { string: number /* 0 = hohe e */, fret: number, pc: number, name: string, degree: string, scale: boolean, current: boolean, next: boolean, root: boolean }`; nur Positionen, an denen `scale || current || next` gilt; `current`/`next` bedeuten Akkordton des jeweiligen Akkords (`null` = keiner); `root` = `current` ist gesetzt und `pc` ist der Grundton des jetzigen Akkords. Reihenfolge: Saite 0..5, Bund 0..frets.

- [ ] **Step 1: Write failing tests** `tests/core/fretboard.test.js` (A-Moll, Skala `minorPentatonic`, jetzt Am, als Nächstes Dm):
  - Tiefe E-Saite (`string 5`), Bund 0: `{pc:4, name:'E', degree:'5', scale:true, current:true, next:false, root:false}`; Bund 5: `{pc:9, name:'A', degree:'1', scale:true, current:true, next:true, root:true}`; Bund 1 (F): `{pc:5, name:'F', degree:'b6', scale:false, current:false, next:true, root:false}`; Bund 3 (G): `scale:true, current:false, next:false`; Bund 2 (F#): kommt nicht vor.
  - Anzahl der Töne gleich einer unabhängig im Test berechneten Brute-Force-Zählung über `tuning`, Bünde 0..15 und die Tonhöhenklassen {9,0,2,4,7,5}.
  - `current: null, next: null` liefert nur Leiterton-Positionen mit `current:false`, `next:false`, `root:false`; `frets: 12` begrenzt die Bünde.
  - `noteName`: a-Moll pc 10 → `'A#'`, c-Moll pc 10 → `'Bb'`, d-Moll pc 10 → `'Bb'`, e-Moll pc 6 → `'F#'`. `degreeLabel`: A-Moll pc 9 `'1'`, 0 `'b3'`, 2 `'4'`, 4 `'5'`, 7 `'b7'`; C-Dur pc 4 `'3'`, 11 `'7'`, 6 `'b5'`.
  - `nextDistinctChord`: `Am Am Dm E`, `length 24`: Takt 0 → Dm, Takt 1 → Dm, Takt 2 → E, Takt 3 → Am, Takt 24 verhält sich wie Takt 0; `Am Dm Em G C`, `length 24`, Takt 23 (G) → **Am** (hörbarer Sprung, nicht C), Takt 22 (Em) → G; nur `Am`-Takte → `null`; `Bb` und `A#` gelten als gleicher Akkord (`[Bb, A#, C]` → C); `[]`, `length 0`, `null` → `null`.
- [ ] **Step 2: Run** `npm test` – Expected: FAIL (Modul fehlt).
- [ ] **Step 3: Implement** die Signaturen oben; `noteName(key, pc)` ruft die vorhandene `spelling` auf. Reine Logik ohne Browser-Objekte.
- [ ] **Step 4: Run** `npm test` – Expected: alles PASS, Golden-Test unverändert.
- [ ] **Step 5: Commit** `feat: fretboard note roles, degrees and audible next chord`

### Task 2: Layoutzustand und Speicherung (rein)

**Files:** Create `src/ui/layout-state.js`, `tests/core/layout-state.test.js`

**Interfaces:**
- Produces: `LAYOUT_KEY = 'backingtrack.layout'`; `DEFAULT_LAYOUT = { sidebars: { left: false, right: false }, views: { fretboard: true, wheel: true }, labels: 'names' }`; `loadLayout(storage?: { getItem(k: string): string | null }): Layout`; `saveLayout(storage?: { setItem(k: string, v: string): void }, layout: Layout): void`. Beide nie mit Ausnahme: fehlender oder werfender Speicher, ungültiges JSON, falsche Typen, unbekannte Schlüssel (werden verworfen), `labels` ungleich `'names'|'degrees'`. Teilangaben werden mit den Standardwerten aufgefüllt. `views.lanes` gibt es nicht (der Verlauf lässt sich nicht ausblenden): ein gespeichertes `views.lanes` wird verworfen.

- [ ] **Step 1: Write failing tests**: leerer Speicher → `DEFAULT_LAYOUT` (tief gleich, aber ein neues Objekt); Rundreise `saveLayout` → `loadLayout`; `'{'` → Standard; `'null'`, `'5'`, `'[]'` → Standard; `{"labels":"x"}` → `labels:'names'`; `{"sidebars":{"left":"yes"}}` → `left:false`; `{"views":{"lanes":false,"fretboard":false}}` → `views` hat kein `lanes`, `fretboard:false`; `storage` undefined und `getItem`/`setItem` werfen → kein Fehler, `loadLayout` liefert Standard; `saveLayout` schreibt unter `LAYOUT_KEY`.
- [ ] **Step 2: Run** `npm test` – Expected: FAIL.
- [ ] **Step 3: Implement** wie oben, ohne Browser-Objekte beim Import (Speicher wird übergeben).
- [ ] **Step 4: Run** `npm test` – Expected: PASS.
- [ ] **Step 5: Commit** `feat: remembered layout state`

### Task 3: Start- und Spielseite (Struktur und Navigation)

**Files:** Modify `src/ui/index.html`, `app.css`, `app.js`, `state.js`, `tuning.js`; Create `src/ui/key-scale.js`; Modify `tests/e2e/ui.spec.js`, `tests/e2e/tuning.spec.js`; Create `tests/e2e/play-page.spec.js`; Modify `src/i18n/de.js`, `en.js`.

**Interfaces:**
- Consumes: `loadLayout`/`saveLayout`/`DEFAULT_LAYOUT` (Task 2), die vorhandenen Module `wheel.js`, `lanes.js`, `progression-editor.js`, `tags-ui.js`.
- Produces:
  - `state.page: 'start' | 'play'` ersetzt `state.tuningOpen`; `state.layout: Layout` (aus `loadLayout(localStorage)` mit `try/catch` um den Zugriff); jede Layoutänderung ruft `saveLayout`.
  - `showPage(page: 'start' | 'play', opts?: { sidebars?: { left: boolean, right: boolean } }): void` in `app.js`: setzt `state.page`, schreibt optional den Leistenzustand ins Layout, rendert, verschiebt den Fokus (Spielseite: auf `#play-title` mit `tabindex="-1"`; zurück zur Startseite: auf den auslösenden Knopf).
  - `buildKeyScale(containers: { keyChips: HTMLElement, scaleChips: HTMLElement }, hooks: { restartIfPlaying(): void, render(): void }): { render(): void }` in `key-scale.js`: baut die zwölf Tonart-Chips und die Skala-Chips (Handler wie bisher in `app.js`: `state.track.key`, `deriveBars()`, Neustart). `app.js` ruft es für das Popover (`#key-chips`, `#scale-chips`) und für die rechte Leiste (`#side-key-chips`, `#side-scale-chips`) auf.
  - HTML: `<section class="play" id="play" aria-labelledby="play-title" hidden>` mit Kopfzeile (`#play-back` ← Start, `#play-title` (visuell versteckt, fokussierbar), `#play-now` jetziger Akkord groß, `#play-next` folgender Akkord (befüllt in Task 5), `#play-position`, `#play-go` Los/Stopp, `#play-variant` nur Anzeige "Variante n"), darunter `<div class="stage">` mit `<aside id="side-left">`, `<div id="blocks">` und `<aside id="side-right">`. Blöcke (`<section class="block" data-view="…">` mit Überschrift): `fretboard` (leer bis Task 5), `lanes` (Verlauf mit `#lane-buttons` und `#lanes` wie bisher), `wheel` (`#wheel`). Linke Leiste "Klang": `#quick-pick`, `#tags`, Tempo (`#tuning-tempo`), Länge (`#length`). Rechte Leiste "Akkorde": `#side-key-chips`, `#side-scale-chips`, `#progression`, `#tuning-message` (Live-Region), `#add-chords`. Bestehende Element-IDs bleiben, wo sie in der neuen Struktur nicht irreführen; `#tuning-go` wird `#play-go`, `#tuning-title` wird `#play-title`, `#tuning` wird `#play`.
  - Startseite: `#tune-btn` (Feintuning) öffnet die Spielseite mit **beiden** Leisten offen und startet nicht; `#go` startet und öffnet die Spielseite (Leistenzustand aus dem gemerkten Layout, beim ersten Besuch beide zu); neuer Knopf `#to-play` ("Zur Spielseite", `ui.toPlayPage`) ist nur während der Wiedergabe sichtbar; auf der Startseite zeigt `#go` während der Wiedergabe "Stopp", `#now-chord` und `#position` bleiben dort sichtbar. `#play-back` kehrt zur Startseite zurück, die Wiedergabe läuft weiter.
  - Neue i18n-Schlüssel (beide Sprachen): `ui.toPlayPage`, `ui.sidebarSound` (de "Klang", en "Sound"), `ui.sidebarChords` (de "Akkorde", en "Chords"), `ui.nextChord` (de "Als Nächstes", en "Next"), `ui.variantShown` (de "Variante {n}", en "Variant {n}") und Überschriften der Blöcke `view.fretboard`, `view.lanes`, `view.wheel` (de "Griffbrett", "Verlauf", "Akkordrad"; en "Fretboard", "Course", "Chord wheel").

- [ ] **Step 1: Write failing tests** `tests/e2e/play-page.spec.js` (de-DE, mit Fehlersammlung wie in `ui.spec.js`): Start sichtbar, `#play` hat `hidden`; Klick auf Feintuning zeigt `#play` und versteckt die Startseite, Fokus liegt auf `#play-title`, nichts startet (`AudioContext`-Zähler 0, `#play-go` zeigt "Los"); Los zeigt `#play` und startet (`#play-go` zeigt "Stopp", `#play-now` zeigt einen Akkord der Folge innerhalb weniger Sekunden); `#play-back` zeigt die Startseite, `#go` zeigt "Stopp", `#now-chord` zeigt einen Akkord und `#to-play` ist sichtbar, ein Klick darauf zeigt wieder die Spielseite; im Stand ist `#to-play` nicht sichtbar; Tonart ändern über `#side-key-chips` (z. B. D) ändert die Akkordfolge in `#progression` und das Popover-Chip auf der Startseite zeigt D gedrückt (gemeinsamer Zustand); die bestehenden Tuning-Funktionen (Schlagwort-Chips, Länge, Akkorde hinzufügen/entfernen, Rad-Klick, Stummschalter) arbeiten auf der Spielseite wie vorher.
- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e/play-page.spec.js` – Expected: FAIL.
- [ ] **Step 3: Implement** den Umbau wie in den Interfaces: `index.html` neu gliedern, `tuning.js` auf die neuen Container umstellen (`state.page === 'play'` statt `state.tuningOpen` als Bedingung für Zeichnen und `renderTuning`), `app.js` `showPage` und die Verdrahtung, `key-scale.js` herauslösen, CSS für Kopfzeile, `.stage`-Raster und Blöcke (Leisten in diesem Task noch dauerhaft sichtbar, nebeneinander, ohne Einklappen), i18n-Schlüssel. Schreiben in den DOM weiter nur über `setText`/`setAttr`.
- [ ] **Step 4: Bestehende Tests anpassen** (`tests/e2e/ui.spec.js`, `tuning.spec.js`): Navigation über Hilfsfunktion `openPlayPage(page)`, IDs umbenennen, Erwartungen zu "Feintuning öffnet die zweite Ansicht" auf die Spielseite übertragen; keine Prüfung entfernen oder abschwächen, Änderungen im Bericht listen.
- [ ] **Step 5: Run** `npm test` und `npm run test:e2e` – Expected: alles PASS (die neuen Tests eingeschlossen), zweimal ohne Flake.
- [ ] **Step 6: Commit** `feat: start page and play page structure`

### Task 4: Einklappbare Seitenleisten

**Files:** Create `src/ui/sidebar.js`; Modify `src/ui/index.html`, `app.css`, `app.js`, `src/i18n/de.js`, `en.js`; Modify `tests/e2e/play-page.spec.js`

**Interfaces:**
- Consumes: `state.layout.sidebars`, `saveLayout` (Task 2/3).
- Produces: `initSidebar(opts: { side: 'left' | 'right', panel: HTMLElement, toggle: HTMLElement, isOpen(): boolean, setOpen(open: boolean): void, overlayQuery?: string /* Standard '(max-width: 1099px)' */ }): { render(): void }` in `sidebar.js`. Zwei Auslöser `#toggle-left`, `#toggle-right` (Knöpfe mit `aria-expanded`, `aria-controls`, sichtbarem Namen aus `ui.sidebarSound`/`ui.sidebarChords` plus Öffnen/Schließen-Zustand per `aria-expanded`, kein reiner Symbolknopf) in der Spielseite.
  - Breit (`overlayQuery` trifft nicht zu): geschlossene Leiste ist `hidden`, offene steht neben der Mitte und verdeckt das Griffbrett nicht (Mitte schrumpft).
  - Schmal: offene Leiste liegt als Schublade über der Mitte (links bzw. rechts angedockt), ob die überlagernde Leiste modal ist, entscheidet der Bauende (im Bericht nennen); es ist immer nur **eine** Leiste zugleich offen (Öffnen der einen schließt die andere und schreibt das ins Layout); Escape schließt die überlagernde Leiste, der Fokus kehrt zum Auslöser zurück; ein Klick daneben schließt sie nicht.
  - Öffnen verschiebt den Fokus auf die Leistenüberschrift (`tabindex="-1"`), Schließen auf den Auslöser. Jede Änderung ruft `setOpen` und damit `saveLayout`.
- Los auf der Startseite übernimmt den gemerkten Zustand (beim ersten Besuch beide zu); Feintuning öffnet beide und merkt sich das (Task 3 verdrahtet das schon über `showPage`).

- [ ] **Step 1: Write failing tests** (Playwright, `play-page.spec.js`, Breite 1280 und 800 und 360): beide Auslöser vorhanden mit `aria-expanded` passend zum Zustand; Klick öffnet/schließt (`hidden` der Leiste folgt `aria-expanded`); der gemerkte Zustand überlebt `page.reload()` und die Spielseite zeigt ihn nach Los; Feintuning öffnet beide (Breite 1280) und merkt es; beim ersten Besuch (leerer Speicher) öffnet Los die Spielseite mit beiden Leisten zu; bei 1280 px überschneidet die Begrenzung beider offenen Leisten nicht die des Blocks `fretboard` (Bounding-Boxes); bei 800 px öffnet die zweite Leiste die erste schließend, Escape schließt die offene und der Fokus liegt auf ihrem Auslöser; bei 360 px mit offener Leiste `document.documentElement.scrollWidth <= clientWidth`; mit `localStorage` das wirft (Init-Skript) und mit kaputtem gespeicherten JSON bleibt die Seite benutzbar (Review Focus 2, 4).
- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e/play-page.spec.js` – Expected: FAIL.
- [ ] **Step 3: Implement** `sidebar.js` und die Verdrahtung (Fokus, `aria-*`, `matchMedia` mit Änderungsabo, CSS für docked und überlagernd, `prefers-reduced-motion` ohne Animation), Layout-Schreiben nur bei echter Änderung.
- [ ] **Step 4: Run** `npm test` und `npm run test:e2e` – Expected: alles PASS, zweimal ohne Flake.
- [ ] **Step 5: Commit** `feat: collapsible sidebars`

### Task 5: Griffbrett-Block

**Files:** Create `src/ui/fretboard.js`; Modify `src/ui/index.html`, `app.css`, `app.js`, `tuning.js` (Aufruf in `render`), `src/i18n/de.js`, `en.js`; Modify `tests/e2e/play-page.spec.js`

**Interfaces:**
- Consumes: `fretboardNotes`, `nextDistinctChord`, `FRETS` (Task 1), `chordMidi`, `noteName`, `setText`/`setAttr`/`pressed`/`state`, `state.layout.labels` (Task 2/3).
- Produces: `createFretboard(container: HTMLElement): { update(view: FretboardView): void }` mit `FretboardView = { key: Key, scale: string, current: Chord | null, next: Chord | null, labels: 'names' | 'degrees' }`. `createFretboard` baut das SVG einmal (sechs Saiten, Bünde 0..15 mit echten Bundabständen nach 12tel-Teilung, Markierungspunkte bei 3, 5, 7, 9, 12 doppelt, 15, hohe e-Saite oben; je Position eine Gruppe `g.fret-note` mit `data-string`, `data-fret`, `data-role`); `update` ändert Klassen, Sichtbarkeit und Text nur bei Änderung. Der Zustand kommt in `render()`: `current = state.current?.chord ?? state.track.bars[0]?.chord`, `next = nextDistinctChord(state.track.bars, state.track.length, state.current?.bar ?? 0)`, der Block steckt in `section[data-view="fretboard"]`; sein Kopf enthält die Überschrift (`view.fretboard`) und den Schalter Namen/Stufen (`#labels-names`, `#labels-degrees`, `aria-pressed`, schreibt `state.layout.labels` und `saveLayout`).
  - Rollen (`data-role` an der Gruppe): `scale` (Ring in `--ink`), `current` (gefüllt `--accent`, Beschriftung hell), `next` (gefüllt `--accent2`), `both` (`--accent` gefüllt mit `--accent2`-Ring), zusätzlich `root` (Extraring `--accent`); Akkordtöne **außerhalb** der Leiter: gestrichelter Rand und blasse Füllung (Klasse `outside`). Zusätzlich sichtbare Legende mit Symbol und Text für jede Rolle (i18n `ui.legendScale`, `ui.legendCurrent`, `ui.legendRoot`, `ui.legendNext`, `ui.legendBoth`, `ui.legendOutside`).
  - `#play-next` in der Kopfzeile zeigt den folgenden Akkord (`ui.nextChord`: Name) oder bleibt leer, wenn es keinen gibt; er trägt die Sekundärfarbe.
  - Zugänglichkeit: `<svg role="img" aria-label=…>` (`ui.fretboardLabel`) plus ein Absatz `#fretboard-text` (visuell versteckt, aber lesbar), nur bei Änderung neu geschrieben: `ui.fretboardNow` ("Jetzt: {chord} ({notes})") und `ui.fretboardNext` ("Als Nächstes: {chord} ({notes})"), bei keinem folgenden Akkord nur der erste Teil; Notennamen via `noteName`.

- [ ] **Step 1: Write failing tests** (Playwright, de-DE und en-US, Spielseite, Zustand A-Moll Pentatonik, die Folge über `#progression` und `#add-chords` auf `Am Am Dm E` gebracht; im Stand): `.fret-note[data-string="5"][data-fret="5"]` hat `data-role` mit `both` und `root`, `…[data-fret="0"]` auf `data-string="5"` die Rolle `current` mit Text `E`; F (Saite 5, Bund 1) ist `next` und `outside`; eine Position außerhalb aller Rollen (Saite 5, Bund 2) ist nicht sichtbar; Klick auf `#labels-degrees` zeigt `5` statt `E` an Saite 5 Bund 0, `aria-pressed` wechselt, die Wahl überlebt `page.reload()`; beim Abspielen mit schnellem Tempo (Stil-Schnellwahl und Tempo 200) wechselt `data-role` bei den Akkordwechseln (Takt 2 → `current` an den Dm-Tönen) und `#play-next` zeigt `E` bzw. `Am`; mit einer Folge aus einem einzigen Akkord ist `#play-next` leer, `#fretboard-text` enthält nur "Jetzt" und kein Fehler; c-Moll zeigt `Bb`-Notennamen und kein `A#`; Sprachwechsel auf Englisch ändert Legende, Beschriftung und `#fretboard-text`, kein sichtbarer Schlüsselname (Regex wie in `ui.spec.js`, auch `aria-label`); `#fretboard-text` wird bei Takten ohne Akkordwechsel nicht neu geschrieben (MutationObserver zählt 0 Änderungen über zwei Takte bei gleichem Akkord, z. B. `Am Am`) ; kein Konsolenfehler.
- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e/play-page.spec.js` – Expected: FAIL.
- [ ] **Step 3: Implement** `fretboard.js` und die Verdrahtung wie in den Interfaces (Farben und Formen über CSS-Variablen und Klassen, kein `innerHTML` mit dynamischem Text, SVG-Elemente mit `createElementNS`).
- [ ] **Step 4: Run** `npm test` und `npm run test:e2e` – Expected: alles PASS, zweimal ohne Flake.
- [ ] **Step 5: Commit** `feat: fretboard block`

### Task 6: Ansichten ein- und ausblenden

**Files:** Create `src/ui/blocks.js`; Modify `src/ui/index.html`, `app.js`, `tuning.js`, `app.css`, `src/i18n/de.js`, `en.js`; Modify `tests/e2e/play-page.spec.js`

**Interfaces:**
- Consumes: `state.layout.views` (Task 2), `section[data-view]` der Blöcke (Task 3, 5).
- Produces: `VIEWS: { id: string, hideable: boolean }[]` = `[{id:'fretboard',hideable:true},{id:'lanes',hideable:false},{id:'wheel',hideable:true}]` in `blocks.js`; `initViews(container: HTMLElement, hooks: { isVisible(id: string): boolean, setVisible(id: string, on: boolean): void }): { render(): void }`, das für jede ausblendbare Ansicht in `container` (`#views` in der rechten Leiste, Überschrift `ui.views`, de "Ansichten", en "Views") einen Kontrollkasten mit Beschriftung `view.<id>` baut; die Blöcke bekommen `hidden`, wenn ausgeblendet, und werden danach neu gezeichnet (Canvas-Blöcke zeichnen nur, wenn sichtbar). Der Verlauf-Block ist nie ausblendbar. Ein neuer Eintrag in `VIEWS` erzeugt ohne weitere Änderung den Schalter und das Ausblenden.

- [ ] **Step 1: Write failing tests**: in der rechten Leiste gibt es Kontrollkästen für Griffbrett und Akkordrad und keinen für den Verlauf; Abwählen setzt `hidden` am Block (nicht im Zugänglichkeitsbaum, `toBeHidden`), der Verlauf-Block mit den Stummschaltern bleibt immer sichtbar; die Wahl überlebt `page.reload()`; Wiedereinblenden des Akkordrads zeichnet das Canvas neu (Pixeldaten nicht leer) und ein Rad-Klick fügt weiter einen Akkord hinzu; Griffbrett ausgeblendet erzeugt keinen Fehler beim Taktwechsel; ein Node-Test für `blocks.js` (reines `VIEWS`) prüft, dass `lanes` nicht ausblendbar ist und alle `id`s mit `section[data-view]` im HTML übereinstimmen (Datei lesen); gespeichertes `views.lanes=false` ändert nichts (Task 2).
- [ ] **Step 2: Run** `npm test` und `npm run test:e2e -- tests/e2e/play-page.spec.js` – Expected: FAIL.
- [ ] **Step 3: Implement** `blocks.js` und die Verdrahtung; Zeichnen der Canvas-Blöcke nur bei Sichtbarkeit (das `ResizeObserver`-Zeichnen und `drawCanvases` in `tuning.js` prüfen `hidden`).
- [ ] **Step 4: Run** `npm test` und `npm run test:e2e` – Expected: alles PASS, zweimal ohne Flake.
- [ ] **Step 5: Commit** `feat: show and hide views`

### Task 7: Gesamtdurchgang und Doku

**Files:** Modify `tests/e2e/play-page.spec.js`, `README.md`, `docs/interface.md` (nur falls dort die Oberfläche beschrieben wird)

**Interfaces:** keine neuen.

- [ ] **Step 1: Write the tests** (Gesamtdurchgang, de-DE und en-US): Ablauf Start → Los → Spielseite mit laufendem Griffbrett (Rollen wechseln beim Takt), zurück zur Startseite mit Stopp, "Zur Spielseite", Stopp; mit offener Leiste und laufender Wiedergabe Sprachwechsel auf beiden Seiten ohne sichtbaren Schlüsselnamen (alle Textknoten und `aria-label`, `title`, SVG-Text) und ohne Fokusverlust auf der Leiste; Akkordwechsel bei offener Leiste schreibt keine Knoten der Leiste um (MutationObserver-Zähler 0 über zwei Takte auf den Leistenbehältern); bei 360 px mit Schublade offen, Griffbrett sichtbar nach dem Schließen und kein horizontales Scrollen; alle drei Stile und alle vier Leitern (Pentatonik Moll, Pentatonik Dur, Blues, Dorisch) lassen sich in der Spielseite wählen, das Griffbrett zeigt in jeder Kombination mindestens einen Leiterton je Saite und wirft keinen Fehler; die bestehenden Prüfungen laufen unverändert.
- [ ] **Step 2: Run** `npm run test:e2e` – Expected: FAIL nur dort, wo noch eine Lücke ist (sonst PASS, dann ist der Test eine Absicherung); Lücken im Code schließen, jeweils mit einer Zeile im Bericht.
- [ ] **Step 3: Doku** `README.md` (Deutsch): neue Seitenstruktur in drei Sätzen (Startseite, Spielseite, Seitenleisten, Griffbrett, Namen/Stufen); Hinweis, dass der Leistenzustand im Browser gemerkt wird.
- [ ] **Step 4: Sichtprobe vorbereiten:** Playwright-Screenshots der Spielseite bei 1280 px (Leisten zu, beide offen) und 360 px (Schublade) laufend und im Stand in einen Ordner `task-7-shots` neben dem Bericht legen und beschreiben, nicht bewerten.
- [ ] **Step 5: Run** `npm test` und `npm run test:e2e` – Expected: alles PASS, dreimal ohne Flake.
- [ ] **Step 6: Commit** `test: full flow for start and play page, readme`
