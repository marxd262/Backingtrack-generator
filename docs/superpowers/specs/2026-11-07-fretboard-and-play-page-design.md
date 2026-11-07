# Griffbrett und neue Spielseite: Design

Stand 2026-11-07. Ergänzt `2026-11-07-backingtrack-generator-design.md` und das, was seither gebaut wurde (Startsatz, Feintuning-Ansicht, Akkordrad, Verlauf, Schlagworte, Sprachumschalter). Wo dieses Dokument dem Oberflächenteil des ersten Designs widerspricht, gilt dieses.

Kennzeichnung: **[E]** = Entscheidung des Auftraggebers, **[A]** = Annahme oder Entscheidung von Claude, nicht bestätigt.

## 1. Absicht und Warum

Der Auftraggeber übt abends mit der E-Gitarre zum erzeugten Track. Ihm fehlt ein **Griffbrett**, das zeigt, welche Töne der Leiter wo liegen, welche zum jetzt klingenden Akkord besonders gut passen und welche zum folgenden Akkord passen könnten. **[E]** Beim Nachdenken darüber wurde klar, dass die bisherige Aufteilung (eine Hauptseite zur groben Einrichtung, eine zweite Feintuning-Seite) für Visualisierungen zu eng ist. **[E]** Die Seite soll so umgebaut werden, dass oben groß die Visualisierungen stehen und die Konfiguration in ein- und ausklappbaren Seitenleisten wohnt. **[E]**

Erfolg heißt: Beim Spielen sieht man auf einen Blick, was als Nächstes passt. Die Einstellungen sind schnell erreichbar und verschwinden danach wieder. Weitere Visualisierungen lassen sich später ohne Umbau hinzufügen. **[E]**

## 2. Ziele

**Neue Seitenstruktur [E]**
- **Startseite** ("der erste Start"): schlank, im Wesentlichen der bisherige Startsatz mit Los. Von hier führen **Los** und **Feintuning** zur Spielseite.
- **Spielseite:** Oben groß die Visualisierungen untereinander (Griffbrett, Verlauf, Akkordrad), Aufteilung "A" aus den Skizzen. Die Konfiguration steckt in **zwei Seitenleisten**, links "Klang", rechts "Akkorde", jede einzeln ein- und ausklappbar. **[E]**
- Weitere Visualisierungen sollen später als zusätzliche Blöcke möglich sein. **[E]**

**Griffbrett [E, sofern nicht anders markiert]**
- Zeigt **alle Töne der gewählten Leiter** (A-Moll-Pentatonik, Dur-Pentatonik, Blues, Dorisch, also die Leitern der Oberfläche).
- **Töne des jetzigen Akkords** sind hervorgehoben, als "besonders passende" Töne.
- **Töne des folgenden Akkords** tragen eine **Sekundärfarbe**. Das hebt die Regel "ein farbiges Objekt je Bildschirm" für das Griffbrett ausdrücklich auf.
- Auf den Punkten stehen standardmäßig **Notennamen**; ein **Schalter** wechselt auf **Stufen**, gezählt **vom Grundton der Tonart** (A-Moll: A = 1, C = b3, D = 4, E = 5, G = b7).

## 3. Entscheidungen von Claude (A), zur Prüfung

