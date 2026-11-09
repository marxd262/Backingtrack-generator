# Taktarten, Grooves und Komplexitätsregler (Design)

Projekt 2 von 2 nach dem Akkord-Register. Abgestimmt im Chat am 2026-11-09; was nicht ausdrücklich abgestimmt wurde, ist als **(Annahme)** markiert. Verfeinern und Anpassen ist ausdrücklich später möglich: dies ist die **erste Ausbaustufe**.

## Absicht und Warum

Der Nutzer will dem Generator **mehr und komplexere Rhythmen** und **andere Taktarten** geben. Langfristig soll das Werkzeug **drei Wege** unterstützen: (1) einen Rhythmus aus einer Liste wählen, (2) ein Schlagzeugmuster selbst zeichnen, (3) die Komplexität eines Rhythmus mit einem Regler steigern. Der technische Aufbau soll dafür **offen** sein. Für den Start genügt **ein Satz an Rhythmen mit einem Komplexitätsregler**.

Heute ist alles auf 4/4 mit 16 Sechzehnteln je Takt geschrieben: `STEPS = 16` und feste Muster-Listen in `src/core/events.js`, `steps: beats * 4` und `stepSec = 60 / bpm / 4` in `src/core/timeline.js`. Das Feld `meter` des Tracks wird gelesen, aber ignoriert (`normalizeTrack` setzt `[4, 4]`). Takte mit 1 bis 16 Schlägen sind erlaubt, die Muster passen aber nur zu vier Schlägen (kürzere Takte werden abgeschnitten, längere wiederholt). Die Schrittweite für Swing (`at()` verschiebt ungerade Schritte) setzt ein gerades Raster voraus.

## Ziele

1. **Groove-Register** (`src/core/grooves.js`) als einzige Quelle für alles, was einen Rhythmus ausmacht, nach dem Vorbild von `src/core/chords.js`: ein Groove ist ein **Datensatz** (Taktart, Raster, Muster je Instrument in Komplexitätsstufen). Weitere Grooves sind Einträge dort; ein späterer Editor erzeugt Einträge im **selben Format**, eine spätere Auswahl liest sie.
2. **Taktarten** **(Annahme)**: `4/4` (heutiges Verhalten), `3/4`, `6/8`, `12/8`, `5/4`. Die Taktart bestimmt Schläge je Takt und das Raster: einfache Taktarten haben **4 Schritte je Schlag** (Sechzehntel), zusammengesetzte (`6/8`, `12/8`) **3 Schritte je Schlag** (Achteltriolen im Puls der punktierten Viertel).
3. **Komplexitätsregler**: ein Wert `complexity` von 0 bis 1 für die ganze Band **(Annahme)**, Standard 0,5 = unverändert. Er **verschiebt** die schon vorhandenen Muster-Parameter (`drive` für das Schlagzeug, `bassMovement` für den Bass, `syncopation` für Akkorde und Kicks) und wählt darüber die Musterstufe. Die Schlagworte (treibend, locker, synkopiert ...) wirken weiter, der Regler liegt **über** ihnen (so wie die Klangregler über den Klang-Schlagworten).
4. **Erster Satz an Grooves** **(Annahme, Feinheiten und Muster stehen im Register und sind per Hörprobe änderbar)**: `4/4`: `straight` (der heutige Generator, bitgleich) und ein Groove mit Clave-/Latin-Charakter; `3/4`: Walzer (`waltz`) und ein Rock-Walzer; `6/8`: eine Ballade und ein Rock-Groove; `12/8`: Shuffle und langsamer Blues-Groove; `5/4`: ein Groove in 3+2.
5. **Oberfläche**: eine neue Gruppe **Rhythmus** in der linken Leiste mit Taktart-Chips, den Grooves der gewählten Taktart als Chips und dem Komplexitätsregler (0 bis 100 %). Bedienung per Tastatur, in beiden Sprachen.
6. **Erweiterbar und prüfbar**: Ein Konsistenztest geht jeden Groove, jede Stufe und jede Taktart durch (siehe "Akzeptanz"), eine kurze Anleitung "So ergänzt man einen Groove" steht in `docs/interface.md`.

