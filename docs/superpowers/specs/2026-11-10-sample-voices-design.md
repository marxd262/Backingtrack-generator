# Sample-Stimmen aus MuseScore_General (Design)

Abgestimmt im Chat am 2026-11-10. Folgt auf `2026-11-09-instrument-voices-design.md` (Register, Stimmenwahl, Hörprobe): Die Modell-Stimmen aus Phase A lassen sich nur mit Feinabstimmung gut machen, der Nutzer will etwas, das **direkt gut klingt**. Darum Samples als nächste Stimmen-Art (`kind: 'sample'`, im Register schon vorgesehen).

## Absicht und Warum

Bass, Akkorde und Pad klingen mit dem Synth und den Saitenmodellen nicht nach Instrument. Echte Aufnahmen lösen das ohne Abstimmung. Erste Stufe: **ein Soundfont mit klarer Lizenz** (MuseScore_General, MIT; Samples größtenteils aus FluidR3, ebenfalls MIT), daraus nur die benötigten Instrumente. Bessere Einzelquellen (zum Beispiel Freepats-Gitarre CC0, Karoryfer-Bass nach Lizenzprüfung) können später je Instrument folgen: Sie sind weitere Packs im selben Format.

## Ziele

1. **Packs** statt der 40-MB-Datei: ein Entwicklerskript (`scripts/extract-samples.mjs`) liest eine `.sf3` und schreibt je Instrument ein Pack nach `src/assets/samples/`: `<name>.json` (Zonen: Tastenbereich, Anschlagbereich, Grundton, Feinstimmung, Schleife, Dämpfung, Hüllkurve, Sample-Verweis) und `<name>.pcm` (16-Bit-Mono, die Samples hintereinander in ihrer Originalabtastrate). PCM statt Ogg, damit es in jedem Browser ohne Codec-Frage läuft (gemessen: 13,5 MB für sieben Presets, einzeln 0,35 bis 5,3 MB). Zum Umwandeln dient `ffmpeg` auf dem Entwicklungsrechner; die gebauten Packs liegen im Repository, zur Laufzeit ist nichts davon nötig.
2. **Instrumente (Annahme, General-MIDI-Programme):** Bass `finger` (33 Fingered Bass) und `pick` (34 Picked Bass); Akkorde `guitar` (27 Clean Guitar) und `epiano` (4 Tine Electric Piano); Pad `strings` (48 Strings Fast) und `warm` (89 Warm Pad). Register: Stimme `sample` mit diesen Varianten je Instrument, Art `sample`.
3. **Sampler** (`src/audio/voices/sampler.js`, `sample.js`): je Note die passende Zone nach Ton und Anschlag, Abspielgeschwindigkeit aus Grundton und Feinstimmung, Schleife wo die Zone sie hat, Hüllkurve (Einsatz, Abklingen, Ausklingen am Notenende). Pegel je Pack gegen den klassischen Synth angeglichen (Band 0,7 bis 1,4 des rms).
4. **Laden:** Packs werden erst geladen, wenn eine Sample-Stimme gewählt ist (`fetch`), einmal je Seite zwischengespeichert. **Bis sie bereit sind, spielt der klassische Synth** (kein Aussetzer, kein Fehler); bei einem Ladefehler bleibt es beim Synth. `createInstruments` bekommt `whenReady()` (Promise, wartet auf alle gewählten Packs) und `voiceStatus()` (`ready` | `loading` | `error` | `none` je Instrument). Der Offline-Render (`renderOffline`, `compareRenders`, `renderNote`) wartet auf `whenReady`, damit Tests und Analyse die Samples hören.
5. **Klangregler** (soweit sinnvoll, im Register unter `uses`): Bass `bass.cutoff`; Akkorde `chords.brightness`, `chords.length`; Pad `pad.attack`, `pad.cutoff`. Helligkeit als Tiefpass (ab Mitte 0,5 durchsichtig, darunter dunkler), Länge und Einsatz als Faktor auf Hüllkurvenzeiten. Die Verzerrerkette wirkt wie bei jeder Stimme.
6. **Gitarrenakkorde:** Einzeltöne mit leichter Staffelung (Strum, wie bei der Saitenstimme, Feinwert `strum`).
7. **Hörprobe-Seite:** die Sample-Stimmen erscheinen dort automatisch (aus dem Register), mit Anzeige des Lade-Zustands; die Seite wartet bei "Ton anspielen" auf das Laden.
8. **Quellenangabe und Lizenz:** `src/assets/samples/LICENSE-MuseScore_General.md` enthält den Wortlaut der Lizenz und der Urhebervermerke (Pflicht der MIT-Lizenz: "The acknowledgements and copyright notices above must be included in any derivative work"); `README.md` und `docs/interface.md` nennen die Quelle.

## Nicht-Ziele (diese Stufe)

- **Die Oberfläche der Hauptseite** (Dropdowns Stimme/Variante, Lade-Zustand, deaktivierte Regler) folgt als zweite Stufe nach der Hörprobe; hier genügt die Hörprobe-Seite.
- Weitere Instrumente (Fretless, Palm Mute, Overdrive-Gitarre, FM-Piano), eigene Aufnahmen, Samples mit mehreren Anschlagsebenen jenseits dessen, was die Presets mitbringen, Filter und Modulation der Zonen (`initialFilterFc`, LFO), Panning, Stereo.
- Entfernen der Modell-Stimmen aus Phase A (sie bleiben, bis der Nutzer entscheidet).
- Eine Samples-Bibliothek von Fremdanbietern als Abhängigkeit: das Skript und der Sampler sind eigener, kleiner Code.

