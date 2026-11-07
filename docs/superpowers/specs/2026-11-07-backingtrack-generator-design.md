# Backingtrack-Generator: Design

Stand 2026-11-07. Ergänzt `handoff-backing-track-generator.md` im Projektordner um das, was im Gespräch entschieden wurde. Wo beide Dokumente sich widersprechen, gilt dieses. Korrekturen sind später jederzeit möglich (Auftraggeber).

Kennzeichnung: **[E]** = Entscheidung des Auftraggebers, **[A]** = Annahme / Entscheidung von Claude, nicht bestätigt.

## 1. Absicht

Ein Browser-Generator für Begleittracks zum Üben mit E-Gitarre, auch allein nutzbar, später von Interactive Scales (Gitarrentheorie-Lern-App) eingebunden. Der Track soll Lust aufs Spielen machen: treibendes Schlagzeug und Synths tragen, die Gitarre erzählt "fast singend" darüber (Stimmung aktuell, Referenz: Maromaro, Trickster). **[E]** Es soll kein bestimmter Song nachgebaut werden, sondern der Track soll "verschiedenste Formen" annehmen können. **[E]**

## 2. Entschieden

- **Start einfach**: ein Satz zum Anklicken ("A-Moll-Pentatonik im Funk-Rock bei 100 bpm"), ein Klick auf Los startet. Jedes unterstrichene Wort öffnet eine bildliche Auswahl. **[E]** (Mischung aus Entwurf B und C, das Dropdown-Verhalten und die Auswahlen sind **[A]**)
- **Feintuning-Ansicht** neben dem Start: Akkordfolge, Verlauf je Schicht mit mitlaufendem Zeiger, Tempo, Länge, Aufbau. **[E]** Dazu ein **Akkordrad** (Quintenzirkel): zeigt passende Akkorde und Wechsel, und man kann **darauf klicken**, um die Folge zu bauen und zu ändern. **[E]** Weitere Visualisierungen ("und ähnliches") folgen später. **[E]**
- **Schlagworte formen den Track.** Sie sind in Kategorien aufgeteilt, in jeder Kategorie sind **mehrere** wählbar. **[E]** Erste Beispiele des Auftraggebers: tiefe Synths, treibendes Schlagzeug, funky Rhythmus. **[E]** Kategorien Schlagzeug, Bass, Synths, Rhythmus, Stimmung, Entwicklung sind **[A]**.
- **Stile** (Funk-Rock, Psych-Indie, Träumerisch) sind nur Schnellauswahl, die Schlagworte vorbelegt. **[E]**
- **Zufall**: Gleiche Schlagworte ergeben bei zwei Starts zwei verschiedene Tracks. **[E]** Der Track **baut sich auf und entwickelt sich** (Abschnitte, Schichten setzen nacheinander ein, Fills vor Wechseln), er ist kein flacher Loop. **[E]** Abschnittslänge 8-8-8 Takte ist **[A]**.
- **Variantennummer (Seed)**: Gleiche Eingabe und gleicher Seed ergeben denselben Track. Eine Übung in Interactive Scales kann den Seed festlegen (identisch wiederholbar) oder offen lassen (zufällig). **[E]**
- **Taktart**: erste Version nur 4/4, aber die Taktart ist von Anfang an im Datenformat und leicht erweiterbar. **[E]**
- **Akkorde**: erste Version `maj`, `min`, `dim`, die Liste ist leicht erweiterbar (7, sus, ...). **[E]** In A-Moll ist die Dominante daher zunächst E-Dur. **[A]**
- **Klang**: zuerst reine Synthese, Klangerzeuger hinter einer Schnittstelle gekapselt, damit einzelne Instrumente später durch Samples ersetzt werden können. **[E]** Freie Sample-Quellen wurden gesichtet (VCSL CC0, Virtuosity/Calderwood Drums CC0, Karoryfer Ergo CC0), aber keine passende für Drum-Machine/Synth-Klänge gefunden.
- **Einbindung**: Interactive Scales setzt Werte (Tonart, Akkorde, Tempo, Schlagworte, Schichten, Seed) und bekommt Startzeitpunkt sowie Takt- und Akkordzeiten für die Auswertung. **[E]** Schnittstelle wie im Übergabedokument Abschnitt 5, ergänzt um Schlagworte (`tags`).
- **Mehrsprachigkeit**: Die Oberfläche ist von Anfang an mehrsprachig, im ersten Schritt Deutsch und Englisch. **[E]** Weitere Sprachen kommen später über eine neue Sprachdatei. Umsetzung **[A]**: Kern und Audio enthalten keine Texte (Fehler als Codes, Schlagworte als Ids), alle Beschriftungen stehen in `src/i18n/de.js` und `en.js`, Sprachwahl per Umschalter, gemerkt im Browser, beim ersten Besuch nach `navigator.language`. Akkordsymbole bleiben international (`B`, nicht `H`).
- Tests vor Code, jeder Schritt mit Regressionsschutz; Pegel und Übersteuerung sind Teil der Tests; Hörprobe entscheidet der Auftraggeber. **[E]** (Übergabedokument)
- Oberfläche hell, Notenheft-Stil, Serifenschrift, ein farbiges Objekt je Bildschirm. **[E]** (Übergabedokument) Die Optik ist vorläufig und wird später verfeinert. Die Demo-Oberfläche ist nicht die Basis, nur ihr Klangcode. **[E]**

