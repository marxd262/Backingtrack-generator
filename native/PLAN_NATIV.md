# Plan: native App löst die Web-Version ab

Stand 2026-11-17. Abschluss des Machbarkeitstests: `MACHBARKEIT_JUCE.md`. Messwerte: `ERGEBNISSE.md`. Dieser Plan ersetzt `PLAN.md` (Plan des Tests).

## 1. Entscheidungen des Nutzers (2026-11-17)

- Die native App löst die Web-Version ab. Der Generator wird vollständig portiert, die Oberfläche verfeinert, die Analyse so weit optimiert wie möglich, die Seite für eigene Backingtracks ausgebaut.
- **Quellen:** nur Audio- oder Videodateien, die der Nutzer selbst bereitstellt. Kein YouTube-Download in der App.
- **Backingtrack-Seite:** Griffbrett und Akkordrad sind Pflicht. Links ein Fenster „Jetzt“ und „Als Nächstes“. Erkannte Muster (Akkordfolgen) statt der langen Taktliste. Unter dem Griffbrett der Song als Spuren, die Akkorde direkt darüber an ihrer Stelle. In der Spur zoomen, scrollen und springen. Schleifen setzt man in der Spur. Tempo des Tracks regelbar. Bei Videodateien läuft das Bild mit.
- **Scrollen:** Die Spur scrollt in sich waagerecht, wenn der Mauszeiger auf ihr steht. Scrollen verändert nie die Abspielposition; gesprungen wird nur durch Klick.
- **Stems:** entfallen vorerst (Entscheidung nach der Messung: sie verbessern die Analyse nicht). Es gibt eine Spur, den Track selbst. Der Punkt kommt wieder auf, wenn die Trennung an dichteren Tracks einen Vorteil zeigt.
- **Akkord-Erkennung:** so weit optimieren wie möglich.
- **Speichern:** Zwischenspeicher ja, eine Projektdatei ist keine Pflicht.
- **Analyse:** weitere Taktarten, Tempowechsel und mehr Akkordarten gehören in Bau und Plan.
- Gepusht wird nur vom Nutzer. Einfache Lese- und Fleißaufgaben gehen an günstigere Subagenten.

## 2. Offene Punkte: geprüft am 2026-11-17

| Frage | Befund | Folge |
|---|---|---|
| Ist Demucs die beste Wahl? | Klanglich ja (8,8 bis 9,0 dB SDR). **Rechtlich nein:** Der Autor schreibt, die Gewichte seien nicht von der MIT-Lizenz gedeckt und nur für Forschung. Dasselbe gilt für alles, was auf MUSDB18 trainiert ist (Open-Unmix, SCNet, die meisten RoFormer). Einzig Spleeter (Deezer) nennt seine Modelle in der eigenen Veröffentlichung MIT-lizenziert, trennt aber deutlich schlechter (etwa 5,9 dB). | Kein Trennmodell wird ausgeliefert, bis eine schriftliche Freigabe vorliegt. Demucs bleibt ein Werkzeug auf dem Entwicklungsrechner. |
| Verbessern Stems die Analyse genug? | **Gemessen: nein**, auf den vier echten Tracks mit der heutigen Analyse. Grundton 88 bis 90 % statt 88 %, Dur/Moll 74 bis 78 % statt 83 %, Tonart 1 bis 2 von 4 statt 4 von 4 (drei Verdrahtungen). | Erst die Analyse selbst verbessern, dann an dichteren Tracks neu messen. Stems sind kein Hebel für diese Art Track. |
| Rechenzeit der Trennung | 8-Minuten-Track: 13 s auf der RTX 4070, 72 s auf der CPU (Demucs über Python, mit Laden und Schreiben). | Unkritisch, falls ein Modell freigegeben wird. |
| Bessere Schlag- und Takterkennung | „Beat This!“ (Universität Linz, 2024): Code **und Gewichte** ausdrücklich MIT, in ONNX und C++ bereits erprobt, kleines Modell 8 MB. Erkennt Schläge und Takt-Einsen auch bei Tempowechseln. Die Taktart ergibt sich aus den Schlägen je Takt. Restrisiko: Trainiert wurde auch auf urheberrechtlich geschützter Musik. | Kandidat Nummer eins für Tempo, Raster, Takt 1, Taktart und Tempowechsel. |
| Bessere Akkorderkennung | Kein Modell mit geklärter Lizenz der Gewichte (BTC, CREMA und Verwandte: MIT-Repos ohne Aussage zu den Gewichten, trainiert auf geschützten Aufnahmen). Veröffentlichte Trefferquoten 77 bis 80 % Dur/Moll, 65 bis 69 % mit Septakkorden; keines kennt add9, 9, 11 oder Powerchords. | Akkorde bleiben eigenes Verfahren, ausgebaut um Stimmung, mehr Vorlagen, Tonart-Kontext und Abstimmung über Wiederholungen. |
| Tonart mit Modus | Kein freies Modell kennt Dorisch; die freien kennen nur Dur und Moll. | Bleibt eigenes Verfahren (trifft heute 4 von 4). |
| Tempo ändern ohne Tonhöhe | signalsmith-stretch: MIT, eine Header-Datei, am besten zwischen 75 und 150 %. Rubber Band wäre GPL oder 590 £. | signalsmith-stretch. |
| Video | Die WebView spielt MP4 (H.264/AAC) und WebM sicher; HEVC nur mit Zusatzpaket, MKV ungeprüft. Den Ton holt Media Foundation aus der Datei. Große Dateien müssen mit Teilabrufen ausgeliefert werden; ob die JUCE-Schnittstelle das kann, ist ungeprüft. | Zuerst MP4 und WebM; Rückfall auf einen kleinen lokalen Server. |
| Signierung und Installer | Abschnitt 4 des Abschlussberichts. | Erst vor der ersten Weitergabe. |

