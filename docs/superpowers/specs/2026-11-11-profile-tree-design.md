# Profile-Menü: Baum, Ordner, wählbarer Inhalt (Design)

Abgestimmt im Chat am 2026-11-11 mit dem Plan-Tool (Entwürfe: `.superpowers/brainstorm/574-1794404132/content/`). Folgt auf das Profil-Menü aus Commit 561bc10 (`src/core/profile.js`, `src/ui/profile-store.js`, `src/ui/profiles.js`), das die ganze Sitzung als Profil speichert, lädt, exportiert und importiert.

## Absicht und Warum

Das heutige Profil-Menü ist eine flache Liste, ein Profil ist immer die ganze Sitzung, und die Stile (Funk, Psychedelic …) liegen getrennt als „Schnellauswahl“ in der linken Leiste. Der Nutzer will (1) Profile in beliebig tiefen Ordnern ordnen, (2) pro Profil festlegen, **was** es enthält, sodass beim Laden nur diese Werte die aktuelle Auswahl überschreiben und der Rest unberührt bleibt, (3) ganze Ordner exportieren und importieren, (4) die Stile als „Werksprofile“ im selben Baum finden und die platzfressende Schnellauswahl loswerden. Ein Nebenzweck bleibt: den Zustand exportieren und jemandem schicken („was höre ich da?“).

## Ziele

1. **Baum** im Profil-Fenster: erste Zeile „Aktuelle Sitzung“, Ordner „Werksprofile“ (nur lesen) mit den 9 Stilen, Ordner „Meine Profile“ mit beliebig verschachtelten eigenen Ordnern und Profilen (Tiefe höchstens 8).
2. **Breites Fenster:** Baum links (fest etwa 18 rem, mindestens 15, höchstens 20), Details und Aktionen rechts; das Fenster ist höchstens 56 rem breit. **Schmal** (unter etwa 44 rem Fensterbreite): untereinander, Baum zuerst.
3. **Inhalt wählbar:** 9 Teile (siehe unten). Beim Speichern angehakt = im Profil. Beim Laden wird nur überschrieben, was im Profil steht.
4. **Verschieben** per „Verschieben nach …“ (immer) und per Ziehen am Griff (Maus, Touch, Stift) mit Absicherungen.
5. **Export/Import** nach Auswahl: nichts gewählt bzw. „Aktuelle Sitzung“ = die Sitzung, Profil = das Profil, Ordner = der Ordner samt allem darin; dazu „Alles sichern“ (alles unter „Meine Profile“).
6. **Dateiformat** mit größtmöglicher Verträglichkeit zu sich selbst: ein neues Feld darf den Import nie kaputt machen, es fehlt dann einfach.
7. **Schnellauswahl entfernen** (die Chips „Funk, Psychedelic …“ in der Leiste „Klang“), die Stile bleiben über die Werksprofile erreichbar.

## Nicht-Ziele

- Konten, Synchronisation zwischen Geräten, Profile im Repository.
- Manuelle Reihenfolge innerhalb eines Ordners (der Baum ist nach Name sortiert, Ordner zuerst).
- Ein ziehbarer Trenner zwischen Baum und Rechts.
- Die Stil-Karten im Popover „Stil“ der **Startseite** (die Startseite hat keinen Profil-Knopf; sie bleiben).

## Anti-Ziele (Fehlschlag, auch wenn es technisch läuft)

- Eigene Profile gehen verloren (durch Fehler beim Speichern, Importieren, Verschieben, Migration). Nach jedem Löschen/Verschieben/Überschreiben/Importieren gibt es „Rückgängig“.
- Ein Import oder Laden lässt die Sitzung halb verändert zurück. Entweder ganz oder gar nicht.
- Ein neues Feld, ein unbekannter Teil oder eine neuere Version macht einen Import unbrauchbar.
- Drag-and-drop ist der einzige Weg, etwas zu verschieben, oder es löst beim Scrollen auf dem Telefon aus.
- Werksprofile lassen sich ändern oder löschen.

## Entscheidungen des Nutzers

- Die 9 Teile bleiben so (siehe unten). Die Auswahl des Inhalts nicht dauerhaft einblenden.
- Das gewählte Ding bestimmt Export und Rechts-Feld; „Aktuelle Sitzung“ ist die Auswahl, wenn nichts anderes gewählt ist.
- Beim Laden eines Werksprofils werden die Klangregler zurückgesetzt, wie die Schnellauswahl es heute tut.
- Nach einem Import: ein einzelnes Profil wird direkt ausgewählt; bei mehreren (Ordner) wird nur geladen, das heißt in den Baum aufgenommen.
- Alte Dateien (Format von Commit 561bc10) bleiben importierbar.
- Schnellauswahl in der Leiste entfernen.

## Aufbau des Fensters

