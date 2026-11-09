# Akkord-Register und mehr Akkordarten (Design)

Projekt 1 von 2. Projekt 2 (Taktarten und Triolen-Raster, z. B. 3/4, 6/8, 12/8) kommt danach und ist hier ausdrücklich ausgeklammert. Abgestimmt im Chat am 2026-11-09; was nicht ausdrücklich abgestimmt wurde, ist als **(Annahme)** markiert.

## Absicht und Warum

Der Nutzer will dem Generator **mehr Optionen** geben und nicht ein bestimmtes Lied ermöglichen: eine **Vielzahl an Akkorden**, und der Code soll dafür **leicht erweiterbar** sein. Heute gibt es nur drei Dreiklänge (Dur, Moll, vermindert). Der Kommentar in `src/core/music.js` verspricht "Neue Akkordart = ein Eintrag hier, sonst keine Änderung", das stimmt aber nicht: Namen stehen an vier Stellen doppelt (`state.js`, `track.js`, `wheel.js` mit `°`, Fehlertext), der Bass holt die Quinte über `CHORD_QUALITIES[q][2]`, Arpeggio-Töne nehmen genau drei Akkordtöne an, Rad und Prüfung kennen nur die Dreiklänge. Ziel ist, dass eine neue Akkordart **ein Eintrag in einer Tabelle plus ihre Namen in `de.js`/`en.js`** ist und ein Test die Vollständigkeit prüft.

## Ziele

1. **Ein Akkord-Register** (`src/core/chords.js`) als einzige Quelle für alles, was eine Akkordart ausmacht. Alle anderen Stellen lesen daraus.
2. **17 Akkordarten** **(Annahme)**:
   - Dreiklänge: `maj`, `min`, `dim` (bleiben), `aug`, `sus2`, `sus4`, `power` (Powerchord, Grundton + Quinte)
   - Septakkorde: `dom7`, `maj7`, `min7`, `m7b5`, `dim7`
   - Erweiterungen: `maj6`, `min6`, `add9`, `dom9`, `min9`
   Symbole nach dem Grundton: `''`, `m`, `dim`, `aug`, `sus2`, `sus4`, `5`, `7`, `maj7`, `m7`, `m7b5`, `dim7`, `6`, `m6`, `add9`, `9`, `m9`.
3. **Stimmig zur Tonart, aber frei.** Die Grundtöne bleiben an die Tonart gebunden (wie heute: die sieben Stufen, in Moll zusätzlich die Dur-Dominante). Welche Akkordarten auf einer Stufe erlaubt sind, bestimmt das Register über die Eigenschaft `on` (Liste der Dreiklangs-Grundarten `maj`/`min`/`dim`, auf denen die Art stehen darf): Dur-Stufen bekommen `maj`, `aug`, `sus2`, `sus4`, `power`, `dom7`, `maj7`, `maj6`, `add9`, `dom9`; Moll-Stufen `min`, `sus2`, `sus4`, `power`, `min7`, `min6`, `min9`; verminderte Stufen `dim`, `power`, `m7b5`, `dim7` (`power` steht auf allen drei Grundarten, weil die Akkordfarbe `Powerchords` jede Stufe umfärbt). Keine Musiktheorie-Polizei: ein Dominantseptakkord auf jeder Dur-Stufe ist erlaubt (Blues: I7, IV7, V7).
4. **Mehr Optionen in der Oberfläche:**
   - **Akkord hinzufügen** wird zweistufig: erst ein **Grundton** (ein Chip je Grundton der Tonart, in Moll also sieben und nicht acht, vorbelegt mit dem ersten), dann eine **Akkordart** (Chips, nach Gruppen geordnet: Dreiklänge, Septakkorde, Erweiterungen; nur die auf dieser Stufe erlaubten sind anwählbar). Ein Klick auf eine Akkordart fügt den Akkord an. Das Entfernen eines Takts bleibt wie bisher.
   - **Akkordfarbe** (Chips in der Gruppe Akkordfolge, eine Aktion auf die ganze Folge): `Dreiklänge`, `Septakkorde`, `Erweiterungen`, `Powerchords`. Sie schreibt die Arten aller Akkorde der Folge um (Beispiel Septakkorde in A-Moll: Am7, Dm7, E7; Dur-Stufen werden `maj7`, die Dominante `dom7`, verminderte `m7b5`). **Die Akkordfarbe bleibt eine Einstellung** (`state.chordColor`, Standard `triads`) **(Annahme)**: Beim Wählen wird sie auf die aktuelle Folge angewandt und danach bei jeder neu erzeugten Folge (Tonart, Skala, Variante) wieder; der gewählte Chip ist gedrückt; von Hand hinzugefügte Akkorde bleiben, wie gewählt, die Einstellung beschreibt nur, wie erzeugte Folgen gefärbt werden. Das ist **eine Abweichung von der Zusammenfassung im Chat** ("neue Schlagwort-Kategorie Harmonie"): Schlagworte ändern nie die Akkordliste und wirken live auf Muster und Klang; die Akkordfarbe ändert die Akkorde selbst. Darum eine Aktion der Folge statt eines Schlagworts **(Annahme, bitte bestätigen)**.
