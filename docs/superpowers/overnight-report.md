# Nachtbericht 2026-11-08 auf 2026-11-09

Alles wurde ohne Rückfrage gebaut. Danach hat der Nutzer die drei Branches `feat/live-sound-controls`, `feat/variant-drift` und `feat/more-styles` in `main` übernommen (lokal, ohne Push); der vierte Branch, ein Tempo-Trainer, wurde auf Wunsch verworfen und steht hier nicht mehr. **Nichts davon ist angehört**: Die Tests prüfen Verhalten, Gültigkeit und Grenzen, ob etwas gut klingt, entscheidet nur eine Hörprobe (Entwicklerseite `/ui/render-harness.html`, dort gibt es Knöpfe für alle Stile).

## Die drei übernommenen Branches (jeder baut auf dem davor auf)

| Branch | Inhalt | Teststand zum Abschluss |
| --- | --- | --- |
| `feat/live-sound-controls` | 26 Klangregler (alle Instrumente), live ohne Neustart; Schlagwort-Knöpfe und Schnellauswahl wirken live (`setTimbre`, `setTrack`); beide Seitenleisten in einklappbare, gemerkte Gruppen gegliedert | Node 259, Playwright 250, alles grün; Abschluss-Review durch einen frischen Reviewer, 1 Critical und 3 Important behoben |
| `feat/variant-drift` | Track-Schalter `variety`: Variante streut Swing/Synkopen/Bass-Bewegung, schaltet mehr Muster frei und verschiebt sieben Klangfelder leicht (Regler gewinnen); ohne Schalter bitgleich wie vorher | Node 266, Playwright 251, grün |
| `feat/more-styles` | Sechs Gitarren-Stile: Blues-Shuffle, Classic Rock, Hardrock, Reggae, Country, Pop-Punk (Texte de/en, Rhythmusbild, Hörseite) | Node 267, Playwright 253, grün |

Design-Notizen mit allen Annahmen: `docs/superpowers/specs/2026-11-09-variant-richness-design.md` und `…-guitar-styles-design.md`; Plan der ersten Stufe: `docs/superpowers/plans/2026-11-08-live-sound-controls-and-sidebar-groups.md`.

## Was ich für dich gewählt habe (bitte prüfen)

- **Varianten:** Welche Werte der Seed streut (Swing ±25 %, Synkopen und Bass-Bewegung ±0,12, sieben Klangfelder ±0,08) und welche zusätzlichen Muster dazukommen, ist meine Wahl. Du hattest die Frage, was sich zuerst ändern soll, nicht beantwortet. Variante 1 klingt in der Oberfläche jetzt anders als vorher.
- **Stile:** Auswahl, Tempi (88, 124, 148, 76, 112, 172) und Schlagwort-Belegung. Grenzen: nur Dur/Moll/vermindert und 4/4, also ist Blues eine Annäherung ohne Septakkorde und Reggae hat kein echtes Off-Beat-Skank-Muster.
- **Erste Stufe:** Regler werden nicht über das Neuladen hinaus gemerkt; die Schnellauswahl leert die Regler; die Instrument-Gruppen stehen flach statt in einer Obergruppe.

## Rulings (Abweichungen vom Plan, mit Begründung)

- Eigener Branch im selben Ordner statt Git-Worktree (node_modules und OneDrive-Pfad machen einen Worktree schwer).
- Task 2: Offline-Gleichheit mit Schwelle 1e-5 statt 1e-6 (gemessen 1,5e-6 = Float32-Rauschen) plus Gegenprobe; Extremtest "live gleich frisch" und < 0,95 statt < 0,9, weil "alles auf 1" auch mit frisch erzeugten Instrumenten 0,9003 erreicht (Eigenschaft des Extrems, nicht des Live-Umschaltens).
- Task 3: Bestehende Layout-Tests um den neuen Schlüssel `groups` erweitert (angepasst, nicht abgeschwächt).
- Task 4: `app.js` ruft `initGroups` einmal nach dem Bau des Klang-Panels auf, statt dass das Panel es selbst tut.
- Task 5 und 6: Drei bestehende Tests in `tuning.spec.js` schrieben den Neustart bei Schlagwort-Klicks fest; sie erwarten jetzt Live-Wirkung (erkannt über einen Zähler für Instrumentensätze, weil die leere Taktzeile den Neustart nicht verlässlich zeigte). `initTuning` bekommt `applyLive` statt `player`. Der Austausch an der Durchlaufgrenze spielt neben den alten auch neue Ereignisse nach dem letzten geplanten alten (so ist "ab dem nächsten ungeplanten Ereignis" gemeint).
- Review: Hauptbefunde (kaputter Pfeil in den Gruppenüberschriften durch ein Steuerzeichen, zu schmale Regler bei 1200 px, Fokusverlust beim Zurücksetzen, Stil auf der Startseite startete neu) behoben, jeweils zuerst mit rotem Test. Dabei wurde ein Test entfernt, der schon vor dem Fix bestand (leer), und ein Wächter gegen Steuerzeichen in `src` ergänzt.
- Abgelehnt/eingeordnet: Beim Tausch kann ein zeitlich verschobener Ton einmal zu viel oder zu wenig klingen (Teil der vereinbarten Semantik); `setTrack` prüft Schichten eigener Instrumente nicht (interner Haken); `<h4>` in `<summary>` kann die Überschriften-Navigation mancher Screenreader schwächen (so vom Plan vorgegeben).

## Zurückgestellte Kleinigkeiten (Minor, nicht behoben)

1. `timbre.spec` Live-Regler-Test könnte zusätzlich den Zähler für Instrumentensätze nutzen.
2. Extremtest-Schwelle < 0,95 ließe sich auf < 0,91 verschärfen, oder der Pegel von "alles auf 1" unter 0,9 drücken.
3. Gleiche Namen ("Schlagzeug-Klang" usw.) benennen zwei verschiedene Dinge in der linken Leiste (Schlagwort-Kategorie und Regler-Gruppe).
4. `#tuning-message` (aria-live) liegt in der einklappbaren Gruppe Akkordfolge; eine Meldung bei zugeklappter Gruppe wird nicht angesagt.
5. Doppelte Überlagerungsschleife in `completeTimbre` und `resolveTrackTimbre`.
6. `docs/interface.md` verweist auf `resolveTrackTimbre`, das `src/index.js` nicht exportiert.
7. `applyLive` könnte bei `setTrack === false` im laufenden Takt neu starten statt bei Takt 1.

## Was du morgen tun kannst

1. Die Stile und Varianten anhören (Hörseite, dann Oberfläche). Gefällt etwas nicht: der Branch lässt sich einzeln verwerfen oder die Werte in `src/core/tags.js` (Stile), `src/core/events.js` (Muster) und `src/core/timbre.js` (Klang-Drift) anpassen.
2. Die drei Branches liegen unverändert weiter vor; `main` enthält sie schon (Fast-Forward, nicht gepusht).
