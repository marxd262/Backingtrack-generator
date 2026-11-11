# Profil-Baum Umsetzungsplan

> **Für ausführende Agenten:** PFLICHT-UNTERFÄHIGKEIT: superpowers:subagent-driven-development (empfohlen) oder superpowers:executing-plans, Aufgabe für Aufgabe. Schritte haben Checkboxen (`- [ ]`).

**Ziel:** Das Profil-Menü bekommt einen Baum aus Ordnern (Werksprofile, Meine Profile), Profile mit wählbarem Inhalt (9 Teile), Export und Import nach Auswahl, Verschieben (Auswahl und Ziehen) und ein verträgliches Dateiformat; die Schnellauswahl in der Leiste entfällt.

**Architektur:** Reine Kernmodule ohne DOM (`profile-parts`, `profile` = Dateiformat, `profile-tree` = Baumoperationen), ein Speichermodul (`profile-store`) und mehrere kleine Oberflächenmodule (Baumansicht, Teile-Auswahl, Ziehen, Fenster). Alle Baumoperationen sind unveränderlich (liefern einen neuen Baum), sodass „Rückgängig“ nur einen alten Baum zurückholt. Laden wendet Teile auf eine Kopie der Sitzung an und prüft das Ergebnis wie einen Track; erst bei Erfolg wird die Sitzung ersetzt.

**Tech Stack:** Reines ES-Module-JavaScript, `node --test tests/core`, Playwright (`tests/e2e`), keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-11-11-profile-tree-design.md`

## Globale Randbedingungen

- Arbeit **auf dem aktuellen Zweig `feat/layer-registry`** (auf Wunsch des Nutzers kein neuer Zweig, nicht wechseln); ein Commit je Aufgabe, Nachricht endet mit der Zeile `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Kern (`src/core/`) bleibt rein: kein DOM, kein Audio. Kommentare im Code deutsch. Alle sichtbaren Texte in `src/i18n/de.js` **und** `en.js` (`tests/core/i18n.test.js` prüft die Gleichheit der Schlüssel). Schlüssel für das Menü beginnen mit `ui.profile`; Fehlercodes des Menüs mit `err.`.
- Grenzen (aus der Spec): Name höchstens **60** Zeichen, Tiefe höchstens **8**, höchstens **1000** Knoten, Import-Datei höchstens **5 MB** (`5_000_000` Zeichen/Bytes), Namen eindeutig je Ordner (ohne Unterschied Ordner/Profil, ohne Groß-/Kleinschreibung, nach Randleerzeichen-Entfernung).
- `tests/core/golden.test.js` bleibt unverändert grün. Zielgrößen mindestens 44 px, kein waagerechtes Scrollen bei 360 px, DOM nur bei Änderung schreiben (render läuft je Takt), Namen immer per `textContent` (nie `innerHTML`).
- Nie etwas Gespeichertes ohne „Rückgängig“ zerstören; Fehler beim Speichern (`localStorage` gesperrt/voll) werden gemeldet, nichts wirft.
- Playwright-Läufe: nur die jeweils betroffenen Spezifikationen mit `npx playwright test <dateien> --no-deps`; den ganzen Lauf (`npx playwright test`, etwa 17 Minuten) macht erst Aufgabe 9.
- Feste Kennungen für die Oberfläche (alle Aufgaben und Tests verwenden sie): `#profiles-btn`, `#profiles-pop`, `#profiles`, Baum `#profile-tree` (`role="tree"`) mit Zeilen `[role="treeitem"][data-key]`, rechtes Feld `#profile-panel`, Meldungszeile `#profile-message` (`role="status"`). Baum-Schlüssel (`data-key`): `session`, `factory` (Ordner Werksprofile), `factory:<stilId>`, `mine` (Ordner Meine Profile), sonst die Knoten-Id.
- Feste deutsche Beschriftungen (Knopf-/Feldnamen, `en` sinngemäß): „Aktuelle Sitzung“, „Werksprofile“, „Meine Profile“; Feld „Name des Profils“, Auswahl „Ordner“, Einklappbereich „Inhalt: Alles“ bzw. „Inhalt: n von 9“; Knöpfe „Speichern“, „Laden“, „Als Datei“, „Kopieren“, „Text importieren“, „Alles sichern“, „Kopie in Meine Profile speichern“, „Mit Sitzung überschreiben …“ (öffnet Teile-Auswahl) und „Überschreiben“ (bestätigt), „Umbenennen“ (öffnet Feld) und „OK“, „Verschieben nach …“ (öffnet Auswahl „Verschieben nach“) und „Verschieben“, „Löschen“, „Ja, löschen“, „Abbrechen“, „Neuer Unterordner“ und „Anlegen“, „Ordner als Datei“, „Ordner kopieren“, „In den Ordner importieren“, „Rückgängig“; Textfeld „Profil als Text“; Dateifeld „Datei importieren“. Die Kurzbeschreibung der Sitzung steht in `#profile-session-summary` als „Stil: Funk · A-Moll · 100 bpm“ (Stilname, Tonart, Tempo).

## Review-Fokus

1. Laden mit nur einigen Teilen lässt jeden anderen Zustand **unverändert** (Sitzung vorher/nachher Feld für Feld gleich), und ein ungültiges Ergebnis ändert gar nichts. (Aufgabe 1)
2. Feindliche Dateien (100 Ebenen tief, 10000 Knoten, `__proto__`/`constructor` als Schlüssel, Namen als Objekte, Zahlen als Strings, riesige Strings) werfen nie, verschmutzen keine Prototypen und überschreiten keine Grenze. (Aufgaben 1, 2, 3)
3. Auf Touch löst Scrollen im Baum nie ein Ziehen aus; ein kurzes Tippen wählt nur; ungültige Ziele nehmen nichts an; Esc/Loslassen außerhalb bricht ab. (Aufgabe 7)
4. Löschen eines Ordners mit Inhalt + „Rückgängig“ stellt den genauen Teilbaum wieder her; ist der gelöschte Eintrag gewählt, wandert die Auswahl zum Elternordner. (Aufgabe 6)
5. Ein defekter oder fremder gespeicherter Baum, gesperrter/voller Speicher und Namen mit `<b>`/Anführungszeichen bringen die Oberfläche nicht durcheinander und gehen nicht verloren. (Aufgaben 4, 5)