5. **Stimmige Musik mit allen Arten:** Bass-Quinte, Bass-Septime, Arpeggio-Töne und Stabs/Pad kommen aus den Intervallen des Registers (siehe "Verhalten der Muster").
6. **Erweiterbar und prüfbar:** Ein Konsistenztest geht jede Registerart durch (siehe "Akzeptanz"). Eine kurze Anleitung "So ergänzt man eine Akkordart" steht in `docs/interface.md`.

## Nicht-Ziele

- Taktarten, Triolen, neue Rhythmus-Muster (Projekt 2).
- Umkehrungen, Slash-Akkorde, Griffbilder der Gitarre (Fingersätze), pro Takt eigene Umkehrung oder Oktavlage.
- Neue Tonleitern oder Modi. Neue Akkordfolgen-Vorlagen. Das Rad bekommt keine neuen Ringe.
- Eine Stufe einer bestehenden Folge nachträglich in ihrer Art ändern (entfernen und neu hinzufügen genügt; die Akkordfarbe ändert alle auf einmal).
- Änderung der Stile oder Schlagworte.

## Anti-Ziele (das wäre ein Misserfolg, auch wenn alles "funktioniert")

- Ein bestehender Track mit nur Dreiklängen klingt oder verhält sich **anders** als vorher: der Ereignisstrom bleibt für `maj`/`min`/`dim` **bitgleich** (Golden-Hashes in `tests/core/golden.test.js` unverändert grün, auch mit `variety`).
- Die öffentliche Schnittstelle für Interactive Scales bricht: `allowedChords(key)` liefert weiter **genau** die bisherigen Dreiklänge (gleiche Reihenfolge, in Moll die Dur-Dominante als achter Eintrag); Track-Format und Fehlercodes (`unknownQuality`, `chordNotInKey` usw.) bleiben, `VALIDATION_CODES` unverändert.
- Eine Akkordart zu ergänzen erfordert, mehr als das Register und die zwei Sprachdateien anzufassen.
- Rohe Schlüsselnamen oder fehlende Übersetzung sichtbar; ein Akkord, der im Rad, Griffbrett oder Track stumm oder als `undefined` erscheint.

## Das Register (`src/core/chords.js`)

Ein eingefrorenes Objekt `CHORDS`, Schlüssel = Akkordart-ID (bleibt der String im Track). Je Eintrag:

| Feld | Bedeutung |
| --- | --- |
| `intervals` | aufsteigende Halbtöne ab dem Grundton, beginnt mit 0 (z. B. `dom7: [0, 4, 7, 10]`) |
| `symbol` | Text hinter dem Grundton in Namen (`'7'`, `'m7b5'`, `''` für Dur) |
| `short` | optional, kürzere Schreibweise für enge Stellen (Rad: `dim` zeigt `°`); Standard = `symbol` |
| `base` | Dreiklangs-Grundart `maj`, `min` oder `dim`, zu der die Art gehört; `null` bei Arten, die auf mehreren Grundarten stehen (`sus2`, `sus4`, `power`; bei `power` ist `on` alle drei Grundarten, bei `sus2`/`sus4` nur `maj` und `min`), dann gilt die Zuordnung zur Stufe unten |
| `on` | Liste der Grundarten, auf deren Stufen die Art stehen darf (Standard `[base]`) |
| `group` | `triad`, `seventh` oder `extended` (Gruppierung in der Auswahl; `sus2`, `sus4`, `power`, `aug` stehen in `triad`) |
| `fifth` | Intervall der Quinte für den Bass (7; `dim`: 6; `aug`: 8; `power`: 7) |
| `seventh` | optional, Intervall der Septime (10, 11 oder 9 bei `dim7`), sonst fehlt das Feld |