Nicht geprüft: Spleeter als Quelle für die Analyse, Trennung auf dichten Mischungen mit Gesang, alles unter Linux.

## 3. Phasen

Reihenfolge nach dem Wunsch des Nutzers; Aufwand in Arbeitstagen der KI (aus dem Abschlussbericht).

| Phase | Inhalt | Tage | Wie geprüft |
|---|---|---|---|
| A Analyse | Schläge und Takt über Beat This!, Taktarten, Tempowechsel, Stimmung, Akkordarten des App-Registers, Tonart-Kontext, Muster und Sektionen | 3 bis 4 | Trefferquoten gegen Labels (generiert und echt), automatisch |
| B Backingtrack-Seite | Griffbrett, Akkordrad, Jetzt/Nächster, Muster, Spuren mit Akkordzeile, Zoom, Schleifen, Tempo, Mixer, Video, Zwischenspeicher | 5 bis 7 | Prüflauf in der echten App, Bildschirmfotos, Urteil des Nutzers |
| C Generator | Akkorde, Pad, Lead, Percussion mit allen Regeln, Prüfung des Tracks, Würfeln der Form | 3 | bitgleich gegen `port-base` |
| D Klang | alle Sample-Stimmen, dann Synths, FM-E-Piano, Orgel, Saitenmodell, Effekte, Summe | 13 bis 16 | Render gegen das Web je Stimme, A/B für den Nutzer |
| E Oberfläche | alle Regler an die Engine, Zustand an Parameter gebunden, eigenes Fenster, Audio-Einstellungen, Dateien eingebettet | 4 bis 6 | Prüflauf, Urteil des Nutzers |
| F Trennung | nur wenn Nutzen belegt und Lizenz geklärt | 3 bis 4 | Trefferquoten, Hörprobe |
| G Auslieferung | Installer, Signierung, Updates, Nachladen von Packs | 2 bis 3 | Installation auf einem frischen Windows |

## 4. Arbeitspaket für 8 Stunden ohne Rückfrage (Entwurf zur Abstimmung)

**Ziel:** Die Backingtrack-Seite so, wie in Abschnitt 1 beschrieben, auf einer deutlich besseren Analyse. Das ist Phase A und der Kern von Phase B.

**Warum dieses Paket:** Es ist dein aktueller Wunsch, und fast alles daran kann ich allein prüfen: die Analyse an Trefferquoten, die Seite an Prüfläufen in der echten App. Nur das Aussehen brauchst am Ende du.

