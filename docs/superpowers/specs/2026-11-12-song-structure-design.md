# Songform: Teile, Übergänge, Pausen, Dynamik und Zufall (Design)

Abgestimmt im Chat am 2026-11-12 (mit dem Plan-Tool, Variante A). Der Nutzer hat danach ausdrücklich gesagt: alles einbauen, das heutige Taktsystem darf aufgebrochen werden. Die Zahlen unten sind Startwerte, die der Bauende in **einer** Tabelle (`src/core/form-types.js`) hält und nach den Tests nachstellt; niemand kann hören, darum sind sie leicht änderbar.

## Absicht und Warum

Heute besteht ein Song aus 8-Takt-Blöcken. Zwischen den Blöcken ändert sich nur, welche Schichten spielen (der Aufbau), dazu kommt am Blockende ein Schlagzeug-Fill. Alle Blöcke haben dieselbe Dichte und dieselbe Lautstärke, nichts setzt aus, und es gibt keine erkennbaren Teile. Der Nutzer will, dass man **Teile hört** (Intro, Strophe, Aufbau, Refrain, Break, Outro), dass **Pausen und Aussetzer** anderen Elementen Raum geben, dass die **Lautstärke** deutlich stärker schwankt, und dass ein **Zufallsregler** mehr Varianz in Melodie und Rhythmus bringt. Die Form wird nach Regeln und Leitplanken gewürfelt (nicht nach einer festen Reihe) und lässt sich anpassen.

Forschungsstand (Quellen im Chat): Der Eindruck „Refrain ist lauter“ entsteht vor allem durch **Dichte, Helligkeit und Breite**, der Pegelunterschied selbst ist klein (etwa 2 dB als Faustregel); wirksam sind Aufbau, ein Stopp kurz vor dem Einsatz, Breakdowns, Fills an Teilgrenzen und kleine Änderungen alle 2, 4 oder 8 Takte; eine Form wird zuerst festgelegt, dann werden Muster erzeugt, und Wiederholungen werden gesteuert.

## Ziele

1. **Form als Daten:** `track.form` ist eine Liste von Teilen mit Typ, Länge in Takten und Einstellungen. Die Gesamtlänge des Songs ist die Summe der Teile. Teile haben beliebige Längen (1 bis 64 Takte), das Raster aus 8-Takt-Blöcken entfällt, wenn eine Form da ist.
2. **Teile haben Charakter:** Jeder Typ bringt Startwerte für Schichten, Dichte (Rhythmusstufe), Lautstärke und Übergang mit. Der Nutzer kann alles je Teil ändern.
3. **Würfeln nach Regeln:** Aus einer **Vorlage** (Jam, Pop, Build & Drop, Blues, Rock; „Auto“ wählt nach Stil) und der Zielgröße würfelt der Generator die Teile mit Leitplanken (siehe unten). Teile lassen sich **sperren**, dann würfelt „Neu würfeln“ sie nicht mit.
4. **Übergänge:** je Teil ein Übergang davor: kein, Fill, Wirbel (Snare-Aufbau), Stopp (ein bis zwei Schläge Stille); dazu optional ein Crash auf der Eins des Teils.
5. **Pausen:** neben dem Stopp lassen Teile (Break, Intro, Outro) Schichten weg, und der Regler **Pausen** lässt an Phrasenenden einzelne Schichten für einen Takt aussetzen.
6. **Dynamik:** je Teil ein Pegel in dB relativ zum Refrain (0 dB, nie darüber), dazu ein Regler **Dynamik**, der alle Pegel- und Dichteunterschiede staucht oder spreizt. Der Aufbau steigt über seine Länge an, das Outro fällt.
7. **Zufall:** ein Regler **Zufall**: Mit dieser Wahrscheinlichkeit wird je 4-Takt-Phrase das Muster jeder Schicht neu gewählt, und Auslassungen/Betonungen (Geisternoten, Synkopen) werden häufiger oder seltener.
8. **Oberfläche (Variante A):** ein Streifen mit den Teilen über den Spuren (Breite = Länge, Höhe = Pegel, auf derselben Takt-Achse wie die Spuren), Anklicken öffnet die Einstellungen des Teils; Schaltflächen „Neu würfeln“, „Teil hinzufügen“, Auswahl der Vorlage; die Regler Struktur, Dynamik, Pausen, Zufall in einer neuen Gruppe der linken Leiste.
9. **Profile:** die Form ist ein zehnter Teil der Profile („Songform“).
10. **Ein neuer Schlag `crash`** im Schlagzeug (Synth und Samples), damit der Crash am Teilanfang möglich ist.

