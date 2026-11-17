# Vorschläge aus Phase 0

**Entscheidung des Nutzers, 2026-11-17:** Nr. 6 ja, als gemeinsamer Dekodierweg im Kern für App und `btg_analyze`. Nr. 5 ja. Nr. 4 ja: nur ein Achtel vor dem Schlag (bei Swing dort, wo das Achtel des Tracks liegt), Änderung an der Seite so klein wie möglich, `triads` und `root` fallen nicht, kein Fehlalarm in den generierten Sätzen.

Ursachen und Belege stehen in [DIAGNOSE.md](DIAGNOSE.md). Stand nach Phase 1 (2026-11-17): Nr. 2, 3, 4, 5 und 6 sind umgesetzt, Nr. 1 ist gemessen und verworfen; Einzelheiten in [ERGEBNISSE.md](ERGEBNISSE.md), „Phase 1“. Der Text unten ist der Stand nach Phase 0. Die Vorschläge 1 bis 3 sind Versuche für Phase 1 und brauchen keine Entscheidung. Die Vorschläge 4 bis 6 brauchen eine.

## Für Phase 1 (Regeln in `analysis.cpp`)

### 1. Doppelt gezählte Abschnitte auf den Schlägen des Modell-Taktanfangs halbieren

- **Was:** Wenn ein Abschnitt halbiert wird, die Schläge behalten, auf denen die Taktanfänge des Modells liegen, statt ab dem zuletzt behaltenen Schlag jeden zweiten zu nehmen.
- **Warum:** Bei „Letting Go“ wurden 44 Taktanfänge des Modells als Zwischenschlag gestrichen; 84 Schläge liegen dadurch einen halben Schlag daneben. Bei „Comfortably Numb“ wurde keiner gestrichen, dort stimmt die Lage.
- **Erwartet:** „Letting Go“: `tempo steady` und `timing` besser, Takte mit falscher Länge weniger. Unter den echten Tracks ist sonst keiner betroffen (nur diese zwei werden halbiert).
- **Aufwand:** klein.

### 2. Die Oktav-Prüfung nicht am 20-ms-Raster scheitern lassen

- **Was:** Den üblichen Abstand des Tracks und der Umgebung feiner bestimmen (Mittel der Abstände nahe am Median statt eines Rasterwerts) oder die Toleranz um einen Rasterschritt erweitern.
- **Warum:** 0,42 s gegen 0,39 s sind 7,7 % und fallen durch die 6-%-Grenze, obwohl beide denselben wahren Abstand (0,395 s) meinen. Deshalb kippt die Entscheidung auch zwischen App und Messwerkzeug.
- **Erwartet:** Abschnittsanfänge werden sicher erkannt. Zu prüfen am Test für 90 auf 126 bpm und am Satz „tempo“, dass echte Tempowechsel bleiben.
- **Aufwand:** klein.

### 3. Einzelne überzählige Schläge entfernen

- **Was:** Ein Schlag, der zwischen zwei Schlägen im üblichen Abstand auf halber Strecke oder dichter liegt, außerhalb eines doppelt gezählten Abschnitts, fällt weg.
- **Warum:** 22 solche Schläge bei „Letting Go“, weitere bei Losing Control, Back Door Blues, One Last Time und Comfortably Numb. Jeder verschiebt die Taktzählung und das angezeigte Tempo.
- **Erwartet:** `tempo steady` im Satz „echt“ fällt (heute 1,8 % der Schläge), weniger Takte mit falscher Länge.
- **Aufwand:** klein.

## Braucht eine Entscheidung

### 4. Akkordwechsel zwischen den Schlägen zulassen