Funktionen (alle rein, ohne DOM): `chordName(chord)` (Grundton + `symbol`; ersetzt die vier Kopien), `chordShort(chord)`, `chordTones(chord, octave)` (ersetzt `chordMidi`; `chordMidi` bleibt als dünner Alias), `isChordQuality(q)`, `qualitiesFor(base)` (Arten, deren `on` die Grundart enthält, in Registerreihenfolge), `chordOptions(key)` (**ein Eintrag je Grundton** `{ root, qualities }`: in Moll vereint der Grundton der Dur-Dominante die Arten der Moll-Stufe und der Dur-Stufe, es gibt also sieben Einträge, nicht acht), `stepBase(chord, key)` (Grundart der Stufe, siehe unten), `colorChord(chord, flavor, key)` und `colorProgression(bars, flavor, key)` für die Akkordfarbe. `CHORD_QUALITIES` bleibt exportiert (abgeleitet aus `CHORDS`, nur die Intervalle) für bestehende Aufrufer.

Akkordfarben (Abbildung je Grundart der Stufe; Dominante in Moll zählt als `maj`):

| Farbe | `maj`-Stufe | `min`-Stufe | `dim`-Stufe |
| --- | --- | --- | --- |
| `triads` | `maj` | `min` | `dim` |
| `sevenths` | `maj7` (Dominante: `dom7`) | `min7` | `m7b5` |
| `extended` | `add9` (Dominante: `dom9`) | `min9` | `dim7` |
| `power` | `power` | `power` | `power` |

Die **Dominante** legt `MODES` je Modus als Feld `dominant` fest **(Annahme)**: Stufe V in Dur, die zusätzliche Dur-Dominante in Moll, die Stufe IV in Dorisch (dort ist V eine Moll-Stufe; die Dur-Stufe IV gibt den typischen Dorisch-Klang, in A-Dorisch D7).

**Zuordnung eines Akkords zu einer Stufe (`stepBase`) und Farbe (Annahme):** Hat die Art genau eine erlaubte Grundart (`on` mit einem Eintrag), gilt diese. Bei `sus2`, `sus4` und `power` gilt die Grundart der **diatonischen** Stufe auf diesem Grundton in der Tonart (E in A-Moll ist die Moll-Stufe Em, nicht die Dominante). Die Akkordfarbe benutzt `stepBase`, deshalb wird `Esus4` in A-Moll mit `sevenths` zu `Em7`; die Dominanten-Septakkorde (`dom7`, `dom9`) behalten ihre Dur-Stufe, `E7` bleibt bei `sevenths` ein `E7`. Information über den vorherigen Zustand (z. B. dass es vorher ein Powerchord war) geht beim Zurückschalten auf `triads` bewusst verloren.

## Verhalten der Muster

- **Bass:** Grad `5` = Grundton + `fifth` des Akkords; Grad `b7` = Grundton + `seventh` des Akkords, sonst 10 (bitgleich zu heute). Bass-Tonlage und `fold` bleiben.
- **Arpeggio:** Der Tonvorrat sind die Akkordtöne zyklisch über Oktaven: Index `i` ergibt `tones[i % n] + 12 * Math.floor(i / n)`, plus die bisherige Verschiebung um eine Oktave. Für Dreiklänge (n = 3) ergibt das Index 0..3 = Grundton, Terz, Quinte, Grundton + Oktave **bitgleich** wie heute; mit Septakkorden ist Index 3 die Septime, mit `power` (n = 2) sind Index 2 und 3 Grundton + Oktave und Quinte + Oktave. Die Arpeggio-Listen selbst bleiben unverändert.
- **Stabs und Pad:** spielen alle Akkordtöne wie heute (vier statt drei Töne bei Septakkorden, zwei bei `power`). Die Lautheit wird nicht nachgeregelt **(Annahme: Pegel prüfen, nur bei Abweichung über den Mess-Test anpassen)**.
- **Griffbrett und Rad:** Das Griffbrett zeigt die Töne aus `chordTones`. Das Rad bleibt ein Quintenzirkel mit Dur-Ring außen und Moll-Ring innen; ein Knoten ist hervorgehoben, wenn sein Grundton und seine Ring-Grundart (außen `maj`, innen `min`, verminderte Stufen wie bisher) zu `stepBase(aktueller Akkord, Tonart)` passen; die Beschriftung zeigt `chordShort`. Ein Klick auf einen Knoten fügt wie heute den Dreiklang der Stufe an.

