# Analyse Phase 2: Akkorde (Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Akkordart (`kind`) im Satz „echt“ steigt nach den Regeln A/B der Anleitung, ohne dass Grundton, Dur/Moll, Dreiklänge oder Zeitlage fallen. Vorher ist geklärt, ob die Messwerte bei anderer Abtastrate und nach MP3-Kodierung halten.

**Architecture:** Zuerst die Robustheitsprüfung: Kopien aller fünf Sätze in der anderen Abtastrate und als MP3 unter `native/build/robust/`, Vergleich mit den Originalen, Ursachen suchen. Dann der Ausgangsstand. Danach Versuche in der Reihenfolge der Verarbeitung (Schläge, Akkordgrenzen, Akkordarten), damit spätere Versuche auf dem Stand der früheren messen. Je Versuch eine Änderung in `analysis.cpp`, gemessen an allen fünf Sätzen, behalten oder verworfen, eingetragen in `native/ERGEBNISSE.md`.

**Tech Stack:** C++20 ohne JUCE im Kern (`native/core`), Node 22 für die Messskripte, PowerShell, CMake/ctest über `native\build.ps1`, ffmpeg 9.0.2 mit libmp3lame (vorhanden) für die Kopien.

**Spec:** [Erkennung messen.md](../../../Erkennung%20messen.md), [native/ERGEBNISSE.md](../../../native/ERGEBNISSE.md) („Phase 1“), [native/DIAGNOSE.md](../../../native/DIAGNOSE.md), [native/VORSCHLAEGE.md](../../../native/VORSCHLAEGE.md) und der Auftrag des Nutzers vom 2026-11-17 zu Phase 2.

## Global Constraints

- Branch `exp/analysis-agent`. Commits auf Englisch, ein Thema je Commit, nicht pushen, nichts nach `main` oder `feat/native-spike`.
- Der Kern bleibt C++20 ohne JUCE und baut unter Linux. Keine neue Abhängigkeit.
- Labels und `native/tools` werden nicht geändert (unverändert seit `22d0840`). Hilfsskripte dieses Laufs liegen deshalb unter `native/build/phase2/` und `native/build/robust/` (nicht in Git); was sie tun, steht in diesem Plan.
- Die generierten Sätze werden nicht neu erzeugt. Fehlt einer: anhalten und melden.
- Die fünf unangetasteten Tracks nicht öffnen, nicht messen, nicht suchen. `native/build/analysis` und `native/build/beats-cache` enthalten Reste davon: nichts darin öffnen oder löschen.
- Das Modell und seine Gewichte bleiben unverändert.
- `9pH42-82Mz0`: Kein Versuch zielt auf die drei Stellen „F statt C“, bis der Nutzer sie gehört hat. Der Track wird weiter gemessen, und Regel 5 (höchstens −3 Punkte `root`) gilt für ihn.
- Budget: höchstens 18 Versuche, oder aufhören, wenn 6 in Folge verworfen sind. Ein Durchprobieren eines Knopfs (höchstens 5 Werte) ist ein Versuch. Je Idee höchstens eine Nachbesserung; sie zählt als eigener Versuch. Robustheitsprüfung, Diagnosen und Protokollzeilen zählen nicht.
- Wertung: Versuche an den Akkorden nach A oder B und den Punkten 2 bis 6 der Anleitung. Versuche an Schlägen oder an der Lage der Wechsel (Task 3 und 4) nach den Punkten 1 bis 7 für Takte und Zeitlage, dazu die Punkte 2 bis 6 für Akkorde.
- Gewinne auf `cycle`-Tracks (Smooth Jazz, Hard Rock, `V1r4wWATS9Y`) zählen halb: Für A und B gilt der Zuwachs des Satzes „echt“, bei dem der Zuwachs dieser drei Tracks halbiert ist; ein Verlust zählt voll.
- `triads` fällt in keinem Satz (auf eine Nachkommastelle).
- **Ergänzungen des Nutzers nach der Durchsicht des Plans (2026-11-17):**
  - Regeln für sus und Powerchords (Task 5 bis 8) bleiben nur, wenn zusätzlich zu A oder B `others` in generiert-2 steigt und `triads` in keinem Satz fällt. Ein Gewinn, der im Satz „echt“ fast nur aus einem Track kommt, reicht allein nicht.
  - Grundton vor Akkordart: Wird das Budget knapp (weniger Versuche übrig als Kandidaten in Task 5 bis 8), kommt Task 7 vor Task 5 und 6. Task 7 ist deshalb so gefasst, dass es Task 6 nicht braucht.
  - Ob ein Versuch bleibt, entscheiden nur die Zahlen von `analysis-score.mjs`. Hilfsskripte dienen der Diagnose und dem Nebeneinanderlegen dieser Zahlen; was sie tun, steht im Bericht.
  - Task 4 wird nach den Regeln für die Zeitlage gewertet, die Akkordregeln 2 bis 6 gelten zusätzlich.
  - `9pH42-82Mz0`: Der Punkt kam mit offenem Platzhalter zurück; es gilt die zweite Lesart: in Phase 2 nicht gezielt bearbeiten, der Nutzer hört es sich selbst an.
- Keine Sonderfälle für einzelne Tracks oder Dateinamen. Keine pauschale Zeitverschiebung.
- Begründete Änderungen am Verfahren haben Vorrang vor Feintuning. Ein neuer Wert zählt nur, wenn die generierten Sätze nicht schlechter werden.
- Laufzeit der Analyse höchstens 22 s je Track. `analysisVersion` erst am Schluss.

