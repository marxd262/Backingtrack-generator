# Diagnose: Akkorde und Takte passen zeitlich nicht zum Audio

Phase 0 aus [Erkennung messen.md](../Erkennung%20messen.md), gemessen am 2026-11-17 auf dem Branch `exp/analysis-agent`. Behoben ist nichts; die Vorschläge stehen in [VORSCHLAEGE.md](VORSCHLAEGE.md). Alle Zahlen stammen aus dem Bau ohne `-Tuning` und lassen sich mit den Befehlen am Ende wiederholen.

## Ergebnis in Kürze

1. **Die Positionsanzeige der App läuft der Engine nicht nach.** Gemessen in der echten App: im Mittel 1 ms, höchstens 9 ms Abstand. Die Fortschreibung mit der Browser-Uhr ist nicht die Ursache.
2. **Die Analyse setzt Akkordwechsel zu spät**, und zwar um einen halben Schlag (bei 76 bpm 0,39 s). Das hat zwei Gründe:
   - Der Track wechselt den Akkord oft schon auf dem Achtel vor dem Schlag (vorgezogen). Die Analyse kennt nur einen Akkord je Schlag und meldet den Wechsel auf dem Schlag danach.
   - In einzelnen Abschnitten von „Letting Go“ liegen die ausgegebenen Schläge selbst auf den Zwischen-Achteln.
3. **Das schwankende Tempo bei „Letting Go“ entsteht in `analysis.cpp`, nicht im Audio.** Der Track läuft gleichmäßig mit 76,0 bpm. Das Modell zählt ihn abschnittsweise doppelt so schnell, und beim Halbieren bleiben falsche und überzählige Schläge stehen.
4. **Die App analysiert nicht genau dasselbe wie das Messwerkzeug.** Ihre Schläge liegen 20 ms später, und bei „Letting Go“ fallen die Entscheidungen an den Abschnittsgrenzen teils anders aus.

Die Vermutung der Anleitung („das Modell liefert gleichmäßige Schläge, eine eigene Regel macht daraus ein schwankendes Tempo“) stimmt nur halb: Schon das Modell zählt ungleichmäßig, die Regel repariert das meiste und macht an den Übergängen Fehler.

## (a) Die Schläge bei „Letting Go“

**Der Track ist gleichmäßig.** Alle 1026 Schläge des Modells liegen auf einem festen Achtel-Raster von 152,003 Achteln je Minute (76,0 bpm): im Mittel 7 ms daneben, keiner mehr als 60 ms.

**Das Modell wechselt die Zählweise.** In sieben Abschnitten zählt es Achtel statt Viertel (603 der 1026 Schläge). Das Python-Original tut dasselbe (1035 Schläge, davon 402 Abstände in Vierteln, die übrigen in Achteln); der Nachbau ist also nicht die Fehlerquelle.

**Was `analysis.cpp` daraus macht** (Protokoll mit `BTG_ANALYSIS_LOG=1`): 299 Schläge gestrichen, 2 ergänzt, 729 bleiben. Drei Fehler bleiben dabei stehen:

| Fehler | Umfang | Beleg im Protokoll |
|---|---|---|
| Der Abschnitt wird auf den Zwischen-Achteln weitergezählt | 30,5 bis 59 s (37 Schläge), 417,3 bis 449 s (41), 536 bis 540 s (6): zusammen 84 von 729 Schlägen | Der erste Zwischenschlag des Abschnitts wird behalten (`30.480 … around 0.420 faster 0 … keep`), danach jeder zweite ab dort. 44 der gestrichenen Schläge waren Taktanfänge des Modells |
| Ein überzähliger Schlag auf halber Strecke | 22 Schläge, z. B. bei 107,08, 113,40, 116,56, 152,08, 208,92, 356,56 s | `107.080 0.400 0.780 0 0 0 keep`: Abstand halb, Umgebung nicht als „schnell“ markiert |
| Takte mit falscher Länge | 14 von 190 Takten haben 1, 2 oder 3 Schläge | folgt aus den beiden Zeilen darüber |

**Warum der erste Zwischenschlag bleibt:** Die Regel vergleicht den üblichen Abstand in der Umgebung mit dem halben üblichen Abstand des Tracks und lässt 6 % zu. Das Modell gibt Zeiten in Schritten von 20 ms aus. Am Abschnittsanfang ist der Median der Umgebung 0,42 s, der halbe übliche Abstand 0,39 s: 7,7 % daneben, also „nicht schnell“. Der wahre Wert wäre 0,395 s. Die Regel scheitert am Zeitraster, nicht an der Musik.

