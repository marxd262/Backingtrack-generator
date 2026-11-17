# Bericht: Akkord- und Takterkennung, Phase 0 bis 2

Stand 2026-11-17, Branch `exp/analysis-agent`, nicht gepusht, `analysisVersion` `2026-11-17g`. Auftrag und Regeln stehen in [Erkennung messen.md](../Erkennung%20messen.md), jeder Versuch mit seinen Zahlen in [ERGEBNISSE.md](ERGEBNISSE.md). Dieser Bericht fasst zusammen, was der Lauf ergeben hat und was der Nutzer jetzt entscheiden muss.

## Nachtrag: Vorschlag Nr. 9 ist angenommen

Nach diesem Bericht hat der Nutzer am 2026-11-17 Vorschlag Nr. 9 angenommen (knappe Akkordarten folgen der Mehrheit im Track; sus4 nur bei schwacher Terz). Die Änderung ist auf `develop` umgesetzt und dort neu gemessen; `analysisVersion` steht auf `2026-11-17h`. Der Bericht darunter beschreibt den Stand davor.

| | Endstand nach Phase 2 | auf `develop` mit Vorschlag Nr. 9 |
|---|---|---|
| echt `kind` (`triads` / `others`) | 76,2 % (87,2 / 43,6) | **77,8 %** (89,8 / 36,3) |
| generiert `kind` | 92,4 % | 93,8 % |
| generiert-2 `kind` (`triads` / `others`) | 70,1 % (93,6 / 39,6) | 70,8 % (94,7 / 39,0) |
| verstimmt `kind` | 78,1 % | 81,2 % |
| tempo `kind` | 95,1 % | 96,2 % |

`root`, `maj/min`, `timing`, `tempo steady` und alle Zähler sind unverändert. An den Kopien steigt `kind` im Satz „echt“ ebenso (andere Rate 75,8 → 77,9 %, MP3 75,9 → 77,8 %). App und `btg_analyze` liefern für drei Tracks weiter dasselbe JSON. Vorschlag Nr. 12 (die sus-Regel) ist am 2026-11-18 vorerst abgelehnt: Der Nutzer kann die fraglichen Akkorde nicht verlässlich nach Gehör unterscheiden, also bleiben die Labels der Maßstab, und nach ihnen verliert die Regel im Satz „echt“. Die Stellen, um die es ging: Before The Dawn, Label „F“, 1:27 bis 1:30, 1:37 bis 1:39, 1:46 bis 1:48; One Last Time, Label „Eb“, 0:55 bis 0:58, 1:09 bis 1:13, 2:07 bis 2:11. Offen bleiben die Vorschläge Nr. 7, 10 und 11. Die Seitenzweige des Laufs sind gelöscht; `develop` trägt alles in zwei Squash-Commits.

## Ergebnis in Kürze

| Satz „echt“ (13 Tracks) | vor Phase 1 | nach Phase 1 | nach Phase 2 |
|---|---|---|---|
| Akkordwechsel innerhalb 0,3 s (`timing`) | 78,8 % | 90,8 % | **93,1 %** |
| Tempo daneben (`tempo steady`) | 1,8 % | 0,2 % | 0,2 % |
| Grundton (`root`) | 93,6 % | 94,8 % | **95,2 %** |
| Dur/Moll (`maj/min`) | 93,0 % | 94,2 % | **94,7 %** |
| Akkordart (`kind`) | 74,4 % | 75,7 % | **76,2 %** |
| davon Dreiklänge / andere Arten | 85,0 / 43,2 % | 86,7 / 43,1 % | 87,2 / 43,6 % |