---

### Task 1: Die 9 Teile (Kern)

**Dateien:**
- Erstellen: `src/core/profile-parts.js`, `tests/core/profile-parts.test.js`
- Ändern: `src/core/music.js` (Export `SCALE_MODE`), `src/ui/state.js:15` (importiert `SCALE_MODE` von dort, statt es selbst zu definieren; weiter exportiert)

**Schnittstellen:**
- Erzeugt (alles in `src/core/profile-parts.js`):
  - `PART_IDS = ['harmony','tempo','rhythm','style','sound','voices','layers','mixer','variant']` (eingefroren, Reihenfolge der Oberfläche); `PART_PRESETS = { all: PART_IDS, sound: ['sound','voices','mixer'], rhythm: ['tempo','rhythm'], none: [] }`.
  - Sitzung (`Session`) = `{ track, scale, style, chordColor, chordColorFromStyle, mix }` (die Form der Oberflächenzustands in `src/ui/state.js`); `Parts` = Objekt, das für jeden **enthaltenen** Teil einen Schlüssel aus `PART_IDS` hat. Felder je Teil: `harmony` {key, scale, bars, chordColor, chordColorFromStyle, meter}; `tempo` {bpm}; `rhythm` {groove, complexity, length}; `style` {style, tags}; `sound` {timbre}; `voices` {voices, jobs}; `layers` {layers}; `mixer` {mix}; `variant` {seed, variety}. In `rhythm` bedeutet `groove: null` / `complexity: null` „Standard“, ein fehlendes Feld „nicht enthalten“.
  - `captureParts(session, ids = PART_IDS): Parts` (tiefe Kopie; nicht gesetzte Werte `groove`/`complexity` werden `null`).
  - `sanitizeParts(raw: unknown): { parts: Parts, skipped: number }` (wirft nie, siehe Regeln unten).
  - `applyParts(session, parts): { ok: true, session } | { ok: false, errors: {code, params}[] }` (rein; verändert die Eingabe nie; prüft den zusammengesetzten Track mit `validateTrack(normalizeTrack(track))`).
  - `partIdsOf(parts): string[]` (in `PART_IDS`-Reihenfolge), `mergeParts(base, over): Parts` (Teile aus `over` ersetzen die in `base`, andere bleiben).
- Verbraucht: `normalizeTrack`, `validateTrack` (`src/core/track.js`), `isValidKey` (`music.js`), `isMeter` (`grooves.js`), `isVoice` (`voices.js`), `isJob`, `LAYER_IDS` (`layers.js`), `STYLE_PRESETS` (`tags.js`), `CHORD_COLORS` (`harmony.js`), `SCALE_NAMES` (`music.js`), `DEFAULT_TIMBRE` (`timbre.js`), `MIX_NAMES`-Entsprechung `[...LAYER_IDS, 'master']`.

Regeln für `sanitizeParts` (aus der Spec, verbindlich): unbekannte Teile/Felder werden ignoriert; jedes Feld einzeln bereinigt und, wenn ungültig, weggelassen und in `skipped` gezählt; Einträge in `voices`, `jobs`, `layers`, `mix` und `timbre` einzeln (unbekannte Schicht/Gruppe/Feld, Wert außerhalb 0..1, unbekannte Stimme fallen einzeln weg); `tags` und `bars` sind je ein Wert; **`harmony` ist unteilbar**: fehlt `key`, `bars` oder `meter`, oder sind sie nicht gültig zusammen (Akkord nicht in der Tonart, `beats` ungleich Schläge der Taktart, geprüft mit `validateTrack` auf einem Teil-Track aus `key`, `bars`, `meter` und Standardwerten), fällt der ganze Teil weg (+1 skipped); `scale`, `chordColor`, `chordColorFromStyle` sind davon unabhängig. `seed`: ganze Zahl 0..4294967295; `bpm`, `length`: wie `validateTrack` sie erlaubt. Ein Teil ohne jedes brauchbare Feld fällt ganz weg. Eingaben, die keine einfachen Objekte sind (Arrays, Strings, Funktionen), und die Schlüssel `__proto__`, `constructor`, `prototype` zählen als ungültig.

Regeln für `applyParts`: Teilmengen gemischt wie in der Spec (Objekte `layers`, `mix`, `voices`, `jobs` je Schlüssel; `timbre`, `tags`, `bars` ersetzen im Ganzen; `timbre: {}` setzt zurück); `groove: null`/`complexity: null` entfernt die Eigenschaft aus dem Track; fehlende Teile bleiben unberührt, insbesondere ändert der Teil `style` **nur** `style` und `tags` (kein Umfärben, `chordColor`, `chordColorFromStyle`, `bars` unberührt); `harmony` setzt `key`, `meter`, `bars`, dazu `scale` (fehlt sie oder passt sie nicht zum Modus von `key`, gilt die Standardskala des Modus: `minor`→`minorPentatonic`, `major`→`majorPentatonic`, `dorian`→`dorian`), `chordColor`, `chordColorFromStyle` wenn vorhanden.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben** in `tests/core/profile-parts.test.js` (Sitzung als Fixture mit allen Feldern, `bars` nicht aliasen): `captureParts` liefert für `PART_IDS` alle 9 Teile als tiefe Kopie und `null` für nicht gesetztes `groove`/`complexity`; `applyParts(session, { tempo: { bpm: 77 } })` ändert nur `track.bpm` (Rest `deepEqual`, Eingabe eingefroren und unverändert); `rhythm: { groove: null }` entfernt `groove`, fehlt das Feld, bleibt es; `layers: { lead: false }`, `mixer: { drums: 0.3 }`, `voices`/`jobs` mit einem Schlüssel ändern nur diesen; `sound: { timbre: {} }` setzt zurück, `sound: { timbre: { master: { echo: 0 } } }` ersetzt im Ganzen; `style` allein: `style` und `tags` geändert, `chordColor`, `chordColorFromStyle`, `bars` gleich; `harmony` setzt alles inkl. Skalen-Rückfall; ungültiges Ergebnis (z. B. `tempo: { bpm: 5 }` über `applyParts`-Umweg ist durch `sanitizeParts` schon draußen, deshalb direkt `applyParts(session, { rhythm: { groove: 'gibtsnicht' } })`) liefert `{ ok: false, errors }` mit Code `badGroove` und lässt die Eingabe unverändert; `sanitizeParts`: unbekannter Teil/unbekanntes Feld ignoriert (`skipped` 0 bzw. nur gezählte ungültige), ungültiges Feld gezählt, `harmony` fällt ganz weg bei fehlerhaftem Takt/Akkord nicht in Tonart/falscher `beats`, `voices` mit einem unbekannten Eintrag behält die anderen, feindliche Eingaben (`'str'`, `[]`, `null`, `{ __proto__: … }` per `JSON.parse('{"__proto__":{"x":1}}')`, riesige Zahlen, `NaN`) werfen nicht und `({}).x` bleibt `undefined`; `partIdsOf`/`mergeParts`.
- [ ] **Schritt 2: Ausführen** `node --test tests/core/profile-parts.test.js` — Fehlschlag (Modul fehlt).
- [ ] **Schritt 3: Implementieren** (`src/core/profile-parts.js`, `SCALE_MODE` nach `music.js` verschieben).
- [ ] **Schritt 4: Ausführen** `node --test tests/core` — alles grün (Golden unverändert).
- [ ] **Schritt 5: Commit** `feat: the nine profile parts (capture, sanitize, apply)`.