## Nicht-Ziele

- Eine eigene Akkordfolge je Teil (die gewählte Folge wird weiterverwendet; sie beginnt in jedem Teil neu bei ihrem ersten Akkord). Eine echte 12-Takt-Blues-Akkordfolge ist ein eigener Schritt: die Blues-Vorlage nutzt 12-Takt-Teile mit der gewählten Folge.
- Doubletime, Ride-Becken, Tempo- oder Taktartwechsel mitten im Song, Modulationen.
- Eine echte Verstärkung über 0 dB (der Pegel ist ein Geschwindigkeitsfaktor der Ereignisse, siehe Entwurf).
- Manuelles Zeichnen von Mustern.

## Anti-Ziele (Fehlschlag, auch wenn es technisch läuft)

- Tracks **ohne** `form` ändern sich nicht: gleicher Track + gleicher Seed ergibt byte-gleiche Ereignisse (`tests/core/golden.test.js` bleibt unverändert).
- Jeder Song klingt nach demselben Muster, weil die Vorlage nur eine feste Reihe abspielt.
- Pausen oder Stopps klingen wie ein Fehler (Aussetzer mitten im Takt ohne Bezug zu Phrasen, abgeschnittene Töne ohne Ausklingen, Stille länger als zwei Schläge).
- Der Zufallsregler zerstört den Groove (kein Takt ohne Bass/Schlagzeug-Grundmuster außer in Breaks und Stopps) oder macht Wiedergabe nicht reproduzierbar (gleicher Seed + gleiche Einstellungen = gleicher Song).
- Pegel über dem Limit oder Übersteuern durch Crash/Wirbel.
- Die Oberfläche der Form lässt sich nur mit der Maus bedienen oder bricht bei 360 px.

## Datenmodell

```
track.form = {
  template: 'auto' | 'jam' | 'pop' | 'buildDrop' | 'blues' | 'rock',   // woraus gewürfelt wurde
  feel: { structure: 0..1, dynamics: 0..1, pauses: 0..1, randomness: 0..1 },
  sections: [ { type, bars, level?, density?, transition?, crash?, locked? } ]   // 1 bis 64 Teile, bars 1 bis 64
}
```
- `type`: `intro | verse | build | chorus | break | outro`.
- `level`: dB relativ zum Refrain, −24 bis 0; fehlt = Standard des Typs. `density`: Verschiebung der Rhythmusdichte −1 bis +1; fehlt = Standard des Typs. `transition`: `none | fill | roll | stop`; fehlt = Standard des Typs. `crash`: bool; fehlt = Standard des Typs. `locked`: bool (Standard false; ein vom Nutzer bearbeiteter Teil wird gesperrt).
- Fehlende `feel`-Werte: structure 0.6, dynamics 0.6, pauses 0.4, randomness 0.5.
- `track.length` ist bei vorhandener Form **abgeleitet**: die Summe der `bars` (die Normalisierung setzt sie; ein davon abweichender Wert wird überschrieben). Ohne Form gilt alles wie bisher.
- Unbekannte Felder werden ignoriert. Prüfung: neuer Fehlercode `badForm` (Parameter: kurzer Grund), Grenzen: bis 64 Teile, `bars` ganzzahlig 1 bis 64, Summe höchstens `MAX_LENGTH` (512).

## Teile und ihre Startwerte (`src/core/form-types.js`, eine Tabelle)