- **Was:** Die Analyse bestimmt heute einen Akkord je Schlag. Vorgezogene Akkorde (auf dem Achtel vor dem Schlag) erscheinen deshalb einen halben Schlag zu spät. Vorschlag: den Chroma je halbem Schlag rechnen und einen Wechsel auf das Achtel legen, wenn die zweite Hälfte des Schlags schon zum neuen Akkord gehört.
- **Warum:** Das ist der größte Teil des Versatzes, den der Nutzer sieht. „Late Night Groove“: 63 % der Wechsel mehr als 0,3 s zu spät, Median +486 ms gegen das Audio. „Letting Go“: 35 %.
- **Erwartet:** `timing` im Satz „echt“ deutlich besser (heute 78,8 % innerhalb 0,3 s). `root` steigt mit, weil jeder verspätete Wechsel 0,4 s falschen Akkord bedeutet.
- **Entscheidung nötig, weil:** `chords[].t` läge nicht mehr immer auf einem Schlag. Die Seite baut ihre Anzeige aus Akkorden je Schlag ([track.js](app/web/track.js), `byBeat`); sie müsste Wechsel zwischen den Schlägen übernehmen. Das ändert die Schnittstelle zur App.
- **Aufwand:** mittel in `analysis.cpp`, klein bis mittel in der Seite.
- **Ein erster Versuch ohne Umbau hat nichts gezeigt:** Mit Achteln als Schlägen an die heutige Analyse übergeben, bleiben fast alle Wechsel auf den Vierteln (bei „Letting Go“ 12 von 227), weil die Wechselkosten Taktanfang und Taktmitte bevorzugen. Es braucht eine eigene Regel.

### 5. Zwischenspeicher der Schläge an Größe und Änderungszeit der Datei binden

- **Was:** `BTG_BEATS_CACHE` merkt die Schläge nur unter dem Dateinamen ([analyze.cpp](core/tools/analyze.cpp)). Der Schlüssel sollte Größe und Änderungszeit enthalten.
- **Warum:** Nach dem Neurendern der generierten Sätze liefert der alte Ordner falsche Schläge, ohne dass es jemand merkt. Heute hilft nur, den Ordner zu leeren.
- **Entscheidung nötig, weil:** Es ist ein Messwerkzeug, und die sind nach Phase 0 gesperrt.
- **Aufwand:** wenige Zeilen.

### 6. Die App so messen, wie sie analysiert

- **Was:** `btg_analyze` und die App dekodieren MP3 verschieden (dr_mp3 gegen JUCE); die Schläge der App liegen 20 ms später, und bei „Letting Go“ fallen Entscheidungen anders aus. Zwei Wege: `position-check.mjs` schreibt die Analyse der App schon heraus und könnte sie für alle 13 Tracks gegen die Labels werten; oder beide benutzen denselben Dekoder.
- **Warum:** Gemessen wird sonst etwas anderes, als der Nutzer sieht.
- **Erwartet:** Mit den Vorschlägen 1 bis 3 sollte der Unterschied klein werden (die Entscheidungen hängen dann nicht mehr an 20 ms). Dann genügt eine Kontrolle am Schluss.
- **Entscheidung nötig, weil:** neuer Messweg oder Eingriff in den Dekoder.
- **Aufwand:** Kontrolle am Schluss klein; gemeinsamer Dekoder mittel.

## Zur Messung selbst

- **„Wechsel auf der Eins“ ist bei vorgezogenen Akkorden irreführend.** „Late Night Groove“ steht bei 37 %, obwohl die Takte richtig liegen. Für die Lage der Eins taugen die generierten Sätze besser (neue Zahl `bars`: Anteil der Taktanfänge des Generators mit einem gefundenen Taktanfang innerhalb von 50 ms).
- **Die Drift je Satz ist bei kurzen Tracks unruhig** (wenige Wechsel in 40 s). Belastbar ist sie im Satz „echt“ und je Track.

## Aus Phase 2 (Robustheitsprüfung, 2026-11-17)

### 7. Immer bei derselben Abtastrate analysieren

