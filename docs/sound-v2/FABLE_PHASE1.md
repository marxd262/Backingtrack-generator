# Auftrag: Klang Phase 1 – Mix, Engine, Groove

## Ziel
Du arbeitest als Audio-/DSP-Entwickler mit Produzenten-Ohr. Die Backingtracks des Backingtrack Generators sollen weniger nach MIDI und mehr nach einer kleinen Band klingen, die zusammen in einem Raum jammt. Ein Musiker hat den Klang als "zu mechanisch, wie MIDI" beschrieben.

## Zeitfenster
Diese Arbeit muss bis **Montag, 16.11.2026** abgeschlossen sein. Priorisiere so, dass nach jedem Schritt ein hörbar besserer, stabiler Stand committet ist. Lieber 3 fertige Schritte als 5 halbe.

## Kontext
- Lies zuerst **SOUND_CONTEXT.md** vollständig. Das ist deine Karte. Lies Code nur gezielt dort, wo du für eine konkrete Änderung Details brauchst. Keine breite Erkundung.
- **SAMPLE_SOURCES.md** beschreibt, welche Sample-Libraries später MuseScore_General ersetzen. Nur zur Orientierung, in dieser Session baust du keine neuen Samples ein.
- Arbeite auf dem Branch `feat/sound-v2`, abgezweigt vom Tag `pre-fable`.
- Genres/Tempi: Blues, Rock, Funk, Jazz; ca. 70–160 BPM
- Zielklang: kleine Band im Proberaum oder kleinen Club, live eingespielt, nicht überproduziert.
- Mein Hörtest: Die Samples klingen besser als die Synths, aber alles klingt **"zusammengedrückt"**. Die MuseScore-Gitarren sind kaum besser als der Synth.
- Langfristziel: MuseScore_General wird komplett durch bessere Samples ersetzt. Diese Session macht Mix und Engine besser und bereitet sie darauf vor.
- Die App ist öffentlich (GitHub Pages, max. 1 GB pro Seite). Kein festes Größenlimit, aber sparsam bleiben.
- Die Synth-Stimmen (`synth/classic`, FM-Epiano) änderst du nicht.
- Die App-UI (`src/ui/`, Rack, Mixer) änderst du nicht. Dort sind UI-Schritte offen, die später weitergehen. Neue Parameter kommen nur in `tunables.js` und den render-harness. Die Einbindung ins Rack folgt in einer späteren Session.

## Du kannst nicht hören
Ich bin deine Ohren. Behaupte nie, dass etwas besser klingt. Alle Werte in `tunables.js` und `form-post.js` sind laut Code "nach Wissen gesetzt, nicht gehört". Behandle sie als Startwerte, nicht als geprüft. Nutze Messungen dort, wo sie etwas belegen: Gain-Reduction des Begrenzers, Crest-Faktor, Spitzen-/RMS-Pegel, Stereobreite, Timing-Verteilung.

## Hypothesen aus der Vorab-Analyse (prüfen, nicht blind umsetzen)
Prüfe **4, 1 und 5 zuerst**. Sie passen zum Eindruck "zusammengedrückt".

1. **Kein Panning je Schicht:** alles mono in der Mitte, nur der Hall ist stereo. Klingt klein. Die Render-Skripte schreiben bisher nur den linken Kanal.
2. **Timing-Humanisierung ist unabhängiges Zufallsrauschen** (±7 ms gleichverteilt). Groove braucht systematische Abweichungen: feste Mikro-Offsets je Instrument und Taktposition (z. B. Backbeat-Snare leicht hinten, Bass relativ zur Kick), Akzentmuster je Position (Hi-Hat: Zählzeiten stärker als Offbeats), langsamer korrelierter Drift statt Zufall je Note. Stil-abhängig (Swing, Funk, straight).
3. **Kein Round-Robin, auch nicht bei Drums:** Maschinengewehr bei Hi-Hat und Snare. Drums haben 7 Velocity-Layer, also Nachbar-Layer abwechselnd nutzen und minimal in Pitch, Pegel und Startpunkt variieren (Pseudo-Round-Robin). Prüfen: Wird die offene Hi-Hat von der geschlossenen abgewürgt (Choke)?
4. **Master-Begrenzer** (−10 dB, Ratio 20, Attack 1 ms, Knie 0) drückt eventuell dauerhaft Transienten weg. Erst messen, wie viel Gain-Reduction in typischen Renders anliegt. Idee: sanfte Bus-Kompression als Klebstoff (niedrige Ratio, langsamere Attack) und nur noch ein Sicherheits-Limiter knapp unter 0 dBFS.
5. **Kein gemeinsamer Raum:** Nur Drums/Percussion haben einen Raum-Send, der Hall ist ein generischer 2-s-Rauschimpuls. Idee: kurzer Raum (frühe Reflexionen, ca. 0,3–0,8 s) für alle Schichten mit eigenem Send-Anteil je Instrument, dazu der lange Hall nur sparsam.
6. **Humanisierung** (humanCents/humanDb, velExp/softHz) gilt nur für Gitarren, nicht für Bass, Keys und Drums.
7. **Akkorde:** alle Töne gleiche Velocity, Strum fest 12 ms in eine Richtung. Besser: Ab-/Aufschlag nach Taktposition (Richtung umgekehrt), Strum-Zeit abhängig von Anschlag und Tempo, Akkordtöne leicht unterschiedlich laut.
8. **Sample-Material:** MuseScore_General ist eine GM-SoundFont und setzt eine Obergrenze. Bass und Teile der Gitarren haben nur 22,05 kHz und 1 Velocity-Layer. `chords-organ` (bis 48 HT) und `chords-funk` (bis 36 HT) sind stark verfremdet. Wird später durch Sample-Austausch gelöst, hier nur Schadensbegrenzung.