| Typ | Schichten | Dichte | Pegel (dB) | Übergang davor | Crash |
|---|---|---|---|---|---|
| intro | Akkorde, Pad, Bass (Schlagzeug aus) | −0,25 | −5 | keiner | nein |
| verse | Bass, Schlagzeug, Akkorde | −0,15 | −3 | Fill | nein |
| build | Bass, Schlagzeug, Akkorde, Pad | steigt von −0,10 auf +0,25 | steigt von −4 auf −1 | Wirbel im letzten Takt | nein |
| chorus | alle | +0,20 | 0 | Fill oder Stopp (nach Würfeln) | ja |
| break | Pad, Akkorde (Bass bei Bedarf) | −0,40 | −7 | Stopp | nein |
| outro | Bass, Akkorde, Pad, Schlagzeug (dünn) | fällt auf −0,30 | fällt von −4 auf −8 | keiner | nein |

Lead und Percussion folgen wie bisher Akkorden und Schlagzeug (`follows`). Der Regler **Dynamik** skaliert alle Abweichungen vom Refrain (Pegel und Dichte): 0 = alle Teile gleich, 1 = Tabelle, 1,3 = noch weiter gespreizt (Obergrenze des Reglers). Der Regler **Struktur** beeinflusst nur das Würfeln: mehr Struktur = mehr verschiedene Teile (Aufbau, Break, Intro/Outro treten häufiger auf) und größerer Kontrast der Startwerte (0 = Jam-artig, wenige Wechsel).

## Würfeln nach Regeln

Eigener Zufallsstrom (`createRng(hash(seed:'formgen'))`, nicht die Schicht-Ströme). Eine Vorlage ist eine Liste von **Plätzen** (Typ oder Typwahl, Längenwahl, Wahrscheinlichkeit, optional/wiederholbar). Aus Vorlage, Struktur-Regler und Zielgröße (`targetBars`, Auswahl 24, 32, 48, 64, 96, 128, 192) wird eine Reihe gezogen und auf die Zielgröße angepasst (Längen in Schritten von 2 Takten innerhalb der Wahl des Platzes, optionale Plätze ein-/ausgeschaltet; die Summe liegt höchstens 4 Takte neben dem Ziel, bei Platz-Längen wie 12 im Blues ein Vielfaches davon). „Auto“ wählt nach Stil: funk, reggae = jam; psych = buildDrop; dreamy, country, poppunk = pop; blues = blues; rock, hardrock = rock.

**Leitplanken** (jede ist ein Test über viele Seeds, Vorlagen und Längen):
1. Der erste Teil ist Intro oder Strophe; der letzte Outro oder Refrain.
2. Ein Aufbau steht nur direkt vor einem Refrain; ein Refrain nie als erster Teil.
3. Ein Break steht nie am Anfang oder Ende und nie zweimal hintereinander.
4. Nie mehr als zwei gleiche Typen hintereinander (außer in der Jam-Vorlage mit Strophe/Refrain-Wechsel).
5. Der Song enthält mindestens einen Refrain, wenn die Gesamtlänge mindestens 24 Takte ist und die Vorlage nicht „jam“ ist.
6. Mindestlänge je Typ (Aufbau 2, Break 2, Intro 2, Outro 2, Strophe/Refrain 4), Höchstlänge 32.
7. Reproduzierbar: gleiche Eingaben (Seed, Vorlage, Regler, Zielgröße, gesperrte Teile) ergeben dieselbe Form; verschiedene Seeds ergeben für dieselbe Vorlage mehr als eine Reihenfolge/Längenkombination (Test: bei Pop mit 96 Takten über 200 Seeds mehr als 10 verschiedene Formen).

**Neu würfeln** mit gesperrten Teilen: die gesperrten Teile bleiben an ihrer Stelle (Index und Eigenschaften), alle anderen Teile werden neu gezogen, wobei die Leitplanken auch rund um gesperrte Teile gelten (Zusammensetzen mit Reparatur: stimmt die Summe nicht, wird die Länge des längsten nicht gesperrten Teils angepasst; es gibt keinen nicht gesperrten Teil, bleibt die Form unverändert). Wechsel der Vorlage oder der Zielgröße würfelt alles neu und hebt Sperren auf.