### Task 2: Dateiformat (Kern)

**Dateien:**
- Ändern (neu schreiben): `src/core/profile.js`, `tests/core/profile.test.js` (die alten Tests der Datei, die das alte Format prüfen, werden ersetzt; die Speichertests wandern in Aufgabe 4)
- Verbraucht von: `src/ui/profiles.js` (alter Stand läuft bis Aufgabe 5 weiter; deshalb in dieser Aufgabe `makeProfile`/`parseProfile` **behalten** und als dünne Hüllen auf das neue Format legen, bis Aufgabe 5 sie entfernt)

**Schnittstellen:**
- Erzeugt (`src/core/profile.js`): `FORMAT_PROFILE = 'backingtrack-profile'`, `FORMAT_FOLDER = 'backingtrack-folder'`, `PROFILE_VERSION = 2`, `FOLDER_VERSION = 1`, `LIMITS = { name: 60, depth: 8, nodes: 1000, file: 5_000_000 }` (auch von Aufgabe 3 verwendet; dort importiert, nicht neu definiert).
  - `Node` (ohne Ids): `{ type: 'profile', name, parts } | { type: 'folder', name, items: Node[] }`.
  - `makeProfileFile(node): object`, `makeFolderFile(node): object` — schreiben alle bekannten Felder, **nie** Ids oder andere interne Felder.
  - `parseFile(input: string | object): { ok: true, node: Node, skipped: number } | { ok: false, errors: [{ code: 'badProfile', params: {} }] }` — wirft nie.
- Verbraucht: `sanitizeParts` (Aufgabe 1).

Regeln (Spec „Dateiformat“): unbekannte Felder überall ignoriert; `version` nur Information (fehlend oder höher: lesen, nicht ablehnen); abgelehnt nur: kein JSON/kein Objekt, unbekanntes `format`, Text länger als `LIMITS.file`, oder nach dem Bereinigen gar kein Inhalt (Profil ohne Teil; Ordner ohne einen Knoten); Namen: Randleerzeichen weg, höchstens 60 Zeichen, leer oder kein String → „Importiert“; im Ordner: Knoten ohne Inhalt, tiefer als 8 Ebenen oder über 1000 Knoten werden übersprungen und gezählt (`skipped`); Altformat (Commit 561bc10: `track`, `scale`, `style`, `chordColor`, `chordColorFromStyle`, `mix`, ohne `parts`) wird als Profil mit allen 9 Teilen gelesen (Name „Importiert“).

- [ ] **Schritt 1: Fehlschlagende Tests** in `tests/core/profile.test.js`: Rundlauf Profil und verschachtelter Ordner (`parseFile(JSON.stringify(makeFolderFile(n)))` ergibt gleichen Baum, ohne Ids); Altformat-Fixture (wörtlich das Objekt aus Commit 561bc10) ergibt 9 Teile; unbekannte Felder auf jeder Ebene (oberste Ebene, in Teilen, in Knoten); unbekannte Teile; `version` 99 und fehlend werden gelesen; abgelehnt werden `''`, `'kein json'`, `'[]'`, `'5'`, `{}`, `{format:'x'}`, `{format:FORMAT_PROFILE, parts:{}}`, ein Ordner ohne brauchbaren Knoten, Text über 5 MB; ungültiges Feld wird übersprungen und in `skipped` gezählt, der Rest bleibt; Namensregeln (Leerzeichen, 80 Zeichen → 60, `5`/`null`/`{}`/`''` → „Importiert“); 100 Ebenen tief → nur 8 bleiben, Rest in `skipped`; 10000 Knoten → höchstens 1000; `makeProfileFile({..., id:'x'})` enthält kein `id`; `JSON.parse('{"__proto__":{"polluted":1}}')` als Eingabe verschmutzt `Object.prototype` nicht.
- [ ] **Schritt 2: Ausführen** — Fehlschlag.
- [ ] **Schritt 3: Implementieren** (Hüllen `makeProfile`/`parseProfile` für den alten Stand, siehe Dateien).
- [ ] **Schritt 4: Ausführen** `node --test tests/core` und `npx playwright test tests/e2e/profiles.spec.js --no-deps` (der alte Stand läuft weiter) — grün.
- [ ] **Schritt 5: Commit** `feat: tolerant profile and folder file format`.

### Task 3: Baumoperationen (Kern)

**Dateien:**
- Erstellen: `src/core/profile-tree.js`, `tests/core/profile-tree.test.js`