**Griffbrett**
- Gemeinsame Töne beider Akkorde: Hauptfarbe gefüllt mit Ring in der Sekundärfarbe. Grundton des jetzigen Akkords: Extraring. Akkordtöne außerhalb der Leiter: sichtbar, gestrichelt umrandet und blass gefüllt (die Pentatonik hat kein F, Dm braucht es). Rot und Blau unterscheiden sich zusätzlich durch Form (Ring, Füllung, Strichelung), nicht nur durch Farbe.
- **Folgender Akkord** = der nächste Akkord, der sich vom jetzigen **unterscheidet**, und zwar in der **tatsächlich hörbaren Reihenfolge** des Tracks: Die Takte laufen über `length` und springen dann zu Takt 0 zurück, auch wenn `length` kein Vielfaches der Akkordfolge ist. Die Berechnung bekommt also die Taktliste, `length` und den aktuellen Takt (`nextDistinctChord(bars, length, barIndex)`) und sucht höchstens `length` Takte voraus. Gibt es keinen abweichenden Akkord, gibt es keinen "folgenden" und das Griffbrett zeigt nur den jetzigen.
- Der **Namen/Stufen-Schalter** sitzt in der Kopfzeile des Griffbrett-Blocks (nicht in einer Seitenleiste), weil man ihn beim Hinsehen umschaltet.
- Bünde 0 bis 15, Standardstimmung EADGBE, hohe e-Saite oben, Linkshänder- und andere Stimmungen sind in dieser Version nicht vorgesehen. Bundabstände wie auf einer echten Gitarre (nach 12tel-Teilung).
- Umsetzung als **SVG** (die Beschriftungen sind echter Text, Farben über CSS-Variablen). Das weicht von der früheren Annahme "Visualisierung mit Canvas" ab, weil das Griffbrett nicht angeklickt wird und Text braucht. Verlauf und Akkordrad bleiben Canvas.
- Der Akkord-Bezug der Stufen (Stufen relativ zum jetzigen Akkord) ist **nicht** vorgesehen. **[E]**: "Tonart als Bezug reicht".
- Zustand folgt dem laufenden Takt (`onBar`); im Stand zeigt das Griffbrett den ersten Akkord und den folgenden. Es ändert sich auch, wenn die Akkordfolge, die Tonart oder die Leiter geändert wird.
- Die Wahl Namen/Stufen wird im Browser gemerkt (`localStorage` in `try/catch`).
- Barrierefreiheit: SVG mit `role="img"` und Beschriftung plus eine sichtbare oder versteckte **Textfassung**, die nur bei Änderung neu geschrieben wird ("Jetzt: Am (A, C, E). Als Nächstes: Dm (D, F, A)"). Deutsch und Englisch.
- Die Berechnung der Rollen (Leiterton, Akkordton, Grundton, Folgeakkord, Stufe, Notenname) liegt als **reine Logik in `src/core`** mit Node-Tests, ohne Browser-Objekte beim Import. Notennamen folgen der Schreibweise der Tonart (Kreuze oder Bs wie bei den Akkorden).

**Seitenstruktur**
- **Los** startet die Wiedergabe und öffnet die Spielseite. Es verwendet den **gemerkten** Zustand der Seitenleisten; beim allerersten Besuch (nichts gemerkt) sind beide **geschlossen**, damit die Visualisierung im Fokus steht. **Feintuning** öffnet die Spielseite **immer mit beiden offenen** Leisten, ohne zu starten, und merkt sich diesen Zustand. Danach gilt: Was man zuletzt eingestellt hat, bleibt (auch nach Neuladen).
- Die **Wiedergabe läuft weiter**, wenn man zur Startseite zurückgeht. Auf der Startseite zeigt die Los-Taste während der Wiedergabe "Stopp" (wie bisher), der jetzige Akkord und die Taktanzeige bleiben dort sichtbar, und ein zusätzlicher Knopf **"Zur Spielseite"** führt zurück. Los auf der Startseite im Stand startet und navigiert zur Spielseite. Das hält das bestehende Verhalten (ein Player, ein AudioContext) einfach.
- **Kopfzeile der Spielseite:** Zurück zur Startseite, jetziger Akkord (groß), folgender Akkord, "Takt n von N", Los/Stopp, Sprachumschalter, Variantennummer. Der jetzige Akkord ist weiter das Hauptfarbenobjekt.
- **Linke Leiste "Klang":** Stilauswahl (Schnellwahl), Schlagworte nach Kategorien, Tempo, Länge. Die Stummschalter je Schicht bleiben neben dem Verlauf (dort, wo sie schon sind).
- **Rechte Leiste "Akkorde":** Tonart und Leiter, Akkordfolge bearbeiten, die Tastatur-Entsprechung des Akkordrads (Knöpfe je erlaubtem Akkord) und der Abschnitt **Ansichten**, in dem Griffbrett und Akkordrad ein- und ausgeschaltet werden (und jede später hinzukommende Ansicht).
- Die **Ansichten-Schalter gibt es nur an dieser einen Stelle** (ein gemeinsamer, gemerkter Zustand, keine zweite Bedienstelle am Block). Der **Verlauf-Block lässt sich nicht ausblenden**, weil er die Stummschalter je Schicht enthält; er ist die einzige Stelle zum Stummschalten.
- Das **Akkordrad bleibt klickbar**, steht aber als Visualisierungsblock in der Mitte und ändert die Akkordfolge wie bisher.
- **Mitte der Spielseite:** Die Blöcke stehen untereinander über die volle Breite der Mitte, in der Reihenfolge Griffbrett (dominant, es bekommt die meiste Höhe), Verlauf, Akkordrad (zentriert, in seiner bisherigen Größe). Das ist die Aufteilung "A" der Skizzen mit dem Unterschied, dass die Akkordfolge jetzt in der rechten Leiste und nicht neben dem Rad bearbeitet wird. Jeder Block hat eine Überschrift. Ein neuer Block kommt ohne Umbau der Seite hinzu. Welche Blöcke sichtbar sind und ob eine Leiste offen ist, wird im Browser gemerkt.
- Breite Fenster: Leisten stehen **neben** der Mitte. Schmale Fenster: Leisten legen sich als **Schublade über** die Mitte. Tastaturbedienung mit `aria-expanded`, Escape schließt eine überlagernde Leiste, der Fokus kehrt zum Auslöser zurück.
- Der Startsatz mit seinen Popovers bleibt **nur auf der Startseite**; auf der Spielseite werden Tonart, Leiter, Stil und Tempo in den Leisten geändert.