## Wirkung auf die Ereignisse (nur wenn `form` vorhanden ist)

Die Erzeugung bleibt in `buildEvents`; Zugang über **eine** Funktion pro Teil, die `params` verschiebt, und eine **Nachbearbeitung** der fertigen Ereignisse:

1. **Dichte:** `withSection(params, sec)` verschiebt `drive` (Rhythmusstufe von Schlagzeug, Percussion, Lead, Akkordlänge) um die Dichte, `bassMovement` und `syncopation` zu kleineren Anteilen, und `syncopation` zusätzlich um den Zufallsregler (`(randomness − 0,5) · 0,4`). Alle Schichten lesen `params` bereits so (Bestandsaufnahme im Chat); es braucht keine Änderung in den Spielern. Klemmen auf 0 bis 1.
2. **Schichten und Teilgrenzen:** Eine neue `buildFormArrangement` liefert Abschnitte `{ start, bars, layers, fillAtEnd, kind, ... }` aus den Teilen (die Schichten aus der Typ-Tabelle; Lead und Percussion folgen wie bisher). `buildArrangement` bleibt für Tracks ohne Form unverändert.
3. **Phrasen und Zufall:** Mit Form wird `section(...)` je 4-Takt-Phrase des Teils neu aufgerufen und mit der Wahrscheinlichkeit „Zufall“ ein neues Muster gewählt, sonst das vorige beibehalten (die Ziehungen kommen aus dem Strom der jeweiligen Schicht, nur im Form-Pfad). Der Schlagzeug-Spieler setzt im Refrain die offene Hi-Hat sicher, in Strophe/Break/Intro nicht.
4. **Pegel:** Nach dem Erzeugen werden die `vel` der Ereignisse eines Takts mit `10^(dB/20)` multipliziert (nie über 1; ein Aufbau/Outro rampt über seine Takte). `vel` steuert bei Samples Anschlagstufe und Helligkeit mit, das ist erwünscht; echte Verstärkung gibt es nicht (Refrain = 0 dB = Bezug).
5. **Übergänge (Nachbearbeitung):** `fill`: Marker und Fill wie bisher im letzten Takt des vorherigen Teils. `roll`: im letzten Takt des vorherigen Teils ersetzt ein Snare-Wirbel (Achtel, dann Sechzehntel, crescendo) das Schlagzeugmuster der zweiten Takthälfte. `stop`: im letzten Takt entfallen alle Ereignisse ab dem letzten Schlag (bei hohem Pausen-Regler ab den letzten zwei Schlägen) bis zum Takt-Ende; Töne vor der Stille klingen aus. `crash`: ein Schlag `crash` (Vel 0,9, vor dem Pegel) zur Eins des Teils, zusammen mit dem Kick, falls der Teil Schlagzeug hat.
6. **Pausen-Regler:** An Phrasenenden (jeder 4. Takt, nicht im letzten Takt vor einem Stopp) lässt sich mit der Wahrscheinlichkeit `pauses · Typfaktor` eine Schicht (Akkorde, Pad, Lead, Percussion; Bass nur im Break, Schlagzeug nie ganz: nur Hi-Hat/Kick) für diesen einen Takt aus. Eigener Strom `master.fork('form')`.
7. **Akkordfolge:** `chordIndex(track, barIndex)` = `(barIndex − Teilanfang) mod bars.length` mit Form, sonst `barIndex mod bars.length`. Alle Stellen, die die Folge über die Takte laufen lassen (Zeitleiste, Wiedergabe-Dauer, Griffbrett-Vorschau), nutzen diese Funktion.
8. **Marker:** der Fill-Marker bleibt `name: 'fill'`; neue Marker `name: 'section'` mit `type`-Feld am Teilanfang für die Anzeige (Oberfläche filtert nach Namen).

## Oberfläche