- **Was:** Die Analyse rechnet heute bei der halben Rate der Datei (22,05 kHz bei 44,1-kHz-Dateien, 24 kHz bei 48-kHz-Dateien), mit einem Fenster von 4096 Samples. Vorschlag: vor der Analyse immer auf 22,05 kHz umrechnen, damit Fenster und Schrittweite in Sekunden für jede Datei gleich sind.
- **Warum:** Dieselbe Musik als 44,1- und als 48-kHz-Datei ergibt heute nicht dasselbe. Das Fenster ist 186 oder 171 ms lang. Davon hängt ab, ob die Regel für vorgezogene Akkorde greift (Back Door Blues: 12 von 101 Wechseln bei 48 kHz, 1 von 100 bei 44,1 kHz), und einzelne Akkorde kippen an den Schwellen für die Akkordart (in „generiert“ `kind` 92,4 gegen 94,0 %, einzelne Tracks um 12 Punkte). Einzelheiten in [ERGEBNISSE.md](ERGEBNISSE.md), „Robustheitsprüfung“.
- **Erwartet:** Die Zahlen der Sätze bleiben im Mittel etwa gleich. Gemessen ist nur ein Anhalt: Mit allen 13 echten Tracks in der anderen Rate waren `root` und `maj/min` gleich, `kind` −0,2, `timing` +0,5, `others` −2,2. Der Vorschlag selbst ändert nur die neun Tracks mit 48 kHz; für ihn gibt es keine Messung. Gewonnen wird Gleichheit, nicht Trefferquote. Die Akkorde an den Schwellen kippen weiter bei MP3 gegen WAV; dagegen hilft der Vorschlag nicht.
- **Entscheidung nötig, weil:** 9 der 13 echten Tracks haben 48 kHz; ihre Ergebnisse ändern sich um einige Zehntel in beide Richtungen, `triads` im Satz fiele nach der Messung der Kopien um 0,2 Punkte. Außerdem braucht der Kern einen Umrechner (einige Zeilen mit linearer Interpolation nach dem Halbieren; ob das für die Einsatzstärke genügt, wäre zu messen).
- **Aufwand:** klein bis mittel, danach alle Schwellen neu messen.

### 8. Wechsel in der Taktmitte, bei denen der Bass klar auf dem alten Grundton bleibt, an den Taktanfang legen

**Erledigt (2026-11-17):** Versuch 4 von Phase 2 fasst die Regel anders (der Bass kippt erst am Taktanfang), erreicht damit die Schwelle der Anleitung (`timing` im Satz „echt“ +2,3 Punkte, kein Verlust) und ist behalten. Der Text unten ist der Stand nach Versuch 2.

- **Was:** Die strenge Fassung von Versuch 2 aus Phase 2: Ein Akkord, der in der Taktmitte beginnt und über den nächsten Taktanfang bleibt, beginnt erst am Taktanfang, wenn der alte Grundton im Bass bis dahin mindestens 1,2-mal so stark ist wie der neue.
- **Warum:** Back Door Blues meldet sechs Wechsel A7 → E zwei Schläge zu früh; der Bass liegt dort drei- bis viermal so stark auf A.
- **Gemessen:** Kein Track irgendeines Satzes verliert. Back Door Blues `timing` 83,9 → 94,6 %, `root` 90,8 → 92,2 %; One Last Time `timing` 97,0 → 98,0 %; `hardrock-colours` (generiert-2) `root` 97,2 → 99,2 %. Satz „echt“: `timing` 90,8 → 92,1 %, `root` 94,8 → 95,0 %.
- **Entscheidung nötig, weil:** Die Regel der Anleitung verlangt +2 Punkte `timing` im Satz „echt“; erreicht sind +1,3, fast ganz aus einem Track. Nach den Regeln ist der Versuch verworfen. Ob ein Gewinn ohne Verlust auf drei Tracks reicht, entscheidet der Nutzer.
- **Aufwand:** klein; Regel und Test liegen in der Geschichte des Laufs (Versuch 2 in [ERGEBNISSE.md](ERGEBNISSE.md)) und sind in zehn Minuten wieder eingebaut.

### 9. Knappe Akkordarten nach der Mehrheit im Track entscheiden, und sus4 nur bei schwacher Terz