## Review Focus

1. **Andere Abtastrate und MP3:** Ein behaltener Versuch darf nicht nur bei 44,1 kHz gelten. Am Schluss werden beide Kopien-Sätze noch einmal gemessen (Task 10 Step 1); die Gewinne bei `kind` und `root` müssen dort auf 0,5 Punkte dieselben sein.
2. **Leise Stellen (Intro, Pause vor dem Solo):** Eine neue Regel für sus oder Powerchord darf aus fast Stille keinen Akkord ohne Terz machen. Test in Task 5: der Testtrack mit zwei Takten Stille davor meldet dieselben Akkordarten.
3. **Umgedeuteter Grundton (Task 7):** Name, `root`, `minor` und `kind` passen danach zusammen, die Akkorde bleiben lückenlos, jeder hat `start < end`. Test in Task 7.
4. **Taktarten ohne Taktmitte (3/4, 5/4, 6/8, 12/8):** Die Regel aus Task 4 gilt nur in geraden Takten ab vier Schlägen; in allen anderen ändert sich nichts. Geprüft an den Zeilen von `funk-34-60`, `poppunk-34-90`, `blues-54-132`, `country-54-72`, `psych-68-72`, `dreamy-128-90` (unverändert gegenüber dem Stand davor).
5. **Die Seite der App:** Das Ausgabeformat bleibt (dieselben 17 Akkordarten). Am Schluss wieder App gegen Werkzeug für drei Tracks und `track-check.mjs` (Task 10 Step 5).

## Dateien

| Datei | Änderung |
|---|---|
| `native/core/src/analysis.cpp` | Versuche (Task 3 bis 9); Protokollzeilen hinter `BTG_ANALYSIS_LOG` |
| `native/core/tests/test_analysis.cpp` | Testtrack mit freien Tönen je Takt; Tests zu Task 4 bis 7 |
| `native/app/PluginProcessor.cpp:16` | `analysisVersion` am Schluss |
| `Erkennung messen.md` | Phase 2 läuft, Ausgangsstand, am Schluss der Endstand |
| `native/ERGEBNISSE.md` | neuer Abschnitt „Phase 2: Akkorde“: Robustheitsprüfung, jeder Versuch |
| `native/VORSCHLAEGE.md`, `native/LABEL-VERDACHT.md`, `native/UEBERGABE.md`, `native/BERICHT.md` | bei Bedarf bzw. am Schluss |
| `native/build/phase2/measure.ps1`, `compare.mjs`; `native/build/robust/make.ps1` | Hilfsskripte, nicht in Git |

## Was `--confusions` heute zeigt (gemessen am 2026-11-17 mit `a622b53`)

Sekunden im Satz „echt“, bei richtigem Grundton: `dom7 → maj` 167, `min → min7` 148, `min9 → min` 116, `power → min` 83, `sus2 → min` 78, `maj → sus4` 54, `maj7 → maj` 54, `sus2 → maj` 51, `sus2 → add9` 28.

| Track | `kind` (`triads` / `others`) | Was fehlt |
|---|---|---|
| Before The Dawn | 66,5 (86,2 / 0,0) | Dsus2 immer als Dm; G → Dm 12 s und F → Dm 7 s (Wechsel zwei Schläge zu früh) |
| Letting Go | 72,3 (94,5 / 25,1) | Bbsus2 als Bb oder Bbadd9 |
| Losing Control | 52,2 (87,9 / 0,0) | B5 als Bm, Gmaj7 als G |
| Late Night Groove | 69,1 (69,1 / –) | Gm als Gm7 und Bb6 (Label nennt Dreiklänge) |
| One Last Time | 73,2 (72,2 / 92,1) | Dreiklänge als andere Art gemeldet |
| `V1r4wWATS9Y` (`cycle`) | 49,9 (95,8 / 4,7) | E7 als E, Em7, G6 |
| Back Door Blues | 86,5 (81,8 / 93,5) | E → A 16 s, E → Asus4 7 s, A7 → E7 6 s |
| generiert-2 `country-open`, `psych-open`, `rock-open` | 28,7 / 29,1 / 37,0 | Esus4 als Asus2, A oder Aadd9 (dieselben Töne, anderer Grundton); F#sus4 als B5; `root` 74,0 % bei `country-open` |
| generiert-2 gesamt | `others` 39,1 | `maj7 → maj` 60, `power → maj` 18, `power → min` 18, `sus2 → maj` 17, `add9 → maj` 15, `sus2 → add9` 14, `sus4 → min` 11 |

---

## Ablauf je Versuch (gilt für Task 3 bis 9)

