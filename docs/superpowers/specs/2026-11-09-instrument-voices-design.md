# Wählbare Instrumentenstimmen: bessere Synths und Saitenmodelle (Design)

Abgestimmt im Chat am 2026-11-09; was nicht ausdrücklich abgestimmt wurde, ist als **(Annahme)** markiert. Dies ist die **erste Ausbaustufe**: Samples kommen später (siehe "Ausblick").

## Absicht und Warum

Der Nutzer hört: Das Schlagzeug ist eine ziemlich gute Simulation, **alles andere klingt nach Synth**. Das ist das größte verbleibende Problem des Klangs. Er möchte es in Stufen angehen: (1) die Synths verbessern und **Saitenmodelle** einbauen, **nicht nur akustisch** (auch E-Gitarre und E-Bass), (2) jedes Instrument **wählbar** machen, als **Dropdown pro Instrument**, (3) später, je nachdem wie es läuft, **Samples**.

Heute ist je Instrument (Bass, Akkorde, Pad) genau ein Klangerzeuger fest in `src/audio/synth.js` verdrahtet (`bassNote`, `chordNote`, `padNote`, aus Oszillatoren, Tiefpass und Hüllkurve). Die Klangregler (`DEFAULT_TIMBRE` in `src/core/timbre.js`) und die Verzerrerkette (`src/audio/guitar-fx.js`) sitzen darum und bleiben.

## Ziele

1. **Stimmen-Register** als einzige Quelle für alles, was eine wählbare Stimme ausmacht, nach dem Vorbild von `CHORDS` und `GROOVES`. Je Instrument (`bass`, `chords`, `pad`; **nicht** `drums`) eine Liste von Stimmen mit festem Eintrag: ID, **Art** (`kind`: `synth`, `model`, später `sample`), optional Varianten, die Liste der Klangregler, die die Stimme benutzt (`uses`). Eine Stimme zu ergänzen heißt: ein Registereintrag, die Klangerzeugung dazu, die Namen in beiden Sprachdateien; nicht mehr.
2. **Die Stimme ist im Track gewählt** **(Annahme)**: optionales Feld `voices: { bass, chords, pad }`, je Instrument `{ id, variant }` (beides optional). Fehlt es oder ist es unbekannt, gilt der heutige Klang. Ungültiges meldet `validateTrack` mit einem **neuen, additiven** Code `badVoice` (die bestehenden Codes bleiben).
3. **Der heutige Klang bleibt Standard und bitgleich.** Die Stimme `synth` mit der Variante `classic` ist genau der heutige Klangerzeuger (Graph und Pegel unverändert). Alle Pegel-Messwerte von `tests/e2e/levels.spec.js` und `sound.spec.js` im Standardklang bleiben gleich.
4. **Stimmen (Annahme, Liste und Klangfeinheiten sind per Hörprobe änderbar):**
   - **Bass:** `synth` (Varianten `classic`, `saw`, `square`, `triangle`, `sine`), `synthbass` (verbessert: Sub-Oktave, Sägezahn oder Puls, Filterhüllkurve mit Resonanz), `string` (Saitenmodell; Varianten `finger` E-Bass, `pick` E-Bass mit Plektrum, `upright` Kontrabass).
   - **Akkorde:** `synth` (Varianten wie beim Bass), `string` (Varianten `nylon`, `steel`, `electric` E-Gitarre clean, `electricBridge` E-Gitarre mit Stegtonabnehmer), `epiano` (FM, Rhodes-artig), `organ` (additiv, Zugriegel mit Perkussion).
   - **Pad:** `synth` (Varianten wie oben), `strings` (Streicher-Ensemble: viele verstimmte Sägezähne, Chorus, langsamer Einsatz), `organ`.