Rechts je nach Auswahl (Entwurf im Plan-Tool, Seite „Inhalt und Felder“):

| Auswahl | Rechts |
|---|---|
| Aktuelle Sitzung | Kurzbeschreibung (Tonart, Tempo, Stil); „Als Profil speichern“ (Name, Ordner-Auswahl, Inhalt als eingeklappte Zeile „Inhalt: Alles ▾“); Austausch: Datei, Kopieren, Textfeld, Import |
| Werksprofil | Laden; „Kopie in Meine Profile speichern“; Austausch: Datei, Kopieren |
| Eigenes Profil | Laden; „Mit Sitzung überschreiben …“ (mit Inhaltsauswahl); Umbenennen; Verschieben nach …; Löschen; Inhalt als Textzeile; Austausch: Datei, Kopieren |
| Ordner | Neuer Unterordner; Umbenennen; Verschieben nach …; Löschen (Rückfrage, wenn nicht leer); Ordner als Datei/Kopieren; In den Ordner importieren |

„Alles sichern“ steht ganz unten und ist immer sichtbar. Der **Inhalt** (die 9 Haken) erscheint nur beim Speichern und Überschreiben, eingeklappt als eine Zeile; bei vorhandenen Profilen nur als Textzeile („Inhalt: Klangregler, Stimmen, Schichten“).

Die Schnellauswahl fällt weg: Der Abschnitt „Stil“ der Leiste „Klang“ behält die Schlagworte. Wie das aktuelle Stil-Merkmal angezeigt wird, entscheidet der Bauende (Vorschlag: „Stil: Funk“ in der Zeile „Aktuelle Sitzung“).

## Inhalt eines Profils: 9 Teile

Jeder Teil ist ein eigenes Objekt unter `parts`. **Fehlt ein Teil, ist er nicht im Profil und wird beim Laden nicht angefasst.** Innerhalb eines Teils bedeutet `null` ausdrücklich „Standard“ (Wert zurücksetzen), ein fehlendes Feld „nicht enthalten“.

| Teil (`parts.…`) | Felder |
|---|---|
| `harmony` Tonart, Akkorde & Taktart | `key` {root, mode}, `scale`, `bars`, `chordColor`, `chordColorFromStyle`, `meter` |
| `tempo` | `bpm` |
| `rhythm` Rhythmus & Länge | `groove` (Id oder `null`), `complexity` (Zahl oder `null`), `length` |
| `style` Stil & Schlagworte | `style` (Id), `tags` |
| `sound` Klangregler | `timbre` (die Regler-Überschreibungen; `{}` setzt zurück) |
| `voices` Stimmen & Aufgaben | `voices`, `jobs` |
| `layers` Schichten | `layers` |
| `mixer` Mischpult | `mix` |
| `variant` Variante | `seed`, `variety` |

Anwenden beim Laden: Werte einer Teilmenge ersetzen die aktuellen (Objekte `layers`, `mix`, `voices`, `jobs` je Schlüssel gemischt: ein Profil, das nur `lead` enthält, ändert nur `lead`; `timbre`, `tags` und `bars` ersetzen im Ganzen). Das Ergebnis wird wie ein Track geprüft (`validateTrack` auf dem zusammengesetzten Track, dieselben Fehlercodes). **Ist es ungültig, wird nichts geändert** und die Meldung erscheint (Beispiel: Akkorde ohne die Tonart, zu der sie gehören, aber das ist durch `harmony` ausgeschlossen). Passt die Skala nicht zum Modus der Tonart, gilt die Standardskala des Modus. Ein Wechsel der Taktart über `harmony` rechnet das Tempo nicht um (nur `tempo` setzt `bpm`).

## Werksprofile

Die 9 Einträge entstehen aus `STYLE_PRESETS`. **Laden = genau das, was `applyStyle(id)` heute tut** (Stil, Schlagworte, Tempo mit Umrechnung für die Taktart, Akkordfarbe vom Stil, Klangregler zurücksetzen, laufende Wiedergabe live anpassen). Die Detailzeile nennt den Inhalt: „Stil & Schlagworte, Tempo, Klangregler (zurückgesetzt), Akkordfarbe“. „Kopie speichern“ legt ein eigenes Profil mit den Teilen `style`, `tempo` und `sound` (`timbre: {}`) an; die Akkordfarbe ist darin nicht enthalten (Vereinfachung, weil sie zu `harmony` gehört).

## Dateiformat (Kompatibilität zuerst)

Ein Profil: `{ "format": "backingtrack-profile", "version": 2, "name": "…", "parts": { … } }`.
Ein Ordner: `{ "format": "backingtrack-folder", "version": 1, "name": "…", "items": [ { "type": "folder", "name": "…", "items": [ … ] }, { "type": "profile", "name": "…", "parts": { … } } ] }`.
„Alles sichern“ ist ein Ordner mit dem Namen „Meine Profile“.