- [ ] `native/ERGEBNISSE.md` lesen: Ist die Idee schon gemessen, nicht wiederholen.
- [ ] Hypothese und erwartete Gewinner vor der Änderung in `ERGEBNISSE.md` notieren (aus `--confusions`, `--timing` oder dem Protokoll).
- [ ] Änderung einbauen, `native\build.ps1 -NoApp` (Tests grün).
- [ ] Messen: `native\build\phase2\measure.ps1 -Name <nn>-<name>` (alle fünf Sätze, schreibt `native\build\phase2\<nn>-<name>.txt`).
- [ ] Vergleichen mit dem letzten behaltenen Stand: `node native\build\phase2\compare.mjs <vorher>.txt <nachher>.txt`. Regeln Zeile für Zeile der Tracks prüfen, nicht nur die `==`-Zeilen.
- [ ] Erfüllt: ein Commit mit den fünf `==`-Zeilen in der Nachricht. Nicht erfüllt: `git restore native/core native/app`.
- [ ] Eintrag in `native/ERGEBNISSE.md` unter „Phase 2: Akkorde“: Hypothese, Änderung, Zahlen vorher und nachher, Tracks mit Gewinn und Verlust, behalten oder verworfen, die fünf `==`-Zeilen. Eigener Commit `docs: …`.
- [ ] Nach jedem behaltenen Versuch `--confusions` für „echt“ und generiert-2 neu ausgeben und für den nächsten Versuch benutzen.
- [ ] Knopf durchprobieren: `native\build.ps1 -NoApp -Tuning`, `native\tools\analysis-sweep.ps1 <NAME> <Werte>` (drei Sätze), den besten Wert im Code eintragen, ohne `-Tuning` bauen und alle fünf Sätze messen.
- [ ] Wirkt ein Label falsch: Eintrag in `native/LABEL-VERDACHT.md` (Track, Zeitstelle, Label, was das Spektrum zeigt, warum) und weitermachen.
- [ ] Braucht eine Diagnose Zahlen, die das Protokoll nicht hat: Zeile hinter `BTG_ANALYSIS_LOG` ergänzen, eigener Commit `chore(native): …`, vorher und nachher messen, Ausgabe aller Sätze gleich.

---

### Task 1: Robustheitsprüfung (ohne Versuchszählung)

**Files:**
- Create (nicht in Git): `native/build/robust/make.ps1`, `native/build/phase2/measure.ps1`, `native/build/phase2/compare.mjs`
- Modify: `native/core/src/analysis.cpp:307` (nur die Protokollzeile `threes:`), `native/ERGEBNISSE.md`

**Entscheidungen:**
- **Andere Abtastrate statt immer 48 kHz:** 9 der 13 echten Tracks haben schon 48 kHz (44,1 kHz haben nur Before The Dawn, Late Night Groove, Letting Go, Losing Control); alle generierten Sätze haben 44,1 kHz. Die Kopie `rate` bekommt die jeweils andere Rate: 44,1 → 48 kHz, 48 → 44,1 kHz. So wird jeder Track bei einer Rate gemessen, die er noch nicht hat.
- **MP3:** 128 kbit/s fest, Rate wie die Quelle (die echten Tracks haben 113 bis 204 kbit/s; 128 ist der härtere, übliche Fall).
- **Wann eine Ursache gesucht wird:** (a) eine Satzzeile bewegt sich bei `root`, `kind`, `timing` (Anteil) oder `tempo steady` (`off`) um mehr als 0,5 Punkte; (b) ein Zähler für Tempo, Taktart oder Tonart ändert sich; (c) ein einzelner Track bewegt sich um mehr als 5 Punkte bei `root` oder `kind` oder um mehr als 10 Punkte beim `timing`-Anteil (zwei Wechsel eines generierten Tracks), auch wenn es sich im Satz aufhebt.
- **Was mit einer gefundenen Ursache geschieht:** Ist es ein klarer Fehler (eine Größe in Samples statt Sekunden, eine Schwelle am Zeitraster) und der Fix klein, wird er behoben: eigener Commit, alle fünf Sätze und beide Kopien gemessen, kein Satz wird nach den Regeln der Anleitung schlechter. Sonst Vorschlag in `native/VORSCHLAEGE.md`. Beides zählt nicht als Versuch.

**Interfaces (Produces):**

```powershell
# native\build\robust\make.ps1   (ohne Parameter; überspringt vorhandene Ziele)
# Quellen (nur gelesen): C:\dev\samples-raw\analysis-tests, native\build\analysis-set, analysis-set-2,
# analysis-set-detuned, analysis-set-tempo-labeled. Je Audiodatei mit gleichnamiger .json ohne "heldOut": true:
#   native\build\robust\rate\<Ordnername>\<Name>.wav   ffmpeg -v error -y -i <Quelle> -ar <andere Rate> -c:a pcm_s16le
#   native\build\robust\mp3\<Ordnername>\<Name>.mp3    ffmpeg -v error -y -i <Quelle> -c:a libmp3lame -b:a 128k
# und die .json daneben kopiert. Die Rate der Quelle kommt aus ffprobe.

# native\build\phase2\measure.ps1 -Name <name> [-Variant rate|mp3]
# Ohne -Variant: die fünf Original-Sätze, BTG_BEATS_CACHE = native\build\beats-cache.
# Mit -Variant: dieselben Ordnernamen unter native\build\robust\<Variant>\, BTG_BEATS_CACHE = native\build\robust\beats-<Variant>
# (eigener Ordner: die Dateinamen sind dieselben wie bei den Originalen).
# Schreibt native\build\phase2\<name>.txt: die Ausgabe der drei Messbefehle der Anleitung hintereinander (echt + generiert + generiert-2, verstimmt, tempo).
```

```
node native\build\phase2\compare.mjs <vorher.txt> <nachher.txt> [--over <Punkte>]
```

`compare.mjs` ordnet die Zeilen über Satz und Trackname zu und nennt je Track und je `==`-Zeile jedes Feld, das sich unterscheidet: `root`, `maj/min`, `kind`, `triads`, `others`, `changes on the one`, `timing` (Median und Anteil), `tempo steady` (`off`), `beats`, `bars` und die Urteile zu Tempo, Taktart, Tonart. Mit `--over 0.5` nur Unterschiede über 0,5 Punkten (Urteile immer). Am Ende für den Satz „echt“ je `root`, `maj/min`, `kind`: Zuwachs des Satzes mit halbierten Gewinnen der Zeilen mit `[cycle fitted]`, Zahl der Tracks mit Gewinn und mit Verlust, größter Verlust. Vorlage: `native/build/phase1/measure.ps1` und `compare.py`.