**Folge für das angezeigte Tempo:** Die Seite rechnet das Tempo aus den 8 Schlägen um die Abspielstelle ([track.js](app/web/track.js)). Jeder überzählige Schlag und jeder Wechsel auf die Zwischen-Achtel verschiebt diese Zahl. Neue Messgröße `tempo steady`: Bei „Letting Go“ weicht das Tempo an 14,7 % der Schläge um mehr als 3 % ab, höchstens um +33,8 % (102 statt 76 bpm). Alle anderen echten Tracks liegen bei höchstens 3,0 %.

**Andere Tracks mit Eingriff der Regeln** (`beats-compare.mjs`):

| Track | `matched` | Was die Regeln tun | Zwischen-Achtel? |
|---|---|---|---|
| Comfortably Numb | 87,0 % | halbiert 0 bis 60 s (61 Schläge gestrichen) | nein: kein Taktanfang des Modells gestrichen. Tempo danach 63,2 bis 63,8 bpm; eine Stelle bei 208 s mit zwei Schlägen auf halber Strecke (72,7 bpm) |
| `qmlHtyS_P8k` | 100 %, 7 % zusätzlich | füllt 68 Schläge auf (Anfang und Ende im halben Tempo gezählt) | nein, Tempo 167 bis 173 bpm |
| alle übrigen | 99,9 bis 100 % | fast nichts | – |

Bei drei weiteren Tracks stehen einzelne Schläge sehr dicht (Abstand unter einem Drittel): Losing Control bei 238 und 506 s, Back Door Blues an fünf Stellen, One Last Time bei 446 s. Sie kommen so aus dem Modell und werden durchgereicht. `tempo steady` zeigt sie (2,5 %, 3,0 %, 0,2 % der Schläge).

## Versatz der Akkordwechsel

Neue Messgröße `timing`: zu jedem Wechsel des Grundtons im Label der nächste gefundene Wechsel auf diesen Grundton innerhalb von 2 s; Δ ist gefunden minus Label, positiv heißt zu spät. Der Vorlauf der Videoanzeige wird nicht abgezogen.

| Track | Median Δ | innerhalb 0,3 s | 90 % unter | Drift je Minute | Muster |
|---|---|---|---|---|---|
| Late Night Groove | +400 ms | 37,2 % | 580 ms | −13 ms | fast jeder zweite Wechsel einen halben Schlag zu spät |
| Before The Dawn | +220 ms | 57,1 % | 950 ms | +30 ms | spät um 0,3 bis 0,6 s und einzelne um 1 s zu früh; nicht weiter untersucht |
| Letting Go | +140 ms | 65,6 % | 590 ms | −6 ms | 48 von 160 Wechseln mehr als 0,3 s zu spät |
| Losing Control | +190 ms | 75,6 % | 440 ms | +22 ms | |
| Back Door Blues | +80 ms | 83,9 % | 940 ms | −10 ms | einzelne um 1 s zu früh |
| `9pH42-82Mz0` | +100 ms | 92,9 % | 260 ms | +18 ms | 7 Wechsel 1,6 bis 1,8 s zu spät (zwei Schläge) |
| One Last Time | +150 ms | 97,0 % | 250 ms | −7 ms | |
| `7Zsqy25jWD4` | +40 ms | 100 % | 140 ms | 0 ms | |
| `pGi9fs2HhZ0` | −30 ms | 100 % | 180 ms | −8 ms | |
| generiert (18) | +16 ms | 99,6 % innerhalb 0,1 s | 32 ms | | genaue Labels: die Analyse liegt einen Modellschritt (20 ms) spät |

Einordnung nach der Tabelle der Anleitung:

- **Gleichbleibend über den Track:** nein. Der Median liegt bei den sauberen Tracks zwischen −30 und +150 ms; das deckt sich mit dem Vorlauf der Videoanzeige (bis 0,2 s) und der Rundung der Labels auf 0,25 s.
- **Wächst mit der Zeit:** nein. Die Drift liegt bei allen echten Tracks unter 30 ms je Minute und hat wechselndes Vorzeichen. Eine falsch umgerechnete Samplerate scheidet aus.
- **Springt um einen halben Schlag:** ja, das ist das Hauptmuster (Late Night Groove, Letting Go).
- **Springt um ganze Schläge:** bei `9pH42-82Mz0`. Der Track wechselt wirklich in der Taktmitte (26 Wechsel auf dem dritten Schlag); 7 davon meldet die Analyse erst am nächsten Taktanfang.
- **Nur in Abschnitten:** bei „Letting Go“ zusätzlich die Abschnitte auf den Zwischen-Achteln. Im Fenster 420 bis 450 s kippt der Median von etwa +150 auf −140 ms.
- **Alte Anzeige:** nein. `analysisVersion` steht auf `2026-11-17e` und wurde mit der letzten Änderung an der Analyse (`a1cf894`) hochgezählt.