## Später kommt eine Artikulations-Schicht
Ein Feld `art` am Ereignis (slide, dead, mute, hammer, bend, ...) als eigener Schritt zwischen `buildEvents` und Groove/Humanisierung. Baue Groove und Humanisierung so, dass sie dieses Feld durchreichen und darauf reagieren können (z. B. Dead Notes leiser und kürzer). Die Artikulationen selbst baust du nicht.

## Phase 1 – Prüfen und priorisieren (kein Produktivcode)
- Prüfe jede Hypothese kurz am Code (Datei/Funktion) und, wo möglich, per Offline-Render-Messung mit den vorhandenen Werkzeugen (`render.js`, `render-ab.mjs`, `render-form.mjs`, `spectrogram.mjs`). Ergebnis je Punkt: bestätigt / widerlegt / teilweise.
- Ergänze, was ich übersehen habe, nur mit Begründung. Keine Vollständigkeitsliste.
- Priorisiere nach hörbarer Wirkung pro Aufwand. Engine-Verbesserungen, die allen Stimmen nützen, kommen vor Sample-spezifischen.
- Liste am Ende kurz auf, was der Sampler für die neuen Packs können muss (Stereo, Round-Robins, Release-Samples, mehr Velocity-Layer, Artikulations-Gruppen). Nicht bauen, nur auflisten.
- Ausgabe: Tabelle plus Reihenfolge der ersten 3–5 Schritte, maximal eine Bildschirmseite.

**STOPP. Warte auf mein OK.**

## Phase 2 – Umsetzung in kleinen, hörbaren Schritten
- Ein Schritt = eine Änderung oder ein eng zusammengehöriges Paket, ein Commit mit klarer Message.
- Jede Änderung ist abschaltbar (Feinwert in `tunables.js` plus Regler im render-harness), wo sinnvoll mit Stärke-Regler.
- Humanisierung musikalisch statt reinem Zufall, per Seed reproduzierbar, Werte in ms bzw. Velocity dokumentiert.
- Pro Schritt erzeugst du ein A/B-Paar als WAV mit einem allgemeinen Skript nach dem Muster von `render-ab.mjs`: gleicher Seed, gleiche Takte, Testfälle Rock 120, Funk 100 psychodelish 90, einmal ohne, einmal mit Änderung. **Stereo-WAVs.** Namen: `stepN-<thema>-A.wav` / `stepN-<thema>-B.wav`.
- Danach maximal 10 Zeilen: was geändert wurde, worauf ich hören soll (Instrument, Stelle), Messwerte vorher/nachher, Pfad der WAVs.
- `npm test` bleibt grün. Pegel-Tests nur anpassen, wenn die Änderung sie absichtlich verschiebt, und das ausdrücklich sagen.

**STOPP nach jedem Schritt. Warte auf mein Feedback.**

## Regeln gegen Leerlauf
- Keine Architektur-Rewrites, keine Runtime-Abhängigkeiten (das Projekt ist bewusst ohne Build und ohne Library).
- Neue Samples nur nach Rückfrage.
- Scheitert etwas zweimal am selben Problem: stoppen, beschreiben, Optionen nennen.
- Bei musikalischen Ermessensfragen kurz fragen statt raten.
- Führe Tests und Render-Skripte so aus, dass nur Fehler und Zusammenfassungen ausgegeben werden.
- Lies Dateien, die du gerade geändert hast, nicht zur Kontrolle neu ein.
- Führe in SOUND_CONTEXT.md einen kurzen Abschnitt "Änderungslog Klang v2" (je Schritt 2–4 Zeilen: was, wo, Default-Werte, mein Urteil). Er dient als Übergabe, falls eine neue Session weitermacht.

## Abschlussauftrag (nur wenn ich ihn ausdrücklich gebe)
Schreibe **SPEC_PHASE2.md** (Sampler und Import-Pipeline für SFZ/WAV-Libraries) und **SPEC_PHASE3.md** (Artikulations-Schicht: Datenmodell, Pipeline-Schritt, Regeln je Stil, DSP-Fallbacks), je max. 1–2 Seiten, so konkret, dass ein anderes Modell sie ohne Rückfragen umsetzen kann. Meine Spielregeln je Stil liegen dann in SPIELREGELN.md.