- **Die Zeitlage, das zuerst gemeldete Problem, ist deutlich besser.** Vorgezogene Akkorde stehen auf dem Achtel, die Schläge von „Letting Go“ laufen gleichmäßig, und in Phase 2 kamen die Wechsel dazu, die zwei Schläge zu früh gemeldet wurden.
- **Das Hauptziel von Phase 2, die Akkordart, ist nicht erreicht.** `kind` stieg um 0,5 Punkte statt um einen, und das als Folge der besseren Akkordgrenzen. Keine Regel für sus-Akkorde, Powerchords oder Septimen hat die Regeln der Anleitung und die Vorgaben für Phase 2 erfüllt. Der Grund steht unter „Warum die Akkordart nicht weiter stieg“.
- **Phase 2 hat 9 von höchstens 18 Versuchen gebraucht.** Behalten ist einer (Versuch 4). Die letzten fünf sind in Folge verworfen, einer vor der Grenze von sechs; für jeden weiteren Kandidaten zeigt die Diagnose vorab, dass er scheitert.
- **Zu entscheiden** (Einzelheiten unten): vier fertige oder fast fertige Änderungen, die nach den Regeln nicht bleiben durften (Vorschläge Nr. 9, 11, 12 und 7), und die Label-Verdachtsfälle. Für Nr. 12 müsstest du dir Stellen anhören.

## Diagnose des Versatzes und was daraus wurde

Gemeldet war: In der App hängt die Akkordanzeige bis zu etwa einer Sekunde hinter dem Ton, und das Tempo von „Letting Go“ schwankt. Phase 0 ([DIAGNOSE.md](DIAGNOSE.md)) hat das untersucht; so steht es heute:

| Befund aus Phase 0 | Was daraus wurde |
|---|---|
| Die Positionsanzeige der App läuft der Engine nicht nach (im Mittel 1 ms) | keine Änderung nötig |
| Die Analyse setzt vorgezogene Akkorde einen halben Schlag zu spät | Phase 1: Ein Wechsel darf ein Achtel vor dem Schlag liegen. Late Night Groove `timing` 37,2 → 92,0 % |
| Bei „Letting Go“ macht das Halbieren doppelt gezählter Abschnitte Fehler | Phase 1: `tempo steady` dort 14,7 → 1,1 %, die Abschnitte liegen auf den Vierteln |
| App und Messwerkzeug dekodieren MP3 verschieden | Phase 1: ein Dekodierweg im Kern; für drei Tracks liefern beide dasselbe JSON, auch im Endstand |
| Einzelne Wechsel etwa eine Sekunde zu früh (Before The Dawn, Back Door Blues) | Phase 2, Versuch 4: Ein Wechsel in der Taktmitte, den der Bass erst am Taktanfang macht, steht am Taktanfang. Before The Dawn `timing` 74,6 → 84,1 %, Back Door Blues 83,9 → 94,6 % |

Offen bei der Zeitlage: vier Wechsel G → F bei Before The Dawn und sechs bei Letting Go (dort liegt der Bass schon zwei Schläge vor dem Label auf dem neuen Grundton); vier Wechsel Em → G bei Losing Control einen halben Schlag spät (nicht untersucht); `9pH42-82Mz0` an drei Stellen (hörst du dir selbst an, in Phase 2 nicht bearbeitet).

## Ausgangs- und Endstand aller Sätze

Je Zelle: vor Phase 1 → nach Phase 1 → nach Phase 2. Eine Zahl allein heißt: unverändert.