- [ ] **Step 1:** `native\build.ps1 -NoApp` am Stand `c176f2f`: Tests grün.
- [ ] **Step 2:** `measure.ps1` und `compare.mjs` schreiben. Prüfen an bekannten Zahlen: die drei Dateien `native\build\phase1\00-baseline-*.txt` und `07-review-fixes-*.txt` je zu einer Datei zusammenfügen; `compare.mjs` der zweiten mit sich selbst gibt nichts aus; erste gegen zweite nennt unter anderem Late Night Groove `timing` 37,2 → 92,0 und `root` 85,4 → 93,2, Letting Go `tempo steady` 14,7 → 1,1, „echt“ `kind` 74,4 → 75,7.
- [ ] **Step 3:** `measure.ps1 -Name 00-orig`. Erwartet: gleich den zusammengefügten `07-review-fixes`-Dateien (`compare.mjs` gibt nichts aus). Sonst anhalten und die Ursache suchen, bevor irgendetwas anderes gemessen wird.
- [ ] **Step 4:** `make.ps1` schreiben und laufen lassen. Prüfen: je Variante 13 / 18 / 18 / 6 / 8 Audiodateien mit Label; `ffprobe` zeigt in `rate` die andere Rate als die Quelle, in `mp3` dieselbe; die Dauer weicht höchstens 0,1 s ab. Platzbedarf etwa 2 GB.
- [ ] **Step 5:** `measure.ps1 -Name 00-rate -Variant rate` und `-Name 00-mp3 -Variant mp3` (das Modell rechnet neu, je Variante einige Minuten).
- [ ] **Step 6:** `compare.mjs 00-orig.txt 00-rate.txt --over 0.5` und dasselbe für `00-mp3.txt`. Die Ausgaben nach `native\build\phase2\robust-rate.txt` und `robust-mp3.txt`.
- [ ] **Step 7: Dreierprüfung.** Die Protokollzeile `threes:` um das Urteil und um die Größe ergänzen, die gegen die Grenze steht: `q = thirds / (half + THREES_FLOOR * onBeat)`, mit zwei Nachkommastellen, und `yes` oder `no` (Grenze `THREES` 1,5). Nur Protokoll: `measure.ps1 -Name 00-orig-b` ist gleich `00-orig.txt`. Commit `chore(native): the analysis log names the verdict of the test for threes`. Dann für jede Datei aller fünf Sätze in allen drei Fassungen `btg_analyze` mit `BTG_ANALYSIS_LOG=1` und dem Zwischenspeicher der Fassung laufen lassen und die Zeile `threes:` sammeln (`native\build\phase2\threes.txt`: Satz, Track, Fassung, `q`, Urteil).
  - Die Untergrenze hält, wenn (a) kein Track sein Urteil zwischen den Fassungen wechselt, (b) das größte `q` mit Urteil `no` höchstens 1,0 ist und (c) das kleinste `q` mit Urteil `yes` mindestens 2,25 (je Faktor 1,5 Abstand zur Grenze). Bekannt aus Phase 1: `reggae-128-60` etwa 0,8 (44,1 kHz) und 0,5 (48 kHz), `dreamy-128-90` etwa 3,0.
  - Hält sie nicht: Ursache am Protokoll des Tracks suchen (was liegt in der MP3- oder Raten-Fassung auf den Dritteln und in der Mitte). Ein Kriterium, das nicht an Rate oder Kodierung hängt, ist ein Fix nach der Regel oben; `THREES_FLOOR` höchstens mit fünf Werten durchprobieren.
- [ ] **Step 8: Ursachen suchen** für jeden Fall aus Step 6 (superpowers:systematic-debugging). Vorgehen je Track: JSON und Protokoll beider Fassungen nebeneinander, die erste Stufe finden, in der sie auseinanderlaufen (Schläge des Modells im Zwischenspeicher, Schläge nach den Regeln, Dreierprüfung, Takte und Eins, Akkordfolge, Akkordart). Zuerst prüfen:
  - Schläge des Modells um einen Rasterschritt (20 ms) verschoben, und eine Regel kippt daran (wie die Halbierungsregel vor Versuch 2 von Phase 1).
  - Größen, die in Samples feststehen: Spektralfenster `N` 4096 und `HOP` 512 bei halber Rate (186 ms bei 44,1 kHz, 171 ms bei 48 kHz). Daran hängen die Fenstergrenze der vorgezogenen Akkorde (`analysis.cpp:550`; bekannt: `qmlHtyS_P8k` liegt mit 176 ms halbem Schlag knapp darüber oder darunter) und die Reichweite der Einsatzstärke.
  - MP3: Vorlauf des Encoders. Die generierten Sätze zeigen ihn direkt: `beats` (Median) muss wie beim Original bei +15 bis +23 ms liegen. Liegt er 25 bis 50 ms daneben, zieht der Dekoder den Vorlauf nicht ab.
- [ ] **Step 9:** Fixes nach der Regel oben, sonst Vorschlag. Nach jedem Fix: `measure.ps1` für Original, `rate` und `mp3`.
- [ ] **Step 10:** `native/ERGEBNISSE.md`, neuer Abschnitt „Phase 2: Akkorde (ab 2026-11-17)“, darin „Robustheitsprüfung“: wie die Kopien entstanden sind; Tabelle je Satz und Fassung (`root`, `maj/min`, `kind`, `triads`, `others`, `timing` Median und Anteil, `tempo steady`, Zähler); alle Fälle mit Ursache; die Tabelle der Dreierprüfung (jeder Track mit `q` über 0,3, die übrigen als Spanne); was behoben wurde, was offen bleibt. Commit `docs: how the measures hold at another sample rate and as MP3`.