**Schnittstellen:**
- Erzeugt (alle rein und unveränderlich, geben einen **neuen** Baum zurück; `makeId` ist ein optionaler Parameter für Tests, Standard erzeugt eine zufällige Zeichenkette, z. B. aus `crypto.randomUUID()` mit Rückfall auf Zufallszahlen):
  - Baum `Tree = { items: TreeNode[] }`, `TreeNode = { id, type: 'profile', name, parts } | { id, type: 'folder', name, items: TreeNode[] }`; `parentId === null` heißt „Meine Profile“ (oberste Ebene).
  - `newTree(): Tree`, `find(tree, id): { node, parent: TreeNode | null, depth: number } | null` (Tiefe der obersten Ebene = 1), `pathNames(tree, id): string[]`, `sortItems(items): TreeNode[]` (Ordner zuerst, dann Name; Vergleich `localeCompare(…, 'de', { numeric: true, sensitivity: 'base' })`), `countProfiles(node): number`, `countNodes(tree): number`.
  - `Result = { ok: true, tree, id?: string, … } | { ok: false, code }` mit Codes `nameEmpty`, `nameTaken`, `tooDeep`, `tooMany`, `invalidTarget`, `notFound`.
  - `addFolder(tree, parentId, name, makeId?): Result` (mit `id`), `addProfile(tree, parentId, name, parts, makeId?): Result`, `renameNode(tree, id, name): Result`, `removeNode(tree, id): Result` (mit dem entfernten Knoten als `removed` und dem Elternschlüssel als `parentId`), `overwriteParts(tree, id, parts): Result` (`mergeParts(alt, neu)`).
  - `moveTargets(tree, id): { id: string | null, label: string, depth: number }[]` (gültige Zielordner einschließlich `null` = Meine Profile; ohne den Knoten selbst und seine Unterordner, ohne Ziele, die die Tiefe über 8 trieben; `label` mit Einrückung durch Tiefe, Anzeige macht die Oberfläche), `canMove(tree, id, targetId): boolean`, `moveNode(tree, id, targetId): Result` (gleichnamiger Eintrag im Ziel bekommt „ (2)“, „ (3)“ …; mit `name`).
  - `importNode(tree, parentId, node: Node, makeId?): { ok: true, tree, rootId: string, ids: string[], profiles: number } | { ok: false, code }` — nimmt einen id-losen Knoten (aus `parseFile`) auf, vergibt Ids, hängt bei Namenskonflikten „ (2)“ an, beachtet Tiefe 8 und Gesamtzahl 1000 (zu tiefe/zu viele Knoten fallen weg; passt nicht einmal der Wurzelknoten, `tooDeep`/`tooMany`).
- Verbraucht: `LIMITS` (Aufgabe 2), `mergeParts` (Aufgabe 1).

Namensregel: `validName(tree, parentId, name, exceptId?)` (intern/exportiert) trimmt, höchstens 60 Zeichen, leer → `nameEmpty`, vergeben (ohne Unterschied Ordner/Profil, Groß-/Kleinschreibung egal, `exceptId` für Umbenennen) → `nameTaken`.

- [ ] **Schritt 1: Fehlschlagende Tests**: Anlegen mit Sortierung (Ordner zuerst, numerisch „Funk 2“ vor „Funk 10“); `nameTaken` für „funk“ gegen „Funk“, für Ordner gegen Profil, `nameEmpty` für `'  '`; Umbenennen auf den eigenen Namen erlaubt, auf einen fremden `nameTaken`; Tiefe: Ordner in Tiefe 8 anlegen ergibt `tooDeep`; `removeNode` liefert den genauen Teilbaum; `moveNode` Ordner in sich selbst/Unterordner → `invalidTarget` (`canMove` false), in Elternordner (keine Änderung) erlaubt, Tiefenüberlauf bei Teilbaum verboten, Namenskonflikt → „ (2)“; `moveTargets` ohne Selbst/Nachfahren; `importNode`: Konfliktnamen „ (2)“, Tiefe/Knotenlimit, `ids` vollständig und einmalig; **Unveränderlichkeit** (Eingabe-Baum eingefroren, nach jeder Operation unverändert); feindliche Namen (`'__proto__'`, `'<b>x</b>'`) werden als normale Namen behandelt.
- [ ] **Schritt 2: Ausführen** — Fehlschlag.
- [ ] **Schritt 3: Implementieren.**
- [ ] **Schritt 4: Ausführen** `node --test tests/core` — grün.
- [ ] **Schritt 5: Commit** `feat: profile tree operations`.

### Task 4: Speicher und Migration

**Dateien:**
- Ändern (neu schreiben): `src/ui/profile-store.js`; `tests/core/profile.test.js` (Speichertests dorthin verschieben und anpassen) oder neue Datei `tests/core/profile-store.test.js` (bevorzugt; die alten Speichertests aus `profile.test.js` entfernen)
- Die alten Exporte `loadProfiles`, `saveProfiles`, `upsertProfile`, `removeProfile`, `cleanName`, `MAX_NAME` bleiben in dieser Aufgabe **unverändert erhalten** (der alte Stand von `src/ui/profiles.js` braucht sie bis Aufgabe 5); die neuen Funktionen kommen daneben, Aufgabe 5 entfernt die alten. `tests/e2e/profiles.spec.js` muss nach dieser Aufgabe weiter grün sein.

**Schnittstellen:**
- Erzeugt (`src/ui/profile-store.js`): `PROFILES_KEY = 'backingtrack.profiles'`, `loadTree(storage): Tree`, `saveTree(storage, tree): boolean` (false bei gesperrt/voll/`null`), gespeicherte Form `{ "version": 2, "items": [ TreeNode ] }`.
- Verbraucht: `newTree`, `LIMITS` (Aufgaben 2 und 3), `sanitizeParts` (Aufgabe 1).

Regeln: `loadTree` ist tolerant und wirft nie: Speicher fehlt/wirft/kaputtes JSON/falsche Form → `newTree()`. Eine **alte flache Liste** (Array von `{ name, profile }` mit dem Profil im Format von Commit 561bc10, ggf. mit `track`…) wird in oberste Ebene („Meine Profile“) übernommen, jeweils mit allen 9 Teilen (über `parseFile`, Name aus dem Eintrag), ohne etwas zurückzuschreiben. Im neuen Format werden Knoten einzeln bereinigt (fehlende/doppelte Ids neu vergeben, Namen bereinigt, eindeutig gemacht, Grenzen eingehalten, defekte Knoten übersprungen, unbekannte Felder ignoriert).

