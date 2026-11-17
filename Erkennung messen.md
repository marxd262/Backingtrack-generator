# Akkord- und Takterkennung verbessern: Auftrag und Messung

Diese Datei ist für einen Agenten, der die Akkorderkennung und die Takterkennung der nativen App verbessern soll. Sie beschreibt den Auftrag, womit und wie man misst, und woran man erkennt, ob eine Änderung die Erkennung besser gemacht hat. Stand der Zahlen: 2026-11-17, Branch `exp/analysis-agent`. **Alle drei Phasen sind abgeschlossen; der Schlussbericht ist [native/BERICHT.md](native/BERICHT.md).** Danach hat der Nutzer Vorschlag Nr. 9 angenommen; was heute auf `develop` gilt, steht im Abschnitt „Stand auf `develop` nach Vorschlag Nr. 9“ (`analysisVersion` `2026-11-17h`). Der Abschnitt „Endstand nach Phase 2“ ist mit dem Commit `4179a5b` gemessen (`analysisVersion` `2026-11-17g`). Der Abschnitt „Ausgangsstand für Phase 2“ ist mit dem Commit `da62e4e` gemessen (gleich dem Stand nach Phase 1, `a622b53`, dazu nur eine Protokollzeile); „Ausgangsstand vor Phase 1“ ist mit `955b5e8` gemessen (nach dem gemeinsamen Dekodierweg, gleich dem Stand nach Phase 0). App und `btg_analyze` liefern für drei Tracks dasselbe JSON, vor und nach den Versuchen (siehe [native/ERGEBNISSE.md](native/ERGEBNISSE.md), „Phase 1“).

## Auftrag

Zwei Ziele, in dieser Reihenfolge bearbeitet:

1. **Zeitliche Lage von Akkorden und Takten.** In der App passen die angezeigten Akkorde und Takte teils nicht zum Audio. Sie driften auseinander: Ein neuer Akkord ist schon zu hören, während die Anzeige bis zu etwa einer Sekunde hinterherhängt. Beobachtet hat das der Nutzer in der eigenständigen App (nicht in einer DAW) bei „Letting Go Guitar Backing Track Jam in D Minor“ (Satz „echt“). Der Track hat nach Gehör und laut Video ein gleichbleibendes Tempo; das Video zeigt durchgehend dasselbe Tempo an. Die App erkennt dagegen ein schwankendes Tempo, und an manchen Stellen zeigt sie den Akkordwechsel später an, als er im Video und im Audio kommt.
2. **Akkorderkennung**, vor allem die Akkordart (`kind`, heute 74 % im Satz „echt“). Grundton und Dur/Moll dürfen dabei nicht schlechter werden.

Das Hauptziel des Nutzers ist die Akkorderkennung. Die Zeitlage kommt trotzdem zuerst: Die Akkorde werden je Schlag bestimmt und hängen an den Takten. Eine Sekunde Versatz fühlt sich in der App wie ein falscher Akkord an, egal wie gut die Erkennung ist. Und solange die Ursache des Versatzes unbekannt ist, misst man womöglich am falschen Ende.

Ablauf:

- **Phase 0, Diagnose und Messung erweitern:** eigene Sitzung. Der Nutzer prüft das Ergebnis, bevor Phase 1 beginnt. Nur in Phase 0 dürfen die Messwerkzeuge geändert werden. **Erledigt am 2026-11-17:** Ergebnis in [native/DIAGNOSE.md](native/DIAGNOSE.md), Vorschläge in [native/VORSCHLAEGE.md](native/VORSCHLAEGE.md).
- **Phase 1, Zeitlage und Takte:** höchstens 12 Versuche, oder bis 6 Versuche in Folge verworfen wurden. **Erledigt am 2026-11-17** (Ergebnis in [native/ERGEBNISSE.md](native/ERGEBNISSE.md), „Phase 1“; der Nutzer prüft, bevor Phase 2 beginnt), gearbeitet nach [docs/superpowers/plans/2026-11-17-analysis-phase1.md](docs/superpowers/plans/2026-11-17-analysis-phase1.md). Entscheidungen des Nutzers zu den Vorschlägen: Nr. 6 ja (ein Dekodierweg im Kern für App und `btg_analyze`), Nr. 5 ja, Nr. 4 ja (nur ein Achtel vor dem Schlag). Reihenfolge: Nr. 6, Nr. 5, Ausgangsstand neu, dann die Versuche Nr. 4, Halbierungsregel mit der 6-%-Toleranz, Nr. 1 bis 3. Am Ende von Phase 1 prüft der Nutzer, bevor Phase 2 beginnt.
- **Phase 2, Akkorde:** **Erledigt am 2026-11-17** nach [docs/superpowers/plans/2026-11-17-analysis-phase2.md](docs/superpowers/plans/2026-11-17-analysis-phase2.md): 9 Versuche gemessen, einer behalten (ein Wechsel in der Taktmitte, den der Bass erst am Taktanfang macht, steht am Taktanfang). `kind` im Satz „echt“ stieg um 0,5 statt um den angestrebten Punkt; keine Regel für die Akkordart hat die Regeln erfüllt. Ergebnis in [native/ERGEBNISSE.md](native/ERGEBNISSE.md), „Phase 2“, Entscheidungen für den Nutzer in [native/VORSCHLAEGE.md](native/VORSCHLAEGE.md) (Nr. 7 und 9 bis 12) und [native/LABEL-VERDACHT.md](native/LABEL-VERDACHT.md). Der Auftrag lautete: Höchstens 18 Versuche, oder bis 6 Versuche in Folge verworfen wurden. Vorweg, ohne Versuchszählung, die Robustheitsprüfung (alle Sätze in der anderen Abtastrate und als MP3; Ergebnis in [native/ERGEBNISSE.md](native/ERGEBNISSE.md), „Robustheitsprüfung“): Der Satz „echt“ bewegt sich dabei um höchstens 0,5 Punkte bei `root`, `kind`, `timing` und `tempo steady`, einzelne Tracks um mehr. Vorgaben des Nutzers für Phase 2:
  - Regeln für sus-Akkorde und Powerchords bleiben nur, wenn zusätzlich zu A oder B `others` in generiert-2 steigt und `triads` in keinem Satz fällt. Ein Gewinn, der im Satz „echt“ fast nur aus einem Track kommt, reicht allein nicht.
  - Grundton vor Akkordart, wenn das Budget knapp wird.
  - Ob ein Versuch bleibt, entscheiden nur die Zahlen von `analysis-score.mjs`. Hilfsskripte dienen der Diagnose; was sie tun, steht in `native/ERGEBNISSE.md` und im Bericht.
  - Ein Versuch, der die Lage der Akkordwechsel ändert, wird nach den Regeln für die Zeitlage gewertet; die Punkte 2 bis 6 für Akkorde gelten zusätzlich.
  - `9pH42-82Mz0` (F statt C an drei Stellen): Dieser Punkt kam mit offenem Platzhalter zurück („mein Ergebnis eintragen oder: in Phase 2 nicht gezielt bearbeiten“). Gewählt ist die vorsichtige Lesart: in Phase 2 nicht gezielt bearbeitet, der Nutzer hört es sich selbst an.
  - Gewinne auf `cycle`-Tracks zählen halb: Für A und B gilt der Zuwachs des Satzes „echt“, bei dem der Zuwachs der drei `cycle`-Tracks halbiert ist; ein Verlust zählt voll.

Gearbeitet wird auf einem eigenen Branch `exp/analysis-agent`, abgezweigt von `feat/native-spike`.

## Worum es geht

Die App analysiert eine Audiodatei und meldet Tempo, Schläge, Takte, Taktart, Tonart und den Akkord zu jeder Stelle. Der ganze Algorithmus steht in [native/core/src/analysis.cpp](native/core/src/analysis.cpp) (C++20, ohne JUCE). Das Kommandozeilenprogramm `btg_analyze` ruft dieselbe Funktion auf wie die App und schreibt das Ergebnis als JSON.

- **Takterkennung:** Schläge und Vorschläge für Taktanfänge kommen aus dem Modell Beat This! ([native/core/src/beat_model.cpp](native/core/src/beat_model.cpp)). `analysis.cpp` macht daraus Tempo, Taktart und die Taktanfänge und entscheidet, wann es dem Modell nicht folgt. Fehlt das Modell oder verliert es den Puls, sucht `analysis.cpp` die Schläge selbst.
- **Akkorderkennung:** Die Akkorde bestimmt `analysis.cpp` selbst, je Schlag. Sie hängt von den Takten ab: Der Bass zählt auf der Eins mehr als auf den übrigen Schlägen, und Akkordwechsel sind am Taktanfang und in der Taktmitte billiger als dazwischen.

Wegen dieser Abhängigkeit werden immer beide gemessen, auch wenn nur eine geändert wurde. Gemessen wird, indem `btg_analyze` über beschriftete Testtracks läuft und ein Skript das Ergebnis mit den Labels vergleicht.

Das Modell selbst und seine Gewichte bleiben unverändert. Erlaubt sind Änderungen an dem, was `analysis.cpp` mit seinen Schlägen macht, und an der Umrechnung von Frames oder Samples in Sekunden in `beat_model.cpp`, falls dort ein Fehler liegt. Danach den Ordner `native/build/beats-cache` leeren.

## Vorbereiten

Alle Befehle laufen in PowerShell im Wurzelordner des Repositorys. Gebraucht werden Visual Studio mit C++, Node ab Version 22 und für den verstimmten Testsatz `ffmpeg`.