5. **Die Klangregler bleiben für alle Stimmen dieselben** (Helligkeit, Länge, Chorus, Zupfen, Grenzfrequenz ...). Jede Stimme deutet sie auf ihre Weise (zum Beispiel wirkt `pluck` beim Saitenmodell als Zupfposition und Dämpfung). Regler, die eine Stimme nicht benutzt (`uses`), erscheinen in der Oberfläche **deaktiviert**, damit niemand vergeblich daran dreht. Es kommen **keine** neuen Regler dazu: Unisono-artige Breite gibt es schon als `chorus` (Akkorde) und `thickness` (Pad).
6. **Oberfläche:** in jeder der drei Klanggruppen ein Dropdown **Stimme** ganz oben, gruppiert nach Art (`optgroup`: Synthese, Saitenmodell, später Samples), und ein zweites Dropdown **Variante**, das nur erscheint, wenn die Stimme mehrere Varianten hat. Bedienung per Tastatur, beide Sprachen, bis 360 px.
7. **Live umschaltbar:** Eine Auswahl wirkt ohne Neustart. Neue Töne klingen sofort in der neuen Stimme, schon klingende Töne klingen in der alten aus (wie bei `setTimbre`). Dazu ein `setVoices` im `play`-Handle, analog zu `setTimbre`.
8. **Die Verzerrerkette wirkt unverändert auf jede Stimme** (E-Gitarre plus Distortion ergibt eine Rockgitarre).
9. **Erweiterbar zu Samples:** Das Register erlaubt Art `sample` und eine optionale asynchrone Vorbereitung (`prepare`) je Stimme. Gebaut wird in dieser Stufe nur das Register mit diesem Haken, **kein** Laden und keine Lade-Oberfläche.

## Nicht-Ziele (erste Ausbaustufe)

- Samples, Lade-Zustände, Lizenzangaben. Neue Schlagzeug-Sätze (das Schlagzeug gilt als gut).
- Neue Klangregler, stimmenspezifische Regler, Speichern der Wahl über ein Neuladen hinaus (es wird auch sonst nichts gespeichert außer der Sprache).
- Stile (`STYLE_PRESETS`) setzen **keine** Stimme: ein Klick auf einen Stil ändert die gewählten Stimmen nicht (**Annahme**, spätere Erweiterung möglich).
- Ein eigenes Saitenmodell-Fenster (Zupfposition, Tonabnehmer, Korpus als eigene Regler); alles läuft über die vorhandenen Regler und die Varianten.
- Echte Spielweisen wie Slap, Hammer-on, Bending, Akkordgriff-Voicings der Gitarre. Ein leichtes **Anstreichen** der Akkordtöne (Strum, Staffelung um wenige ms) bei den Saitenmodellen ist erlaubt, wenn es deterministisch bleibt.

## Anti-Ziele (das wäre ein Misserfolg, auch wenn alles "funktioniert")

- Der Standardklang ändert sich hörbar oder messbar (Graph, Pegel, Ereignisstrom). Die Stimmen ändern **nie** den Ereignisstrom (`buildEvents` liefert dieselben Ereignisse).
- Eine neue Stimme ist deutlich lauter oder leiser als die Standardstimme desselben Instruments und bringt die Mischung oder den Begrenzer aus dem Gleichgewicht.
- Knacken, Aussetzer oder hohe Rechenlast beim Spielen oder Umschalten, vor allem bei den vorab berechneten Saitenmodellen.
- Eine Stimme klingt bei bestimmten Tönen verstimmt, verschwindet oder erzeugt `NaN` (Tonumfang Bass MIDI 28 bis 52, Akkorde und Pad 24 bis 100).
- Das Hinzufügen einer Stimme verlangt mehr als Registereintrag, Klangerzeugung und die zwei Sprachdateien.
- Die Verzerrerkette, die Klangregler oder die Mischpult-Regler brechen.

## Das Register

`src/core/voices.js` (reine Daten, **ohne** Audio-Importe, damit `validateTrack` es lesen kann) und die Klangerzeugung in `src/audio/voices/` (eine Datei je Stimme oder Familie). Ein eingefrorenes Objekt je Instrument, Schlüssel = Stimmen-ID:

| Feld | Bedeutung |
| --- | --- |
| `kind` | `synth`, `model` oder `sample` (steuert die Gruppen im Dropdown) |
| `variants` | Liste der Varianten-IDs, die erste ist der Standard; leer oder ein Eintrag: kein Variantenfeld in der Oberfläche |
| `uses` | Klangregler (`Gruppe.Feld` aus `DEFAULT_TIMBRE`), auf die die Stimme hörbar reagiert |
| `prepare` (optional, nur Audio) | asynchrone Vorbereitung, später für Samples |