**Angenommen vom Nutzer am 2026-11-17 und auf `develop` umgesetzt** (`analysisVersion` `2026-11-17h`). Neu gemessen auf `develop`: `kind` im Satz „echt“ 76,2 → 77,8 %, `triads` 87,2 → 89,8 %, `others` 43,6 → 36,3 %; generiert 92,4 → 93,8 %, generiert-2 70,1 → 70,8 % (`triads` 94,7, `others` 39,0), verstimmt 78,1 → 81,2 %, tempo 95,1 → 96,2 %; `root`, `maj/min`, `timing` und alle Zähler unverändert. Der Text unten ist der Stand vor der Entscheidung.

- **Was:** Zwei Regeln für die Akkordart, zusammen. (a) Ein Akkord, den 20 % strengere und 20 % lockerere Schwellen verschieden lesen, bekommt die Art, die derselbe Akkord (Grundton und Terz) im Track dort hat, wo er klar ist. (b) Ein sus4 wird nur gemeldet, wenn die Terz schwach ist (unter 0,5 von Grundton und Quinte).
- **Warum:** Die Robustheitsprüfung hat gezeigt, dass die Akkordart an den Schwellen kippt: Derselbe Akkord ist in einem Takt ein Septakkord, im nächsten ein Dreiklang. (b) nimmt einen häufigen Fall weg: einen Dreiklang mit einem lauten Ton darüber (Hard Rock, Akkord F).
- **Gemessen** (Versuche 5 bis 7 von Phase 2 in [ERGEBNISSE.md](ERGEBNISSE.md), auch an den Kopien in anderer Abtastrate und als MP3): `kind` im Satz „echt“ 76,2 → 77,8 % (mit halbierten `cycle`-Gewinnen +1,00, an den Kopien +1,23 und +1,14); `triads` steigt in jedem Satz (echt 87,2 → 89,8, generiert 92,4 → 93,8, generiert-2 93,7 → 94,8, verstimmt 78,1 → 81,2, tempo 95,1 → 96,2); `root`, `maj/min`, `timing` und alle Zähler unverändert.
- **Was dagegen spricht:** `others` fällt: im Satz „echt“ von 43,6 auf 36,3 % (fast ganz `9pH42-82Mz0`, wo wenige Sekunden Asus4 und A7 die Zahl tragen), in generiert-2 von 39,6 auf 39,0 % (an den Kopien bis −2,5). Zwei Drittel des Gewinns im Satz „echt“ kommen aus einem Track (Hard Rock, `cycle`); One Last Time und `V1r4wWATS9Y` verlieren je 2 Punkte. Für sich allein erreicht Regel (a) die Schwelle der Anleitung nur auf den Originalen (genau +1,00) und nicht in der anderen Abtastrate (+0,36); Regel (b) erreicht sie nirgends (+0,66 bis +0,87).
- **Entscheidung nötig, weil:** Die Vorgabe für Phase 2 lautet, dass Regeln für sus-Akkorde nur bleiben, wenn `others` in generiert-2 steigt, und dass ein Gewinn aus fast nur einem Track nicht reicht. Nach den Regeln A/B der Anleitung allein wäre die Änderung geblieben.
- **Aufwand:** keiner. Der Code mit Tests liegt auf dem Zweig `exp/analysis-close-calls` (zwei Commits über dem Stand nach Versuch 4, vor den Korrekturen aus der Prüfung); `git merge exp/analysis-close-calls` auf `exp/analysis-agent` (in `analysis.cpp` und im Test sind dabei Konflikte mit den Korrekturen zu lösen), neu messen, dann `analysisVersion` hochzählen.

### 10. Grundton von sus-Akkorden nach dem Bass