```powershell
native\build.ps1 -NoApp          # baut Kern, btg_analyze und Tests, lädt das Schlagmodell, lässt die Tests laufen
$env:BTG_BEATS_CACHE = "$PWD\native\build\beats-cache"   # merkt die Schläge des Modells je Datei, spart Minuten
```

- `btg_analyze.exe` liegt danach in `native/build/core/Release/`.
- Ohne `BTG_BEATS_CACHE` rechnet das Schlagmodell bei jeder Messung neu (5 bis 10 s je Track). Mit dem Zwischenspeicher dauert eine Messung aller drei Sätze etwa 35 s.
- Der Zwischenspeicher gilt je Datei nur, solange Größe und Änderungszeit der Audiodatei stimmen; sonst rechnet das Modell neu und überschreibt den Eintrag. Leeren ist nur nötig, wenn `beat_model.cpp` geändert wurde. Wer an den Akkorden oder an `analysis.cpp` arbeitet, lässt ihn stehen.
- `-NoApp` schaltet den Bau der App ab; ein späteres `native\build.ps1` ohne den Schalter baut sie wieder.

## Testdateien

| Satz | Ort | Inhalt | Wofür |
|---|---|---|---|
| echt | `C:\dev\samples-raw\analysis-tests` | 13 echte Backingtracks (MP3) mit Labels | Hauptmaß |
| generiert | `native/build/analysis-set` | 18 Tracks aus dem Web-Generator, 4/4, nur Dreiklänge | Rückschritte erkennen |
| generiert-2 | `native/build/analysis-set-2` | 9 Tracks mit anderen Akkordarten, 9 in 3/4, 6/8, 12/8, 5/4 bei 60 bis 180 bpm | Akkordarten, Taktarten |
| verstimmt | `native/build/analysis-set-detuned` | 6 generierte Tracks, 20 bis 50 Cent neben 440 Hz | Stimmung |
| tempo | `native/build/analysis-set-tempo-labeled` | 8 generierte Tracks in 4/4, 60 bis 84 bpm, deren Tempo sich bewegt: zweimal allmählich schneller, zweimal langsamer, zwei harte Wechsel, zweimal Schwanken um bis zu 3 % | Drift, Tempowechsel |

Dazu kommen 5 unangetastete echte Tracks. Sie liegen nicht in diesen Ordnern, und der Agent öffnet und misst sie nicht (siehe „Die unangetasteten Tracks“).

Die echten Tracks und ihre Labels liegen außerhalb des Repositorys und bleiben dort. Die generierten Sätze liegen im Bauordner und sind nicht in Git. **Sie werden nicht neu erzeugt.** Fehlt ein Satz, anhalten und dem Nutzer melden. Entstanden sind sie so:

```powershell
node native/tools/analysis-set.mjs            # generiert
node native/tools/analysis-set.mjs --rich     # generiert-2
node native/tools/analysis-detune.mjs         # verstimmt (braucht ffmpeg und den Satz "generiert")
node native/tools/analysis-set.mjs --tempo    # tempo
```

Das Rendern ist nicht bitgleich wiederholbar (Zufall je Anschlag): Neu erzeugte Sätze klingen leicht anders, und der Ausgangsstand unten gälte für sie nicht mehr. Er gilt für die Dateien vom 2026-11-17.

Im Satz „tempo“ liegt die Tempokurve nur über den Startzeiten der Ereignisse. Notenlängen und Echozeiten bleiben auf dem Grundtempo des Tracks.

### Labels

Neben jedem Track liegt eine gleichnamige `.json`. Das Format beschreibt `C:\dev\samples-raw\analysis-tests\LIESMICH-labels.txt`. Die wichtigen Felder:

- `key`: `{ "root": "D", "mode": "minor" }`; `mode` darf eine Liste sein, wenn mehrere Lesarten gelten (ein Blues).
- `bpm`, `meter` (z. B. `[4, 4]`).
- `chords`: Zeitverlauf `{ "t": Sekunde, "chord": "Am7" }`, gültig bis `chordsUntil`. `"chord": null` ist eine Strecke ohne Label.
- `beats`, `downbeats` (nur generierte Sätze): die Schlag- und Taktzeiten des Generators in Sekunden. In 6/8 und 12/8 sind `beats` die punktierten Schläge.
- `tempo` (nur Satz „tempo“): das Tempo an jedem Taktanfang; `bpm` ist dort `null`.
- `cycle`: nur die sich wiederholende Akkordfolge ohne Zeiten. Das Messskript legt sie dort über den Track, wo sie am besten passt. Diese Wertung ist etwas zu freundlich; in der Ausgabe steht dann `[cycle fitted]`. Gewinne auf solchen Tracks zählen bei der Bewertung einer Änderung nur halb.

Die Labels der echten Tracks stammen aus der Akkordanzeige der zugehörigen Videos. Sie sind auf 0,25 s genau, und die Anzeige ist dem Ton je nach Video bis zu 0,2 s voraus. Die besten echten Tracks erreichen deshalb 97 bis 99 %, nicht 100 %. Die Labels der generierten Sätze sind genau.

**Labels werden nicht geändert.** Wirkt ein Label falsch, den Fall in `native/LABEL-VERDACHT.md` eintragen (Track, Zeitstelle, Label, was zu hören ist, warum) und weitermachen. Der Nutzer entscheidet und misst danach den Ausgangsstand neu.

## Messen

```powershell
node native/tools/analysis-score.mjs C:\dev\samples-raw\analysis-tests native\build\analysis-set native\build\analysis-set-2
node native/tools/analysis-score.mjs native\build\analysis-set-detuned
```

Dazu der Satz „tempo“; er gehört zu jeder Messung:

```powershell
node native/tools/analysis-score.mjs native\build\analysis-set-tempo-labeled
```