Funktionen (rein): `voiceFor(track, layer)` (gewählte Stimme samt Variante oder der Standard), `voicesFor(layer)`, `isVoice(layer, id, variant)`. Der Standard je Instrument ist `synth` / `classic`. Die Namen stehen in `src/i18n` unter `voice.<layer>.<id>`, `variant.<layer>.<id>.<variant>` und `voice.kind.<kind>`; ein Konsistenztest geht jede Stimme durch (Art gültig, Varianten eindeutig, `uses` gültig, Namen in beiden Sprachen, Klangerzeugung vorhanden).

## Klangerzeugung

**Synthese-Stimmen** bleiben Web-Audio-Knotengraphen je Ton, wie `bassNote`, `chordNote`, `padNote` heute; die Parameter lesen sie beim Anschlag aus einer geteilten Parameter-Tabelle (`voice-params.js`), sodass `setTimbre` sie live ändert.
- `synth` mit Variante: dieselbe Struktur wie `classic`, aber alle Oszillatoren der Stimme in der gewählten Wellenform (Sinus, Dreieck, Sägezahn, Rechteck). `classic` bleibt unverändert, bit für bit.
- `synthbass`, `epiano`, `organ`, `strings` sind eigene Graphen (FM, additiv, viele verstimmte Oszillatoren mit Chorus).

**Saitenmodelle** (`string`) berechnen jeden Ton **vorab als Puffer in reinem JavaScript** (Karplus-Strong mit Erweiterungen) und spielen ihn als `AudioBufferSourceNode`: Web Audio kann Rückkopplungsschleifen nicht unter 128 Abtastwerten Verzögerung, das begrenzt eine Schleife in der Graphenwelt auf etwa 345 Hz. Die Berechnung ist eine **reine Funktion** ohne Browser (in Node testbar) und deterministisch (Rauschen aus `createRng`, abgeleitet von Ton und Reihenfolge, nicht `Math.random`). Bausteine: Anregung (Rauschstoß, gefiltert nach Plektrum oder Finger), Schleife aus Verzögerung mit Bruchteil-Interpolation (Stimmgenauigkeit), Verlustfilter (hohe Obertöne klingen schneller ab), Zupfposition (Kammfilter), Tonabnehmer-Position und -Filter (E-Gitarre, E-Bass), Korpus (Resonanzen der Akustik und des Kontrabasses). Die Varianten sind Parametersätze. Puffer werden nach (Variante, Ton, Anschlagstärke in Stufen, Reglerwerte) zwischengespeichert; die Berechnung darf den Planer nicht aufhalten (messen, Grenze für die Tonlänge setzen).

**Pegel:** jede Stimme wird gegen die Standardstimme desselben Instruments auf gleichen rms nachgemessen (Band 0,7 bis 1,4, wie bei der Verzerrerkette), damit `TRIM` und der Begrenzer unverändert passen.

## Was ohne Hören geprüft werden kann, was nicht

Prüfbar mit Tests: Stimmgenauigkeit der Saitenmodelle (Grundton innerhalb von 5 Cent über den ganzen Tonumfang, per Autokorrelation), Endlichkeit und Hörbarkeit über den Tonumfang und über alle Reglerextreme, Pegelband, Determinismus, Spitze unter der Grenze der Mischung, Live-Umschalten mitten im Spiel, Unterschied zwischen Stimmen und Varianten (diff, Spektralschwerpunkt), dass jeder in `uses` genannte Regler wirkt.
**Nicht prüfbar: ob es nach Gitarre klingt.** Darum zuerst eine **Hörprobe** der drei schwierigsten Stimmen (E-Gitarre clean, E-Bass, E-Piano) auf der Hörprobe-Seite (`/ui/render-harness.html`), bevor der Rest gebaut wird. Der Nutzer entscheidet nach Gehör, ob die Richtung stimmt, und bekommt die Klangfeinheiten in Runden nachjustiert.