- [ ] **Schritt 1: Fehlschlagende Tests** (`tests/core/profile-store.test.js`, Speicher-Attrappe wie in den bisherigen Tests): Rundlauf `saveTree`/`loadTree`; Altliste (Fixture mit zwei Einträgen im Format von Commit 561bc10) wandert in die oberste Ebene mit 9 Teilen, `setItem` wird beim Laden **nicht** aufgerufen; defekte Knoten werden übersprungen, gute bleiben; doppelte Ids/Namen werden bereinigt; Speicher `null`/`undefined`/werfend → leerer Baum bzw. `saveTree` false, nichts wirft; `'kaputt'`, `'{}'`, `'null'`, `'"x"'`, `'{"items":5}'` → leerer Baum.
- [ ] **Schritt 2: Ausführen** — Fehlschlag.
- [ ] **Schritt 3: Implementieren.**
- [ ] **Schritt 4: Ausführen** `node --test tests/core` und `npx playwright test tests/e2e/profiles.spec.js --no-deps` — grün.
- [ ] **Schritt 5: Commit** `feat: profile tree storage with migration of the flat list`.

### Task 5: Fenster, Baumansicht, Sitzung speichern/laden, Werksprofile laden

**Dateien:**
- Erstellen: `src/ui/profile-tree-view.js`, `src/ui/profile-parts-picker.js`, `src/ui/profile-factory.js`, `src/ui/profile-session.js`
- Ändern (neu schreiben): `src/ui/profiles.js`; `src/ui/index.html` (`#profiles-pop` bleibt, Inhalt `#profiles` wird vom Skript gebaut); `src/ui/app.css` (Profil-Abschnitt ersetzen); `src/ui/app.js` (`initProfiles({ render, restartIfPlaying, applyLive })`); `src/i18n/de.js`, `en.js`
- Ersetzen: `tests/e2e/profiles.spec.js` (neu, deckt diese Aufgabe ab); danach entfernt diese Aufgabe die Hüllen `makeProfile`/`parseProfile` aus `src/core/profile.js`

**Schnittstellen:**
- Erzeugt:
  - `profile-session.js`: `readSession(state): Session` (aus `state` der Oberfläche), `writeSession(state, session): void` (setzt `state.track`, `scale`, `style`, `chordColor`, `chordColorFromStyle`, `mix`; speichert `mix` über `saveMix`; löscht `state.tempoRef`, `state.notice`, `state.errors`), `summary(state, t): string` für `#profile-session-summary`.
  - `profile-factory.js`: `factoryProfiles(): { key: 'factory:<id>', styleId }[]` (aus `STYLE_PRESETS`, Reihenfolge wie dort), `factoryParts(styleId, meter): Parts` (`style` {style, tags (Kopie der Schlagworte des Stils)}, `tempo` {bpm: auf Taktart umgerechnet wie `applyStyle`}, `sound` {timbre: {}}).
  - `profile-parts-picker.js`: `createPartsPicker({ idPrefix, t }): { element, getIds(): string[], setIds(ids): void, render(): void }` — ein `<details>` mit Summary „Inhalt: Alles“/„Inhalt: n von 9“, darin 9 Kontrollkästchen mit Namen und Zeile Erklärung, und Knöpfe für `PART_PRESETS` („Alles“, „Nur Klang“, „Nur Rhythmus“, „Nichts“); eingeklappt, bis der Nutzer ihn öffnet.
  - `profile-tree-view.js`: `createTreeView(container, handlers): { render(rows), focusKey(key) }` mit Zeile `Row = { key, label, depth, kind: 'session'|'factory-folder'|'factory'|'folder'|'profile', expandable: boolean, expanded: boolean, selected: boolean, draggable: boolean }`; `handlers = { onSelect(key), onToggle(key), onKeyNav? }`. Flacher ARIA-Baum (`role="tree"`, Zeilen `role="treeitem"` mit `aria-level`, `aria-expanded`, `aria-selected`, ein Tabstopp/`tabindex` wandernd), Tasten: Auf/Ab, Rechts (aufklappen/erstes Kind), Links (zuklappen/Elternzeile), Pos1/Ende, Enter/Leertaste wählt. Beschriftungen per `textContent`; Zeilen nur ändern, wenn sich etwas ändert.
  - `profiles.js`: `initProfiles({ render, restartIfPlaying, applyLive }): () => void` (gibt die Render-Funktion zurück). Hält `tree` (aus `loadTree(layoutStorage)`), `selection` (Standard `'session'`), geöffnete Ordner (nur im Speicher; `mine` und `factory` zu Beginn offen) und `message`.
- Verbraucht: Aufgaben 1–4.

Verhalten dieser Aufgabe (die Panels für Profil/Ordner-Aktionen kommen in Aufgabe 6; hier erscheint für Profile und Ordner nur „Laden“ bzw. nichts):
- Fensterbreite `#profiles-pop`: `width: min(56rem, calc(100vw - 32px))`; ab Viewport-Breite `46rem` zwei Spalten (`grid-template-columns: minmax(15rem, 20rem) 1fr`), darunter untereinander (Baum zuerst); Baum scrollt für sich (`max-height` etwa `60vh`).
- Baum: Zeile „Aktuelle Sitzung“, Ordner „Werksprofile“ (9 Stile, nur lesen), Ordner „Meine Profile“ (`mine`) mit dem Baum (`sortItems`).
- Panel „Aktuelle Sitzung“: `#profile-session-summary`; „Name des Profils“, „Ordner“ (Auswahl aller Ordner einschließlich „Meine Profile“, eingerückt über `moveTargets`-ähnliche Liste: alle Ordner), Teile-Auswahl, „Speichern“ (`addProfile` → bei `nameTaken` Meldung mit Hinweis auf „Mit Sitzung überschreiben“; bei `nameEmpty` „Bitte einen Namen eingeben.“; nach Erfolg Auswahl auf das neue Profil, Speichern in `localStorage`, bei Fehlschlag Hinweis wie heute „gilt nur bis zum Neuladen“); Austausch für die Sitzung: „Als Datei“ (`backingtrack-profil-<Datum>.json`), „Kopieren“ (Text auch ins Feld „Profil als Text“, Zwischenablage mit Rückfall wie heute), „Text importieren“, Dateifeld „Datei importieren“ (Größe über 5 MB abgelehnt); Import legt den Knoten per `importNode` in den gewählten Ordner (Sitzung/Profil gewählt: „Meine Profile“; Profil gewählt: dessen Ordner), wählt ein einzelnes Profil aus, ändert bei Ordnern die Auswahl nicht (Meldung mit Anzahl), meldet `skipped`.
- Panel Werksprofil: „Laden“ ruft `applyStyle(id)` aus `state.js` und dann `applyLive({ patterns: true, tempo: true })` und `render()` — genau wie die bisherige Schnellauswahl; „Kopie in Meine Profile speichern“ → `addProfile(tree, null, <Stilname>, factoryParts(...))` (bei `nameTaken` mit „ (2)“); Austausch „Als Datei“/„Kopieren“ der `factoryParts`.
- Panel eigenes Profil (hier nur): „Laden“ → `applyParts(readSession(state), node.parts)`; bei `ok` `writeSession`, `restartIfPlaying()`, Meldung „Profil übernommen.“; bei Fehler Meldung aus `err.<code>` und **keine** Änderung.
- Alle neuen Texte in `de`/`en`; Fehlercode `err.badProfile` bleibt.

