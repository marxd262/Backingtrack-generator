# Übergabe Oberfläche (Branch `feat/ui-finish`), Stand 2026-11-15

Dieses Dokument sagt, was in der UI-Session gebaut wurde, was der Nutzer dazu entschieden hat, was am Klang anders ist und was offen bleibt. Die Einzelheiten der Schnittstelle stehen in `docs/interface.md`, die Messwerte zusätzlich im Änderungslog von `SOUND_CONTEXT.md`.

## 1. Stand

- Branch `feat/ui-finish`, abgezweigt von `develop`, 23 Commits. **Nicht gemergt, nicht gepusht.**
- `npm test`: 730 bestanden. `npx playwright test`: 676 bestanden.
- Die Squash-Nachricht für den Merge liegt in `.superpowers/squash-message.txt` (nicht eingecheckt).
- `UI_TODO.md` ist gelöscht. `feat/rack-ui` und sein Stash sind gelöscht (alles daraus war schon in `develop`).

## 2. Was gebaut ist

| Schritt | Inhalt | Commit |
|---|---|---|
| 0a | Screenshot-Skript `scripts/ui-screens.mjs` (alle Ansichten, 1440 / 1024 / 390 / 2560 px, Messwerte in `metrics.json`) | `58fb37b` |
| 1 | Rack bricht in Reihen um, scrollt nur senkrecht; Module decken die Schienen ab und sind verschraubt, auch die der Visualisierung | `f8ddd2c`, `0a05292` |
| 2 | Griffbrett: Noten bis 17 px Radius, halbfette Namen; im Fokus Höchstmaße, Griffbrett höchstens 1440 px breit | `d7af390`, `a96a265`, `72d32b1` |
| 3 | Mixer mit Pan-Knopf und LED-Pegelanzeige je Kanal; neues Modul Gesamtklang | `3d55d27` |
| 4 | Lichter: LED gedämpft (spielt im Takt), pink (Ton klingt), grün (Anschlag); Schlag-LED; türkise Spuren mit pinker Abspielmarke | `4fac911`, `8c99408`, `46364ae` |
| 5 | Startseite im Rack: Satz mit Displays, „Überrasch mich“, „Weitermachen“ (gemerkte Sitzung) | `33b1e3a` |
| 5b | Eine Reihenhöhe für das ganze Rack (21 rem), leere Reihen im selben Raster; festes Knopfraster je Instrument; Anzeige über jedem Knopf | `448887d`, `74498d2` |
| 6 | Knopf „Verzierungen“ im Rhythmus-Modul; bei 100 % Faktor 4 statt 2 | `1f2b6cc`, `4b49ac3` |
| 7 | Songteil Bridge, wählbar und im Würfeln (Pop, Rock) | `ec3c4a0` |
| 8 | Stile schlagen Stimmen für Bass, Akkorde und Schlagzeug vor | `a2bcf81` |
| 9 | Orgel: Leslie-Wähler und Zerre-Knopf im Akkord-Modul | `0e1ae38` |
| 10 | Feinschliff: sechs Schriftgrößen, Farbvariablen, Kopfleiste im Stand, Akkordkreis füllt sein Modul | `c6c4790` |
| 11 | Schlagwort-Fenster: Kennbuchstaben (Spiel, Klang, Form), Wirkungs-Anzeige, blasse Wörter ohne Wirkung | `351c30d` |
| Abschluss | `docs/interface.md`, Änderungslog, dieses Dokument | `930edf8` und folgender |

## 3. Entscheidungen des Nutzers

Diese gelten weiter und sind der Maßstab für spätere Arbeit an der Oberfläche.

- **Scrollen:** Senkrechtes Scrollen ist in Ordnung, waagerechtes nicht. Die Visualisierung wird dafür nicht verkleinert.
- **Rack-Bild:** Module decken die Schienen ab und sind verschraubt. Schienen sieht man nur, wo kein Modul sitzt. Auch Tonart, Griffbrett, Akkorde und Form & Spuren gehören ins Rack.
- **Reihenhöhe:** Wie im Eurorack ist die Höhe vorgegeben. Unterschiedlich hohe Reihen irritieren, auch leere. Auf der Startseite und im Fokus stehen die Reihen senkrecht mittig.
- **Große Monitore:** Lieber leerer Rackplatz als gestreckte Module. Gemeint war der senkrechte Abstand der Noten. Schwarze Flächen links und rechts „sehen billig aus“; ein begrenztes Griffbrett mit Rackplatz daneben ist annehmbar.
- **Instrument-Module:** Die Knöpfe brauchen eine feste, einheitliche Struktur. „Zurücksetzen“ sitzt überall unten rechts.
- **Lichter:** Ein klingendes Instrument muss deutlich leuchten, nicht nur der Anschlag. Der Anschlag hat eine eigene Farbe (Grün der Displays).
- **Verzierungen:** Bei 100 % soll mehr passieren; „der Nutzer soll Optionen haben“.
- **Bridge:** Gehört ins Würfeln. Urteil: „man kann den Unterschied gut hören“.
- **Stil-Stimmen:** Der Stilwechsel setzt die Stimmen, auch beim Start (damit ändert sich der Startklang). Startwert der Verzierungen bleibt für alle Stile 0,5.
- **Orgel:** Leslie-Auswahl bauen, Zerre mit Regler.
- **Schlagworte:** Es muss kenntlich sein, was wann wie wirkt.
- **Verschoben:** Klangbearbeitung je Spur, Makros und Wortwolke (Schritte 3a und 3b der Rack-Spec) sind eine eigene Session.

## 4. Klang