## Prüfung der Tonart (`validateTrack`)

Ein Akkord ist gültig, wenn seine Art im Register steht (sonst `unknownQuality`) **und** sein Grundton (nach Tonhöhe, `A#` = `Bb`) eine Stufe der Tonart ist, auf der diese Art laut `on` stehen darf (sonst `chordNotInKey`). Für die drei Dreiklänge bleibt das Ergebnis wie heute; ein Dreiklang auf dem falschen Grad meldet weiter `chordNotInKey`.

## Gebrauchsfolgen und Randfälle

- Folgen mit bis zu `MAX_CHORDS` (8) Akkorden und vorhandene Tracks bleiben gültig; gespeicherte Dreiklänge ändern sich nie von selbst.
- Namen: `Cmaj7`, `Am7`, `G7`, `Bm7b5`, `Bdim7`, `Csus2`, `Csus4`, `C5`, `Caug`, `C6`, `Am6`, `Cadd9`, `C9`, `Am9`. Die Anzeige in Fehlertexten und Aria-Labels nutzt dieselbe Funktion.
- Die Akkordfarbe auf einer Folge mit Dominante in Moll (`Am Am Dm E`) ergibt bei `sevenths` `Am7 Am7 Dm7 E7`.
- Jede Registerart hat Namen in beiden Sprachen für Beschriftungen (`chord.<id>`) und die Gruppen (`chordGroup.<group>`); Akkordfarben `chordColor.<id>`.

## Akzeptanz

1. `npm test` und `npx playwright test` grün; Golden-Hashes und die Pegel-/Klangmessungen unverändert.
2. **Register-Konsistenztest** (läuft über alle Arten, damit neue automatisch erfasst werden): `intervals` aufsteigend, eindeutig, beginnt mit 0; `symbol` eindeutig über alle Arten; `fifth` ist ein Intervall der Art; `seventh` (wenn vorhanden) ist ein Intervall; `base` und `group` gültig; `on` enthält nur gültige Grundarten; `chord.<id>` und `chordGroup.<group>` in `de` und `en`; jede Art erzeugt über alle Tonarten, Modi, Stufen und Stile gültige, endliche, im Bereich liegende Ereignisse (Bass 28..52, Akkordtöne endlich), auch mit `variety`.
3. Alle Akkordfarben auf alle Tonarten und Modi angewandt ergeben Folgen, die `validateTrack` ohne Fehler besteht.
4. UI: Zweistufige Auswahl und Akkordfarbe per Maus und Tastatur, Rad und Griffbrett zeigen jede Art ohne Fehler, kein roher Schlüssel, 360 px Breite ohne Überlauf, bestehende E2E-Specs weiter grün (angepasst, nie abgeschwächt).
5. `docs/interface.md`: neue Arten, Register, Akkordfarbe und die Anleitung zum Ergänzen.

## Festgelegt beim Prüfen des Dokuments (meine Wahl, bitte gegenlesen)

1. Akkordfarbe = Einstellung (nicht einmalig), siehe oben.
2. Dominante je Modus über `MODES.dominant`; in Dorisch die Stufe IV.
3. `base` ist `null` für `sus2`, `sus4`, `power`; Stufenzuordnung über `stepBase`.
4. Ein Grundton-Chip je Grundton (kein doppeltes "E" in Moll); die zwei E2E-Tests, die acht Auswahlknöpfe mit doppeltem Grundton erwarten (`play-page.spec.js` und `tuning.spec.js`, Akkord-hinzufügen-Leiste), werden auf die zweistufige Auswahl umgeschrieben, nicht abgeschwächt.

## Dem Bauenden überlassen

Dateizuschnitt innerhalb von `src/core/chords.js` (ein Modul genügt), genaue Gestaltung und Beschriftungstexte der Chips, Reihenfolge der Registereinträge innerhalb einer Gruppe, wie `chordMidi` zum Alias wird, Namen der Test-Dateien, ob Pegelanpassung bei Septakkorden nötig ist (Mess-Test entscheidet), die deutschen Anzeigenamen der Arten (z. B. "Dominantseptakkord").