- **Streifen** über den Spuren im selben Block (gleiche Takt-Achse wie `drawLanes`, ausgerichtet): Teile als Blöcke (Breite proportional zu den Takten, Höhe proportional zum Pegel, Farbe nach Typ, Name und Takte als Text); Auswahl per Klick/Tastatur (Pfeile, Enter), der Streifen ist bedienbar ohne Maus. Die Abschnittslinien der Spuren folgen den Teilgrenzen (statt alle 8 Takte).
- **Einstellungen des gewählten Teils** unter dem Streifen: Typ, Länge (Takte), Pegel (dB), Dichte, Übergang davor, Crash, Sperren, Löschen, nach links/rechts, Kopie. Jede Änderung sperrt den Teil.
- **Schaltflächen:** „Neu würfeln“, „Teil hinzufügen“, Vorlagen-Auswahl (Auto, Jam, Pop, Build & Drop, Blues, Rock, **Ohne Form** = bisheriges Verhalten).
- **Linke Leiste:** neue Gruppe „Songform“ mit Zielgröße und den vier Reglern Struktur, Dynamik, Pausen, Zufall. Regler wirken live, soweit die Gesamtlänge gleich bleibt (`player.setTrack`), sonst Neustart an der aktuellen Position.
- **Standard der App:** beim Start würfelt die App eine Form passend zum Stil (Vorlage Auto, Ziel 96 Takte wie heute); Variante weiterschalten würfelt neu (ohne gesperrte Teile). Die bisherige Auswahl „Länge“ wird zur Zielgröße der Form.
- Texte in `de` und `en`; Zielgrößen mindestens 44 px; 360 px ohne waagerechtes Scrollen; DOM nur bei Änderung schreiben.

## Profile

Zehnter Teil `form` („Songform“): enthält `track.form` samt `feel` und Sperren. Toleranter Import wie die anderen Teile (ungültige Teile der Liste werden einzeln verworfen und gezählt, eine leere Liste lässt den Teil wegfallen). Der Teil `rhythm` enthält weiter `length`; ist eine Form vorhanden, bestimmt die Form die Länge (die Summe überschreibt `length`).

## Crash

`DRUM_NAMES` bekommt `crash`; Synth: Rauschen mit langem Ausklingen (etwa 1,5 s), hell; Samples: MIDI-Taste 49 („Crsh 1“) in allen fünf Schlagzeug-Packs (`DRUM_KEYS` des Extraktors), Packs neu extrahieren (die `.sf3` liegt im Scratchpad: `C:\Users\lorda\AppData\Local\Temp\claude\84ff408a5aa68f0a\fc301f97-2e50-40f9-9893-843209376b8c\scratchpad\msg.sf3`); Pegel je Kit prüfen.

## Verhalten bei „Ohne Form“ und alten Tracks

`track.form` fehlt oder `template: 'off'` ist nicht möglich (fehlt = aus): Es gilt der bisherige Pfad bit-gleich. Gespeicherte Profile ohne Teil `form` laden unverändert (der Teil wird nicht angefasst).

## Meine Entscheidungen (zum Prüfen)

- Pegelunterschiede sind relativ zum Refrain und nie positiv; echte Verstärkung nur über Dichte/Helligkeit (Quelle: Recherche).
- Die Akkordfolge beginnt in jedem Teil neu; der Blues nutzt 12-Takt-Teile mit der gewählten Folge, keine neue Akkordfolge.
- Der Zufallsregler wählt je 4-Takt-Phrase neue Muster, kein Sprung in der Tonhöhe der Melodie über die bestehenden Lead-Aufgaben hinaus.
- Zielgrößen 24, 32, 48, 64, 96, 128, 192; Teilgrößen 1 bis 64 Takte.
- Eine Form kann beim Bearbeiten die Länge ändern; die Wiedergabe startet dann an der gleichen Position neu.
- `crash` ist ein neuer Schlag, kein Ride, kein Doubletime.
- Das Gerüst für alte Tracks bleibt unverändert, dafür bleiben `buildArrangement`, der Fill-Pfad und die Muster bit-gleich.