Regeln für das Einlesen (verbindlich):

1. **Unbekannte Felder werden überall ignoriert** (oberste Ebene, in Teilen, in Knoten).
2. **Ein Feld, das fehlt oder ungültig ist, fehlt im Ergebnis** (jedes Feld wird einzeln geprüft und bereinigt, der Rest bleibt); ebenso ein ganzer Teil, der gar nichts Brauchbares enthält. Das Einlesen meldet, wie viele Felder übersprungen wurden. Die Körnung: in Objekten wie `voices`, `jobs`, `layers`, `mix` und `timbre` fällt **ein ungültiger Eintrag** allein weg (unbekannte Schicht, Wert außerhalb des Bereichs); `tags` und `bars` sind **ein Wert** (ist ein Takt ungültig, fällt `bars` ganz weg). **Zusammengehörendes ist unteilbar:** in `harmony` gehören `key`, `bars` und `meter` zusammen. Fehlt davon eines oder passen sie nicht zusammen (Akkord nicht in der Tonart, Schläge je Takt gegen die Taktart), fällt der **ganze Teil `harmony`** weg und wird als übersprungen gemeldet, damit nie ein Profil im Baum liegt, das sich nicht laden lässt. `scale`, `chordColor` und `chordColorFromStyle` sind davon unabhängig und einzeln wählbar. Die Prüfung beim Einlesen nutzt dieselbe Prüfung wie das Laden (`validateTrack` auf einem Teil-Track aus dem Teil und Standardwerten).
3. **`version` ist nur eine Information.** Eine höhere Version wird nach bestem Wissen gelesen, nicht abgelehnt.
4. Abgelehnt wird nur, was kein JSON ist, ein unbekanntes `format` hat oder nach dem Bereinigen gar keinen Inhalt hat (kein Teil bzw. keine Knoten). Dann ändert sich nichts.
5. **Alte Dateien** (Commit 561bc10: `track`, `scale`, `style`, `chordColor`, `chordColorFromStyle`, `mix` ohne `parts`) werden gelesen und auf alle 9 Teile abgebildet.
6. Namen: Randleerzeichen weg, höchstens 60 Zeichen; leere Namen bekommen „Importiert“. Doppelte Namen im selben Ordner bekommen „ (2)“, „ (3)“ … Tiefe über 8 und mehr als 1000 Knoten werden übersprungen und gemeldet.
7. Export schreibt immer alle Felder, die es kennt, und nie die internen Ids.

## Speicher

`localStorage` unter `backingtrack.profiles`: `{ "version": 2, "items": [ Knoten ] }`, Knoten wie im Ordnerformat plus eine interne Id (zufällig, für Auswahl und Verschieben). Beim Laden wird eine alte flache Liste (Commit 561bc10: Array von `{ name, profile }`) in „Meine Profile“ übernommen, mit allen 9 Teilen; nichts wird beim Laden zurückgeschrieben, erst die erste Änderung speichert das neue Format. Defekte Knoten werden einzeln übersprungen. Misslingt das Speichern (gesperrt/voll), bleibt die Änderung bis zum Neuladen und die Meldung sagt es (wie heute).

## Import-Verhalten

Ziel ist der gewählte Ordner (ist ein Profil gewählt: dessen Ordner; „Aktuelle Sitzung“ oder nichts: „Meine Profile“). Ein einzelnes Profil wird aufgenommen und **ausgewählt** (nicht geladen). Ein Ordner wird mit seiner Struktur aufgenommen; die Auswahl bleibt, die Meldung nennt die Zahl der Profile. „Alles sichern“ wird mit dem normalen Import wieder aufgenommen (ergänzt, ersetzt nichts). Import aus Datei (höchstens 5 MB) oder Textfeld.

## Verschieben

- **„Verschieben nach …“:** native Auswahl (`<select>`) mit allen gültigen Zielordnern, eingerückt, plus Knopf. Immer vorhanden, per Tastatur, Screenreader und Touch bedienbar.
- **Ziehen:** Pointer Events (kein HTML5-Drag-and-drop, das auf Touch nicht geht). Gezogen wird nur am Griff ⋮⋮; Maus sofort, Touch und Stift nach langem Drücken (etwa 0,4 s, kurzes Vibrieren wo vorhanden), damit Scrollen nicht stört (`touch-action` nur am Griff). Der Baum scrollt am Rand mit. Ungültige Ziele sind ausgegraut und nehmen nichts an: Werksprofile, der Ordner selbst und seine Unterordner, Ziele, bei denen die Tiefe über 8 ginge. Loslassen außerhalb oder Esc bricht ab. Ein Ziel mit gleichnamigem Eintrag bekommt „ (2)“.
- **Rückgängig:** nach Löschen, Verschieben, Überschreiben und Import erscheint „Rückgängig“ in der Meldungszeile (eine Stufe, bis zur nächsten solchen Aktion).