- **Was:** Esus4 (E A H) und Asus2 (A H E) haben dieselben Töne. Die Analyse kennt beim Glätten nur Dreiklänge und meldet beide Takte als einen Akkord auf A. Vorschlag: einen Akkord ohne deutliche Terz an den Taktanfängen teilen und in jedem Takt den Ton als Grundton nehmen, den der Bass spielt.
- **Warum:** `country-open` (generiert-2) hat deshalb 74,0 % `root`, `psych-open` 85,0 %.
- **Erwartet:** `country-open` über 90 % `root`, generiert-2 `root` etwa +1 Punkt. Im Satz „echt“ gibt es keinen solchen Fall; A und B der Anleitung wären dort nicht zu erfüllen, deshalb kein Versuch in Phase 2.
- **Entscheidung nötig, weil:** Der Gewinn läge nur in einem generierten Satz. Sinnvoll erst zusammen mit einer Regel, die sus-Akkorde überhaupt erkennt (Diagnose in [ERGEBNISSE.md](ERGEBNISSE.md): in echten Tracks spricht eine sus2-Regel öfter bei Akkorden an, die das Label als Dur führt).
- **Aufwand:** mittel.

### 11. Einen überzähligen Schlag streichen, wo immer er zwischen zwei Schlägen liegt

- **Was:** `EXTRA` in `analysis.cpp` von 0,6 auf 0,8. Heute fällt ein Schlag nur weg, wenn er in den ersten 60 % der Strecke zwischen zwei Schlägen im üblichen Abstand liegt.
- **Warum:** `dreamy-128-90` (12/8) hat zwei überzählige Schläge des Modells auf den Achteln, bei einem und bei zwei Dritteln. Der erste fällt weg, der zweite bleibt und verschiebt den letzten Taktanfang.
- **Gemessen** (Versuch 1 von Phase 2 in [ERGEBNISSE.md](ERGEBNISSE.md)): `dreamy-128-90` `bars` 93,8 → 100 %, `tempo steady` 6,9 → 0,0 %, `root` 91,8 → 93,2 %; Back Door Blues `tempo steady` 1,2 → 0,3 %. Alle anderen 61 Tracks Zeile für Zeile gleich.
- **Entscheidung nötig, weil:** Die Regel der Anleitung verlangt einen Gewinn bei `timing` oder `tempo steady` im Satz „echt“ oder „tempo“. Der Satz „echt“ zeigt ihn auf eine Nachkommastelle nicht (0,2 beide Male; das Mittel der Trackwerte geht von 0,24 auf 0,17). Der Versuch war zuerst knapp behalten und ist nach der Prüfung zurückgenommen.
- **Aufwand:** eine Zahl und eine Testzeile (Commit `4415353` zeigt beide).

### 12. sus2 und sus4 nach einer Regel erkennen

- **Was:** Eine Sekunde oder Quarte, die deutlich da ist und lauter als die Terz, macht einen sus-Akkord, bei Dur und bei Moll.
- **Warum:** sus2 wird heute nur erkannt, wo gar keine Terz zu hören ist. In generiert-2 werden 39,6 % der anderen Akkordarten erkannt.
- **Gemessen** (Versuch 9 von Phase 2): generiert-2 `others` 39,6 → 49,3 %, `kind` 70,1 → 73,7 %, ohne Verlust bei den Dreiklängen; `country-open`, `psych-open`, `rock-open` gewinnen 16 bis 29 Punkte. Im Satz „echt“ fällt `kind` von 76,2 auf 74,8 % und `triads` von 87,2 auf 84,5 %: Before The Dawn −12,3 Punkte, One Last Time −6,7, Letting Go +3,5.
- **Entscheidung nötig, weil:** Die Verluste im Satz „echt“ sind Akkorde, die das Video als Dur anzeigt und die im Spektrum eine laute Sekunde und eine schwache Terz haben (F bei Before The Dawn in 54 von 105 s). Ob die Band dort Fsus2 spielt oder das Label stimmt, lässt sich nur hören. Stimmt das Label, bleibt die Regel draußen. Spielt die Band sus2, messen die Labels hier das Falsche, und die Regel wäre ein Gewinn. Die Stellen stehen in [LABEL-VERDACHT.md](LABEL-VERDACHT.md).
- **Aufwand:** keiner. Der Code mit Tests liegt auf dem Zweig `exp/analysis-sus` (ein Commit über dem Endstand).