## Vorgehen in zwei Phasen (Festlegung, Hörprobe ist ein harter Halt)

- **Phase A:** das Register samt `badVoice`, `voiceFor`, die Verdrahtung in `createInstruments`, `play` (`setVoices`) und den Offline-Render, der Baukasten für Saitenmodelle, und **nur die drei schwierigsten Stimmen**: `string` / `electric` (Akkorde), `string` / `finger` (Bass) und `epiano`. Dazu die Hörprobe-Seite `render-harness.html` mit Auswahl von Stimme und Variante je Instrument (heute hat sie nur Stil-Knöpfe). Dann **Halt und Bericht an den Nutzer**: Er hört, entscheidet, ob die Richtung stimmt, und nennt Korrekturen. Gemessene Werte (Stimmgenauigkeit, Pegel) stehen im Bericht, ob es nach Gitarre klingt, nicht.
- **Phase B** erst nach seiner Rückmeldung: die übrigen Stimmen und Varianten, die Oberfläche (Dropdowns, deaktivierte Regler), Dokumentation und die Gesamtprüfung.

## Schnittstelle (Festlegung)

`voices` wird wie `timbre` aufgelöst: `voiceFor(track, layer)` liefert je Instrument die gültige Stimme samt Variante, `play` und der Offline-Render (`renderOffline`, `compareRenders`) lesen sie aus `track.voices` und reichen sie an `createInstruments` weiter; Tests steuern Stimmen über `track.voices`. Eine Änderung während des Spiels geht nur über `setVoices(voices)`; `setTrack` ändert Stimmen **nicht** (wie bei `setTimbre`).

## Akzeptanz

1. Standardklang bitgleich: Pegel-Messwerte (`levels.spec.js`, `sound.spec.js`) und Golden-Tests unverändert grün; `voices` fehlend oder `synth`/`classic` ergibt dieselbe Ausgabe wie vorher.
2. Das Register ist konsistent (siehe oben) und `validateTrack` meldet `badVoice` für unbekannte Instrumente, Stimmen oder Varianten; `VALIDATION_CODES` nur additiv.
3. Jede Stimme und Variante: endliche, hörbare Ausgabe über den Tonumfang und die Reglerextreme, Pegel im Band, deterministisch.
4. Saitenmodelle: Grundton innerhalb von 5 Cent; Berechnung eines Akkords (4 bis 6 Töne) im Planer-Takt; Zwischenspeicher begrenzt.
5. Live-Umschalten mitten im Spiel ohne Neustart, ohne neuen `AudioContext`, ohne Knacken (Rampe oder Ausblenden der alten Stimme genügt: neue Töne starten sofort, alte klingen aus).
6. Oberfläche: Dropdown nach Art gruppiert, Variantenfeld nur wenn nötig, unbenutzte Regler deaktiviert, Tastatur, beide Sprachen ohne rohe Schlüssel, 360 px ohne waagerechtes Scrollen.
7. Dokumentation: `docs/interface.md` (Feld `voices`, Code `badVoice`, `setVoices`, wie man eine Stimme ergänzt), `README.md`.

## Was dem Bauenden überlassen bleibt

Die genauen Parameterwerte jeder Stimme, die Aufteilung der Dateien unter `src/audio/voices/`, Cache-Größen und Tonlängen-Grenze, wie ein Regler auf eine Stimme abgebildet wird (innerhalb von `uses`), der Aufbau der Ausblendung beim Umschalten, die Reihenfolge innerhalb der Gruppen, und alle Namen der Varianten in den Sprachdateien (der Nutzer liest sie gegen).

## Ausblick: Samples

Als eigene Art im selben Register (`kind: 'sample'`, `prepare` lädt asynchron). Zusätzlich nötig und bewusst **nicht** jetzt gebaut: ein Lade-Zustand in der Oberfläche (lädt, bereit, nicht verfügbar mit Größe), Quelle und Lizenz je Satz (bei CC-BY Pflicht), ein Rückfall auf die Synthese ohne Netz, Anschlagsarten für Akkorde (Strum, gedämpft) und die Frage, welche freie Bibliothek passt.