### Task 2: Ausgangsstand für Phase 2 und Anleitung

**Files:** `Erkennung messen.md`, `native/ERGEBNISSE.md`

- [ ] **Step 1:** `measure.ps1 -Name 01-baseline`, danach noch einmal als `01-baseline-b`: gleich. Ohne Fix in Task 1 ist das auch gleich `00-orig.txt`.
- [ ] **Step 2:** `Erkennung messen.md`:
  - Kopf und „Ablauf“: Phase 2 läuft nach diesem Plan; Budget 18 Versuche oder 6 in Folge verworfen; Robustheitsprüfung vorweg und ihr Ergebnis in einem Satz; `9pH42-82Mz0` hört der Nutzer selbst, bevor daran gearbeitet wird; `cycle`-Gewinne zählen halb (die Rechnung aus „Global Constraints“).
  - „Stand nach Phase 1“ wird „Ausgangsstand für Phase 2“ mit dem Commit von Step 1. Die Tabelle der echten Tracks bekommt je Track `root` / `maj/min` / `kind` / `triads` / `others` / auf der Eins. Neu: dieselben Werte für die neun Tracks von generiert-2 mit anderen Akkordarten, und die Zeilen der Sätze für die Fassungen `rate` und `mp3`.
  - „Schluss“: 18 statt 30 Versuche, Prüf-Subagent vor `analysisVersion`.
- [ ] **Step 3:** `native/ERGEBNISSE.md`: der Ausgangsstand mit den fünf `==`-Zeilen und der Tabelle aus „Was `--confusions` heute zeigt“ (neu gemessen, falls Task 1 etwas geändert hat).
- [ ] **Step 4:** Commit `docs: the baseline for phase 2`.

### Task 3 (Kandidat, Schläge): `dreamy-128-90` verliert seit Phase 1 1,4 Punkte `root`

**Files:** `native/core/src/analysis.cpp:253` (Regel `drop-extra`)

Bekannt: 12/8 bei 90 bpm, seit Versuch 5 wird ein Schlag bei 38,92 s gestrichen; `root` 93,2 → 91,8 %, `timing` 86,7 → 80,0 %, ein Wechsel liegt 1,3 s daneben.

- [ ] **Step 1: Diagnose.** Bau mit `-Tuning`; den Track einmal mit den eingebauten Werten und einmal mit `BTG_EXTRA=0` (die Regel ist dann aus, das ist der Stand vor Versuch 5) analysieren, je mit `BTG_ANALYSIS_LOG=1`. Vergleichen: Schläge, Takte und Akkorde ab 34 s; die Zeile `drop-extra` bei 38,92 s; die Schläge des Labels (`beats` sind dort die punktierten Schläge, ihre Drittel die Achtel).
- [ ] **Step 2: Entscheiden.**
  - Liegt der gestrichene Schlag auf 50 ms genau auf einem Achtel des Labels, streicht die Regel einen echten Schlag. Dann ist das ein Versuch: die Bedingung, die das Protokoll als falsch zeigt, enger fassen (Hypothese mit der Protokollzeile in `ERGEBNISSE.md`, vor der Änderung). Erwartet: `dreamy-128-90` zurück auf 93,2 % `root`; die Gewinne von Versuch 5 bleiben (`tempo steady` echt 0,2 %, tempo 6,4 %, `country-54-72` `bars` 100 %, `faster-60-66-psych` 0,0 %).
  - Liegt er daneben, war er überzählig, und der Verlust ist eine Folge der verschobenen Taktzählung: unter „Diagnosen ohne Versuch“ eintragen, kein Versuch.
- [ ] **Step 3:** gegebenenfalls „Ablauf je Versuch“, gewertet nach den Regeln für Takte und Zeitlage.

### Task 4 (Kandidat, Akkordgrenzen): Ein Wechsel in der Taktmitte braucht den Bass

**Files:**
- Modify: `native/core/src/analysis.cpp` (nach der Regel für Durchgangsakkorde, vor der Regel für Stille, heute Zeile 498)
- Test: `native/core/tests/test_analysis.cpp`

**Hypothese:** Bei Before The Dawn (15 Wechsel G → Dsus2 und G → F) und Back Door Blues (6 Wechsel A7 → E) klingen die Oberstimmen in den letzten zwei Schlägen des Takts schon nach dem neuen Akkord, der Bass bleibt bis zum Taktanfang auf dem alten Grundton. In der Taktmitte ist ein Wechsel billig und der Bass zählt dort nur 0,3, auf dem vierten Schlag gar nicht. Ein Wechsel in der Taktmitte, dessen Akkord über den nächsten Taktanfang hinaus bleibt, gehört an den Taktanfang, solange der Bass noch den alten Grundton spielt.

**Wertung:** Die Änderung verschiebt, wann ein Wechsel angezeigt wird, wie Versuch 1 von Phase 1. Sie wird deshalb nach den Regeln für Takte und Zeitlage gewertet (`timing` im Satz „echt“ +2 Punkte), dazu die Punkte 2 bis 6 für Akkorde. Regel A ist mit zwei betroffenen Tracks rechnerisch kaum erreichbar (erwartet je etwa +0,4 bei `root` und `maj/min` im Satz).