## Entscheidungen nach dem Builder-Check (meine Calls, zum Prüfen)

1. **Entwicklungs-Schlagworte** (`buildsSlowly`, `fullFromStart`, `withBreakouts`, und die Stile, die sie setzen): Mit Form wählen sie **nicht** mehr die Schichten je Teil (das macht die Typ-Tabelle), sondern **beeinflussen das Würfeln**: `buildsSlowly` erhöht die Wahrscheinlichkeit für Intro und Aufbau und bevorzugt bei „Auto“ die Vorlage Build & Drop; `fullFromStart` senkt die Wahrscheinlichkeit für Intro/Aufbau (der Song beginnt mit Strophe oder Refrain); `withBreakouts` erhöht die Wahrscheinlichkeit für Breaks. Gelesen wird direkt aus `track.tags.development` im Würfeln; `resolveTags`, `INERT_TAGS` und die Tag-Tests bleiben unverändert. Bei Tracks ohne Form gilt weiter `params.buildUp`.
2. **Wann würfelt die App neu?** Neu gewürfelt werden die **nicht gesperrten** Teile bei: „Neu würfeln“, Variante weiterschalten, Wechsel des Stils (nur bei Vorlage Auto), Loslassen des Reglers **Struktur**. **Alles** (Sperren aufgehoben) wird neu gewürfelt bei Wechsel von Vorlage oder Zielgröße. Die Regler Dynamik, Pausen und Zufall würfeln die Form nicht neu, sie wirken beim Erzeugen der Ereignisse (live über `setTrack`). Tag-Änderungen würfeln nicht neu. Lädt ein Profil `rhythm.length` und hat keinen Teil `form`, wird die Form für diese Länge (nächste Zielgröße) neu gewürfelt. „Ohne Form“ entfernt `track.form`; die Reglerwerte bleiben im Zustand der Oberfläche (`state.formFeel`) und kehren mit einer neuen Form zurück; die vier Regler sind dann ausgegraut.
3. **Würfeln liegt im Kern:** reine Funktion `rollForm({ template, targetBars, feel, seed, tags, locked })` in `src/core/form-roll.js` (ohne DOM, nicht in der öffentlichen Schnittstelle `src/index.js`); die Oberfläche ruft sie auf und speichert das Ergebnis in `track.form`. `buildEvents` bleibt dadurch allein vom Track abhängig. Gespeichert wird die **aufgelöste** Vorlage (`template` ist nie `'auto'`) plus `auto: true`, wenn der Nutzer „Auto“ gewählt hat (die Auswahl zeigt dann „Auto“).
4. **Dynamik gilt nur für die Standardwerte der Typen.** Vom Nutzer ausdrücklich gesetzte `level` und `density` werden **nicht** skaliert (was getippt wird, gilt). Der Streifen zeigt den **wirksamen** Pegel (Höhe); die Einstellungen zeigen den gespeicherten Wert oder „Standard (−3 dB)“.
5. **Crash:** MIDI-Taste 49 „Crsh 1“ ist in allen fünf Schlagzeug-Kits der SoundFont vorhanden (geprüft in der Preset-Liste); fehlt sie beim Extrahieren, bricht der Extraktor mit Fehler ab. Das erneute Extrahieren darf die Bytes der Packs ändern (Sample-Reihenfolge), **nicht** den Klang der bisherigen Tasten: ein Test vergleicht die dekodierten Samples der bisherigen Tasten alt gegen neu.

## Dem Bauenden überlassen

Dateiaufteilung (Formtypen-Tabelle, Würfeln, Anwenden, Nachbearbeitung, Oberfläche), Namen, die genauen Zahlen der Tabelle und der Regler-Formeln (nur die Grenzen, Reihenfolgen und Tests oben sind verbindlich), Aussehen von Streifen und Einstellungen, Tastaturbedienung im Detail, Wirbel-Muster, Crash-Klang, wie die Anpassung auf die Zielgröße rechnet, welche bestehenden Tests wie angepasst werden.