## Bedienbarkeit

Baum nach dem WAI-ARIA-Muster (`role="tree"`, `treeitem`, `aria-expanded`, `aria-selected`, ein Tabstopp, Pfeiltasten, Pos1/Ende, Rechts/Links klappt auf/zu). Zielgrößen mindestens 44 px; kein waagerechtes Scrollen bei 360 px; alle Texte in `de` und `en`; Meldungen in einer `role="status"`-Zeile; DOM wird nur bei Änderung geschrieben (das Rendern läuft je Takt).

## Tests

Kern (ohne DOM, `node --test`): Baumoperationen (anlegen, umbenennen, verschieben mit Zyklus-/Tiefen-/Werksprofil-Sperre, löschen, eindeutige Namen); Teile speichern und anwenden (`null` gegen fehlend, Mischen je Schlüssel, ungültig = unverändert); Dateiformat (unbekannte Felder auf jeder Ebene, fehlende/ungültige Felder, höhere Version, altes Format, Grenzen); Speicher-Migration und defekte Knoten. Browser: Baumbedienung mit Maus, Tastatur und Touch-Emulation (langes Drücken, Scroll löst nicht aus, Abbruch), Breit (1280) und Schmal (360), Export/Import je Auswahl, Rückgängig, Schnellauswahl ist weg. Rund 9 bestehende Spezifikationen klicken heute `#quick-pick`; sie wählen den Stil künftig über das Werksprofil im Baum oder die Karten der Startseite.

## Meine Entscheidungen (zum Prüfen)

- **„Mit Sitzung überschreiben“** ersetzt nur die angehakten Teile des gespeicherten Profils; nicht angehakte Teile **bleiben im Profil, wie sie waren** (so geht nie etwas unbemerkt verloren). Die Haken starten mit den Teilen, die das Profil schon hat; Teile, die es noch nicht hat, lassen sich dazuhaken. Einen Teil aus einem Profil entfernen geht in dieser Runde nicht.
- **Namen:** innerhalb eines Ordners ist ein Name eindeutig, ohne Unterschied zwischen Ordner und Profil und ohne Beachtung der Groß-/Kleinschreibung. „Als Profil speichern“, „Umbenennen“ und „Neuer Unterordner“ mit einem schon vergebenen Namen werden **abgelehnt** mit einer Meldung (bei „Speichern“ mit dem Hinweis auf „Mit Sitzung überschreiben“); nichts wird ersetzt. Import, Verschieben und „Kopie speichern“ hängen stattdessen „ (2)“, „ (3)“ … an. Der heutige Test „Gleicher Name ersetzt das Profil“ fällt deshalb weg.
- **Laden des Teils `style`** (ohne `harmony`) setzt nur Stil und Schlagworte. Es färbt die Akkorde **nicht** um und ändert weder `chordColor` noch `chordColorFromStyle`. Nur das Laden eines **Werksprofils** macht das, was `applyStyle` heute tut. Ein Profil mit `harmony` setzt `chordColor` und `chordColorFromStyle` aus den eigenen Werten.
- **„Rückgängig“** betrifft nur den **Baum der gespeicherten Profile** (Löschen, Verschieben, Überschreiben eines gespeicherten Profils, Import), **nie die Sitzung**. Laden lässt sich nicht rückgängig machen; wer das braucht, speichert die Sitzung vorher als Profil. Umbenennen, Neuer Unterordner und Speichern als neues Profil haben kein „Rückgängig“.
- Der Baum ist nach Name sortiert, Ordner zuerst; es gibt keine manuelle Reihenfolge.
- Zugeklappte Ordner und die Auswahl werden nicht gespeichert (nur für die Sitzung der Seite).
- Es gibt keinen eigenen Knopf „Alles wiederherstellen“; der Import eines Sicherungsordners ergänzt.
- Import-Obergrenzen: Datei 5 MB, 1000 Knoten, Tiefe 8, Namen 60 Zeichen.
- Werksprofil-Kopie ohne Akkordfarbe (siehe oben).
- Die Startseite behält ihre Stil-Karten.

## Dem Bauenden überlassen

Dateiaufteilung (Baumlogik, Teile, Format, Oberfläche), Namen der Funktionen, Aussehen des Baums und der Griffe, genaue Texte, wie der Stil in „Aktuelle Sitzung“ angezeigt wird, wie die Ziehvorschau gezeichnet wird, wie die laufende Wiedergabe nach dem Laden angepasst wird (Neustart wie heute oder live), welche bestehenden Spezifikationen wie umgebaut werden.