## Nicht-Ziele (erste Ausbaustufe)

- **Zeichen-Raster** (Schlagzeugmuster selbst zeichnen) und ein sichtbares Format dafür: nur der Aufbau soll offen sein (ein Groove ist ein Datensatz).
- Komplexitätsregler **je Instrument** (das Format lässt es zu; erst ein Regler für alle).
- Ungerade Gruppierungen wie `7/8` mit wechselnden Zählzeitgruppen, wechselnde Taktarten innerhalb eines Stücks, Polyrhythmen über mehrere Taktarten.
- Neue Instrumente, neue Klänge, Änderung der Stile: die neun Stil-Vorlagen behalten ihre Schlagworte, ihr Tempo und ihre Akkordfarbe und enthalten **keine** Taktart, keinen Groove und keine Komplexität. Ein Klick auf einen Stil ändert die gewählte Taktart, den Groove und die Komplexität **nicht**.
- Live-Umschalten der Taktart (ein Wechsel startet die Wiedergabe neu); Groove und Komplexität innerhalb derselben Taktart wirken live (siehe unten).

## Anti-Ziele (das wäre ein Misserfolg, auch wenn alles "funktioniert")

- Ein bestehender Track in `4/4` mit dem Groove `straight` oder ohne Angabe klingt oder verhält sich **anders** als vorher: der Ereignisstrom bleibt **bitgleich** (Golden-Hashes in `tests/core/golden.test.js` unverändert grün, auch mit `variety`; Standard `complexity` 0,5).
- Die öffentliche Schnittstelle für Interactive Scales bricht: Track-Format, `VALIDATION_CODES` (nur additiv, siehe unten), `chordTimeline`-Zeiten für `4/4`-Tracks, `play`-Handle.
- Einen Groove zu ergänzen erfordert mehr als das Register und die zwei Sprachdateien anzufassen.
- Ein Groove, der aus dem Takt läuft (Ereignisse außerhalb des Takts, Muster, die mit der Taktlänge nicht aufgehen), mehrere Schläge pro Takt fehlen oder `NaN`/`undefined`-Noten erzeugt.

## Das Raster

`bpm` zählt **Schläge (den Puls) der Taktart**: bei `4/4`, `3/4` und `5/4` Viertel, bei `6/8` und `12/8` punktierte Viertel. Dokumentiert in `docs/interface.md`.

Je Takt gilt `steps = beats * sub`: `4/4` 4 × 4 = 16 (wie heute), `3/4` 3 × 4 = 12, `5/4` 5 × 4 = 20, `6/8` 2 × 3 = 6, `12/8` 4 × 3 = 12. `stepSec = 60 / bpm / sub`. Takt-Zeiten und `chordTimeline` bleiben `beats * 60 / bpm`. Das Feld `beats` je Takt bleibt (1 bis 16, Standard aus der Taktart): Takte mit anderer Schlagzahl als die Taktart bleiben wie bisher erlaubt (Muster werden abgeschnitten oder wiederholt).

**Swing** (`swing`-Parameter) verschiebt nur im Raster mit `sub = 4`; im Triolen-Raster (`sub = 3`) trägt das Raster das Shuffle-Gefühl selbst, `swing` ist dort ohne Wirkung. Jitter und `humanVel` bleiben.

## Das Groove-Register (`src/core/grooves.js`)

Ein eingefrorenes Objekt `GROOVES`, Schlüssel = Groove-ID (bleibt der String im Track). Je Eintrag (Feldnamen sind ein Vorschlag, die Struktur ist verbindlich):

| Feld | Bedeutung |
| --- | --- |
| `meter` | Taktart `'4/4'`, `'3/4'`, `'6/8'`, `'12/8'` oder `'5/4'` |
| `drums`, `bass`, `chords`, `pad` | Muster je Instrument; `drums`: Stufen (einfach bis komplex) mit Kick-Varianten, Snare- und Geisternoten-Schritten und Hi-Hat-Lautstärken je Schlag (so viele Werte wie das Raster Schritte je Schlag hat); `bass`: Stufen mit Schritt-Listen `[Schritt, Grad, Länge]`; `chords`: Stab-Listen und Arpeggio-Schrittweite; Fills; zusätzliche Muster für `variety` |
| `fillBeats` | Länge der Fills am Abschnittsende in Schlägen (Standard 2; 1 bis zur Schlagzahl der Taktart) |
| `thresholds` | je Instrument die Schwellen, die den Parameter auf die Stufe abbilden (Standard `[0.35, 0.7]` für drei Stufen wie heute; mehr Stufen sind möglich) |
| `group` | Gruppe für die Auswahl (z. B. nach Taktart) |