- [ ] **Schritt 1: Fehlschlagende e2e-Tests** (`tests/e2e/profiles.spec.js` neu): Fenster öffnet, Baum zeigt „Aktuelle Sitzung“, „Werksprofile“ (9 Stile), „Meine Profile“; Sitzung speichern (`Name des Profils` = „Test A“, Ordner „Meine Profile“) legt das Profil an und wählt es; Tempo ändern, Profil laden → Tempo wieder da; Teile-Auswahl eingeklappt, nach Öffnen 9 Kästchen, „Nur Klang“ speichert nur Klang-Teile (Beschriftung „Inhalt: 3 von 9“) und Laden lässt das Tempo unberührt; Werksprofil „Funk“ laden → Tempo 100 und `#profile-session-summary` zeigt „Stil: Funk“; Gleichnamig speichern → Meldung, Liste bleibt bei einem Eintrag; Tastatur: Pfeil ab/auf, Rechts/Links klappt Ordner; Namen mit `<b>x</b>` erscheinen als Text; Import eines kopierten Profils mit anderem Tempo wird in „Meine Profile“ aufgenommen und ausgewählt, Laden setzt das Tempo; Import von `kein json` zeigt die Fehlermeldung; Wiedergabe läuft beim Laden weiter; **1280 px**: zwei Spalten (Baum links, Panel rechts, Panel-Breite deutlich größer als der Baum) und Fenster nicht breiter als 56 rem; **360 px** (eigener Kontext wie im bisherigen Test): kein waagerechtes Scrollen, Knöpfe mindestens 44 px; defekter gespeicherter Baum (`localStorage` vor dem Laden mit Müll belegt) zeigt einen leeren Baum ohne Konsolenfehler.
- [ ] **Schritt 2: Ausführen** `npx playwright test tests/e2e/profiles.spec.js --no-deps` — Fehlschlag.
- [ ] **Schritt 3: Implementieren** (Module oben; `profiles.js` verwendet nur noch `profile-tree`/`profile-store`/`profile-parts`/`profile`).
- [ ] **Schritt 4: Ausführen** `node --test tests/core`; `npx playwright test tests/e2e/profiles.spec.js tests/e2e/play-page.spec.js tests/e2e/layout-stability.spec.js tests/e2e/mixer.spec.js --no-deps` — grün.
- [ ] **Schritt 5: Commit** `feat: profile window with tree, parts picker, factory profiles`.

### Task 6: Profil- und Ordner-Aktionen, Export/Import nach Auswahl, Alles sichern, Rückgängig

**Dateien:**
- Ändern: `src/ui/profiles.js` (und bei Bedarf neue kleine Module in `src/ui/`), `src/ui/app.css`, `src/i18n/de.js`, `en.js`, `tests/e2e/profiles.spec.js`

**Schnittstellen:**
- Verbraucht: Aufgaben 3, 5. Erzeugt keine neuen öffentlichen Module. Intern: `undo = { tree, selection } | null` (nur die jeweils letzte Aktion).

Verhalten:
- Panel **eigenes Profil**: „Laden“; „Mit Sitzung überschreiben …“ öffnet die Teile-Auswahl (Haken beginnen mit den Teilen des Profils; fehlende Teile lassen sich dazuhaken) und „Überschreiben“ bestätigt: `overwriteParts` mit `captureParts(session, ids)` — nicht angehakte Teile des Profils **bleiben**; „Umbenennen“ (Feld + „OK“; `nameTaken`/`nameEmpty` mit Meldung, nichts ersetzt), „Löschen“; Zeile „Inhalt: …“ (Namen der Teile); Austausch „Als Datei“ (`makeProfileFile`), „Kopieren“.
- Panel **Ordner** (auch `mine`, dort ohne Umbenennen/Löschen/Verschieben): „Neuer Unterordner“ (Feld + „Anlegen“), „Umbenennen“, „Löschen“ (leer: sofort; nicht leer: Rückfrage „Ordner mit n Einträgen löschen?“ mit „Ja, löschen“/„Abbrechen“), Zeile „n Profile, m Unterordner“; Austausch „Ordner als Datei“ (`makeFolderFile`), „Ordner kopieren“, „In den Ordner importieren“ (Textfeld oder Dateifeld; das Ziel ist dieser Ordner). Bei `mine` heißt die Datei „Meine Profile“.
- „Alles sichern“ ganz unten, immer sichtbar: Datei mit `makeFolderFile` der obersten Ebene („Meine Profile“).
- Export folgt der Auswahl: Sitzung → Profil „Aktuelle Sitzung“ mit allen 9 Teilen; Werksprofil → `factoryParts`; Profil → das Profil; Ordner → der Ordner samt Inhalt.
- **Rückgängig** (Knopf in der Meldungszeile, erscheint nach Löschen, Überschreiben, Import; Verschieben kommt in Aufgabe 7): stellt Baum **und** Auswahl der letzten Aktion wieder her und speichert; verschwindet bei der nächsten solchen Aktion. Nie die Sitzung.
- Auswahl nach Löschen: Elternordner (oder `mine`); Auswahl eines nicht mehr vorhandenen Schlüssels fällt auf `session` zurück.