**Interfaces (Produces, für Task 5 bis 7):**

```cpp
// test_analysis.cpp: a bar of the test track. tones: pitch class and level of each upper voice; bass: pitch class.
// upperEarly, bassEarly: how long before the bar line the upper voices and the bass of this bar begin.
struct Bar { std::vector<std::pair<int, double>> tones; int bass; double upperEarly = 0, bassEarly = 0; };
// The track of the existing tests (96 bpm, click on every beat, octaves as before), the bars repeated in order.
const auto buildBars = [&](const std::vector<Bar>& cycle, unsigned int& noise) -> std::vector<float>;
// the chord of an analysis that sounds at a time
const auto chordAt = [](const btg::Analysis& a, double t) -> const btg::Analysis::Chord&;
```

Der vorhandene `build(early, noise)` wird `buildBars` mit Am F C G, Pegel 0,15, `upperEarly = bassEarly = early`; die vorhandenen Prüfungen bleiben unverändert grün.

- [ ] **Step 1: Diagnose** (Protokollzeile nach „Ablauf je Versuch“): je Akkordwechsel Zeit, Stelle im Takt, alter und neuer Akkord, und die Summe von `beatBass` für den alten und den neuen Grundton vom Wechsel bis zum nächsten Taktanfang. Weiter nur, wenn der Bass an mindestens 10 der 15 Stellen von Before The Dawn und 4 der 6 von Back Door Blues beim alten Grundton liegt und an mindestens 23 der 26 echten Wechsel in der Taktmitte von `9pH42-82Mz0` beim neuen. Sonst unter „Diagnosen ohne Versuch“ eintragen.
- [ ] **Step 2: Failing test.** Der Zyklus Am F C G, in dem die Oberstimmen jedes vierten Takts zwei Schläge früh kommen (`upperEarly = 2 * beat`, `bassEarly = 0`), mit Schlägen und Taktanfängen von außen wie im vorhandenen Test `gridded`:

```cpp
// A change in the middle of the bar needs the bass: upper voices that come two beats early do not move it.
int onBar = 0, changes = 0;
for (size_t i = 1; i < heldBass.chords.size(); ++i, ++changes)
    if (std::fabs(std::remainder(heldBass.chords[i].start, 4 * beat)) < 0.15 * beat) ++onBar;
CHECK(changes >= bars - 3 && onBar == changes);
// With the bass it is a change in the middle of the bar and stays there.
int midBar = 0;
for (size_t i = 1; i < bothEarly.chords.size(); ++i)
    if (std::fabs(std::fabs(std::remainder(bothEarly.chords[i].start, 4 * beat)) - 2 * beat) < 0.15 * beat) ++midBar;
CHECK(midBar >= bars / 4 - 1);
```

  `bothEarly` ist derselbe Zyklus mit `upperEarly = bassEarly = 2 * beat` in jedem vierten Takt.
- [ ] **Step 3:** `native\build.ps1 -NoApp` → `onBar == changes` schlägt fehl.
- [ ] **Step 4: Regel.** Nur wenn `half < perBar` (gerade Takte ab vier Schlägen, nicht 6/8 und 12/8). Für jeden Wechsel bei Schlag `b` mit `place[b] == half`, dessen Akkord am nächsten Taktanfang `one` noch gilt (`path[one] == path[b]`): Ist die Summe von `beatBass[k][alter Grundton]` über `k` in `[b, one)` größer als `knob("HALF_BASS", 1.0)` mal die für den neuen Grundton, bekommen die Schläge `[b, one)` den alten Akkord. Tests grün.
- [ ] **Step 5:** Messen und werten. Erwartet: Before The Dawn `timing` 74,6 → über 85 %, `root` 89,2 → etwa 93 %; Back Door Blues `timing` 83,9 → über 90 %. Sicherungen: `9pH42-82Mz0` behält `timing` 92,9 % und die Verteilung 78/0/26/0; die Zeilen der Tracks aus Review Focus 4 sind unverändert; `changes on the one` fällt in keinem Satz um mehr als einen Punkt. `HALF_BASS` wird nur durchprobiert (0,7 / 0,85 / 1,2 / 1,5), wenn die Regel in der Richtung stimmt und eine Sicherung knapp reißt.

### Task 5 (Kandidat, Akkordart): sus4 nur bei schwacher Terz

**Files:** `native/core/src/analysis.cpp:586`; Test in `test_analysis.cpp`

**Hypothese:** `maj → sus4` (54 s im Satz „echt“) entsteht, wo über einem Dreiklang die Quarte lauter ist als die Terz (Melodie, liegender Grundton der Tonart). Die Regel verlangt heute nur „Quarte über 0,7 und lauter als die Terz“. Ein sus-Akkord hat keine Terz: Sie muss zusätzlich schwach sein. Gewinnen sollen `triads` und `kind` im Satz „echt“ (vor der Änderung aus `--confusions` benennen, welcher Track die 54 s trägt); `sus4 → sus4` in generiert-2 (10 s) bleibt.

- [ ] **Step 1: Failing test** mit `buildBars`: C-Dur-Dreiklang (Pegel 0,15) mit der Quarte F auf 0,2 → `chordAt(...).kind == "maj"`; Csus4 (C, F, G auf 0,15, E auf 0,05, also über der Grenze `K_BARE` und unter der neuen) → `"sus4"`; derselbe Track mit zwei Takten Stille davor meldet für beide Takte dieselben Arten (Review Focus 2).
- [ ] **Step 2:** Bedingung ergänzen: Terz unter `knob("K_SUS_THIRD", 0.5)` mal `ref`. Tests grün.
- [ ] **Step 3:** Messen. Bei Bedarf `K_SUS_THIRD` mit 0,3 / 0,4 / 0,6 durchprobieren (zusammen vier Werte). Werten nach B.