Alle Schritte eines Groove liegen im Raster seiner Taktart (0 bis `steps - 1`). Der heutige Generator wird zum Groove `straight` in `4/4`: seine Tabellen (`DRUMS`, `BASS`, `STABS`, `ARPS`, `FILLS` und die `EXTRA_*`-Listen) wandern unverändert in das Register; die Auswahl- und Erzeugungslogik in `events.js` liest aus dem Groove und kennt keine feste 16 mehr.

Funktionen (rein, ohne DOM): `grooveFor(track)` (gewählter Groove oder der Standard der Taktart), `groovesFor(meter)` (Grooves einer Taktart in Registerreihenfolge), `meterGrid(meter)` (`{ beats, sub }`), `isMeter(m)`. `CHORDS`-ähnliche Ausfuhr `GROOVES` und `METERS` aus `src/index.js` (additiv).

## Die Komplexität

`complexity` (0 bis 1, Standard 0,5 oder fehlend) wirkt so **(Annahme)**:

```
drive'        = clamp01(drive        + (complexity - 0.5) * 1.0)
bassMovement' = clamp01(bassMovement + (complexity - 0.5) * 1.0)
syncopation'  = clamp01(syncopation  + (complexity - 0.5) * 0.6)
```

Bei 0,5 ist die Verschiebung null, die Parameter und damit der Strom bleiben bitgleich. Die Stufenauswahl benutzt weiter die Schwellen der Grooves auf `drive'` und `bassMovement'`. Mehr Komplexität heißt also nacheinander: Halbzeit zu Achteln zu Sechzehntel-Hi-Hat mit Geisternoten, mehr Bass-Bewegung, mehr synkopierte Kicks und Stabs. Die Verschiebung kommt **nach** der Streuung durch `variety` (die Streuung bleibt ein kleiner Einfluss um den gewählten Wert).

## Track-Format und Schnittstelle

- `meter`: bleibt `[Zähler, Nenner]`, Standard `[4, 4]`. Neu: ein unterstützter Wert wird zum Raster, **ein nicht unterstütztes `meter` meldet den neuen Code `badMeter`** (additiv; `VALIDATION_CODES` und die Übersetzungen wachsen um diesen Code) **(Annahme)**. Bisherige Tracks haben `[4, 4]` oder kein Feld und bleiben gültig.
- `groove` (neu, optional): Groove-ID; fehlt es oder passt es nicht zur Taktart, gilt der Standard der Taktart (`straight`, `waltz`, ...). Eine unbekannte ID meldet `badGroove` **(Annahme)**.
- `complexity` (neu, optional): Zahl 0 bis 1, sonst `badComplexity`; fehlend gleich 0,5.
- `bars[].beats`: unverändert; die Oberfläche legt Takte mit den Schlägen der Taktart an (Folge aus Vorlage, hinzugefügte Akkorde).
- `play`-Handle: Groove und Komplexität innerhalb derselben Taktart ändern nur den Ereignisstrom und laufen über das vorhandene `setTrack` live. `setTrack` vergleicht künftig auch **Schlagzahl und Raster der Taktart** (nicht nur die Dauer eines Durchlaufs): bei einer anderen Taktart, auch wenn die Dauer gleich bleibt (4/4 zu 12/8), meldet es `false` ohne Änderung, und die Oberfläche startet neu. `setTrack` ist neu (nicht Teil der Schnittstelle, die Interactive Scales heute nutzt); die zusätzliche Bedingung kommt in `docs/interface.md`.

## Tempo bei Taktartwechsel