- [ ] **Schritt 1: Fehlschlagende e2e-Tests**: Überschreiben mit nur „Nur Rhythmus“ ändert nur diese Teile, Rest des Profils bleibt (Zeile „Inhalt: …“ unverändert plus Rhythmus); Umbenennen, `nameTaken`, `nameEmpty`; Löschen eines Profils → „Rückgängig“ stellt es her; Ordner anlegen, verschachteln bis Tiefe 8 (9. Ebene wird abgelehnt mit Meldung), Löschen mit Inhalt fragt nach, „Abbrechen“ ändert nichts, „Ja, löschen“ + „Rückgängig“ stellt den genauen Teilbaum wieder her, Auswahl wandert zum Elternordner; Export: Sitzung ausgewählt → Text enthält `backingtrack-profile` und 9 Teile; Profil ausgewählt → Text enthält nur dessen Teile; Ordner ausgewählt → `backingtrack-folder` mit Unterordnern; „Alles sichern“ lädt eine Datei herunter (`page.waitForEvent('download')`), die als `backingtrack-folder` mit allen Einträgen lesbar ist; Import eines gesicherten Ordners in einen anderen Ordner (Datei über `setInputFiles`) legt die Struktur an, bei gleichen Namen „ (2)“, Auswahl bleibt, Meldung nennt die Zahl; Import eines einzelnen Profils wählt es aus; Import mit unbekannten Zusatzfeldern funktioniert; Werksprofil kopieren → Profil „Funk“ (zweites Mal „Funk (2)“) mit Teilen `style`, `tempo`, `sound`.
- [ ] **Schritt 2: Ausführen** — Fehlschlag.
- [ ] **Schritt 3: Implementieren.**
- [ ] **Schritt 4: Ausführen** `npx playwright test tests/e2e/profiles.spec.js --no-deps` und `node --test tests/core` — grün.
- [ ] **Schritt 5: Commit** `feat: profile and folder actions, export and import by selection, undo`.

### Task 7: Verschieben (Auswahl und Ziehen)

**Dateien:**
- Erstellen: `src/ui/profile-drag.js`
- Ändern: `src/ui/profiles.js`, `src/ui/profile-tree-view.js` (Griff `⋮⋮` in ziehbaren Zeilen), `src/ui/app.css`, `src/i18n/de.js`, `en.js`, `tests/e2e/profiles.spec.js`

**Schnittstellen:**
- Erzeugt (`src/ui/profile-drag.js`): `LONG_PRESS_MS = 400`, `MOVE_TOLERANCE_PX = 8`, `attachDrag(container, { canDrag(key): boolean, canDrop(sourceKey, targetKey): boolean, onDrop(sourceKey, targetKey): void, onCancel?(): void }): () => void` (gibt eine Aufräumfunktion zurück). Pointer Events (kein HTML5-Drag-and-drop). Griff = Element `.drag-handle` innerhalb einer Zeile `[data-key]`. Maus: Ziehen beginnt nach Bewegung über `MOVE_TOLERANCE_PX`; Touch/Stift: nach `LONG_PRESS_MS` Halten ohne Bewegung über `MOVE_TOLERANCE_PX` (vorher Bewegung = Abbruch und normales Scrollen, `touch-action: none` **nur** am Griff), kurzes Vibrieren falls `navigator.vibrate` da; während des Ziehens: Zielzeile unter dem Zeiger wird markiert (`data-drop="ok"` oder `"no"`), ungültige Ziele nehmen nichts an, am oberen/unteren Rand des Baums scrollt dieser mit; Loslassen auf gültigem Ziel ruft `onDrop`; Loslassen außerhalb, auf ungültigem Ziel, `Escape` oder `pointercancel` ruft nur `onCancel`.
- Verbraucht: `canMove`, `moveNode`, `moveTargets` (Aufgabe 3), Baumansicht (Aufgabe 5).

Verhalten:
- „Verschieben nach …“ (Profil- und Ordnerpanel, nicht für `mine` und Werksprofile): Auswahl „Verschieben nach“ mit allen gültigen Zielen aus `moveTargets` (Einrückung im Text, Ziel „Meine Profile“ für `null`), Knopf „Verschieben“; Ergebnis mit `moveNode`; Namenskonflikt „ (2)“ wird gemeldet; „Rückgängig“ wie in Aufgabe 6.
- Ziehen: `canDrag` nur für eigene Profile und Ordner (nicht `session`, `factory*`, `mine`); `canDrop(source, target)`: Ziel ist ein Ordner (`mine` oder eigener Ordner) und `canMove(tree, source, target)`; Fallen ins gleiche Elternziel ohne Wirkung wird als ungültig behandelt. Nach erfolgreichem Verschieben bleibt die Auswahl auf dem verschobenen Eintrag und der Ziel-Ordner ist offen.

- [ ] **Schritt 1: Fehlschlagende e2e-Tests** (Touch über synthetische `PointerEvent`s per `dispatchEvent` mit `pointerType: 'touch'` und gefälschter Zeitsteuerung durch echtes Warten > 400 ms; Maus über `page.mouse`): „Verschieben nach …“ verschiebt Profil und Ordner, ungültige Ziele (selbst, Nachfahren, bei Tiefe 8) fehlen in der Auswahl, „Rückgängig“ stellt her; Ziehen mit der Maus am Griff in einen Ordner verschiebt; Ziehen in sich selbst/Nachfahren/Werksprofile: Ziel markiert `data-drop="no"`, nach Loslassen nichts verändert; `Escape` mitten im Ziehen bricht ab; **Touch:** Berühren des Griffs und Bewegen vor 400 ms scrollt (kein Ziehen, Baum `scrollTop` kann sich ändern), kurzes Tippen wählt nur die Zeile, Halten von 400+ ms ohne Bewegung und dann Bewegen zieht und kann auf einem Ordner ablegen; Loslassen außerhalb bricht ab; Tastatur: der Griff ist nicht nötig (Verschieben nach … genügt); Namenskonflikt beim Ablegen → „ (2)“.
- [ ] **Schritt 2: Ausführen** — Fehlschlag.
- [ ] **Schritt 3: Implementieren.**
- [ ] **Schritt 4: Ausführen** `npx playwright test tests/e2e/profiles.spec.js --no-deps` und `node --test tests/core` — grün.
- [ ] **Schritt 5: Commit** `feat: move profiles by selection and by dragging with touch safeguards`.