Die Ausgabe hat eine Zeile je Track und am Ende eine Zeile je Satz, die mit `==` beginnt:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 93.6 %, maj/min 93.0 %, kind 74.4 % (triads 85.0 %, others 43.2 %) | changes on the one 80.9 % | timing +143 ms, apart 173 ms, within 78.8 %, 90 % under 481 ms, drift 13 ms/min, missed 0.5 % | tempo steady 34.5 % at most, 1.8 % off
```

Bei den generierten Sätzen folgt noch `| beats +15 ms, within 50 ms 99.0 %, bars 98.6 %`. `--timing` gibt je Track den Versatz der Akkordwechsel für alle 30 s aus. `node native/tools/analysis-score.mjs --self-test` prüft die neuen Zahlen an erfundenen Schlägen und Akkorden.

Verglichen wird alle 0,1 s innerhalb der Strecke, die das Label abdeckt. Die Zahl eines Satzes ist das Mittel über seine Tracks; jeder Track zählt gleich, egal wie lang er ist.

| Zahl | Bedeutung |
|---|---|
| `chords root` | Anteil der Zeit mit richtigem Grundton |
| `maj/min` | Anteil der Zeit, in der Grundton und Dur oder Moll stimmen. Label-Akkorde ohne Terz (Powerchord, sus, vermindert) zählen hier nicht mit |
| `kind` | Anteil der Zeit, in der Grundton und Akkordart stimmen (die 17 Arten der App, z. B. `min7`, `sus4`) |
| `triads` | von den Dreiklängen im Label: Anteil, der als derselbe Dreiklang gemeldet wird |
| `others` | von den übrigen Akkordarten im Label: Anteil, der richtig erkannt wird |
| `changes on the one` | Anteil der Akkordwechsel im Label, die auf den ersten Schlag eines gefundenen Takts fallen. Misst, ob Takt 1 stimmt. Die Zahlen in Klammern in der Trackzeile sind die Verteilung auf die Schläge des Takts |
| `tempo` | richtig heißt: höchstens 4 % neben dem Label. Die Trackzeile nennt sonst `double`, `half` oder `wrong` |
| `meter`, `key root`, `with mode`, `scale` | Anzahl der Tracks, bei denen Taktart, Grundton der Tonart, Tonart mit Modus und Tonleiter-Vorschlag stimmen |
| `timing` | Lage der gefundenen Akkordwechsel gegen das Label, ohne Abzug des Video-Vorlaufs. Zu jedem Wechsel des Grundtons im Label der nächste gefundene Wechsel auf diesen Grundton innerhalb von 2 s; Δ ist gefunden minus Label, positiv heißt zu spät. Ausgegeben: Median von Δ mit Vorzeichen; `apart` (Median von \|Δ\|, nur in der Satzzeile); `within` (Anteil der Label-Wechsel mit \|Δ\| ≤ 0,3 s bei echten Tracks, ≤ 0,1 s bei generierten); `90 % under` (90-%-Wert von \|Δ\|); `drift` (Steigung von Δ über die Zeit je Minute; in der Satzzeile das Mittel der Beträge); `missed` (Anteil ohne gefundenen Wechsel im Fenster). Wechsel, die den Grundton behalten, und Tracks mit `cycle` zählen nicht |
| `tempo steady` | Tempo aus je 8 Schlägen um jeden gefundenen Schlag gegen das Tempo des Labels (im Satz „tempo“ gegen das Tempo der Label-Schläge an dieser Stelle; ohne Tempo im Label gegen das übliche Tempo des Tracks selbst). `at most`: größte Abweichung; `off`: Anteil der Schläge mit mehr als 3 % Abweichung. Halbes und doppeltes Tempo wird vorher umgerechnet. Pausen ohne Schläge (länger als vier Schläge) zählen nicht. In der Satzzeile: größte Abweichung aller Tracks und Mittel von `off` |
| `beats` | nur generierte Sätze: Median des Abstands zwischen jedem Schlag des Generators und dem nächsten gefundenen Schlag (gefunden minus Label), und Anteil innerhalb von ±50 ms |
| `bars` | nur generierte Sätze: Anteil der Taktanfänge des Generators mit einem gefundenen Taktanfang innerhalb von ±50 ms. Misst die Lage der Eins direkt |

Die Messung ist deterministisch: derselbe Stand ergibt dieselben Zahlen (in Phase 0 zweimal gemessen, Ausgabe identisch).

## Stand auf `develop` nach Vorschlag Nr. 9 (gilt heute)

Der Nutzer hat am 2026-11-17 Vorschlag Nr. 9 angenommen: Knappe Akkordarten folgen der Mehrheit im Track, und ein sus4 wird nur bei schwacher Terz gemeldet. Gemessen auf `develop`, zweimal, Ausgabe gleich; `analysisVersion` `2026-11-17h`. Gegenüber dem „Endstand nach Phase 2“ darunter ändern sich nur `kind`, `triads` und `others`; Tempo, Taktart, Tonart, `root`, `maj/min`, `timing`, `tempo steady`, `beats` und `bars` sind in allen Sätzen gleich geblieben.

| Satz | `root` | `maj/min` | `kind` (`triads` / `others`) | vorher `kind` (`triads` / `others`) |
|---|---|---|---|---|
| echt (13) | 95,2 % | 94,7 % | 77,8 % (89,8 / 36,3) | 76,2 % (87,2 / 43,6) |
| generiert (18) | 98,5 % | 97,8 % | 93,8 % (93,8 / –) | 92,4 % (92,4 / –) |
| generiert-2 (18) | 95,6 % | 95,4 % | 70,8 % (94,7 / 39,0) | 70,1 % (93,6 / 39,6) |
| verstimmt (6) | 82,2 % | 82,2 % | 81,2 % (81,2 / –) | 78,1 % (78,1 / –) |
| tempo (8) | 97,8 % | 96,2 % | 96,2 % (96,2 / –) | 95,1 % (95,1 / –) |

Die echten Tracks einzeln (`kind` / `triads` / `others`; alle anderen Werte wie in der Tabelle des Endstands nach Phase 2):

| Track | Werte | vorher |
|---|---|---|
| 3/4 R&B  Backing Track in E Minor | 97,2 / 97,2 / – | gleich |
| D Minor Emotional Rock Guitar Back (`9pH42-82Mz0`) | 87,9 / 91,6 / 0,0 | 87,5 / 88,9 / 55,9 |
| Before The Dawn Guitar Backing Tra | 71,1 / 92,2 / 0,0 | 69,9 / 90,7 / 0,0 |
| Late Night Groove Guitar Backing T | 69,1 / 69,1 / – | gleich |
| Letting Go Guitar Backing Track Ja | 73,5 / 95,3 / 27,3 | 72,3 / 94,5 / 25,1 |
| Losing Control Guitar Backing Trac | 54,0 / 91,0 / 0,0 | 52,2 / 87,9 / 0,0 |
| Back Door Blues Guitar Backing Tra | 92,2 / 88,6 / 97,5 | 88,7 / 82,7 / 97,5 |
| Soulful SMOOTH JAZZ Backing Track (`cycle`) | 73,7 / – / 73,7 | gleich |
| Guitar Rock Ballad Backing Track i | 96,6 / 96,6 / – | gleich |
| Hard Rock Metal Fast Guitar Backin (`cycle`) | 99,0 / 99,0 / – | 83,4 / 83,4 / – |
| Raging Southern Rock Jam in A Mino (`cycle`) | 47,9 / 96,5 / 0,0 | 49,9 / 95,8 / 4,7 |
| One Last Time Guitar Backing Track | 71,5 / 70,4 / 92,1 | 73,4 / 72,4 / 92,1 |

An den Kopien der Robustheitsprüfung steigt `kind` im Satz „echt“ ebenso: andere Rate 75,8 → 77,9 %, MP3 75,9 → 77,8 %. Der Preis ist `others`: im Satz „echt“ 43,6 → 36,3 % (fast ganz `9pH42-82Mz0`), in generiert-2 39,6 → 39,0 %.

## Endstand nach Phase 2

Gemessen am 2026-11-17 mit dem Commit `4179a5b`, zweimal, Ausgabe gleich. Gegenüber dem Ausgangsstand für Phase 2 ändern sich vier Tracks (Before The Dawn, Back Door Blues, One Last Time, `hardrock-colours`), alle anderen sind Zeile für Zeile gleich. Was sich geändert hat und warum, steht in [native/ERGEBNISSE.md](native/ERGEBNISSE.md), „Phase 2“.

| Satz | Tempo | Taktart | Tonart | `root` | `maj/min` | `kind` (`triads` / `others`) | auf der Eins |
|---|---|---|---|---|---|---|---|
| echt (13) | 12/12 | 13/13 | 12/13 | 95,2 % | 94,7 % | 76,2 % (87,2 / 43,6) | 80,6 % |
| generiert (18) | 18/18 | 18/18 | 17/18 | 98,5 % | 97,8 % | 92,4 % (92,4 / –) | 100,0 % |
| generiert-2 (18) | 17/18 | 15/18 | 17/18 | 95,6 % | 95,4 % | 70,1 % (93,6 / 39,6) | 95,0 % |
| verstimmt (6) | 6/6 | 6/6 | 5/6 | 82,2 % | 82,2 % | 78,1 % (78,1 / –) | 100,0 % |
| tempo (8) | – | 8/8 | 8/8 | 97,8 % | 96,2 % | 95,1 % (95,1 / –) | 90,9 % |

| Satz | `timing`: Median Δ | Median \|Δ\| | `within` | 90 % unter | Drift | `missed` | `tempo steady`: höchstens / `off` | `beats`: Median / ±50 ms | `bars` |
|---|---|---|---|---|---|---|---|---|---|
| echt | +102 ms | 125 ms | 93,1 % (0,3 s) | 250 ms | 9 ms/min | 0,5 % | 15,4 % / 0,2 % | – | – |
| generiert | +16 ms | 24 ms | 100,0 % (0,1 s) | 32 ms | 9 ms/min | 0,0 % | 6,8 % / 1,4 % | +15 ms / 99,0 % | 98,6 % |
| generiert-2 | +20 ms | 20 ms | 97,1 % | 101 ms | 169 ms/min | 1,4 % | 59,7 % / 6,4 % | +23 ms / 98,9 % | 92,9 % |
| verstimmt | +12 ms | 22 ms | 83,3 % | 31 ms | 10 ms/min | 16,7 % | 3,1 % / 0,3 % | +14 ms / 98,7 % | 99,0 % |
| tempo | +19 ms | 26 ms | 92,2 % | 154 ms | 109 ms/min | 0,0 % | 27,4 % / 6,4 % | +19 ms / 94,5 % | 85,9 % |

Die echten Tracks einzeln (`root` / `maj/min` / `kind` / `triads` / `others` / auf der Eins; `timing` als Median Δ und `within`; `tempo steady` als `off`):

| Track | Werte | `timing` | `tempo steady` |
|---|---|---|---|
| 3/4 R&B  Backing Track in E Minor | 97,2 / 97,2 / 97,2 / 97,2 / – / 100,0 | +40 ms, 100,0 % | 0,0 % |
| 🎸  Comfortably Numb - Pink Floyd | – / – / – / – / – / – | – | 0,0 % |
| D Minor Emotional Rock Guitar Back (`9pH42-82Mz0`) | 93,5 / 92,2 / 87,5 / 88,9 / 55,9 / 75,0 | +100 ms, 92,9 % | 0,0 % |
| Before The Dawn Guitar Backing Tra | 92,2 / 92,2 / 69,9 / 90,7 / 0,0 / 87,3 | +199 ms, 84,1 % | 0,0 % |
| Late Night Groove Guitar Backing T | 93,2 / 93,2 / 69,1 / 69,1 / – / 37,2 | +120 ms, 92,0 % | 0,0 % |
| Letting Go Guitar Backing Track Ja | 93,8 / 93,6 / 72,3 / 94,5 / 25,1 / 56,9 | +100 ms, 92,5 % | 1,1 % |
| Losing Control Guitar Backing Trac | 92,6 / 92,7 / 52,2 / 87,9 / 0,0 / 79,8 | +160 ms, 84,0 % | 0,0 % |
| Back Door Blues Guitar Backing Tra | 92,2 / 92,2 / 88,7 / 82,7 / 97,5 / 89,3 | +80 ms, 94,6 % | 1,2 % |
| Soulful SMOOTH JAZZ Backing Track (`cycle`) | 99,8 / 99,8 / 73,7 / – / 73,7 / – | – | 0,0 % |
| Guitar Rock Ballad Backing Track i | 96,6 / 96,6 / 96,6 / 96,6 / – / 100,0 | −30 ms, 100,0 % | 0,0 % |
| Hard Rock Metal Fast Guitar Backin (`cycle`) | 99,0 / 99,0 / 83,4 / 83,4 / – / – | – | 0,5 % |
| Raging Southern Rock Jam in A Mino (`cycle`) | 96,9 / 92,1 / 49,9 / 95,8 / 4,7 / – | – | 0,3 % |
| One Last Time Guitar Backing Track | 95,9 / 95,9 / 73,4 / 72,4 / 92,1 / 100,0 | +150 ms, 98,0 % | 0,0 % |

In generiert-2 ändert sich nur `hardrock-colours` (99,2 / 99,2 / 53,8 / – / 53,8); der Satz „tempo“ ist je Track unverändert.

Der Endstand an den Kopien der Robustheitsprüfung (`root` / `maj/min` / `kind` (`triads` / `others`); `timing` innerhalb; `tempo steady` daneben):

| Satz | andere Rate | MP3 |
|---|---|---|
| echt | 95,1 / 94,6 / 75,8 (86,9 / 41,0); 92,8 %; 0,2 % | 95,2 / 94,7 / 75,9 (87,0 / 42,9); 92,5 %; 0,4 % |
| generiert | 98,5 / 97,8 / 94,0 (94,0 / –); 99,6 %; 1,2 % | 98,5 / 97,8 / 92,0 (92,0 / –); 100,0 %; 2,1 % |
| generiert-2 | 94,2 / 93,9 / 67,5 (89,8 / 39,9); 93,5 %; 0,9 % | 95,7 / 95,7 / 70,4 (93,7 / 40,0); 97,4 %; 6,0 % |
| verstimmt | 82,0 / 82,0 / 78,0 (78,0 / –); 82,2 %; 0,0 % | 82,3 / 82,3 / 77,2 (77,2 / –); 83,3 %; 0,3 % |
| tempo | 97,9 / 96,3 / 95,8 (95,8 / –); 93,1 %; 6,5 % | 98,9 / 97,3 / 96,2 (96,2 / –); 94,4 %; 6,9 % |

## Ausgangsstand für Phase 2 (Stand nach Phase 1)

Gemessen am 2026-11-17 mit dem Commit `da62e4e`, dreimal, Ausgabe gleich und Zeile für Zeile gleich dem Endstand von Phase 1 (`a622b53`). Was sich gegenüber dem Stand vor Phase 1 geändert hat und warum, steht in [native/ERGEBNISSE.md](native/ERGEBNISSE.md), „Phase 1“.

| Satz | Tempo | Taktart | Tonart | `root` | `maj/min` | `kind` (`triads` / `others`) | auf der Eins |
|---|---|---|---|---|---|---|---|
| echt (13) | 12/12 | 13/13 | 12/13 | 94,8 % | 94,2 % | 75,7 % (86,7 / 43,1) | 80,6 % |
| generiert (18) | 18/18 | 18/18 | 17/18 | 98,5 % | 97,8 % | 92,4 % (92,4 / –) | 100,0 % |
| generiert-2 (18) | 17/18 | 15/18 | 17/18 | 95,5 % | 95,3 % | 69,8 % (93,6 / 39,1) | 95,0 % |
| verstimmt (6) | 6/6 | 6/6 | 5/6 | 82,2 % | 82,2 % | 78,1 % (78,1 / –) | 100,0 % |
| tempo (8) | – | 8/8 | 8/8 | 97,8 % | 96,2 % | 95,1 % (95,1 / –) | 90,9 % |

| Satz | `timing`: Median Δ | Median \|Δ\| | `within` | 90 % unter | Drift | `missed` | `tempo steady`: höchstens / `off` | `beats`: Median / ±50 ms | `bars` |
|---|---|---|---|---|---|---|---|---|---|
| echt | +93 ms | 130 ms | 90,8 % (0,3 s) | 395 ms | 10 ms/min | 0,5 % | 15,4 % / 0,2 % | – | – |
| generiert | +16 ms | 24 ms | 100,0 % (0,1 s) | 32 ms | 9 ms/min | 0,0 % | 6,8 % / 1,4 % | +15 ms / 99,0 % | 98,6 % |
| generiert-2 | +20 ms | 20 ms | 96,8 % | 101 ms | 171 ms/min | 1,4 % | 59,7 % / 6,4 % | +23 ms / 98,9 % | 92,9 % |
| verstimmt | +12 ms | 22 ms | 83,3 % | 31 ms | 10 ms/min | 16,7 % | 3,1 % / 0,3 % | +14 ms / 98,7 % | 99,0 % |
| tempo | +19 ms | 26 ms | 92,2 % | 154 ms | 109 ms/min | 0,0 % | 27,4 % / 6,4 % | +19 ms / 94,5 % | 85,9 % |

Die echten Tracks einzeln (`root` / `maj/min` / `kind` / `triads` / `others` / auf der Eins; `timing` als Median Δ und `within`; `tempo steady` als `off`; Namen wie in der Ausgabe des Messskripts; `cycle`: Gewinne zählen halb):

| Track | Werte | `timing` | `tempo steady` |
|---|---|---|---|
| 3/4 R&B  Backing Track in E Minor | 97,2 / 97,2 / 97,2 / 97,2 / – / 100,0 | +40 ms, 100,0 % | 0,0 % |
| 🎸  Comfortably Numb - Pink Floyd | – / – / – / – / – / – | – | 0,0 % |
| D Minor Emotional Rock Guitar Back (`9pH42-82Mz0`) | 93,5 / 92,2 / 87,5 / 88,9 / 55,9 / 75,0 | +100 ms, 92,9 % | 0,0 % |
| Before The Dawn Guitar Backing Tra | 89,2 / 87,8 / 66,5 / 86,2 / 0,0 / 87,3 | +170 ms, 74,6 % | 0,0 % |
| Late Night Groove Guitar Backing T | 93,2 / 93,2 / 69,1 / 69,1 / – / 37,2 | +120 ms, 92,0 % | 0,0 % |
| Letting Go Guitar Backing Track Ja | 93,8 / 93,6 / 72,3 / 94,5 / 25,1 / 56,9 | +100 ms, 92,5 % | 1,1 % |
| Losing Control Guitar Backing Trac | 92,6 / 92,7 / 52,2 / 87,9 / 0,0 / 79,8 | +160 ms, 84,0 % | 0,0 % |
| Back Door Blues Guitar Backing Tra | 90,8 / 90,8 / 86,5 / 81,8 / 93,5 / 89,3 | +30 ms, 83,9 % | 1,2 % |
| Soulful SMOOTH JAZZ Backing Track (`cycle`) | 99,8 / 99,8 / 73,7 / – / 73,7 / – | – | 0,0 % |
| Guitar Rock Ballad Backing Track i | 96,6 / 96,6 / 96,6 / 96,6 / – / 100,0 | −30 ms, 100,0 % | 0,0 % |
| Hard Rock Metal Fast Guitar Backin (`cycle`) | 99,0 / 99,0 / 83,4 / 83,4 / – / – | – | 0,5 % |
| Raging Southern Rock Jam in A Mino (`cycle`) | 96,9 / 92,1 / 49,9 / 95,8 / 4,7 / – | – | 0,3 % |
| One Last Time Guitar Backing Track | 95,7 / 95,7 / 73,2 / 72,2 / 92,1 / 100,0 | +150 ms, 97,0 % | 0,0 % |

Die neun Tracks von generiert-2 mit anderen Akkordarten (`root` / `maj/min` / `kind` / `triads` / `others`):

| Track | Werte |
|---|---|
| `blues-sevenths` | 99,4 / 99,4 / 49,6 / – / 49,6 |
| `country-open` | 74,0 / 98,4 / 28,7 / 98,4 / 5,4 |
| `dreamy-colours` | 95,7 / 87,5 / 44,4 / – / 44,4 |
| `funk-sevenths` | 97,2 / 97,2 / 72,4 / – / 72,4 |
| `hardrock-colours` | 97,2 / 97,2 / 49,7 / – / 49,7 |
| `poppunk-colours` | 97,9 / 97,9 / 32,5 / – / 32,5 |
| `psych-open` | 85,0 / 82,9 / 29,1 / 82,9 / 11,1 |
| `reggae-sevenths` | 99,5 / 99,5 / 70,3 / – / 70,3 |
| `rock-open` | 99,1 / 99,1 / 37,0 / 99,1 / 16,3 |

Dieselben Sätze als Kopien in der anderen Abtastrate und als MP3 (Robustheitsprüfung; `root` / `maj/min` / `kind` (`triads` / `others`); `timing` innerhalb; `tempo steady` daneben). So viel bewegen sich die Zahlen, ohne dass sich an der Musik etwas ändert:

| Satz | andere Rate | MP3 |
|---|---|---|
| echt | 94,8 / 94,2 / 75,5 (86,5 / 40,9); 91,3 %; 0,2 % | 94,8 / 94,2 / 75,5 (86,6 / 42,5); 90,4 %; 0,4 % |
| generiert | 98,5 / 97,8 / 94,0 (94,0 / –); 99,6 %; 1,2 % | 98,3 / 97,6 / 92,0 (92,0 / –); 99,5 %; 2,1 % |
| generiert-2 | 94,1 / 93,8 / 67,3 (89,8 / 39,4); 93,2 %; 0,9 % | 95,6 / 95,6 / 70,1 (93,7 / 39,6); 97,1 %; 6,0 % |
| verstimmt | 82,0 / 82,0 / 78,0 (78,0 / –); 82,2 %; 0,0 % | 82,3 / 82,3 / 77,2 (77,2 / –); 83,3 %; 0,3 % |
| tempo | 97,9 / 96,3 / 95,8 (95,8 / –); 93,1 %; 6,5 % | 98,9 / 97,3 / 96,2 (96,2 / –); 94,4 %; 6,9 % |

Der Satz „tempo“ einzeln (`within` 0,1 s / `tempo steady off` / `beats` ±50 ms / `bars`):

| Track | Werte |
|---|---|
| `faster-60-66-psych` | 100,0 / 0,0 / 88,5 / 95,8 |
| `faster-70-84-funk` | 100,0 / 0,0 / 99,0 / 95,8 |
| `live-60-country` | 100,0 / 0,0 / 97,9 / 95,8 |
| `live-76-reggae` | 100,0 / 4,8 / 99,0 / 100,0 |
| `slower-72-64-blues` | 100,0 / 0,0 / 100,0 / 100,0 |
| `slower-80-66-dreamy` | 76,5 / 0,0 / 100,0 / 50,0 |
| `step-64-80-rock` | 100,0 / 0,0 / 100,0 / 100,0 |
| `step-80-62-hardrock` | 60,9 / 46,3 / 71,9 / 50,0 |

## Ausgangsstand vor Phase 1

| Satz | Tempo | Taktart | Tonart | `root` | `maj/min` | `kind` (`triads` / `others`) | auf der Eins |
|---|---|---|---|---|---|---|---|
| echt (13) | 12/12 | 13/13 | 12/13 | 93,6 % | 93,0 % | 74,4 % (85,0 / 43,2) | 80,9 % |
| generiert (18) | 18/18 | 18/18 | 17/18 | 98,5 % | 97,8 % | 92,4 % (92,4 / –) | 100,0 % |
| generiert-2 (18) | 17/18 | 15/18 | 17/18 | 95,3 % | 95,0 % | 69,6 % (93,2 / 39,1) | 93,2 % |
| verstimmt (6) | 6/6 | 6/6 | 5/6 | 82,2 % | 82,2 % | 78,1 % (78,1 / –) | 100,0 % |
| tempo (8) | – | 8/8 | 8/8 | 97,8 % | 96,1 % | 95,1 % (95,1 / –) | 90,9 % |

Zeitlage (gemessen am 2026-11-17 in Phase 0 und unverändert am selben Tag nach dem gemeinsamen Dekodierweg, alle Schläge neu vom Modell gerechnet; die generierten Sätze sind die an diesem Tag gerenderten Dateien):

| Satz | `timing`: Median Δ | Median \|Δ\| | `within` | 90 % unter | Drift | `missed` | `tempo steady`: höchstens / `off` | `beats`: Median / ±50 ms | `bars` |
|---|---|---|---|---|---|---|---|---|---|
| echt | +143 ms | 173 ms | 78,8 % (0,3 s) | 481 ms | 13 ms/min | 0,5 % | 34,5 % / 1,8 % | – | – |
| generiert | +16 ms | 24 ms | 99,6 % (0,1 s) | 32 ms | 17 ms/min | 0,0 % | 15,1 % / 1,6 % | +15 ms / 99,0 % | 98,6 % |
| generiert-2 | +21 ms | 21 ms | 95,3 % | 147 ms | 208 ms/min | 1,4 % | 86,5 % / 9,0 % | +23 ms / 98,9 % | 90,9 % |
| verstimmt | +12 ms | 22 ms | 83,3 % | 31 ms | 10 ms/min | 16,7 % | 3,1 % / 0,3 % | +14 ms / 98,7 % | 99,0 % |
| tempo | +44 ms | 44 ms | 90,5 % | 154 ms | 117 ms/min | 0,0 % | 33,3 % / 12,4 % | +19 ms / 94,5 % | 85,9 % |

Die Drift je Satz ist bei den kurzen generierten Tracks unruhig (wenige Wechsel in 40 s); belastbar ist sie im Satz „echt“ und je Track.

Die echten Tracks einzeln (`root` / `maj/min` / `kind` / auf der Eins; `timing` als Median Δ und `within`; `tempo steady` als `off`):

| Datei | Track | Werte | `timing` | `tempo steady` | Auffällig |
|---|---|---|---|---|---|
| `7Zsqy25jWD4` | 3/4 R&B in e-Moll, 150 bpm | 97,2 / 97,2 / 97,2 / 100,0 | +40 ms, 100,0 % | 0,0 % | |
| `8uve-JgHuyg` | Comfortably Numb, mit Gesang | – | – | 2,3 % | Label hat nur die Tonart |
| `9pH42-82Mz0` | Emotional Rock in d-Moll, 78 bpm | 93,6 / 92,3 / 87,6 / 75,0 | +100 ms, 92,9 % | 0,0 % | wechselt wirklich in der Taktmitte; 7 Wechsel erst am nächsten Taktanfang gemeldet |
| `Before The Dawn …` | d-Dorisch, 102 bpm | 87,6 / 85,8 / 64,9 / 87,3 | +220 ms, 57,1 % | 0,0 % | einzelne Wechsel 1 s zu früh, Ursache offen |
| `Late Night Groove …` | g-Dorisch, 79 bpm | 85,4 / 85,4 / 61,2 / 37,2 | +400 ms, 37,2 % | 0,0 % | Akkorde auf „2 und“ und „4 und“, gemeldet einen halben Schlag später; die Takte liegen richtig |
| `Letting Go …` | d-Moll, 76 bpm | 89,3 / 89,2 / 66,8 / 59,9 | +140 ms, 65,6 % | 14,7 % | vorgezogene Akkorde; Abschnitte auf den Zwischen-Achteln; überzählige Schläge |
| `Losing Control …` | h-Moll, 84 bpm | 91,6 / 91,4 / 51,8 / 79,8 | +190 ms, 75,6 % | 2,5 % | |
| `NX6P1-yDYLQ` | Blues in E, 105 bpm | 90,8 / 90,8 / 86,5 / 89,3 | +80 ms, 83,9 % | 3,0 % | |
| `NZht6wLcNTA` | Smooth Jazz in e-Moll, 70 bpm | 99,8 / 99,8 / 73,7 / – | – | 0,0 % | `cycle` |
| `pGi9fs2HhZ0` | Rockballade in a-Moll, 95 bpm | 96,6 / 96,6 / 96,6 / 100,0 | −30 ms, 100,0 % | 0,0 % | |
| `qmlHtyS_P8k` | Hard Rock in a-Moll, 170 bpm | 99,3 / 99,3 / 83,7 / – | – | 0,5 % | `cycle` |
| `V1r4wWATS9Y` | Southern Rock in a-Moll, 172 bpm | 96,9 / 92,1 / 49,9 / – | – | 0,3 % | `cycle` |
| `_pxC7v2NAAA` | One Last Time in B-Dur, 132 bpm | 95,7 / 95,7 / 73,2 / 100,0 | +150 ms, 97,0 % | 0,2 % | Tonart als g-Moll gemeldet |

Der Satz „tempo“ einzeln (`within` 0,1 s / `tempo steady off` / `beats` ±50 ms / `bars`):

| Track | Werte | Auffällig |
|---|---|---|
| `faster-60-66-psych` | 100,0 / 39,4 / 88,5 / 95,8 | Tempo an vier von zehn Schlägen daneben |
| `faster-70-84-funk` | 100,0 / 2,2 / 99,0 / 95,8 | |
| `slower-72-64-blues` | 100,0 / 6,7 / 100,0 / 100,0 | |
| `slower-80-66-dreamy` | 76,5 / 0,0 / 100,0 / 50,0 | Schläge richtig, aber nur die Hälfte der Taktanfänge getroffen |
| `step-64-80-rock` | 100,0 / 0,0 / 100,0 / 100,0 | |
| `step-80-62-hardrock` | 47,8 / 46,3 / 71,9 / 50,0 | Tempo an knapp der Hälfte der Schläge daneben, gemeldet 122 bpm, nur die Hälfte der Taktanfänge getroffen |
| `live-76-reggae` | 100,0 / 4,8 / 99,0 / 100,0 | durchgehend doppelt gezählt (152) |
| `live-60-country` | 100,0 / 0,0 / 97,9 / 95,8 | durchgehend doppelt gezählt (120) |

## Phase 0: Diagnose des Versatzes und Messung erweitern

**Erledigt am 2026-11-17.** Dieser Abschnitt ist der Auftrag, wie er gestellt war. Das Ergebnis steht in [native/DIAGNOSE.md](native/DIAGNOSE.md): Die Positionsanzeige der App läuft nicht nach (im Mittel 1 ms); der Versatz kommt aus der Analyse (ein Akkord je Schlag bei vorgezogenen Akkorden, Fehler beim Halbieren doppelt gezählter Abschnitte). Abweichungen von der Beschreibung unten: `timing` sucht den nächsten Wechsel auf denselben Grundton; `tempo steady` lässt Pausen aus und gilt auch für den Satz „tempo“ (gegen das Tempo der Label-Schläge). Neue Werkzeuge für die Diagnose: `beats-inspect.mjs`, `change-times.mjs`, `position-check.mjs`; Protokolle hinter `BTG_ANALYSIS_LOG` (Regeln für Schläge und Takte) und `BTG_POSITION_LOG` (Anzeige gegen Engine in der App).

### Warum die heutige Messung den Versatz kaum sieht

- `changes on the one` zieht je Track den mittleren Abstand zwischen Label-Wechsel und Schlag ab (`offset`). Ein gleichbleibender Versatz verschwindet damit aus der Zahl.
- Kein Maß erfasst, ob der Versatz im Lauf eines Tracks wächst.
- Tempowechsel innerhalb eines Tracks misst kein Satz. Die generierten Tracks haben ein vollkommen gleichmäßiges Tempo.
- `root` von 94 % im Satz „echt“ spricht dagegen, dass das JSON von `btg_analyze` auf diesen Tracks im Mittel eine Sekunde zu spät liegt. Bei einem Wechsel alle 2 bis 3 s würde eine Sekunde Versatz 30 bis 50 Punkte kosten. Der Versatz, den der Nutzer sieht, entsteht also wahrscheinlich in der App, bei Tracks mit schwankendem Tempo oder nur stellenweise. Das ist zu prüfen, nicht anzunehmen.

### Mögliche Ursachen

| Muster des Versatzes | typische Ursache |
|---|---|
| gleichbleibend über den ganzen Track | Latenz der Wiedergabe, Analysefenster mit Zeitstempel am Fensteranfang statt in der Mitte, unterschiedliche Verzögerung der MP3-Dekoder in Analyse und Wiedergabe |
| wächst gleichmäßig mit der Zeit | Samplerate falsch umgerechnet (Datei, Analyse, Gerät oder Host), Raster aus einem gerundeten oder festen `bpm` gerechnet statt aus `beats` |
| springt um genau einen Schlag (bei 60 bis 80 bpm 0,75 bis 1 s) | Eins falsch gesetzt, Akkordwechsel an den falschen Schlag gebunden, Wechselkosten schieben den Wechsel auf den nächsten Taktanfang |
| nur in bestimmten Abschnitten | Tempo schwankt oder wechselt, das Modell verliert den Puls, die eigene Schlagsuche übernimmt |
| alte Anzeige trotz neuem Stand | gemerkte Ergebnisse, weil `analysisVersion` nicht hochgezählt wurde |

### Die erste Spur: „Letting Go“

Dieser Track fällt schon heute an drei Stellen auf:

- `beats-compare.mjs`: Nur 70 % der Schläge des Python-Originals werden getroffen. Bei fast allen anderen Tracks sind es 99,9 bis 100 %. Die eigenen Regeln in `analysis.cpp` greifen hier also stark ein: Schläge ergänzen, eine Zählweise angleichen oder die eigene Schlagsuche, wenn das Modell den Puls verliert.
- `changes on the one`: 60 % (100/22/20/25). Die Wechsel verteilen sich auf alle Schläge.
- Das Tempo ist laut Label und Video gleichbleibend, die App meldet ein schwankendes.

Die naheliegende Vermutung: Das Modell liefert hier gleichmäßige Schläge, und eine der eigenen Regeln macht daraus ein schwankendes Tempo. Damit verrutschen Takte und Akkordwechsel, denn die Akkorde werden je Schlag bestimmt. Zu prüfen ist:

1. Sind die Schläge in `beats-final` (Python-Original) für „Letting Go“ gleichmäßig? Abstände der Schläge und lokales Tempo je 8 Schläge über den ganzen Track ausgeben.
2. Dasselbe für die Schläge im JSON von `btg_analyze`. Wo weichen sie ab, und welche Regel in `analysis.cpp` greift an diesen Stellen? Mit Protokoll oder Haltepunkt belegen, nicht aus dem Code erraten.
3. Liegen die erkannten Akkordwechsel im JSON an diesen Stellen später als im Label? Dann kommt der Versatz aus der Analyse. Liegen sie richtig und die App zeigt sie trotzdem später, kommt er aus der App.
4. Gibt es weitere Tracks, bei denen die eigenen Regeln stark eingreifen (`matched` unter 99 %) und bei denen das Tempo laut Label gleich bleibt? Dort dasselbe prüfen. „Comfortably Numb“ (87 %) hat keine Akkord-Labels, zeigt aber, ob das Tempo dort auch schwankt.

### Vorgehen

1. „Letting Go“ wie oben prüfen, dazu zwei weitere echte Tracks mit Zeit-Labels und einen generierten zum Vergleich.
2. Für das JSON von `btg_analyze`: zu jedem Label-Wechsel den nächsten erkannten Wechsel auf denselben Grundton suchen. Den vorzeichenbehafteten Abstand (erkannt minus Label, positiv heißt zu spät) je 30 s des Tracks als Tabelle ausgeben. Das Muster nach der Tabelle oben bestimmen.
3. Den App-Code lesen (`native/app`): Woher kommt die Position, zu der Akkord und Takt angezeigt werden? Welche Uhr, welche Samplerate, gibt es Latenzausgleich, wie oft wird die Anzeige aktualisiert? Werden `beats` und `bars` direkt benutzt oder aus `bpm` gerechnet? Was passiert bei einer Datei mit 44,1 kHz an einem Gerät mit 48 kHz?
4. Wo es nötig ist, die Vermutung mit einem Protokoll belegen: Wiedergabeposition in Samples, Samplerate von Datei und Gerät, angezeigter Akkord und dessen `t`. Das Protokoll nur hinter einem Schalter oder im Debug-Bau, als eigener Commit.
5. `native/DIAGNOSE.md` schreiben: Muster mit Zahlen, Ursache oder Ursachen, Belege, Vorschlag.
6. Liegt die Ursache in der App, ist sie klar belegt und der Fix klein: beheben, eigener Commit, mit Test, wo das geht. Sonst den Vorschlag in `native/VORSCHLAEGE.md` beschreiben; der Nutzer entscheidet.

### Messung erweitern

In `native/tools/analysis-score.mjs` und `native/tools/analysis-set.mjs`:

- Alle Prozentzahlen mit einer Nachkommastelle ausgeben.
- Neue Zahl `timing` je Track und je Satz. Zu jedem Wechsel im Label (nur Tracks mit Zeiten, nicht `cycle`) den nächsten erkannten Akkordwechsel innerhalb von ±2 s suchen. Der Abstand Δ ist erkannt minus Label, **ohne** den Vorlauf der Videoanzeige abzuziehen. Ausgeben:
  - Median von Δ, mit Vorzeichen
  - Anteil mit |Δ| ≤ 0,3 s im Satz „echt“, ≤ 0,1 s in den generierten Sätzen
  - 90-%-Wert von |Δ|
  - Drift: Steigung von Δ über die Zeit in ms je Minute
  - Anteil der Label-Wechsel ohne erkannten Wechsel im Fenster
- Neue Zahl `tempo steady` je Track und je Satz, für Tracks mit einem einzigen `bpm` im Label. Lokales Tempo je 8 Schläge aus den gemeldeten `beats` bilden. Ausgeben: größte Abweichung vom Label in Prozent und Anteil der Schläge, an denen das lokale Tempo mehr als 3 % abweicht. Halbes und doppeltes Tempo vorher auf die Zählweise des Labels umrechnen. „Letting Go“ muss hier heute auffallen. Fällt der Track nicht auf, ist die Zahl falsch gebaut.
- Für die generierten Sätze die genauen Schlag- und Taktzeiten des Generators in die Labels schreiben (`beats`, `downbeats`). Messen: Median des Abstands der Schläge und Anteil der Schläge innerhalb von ±50 ms.
- Neuer Satz „tempo“ mit `node native/tools/analysis-set.mjs --tempo` in `native/build/analysis-set-tempo-labeled`, mit genauen Labels. Etwa 8 Tracks: allmählich schneller, allmählich langsamer, ein harter Tempowechsel, leichte Schwankung um ±3 % wie bei live eingespielter Musik, je einmal bei 60 bis 80 bpm.
- Den Ausgangsstand aller Sätze neu messen und oben eintragen.

Nach Phase 0 sind `native/tools` und alle Labels gesperrt.

## Akkorde: woran man erkennt, ob eine Änderung gut ist

Eine Änderung bleibt, wenn A oder B gilt und dazu alle Punkte 2 bis 6.

- **A:** `root` und `maj/min` im Satz „echt“ steigen zusammen um mindestens einen Prozentpunkt, und keiner der beiden fällt.
- **B:** `kind` im Satz „echt“ steigt um mindestens einen Punkt, und `root` und `maj/min` fallen dort nicht.

Für A und B genügen 0,5 Punkte, wenn mindestens 4 echte Tracks gewinnen und keiner mehr als einen Punkt verliert.

2. In keinem anderen Satz fällt `root` oder `maj/min` um mehr als einen Punkt.
3. Die Zähler für Tempo, Taktart und Tonart fallen in keinem Satz.
4. `triads` fällt in keinem Satz. Ein Septakkord, der auf einem Dreiklang gemeldet wird, ist schlechter als einer, der fehlt.
5. Kein einzelner echter Track verliert mehr als drei Punkte bei `root`. Ist der Grund bekannt und in `native/ERGEBNISSE.md` beschrieben, darf die Änderung trotzdem bleiben, wenn die Gewinne sich über mehrere Tracks verteilen.
6. `native\build.ps1 -NoApp` läuft durch (die Tests in `native/core/tests` bleiben grün), und `timing` wird in keinem Satz schlechter: Der Anteil fällt um höchstens einen Punkt, der Median von |Δ| steigt um höchstens 50 ms.

Zur Größenordnung: Ein Punkt bei einem Track sind 2 bis 3 Sekunden Musik. Verliert oder gewinnt ein einzelner Track 13 Punkte, bewegt das den Satz „echt“ um einen Punkt. Ein Gewinn, der nur aus einem Track kommt, ist verdächtig; einer, der sich über mehrere Tracks verteilt, ist belastbar. Die Schwellen sind Faustregeln aus dieser Rechnung, keine gemessenen Werte.

### Die unangetasteten Tracks

Fünf echte Tracks hat der Nutzer zurückgehalten. Auf ihnen wird nicht optimiert, und der Agent öffnet sie nicht, misst sie nicht und sucht nicht nach ihnen. Am Schluss misst der Nutzer sie selbst, einmal. Steigen sie mit, ist die Verbesserung echt. Steigt „echt“ und fallen sie, ist die Änderung auf die Optimier-Tracks zugeschnitten.

## Takte und Zeitlage: was gemessen wird und woran man erkennt, ob eine Änderung gut ist

Zur Takterkennung gehören das Tempo, die Taktart, die Lage der Taktanfänge (wo die Eins ist) und die zeitliche Lage von Schlägen und Akkordwechseln. Im JSON von `btg_analyze` sind das `bpm`, `meter`, `beatsPerBar`, `beats` (Zeit jedes Schlags in Sekunden) und `bars` (Nummer des Schlags, mit dem jeder Takt beginnt). Der Beginn eines Akkords (`chords[].t`) liegt auf einem Schlag oder, ab dem Versuch zu Vorschlag Nr. 4, ein Achtel davor.

**Hauptmaße für Takte und Zeitlage sind `timing` und `tempo steady`** (Entscheidung des Nutzers, 2026-11-17). `changes on the one` dient nur noch als Sicherung, weil vorgezogene Akkorde diese Zahl verfälschen. Die Lage der Eins messen die generierten Sätze direkt (`bars`).

| Zahl | Bedeutung | Stand vor Phase 1: echt / generiert / generiert-2 |
|---|---|---|
| `tempo` | Tracks, deren Tempo höchstens 4 % neben dem Label liegt. In 6/8 und 12/8 zählt der punktierte Schlag (12/8 bei 60 bpm) | 12/12, 18/18, 17/18 |
| `meter` | Tracks, deren Taktart genau der des Labels entspricht (ohne Angabe im Label gilt 4/4) | 13/13, 18/18, 15/18 |
| `changes on the one` | Anteil der Akkordwechsel im Label, die auf die Eins eines gefundenen Takts fallen | 80,9 %, 100,0 %, 93,2 % |
| `timing` | Lage der Akkordwechsel gegen das Label: Anteil innerhalb von 0,3 s (echt) bzw. 0,1 s (generiert) | 78,8 %, 99,6 %, 95,3 %; Satz „tempo“ 90,5 % |
| `tempo steady` | Anteil der Schläge, an denen das Tempo über 8 Schläge mehr als 3 % vom Label abweicht | 1,8 %, 1,6 %, 9,0 %; Satz „tempo“ 12,4 % |
| `beats`, `bars` | generierte Sätze: Schläge und Taktanfänge des Generators mit einem gefundenen innerhalb von ±50 ms | Schläge 99,0 %, 98,9 %; Taktanfänge 98,6 %, 90,9 %; Satz „tempo“ 94,5 % und 85,9 % |

### Wie die Lage der Eins gemessen wird

Für die echten Tracks gibt es keine beschrifteten Schläge oder Taktstriche. Die Lage der Eins wird deshalb über die Akkordwechsel gemessen: Das Skript sucht zu jedem Wechsel im Label den nächsten gefundenen Schlag und zählt, der wievielte Schlag seines Takts das ist. Vorher zieht es je Track den Vorlauf der Videoanzeige ab (den mittleren Abstand zwischen Wechsel und Schlag; in der Trackzeile als `offset`). Ein `offset` über 0,3 s ist selbst schon ein Hinweis auf Versatz und gehört in die Diagnose.

Die Trackzeile zeigt die Verteilung in Klammern, z. B. `37 % (42/24/0/47)`: 42 Wechsel auf der Eins, 24 auf dem zweiten Schlag, keiner auf dem dritten, 47 auf dem vierten. So liest man sie:

- Häufung auf dem letzten Schlag: Die gefundene Eins liegt einen Schlag zu spät.
- Häufung auf dem zweiten Schlag: Die gefundene Eins liegt einen Schlag zu früh.
- Häufung in der Taktmitte (dritter Schlag im 4/4): Der Takt ist um einen halben Takt verschoben, oder der Track wechselt wirklich in der Taktmitte.

Grenzen dieser Messung:

- Sie setzt voraus, dass Akkorde auf der Eins wechseln. Ein Track, der wirklich in der Taktmitte wechselt, erreicht nie 100 %. Bei `9pH42-82Mz0` (75 %, Verteilung 78/0/26/0) ist das vermutlich so; geprüft ist es nicht.
- Tracks mit `cycle`-Label und der Track ohne Akkorde haben keinen Wert. Im Satz „echt“ zählen deshalb nur 9 Tracks. Ein einzelner Track bewegt die Zahl des Satzes um bis zu 11 Punkte; allein „Late Night Groove“ (37 %) kostet 7.
- Halbes und doppeltes Tempo ist eine Frage der Zählweise. Die Messung wertet es als falsch; in der App korrigiert es der Nutzer mit einem Klick („Tempo zählen ÷2 / ×2“). Eine falsche Taktart kann er nicht korrigieren.
- Tempowechsel misst bis Phase 0 kein Satz, danach der Satz „tempo“. Dazu gibt es einen Test in [native/core/tests/test_analysis.cpp](native/core/tests/test_analysis.cpp) (90 auf 126 bpm).

### Wo es heute hakt

Die Tabelle ist der Stand vor Phase 1. Danach (Belege in [native/ERGEBNISSE.md](native/ERGEBNISSE.md)): Late Night Groove `timing` 92,0 % (vorgezogene Akkorde liegen jetzt auf dem Achtel; „auf der Eins“ bleibt bei 37 % und misst dort weiter die vorgezogenen Akkorde). Letting Go `tempo steady` 1,1 %, `timing` 92,5 %, die Abschnitte liegen auf den Vierteln. Offen: Before The Dawn und Back Door Blues melden einzelne Wechsel zwei Schläge zu früh (Akkordbewertung, Phase 2); `9pH42-82Mz0` hört an drei Stellen F, wo das Label C nennt; `step-80-62-hardrock` (Modell wird verworfen, eigene Schlagsuche meldet 122 bpm); `slower-80-66-dreamy` (Taktanfänge des Modells anfangs einen Schlag zu früh); `reggae-128-60` 6/8 statt 12/8; `hardrock-68-180` und `rock-34-160` unverändert.

| Track | Satz | Befund |
|---|---|---|
| Late Night Groove | echt | 37 % auf der Eins (42/24/0/47). Phase 0: Die Takte liegen richtig; der Track wechselt auf „2 und“ und „4 und“, die Analyse meldet diese Wechsel einen halben Schlag später (`timing` +400 ms, 37,2 %). Die Zahl misst hier die vorgezogenen Akkorde, nicht die Eins |
| Letting Go | echt | 60 % (100/22/20/25). Phase 0: Der Track läuft gleichmäßig mit 76,0 bpm. Das Modell zählt sieben Abschnitte doppelt so schnell; beim Halbieren bleiben 84 Schläge auf den Zwischen-Achteln und 22 überzählige Schläge stehen, 14 von 190 Takten haben die falsche Länge (`tempo steady` 14,7 %). Dazu vorgezogene Akkorde wie bei Late Night Groove |
| `9pH42-82Mz0` | echt | 75 % (78/0/26/0): Wechsel auf dem dritten Schlag |
| `hardrock-68-180` | generiert-2 | 4/4 statt 6/8, 53 % |
| `reggae-128-60` | generiert-2 | 6/8 statt 12/8 |
| `rock-34-160` | generiert-2 | 12/8 bei 106 bpm statt 3/4 bei 160 bpm, 64 % |
| `country-54-72` | generiert-2 | 5/4 richtig erkannt, aber 67 % auf der Eins |

### Wann eine Änderung an den Takten oder der Zeitlage gut ist

Eine Änderung bleibt nur, wenn alle folgenden Punkte gelten:

1. Mindestens eins davon trifft zu (Hauptmaße `timing` und `tempo steady`):
   - Der `timing`-Anteil im Satz „echt“ oder „tempo“ steigt um mindestens 2 Punkte.
   - `tempo steady` (`off`) wird im Satz „echt“ oder „tempo“ besser.
   - Ein Zähler für Tempo oder Taktart steigt in einem Satz.
   - Die Drift im Satz „tempo“ halbiert sich.
2. Kein Zähler für Tempo oder Taktart fällt in irgendeinem Satz.
3. Sicherung für die Eins: `changes on the one` fällt in keinem Satz um mehr als einen Punkt, und kein einzelner Track verliert mehr als fünf Punkte, ohne dass der Grund bekannt ist. Ein Gewinn ist diese Zahl nicht mehr. `bars` fällt in keinem generierten Satz um mehr als einen Punkt.
4. `root` und `maj/min` fallen in keinem Satz um mehr als einen Punkt. Die Akkorde hängen von den Takten ab; eine bessere Eins hebt sie meist mit.
5. `timing` wird in keinem Satz schlechter (Anteil höchstens −1 Punkt, Median von |Δ| höchstens +50 ms).
6. `tempo steady` wird in keinem Satz schlechter. Eine Regel, die ein gleichbleibendes Tempo glättet, darf einen echten Tempowechsel nicht wegglätten; das prüfen der Satz „tempo“ und der Test für 90 auf 126 bpm.
7. `native\build.ps1 -NoApp` läuft durch. Die Tests prüfen unter anderem Schläge auf einem Klick-Track und den Tempowechsel.

**Keine pauschale Zeitverschiebung, um an die Labels heranzukommen.** Die Labels der echten Tracks sind bis zu 0,2 s früh. Ob die Lage absolut stimmt, zeigen nur die generierten Sätze mit ihren genauen Labels. Ein Median von Δ zwischen 0 und +0,2 s im Satz „echt“ ist deshalb kein Fehler.

Weil im Satz „echt“ nur 9 Tracks Zeit-Labels haben, zählt der Blick auf die einzelnen Tracks mehr als die Zahl des Satzes. Die Schwellen sind Faustregeln, keine gemessenen Werte.

### Werkzeuge für die Takte

Den Anteil des Modells sieht man, wenn man es abschaltet; dann sucht `analysis.cpp` die Schläge selbst:

```powershell
$env:BTG_NO_BEAT_MODEL = '1'
node native/tools/analysis-score.mjs C:\dev\samples-raw\analysis-tests native\build\analysis-set native\build\analysis-set-2
Remove-Item Env:BTG_NO_BEAT_MODEL
```

| ohne Modell | Tempo | Taktart | `root` | auf der Eins |
|---|---|---|---|---|
| echt | 9/12 | 11/13 | 93 % | 75 % |
| generiert | 14/18 | 18/18 | 90 % | 89 % |
| generiert-2 | 10/18 | 13/18 | 88 % | 76 % |

Das ist auch der Stand der App, wenn das Modell fehlt.

Ob ein Fehler vom Modell kommt oder vom eigenen Nachbau seiner Vor- und Nachverarbeitung, zeigen die Schläge des Python-Originals in `C:\dev\samples-raw\analysis-tests\beats-final`:

```powershell
node native/tools/analysis-score.mjs C:\dev\samples-raw\analysis-tests --beats C:\dev\samples-raw\analysis-tests\beats-final
```

Mit den Schlägen des Originals ergibt die Messung im Satz „echt“ dieselben Zahlen wie mit dem Nachbau (94 %, 93 %, 81 %). Der Nachbau ist also nicht die Fehlerquelle für die Akkorde und die Eins. Für einen zeitlichen Versatz ist das damit nicht geklärt, weil der `offset` abgezogen wird.

```powershell
node native/tools/beats-compare.mjs C:\dev\samples-raw\analysis-tests C:\dev\samples-raw\analysis-tests\beats-final
```

`beats-compare.mjs` nennt je Track, wie viele Schläge des Originals die Analyse auf 20 ms trifft (`matched`) und wie viele sie zusätzlich meldet (`extra`). Verglichen werden die Schläge, die die Analyse am Ende ausgibt, nicht die rohen des Modells. Wo sie Schläge ergänzt, eine Zählweise angleicht oder im 12/8 Achtel ausgibt, weicht sie mit Absicht ab: Die meisten Tracks liegen bei 99,9 bis 100 % `matched`, „Letting Go“ bei 70 %, „Comfortably Numb“ bei 87 %. Die Zeile `worst` am Ende ist kein Fehlermaß. Das Werkzeug zeigt, an welchen Tracks die eigenen Regeln eingreifen.

Schon gemessen und verworfen oder ersetzt:

- Takte vom ersten Taktanfang des Modells an durchzählen: schlechtere Lage der Eins. Jetzt wird vom jeweils letzten Taktanfang des Modells aus gezählt.
- Jeden schneller gezählten Abschnitt an das übliche Tempo angleichen: machte aus einem echten Tempowechsel halbes Tempo (124 als 62 bpm). Jetzt wird nur angeglichen, was auf 6 % genau halb oder doppelt so schnell gezählt ist.
- Die kleine Fassung des Modells (10 MB) statt der großen (83 MB): misst gleich.

## Fehler suchen

```powershell
node native/tools/analysis-score.mjs C:\dev\samples-raw\analysis-tests --confusions
```

`--confusions` nennt je Track, welche Label-Akkorde als was gehört wurden, in Sekunden (`G -> Dm 12 s`), und je Satz, welche Akkordart als welche gemeldet wurde.

Ein einzelner Track: `native\build\core\Release\btg_analyze.exe <Audiodatei> [Ausgabe.json]`. Das JSON enthält `bpm`, `meter`, `beats`, `bars`, `key`, `scale`, `tuningCents` und `chords` (je Akkord `t`, `end`, `chord`, `kind`, `root`, `minor`). Das Messskript legt das JSON jedes Tracks unter `native/build/analysis/` ab.

Die Zahlenwerte des Algorithmus (Schwellen, Gewichte) heißen im Code `knob("NAME", Wert)`. Mit einem Tuning-Bau lassen sie sich ohne Neubau durchprobieren:

```powershell
native\build.ps1 -NoApp -Tuning
native\tools\analysis-sweep.ps1 IN_KEY 0 0.05 0.1 0.2      # misst die drei Sätze je Wert
native\tools\analysis-sweep.ps1 NOTHING 0                  # einmal mit den eingebauten Werten
```

In einem Bau ohne `-Tuning` sind die Werte fest. Ein gefundener besserer Wert wird im Code eingetragen und ohne `-Tuning` nachgemessen.

Höchstens 5 Werte je Knopf. Bei 13 Tracks gewinnt unter vielen Werten fast immer einer zufällig. Ein neuer Wert zählt nur, wenn die generierten Sätze nicht schlechter werden. Begründete Änderungen am Verfahren haben Vorrang vor Feintuning.

## Akkorde: bekannte Schwächen und schon Verworfenes

Wo am meisten fehlt:

- Andere Akkordarten als Dreiklänge: in den echten Tracks werden 43 % erkannt, sus2 und Powerchords fast nie. Am schwächsten bei `kind`: `V1r4wWATS9Y` (50 %), `Losing Control` (52 %), `Late Night Groove` (61 %).
- Dorische Tracks liegen bei 85 bis 88 % Grundton.
- Die Tonart wird in Einzelfällen als Paralleltonart gemeldet (`_pxC7v2NAAA`: B-Dur als g-Moll).
- In generiert-2 werden 39 % der anderen Akkordarten erkannt, bei 93 % der Dreiklänge.

Schon gemessen und verworfen (Einzelheiten in [native/ERGEBNISSE.md](native/ERGEBNISSE.md) und [native/UEBERGABE.md](native/UEBERGABE.md)):

- Bassgewicht 0,15 bis 0,8 und andere Wechselkosten: innerhalb eines Punkts.
- Jeden Schlag mit ähnlich klingenden Stellen mitteln: bei jeder Schwelle schlechter (`maj/min` echt 92 auf 88 %).
- Sext-Akkord als Moll-Septakkord der Paralleltonart lesen: kein Gewinn.
- Leitereigene Septimen leichter gelten lassen: mehr erkannte Septakkorde, aber mehr falsche auf Dreiklängen.
- Getrennte Stimmen (Stems) als Eingabe: vom Nutzer vorerst gestrichen.

## Ablauf je Versuch (Phase 1 und 2)

1. `native/ERGEBNISSE.md` lesen. Ist die Idee schon gemessen, nicht wiederholen.
2. Eine Hypothese, eine Änderung, entweder an den Takten bzw. der Zeitlage oder an den Akkorden, nicht beides. Vorher mit `timing`, `tempo steady` oder `--confusions` begründen, welche Tracks gewinnen sollen.
3. Bauen, alle Sätze messen.
4. Regeln erfüllt: ein Commit (englisch) mit den `==`-Zeilen in der Nachricht. Nicht erfüllt: `git restore native/core native/app`, nur den Code zurücksetzen, nicht `native/ERGEBNISSE.md`.
5. Den Versuch in `native/ERGEBNISSE.md` eintragen: Hypothese, Änderung, Zahlen vorher und nachher, welche Tracks gewonnen und verloren haben, behalten oder verworfen.

## Wenn eine Entscheidung des Nutzers nötig ist

Gilt für neue Abhängigkeiten, eine Änderung am Ausgabeformat oder an der Schnittstelle zur App, eine Laufzeit über 22 s je Track oder einen größeren Umbau der App. Nicht umsetzen, sondern in `native/VORSCHLAEGE.md` beschreiben (was, warum, erwarteter Gewinn, Aufwand) und mit einer anderen Idee weitermachen. Nicht auf eine Antwort warten.

## Schluss

Aufhören nach 18 Versuchen in Phase 2 oder wenn in Phase 2 6 Versuche in Folge verworfen wurden. Dann:

0. Den Endstand auch an den Kopien der Robustheitsprüfung messen, und ein Prüf-Subagent mit frischem Kontext prüft den Lauf wie in Phase 1; berechtigte Befunde beheben.
1. `analysisVersion` in [native/app/PluginProcessor.cpp](native/app/PluginProcessor.cpp) einmal hochzählen.
2. `native\build.ps1 -NoApp` laufen lassen.
3. `native/BERICHT.md` schreiben: Diagnose des Versatzes und was daraus wurde, Ausgangs- und Endstand aller Sätze, was geholfen hat, was nicht, offene Ideen, Label-Verdachtsfälle, Vorschläge.

Die unangetasteten Tracks misst der Nutzer selbst.

## Regeln des Projekts

- Der Kern (`native/core`) bleibt C++20 ohne JUCE und muss unter Linux bauen. Keine neue Abhängigkeit ohne Zustimmung des Nutzers, nichts unter GPL, AGPL oder mit NC-Klausel.
- Testtracks, Videos und Labels bleiben außerhalb des Repositorys. Labels und, ab Phase 1, `native/tools` werden nicht geändert.
- Ändert sich das Ergebnis der Analyse, `analysisVersion` in [native/app/PluginProcessor.cpp](native/app/PluginProcessor.cpp) hochzählen, aber erst am Schluss einmal. Beim Prüfen in der App während des Laufs gemerkte Ergebnisse vorher löschen.
- Korrektheit geht vor Rechenzeit. Die Analyse braucht heute 5 bis 11 s je Track; höchstens 22 s, sonst Vorschlag statt Umsetzung.
- Jeden Versuch mit seinen Zahlen in `native/ERGEBNISSE.md` festhalten, auch den verworfenen.
- Commits auf Englisch, ein Thema je Commit, nicht pushen, nichts nach `main` oder `feat/native-spike`.