`bpm` zählt Schläge der Taktart (siehe Raster). Beim Wechsel zwischen einfachen (Viertel-Puls: 4/4, 3/4, 5/4) und zusammengesetzten Taktarten (punktierter Puls: 6/8, 12/8) in der Oberfläche bleibt die **Achtelgeschwindigkeit** gleich **(Annahme)**: einfach zu zusammengesetzt `bpm' = round(bpm * 2 / 3)`, zusammengesetzt zu einfach `round(bpm * 3 / 2)`, jeweils auf 40 bis 200 begrenzt. Innerhalb derselben Art (zum Beispiel 4/4 zu 3/4) bleibt `bpm`. Das Tempo im Track-Format wird nicht umgerechnet, nur die Oberfläche tut es beim Wechsel; Gruppen mit eigenem Vorschlag je Groove gibt es nicht.

## Oberfläche

Neue Gruppe **Rhythmus** (`data-group="rhythm"`, zu Beginn offen) in der linken Leiste, über den Klangreglern:

- **Taktart**: Chips `4/4 3/4 6/8 12/8 5/4`, einer gedrückt (`aria-pressed`). Ein Wechsel setzt den Standard-Groove der Taktart, rechnet das Tempo um (siehe oben), legt die Takte der Akkordfolge mit den Schlägen der Taktart an (die Folge selbst bleibt) und startet eine laufende Wiedergabe neu. Ein Klick auf einen Stil ändert Taktart, Groove und Komplexität nicht.
- **Groove**: Chips der Grooves der gewählten Taktart, einer gedrückt. Wirkt live.
- **Komplexität**: Regler 0 bis 100 % (Standard 50 %), `aria-valuetext`, wirkt live (beim Ziehen höchstens einmal je Bild neu berechnen).
- Texte `groove.<id>` und `meter.<id>` in `de.js` und `en.js`; ohne rohe Schlüssel.
- Das Rad, das Griffbrett und der Verlauf zeigen weiter Takte; der Verlauf zeichnet die Ereignisse nach Zeit und braucht keine Änderung. Die Taktzeile und die Kopfzeile bleiben.

## Verhalten des Generators

- Schlagzeug, Bass, Akkord-Stabs/Arpeggio, Pad, Fills und der Anlauf `ap` des Basses rechnen mit `b.steps` und dem Zyklus des Grooves (statt der festen 16). Fills belegen die letzten `fillBeats` Schläge eines Takts (Registerfeld je Groove, Standard 2, mindestens 1 und höchstens die Schlagzahl der Taktart; bei 6/8 also höchstens ein Puls, damit im Fill-Takt ein Teil des Grooves bleibt).
- Hi-Hat-Lautstärken sind je Schlag angegeben und passen sich an `sub` an (4 Werte bei Sechzehnteln, 3 bei Triolen).
- Die Reihenfolge der Zufallsziehungen für `straight` in `4/4` bleibt exakt wie heute; neue Grooves dürfen eigene Reihenfolgen haben, sind aber ebenfalls deterministisch je Seed.
- Aufbau (`buildArrangement`), Takt-Marker und Fills in Abschnitten bleiben; sie hängen nicht an der Taktart.

## Akzeptanz