Regel der Session: Mit Standardeinstellungen darf sich der Klang nicht ändern. Geprüft je Schritt mit den Golden-Tests und einem Render-Vergleich gegen `develop` (drei Stile, Samples, Songform).

| Änderung | Wirkung | Beleg |
|---|---|---|
| Stil-Stimmen | **Der Start klingt anders:** Funk spielt die Akkorde auf der Funk-Gitarre statt der Clean-Gitarre (vom Nutzer so gewählt) | Mischpegel je Stil gegen die alten Standardstimmen: sechs Stile innerhalb 1 dB, Rock −0,7, Hardrock −1,2, Pop-Punk −2,4 dB |
| Verzierungen bei 100 % | Faktor 4 statt 2; bis 50 % unverändert | Funk, 16 Takte, bei 50 / 75 / 100 %: Dead Notes 30 / 74 / 74, Slides 3 / 8 / 13, Flams 3 / 6 / 10 |
| Bridge | Neue Formen bei Pop und Rock ab 48 Takten | 18 900 Formen verglichen: keine Form ohne Bridge hat sich geändert, 12 bis 14 % haben eine bekommen |
| Pan, Pegelmessung, Feinwerte | Nur Anbindung, Standard unverändert | Render-Vergleich gleich |

Der Offline-Render ist nicht bitgenau wiederholbar: Zwei Läufe desselben Stands weichen bis etwa −87 dB voneinander ab. „Gleich“ heißt darum: gleiche Ereigniszahl und Abweichung in dieser Streuung.

Ungehört sind: die Tabelle der Stil-Stimmen, die Werte der Bridge (−2 dB, Dichte −0,05) und die Skala der Pegelanzeige.

## 5. Wo was liegt

- `src/ui/app.css`: Reihenhöhe `--u`, Rack-Muster, Schrauben, Schriftstufen, Farbvariablen.
- `src/ui/knob-slots.js`: feste Plätze im Knopfraster. `src/ui/timbre-panel.js` baut die Module.
- `src/ui/mixer.js`, `mix-state.js`: Pan und Pegelanzeige. `src/ui/organ-panel.js`, `organ-tuning.js`: Orgel-Knöpfe.
- `src/ui/tags-ui.js`, `tag-effects.js`: Schlagwort-Fenster. `src/ui/session-store.js`: „Zuletzt gespielt“.
- `src/core/form-types.js`, `form-roll.js` (`insertBridge`): Bridge. `src/core/tags.js`: Stil-Stimmen. `src/core/articulation.js` (`ornamentFactor`).
- `src/audio/play.js`, `synth.js`: `pans`, `setPan`, `level`, `tuning`, `setTuning`.
- Profil-Felder: `rhythm.ornaments`, `mixer.pan`, `sound.organ` (`src/core/profile-parts.js`).

## 6. Offen

- **Klangbearbeitung je Spur, Makros, Wortwolke** (3a, 3b). Mit Sample-Stimmen bewirken die meisten Klang-Schlagworte weiter nichts; die Oberfläche zeigt das jetzt an, ändert es aber nicht.
- Profile-Knopf auf der Startseite. Die Taste „Einstellen“ ist geblieben, obwohl die Rack-Spec sie streichen wollte (ohne sie käme man nur über „Los“ ans Rack).
- Die Datei-Taste im Profil-Fenster spricht die Sprache des Browsers.
- Für Vorleser: allgemeine Namen der ‹ ›-Tasten, „stumm“ am Spurnamen nur sichtbar.
- Bei 1024 px scrollen Griffbrett und die Formfelder weiter in sich; 390 px ist nur funktional.
- Die Leslie-Stellung steht ohne Maus nur an Zeiger und Bogen.

## 7. Stolpersteine

- **Fehlercode der Tests prüfen.** Eine Befehlskette mit `| tail` verschluckt ihn; einmal ging so ein Commit trotz Fehlschlag durch. Ausgabe in eine Datei schreiben und `$?` ausgeben.
- **Zwei Browser-Testläufe direkt hintereinander** scheitern mit „connection refused“, weil der Server des ersten gerade herunterfährt. Einfach wiederholen.
- **Die Songform wird beim Laden gewürfelt.** Tests, die auf das Schlagzeug warten, stellen die Vorlage auf „Ohne Form“, sonst schweigt es im Intro zu lange.
- **44 px Klickfläche** ist eine getestete Regel (LCD-Auswahlen, Tasten). Nicht verkleinern.
- **Pseudo-Elemente, die über ein Modul hinausragen**, vergrößern dessen `scrollWidth`; mehrere Tests messen damit, ob der Inhalt überläuft. Darum ist der Rack-Grund ein Hintergrundmuster.
- **CSS-Text aus `content`** landet im zugänglichen Namen. Mit `content: … / ""` bleibt er draußen (Kennbuchstaben der Schlagworte).
- **`hidden` auf Elementen mit `display: flex`** braucht eine eigene Regel (`.knob-cell[hidden]`).
- **Ein Klick neben ein Popover schließt es**, auch der auf die Sprachtaste.
- Git Bash: lange Heredocs scheitern. Hilfsskripte als Datei schreiben und mit `node` starten.

## 8. Werkzeuge

- `node scripts/ui-screens.mjs <name> [breite]`: Screenshots und Messwerte nach `.superpowers/ui-screens/<name>/`.
- Nicht eingecheckt, liegen in `.superpowers/`: `render-check.mjs` (Klangvergleich gegen einen Arbeitsbaum von `develop`), `form-diff.mjs` (Vergleich des Würfelns), `style-voices-level.mjs` (Pegel je Stil), dazu kleine Skripte für Standbilder einzelner Zustände.