### Task 6 (Kandidat, Akkordart): sus2 und sus4 nach derselben Regel, bei Dur und Moll

**Files:** `native/core/src/analysis.cpp:580-591`; Test in `test_analysis.cpp`

**Hypothese:** sus2 wird heute nur erkannt, wenn gar keine Terz da ist (unter 0,2). Deshalb `sus2 → min` 78 s (Before The Dawn, Dsus2 als Dm), `sus2 → maj` 51 s und `sus2 → add9` 28 s (Letting Go, Bbsus2); im Moll-Zweig gibt es keine sus-Regel (`sus4 → min` 11 s in generiert-2). Die Regel aus Task 5 gilt für die Sekunde wie für die Quarte und in beiden Zweigen: Der Nachbar der Terz ist deutlich da (über `K_SUS`), lauter als die Terz, und die Terz ist schwach (unter `K_SUS_THIRD`). „Terz“ ist dabei die stärkere von kleiner und großer Terz, wie bei der Grenze `K_BARE`. Sind beide Nachbarn so, gewinnt der lautere. Geprüft wird das vor den Septimen, im Moll-Zweig nach der Prüfung auf vermindert.

Wird Task 5 verworfen, läuft dieser Versuch ohne die Bedingung „Terz schwach“ (Nachbar lauter als die Terz genügt), und `triads` entscheidet.

- [ ] **Step 1: Failing test:** Dsus2 (D, E, A auf 0,15, F auf 0,05) → `"sus2"`; d-Moll mit leiser None (D, F, A auf 0,15, E auf 0,05) → `"min"`; Asus4 in a-Moll-Umgebung (A, D, E auf 0,15, C auf 0,05) → `"sus4"`.
- [ ] **Step 2:** Regel einbauen, Tests grün.
- [ ] **Step 3:** Messen, werten nach B. Erwartet: Before The Dawn `others` 0,0 % deutlich hoch, Letting Go `others` 25,1 % hoch, die drei `-open`-Tracks von generiert-2 hoch. Besonders ansehen: `triads` in allen Sätzen (Regel 4), `add9` und `min9` in generiert-2 (`add9 → add9` 3 s, `min9 → min9` 7 s dürfen nicht zu sus2 werden).

### Task 7 (Kandidat, Akkordart): Ein sus-Akkord steht auf dem Ton, den der Bass spielt

**Files:** `native/core/src/analysis.cpp` (nach der Regel für den Sext-Akkord, Zeile 595); Test in `test_analysis.cpp`

**Hypothese:** Esus4 (E A H) und Asus2 (A H E) haben dieselben Töne. Die Glättung kennt nur Dreiklänge und wählt A; `country-open` hat deshalb 74,0 % `root` („Esus4 → Asus2, A, Aadd9“), `psych-open` 85,0 % („Csus2 → G“). Wie beim Sext-Akkord entscheidet der Bass: Liegt er über die Dauer des Akkords auf der Quinte statt auf dem Grundton, wird der Akkord vom Basston aus gelesen; sind von dort Grundton, Quarte und Quinte deutlich da und die Terz schwach, ist es der sus4 auf dem Basston. Entsprechend mit dem Bass auf der Quarte und sus2. Die Regel hängt nicht davon ab, welche Art vorher gemeldet war (sus2, add9 oder Dreiklang), und braucht Task 6 deshalb nicht.

- [ ] **Step 1: Failing test:** Töne E, A, H mit Bass E, zwischen Takten in A-Dur → `chordAt(...)` hat `root == 4`, `kind == "sus4"`, `minor == false`; Töne A, H, E mit Bass A → `root == 9`, `kind == "sus2"`; C-Dur mit der Quinte im Bass (C, E, G, Bass G) bleibt `root == 0`, `kind == "maj"`. Dazu für die ganze Analyse: `start < end`, lückenlos, und der Name passt zu `root` und `kind` (Review Focus 3).
- [ ] **Step 2:** Regel: Bass auf der Quinte heißt `low[Quinte] > knob("SUS_BASS", 1.0) * low[Grundton]`, entsprechend mit der Quarte; die sus-Prüfung vom Basston aus mit den Grenzen der vorhandenen sus-Regel (`K_SUS`, und `K_SUS_THIRD`, falls Task 5 behalten wurde, sonst „lauter als die Terz“), dazu muss die Quinte über dem Basston deutlich da sein; `root`, `minor = false` und `kind` neu setzen. Tests grün.
- [ ] **Step 3:** Messen, werten (A oder B; der Gewinn liegt vor allem in generiert-2, im Satz „echt“ muss trotzdem A oder B gelten). Erwartet: `country-open` `root` über 90 %. Kein echter Track verliert `root`.

### Task 8 (Kandidat, Akkordart): Powerchords

**Files:** `native/core/src/analysis.cpp:571` (`K_BARE`)

**Hypothese:** `power → min` 83 s (Losing Control, B5 als Bm) und `power → maj` / `power → min` je 18 s in generiert-2: Die Grenze „Terz unter 0,2“ ist für Aufnahmen mit Obertönen und Hall zu streng.