1. `npm test` und `npx playwright test` grün; **Golden-Hashes unverändert**. Die Golden-Tests haben heute **keine Hashes für Tracks mit `variety`**; sie werden **vor dem Umbau** aus dem heutigen Code aufgenommen (drei Stile und `legacy` mit `variety: true`), damit "auch mit `variety` unverändert" prüfbar ist.
2. **Register-Konsistenztest** über alle Grooves: Taktart unterstützt; alle Schritte im Raster; je Instrument mindestens eine Stufe; `thresholds` aufsteigend in [0,1] und passend zur Zahl der Stufen; Hi-Hat-Werte so viele wie Schritte je Schlag; Namen `groove.<id>` und `meter.<id>` in beiden Sprachen.
3. **Generatortest** über alle Grooves × `complexity` (0, 0,25, 0,5, 0,75, 1) × `variety` an/aus × mehrere Seeds × einige Tonarten: Ereignisse sortiert, endlich, jedes Ereignis im Takt (`t` zwischen Taktanfang und Taktende), Töne im Bereich, Bass 28 bis 52, Fills enden im Takt, jeder Takt hat Ereignisse der erwarteten Schichten; `chordTimeline` und `buildEvents` stimmen über Taktdauer überein.
4. **Rasterprüfung:** Die Zeit jedes Schlagzeug- und Bass-Ereignisses liegt bei `Taktanfang + Schritt * stepSec` bis auf Jitter (höchstens 0,02 s) und Swing (nur `sub = 4`).
5. **Komplexität wirkt:** über jeden Groove steigt die Zahl der Schlagzeug-Ereignisse je Takt (Mittelwert über Seeds) mit `complexity` nicht-fallend und von 0 zu 1 insgesamt mindestens um einen Mindestanteil; bei 0,5 ist der Strom gleich dem ohne Angabe.
6. UI: Taktart, Groove und Komplexität per Maus und Tastatur, Live-Wirkung von Groove und Komplexität ohne Neustart (ein Instrumentensatz), Neustart bei Taktartwechsel im selben AudioContext, kein roher Schlüssel in beiden Sprachen, 360 px ohne Überlauf; bestehende E2E-Specs grün (angepasst, nie abgeschwächt).
7. Offline-Pegeltest: jede Taktart mit ihrem Standard-Groove und je ein komplexer Groove: Spitze nach dem Begrenzer unter 0,9, jede Schicht hörbar.
8. `docs/interface.md`: Taktarten, Raster, Bedeutung von `bpm`, Felder `meter`/`groove`/`complexity`, neue Codes, Anleitung zum Ergänzen eines Grooves.

## Risiken

- Der Umbau von `events.js` ist der größte Eingriff am Generator. Absicherung: erst die Tabellen und die Rasterweite des heutigen Generators ohne neue Grooves in das Register heben und die Golden-Hashes grün halten, dann Taktarten und Grooves ergänzen.
- Neue Grooves klingen erst nach einer Hörprobe gut; die Tests prüfen Gültigkeit, Raster und Eckwerte der Komplexität, nicht den Geschmack.

## Dem Bauenden überlassen

Dateizuschnitt (`grooves.js` darf in Muster-Tabellen und Logik geteilt werden), genaue Feldnamen im Register, die konkreten Muster der neuen Grooves (Kicks, Snares, Hi-Hats, Bass- und Akkordmuster, Fills), die Namen und Hinweistexte der Grooves, die Reihenfolge der Chips, die Drosselung des Reglers, Testdateinamen.

## Festgelegt beim Prüfen des Dokuments (meine Wahl, bitte gegenlesen)

1. Ein Stil-Klick lässt Taktart, Groove und Komplexität unberührt (Blues über den 12/8-Shuffle ist möglich); damit bleibt der Live-Pfad der Stilkarten (`applyLive`) unverändert.
2. `setTrack` meldet bei geänderter Taktart `false`, auch bei gleicher Dauer (4/4 zu 12/8).
3. Ein nicht unterstütztes `meter` meldet `badMeter`. Die Schnittstellen-Doku nannte `meter` bisher "ignoriert, angeboten wird nur 4/4", Interactive Scales sendet es nach dem alten Format nicht; Tracks ohne `meter` oder mit `[4, 4]` verhalten sich wie bisher.
4. Beim Taktartwechsel in der Oberfläche bleibt die Achtelgeschwindigkeit gleich (Umrechnung des Tempos), innerhalb einer Art bleibt `bpm`.
5. Fills haben je Groove ein Feld `fillBeats` (Standard 2, höchstens die Schlagzahl).
6. Die Taktart-Chips zeigen den Schlüssel (`4/4`, `6/8` ...) selbst und brauchen keine Übersetzung; es gibt **keine** `meter.<id>`-Texte (nur `groove.<id>`, `group.rhythm`, `ui.meter`, `ui.groove`, `ui.complexity`). Das Stiltempo wird in 6/8 und 12/8 in Achtelgeschwindigkeit umgerechnet (Stil Blues mit 88 wird 59), und das Tempo bleibt beim Hin- und Herwechseln der Taktart ohne eigene Änderung exakt erhalten.
