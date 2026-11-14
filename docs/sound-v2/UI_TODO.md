# UI_TODO – Rack-Oberfläche, Schritte 2–4

Stand: 2026-11-13. Grundlage sind die Spec [docs/superpowers/specs/2026-11-13-rack-ui-design.md](docs/superpowers/specs/2026-11-13-rack-ui-design.md) (bindend; Abschnitt „Reihenfolge“), die Entwürfe `…/2026-11-13-rack-ui/rack.html` und `start.html` und der Plan zu Schritt 1 in `docs/superpowers/plans/2026-11-13-rack-ui-step1.md` (Muster für Global Constraints).

## Stand nach Schritt 1

- Schritt 1 ist **fertig**. Er liegt als Squash `4c107af` auf `feat/sound-v2`; der Original-Branch `feat/rack-ui` (`a7ec12e`, 14 Commits) bleibt erhalten. Auf `feat/sound-v2` läuft eine Klang-Session (siehe `SOUND_CONTEXT.md`, Abschnitt „Änderungslog Klang v2“) mit der Regel „UI nicht anfassen“ bis zum 16.11. **Schritt 2 erst beginnen, wenn diese Session committet und abgeschlossen ist.**
- Fertig sind:
  - Kopfleiste mit Fokus/Einstellen (`backingtrack.layout`).
  - Visualisierung: Tonart mit Countdown, Griffbrett mit 22 Bünden und dem Schalter „echt/gleich breit“, Akkordrad (pink = jetzt, türkis = nächster Wechsel), Form-Streifen mit Spuren.
  - Rack mit den Modulen Harmonie, Rhythmus, Charakter (noch die alte Wortliste) und je einem Modul pro Instrument (Stimme als LCD, Detailregler).
  - Mixer mit Fadern, Stumm und dem Schalter `#all-voices`.
  - Bausteine `knob.js`, `lcd-select.js`, `knob-geometry.js`.
- Die Klang-Session hat danach in den Mixer die Knöpfe Panorama (`master.width`), Raumgröße (`master.roomSize`) und Raumanteil (`master.roomWet`) eingebaut, ins Rhythmus-Modul den Knopf Lockerheit (`loose`).
- Pan je Schicht gibt es im Audio schon: `balance()`/`applyPan()` in `src/audio/synth.js`, die Lagen kommen aus `MIX_TUNABLES['mix/pan']` (`tunables.js`). Im UI und im Speicher fehlt er noch.
- Tests: `npm test` lief 667/667 grün, `npm run test:e2e` mit 661 bestanden (Stand `a7ec12e`, vor der Klang-Session). Zum Entwickeln reicht `npm run test:ui` (ca. 1 min); vor jedem Abschluss läuft die volle e2e-Suite.

## Schritt 2 – Mixer vollständig

**Ziel:**
- Jeder Kanal bekommt einen Pan-Knopf (Mitte = 12 Uhr) und eine LED-Pegelanzeige neben dem Fader.
- Das Rack wird schmaler: heute ist es rund 3300 px breit, und der Schalter „alle Samples“ ist nur mit Scrollen erreichbar (Finding F3).

**Dateien:**
- `src/audio/synth.js`: Pan je Schicht live setzbar machen, einen `AnalyserNode` je Schicht.
- `src/audio/play.js`: Pegel nach außen geben.
- `src/audio/mix.js` und `src/ui/mix-state.js`: Pan in `backingtrack.mix` aufnehmen.
- `src/core/profile-parts.js`: Profil-Teil `mixer`. Alte Profile ohne Pan bleiben gültig.
- `src/ui/mixer.js`, `index.html`, `app.css`, `src/i18n/de.js` und `en.js`.
- Tests: `tests/e2e/mixer.spec.js`, `layout.spec.js`, `levels.spec.js`, `tests/core/profile-parts.test.js`.

**Offen (Empfehlung jeweils zuerst):**
1. Pan-Knopf je Kanal gegenüber dem Panorama-Knopf: Der Kanal-Knopf setzt die Lage, und der Standard ist der Tunable-Wert. Panorama bleibt der Faktor für die Breite.
2. Die Anzeige misst nach Fader und Stumm.
3. Rack-Breite: Der Mixer kommt als erstes Modul oder bleibt rechts fest stehen; die Module werden dichter (die Fläche 1600×960 prüfen). Die Alternative ist ein zweizeiliges Rack.

## Schritt 3a – Klangbearbeitung je Spur

**Ziel:** Hinter jeder Stimme sitzt eine Kette (Filter/EQ, Transienten, Kompression, Breite), auf die später die Makros wirken, egal ob Synth oder Sample. Steht alles neutral, ist sie klanglich unhörbar. Das ist ein Anti-Ziel der Spec und braucht einen Messtest mit `compareRenders` in `src/audio/render.js`.

**Dateien:**
- `src/audio/synth.js`: die Kette Stimme → Verzerrer → mute → level → trim → balance; die Bearbeitung kommt vor `mute`.
- `src/core/voices.js` (`uses`), `src/core/timbre.js`, `tunables.js`.
- Tests: `tests/e2e/levels.spec.js`, `sound.spec.js`, `voices-sound.spec.js`.