## 3. Meine Entscheidungen (A)

- Reines JavaScript (ES-Module), kein Framework. Tests mit `node:test`, Browser-Tests mit Playwright. Windows, Chrome, lokal, offline.
- Arbeitsname "Backingtrack-Generator", eigenes Projekt in diesem Ordner, Lizenz offen.
- Visualisierung mit Canvas. Hall mit einfachem Algorithmus.
- Ereignisstrom wird vorab berechnet (ohne Audio), Audio und Visualisierung lesen nur diesen Strom.

## 4. Ziele / Nicht-Ziele / Anti-Ziele

**Ziele:** siehe Abschnitte 1 und 2. Schichten Schlagzeug, Bass, Akkorde, Pad einzeln stummschaltbar. Humanisierung. Pegel stimmen, die Gitarre setzt sich durch.

**Nicht-Ziele (erste Version):** Analyse fremder Songs, Audio-Export, Konten und Hosting, Mobile, ungerade Taktarten in der Oberfläche, Akkorde über maj/min/dim.

**Anti-Ziele:** klingt "billig synthetisch", unausgewogene Mischung, Visualisierung lenkt vom Spielen ab, Generator ist an die Lern-App gebunden, gleiche Eingabe klingt jedes Mal gleich (außer der Seed ist festgelegt).

## 5. Offen (später klären)

Lizenz und endgültiger Name. Genaue Schlagwortliste und wie jedes Schlagwort musikalisch wirkt (wird beim Bauen mit Hörproben festgelegt). Welche weiteren Visualisierungen. Intro und Ausklang. Einbindung als Paket oder nur über die Schnittstelle. Weitere Akkordarten.

## 6. Reihenfolge

1. Test-Gerüst, Datenformat mit Taktart, Akkordarten und Schlagworten, Seed-Zufall.
2. Ereignisstrom aus Eingabe (Akkorde, Abschnitte, Schichten, Fills) mit Tests.
3. Schlagworte werden zu musikalischen Parametern, Variation je Seed.
4. Synthese-Klangerzeuger hinter Schnittstelle, Pegeltests per Offline-Render, Hörprobe.
5. Oberfläche: Startsatz, Auswahlen, Feintuning, Akkordrad, Verlauf.
6. Schnittstelle für Interactive Scales (`play`, Ereignisstrom, `startPerf`).