### Task 8: Schnellauswahl entfernen, Spezifikationen umstellen

**Dateien:**
- Ändern: `src/ui/index.html` (Zeilen mit `quick-title`/`quick-pick` entfernen; der Abschnitt „Stil“ der Leiste „Klang“ behält die Schlagworte), `src/ui/tuning.js` (Schleife über `STYLE_PRESETS` für `#quick-pick` entfernen, ungenutzte Importe aufräumen), `src/i18n/de.js`, `en.js` (`ui.quickPick` entfernen), `src/ui/render-harness.html` falls die Schnellauswahl dort vorkommt
- Erstellen: `tests/e2e/style-helpers.js` — `chooseStyle(page, id)` (öffnet `#profiles-btn`, wählt im Baum „Werksprofile“ → Stilname, klickt „Laden“, schließt das Fenster mit `Escape`/`hidePopover`) und `currentStyle(page): Promise<string>` (liest die Stil-Kennung aus `#profile-session-summary` nach Öffnen des Fensters; Stilnamen über `STYLE_PRESETS` und die deutschen Namen zurückführen)
- Ändern (umstellen): `tests/e2e/flow.spec.js`, `fretboard.spec.js`, `groups.spec.js` (statt `#quick-pick` jetzt `#tags` im Abschnitt `style`), `jobs-ui.spec.js`, `rhythm.spec.js`, `style-color.spec.js`, `timbre.spec.js`, `tuning.spec.js`, `voices-ui.spec.js` (nur falls es die Schnellauswahl benutzt) — Klicks auf `#quick-pick [data-style=…]` werden zu `chooseStyle`, Prüfungen `aria-pressed` zu `currentStyle`; Tests, die ausdrücklich die Schnellauswahl prüfen (z. B. die Zahl der Chips in `tuning.spec.js`), entfallen oder prüfen stattdessen die 9 Werksprofile im Baum.

**Schnittstellen:** Verbraucht Aufgabe 5/6 (Werksprofil „Laden“). Erzeugt `tests/e2e/style-helpers.js` (siehe oben). Die Stil-Karten der **Startseite** (`#style-cards`) bleiben unverändert.

- [ ] **Schritt 1: Fehlschlagender Test**: neue Spezifikation `tests/e2e/quick-pick-removed.spec.js` (oder Zeile in `profiles.spec.js`): `#quick-pick` existiert nicht, die Leiste „Klang“ hat den Abschnitt „Stil“ mit den Schlagworten, `chooseStyle(page, 'blues')` setzt das Tempo auf das `bpm` des Stils aus `STYLE_PRESETS` und `currentStyle` meldet „Blues“.
- [ ] **Schritt 2: Ausführen** — Fehlschlag.
- [ ] **Schritt 3: Implementieren** (Entfernen, Helfer, Umstellen aller genannten Spezifikationen; `grep -rn quick-pick src tests` darf nichts mehr finden).
- [ ] **Schritt 4: Ausführen** die umgestellten Spezifikationen: `npx playwright test tests/e2e/flow.spec.js tests/e2e/fretboard.spec.js tests/e2e/groups.spec.js tests/e2e/jobs-ui.spec.js tests/e2e/rhythm.spec.js tests/e2e/style-color.spec.js tests/e2e/timbre.spec.js tests/e2e/tuning.spec.js tests/e2e/voices-ui.spec.js tests/e2e/profiles.spec.js --no-deps` und `node --test tests/core` — grün.
- [ ] **Schritt 5: Commit** `refactor: remove the quick pick, styles are factory profiles`.

### Task 9: Doku und Gesamtlauf

**Dateien:**
- Ändern: `README.md` (Abschnitt „Profiles“ neu: Baum, Werksprofile, Ordner, Inhalt, Export/Import nach Auswahl, „Alles sichern“, Rückgängig, Verschieben; Schnellauswahl entfällt), `docs/interface.md` (Abschnitt „Profile (Export, Import, eigene Profile)“ ersetzen: Profil-Datei Version 2 mit `parts`, Ordner-Datei, die 9 Teile mit ihren Feldern und der Bedeutung von `null`, Einlese-Regeln, Grenzen, Speicherformat `{version:2,items}` und Migration, Rückgängig-Umfang)

- [ ] **Schritt 1: Doku schreiben.**
- [ ] **Schritt 2: Gesamtlauf**: `node --test tests/core` und `npx playwright test` (ganze Suite, etwa 17 Minuten, im Hintergrund mit langem Timeout, kein kurzes Abfragen); Zahlen berichten; echte Regressionen beheben (häufigste Ursache: Tests, die noch die Schnellauswahl oder die alte Fensterbreite annehmen).
- [ ] **Schritt 3: Größen-/Sanity-Check**: Fenster bei 1280 px und 360 px per Playwright-Skript im Scratchpad (nicht im Repo) öffnen, Baum mit 3 Ordnern/6 Profilen füllen, keine Konsolenfehler.
- [ ] **Schritt 4: Commit** `docs: profile tree`.

---

## Selbstprüfung

- **Spec-Abdeckung:** Baum und Layout (Aufgaben 5, 7), Teile und Laden (1), Werksprofile (5, 8), Dateiformat (2), Speicher/Migration (4), Import-Verhalten (5, 6), Verschieben (7), Bedienbarkeit (5), Schnellauswahl entfernen (8), „Überschreiben“, Namen, Rückgängig (6), Tests (alle), Doku (9). Lücke bewusst: kein ziehbarer Trenner, keine manuelle Reihenfolge, kein Teil-Entfernen (Nicht-Ziele der Spec).
- **Typkonsistenz:** `Parts`, `Session`, `Node` (id-los, Aufgabe 2), `TreeNode` (mit Id, Aufgabe 3), `Tree`, `LIMITS`, `PART_IDS`, `captureParts`/`applyParts`/`mergeParts`/`sanitizeParts`, `loadTree`/`saveTree`, `importNode`, `moveNode`/`canMove`/`moveTargets`, `createTreeView`, `createPartsPicker`, `attachDrag` heißen in allen Aufgaben gleich.
- **Verhältnis:** Der Plan beschreibt Schnittstellen, Regeln und Tests, keine Funktionskörper.