**Offen:**
- Welche Bausteine es gibt.
- Ob die Bus-Kette der Klang-Session (`mix/bus`, Standard aus) bleibt.
- Ab hier zählt das Hörurteil des Nutzers; Werte gelten als „nach Wissen gesetzt“.

## Schritt 3b – Makros und Wortwolke

**Ziel:** Die Regeln 1–6 der Spec umsetzen:
- Kein Wort ohne Wirkung.
- Gegensätze sind sichtbar und schließen sich aus.
- Ein Wirkungs-Display zeigt, was ein Wort tut.
- Der Stil schlägt Wörter vor.
- Klangwörter wirken über die Makros.
- Nichts überschreibt still.

Die Makros (zweipolig, im Instrument-Modul) ersetzen `drumSound`/`bassSound`/`chordSound`/`padSound`. Die Wolke steht im Charakter-Modul als Fenster.

**Dateien:**
- `src/core/tags.js` (`EFFECTS`, `INERT_TAGS`, `TAG_CATEGORIES`), `src/core/timbre-effects.js`, `src/core/profile-parts.js` (alte Klangwörter → Makro-Stellungen).
- `src/ui/timbre-panel.js`, Charakter-Modul in `index.html` und `app.js`.
- `docs/interface.md`.
- `tests/core/golden.test.js` muss **unverändert** grün bleiben (das Spielverhalten bleibt).

**Offen:**
- Makros je Instrument (Vorschlag in `rack.html`; Lead mindestens eins, Percussion keins).
- Endgültige Wortliste (Vorschlag in `start.html`).
- Rechenmodell für Regel 6 (Vorschlag: Summe, begrenzt auf [0, 1]).

## Schritt 4 – Startseite

**Ziel:**
- Der Satz „Spiel [Tonart Skala] im Stil [Stil] bei [Tempo] BPM“ mit der Wolke darunter.
- Los: wechselt auf die Spielseite im Fokus-Zustand.
- Überrasch mich: würfelt neu, lässt aber stehen, was der Nutzer angefasst hat.
- Weitermachen: stellt die letzte Sitzung wieder her und setzt die Wiedergabe beim gespeicherten Takt fort. Die Sitzung wird automatisch gespeichert.

**Dateien:**
- `src/ui/index.html` (`#start`, `#go`, `#tune-btn` entfällt).
- `src/ui/app.js`, `src/ui/profile-session.js` (`readSession`, `captureParts`).
- Neuer Speicherschlüssel, z. B. `backingtrack.session`.
- Die e2e-Tests anpassen, die über die Startseite einsteigen (`#go`, `#tune-btn`): `flow.spec.js`, `count-helpers.js` und viele weitere (`grep -l "#tune-btn\|#go" tests/e2e`).

**Offen:**
- Wann gespeichert wird (Empfehlung: bei Stopp und bei `pagehide`).
- Ob die Wiedergabe beim gespeicherten Takt oder am Teilanfang weitergeht.

## Vor Schritt 2 selbst testen

`npm start` starten und http://localhost:4173/ui/index.html öffnen, möglichst ein paar Songs durchspielen:

- Im Fokus-Zustand: Erkennst du beim Spielen mit einem Blick den Teil, die Tonart, den nächsten Akkord und den Countdown?
- Griffbrett: Welcher Modus trägt besser, „echte Bünde“ oder „gleich breit“? Sind die Markierungen deutlich genug? Sind 22 Bünde gut lesbar?
- Im Einstellen-Zustand: Kommst du an alle Module und an „alle Samples“, und wie viel musst du dafür scrollen? Das entscheidet Offen 3 von Schritt 2.
- Knöpfe: Fühlen sich Ziehen, Mausrad und Doppelklick zum Zurücksetzen richtig an? Ist die Bogenfarbe (türkis = links, pink = rechts) verständlich?
- Mixer: Sind die Fader und Stumm-Tasten zuverlässig? Passen die neuen Panorama- und Raum-Knöpfe in die Reihe?
- Notiere, was fehlt oder doppelt wirkt, und welche Monitorgröße du nutzt.

## Arbeitsweise und Reste

- Je Schritt: zuerst einen eigenen Plan schreiben (superpowers:writing-plans) unter `docs/superpowers/plans/2026-MM-DD-rack-ui-stepN.md`. Dann mit Subagenten umsetzen: Implementierer und Task-Reviews mit Sonnet, die Gesamt-Review mit Opus.
- Offene Kleinigkeiten aus Schritt 1, die mitgenommen werden, wenn die Datei ohnehin angefasst wird:
  - Die ‹›-Tasten haben allgemeine Namen statt eigener je LCD.
  - Veraltete Wörter in `docs/interface.md` („Schichtknöpfe“) und im README („mute chip“).
  - „Regler“ (DE) und „knobs“ (EN) sind uneinheitlich.
  - Spur-Labels zeigen „stumm“ nur visuell.
  - Graue Farbwerte sind fest kodiert.
  - Die Formatierung der Tonartnamen ist doppelt vorhanden.
  - Es fehlt ein Test für den Countdown nach einer Tempo-Änderung.
  - Zur Hausarbeit: `stash@{0}` auf `feat/rack-ui` verwerfen.