## Anti-Ziele

- Der Standardklang ändert sich (Graph, Pegel): `voices` fehlt oder `synth/classic` bleibt bitgleich, die Pegel-Messwerte bleiben grün.
- Ein hörbarer Aussetzer oder ein Fehler beim Wechsel auf eine Sample-Stimme, solange das Pack lädt oder wenn das Laden scheitert.
- Knacken am Notenende (Hüllkurve nicht sauber), an Schleifenpunkten oder bei sehr kurzen und sehr langen Noten; falsche Tonhöhe an den Rändern des Tonumfangs (Bass MIDI 28 bis 52, Akkorde und Pad 24 bis 100: außerhalb der Zonen wird zur nächsten Zone verschoben, Grenze pro Zone für Verschiebung dokumentieren).
- Packs, die zusammen mehr als etwa 15 MB ausmachen, oder ein Laden aller Packs beim Seitenstart.
- Die Lizenzvermerke fehlen.

## Annahmen und Grenzen

- General-MIDI-Qualität: für "klingt direkt gut" gedacht, nicht Studioqualität. Gitarre und Bass haben nur das, was FluidR3 hergibt (gemessen: Clean Guitar 10 Samples, 9 Anschlagsebenen; Fingered Bass 9 Samples).
- Hüllkurven und Dämpfung kommen aus den Presets, sind aber nur grob übernommen (Einsatz, Abklingen, Ausklingen). Das Ergebnis wird in der Hörprobe beurteilt und über Tunables (`level`, `strum`) nachgestellt.
- ffmpeg wird nur zum Bauen der Packs gebraucht und ist dafür Voraussetzung auf dem Entwicklungsrechner.

## Stand der Umsetzung (Stufe 1)

Gebaut: Packs und Skript, Zonenwahl, Sampler und Sample-Stimme mit Laden und Rückfall, `whenReady`/`voiceStatus`, Hörprobe-Seite mit Gruppen und Ladezustand, Doku und Lizenzvermerk. Abweichungen und Ergänzungen gegenüber dem Plan:
- `strum` gibt es nur bei der Gitarre (E-Piano-Akkorde werden gleichzeitig angeschlagen).
- Neuer Feinwert `decay` (Sekunden bis -60 dB) für Bass, Gitarre und E-Piano: Das Spektrogramm zeigte, dass die Presets ihren Schleifenton fast ohne Abfall halten; bei langen Noten klänge das wie eine Orgel.
- Fehlende Hüllkurvenzeiten gelten im SoundFont als "sofort" (-12000 Timecents); der erste Entwurf des Lesers hatte sie als 1 s gelesen.
- Die Pegel sind gemessen auf 0,99 bis 1,01 des klassischen Synths angeglichen.
- Stufe 2 (Dropdowns in der Hauptoberfläche) folgt nach der Hörprobe.
- Die GM-Samples sind von Haus aus bis etwa 10 Cent verstimmt (gemessen an den Roh-Samples; die Feinstimmung der Zonen ist schon eingerechnet). Eine automatische Nachstimmung beim Bauen der Packs ist möglich, wurde aber nicht gebaut, weil die Messung bei tiefen Tönen selbst um einige Cent streut.
- `pitchCents` (analysis.js) misst mit einem Fenster von mindestens 8 Perioden und 100 ms: ein kürzeres ließ den zweiten Oberton eines Basses in die Phase des Grundtons lecken (gemessen: bis 17 Cent Fehler).
- Rückmeldung nach der ersten Hörprobe: Die Sample-Gitarre klang "viel zu nasal". Messung (volle FFT, dB relativ zu 317 bis 635 Hz): 1,6 bis 3,2 kHz bei +2 bis 0 dB, Synth bei -10 bis -23, Saitenmodell bei -19 bis -35. Abhilfe: Entzerrer als Feinwerte (Tiefen +9 dB, Mitten -12 dB bei 2,4 kHz, Höhen -10 dB ab 2,6 kHz, Hochpass 50 Hz), danach -12 bis -16 dB und Spektralschwerpunkt 1500 statt 2320 Hz. Nach Gehör weiter abstimmbar.

## Stufe 2: Stimmenwahl in der Hauptoberfläche

Gebaut nach der Hörprobe, mit den aktuellen Klangwerten (Feinabstimmung folgt später). In den Klanggruppen **Bass**, **Akkorde** und **Pad** (linke Leiste) steht ganz oben ein Dropdown **Stimme**, nach Art gruppiert (`optgroup`: Synthese, Saitenmodell, Samples, nur die Gruppen, die es für das Instrument gibt), und, nur wenn die gewählte Stimme mehrere Varianten hat, ein Dropdown **Variante**. Bei Sample-Stimmen steht daneben der Ladezustand (lädt, bereit, nicht verfügbar; `aria-live`). Die Wahl steht in `state.track.voices` (das Track-Feld), wirkt live über `player.setVoices` und überlebt einen Stilwechsel (Stile setzen keine Stimme). Regler, die die gewählte Stimme nicht benutzt (Liste `uses` im Register; Fuzz, Overdrive und Distortion gelten immer), sind **deaktiviert**, dazu steht ein Hinweis unter dem Dropdown, solange es solche gibt. Bedienbar per Tastatur, beide Sprachen, 360 px ohne waagerechtes Scrollen. Der Standardzustand (Synth, klassisch) ändert nichts am bisherigen Verhalten.