- [ ] **Step 1: Diagnose** mit einer Protokollzeile je Akkord (Zeit, Name, Terz geteilt durch `ref`): Bei Losing Control die Werte der Akkorde zur Zeit der Labels B5 gegen die zur Zeit der Labels Bm, Em. Liegen sie gleich, spielt die Band dort eine Terz: Eintrag in `native/LABEL-VERDACHT.md`, kein Versuch.
- [ ] **Step 2:** Sonst `K_BARE` mit höchstens vier neuen Werten zwischen dem heutigen und dem, was die Diagnose als Trennung zeigt. Werten nach B; `triads` fällt in keinem Satz (verzerrte Gitarren haben oft eine schwache Terz, dort droht der Verlust).

### Task 9 (Versuche bis 18): was danach offen ist

Nur solange das Budget reicht. Jeder Kandidat braucht vor der Änderung eine Diagnose mit `--confusions` oder dem Protokoll; ohne belegte Ursache kein Versuch. Reihenfolge nach dem, was `--confusions` nach den behaltenen Versuchen zeigt; heute wäre es:

1. **Septimen, die fehlen:** `dom7 → maj` 167 s (`V1r4wWATS9Y`, `cycle`), `maj7 → maj` 54 s (Losing Control) und 60 s in generiert-2, `min9 → min` 116 s (Smooth Jazz, `cycle`). Diagnose: Stärke der Septime geteilt durch `ref` bei Label-Septakkorden gegen Label-Dreiklänge desselben Satzes. Nur wenn sich beide trennen lassen, ein Versuch. Schon verworfen: leitereigene Septimen leichter gelten lassen.
2. **Septimen, die das Label nicht nennt:** `min → min7` 148 s (Late Night Groove, Gm als Gm7). Ist die Septime dort so stark wie die Akkordtöne, ist es ein Fall für `native/LABEL-VERDACHT.md`, kein Versuch.
3. **Losing Control:** 4 Wechsel Em → G bleiben einen halben Schlag spät (die Regel für vorgezogene Akkorde greift nicht).
4. **Back Door Blues:** „E → A 16 s“ (Label E, gemeldet A); zu prüfen, ob Task 4 das mit erledigt hat.
5. **`dreamy-128-90`, `psych-68-72`:** F# als F#m, F#m als F# (Dur/Moll 79,4 und 92,5 %).

- [ ] je Kandidat: Diagnose, dann „Ablauf je Versuch“

### Task 10: Phase 2 abschließen

- [ ] **Step 1: Endstand.** `measure.ps1 -Name 99-final`, zweimal, gleich. Dazu `-Variant rate` und `-Variant mp3`: `compare.mjs` gegen `99-final.txt` mit denselben Schwellen wie in Task 1; die Gewinne bei `kind` und `root` gegenüber `00-rate.txt` und `00-mp3.txt` sind auf 0,5 Punkte dieselben wie bei den Originalen. Sonst Ursache suchen, und der betroffene Versuch steht wieder zur Wahl.
- [ ] **Step 2: Prüf-Subagent mit frischem Kontext** (verlangt vom Nutzer, wie in Phase 1). Er bekommt nur `git diff c176f2f...HEAD` als Datei und `Erkennung messen.md` und prüft: A oder B und die Punkte 2 bis 6 für jeden behaltenen Versuch an den `==`-Zeilen in `ERGEBNISSE.md` nachgerechnet, samt der halben Wertung der `cycle`-Tracks; Task 3 und 4 nach den Regeln für Takte; keine Sonderfälle für Tracks oder Dateinamen; `native/tools` und Labels unverändert; nichts zu den unangetasteten Tracks; höchstens fünf Werte je Knopf; jeder gemessene Versuch steht mit seinen Zahlen im Protokoll und ist gezählt; nichts an `9pH42-82Mz0` ausgerichtet; neue Zahlen im Code sind `knob(...)`.
- [ ] **Step 3:** Berechtigte Befunde beheben und nachmessen; alle Befunde mit dem, was daraus wurde, in `ERGEBNISSE.md`.
- [ ] **Step 4:** `analysisVersion` in `native/app/PluginProcessor.cpp:16` auf `2026-11-17g` (an einem späteren Tag: dessen Datum mit `a`).
- [ ] **Step 5:** `native\build.ps1` (mit App), Tests grün. App gegen Werkzeug für Letting Go, Late Night Groove und `pGi9fs2HhZ0` wie in Phase 1 (`position-check.mjs`, dann `btg_analyze` ohne Zwischenspeicher, ganzes JSON gleich). `node native/tools/track-check.mjs` mit Late Night Groove: Anzeige 20/20, keine Fehler. Laufzeit von „Letting Go“ ohne Zwischenspeicher notieren (Grenze 22 s).
- [ ] **Step 6:** `native/BERICHT.md`: Diagnose des Versatzes und was daraus wurde; Ausgangs- und Endstand aller Sätze (vor Phase 1, nach Phase 1, nach Phase 2); Robustheitsprüfung; was geholfen hat, was nicht; offene Ideen; Label-Verdachtsfälle; Vorschläge; Befunde des Prüf-Subagenten. `Erkennung messen.md` (Endstand, Phase 2 erledigt) und `native/UEBERGABE.md` nachführen.
- [ ] **Step 7:** Commits `chore(native): analysisVersion …` und `docs: the report on the analysis run`. Nicht pushen. Dem Nutzer melden: Zahlen vorher und nachher, was er in der App prüfen kann, was offen ist, und dass er jetzt die unangetasteten Tracks misst (`node native/tools/analysis-score.mjs C:\dev\samples-raw\analysis-tests --held-out`, nachdem er sie zurückgelegt hat).