| | echt (13) | generiert (18) | generiert-2 (18) | verstimmt (6) | tempo (8) |
|---|---|---|---|---|---|
| Tempo richtig | 12/12 | 18/18 | 17/18 | 6/6 | – |
| Taktart richtig | 13/13 | 18/18 | 15/18 | 6/6 | 8/8 |
| Tonart richtig | 12/13 | 17/18 | 17/18 | 5/6 | 8/8 |
| `root` | 93,6 → 94,8 → 95,2 | 98,5 | 95,3 → 95,5 → 95,6 | 82,2 | 97,8 |
| `maj/min` | 93,0 → 94,2 → 94,7 | 97,8 | 95,0 → 95,3 → 95,4 | 82,2 | 96,1 → 96,2 → 96,2 |
| `kind` | 74,4 → 75,7 → 76,2 | 92,4 | 69,6 → 69,8 → 70,1 | 78,1 | 95,1 |
| `triads` | 85,0 → 86,7 → 87,2 | 92,4 | 93,2 → 93,6 → 93,6 | 78,1 | 95,1 |
| `others` | 43,2 → 43,1 → 43,6 | – | 39,1 → 39,1 → 39,6 | – | – |
| Wechsel auf der Eins | 80,9 → 80,6 → 80,6 | 100,0 | 93,2 → 95,0 → 95,0 | 100,0 | 90,9 |
| `timing` innerhalb (0,3 s echt, sonst 0,1 s) | 78,8 → 90,8 → 93,1 | 99,6 → 100,0 → 100,0 | 95,3 → 96,8 → 97,1 | 83,3 | 90,5 → 92,2 → 92,2 |
| `timing` Median Δ | +143 → +93 → +102 ms | +16 ms | +21 → +20 → +20 ms | +12 ms | +44 → +19 → +19 ms |
| `timing` Median \|Δ\| | 173 → 130 → 125 ms | 24 ms | 21 → 20 → 20 ms | 22 ms | 44 → 26 → 26 ms |
| `timing` 90 % unter | 481 → 395 → 250 ms | 32 ms | 147 → 101 → 101 ms | 31 ms | 154 ms |
| `tempo steady` daneben | 1,8 → 0,2 → 0,2 | 1,6 → 1,4 → 1,4 | 9,0 → 6,4 → 6,4 | 0,3 | 12,4 → 6,4 → 6,4 |
| `beats` innerhalb 50 ms | – | 99,0 | 98,9 | 98,7 | 94,5 |
| `bars` | – | 98,6 | 90,9 → 92,9 → 92,9 | 99,0 | 85,9 |