**Der halbe Schlag ist echt, die Labels sind nicht schuld.** Geprüft am Audio, ohne die Schläge zu benutzen (`change-times.mjs`: Stärke des alten und neuen Grundtons im Bass in 50-ms-Schritten):

| Track | gehört minus Label | gefundener Wechsel minus gehört | mehr als 0,3 s zu spät |
|---|---|---|---|
| `pGi9fs2HhZ0` (Kontrolle) | −26 ms | −24 ms | 3 % |
| Late Night Groove | −26 ms | +486 ms | 63 % |
| Letting Go | +74 ms | +96 ms | 35 % |

Bei „Late Night Groove“ läuft das Muster über zwei Takte: Gm auf der Eins, F auf „2 und“, C auf „4 und“. Die Analyse meldet F und C je auf dem nächsten vollen Schlag (Label 83,75 und 85,25 s, gefunden 84,12 und 85,64 s). Die Takte liegen dort richtig: Der gefundene Taktanfang 82,60 s ist der Einsatz von Gm (Label 82,5 s). Die Zahl „Wechsel auf der Eins 37 %“ misst bei diesem Track also die vorgezogenen Akkorde, nicht eine falsche Eins.

**Woher „bis zu etwa einer Sekunde“ kommen kann:** Einzeln gemessen sind 0,39 s (halber Schlag) und dazu bis 0,25 s, die das Video früher anzeigt. Wo ein vorgezogener Akkord in einen Abschnitt auf den Zwischen-Achteln fällt oder ein Wechsel in der Taktmitte an den Taktanfang rutscht, kommen 0,8 bis 1,8 s zusammen. An welcher Stelle der Nutzer die Sekunde gesehen hat, weiß ich nicht.

## (b) Die Positionsanzeige der App