| Block | Zeit | Inhalt | Fertig, wenn |
|---|---|---|---|
| 0 Vorbereitung | 0:20 | Prüfläufe laufen stumm. Größerer generierter Testsatz: alle fünf Taktarten, Septakkorde, erweiterte Akkorde und Powerchords, Tempi von 60 bis 180, Tempowechsel. Ausgangswerte festhalten. | Tabelle der Ausgangswerte steht |
| 1 Schläge und Takt | 1:15 | Beat This! (kleines Modell) über ONNX Runtime im Kern. Daraus Tempo, Schläge, Takt-Einsen, Taktart, Tempowechsel. Bleibt nur, wenn es besser misst als das eigene Verfahren. | Tempo und Takt 1 auf beiden Sätzen besser als heute, oder begründet verworfen |
| 2 Akkorde | 2:10 | Stimmung schätzen. Bessere Tonhöhenauflösung (NNLS-Chroma nachgebaut), Schlagzeuganteil vorher herausrechnen. Die 17 Akkordarten des App-Registers statt nur Dur und Moll. Tonart als Kontext. Jede Stufe einzeln gemessen. Wertung zusätzlich „genaue Akkordart“. | Grundton und Dur/Moll besser als heute, genaue Akkordart gemessen; ein Teil der Tracks bleibt bis zum Schluss unangetastet und liefert die ehrliche Zahl |
| 3 Muster | 0:45 | Wiederholte Akkordfolgen finden, Sektionen benennen (A, B …), über Wiederholungen abstimmen. | Die Sektionen der vier echten Tracks stimmen mit den Tabellen der Videos überein, oder die Abweichung ist benannt |
| 4 Seite: Aufbau | 1:30 | Links „Jetzt“, „Als Nächstes“ und das Muster der laufenden Sektion. Griffbrett mit Tonleiter und Akkordrad aus der bestehenden Oberfläche. | Prüflauf: alle Teile zeigen zur Abspielstelle das Richtige |
| 5 Seite: Spuren | 1:30 | Wellenform mit Akkordzeile darüber. Mausrad scrollt die Spur, Zoom über Tasten und Strg+Mausrad, Klick springt, Ziehen im Lineal setzt die Schleife. Zwischenspeicher je Datei. | Prüflauf: Zoom, Scrollen, Sprung, Schleife gemessen; Scrollen ändert die Position nie |
| 6 Tempo | 0:20 | Tempo 50 bis 125 % mit signalsmith-stretch. | Tempo gemessen, Anzeige bleibt synchron |
| 7 Abschluss | 0:30 | Prüfläufe, Bildschirmfotos, Protokoll, Commits, Bericht. | Bericht mit Zahlen und Bildern |

**Streichreihenfolge, wenn die Zeit knapp wird:** Tempo-Regler, dann Block 3. Video und Stems sind bewusst nicht im Paket.

**Regeln für die acht Stunden:**

- Ein Block, ein lokaler Commit. Kein Push.
- Jede Änderung an der Analyse wird an beiden Testsätzen gemessen und bleibt nur, wenn sie nicht verschlechtert. Zahlen ins Protokoll.
- Scheitert etwas zweimal am selben Problem: aufschreiben, nächster Block.
- Entscheidungen, die ich allein treffe, stehen mit Begründung im Protokoll.
- Neue Abhängigkeiten nur die drei unten genannten.
- `src/`, `scripts/` und `tests/` bleiben unberührt.
- Am Ende: Bericht mit höchstens 15 Zeilen, Bildschirmfotos, Liste dessen, was nur du beurteilen kannst.

**Was ich nicht kann:** hören und über das Aussehen urteilen. Ob Schleifen sauber klingen, ob der Tempo-Regler gut klingt und ob die Seite stimmig aussieht, beurteilst du danach.

**Alternative für die acht Stunden:** Phase C und der erste Teil von D (Generator vollständig, alle Sample-Stimmen spielen). Das ist vollständig prüfbar und zeigt die ganze Band in der nativen App, bringt die Backingtrack-Seite aber nicht voran.

## 5. Was vor dem Start zu klären ist

1. **Welches Paket:** das beschriebene (Analyse und Backingtrack-Seite) oder die Alternative (Generator)?
2. **Drei neue Abhängigkeiten:** ONNX Runtime (MIT), Beat This! (Code und Gewichte MIT, mit dem genannten Restrisiko beim Trainingsmaterial), signalsmith-stretch (MIT). Einverstanden?
3. **Stems:** entschieden am 2026-11-17: entfallen vorerst.
4. **Mehr Testtracks:** mindestens 8, besser 12 bis 16 weitere, die die Lücken der vier vorhandenen füllen (alle vier: Moll oder Dorisch, 76 bis 102 bpm, 4/4, ein Kanal): Dur, schnell (über 140), langsam (unter 70), andere Taktart (6/8, 12/8-Shuffle, 3/4), Septakkorde (Blues, Funk), Jazz-Akkorde (maj7, m7), Powerchords mit Verzerrung, und mindestens vier von einem anderen Kanal. Ein Drittel bleibt beim Optimieren unangetastet. Labels: aus dem Video, wenn es die Akkorde zeigt, sonst eine Akkordtabelle je Sektion von Hand.
5. **Push vor dem Start:** Die CI hat die letzten Commits noch nie gebaut. Ein Push vorher zeigt Fehler unter Linux, bevor acht Stunden darauf aufbauen.