Phase 2 hat vier Tracks geändert: Before The Dawn, Back Door Blues, One Last Time und `hardrock-colours`; alle gewinnen, alle anderen 59 sind Zeile für Zeile gleich. Die echten Tracks einzeln und der Endstand an den Kopien stehen in [Erkennung messen.md](../Erkennung%20messen.md), „Endstand nach Phase 2“. Die fünf `==`-Zeilen des Endstands (Commit `4179a5b`, zweimal gemessen):

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 76.2 % (triads 87.2 %, others 43.6 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.1 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.6 %, maj/min 95.4 %, kind 70.1 % (triads 93.6 %, others 39.6 %) | changes on the one 95.0 % | timing +20 ms, apart 20 ms, within 97.1 %, 90 % under 101 ms, drift 169 ms/min, missed 1.4 % | tempo steady 59.7 % at most, 6.4 % off | beats +23 ms, within 50 ms 98.9 %, bars 92.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

## Robustheitsprüfung

Vor den Versuchen von Phase 2 sind alle fünf Sätze in der jeweils anderen Abtastrate (44,1 gegen 48 kHz) und als MP3 mit 128 kbit/s gemessen worden. Der Satz „echt“ bewegt sich dabei bei `root`, `kind`, `timing` und `tempo steady` um höchstens 0,5 Punkte; `others` dort um bis zu 2,2, einzelne Tracks und die generierten Sätze um mehr.

| Ursache | Beispiel |
|---|---|
| Die Akkordart kippt, wo ein Ton nahe an seiner Schwelle liegt | `poppunk-11` `kind` 72,3 → 84,8 % bei 48 kHz |
| Das Spektralfenster steht in Samples fest (186 ms bei 44,1 kHz, 171 ms bei 48 kHz); daran hängt, ob die Regel für vorgezogene Akkorde greift | Back Door Blues: 12 von 101 Wechseln vorgezogen bei 48 kHz, 1 von 100 bei 44,1 kHz |
| Zwei harte Grenzen bei Schlägen und Takten („Modell hat den Puls verloren“ 10 %, „Takte des Modells gleichmäßig“ 60 %) | `slower-80-66-dreamy` `bars` 50 → 100 % als MP3, `dreamy-11` 93,8 → 50 % |
| Die eigene Schlagsuche wählt zwischen Vielfachen des Tempos | `rock-34-160`: 106 bpm bei 44,1 kHz, 80 bpm bei 48 kHz |

Kein Versatz durch MP3. Die Untergrenze der Dreierprüfung (1,5 %) hält: In 189 Läufen kippt kein Urteil an ihr; der größte Wert ohne Dreierunterteilung ist 0,78 bei einer Grenze von 1,5, der kleinste echte Fall 3,04. (Ein Track, `rock-34-160`, wechselt das Urteil, weil dort andere Schläge gemessen werden; damit sind zwei der drei Bedingungen des Plans wörtlich nicht erfüllt.) Behoben ist nichts, weil keine Ursache ein klarer, kleiner Fehler ist (Vorschlag Nr. 7).

**Der Endstand an den Kopien.** Gewinn von Phase 2 im Satz „echt“:

| | Original | andere Rate | MP3 |
|---|---|---|---|
| `timing` innerhalb | +2,3 | +1,5 | +2,1 |
| `root` | +0,4 | +0,3 | +0,3 |
| `kind` | +0,5 | +0,3 | +0,4 |

In keiner Fassung verliert ein Track. In der anderen Abtastrate bleibt der Gewinn bei `timing` unter den zwei Punkten, die die Regel für die Originale verlangt: Back Door Blues hat dort schon vorher vier der sechs Wechsel richtig.

## Die Versuche von Phase 2

| Nr. | Was | Ergebnis | Urteil |
|---|---|---|---|
| 1 | Ein überzähliger Schlag fällt weg, wo immer er zwischen zwei Schlägen liegt | `dreamy-128-90` `bars` 93,8 → 100 %; Back Door Blues `tempo steady` 1,2 → 0,3 %; sonst nichts | erst knapp behalten, nach der Prüfung zurückgenommen; Vorschlag Nr. 11 |
| 2 | Wechsel in der Taktmitte braucht den Bass (alter Grundton noch da) | je nach Grenze: `timing` echt +2,7 bei −2,4 im Satz „tempo“, oder ohne Verlust nur +1,3 | verworfen |
| 3 | Bass zählt in der Taktmitte weniger | Before The Dawn +0,5, `9pH42-82Mz0` bis −6,1 | verworfen, Hypothese falsch |
| 4 | Wechsel in der Taktmitte, den der Bass erst am Taktanfang macht, steht am Taktanfang | `timing` echt 90,8 → 93,1 %, `root` 94,8 → 95,2 %; vier Tracks gewinnen, keiner verliert | **behalten** |
| 5 | Knappe Akkordarten folgen der Mehrheit im Track | `kind` echt +1,65 (mit halbierten `cycle`-Gewinnen +1,00), `triads` steigt überall; in der anderen Abtastrate nur +0,36 | verworfen: hält an der Kopie nicht |
| 6 | sus4 nur bei schwacher Terz | Hard Rock 83,4 → 99,0 % in allen Fassungen; `kind` echt +0,66 (halbiert), `others` in generiert-2 −1,9 | verworfen |
| 7 | 5 und 6 zusammen | `kind` echt +1,00 / +1,23 / +1,14 (halbiert) an Original und Kopien, `triads` steigt überall, `others` fällt | nicht behalten nach den Vorgaben für Phase 2; Vorschlag Nr. 9 |
| 8 | Powerchords: Grenze für „keine Terz“ höher | `triads` fällt bei jedem Wert in allen generierten Sätzen | verworfen |
| 9 | sus2 und sus4 nach einer Regel | generiert-2 `others` 39,6 → 49,3 %; echt `kind` 76,2 → 74,8 %, `triads` 87,2 → 84,5 % | verworfen; Vorschlag Nr. 12 |

Ohne Versuch geblieben, jeweils mit Zahlen in [ERGEBNISSE.md](ERGEBNISSE.md): eine höhere Schwelle für Moll-Septimen, eine niedrigere für große Septimen, die Umdeutung des Grundtons von sus-Akkorden nach dem Bass, die Dominante in Moll.

## Warum die Akkordart nicht weiter stieg

Die Diagnose misst für jeden Akkord, wie stark jeder Ton über dem Grundton ist, und legt das neben die Labels.

- **In echten Tracks ist die Terz auch bei Dreiklängen schwach** (Median 0,53 der Stärke von Grundton und Quinte; in den generierten Sätzen 0,81). „Keine Terz“ unterscheidet dort einen sus-Akkord oder Powerchord kaum von einem Dreiklang. Versuch 8 hat das gemessen: Jede höhere Grenze macht Dreiklänge zu Powerchords.
- **Wo eine sus2-Regel anspricht, nennt das Label oft einen Dur-Akkord:** F bei Before The Dawn in 54 von 105 s, Eb bei One Last Time, Bb bei Letting Go. Versuch 9 hat das gemessen: In generiert-2 (genaue Labels) gewinnt die Regel knapp zehn Punkte bei den anderen Akkordarten und verliert keinen Dreiklang; im Satz „echt“ verliert Before The Dawn zwölf Punkte.
- **Dsus2 bei Before The Dawn und B5 bei Losing Control** (zusammen 160 s, die heute als falsch zählen): Bei Dsus2 ist die Mollterz so stark wie die Sekunde. B5 ließe sich in diesem einen Track trennen; dieselbe Grenze machte Am bei `pGi9fs2HhZ0` zu A5.
- **Septimen:** Wo die Analyse Gm7 meldet und das Label Gm nennt (148 s), ist die Septime im Spektrum da, bei Late Night Groove so stark wie die Akkordtöne. Wo sie fehlen (Gmaj7 bei Losing Control), liegt die Septime unter dem, was Dreiklänge in „generiert“ als Oberton zeigen.

Die Zahl `kind` im Satz „echt“ ist damit an vielen Stellen eine Aussage über die Labels, nicht nur über die Analyse. Die Labels stammen aus der Akkordanzeige der Videos; ob sie oder das Spektrum recht haben, habe ich nicht gehört. Die Fälle stehen in [LABEL-VERDACHT.md](LABEL-VERDACHT.md). Mit Schwellen auf einzelnen Tönen ist nach dieser Messung im Satz „echt“ kaum noch etwas zu holen, solange die Labels so bleiben.

## Was geholfen hat, was nicht

Geholfen hat, nach Wirkung im Satz „echt“:

1. Akkordwechsel ein Achtel vor dem Schlag zulassen (Phase 1): `timing` +11,9 Punkte, `root` +1,2.
2. Wechsel an den Taktanfang legen, wenn der Bass erst dort kippt (Phase 2): `timing` +2,3, `root` +0,4.
3. Halbierungsregel mit feineren Abständen und überzählige Schläge streichen (Phase 1): `tempo steady` 1,8 → 0,2 %.
4. Ein Dekodierweg für App und Messwerkzeug (Phase 1): gemessen wird, was die App zeigt.

Nicht geholfen hat: beim Halbieren den Taktanfang des Modells behalten; einen Wechsel der Zählweise nicht als verlorenen Puls werten; das Gewicht des Basses in der Taktmitte senken; jede Regel für die Akkordart für sich.

Am meisten vorangebracht hat die Diagnose vor dem Versuch: Protokollzeilen hinter `BTG_ANALYSIS_LOG` und kleine Skripte, die sie neben die Labels legen. Versuch 4 ist so aus Versuch 2 entstanden, und die Messungen der Versuche 8 und 9 haben die Vorhersage aus den Tonstärken bestätigt.

## Vorschläge und offene Ideen

Vorschläge mit Zahlen in [VORSCHLAEGE.md](VORSCHLAEGE.md); Nr. 1 bis 6 und 8 sind umgesetzt oder gemessen und verworfen.

| Nr. | Was | Gewinn | Preis | Stand |
|---|---|---|---|---|
| 7 | Immer bei derselben Abtastrate analysieren | dieselbe Musik als 44,1- und 48-kHz-Datei ergibt dasselbe | 9 der 13 echten Tracks ändern sich um Zehntel; braucht einen Umrechner im Kern | nicht gebaut |
| 9 | Knappe Akkordarten nach der Mehrheit im Track, sus4 nur bei schwacher Terz | `kind` echt 76,2 → 77,8 %, `triads` steigt in jedem Satz | `others` fällt (echt 43,6 → 36,3 %, fast ganz `9pH42-82Mz0`; generiert-2 −0,6); zwei Drittel des Gewinns aus Hard Rock | Zweig `exp/analysis-close-calls` |
| 10 | Grundton von sus-Akkorden nach dem Bass | `country-open` `root` 74 → über 90 % | nur generiert-2 gewinnt | nicht gebaut |
| 11 | Überzählige Schläge überall zwischen zwei Schlägen streichen | `dreamy-128-90` `bars` 100 %, Back Door Blues `tempo steady` 0,3 % | keiner gemessen; der Gewinn zeigt sich in der Zeile des Satzes nicht | eine Zahl, Commit `4415353` |
| 12 | sus2 und sus4 nach einer Regel | generiert-2 `others` +9,7 Punkte | echt `kind` −1,4, wenn die Labels stimmen | Zweig `exp/analysis-sus` |

Ideen ohne Messung:

- Die Akkordart aus dem Vergleich mit Vorlagen für alle 17 Arten lesen statt aus einem Schwellenbaum. Das wäre ein Umbau.
- Die Eins je Abschnitt wählen statt für den ganzen Track (`slower-80-66-dreamy` `bars` 50 %).
- Die zwei harten Grenzen bei Schlägen und Takten weicher fassen (Robustheitsprüfung).
- Nach einem Tempowechsel an die Zählweise der Umgebung angleichen (`step-80-62-hardrock`).
- Echte Tracks mit Labels, deren Akkordarten am Audio geprüft sind. Ohne das lässt sich die Akkordart kaum weiter messen.

## Label-Verdachtsfälle

Zehn Einträge in [LABEL-VERDACHT.md](LABEL-VERDACHT.md), kein Label ist geändert. Die gewichtigsten: Late Night Groove „Gm“ sieht im Spektrum wie Gm7 aus (70 s), Before The Dawn „F“ wie Fsus2 (54 s) und „Dsus2“ wie Dm mit Sekunde (78 s), Hard Rock „F“ hat ein Bb darüber. Die Einträge nennen, was das Spektrum zeigt, nicht, was zu hören ist.

## Prüfung durch den Subagenten

Ein Subagent mit frischem Kontext hat den Diff, die Anleitung, den Plan und meine eigenen Entscheidungen geprüft. Kein kritischer Befund, fünf wichtige; alle fünf sind bearbeitet (Tabelle in [ERGEBNISSE.md](ERGEBNISSE.md), „Prüfung durch einen Subagenten“):

1. Versuch 1 war gegen die Regel behalten: zurückgenommen, jetzt Vorschlag Nr. 11.
2. Versuch 4: Messung an den Kopien nachgetragen; eine Grenze von 0,5 auf 0,6 gesetzt (Mitte der Lücke, an der sie abgelesen ist); die Abhängigkeit von der Abtastrate steht jetzt dabei.
3. Die Regel aus Versuch 4 griff auch ohne hörbaren Bass: mit Test nachgewiesen und behoben.
4. Eine Tabellenzeile zu Versuch 3 war falsch: berichtigt.
5. sus2 und Powerchords waren ohne gemessenen Versuch ausgeschieden: als Versuche 8 und 9 nachgeholt, beide verworfen wie vorhergesagt.

Sein Urteil zu Versuch 4: regelkonform und ohne gefundenen Fehler im Code, aber die beiden Grenzen sind an 20 und 9 Fällen derselben Testtracks abgelesen. Ob sie halten, zeigen die unangetasteten Tracks.

## Entscheidungen, die ich allein getroffen habe

- Kopien der Robustheitsprüfung in der jeweils anderen Rate statt immer 48 kHz (9 der 13 echten Tracks haben schon 48 kHz); MP3 mit 128 kbit/s.
- Kein Fix aus der Robustheitsprüfung, stattdessen Vorschlag Nr. 7.
- Versuch 4 lief, obwohl die Schwelle des Plans für die Diagnose verfehlt war (5 von 16 statt 10 von 15): als eine Nachbesserung zu Versuch 2, mit einer anderen Frage an den Bass.
- Versuch 7 nicht behalten, obwohl Regel B erfüllt ist: Deine Vorgabe für sus-Regeln (`others` in generiert-2 muss steigen, kein Gewinn aus fast nur einem Track) gilt.
- Ende nach 9 Versuchen, einer vor der Grenze von sechs Verwerfungen in Folge.
- `9pH42-82Mz0`: Der Punkt kam mit offenem Platzhalter zurück; gewählt ist „in Phase 2 nicht gezielt bearbeiten“.
- Arbeit direkt auf `exp/analysis-agent` statt in einem eigenen Arbeitsbaum, weil Testsätze, Modell und Bau unter `native/build` liegen.

## Hilfsskripte

`native/tools` war gesperrt und ist seit `22d0840` unverändert. Die Skripte dieses Laufs liegen unter `native/build/phase2/` und `native/build/robust/` und sind nicht in Git. Über das Behalten eines Versuchs haben nur die Zahlen von `analysis-score.mjs` entschieden.

| Skript | Was es tut |
|---|---|
| `measure.ps1` | ruft `analysis-score.mjs` für alle fünf Sätze auf (Originale oder eine Kopien-Fassung), legt die Ausgabe in einer Datei ab |
| `compare.mjs` | legt zwei solche Ausgaben nebeneinander; rechnet für „echt“ den Zuwachs mit halbierten `cycle`-Gewinnen aus den Trackzeilen |
| `robust/make.ps1` | erzeugt die Kopien mit ffmpeg |
| `trace-all.ps1` | lässt `btg_analyze` mit Protokoll über alle Tracks und Fassungen laufen, sammelt die Zeile `threes:` |
| `chords-diff.mjs` | vergleicht zwei JSON von `btg_analyze` zur selben Musik |
| `midbar.mjs` | legt die Protokollzeilen `change:` neben die Labels: Wechsel in der Taktmitte, früh oder richtig, Bass vor und nach dem Taktanfang |
| `kinds-by-track.mjs`, `kinds-trace.mjs` | welche Label-Art als was gemeldet wird; Stärke der Töne je Label-Art; wo eine Bedingung zuträfe |
| `kinds-sim.mjs` | liest die Akkordart aus den protokollierten Tönen nach (stimmt bei 2392 von 2394 Akkorden mit der Analyse überein) und probiert eine Regel daran aus, bevor sie gebaut wird |
| `note.ps1`, `quicktest.ps1` | Eintrag in `ERGEBNISSE.md` samt Commit; schneller Bau nur der Analyse-Tests |

Drei der Skripte enthalten eine Kopie der Funktion aus `analysis-score.mjs`, die einen Label-Akkord auf eine Akkordart abbildet.

## Was du jetzt tun kannst

1. **Die unangetasteten Tracks messen** (einmal), mit `node native/tools/analysis-score.mjs <Ordner> --held-out`. Vergleichswerte von vor der Erkennungs-Runde: Tempo 4/5, Taktart 5/5, Tonart 4/5, `root` 85 %, `maj/min` 84 %, auf der Eins 79 %. Für `timing` gibt es dort keinen Wert von vorher (die Zahl kam erst mit Phase 0). Steigen `root` und `maj/min` mit, hält der Lauf; fallen sie, ist er auf die Optimier-Tracks zugeschnitten.
2. **In der App prüfen** (`native\start.cmd`; die Analyse rechnet wegen der neuen `analysisVersion` neu): Before The Dawn bei 1:33 und 1:43 (G nach Dsus2) und Back Door Blues bei 1:44 (A7 nach E). Der Wechsel kam dort zwei Schläge zu früh und steht jetzt am Taktanfang.
3. **Für Vorschlag Nr. 12 anhören:** Before The Dawn, die F-Takte im Jam-Teil. Klingt dort Fsus2, sind die Labels an dieser Stelle zu grob, und die sus-Regel wäre ein Gewinn.
4. **Über die Vorschläge Nr. 7, 9, 11 und 12 entscheiden.**

Geprüft im Endstand: `native\build.ps1 -NoApp` läuft durch (5 von 5 Tests); App und `btg_analyze` liefern für Letting Go, Late Night Groove und `pGi9fs2HhZ0` dasselbe JSON; `track-check.mjs` mit Late Night Groove zeigt 20 von 20 Akkorden richtig an und meldet keine Probleme; die Analyse von „Letting Go“ dauert ohne Zwischenspeicher 11,1 s. Nicht geprüft: die App mit eigenen Augen und Ohren, und die Formate, die sie weiter mit JUCE oder über das System liest (Ogg, AIFF, WMA, M4A, Video).