Der Weg der Position: Der Audio-Thread zählt `Transport::beats_` je Block weiter (ein „Schlag“ ist eine Sekunde des Tracks). Ein Timer im Fenster liest den Wert 30-mal je Sekunde und schickt ihn an die Seite. Die Seite merkt sich die Ankunft mit `performance.now()` und rechnet zwischen zwei Nachrichten weiter ([track.js:41](app/web/track.js#L41)). Akkord und Takt werden direkt aus `beats` und `bars` der Analyse bestimmt, nicht aus `bpm`.

Gemessen in der echten App, stumm, mit „Letting Go“ (`position-check.mjs`; die Seite fragt die Engine zweimal je Sekunde nach ihrer Position):

| | ab 60 s | ab 420 s |
|---|---|---|
| Messungen | 80 | 80 |
| Anzeige hinter der Engine, Median | −1,4 ms | −0,2 ms |
| kleinster bis größter Wert | −9,0 bis +6,1 ms | −8,4 bis +5,8 ms |
| Rundlauf der Frage | 0,2 ms | 0,2 ms |
| Alter der letzten Engine-Nachricht | bis 34 ms | bis 33 ms |
| Bilder je Sekunde, längstes Bild | 164, 17 ms | 164, 9 ms |
| Gerät | 48 kHz, 480 Frames, Ausgabelatenz 10 ms | |

- Die Streuung von ±9 ms ist ein Audioblock (10 ms): Die Engine meldet die Position am Blockende.
- Die Datei hat 44,1 kHz, das Gerät 48 kHz. Der Abspieler rechnet mit der Rate der Datei (`block.beats * clip->rate` in [file_player.cpp](core/src/file_player.cpp)); gemessen läuft der Track mit 1,000 s je Sekunde.
- Einen Latenzausgleich gibt es nicht. Die Anzeige ist dem Ton deshalb um die Ausgabelatenz voraus (hier 10 ms plus bis zu einem Block), nicht hinterher.
- Analyse und Wiedergabe benutzen in der App dieselben dekodierten Samples. Ein Versatz zwischen beiden durch den MP3-Dekoder ist dort ausgeschlossen.

Grenzen dieser Messung: stumm, automatisch gesteuert, ein Rechner, ein Audiogerät, Geschwindigkeit 100 %. Von Hand und mit Ton: die App mit `BTG_POSITION_LOG=<Datei>` starten und abspielen; die Datei bekommt zwei Zeilen je Sekunde.

## App und Messwerkzeug analysieren nicht dasselbe

`btg_analyze` dekodiert MP3 mit dr_mp3, die App mit dem Dekoder von JUCE. Für „Letting Go“ aus der App geholt und verglichen:

- Schläge der App im Median 20 ms später (ein Schritt des Modells).
- 218 von 729 Schlägen liegen mehr als 30 ms auseinander, bis zu einem halben Schlag.
- In der App liegt nur der Abschnitt 31 bis 59 s auf den Zwischen-Achteln; 417 bis 449 s ist dort richtig.
- `timing` für das Ergebnis der App: Median +170 ms, 64,4 % innerhalb 0,3 s (Werkzeug: +140 ms, 65,6 %).

Die Regel an den Abschnittsgrenzen kippt also schon bei 20 ms Verschiebung. Was der Nutzer in der App sieht, ist bei solchen Tracks nicht Stelle für Stelle das, was gemessen wird.

## Was beim Messen sonst aufgefallen ist

- **Reste der unangetasteten Tracks:** `native/build/analysis` und `native/build/beats-cache` waren nicht leer (68 und 61 Dateien, darunter die fünf unangetasteten nach Dateinamen). Ich habe keine davon geöffnet. Das Leeren hat eine Sicherheitsprüfung abgelehnt; gemessen habe ich mit neuen Ordnern (`native/build/beats-cache-p0b`). **Vor Phase 1 muss `native/build/beats-cache` geleert werden:** Die generierten Sätze sind neu gerendert, der Zwischenspeicher kennt sie nur unter dem alten Dateinamen und würde alte Schläge liefern.
- **Die generierten Sätze sind neu erzeugt** (wegen `beats` und `downbeats` in den Labels). Das Rendern ist nicht bitgleich wiederholbar (Zufall je Anschlag im Sampler): Zweimal gerendert unterscheiden sich alle Dateien. Die gerundeten Zahlen der Sätze sind gleich geblieben. Ab jetzt nicht neu erzeugen.
- **Satz „tempo“:** Der Web-Generator kennt nur ein festes Tempo. Die Tempokurve wird beim Rendern über die Startzeiten der Ereignisse gelegt; **Notenlängen und Echozeiten bleiben auf dem Grundtempo des Tracks.** Bei den Kurven des Satzes (höchstens 25 % Unterschied) sind Noten am Ende also etwas zu kurz oder zu lang.
- **`timing` weicht in einem Punkt von der Anleitung ab:** Gesucht wird der nächste gefundene Wechsel *auf denselben Grundton*, nicht irgendein Wechsel. Sonst zählt ein falscher Akkord zur richtigen Zeit als Treffer. Wechsel, die den Grundton behalten (Bbsus2 nach Bb), zählen nicht mit.
- **`tempo steady` lässt Pausen aus:** Strecken ohne Schläge, die länger als vier Schläge sind (die Pause vor dem Solo), sind kein Tempo.
- **`change-times.mjs` taugt nur für echte Tracks.** In den generierten Tracks geht der Bass schon vor dem Wechsel zum neuen Grundton (gehört minus Label −525 und −725 ms bei genauen Labels).
- **Nicht untersucht:** warum „Before The Dawn“ und „Back Door Blues“ einzelne Wechsel etwa eine Sekunde zu früh melden.

## Befehle

```powershell
$env:BTG_BEATS_CACHE = "$PWD\native\build\beats-cache"
$t = 'C:\dev\samples-raw\analysis-tests'; $n = 'Letting Go Guitar Backing Track Jam in D Minor'

# Schläge: Original, Modell roh, Ergebnis der Analyse, je 30 s
node native/tools/beats-inspect.mjs "$t\beats-final\$n.beats.json" "native\build\beats-cache\$n.mp3.beats.json" "native\build\analysis\$n.json" --bpm 76

# Was die Regeln mit jedem Schlag tun (stderr)
$env:BTG_ANALYSIS_LOG = '1'; native\build\core\Release\btg_analyze.exe "$t\$n.mp3" out.json 2> regeln.log; Remove-Item Env:BTG_ANALYSIS_LOG

# Versatz je 30 s, alle echten Tracks
node native/tools/analysis-score.mjs $t --timing

# Wo der Bass im Audio den Grundton wechselt
node native/tools/change-times.mjs "$t\$n.mp3" "$t\$n.json" "native\build\analysis\$n.json" --list

# Anzeige gegen Engine in der App (braucht den Bau mit App)
node native/tools/position-check.mjs "$t\$n.mp3" 40 60 420
```