## 4. Nicht-Ziele

- Andere Stimmungen, Siebensaiter, Linkshänder, mehr als 15 Bünde, Capo.
- Töne auf dem Griffbrett anklicken oder anspielen, Akkordgriffbilder, Pentatonik-Boxen oder CAGED-Muster, Fingersätze.
- Weitere Visualisierungstypen über Griffbrett, Verlauf und Akkordrad hinaus (nur die Blockstruktur dafür).
- Deep Links oder Browser-Zurück zwischen Start- und Spielseite, URL-Speicherung des Zustands.
- Ein neues Gesamtdesign: die Optik bleibt vorläufig und wird später verfeinert.
- Änderungen am Generator (Ereignisstrom, Arrangement, Klang). Die Golden-Hashes bleiben unverändert.

## 5. Anti-Ziele

- Das Griffbrett ist zu voll oder schlecht lesbar (zu viele Markierungen, Namen überdecken sich).
- Bedeutung nur durch Farbe (Rot-Grün-Schwäche, Schwarzweiß-Ausdruck).
- Das Layout springt, wenn der Akkord wechselt.
- Eine offene Leiste verdeckt auf dem Desktop das Griffbrett.
- Bestehende Zugänglichkeit und Tests gehen verloren: Fokusführung, Live-Region, Schreiben in den DOM nur bei Änderung, Deutsch/Englisch ohne sichtbare Schlüsselnamen, 360 px ohne horizontales Scrollen, keine externen Anfragen.

## 6. Randbedingungen

- Reines JavaScript, keine Laufzeit-Abhängigkeiten, lokal und offline, Chrome auf Windows. Tests vor Code. Neue Kernlogik mit Node-Tests, die Oberfläche mit Playwright.
- Alle sichtbaren Texte über `t` in `de.js` und `en.js`, Paritätstests müssen weiter grün sein.
- Kein `Math.random`, kein `innerHTML` mit dynamischem Text.
- Bestehende Tests (152 Node, 58 Browser) bleiben als Regressionsschutz; wo sich das Layout ändert, werden sie angepasst, nicht abgeschwächt.
- Hörprobe und Sichtprobe entscheiden der Auftraggeber.

## 7. Offen für den Bauenden

Breakpoints, Animationen der Seitenleisten, die genaue Form der Blockstruktur der Visualisierungen, Namen der neuen i18n-Schlüssel, Skalierung des Griffbretts (Breite, Schriftgröße der Punkte), ob eine überlagernde Leiste modal ist, wie der Merkzustand abgelegt wird (Schlüsselnamen in `localStorage`), die Aufteilung der Dateien in `src/ui`.
