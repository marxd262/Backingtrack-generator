# Machbarkeitstest: Ergebnisse je Schritt

Laufendes Protokoll mit Messwerten; Grundlage für `MACHBARKEIT_JUCE.md` (Schritt 7). Rechner: Ryzen 7 9800X3D, Windows 11, Visual Studio 2026 (MSVC 19.52), CMake 4.3.1.

## Schritt 1 – Gerüst (2026-11-16)

- JUCE 9.0.5 per FetchContent (Archiv 25 MB, fester Hash). Erster Build 86 s, Folge-Build ohne Änderung 3,5 s, EXE 10,2 MB (statisch gebunden).
- CI (`.github/workflows/native.yml`): Windows, Ubuntu 24.04 und macOS grün beim ersten Lauf.
- Kern ohne JUCE baut allein (`-DBTG_BUILD_APP=OFF`), Tests ohne Test-Bibliothek.
- Start mit einem Doppelklick: `native\start.cmd`.

## Schritt 2 – Oberfläche in der WebView (2026-11-16)

Aufbau: Die App liefert `src/` unverändert über den Ressourcen-Anbieter von JUCE aus (WebView2) und ersetzt zwei Dateien durch eigene Fassungen aus `native/app/web/`: `audio/play.js` (121 Zeilen: gleicher Vertrag, aber Uhr und Klang kommen aus der Engine) und `audio/load-voices.js` (3 Zeilen: die UI lädt keine Samples). Die Engine ist in diesem Schritt ein Transport mit Metronom-Klick; Schlagzeug und Bass folgen in Schritt 4.

Brücke: UI → Engine als Nachrichten (`play`, `stop`, `tempo`, `master`), Engine → UI 30-mal je Sekunde (`beats`, `bpm`, `playing`, `peak`); die UI rechnet die Position dazwischen weiter.

Gemessen mit `node native/tools/ui-check.mjs` (Playwright am Debug-Port der WebView2 in der echten App):

| Messung | Wert |
|---|---|
| Laden der Oberfläche | 97 Anfragen, 0 Fehler in der Konsole, 0 fehlgeschlagene Anfragen |
| Bildrate der Anzeige bei laufender Wiedergabe | 166 Bilder je Sekunde (Bildwiederholrate des Monitors) |
| Position: Tempo laut UI 100 und 140 bpm, von der Engine gemeldet | 100,1 und 140,4 bpm |
| Position: Fehler der weitergerechneten Anzeige | im Mittel 4,7 ms, höchstens 7,9 ms (ein Audiopuffer hat 10 ms) |
| Master-Fader 100 % → 50 % | Spitzenpegel 0,24 → 0,06 (Faktor 0,25, wie im Web: Quadrat) |
| Pegelanzeige Master im Mixer | leuchtet (bis 70 % der Skala beim Klick) |
| `localStorage` | bleibt erhalten (Mischung, Sitzung, Layout) |
| Datei-Download und Zwischenablage (Profil-Fenster) | funktionieren technisch |

**Läuft unverändert:** die ganze Oberfläche aus `src/ui` samt `src/core` und `src/i18n`: Startseite, Rack, Griffbrett, Akkordkreis, Form und Spuren, Mixer, Schlagworte, Lichter der Schichten, Takt- und Akkordanzeige, Countdown, Variantenwechsel, Tempo live, Sprachwahl. ES-Module, Canvas, Schriften und gespeicherte Einstellungen brauchen keine Anpassung.

**Bricht nicht, wirkt aber noch nicht** (die Engine hat noch keine Schichten): Fader, Pan und Stummschalten je Schicht, Klangknöpfe, Stimmenwahl, Orgel-Regler; die Pegelanzeigen der Schichten bleiben dunkel.

**Müsste für den Vollport angepasst werden:**

1. `voices-panel.js` lädt beim Wählen einer Stimme weiter das Sample-Pack in die WebView (doppelter Speicher). Es soll den Ladezustand bei der Engine erfragen.
2. Richtung Engine → UI für Parameter fehlt: Die Regler der UI kennen nur ihren eigenen Zustand (`state.js`). Für DAW-Automation und Presets muss der Zustand an die Parameter des AudioProcessors gebunden werden.
3. Die Ereignisse für Lichter und Taktanzeige rechnet in diesem Schritt noch der JavaScript-Generator in der WebView. Nach dem Port liefert sie die Engine.
4. Die Webdateien werden vom Quellordner des Build-Rechners gelesen. Für eine Auslieferung müssen sie eingebettet oder mitinstalliert werden.
5. Die Ausgabelatenz ist in der Anzeige nicht ausgeglichen (wie im Web: Anzeige etwa 20 bis 30 ms vor dem Ton).
6. Das Fenster hat oben die Leiste der JUCE-Standalone-Hülle („Options“). Für das Produkt braucht es ein eigenes Fenster mit den Audio-Einstellungen in der Oberfläche.
7. `render-harness.html` und `spectrogram.html` (Entwicklerseiten mit Web Audio) sind nicht eingebunden.

Nicht geprüft: Profil-Export und -Import über die echten Knöpfe, Bedienung per Tastatur und Vorleser, Verhalten bei 125/150 % Windows-Skalierung.

**Unter Linux (WebKitGTK) später zu prüfen:**

- Die Oberfläche nutzt CSS Anchor Positioning (12 Stellen), die Popover-API, `:has()`, `color-mix()` und `checkVisibility()`. Chromium kann alles; WebKitGTK erst in neuen Versionen, und welche Version läuft, bestimmt die Distribution.
- Die Seite kommt dort über das eigene Schema `juce://juce.backend/` statt `https://`. Zu prüfen: `localStorage`, Zwischenablage (braucht einen sicheren Kontext), ES-Module und Schriften.
- Aussehen der Bedienelemente: Fader sind senkrechte `range`-Eingaben (`writing-mode`), Drehknöpfe liegen über nativen `range`-Eingaben.
- Tempo der Canvas-Anzeigen (Griffbrett, Spuren) ohne GPU-Beschleunigung.
- JUCE bettet WebKitGTK über einen eigenen Kindprozess und X11 ein: Fokus, Tastatur, Skalierung und Wayland prüfen.
- Die automatische Prüfung (`ui-check.mjs`) hängt am Debug-Port von Chromium und läuft dort nicht.

## Schritt 3 – Generator-Ausschnitt in C++ mit Gleichheitsprüfung (2026-11-17)

Portiert in den Kern (`native/core/src/generator.cpp`, `articulation.cpp`, 1165 Zeilen C++): der ganze Weg von `buildEvents` für die Schichten **Schlagzeug und Bass**, für alle 9 Stile und alle 9 Grooves: Schlagworte, Komplexität, Variante (`variety`), Arrangement ohne Form, Songform (Teile, Phrasen, Dichte, Pegel, Fill, Wirbel, Stopp, Pausen, Crash), Artikulationen (Regelgruppen `drums`, `bass`, `drumsB`, `bassB` samt Band-Regeln) und Mikrotiming. Die Groove-Muster stehen nicht von Hand im C++: `native/tools/export-events.mjs --data` schreibt sie aus `port-base` nach `native/core/data/grooves.json`, CMake bettet die Datei ein.

Nicht portiert: Akkorde, Pad, Lead, Percussion mit ihren Regeln, Prüfung und Auffüllen des Tracks (`validateTrack`, `normalizeTrack`), das Würfeln der Form (`rollForm`). Der Kern bekommt den Track deshalb so, wie `normalizeTrack` ihn schreibt.

Gleichheitsprüfung (`ctest`, Tests `parity_export` und `parity`): Node entpackt `port-base` in den Build-Ordner, erzeugt 387 Tracks samt Ereignissen (je Stil 20 gewürfelte Formen, 8 ohne Form mit den Reglern an den Enden, 3 handgebaute Formen mit allen Übergängen, andere Stimmen, einzelne Schichten; dazu jeder Groove in jeder Taktart und Takte mit abweichender Länge), der C++-Test vergleicht jedes Feld jedes Ereignisses.

| Messung (Windows, MSVC 19.52) | Wert |
|---|---|
| Tracks | 387, davon 387 bitgleich |
| Ereignisse | 271 052, davon 271 052 identisch (100 %), 0 innerhalb der Toleranz, 0 abweichend |
| Abweichungen | keine: Zufall (mulberry32, FNV-1a), Rundung und Sortierung stimmen beim ersten Lauf |
| Laufzeit | Export 1,2 s, Vergleich samt Erzeugen aller 387 Tracks 1,1 s |

Der Test schlägt bei Änderungen an: geprüft mit vier absichtlich veränderten Vergleichsdaten (Anschlag um 0,001, Zeit um 1e-6, Artikulation, fehlendes Ereignis), alle vier gemeldet.

Worauf der Port achten musste: `Math.round` rundet Hälften nach oben (auch unter null), `std::round` von null weg; die Sortierung muss stabil sein; die Reihenfolge der Schlagworte im Track bestimmt die Reihenfolge der Summen; Zufallsziehungen hinter `&&` und `||` fallen nur, wenn die linke Seite es zulässt; ohne Form zählen alle Abschnitte als Wiederholung derselben Art (der Schlüssel ist dann `undefined`); der Compiler darf Multiplikation und Addition nicht verschmelzen (`-ffp-contract=off`).

Aufwand für den vollständigen Generator (Schätzung): Der Ausschnitt deckt etwa die Hälfte der Generator-Logik (rund 1100 von 2300 Zeilen JavaScript ohne Profile und Oberflächen-Helfer). Mit dem vorhandenen Prüfstand: Akkorde, Pad, Lead, Percussion und ihre Regeln 1,5 Tage, Prüfung und Auffüllen des Tracks, Würfeln der Form, Akkordfolgen und Stimmen-Register 1 Tag, Klangmodell aus Schlagworten (`timbre.js`) 0,5 Tage. Zusammen etwa 3 Arbeitstage.

## Schritt 4 – Audio-Engine, Transport, Reaktionszeit (2026-11-17)

Im Kern, ohne JUCE: `pack.cpp` liest beide Pack-Formate (Format 2 mit dr_flac), `engine.cpp` spielt die Ereignisse des portierten Generators, `transport.h` ist der eigene Zeitgeber (Start, Stopp, Tempo, Springen, Schleife), `btg_render` rendert offline nach WAV. Die Engine bekommt ihre Position von außen (`Transport::Block`); dieselbe Engine läuft unter dem Transport der App, im Offline-Render und später am Zeitgeber einer DAW.

- **Sampler** nach `docs/PACK_FORMAT.md` und `sampler.js`: Zonenwahl, Round-Robin, Anschlagkurve der Library, Raum-Mikrofon, Choke-Listen, Selbst-Choke (Crash vor dem Stopp), Hüllkurve wie SoundFont 2, Schleife, zusätzliches Abklingen, Tiefpass nach Anschlag, Zufall je Anschlag (Tonhöhe, Lautstärke). Gerechnete Artikulationen des Basses: kurz, Dead Note, Palm Mute, Hammer-on/Pull-off, Slide in den Ton, Abrutschen am Ende.
- **Packs:** `drums-naked` (Format 2, stereo, 90 Zonen) und `bass-finger` (Format 1), mit den Feinwerten ihrer Stimmen. Fest gewählt, unabhängig vom Stil.
- **Mischung:** Fader (Quadrat), Stumm, Pan und Pegelanzeige je Schicht, Pegel der Schichten wie im Web (0,65 und 0,24), Summe mit Begrenzer.
- **Effekt:** Zerre auf dem Bass, live; gesteuert vom vorhandenen Knopf „Overdrive“ im Bass-Modul der Oberfläche.
- **Oberfläche:** `play.js` der App übergibt den Track an die Engine (sie erzeugt die Ereignisse selbst in C++) und reicht Pegel, Stumm, Pan, Tempo und Klang weiter. Eine Testleiste über der Oberfläche hat Tasten für Springen (4 Takte zurück, vor) und Schleife (4 Takte) und zeigt die Messwerte.

Gemessen in der echten App mit `node native/tools/ui-check.mjs` (Ausgang: Focusrite USB, WASAPI geteilt, 48 kHz):

| Messung | Wert |
|---|---|
| Puffergrößen, die das Gerät im geteilten Betrieb anbietet | nur 480 Frames (10 ms); andere Größen ließen sich deshalb nicht messen |
| Aussetzer während der Prüfung (rund 40 s Wiedergabe) | 0 |
| Rechenlast der Engine | 0,6 bis 1,1 % der Zeit eines Puffers |
| Offline-Render | 57,8 s Musik in 0,43 s (samt Laden der Packs) |
| Tempo live 100 → 140 bpm | gemessen 139,8 bpm |
| Springen auf Schlag 64 | Engine dort, Oberfläche zeigt Takt 17 |
| Schleife über Schlag 64 bis 72 | Position bleibt zwischen 64,00 und 71,93 |
| Fader Schlagzeug auf 0 | Pegel Schlagzeug 0, Bass spielt weiter |
| Fehler in der Konsole der Oberfläche | 0 |

**Reaktionszeit** eines Reglers bis zum Ton. Die Teilzeiten sind gemessen, die Summe ist gerechnet; akustisch (mit Mikrofon oder Mitschnitt) ist nichts gemessen.

| Abschnitt | nativ | Web-Version auf demselben Rechner (WebView2) |
|---|---|---|
| Knopf der Oberfläche bis die Nachricht die Seite verlässt | 0,1 ms | – |
| Seite bis App (halbe Ping-Runde) | 0,14 ms | – |
| Warten auf den nächsten Audioblock | 0 bis 10 ms; im Mittel 5,2 und 8,5 ms (zwei Läufe), höchstens 9,7 ms | höchstens 2,7 ms |
| Glättung des Reglers | Zeitkonstante 5 ms (Zerre), 20 ms (Pegel) | 20 ms |
| Vorlauf des Begrenzers | 6 ms | 6 ms |
| Ausgabe, wie das System sie meldet | 10 ms | 82 ms (`baseLatency` 10 + `outputLatency` 72) |
| **Effekt-Regler, Summe** | **etwa 25 bis 30 ms** | **etwa 95 ms** |
| **Neue Ereignisse** (Verzierungen, Muster, Schlagwort) | Ereignisse bauen 5,2 ms, nächster Block im Mittel 3,5 ms: das nächste Ereignis ist schon das neue | erst nach der Vorausschau von 100 ms (plus Planertakt 25 ms) |

Die beiden gemeldeten Ausgabelatenzen stammen aus verschiedenen Schnittstellen (JUCE fragt WASAPI, der Browser schätzt den ganzen Weg) und sind nur bedingt vergleichbar. Belastbar ist der Teil davor: nativ höchstens ein Puffer (10 ms), im Web 100 ms Vorausschau für alles, was Ereignisse ändert. Die Leslie-Umschaltung ist nicht messbar, weil die Orgel nicht portiert ist; sie wäre ein Regler wie die Zerre.

**A/B-Paar** (`node native/tools/render-ab.mjs`, Funk, Seed 3, Form Intro/Strophe/Refrain/Outro, 57,8 s, nur Schlagzeug und Bass): `.superpowers/audio-ab/native4.html` mit `native4-A-web.wav` und `native4-B-native.wav`.

| | Web (A) | nativ (B) |
|---|---|---|
| Lautheit (RMS) | −18,7 dBFS | −18,7 dBFS |
| Spitze | −2,6 dBFS | −1,6 dBFS |
| Spitze zu RMS | 16,1 dB | 17,1 dB |
| Helligkeit (Spektralschwerpunkt, Sekunde 10 bis 40) | 3263 Hz | 3269 Hz |

**Was am Klang noch abweicht** (im Code als `shortcut:` markiert):

1. Der Begrenzer ist eine Näherung (Spitzenfolger mit 6 ms Vorlauf, Einsatz 0,1 ms), nicht der Kompressor des Browsers. Daher die um 1 dB höheren Spitzen.
2. Der gemeinsame Raum (Faltungshall), der Hall und das Echo der Summe fehlen. Im Web-Render sind sie an.
3. Slides beginnen mit der Note; im Web beginnen sie vorher, damit der Zielton pünktlich kommt.
4. Schlagzeug nur aus Format-2-Kits; die älteren Kits (Format 1) bräuchten die GM-Tabelle und ihre eigene Choke-Regel.
5. Der Bass spielt immer das Finger-Pack, auch wenn der Stil den Pick-Bass wählt.

**Offen für den Vollport:** die übrigen Schichten und Stimmen (Synths, Orgel mit Leslie, FM-E-Piano, Saitenmodell), die Verzerrerketten, Echo und Hall, Klangregler je Schicht, Parameter der Schichten als automatisierbare Parameter.

**Urteil des Nutzers zu Schritt 4 (2026-11-17):** „Web und nativ klingen exakt gleich. Ich höre keinen Unterschied.“ (A/B-Paar `native4`, Schlagzeug und Bass.) Auf Wunsch hat das Fenster jetzt einen Maximieren-Knopf (`PluginEditor.cpp`, `parentHierarchyChanged`); geprüft am echten Fenster: maximiert füllt die Oberfläche den Bildschirm.

**Vorbereitung Schritt 5 (Labels der echten Tracks):** Vier Tracks liegen in `C:\dev\samples-raw\analysis-tests\` (MP3, 44,1 kHz, stereo, 8 bis 9,5 Minuten, Elevated Jam Tracks). Die Labels stammen aus den YouTube-Videos der Tracks (Entscheidung des Nutzers): `yt-dlp` lädt das Video in 480p, `native/tools/chord-frames.mjs` findet jeden Wechsel der Akkordanzeige (Feld „CURRENT“, viermal je Sekunde abgetastet) und schneidet nummerierte Bildblätter, vier günstige Subagenten (Haiku) lesen sie aus, ein Skript im Testordner fügt alles zur gleichnamigen `.json` zusammen. Geprüft: Jede gelesene Folge passt zur Akkordtabelle des Videos und zu den gemessenen Dauern; ein Blatt selbst angesehen.

| Track | Tonleiter laut Video | Tempo | Jam-Teil | Akkorde im Zeitverlauf | Akkordarten |
|---|---|---|---|---|---|
| Late Night Groove | G-Dorisch | 79 | 1:17 bis 6:14 | 114 | Gm, F, C, Bb |
| Losing Control | H-Äolisch | 84 | 1:09 bis 7:28 | 120 | B5, Gmaj7, Em, Bm, A, G |
| Letting Go | D-Äolisch | 76 | 0:54 bis 7:45 | 168 | Bb, C, Dm, Gm11, Bbsus2 |
| Before The Dawn | D-Dorisch | 102 | 1:12 bis 7:15 | 127 | Dsus2, F, C, G |

Label-Format (`LIESMICH-labels.txt` im Testordner): `key`, `scale`, `bpm`, `meter`, `parts` (Intro, Jam, Solo mit Zeiten aus den Kapiteln des Videos), `chart` (Akkordtabelle je Sektion) und `chords` (Zeitverlauf `{t, chord}` im Jam-Teil, auf 0,25 s genau). Im Solo zeigt das Video keine Akkorde, dort gibt es keine Labels. Zwei der vier Titel sagen „Minor“, das Video nennt Dorisch: ein Test für den Tonleiter-Vorschlag. Videos, Bilder und Labels bleiben außerhalb des Repos.

## Schritt 5 – Eigene Backingtracks laden und analysieren (2026-11-17)

**Aufbau.** Im Kern, ohne JUCE: `analysis.cpp` (Analyse der ganzen Datei), `file_player.h` (spielt die geladene Datei am Transport: ein Schlag des Transports ist eine Sekunde des Tracks, Springen und Schleife gelten also auch hier). Neu `native/platform/`: eine Schnittstelle (`btg_platform/system_audio.h`) für das, was nur das Betriebssystem kann, mit `win/` (WASAPI-Loopback, Media Foundation) und `other/` (Platzhalter, meldet „nicht verfügbar“; Linux baut damit). In der App: Laden und Analyse in einem Hintergrund-Thread mit Fortschritt, eine eigene Seite `native/app/web/track.html` für die Anzeige, erreichbar über die Taste „Eigener Track“ in der Testleiste.

**Analyse (bewusst einfach).** Spektren mit 4096 Punkten bei halber Abtastrate; Einsatzstärke aus dem Zuwachs der Spektren; Tempo aus deren Wiederholung (Autokorrelation mit Vorliebe um 105 bpm); Schläge per dynamischer Programmierung (Ellis 2007); Chroma je Schlag aus den Spektralspitzen, dazu ein Bass-Chroma für den Grundton; 24 Dur- und Moll-Dreiklänge als Vorlagen, geglättet mit Viterbi; Takt 1 dort, wo die meisten Akkordwechsel liegen; Tonart als die Leiter (Dur, Moll, Dorisch), deren Akkorde die meiste Zeit abdecken, mit Gewicht auf dem Akkord der ersten Stufe; Tonleiter-Vorschlag in den Namen der App. 4/4 ist angenommen.

**Dateiformate** (je eine Minute, in der echten App geladen, `node native/tools/track-check.mjs`):

| Format | Lädt | Dekodieren | Weg |
|---|---|---|---|
| WAV, AIFF | ja | 10 ms | JUCE |
| FLAC | ja | 93 ms | JUCE |
| MP3 | ja | 73 ms | JUCE |
| Ogg Vorbis | ja | 53 ms | JUCE |
| WMA | ja | 61 ms | JUCE über Windows Media |
| M4A/AAC | ja | 108 ms | **nicht über JUCE**, sondern über Media Foundation hinter der Systemschnittstelle |
| kaputte Datei | nein | – | Meldung „Diese Datei kann nicht gelesen werden.“ |

**Zeiten für einen ganzen Track** (8:01, MP3): Dekodieren 0,49 s, Analyse 1,31 s, zusammen 1,9 s bis zur Anzeige, 53 Fortschrittsmeldungen. Speicher: der ganze Track liegt als Float im Speicher (rund 200 MB für zehn Minuten stereo; im Code als Abkürzung markiert).

**Anzeige und Bedienung** (gemessen in der App): Die Wiedergabe läuft mit 1,000 Sekunden je Sekunde; der angezeigte Akkord stimmte in 20 von 20 Stichproben mit dem Analyseergebnis zur Abspielzeit überein; dazu der nächste Akkord mit „in N Schlägen“, Takt und Schlag, Zeit, und ein Raster aller Takte (aktueller Takt pink, nächster Wechsel türkis). Klick auf einen Takt springt dorthin (Takt 21 bei 1:01, Engine danach bei 61,7 s). Korrekturen: Akkord eines Takts ändern (bleibt nach dem Neuladen der Seite erhalten, gespeichert je Datei) und Takt 1 um einen Schlag verschieben (die Takte gruppieren sich neu); „Korrekturen verwerfen“ stellt den Stand der Analyse wieder her. Das Datenmodell ist das Analyseergebnis plus `{ shift, edits }`.

**Trefferquoten** (`node native/tools/analysis-score.mjs <Ordner>`; gewertet wird der Teil mit Labels, alle 0,1 s):

| | generiert (18 Tracks, volle Band aus dem Web-Generator, je 16 Takte) | echt (4 Tracks, Jam-Teil, zusammen 24 Minuten) |
|---|---|---|
| Tempo (±4 %) | 14 von 18; die vier Fehler sind halbes Tempo bei 148 und 172 bpm | 4 von 4 (76, 79, 84, 102 bpm) |
| Tonart, Grundton | 16 von 18 | 4 von 4 |
| Tonart mit Modus (Dur, Moll, Dorisch) | 15 von 18 | 4 von 4, darunter beide dorischen |
| Tonleiter-Vorschlag | 15 von 18 | 4 von 4 |
| Akkord: Grundton richtig | 87 % der Zeit | 88 % (81 bis 92 %) |
| Akkord: Dur/Moll richtig | 83 % | 83 % (73 bis 91 %) |
| Takt 1: Akkordwechsel der Labels auf der gefundenen Eins | 83 % | 67 %; in allen vier Tracks liegt die Eins richtig, der Rest sind Wechsel auf Schlag 3 und vorgezogene Wechsel |
| Schläge gegen die Labels | 3 bis 26 ms zu früh | nicht messbar (die Anzeige im Video wechselt nicht taktgenau) |

Einordnung: Die echten Tracks sind günstige Fälle (klare Akkorde, kein Gesang, langsames bis mittleres Tempo). Die Fehler der generierten Tracks zeigen die Grenzen: schnelle Stücke werden mit halbem Tempo erkannt (Hardrock, Pop-Punk; dort fallen auch die Akkorde auf 40 bis 78 %), im Reggae liegt Takt 1 einmal einen Schlag daneben, Powerchords und sus-Akkorde haben keine Terz und werden nur am Grundton gewertet. Häufigster Akkordfehler bei den echten Tracks: die Durparallele statt des Mollakkords (Bb statt Gm). Das Solo am Ende der echten Tracks ist nicht gewertet, weil das Video dort keine Akkorde zeigt.

**„Zuhören statt Datei“ (nur Machbarkeit):** `btg_platform_probe loopback 32 out.wav` schneidet über WASAPI-Loopback mit, was das System gerade ausgibt (hier: derselbe Track aus einem anderen Programm, 48 kHz stereo, 32 s, −23 dBFS). Die Analyse des Mitschnitts findet 79 bpm und G-Dorisch und fast dieselbe Akkordfolge wie aus der Datei. Ein Video im Browser ließe sich also analysieren. Offen: Windows liefert keine Daten, solange nichts spielt; mitgeschnitten wird alles, was das System ausgibt (auch Systemklänge), ein einzelnes Programm bräuchte die Prozess-Loopback-Schnittstelle (ab Windows 10 2004); in der App ist der Mitschnitt nicht eingebaut.

**Unter Linux ungeprüft und offen:** Mitschnitt (PipeWire oder PulseAudio-Monitor) und M4A/AAC (FFmpeg oder GStreamer) sind nur Platzhalter; alles andere in diesem Schritt ist Kern oder JUCE und baut dort.

**Stand der CI:** Die Commits dieses Schritts sind lokal; sie laufen erst in der CI, wenn der Nutzer pusht.

## Schritt 6 – Quellentrennung: Vorprüfung statt Ausbau (2026-11-17)

Der Nutzer hat den Test nach Schritt 5 für bestanden erklärt und nach der besten Wahl für die Trennung und nach ihrem Nutzen für die Analyse gefragt. Gemessen wurde deshalb mit Demucs über Python (eigene Umgebung außerhalb des Repos, `C:\dev\samples-raw\tools\demucs-venv`), nichts davon ist im Kern oder in der App.

**Rechenzeit** (htdemucs, Track mit 8:01, RTX 4070 und Ryzen 7 9800X3D, jeweils samt Start, Laden und Schreiben der vier WAV-Dateien): Grafikkarte 13,0 s, CPU 72,3 s. Vier Tracks mit 8 bis 9,5 Minuten: je 14 bis 15 s auf der Grafikkarte.

**Nutzen für die Analyse** (`node native/tools/analysis-score.mjs <Ordner> --stems <Ordner>`; die Analyse nimmt wahlweise getrennte Quellen, `btg::Stems`):

| Verdrahtung | Grundton | Dur/Moll | Tonart mit Modus |
|---|---|---|---|
| ohne Stems (Mischung) | 88 % | 83 % | 4 von 4 |
| Schläge aus dem Schlagzeug, Grundton aus dem Bass, Akkorde aus „Rest“ | 88 % | 74 % | 1 von 4 |
| Schläge aus der Mischung, Grundton aus dem Bass, Akkorde aus allem außer Schlagzeug | 90 % | 78 % | 1 von 4 |
| Schläge aus dem Schlagzeug, Grundton aus dem Bass, Akkorde aus allem außer Schlagzeug | 89 % | 78 % | 1 von 4 |

Je Track: Late Night Groove gewinnt beim Grundton (81 → 85 bis 87 %), Losing Control verliert stark bei Dur/Moll (73 → 34 bis 48 %). Schluss: Mit der heutigen, auf die Mischung abgestimmten Analyse bringen Stems auf diesen klaren Tracks nichts; sie verschieben die Fehler. Neu messen, wenn die Analyse verbessert ist und dichtere Tracks (Gesang, volle Mischung) vorliegen.

**Lizenzen der Trennmodelle** (Recherche eines Subagenten, Stand 2026-11-17; Zitate aus den Quellen):

- Demucs: Code MIT. Gewichte: „The model weights are not covered by the MIT license, and are provided only for scientific purposes.“ (Autor, https://github.com/facebookresearch/demucs/issues/327); im README: „The license of the weights is not clear: MusDB contains some data that were only usable for research purpose.“ (https://github.com/adefossez/demucs). Die Variante mit sechs Spuren laut README vermutlich CC-BY-NC. **Nicht auslieferbar.**
- MUSDB18-HQ: nicht kommerziell (https://zenodo.org/records/3338373). Betrifft alle darauf trainierten Gewichte: Open-Unmix (umxl ausdrücklich CC BY-NC-SA), SCNet, Band-Split-Modelle, die meisten RoFormer-Gewichte (meist ohne Lizenzangabe).
- Spleeter (Deezer): Die Veröffentlichung nennt Code und vortrainierte Modelle MIT-lizenziert (https://raw.githubusercontent.com/deezer/spleeter/master/paper.md), trainiert auf eigenen Daten; im README steht dazu nichts, die Frage nach kommerzieller Nutzung ist seit 2024 unbeantwortet (https://github.com/deezer/spleeter/issues/898). Qualität etwa 5,9 dB SDR statt 8,8. Bester Kandidat für eine Auslieferung, wenn Deezer schriftlich bestätigt.
- C++ für Demucs gäbe es (sevagh/demucs.onnx, demucs.cpp, beide MIT); sie ändern an der Lizenz der Gewichte nichts.

**Stärkere Modelle für die Analyse** (Recherche eines Subagenten):

- Schläge und Takt: „Beat This!“ (CPJKU, 2024): „The code and the published model weights are released under the MIT license.“ (https://github.com/CPJKU/beat_this). Schlag/Takt-F-Maß auf GTZAN 89,1 / 78,3; kleines Modell 8 MB; ONNX und C++ erprobt (mosynthkey/beat_this_cpp, MIT). Trainiert auch auf geschützter Musik (laut README zu beachten).
- Akkorde: BTC, Jiang et al. (lv-chordia), CREMA, consonance-ACE, ChordMini: Repos MIT oder BSD, zu den Gewichten keine Aussage, trainiert auf geschützten Aufnahmen. Veröffentlicht 77 bis 80 % Dur/Moll und 65 bis 69 % mit Septakkorden; keines kennt add9, 9, 11 oder Powerchords.
- Ausgeschlossen: madmom-Modelle (CC BY-NC-SA), Essentia (AGPL, Modelle NC), Chordino/NNLS-Chroma-Plugin (GPL; der Algorithmus ist veröffentlicht und darf nachgebaut werden), aubio (GPL), S-KEY-Gewichte (nur Forschung), MERT und MuQ (NC).
- Frei nachbaubar: Stimmung schätzen, harmonisch-perkussive Trennung, NNLS-Chroma, Bass-Chroma, Vorlagen für mehr Akkordarten, Tonart-Kontext, Abstimmung über wiederholte Teile, Taktart aus Schlägen je Takt.

**Verteilung unter Windows, Zeitdehnung, Video:** Ergebnisse der dritten Recherche stehen in `MACHBARKEIT_JUCE.md` (Abschnitt 4) und `PLAN_NATIV.md` (Abschnitt 2).

Alle drei Recherchen stammen von Subagenten; von mir gegengeprüft ist davon nichts außer der Plausibilität. Vor einer Auslieferung sind die zitierten Stellen selbst zu lesen.

## Lauf ohne Rückfrage, 2026-11-17

### Backingtrack-Seite: Geschwindigkeit ohne Tonhöhenänderung

signalsmith-stretch (MIT, Commit `88061fd`, mit signalsmith-linear 0.6.6) im Datei-Abspieler des Kerns. Bei 100 % bleibt der bisherige Weg (lineare Interpolation, exakt); bei anderer Geschwindigkeit wird gedehnt. Der Abspieler füttert die Dehnung um ihre eigene Verzögerung voraus, damit Anzeige und Ton an derselben Stelle sind, und rollt sie bei Start, Sprung und Schleifenanfang vor.

| Messung | Wert |
|---|---|
| 440 Hz bei 75 % Geschwindigkeit | 440 Schwingungen je Sekunde (vorher 330) |
| Pegel 20 bis 70 ms nach dem Start | 0,359 (Ton: 0,354), also kein Loch |
| Rechenlast der Dehnung | 30 ms für 3 s Ton, 1 % eines Kerns |
| App, 75 % | 0,752 s Track je Sekunde, Anzeige 20/20 synchron, Schleife hält, 0 Fehler |

Nicht gemessen: Klangqualität der Dehnung an Musik (Schlagzeug-Anschläge verschmieren bei solchen Verfahren etwas); das muss der Nutzer hören.

### Labels der 14 neuen Tracks, Ausgangswert

18 echte Tracks mit Labels: 13 zum Optimieren, 5 unangetastet (Liste in `UEBERGABE.md`). Neun der neuen haben den Zeitverlauf aus dem Video, vier nur den Akkord-Kreis (wird vom Werkzeug über den Track gelegt), einer nur die Tonart.

| Messung, 13 Tracks zum Optimieren | Ausgangswert |
|---|---|
| Tempo | 9/12 (3/4-Track 100 statt 150; 170 und 172 bpm als halbes Tempo) |
| Schläge je Takt | 12/13 (3/4 nicht erkannt) |
| Tonart mit Modus | 12/13 (Bb-Dur als G-Moll) |
| Akkorde: Grundton / Dur-Moll | 92 % / 85 % |
| Akkordwechsel auf der Eins | 81 % (schwächste: 52 % und 56 %) |

### Schläge und Takte mit Beat This!

Erst mit dem Python-Original gemessen, dann in C++ nachgebaut (ONNX Runtime 1.30.1, Modell „final0“, 83 MB, per Download-Skript). Vor- und Nachverarbeitung sind selbst geschrieben; der Abgleich mit dem Original auf allen 18 Tracks: 99 bis 100 % der Schläge auf 20 ms gleich, schlechtester Track 97,4 %.

| 13 Tracks zum Optimieren | eigener Tracker | mit Beat This! |
|---|---|---|
| Tempo | 9/12 | 11/12 |
| Schläge je Takt | 12/13 | 12/13 (3/4 als 6) |
| Grundton / Dur-Moll | 92 % / 85 % | 92 % / 85 % |
| Akkordwechsel auf der Eins | 82 % | 82 % |
| Analysezeit je Track | 1 bis 1,5 s | 5 bis 11 s (9,4 s für 9:17 min in der App) |

- Richtig geworden: 170 und 172 bpm (vorher halbes Tempo), der 3/4-Track (150 statt 100), Comfortably Numb (63,5 statt 127; nicht in der Zählung, das Label nennt kein Tempo). Neu falsch: Letting Go (151 statt 76).
- Die Taktanfänge des Modells allein waren schlechter als die Abstimmung über Akkordwechsel (65 bis 70 % gegen 81 %), solange die Takte durchgezählt wurden. Gezählt ab dem jeweils letzten Taktanfang des Modells und mit der Abstimmung zusammen sind beide gleich gut.
- Die Messung „Wechsel auf der Eins“ zieht jetzt den Vorlauf der Video-Anzeige ab (je Video 40 bis 200 ms); ohne das zählten spätere Schläge als falsch.
- Das kleine Modell (10 MB, selbst umgewandelt) misst auf diesen Tracks gleich und rechnet 218 statt 352 ms je 30 s. Es hat keine öffentliche Adresse; für die Auslieferung wäre es die bessere Wahl.

### Akkorde: Vorsprung für die Akkorde der Tonart

Häufigster Fehler vorher: ein Moll-Akkord wird als Dur gehört (Am als A über 111 s, Em als E, Bm als B, Dm als D), vor allem bei verzerrten Gitarren, wo die Terz fehlt oder als Oberton der Dur-Terz mitklingt. Die Tonart stimmt trotzdem; deshalb bestimmt jetzt ein erster Durchgang die Tonart, und im zweiten bekommen ihre Akkorde einen Vorsprung.

| Vorsprung | echt: Grundton / Dur-Moll | generiert: Grundton / Dur-Moll |
|---|---|---|
| 0 (vorher) | 92 % / 85 % | 95 % / 91 % |
| 0,05 | 92 % / 89 % | 95 % / 95 % |
| **0,1** | 92 % / 91 % | 95 % / 94 % |
| 0,2 | 91 % / 91 % | 95 % / 94 % |

### Akkordarten und Oberton-Dämpfung

Die Analyse nennt die 17 Akkordarten der App. Erster Versuch ohne Dämpfung: Auf reinen Dreiklängen wurde fast die Hälfte der Zeit eine andere Art gemeldet, am häufigsten Dur als maj7 (150 von 465 s). Grund: Die Quinte über der Terz, als Oberton der Terz immer da, ist die große Septime des Akkords. Deshalb zählt ein Gipfel jetzt weniger, wenn bei einem Drittel (Stärke 0,6) oder Fünftel (0,3) seiner Frequenz auch ein Ton liegt.

| Satz | Grundton | Dur/Moll | Akkordart genau | Dreiklänge belassen | andere Arten erkannt |
|---|---|---|---|---|---|
| echt (13), vorher | 92 % | 91 % | 65 % | 71 % | 41 % |
| echt (13), jetzt | 93 % | 92 % | 73 % | 85 % | 41 % |
| generiert (18, nur Dreiklänge), vorher | 95 % | 94 % | 54 % | 54 % | – |
| generiert (18), jetzt | 97 % | 96 % | 92 % | 92 % | – |
| generiert-2 (18, neu), vorher | 91 % | 89 % | 54 % | 56 % | 44 % |
| generiert-2 (18), jetzt | 93 % | 93 % | 68 % | 91 % | 40 % |

- Schwelle für Septimen 0,65 statt 0,55: weniger falsche Septakkorde, etwas weniger erkannte. Bewusst vorsichtig.
- Die Labels der echten Tracks sind hier ungenau: Videos schreiben „Am“, wo die Band Am7 spielt, und „Dsus2“ oder „B5“, wo die App nur Moll oder Dur hört. Die Zahl „Akkordart genau“ ist deshalb auf echten Tracks eher eine Untergrenze.
- Schwach bleiben sus2, Powerchords (fast nie erkannt) und 6/9-Akkorde.
- Zweiter generierter Satz, Takt und Tempo: 3/4 bei 60 und 90 bpm richtig; 6/8 und 12/8 kommen als 6 schnelle Schläge (Tempo mal 3); 5/4 als 3 oder 2 Schläge; 3/4 bei 160 bpm und ein 4/4-Track mit offenen Akkorden mit falschem Tempo.

### Taktarten, Rückfall auf den eigenen Tracker, Tempo zählen

| Satz | Tempo vorher | Tempo jetzt | Taktart vorher | Taktart jetzt |
|---|---|---|---|---|
| echt (13) | 11/12 | 11/12 | 12/13 | 13/13 |
| generiert (18) | 16/18 | 18/18 | 17/18 | 18/18 |
| generiert-2 (18) | 14/18 | 17/18 | 12/18 | 14/18 |

- Modell gegen eigenen Tracker beim Tempo über alle 49 Tracks: 43 gegen 33 richtig. Wo das Modell falsch lag und es keine Oktave war, sprangen seine Schlagabstände: 11 bis 37 % Ausreißer gegen höchstens 8 % bei allen anderen. Über 10 % zählt deshalb der eigene Tracker.
- 5/4 liefert das Modell nicht (Taktanfänge alle 1 bis 4 Schläge). Die Taktlänge kommt dann daher, bei welcher Länge die Akkordwechsel zusammenfallen; beide 5/4-Tracks stimmen damit.
- Offen: 12/8 (als 6/8 oder 4/4 gemeldet, Tempo stimmt), 6/8 bei Tempo 180 (als 4/4), 3/4 bei 160 bpm (Tempo falsch), Letting Go (doppeltes Tempo). Für die Oktav-Frage gibt es auf der Seite „Tempo zählen ÷2 / ×2“; geprüft in der App: 151, 75, 302, zurück auf 151.

### Stimmung, und was nichts gebracht hat

Sechs generierte Tracks, wie ein Tonband schneller oder langsamer abgespielt (20 bis 50 Cent neben 440 Hz):

| | ohne Schätzung | mit Schätzung |
|---|---|---|
| Grundton | 59 % | 81 % |
| Tonart | 3/6 | 5/6 |
| geschätzte Abweichung | – | 17, −27, 31, −42, 48 Cent bei 20, −25, 35, −40, 50 |

Bei genau 50 Cent (Viertelton) gibt es zwei gleich richtige Lesarten; ein Track davon landet einen Halbton daneben. Die echten Tracks liegen innerhalb von 10 Cent, ihre Zahlen bleiben gleich.

Gemessen und verworfen:

- Bassgewicht 0,15 bis 0,8 und Wechselkosten in beide Richtungen: innerhalb eines Prozentpunkts, die bisherigen Werte bleiben.
- Jeden Schlag mit den Stellen mitteln, die samt Umgebung gleich klingen (Wiederholungen ausnutzen): bei jeder Schwelle schlechter (echt Dur/Moll 92 auf 88 %, bei lockerer Schwelle bis 76 %). Akkorde derselben Tonart klingen im Fenster zu ähnlich, das Mitteln verwischt sie.
- Sext-Akkord als Moll-Septakkord der Paralleltonart lesen: kein Gewinn.

### Video, Tempo unabhängig vom Format

- Videodateien laden: Ton über Media Foundation, Analyse wie bei jedem Track, das Bild läuft stumm mit. Gemessen in der App mit einer Testdatei (H.264/AAC, 854 mal 480, 9:30 min, 17 MB): Laden 1,2 s, Analyse 10 s, Bild 0,06 s neben dem Ton, Anzeige 20/20 synchron, Schleife 142,7 bis 154,1 s gehalten, 0 Fehler.
- Erst ausgeliefert als normale Antwort der App: Das Bild lief, sprang aber nicht an die Abspielstelle (129 s daneben), weil der Browser in einer Antwort ohne Teilabrufe nicht spulen kann. Jetzt holt die Seite die Datei ganz und spielt sie aus dem Speicher.
- Nicht geprüft: große Dateien (über 1 GB wird kein Bild gezeigt), andere Codecs als H.264, mkv und webm (deren Ton kann Media Foundation oft nicht).
- Dieselbe Musik als MP3 und als MP4: 150,9 gegen 134,8 bpm. Das Modell zählte im MP4 mehr Abschnitte im halben Tempo, und das Tempo kam aus dem Mittel über je acht Schläge. Jetzt: fehlende Schläge auffüllen, Tempo aus dem üblichen Abstand. Beide Fassungen: 151 und 152 bpm.

### Letzte Schleifen und Schlussmessung

| Änderung | Wirkung (nur an den Optimier-Sätzen gemessen) |
|---|---|
| Durchgangsakkorde gehen im Akkord davor auf | Blues-Track Grundton 86 auf 92 %; echt gesamt 93 auf 94 % |
| Sext-Akkord mit Bass auf der Mollparallele ist deren m7 | Late Night Groove 79 auf 85 % (Bb6 statt Gm7 war dort der einzige Fehler) |
| Bass zählt nach Stelle im Takt | generiert-2 Grundton 94 auf 95 %, sonst gleich |
| Zählen im Schlagabstand, der die meiste Zeit abdeckt | Tempo echt 11/12 auf 12/12; „Letting Go“ 76 statt 151 bpm und Takt für Takt wie das Akkordblatt |

Das Zeichen für die Tempo-Oktave: Bei den beiden Tracks mit doppelt gezähltem Tempo hatte das Modell selbst 57 % der Zeit im halben Tempo gezählt, bei allen anderen 47 höchstens 14 %.

**Stand an den Optimier-Sätzen** (echt 13 / generiert 18 / generiert-2 18): Tempo 12/12, 18/18, 17/18; Taktart 13/13, 18/18, 14/18; Tonart 12/13, 17/18, 17/18; Grundton 94, 98, 95 %; Dur/Moll 93, 98, 95 %; Akkordart genau 75, 92, 70 %; Wechsel auf der Eins 81, 99, 94 %.

**Schlussmessung, fünf unangetastete Tracks:**

| Track | Tempo | Taktart | Tonart | Grundton | Dur/Moll |
|---|---|---|---|---|---|
| Rock in G, 160 bpm (nur Akkord-Kreis) | richtig | richtig | richtig | 98 % | 98 % |
| Moll-Blues in A, 12/8, 60 bpm | richtig | 4/4 statt 12/8 | richtig | 95 % | 95 % |
| Morning Light in C, 66 bpm | 132 (doppelt) | richtig | richtig | 86 % | 86 % |
| Summer Days in E, 86 bpm, viele Alterationen | richtig | richtig | richtig | 79 % | 79 % |
| II-V-I in C, Swing, 120 bpm | richtig | richtig | D dorisch statt C-Dur | 69 % | 69 % |
| **gesamt** | **4/5** | **4/5** | **4/5** | **85 %** | **85 %** |

Mit dem eigenen Schlag-Tracker statt Beat This!: Tempo 2/5, Grundton 83 %, Wechsel auf der Eins 54 % statt 79 %. Die unangetasteten Tracks liegen rund neun Punkte unter den Optimier-Tracks; ein Teil davon ist Schwierigkeit (Swing mit laufendem Bass, alterierte Akkorde), ein Teil Anpassung an die Optimier-Tracks. Die erste Messung (vor den letzten beiden Regeln) ergab dieselben Summen; einzelne Tracks verschoben sich um bis zu fünf Punkte in beide Richtungen.

Robustheit, mit dem Analyse-Werkzeug: Stille, Rauschen, ein einzelner Ton, 0,5 s, 3 s, 8 s, 96 kHz, 11 kHz mono, sehr leise: kein Absturz, kein Hänger; zu Kurzes und Rauschen melden „zu kurz“.

### Tempowechsel, 12/8, Taktanfänge (nach der Schlussmessung, nur an den Optimier-Sätzen entwickelt)

- **Tempowechsel:** Das Angleichen der Zählweise hatte bei jedem schnelleren Abschnitt jeden zweiten Schlag gestrichen (124 bpm als 62 gezählt). Jetzt wird nur angeglichen, was auf 6 % genau halb oder doppelt so schnell gezählt ist. Drei zusammengesetzte Testtracks: 124/88 bpm gezählt 125/88; 100/148/76 gezählt 100/150/77; 80/172 gezählt 81/86 (172 ist fast das Doppelte von 80 und zählt als Oktave). Test im Kern: 90 auf 126 bpm, 30 und 42 Schläge in je 20 s, beide genau.
- **12/8:** Anschläge auf beiden Dritteln des Schlags gegen Anschläge auf der Mitte. Generierter 12/8-Track: Verhältnis weit über 100; alle 4/4-Tracks: höchstens 0,46; Schwelle 1,5. Taktart generiert-2 14/18 auf 15/18. Unangetasteter 12/8-Blues: jetzt 12/8 (Taktart dort 5/5), Grundton 95 auf 91 %.
- **Taktanfänge, die zu früh kommen,** werden übergangen. Comfortably Numb (mit Gesang, nur Tonart im Label): 63,5 bpm, h-Moll, Strophe „Bm | Bm | A | G Em“, Refrain „D | A | D | A | C | G | C | G“ in gleichmäßigen Takten; vorher standen in der Strophe doppelt so viele Taktstriche.
- **Schlussstand, unangetastet (5):** Tempo 4/5, Taktart 5/5, Tonart 4/5, Grundton 85 %, Dur/Moll 84 %, Wechsel auf der Eins 79 %.
- Die Seite zeigt das Tempo an der Abspielstelle; im Testtrack 100 bpm am Anfang, 76 am Ende.

## Phase 1: Zeitlage und Takte (ab 2026-11-17)

Auftrag und Regeln in [Erkennung messen.md](../Erkennung%20messen.md), Plan in [docs/superpowers/plans/2026-11-17-analysis-phase1.md](../docs/superpowers/plans/2026-11-17-analysis-phase1.md). Hauptmaße sind `timing` und `tempo steady`. Jeder Versuch steht hier mit seinen `==`-Zeilen, auch der verworfene.

### Grundlage: ein Dekodierweg, Zwischenspeicher, Ausgangsstand

- **Ein Dekodierweg (Vorschlag Nr. 6, `330a43c`):** `btg::decodeFile` im Kern liest WAV, FLAC und MP3 mit dr_libs; die App und `btg_analyze` rufen beide diese Funktion auf. Keine neue Abhängigkeit. Ogg, AIFF und WMA liest die App weiter mit JUCE, M4A und Video über das System; diese Wege sind **nicht** mit dem Werkzeug abgeglichen.
- **Abgleich App gegen Werkzeug:** Analyse aus der echten App geholt (`position-check.mjs`, ohne gemerkte Ergebnisse) und mit dem JSON von `btg_analyze` verglichen (ohne Zwischenspeicher, Modell in beiden neu gerechnet):

| Track | Schläge App / Werkzeug | Akkorde App / Werkzeug | ganzes JSON gleich |
|---|---|---|---|
| Letting Go | 729 / 729 | 228 / 228 | ja |
| Late Night Groove | 633 / 633 | 193 / 193 | ja |
| `pGi9fs2HhZ0` | 773 / 773 | 193 / 193 | ja |

  Vorher lagen bei „Letting Go“ 218 von 729 Schlägen mehr als 30 ms auseinander. Das JSON des Werkzeugs selbst ist durch den Umbau unverändert (vorher und nachher verglichen an „Letting Go“ und einer WAV). `track-check.mjs`: alle Formate laden, Anzeige 20/20, keine Probleme.
- **Zwischenspeicher (Vorschlag Nr. 5, `955b5e8`):** Die Datei im Ordner nennt Größe und Änderungszeit der Audiodatei; stimmen sie nicht, wird neu gerechnet. Geprüft: zweiter Lauf 0 ms, neues Dateidatum 1670 ms, alter Eintrag ohne die Angabe 1660 ms, fehlender Ordner läuft.
- **Ausgangsstand** (zweimal gemessen, Ausgabe gleich, alle Schläge neu vom Modell; gleich dem Stand nach Phase 0):

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 93.6 %, maj/min 93.0 %, kind 74.4 % (triads 85.0 %, others 43.2 %) | changes on the one 80.9 % | timing +143 ms, apart 173 ms, within 78.8 %, 90 % under 481 ms, drift 13 ms/min, missed 0.5 % | tempo steady 34.5 % at most, 1.8 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 99.6 %, 90 % under 32 ms, drift 17 ms/min, missed 0.0 % | tempo steady 15.1 % at most, 1.6 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.3 %, maj/min 95.0 %, kind 69.6 % (triads 93.2 %, others 39.1 %) | changes on the one 93.2 % | timing +21 ms, apart 21 ms, within 95.3 %, 90 % under 147 ms, drift 208 ms/min, missed 1.4 % | tempo steady 86.5 % at most, 9.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 90.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.1 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +44 ms, apart 44 ms, within 90.5 %, 90 % under 154 ms, drift 117 ms/min, missed 0.0 % | tempo steady 33.3 % at most, 12.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 1: Akkordwechsel ein Achtel vor dem Schlag (Vorschlag Nr. 4) – behalten (`381471b`)

- **Hypothese:** Wo die Strecke vom Achtel bis zum Schlag schon nach dem neuen Akkord klingt und die Strecke davor nach dem alten, liegt der Wechsel auf dem Achtel. Gewinnen sollten `timing` und `root` bei Late Night Groove, Letting Go und Losing Control.
- **Änderung:** Nach der Glättung prüft `analysis.cpp` jeden Wechsel: Dreiklangstöne des neuen Akkords gegen die des alten in beiden Strecken (ohne Bass, ohne Tonart-Vorsprung; Schwelle `EARLY` 0,1, nicht durchprobiert). Trifft es zu, beginnt der Akkord auf dem Achtel. Nicht in 6/8 und 12/8, und nicht, wo der halbe Schlag oder die Strecke kürzer ist als das Spektralfenster (186 ms bei 44,1 kHz); dann bleibt alles wie vorher. Die Zuordnung der Schläge zu den Akkorden für die Akkordart ist unverändert. Die Seite (`track.js`) lässt einen Wechsel dort beginnen, wo sein Akkord in der Analyse beginnt.
- **Wo das Achtel liegt**, bestimmt der Track: der übliche Ort des stärksten Einsatzes zwischen zwei Schlägen, gezählt vom Einsatz auf dem Schlag. Gemessen: **Late Night Groove 0,52, der Track swingt nicht** (gerade Achtel; die vorgezogenen Akkorde liegen auf dem geraden „und“). Letting Go 0,51, Losing Control 0,53, `9pH42-82Mz0` 0,51, `pGi9fs2HhZ0` 0,50, One Last Time 0,51. Mit Swing: Before The Dawn 0,60, Back Door Blues (`NX6P1-yDYLQ`) 0,69. `7Zsqy25jWD4` (3/4, 150 bpm) 0,85; dort greift die Regel wegen der Fenstergrenze nicht. Erste Fassung, verworfen vor der Wertung: Ort gegen die Schlagzeit des Modells gemessen; das lange Fenster sieht Einsätze kommen, gerade Tracks lagen dadurch bei 0,45, und die Regel griff auch bei 172 bpm (`V1r4wWATS9Y` `root` −1,5).
- **Verschobene Wechsel:** Late Night Groove 105 von 192, Letting Go 57 von 227, Before The Dawn 39 von 194, Losing Control 20 von 179, Back Door Blues 12 von 101, `qmlHtyS_P8k` 6 von 120, Comfortably Numb 2, `9pH42-82Mz0` 1, die übrigen fünf 0. In den generierten Sätzen (Wechsel auf dem Schlag) 4 von 808: `dreamy-11` 1, `step-80-62-hardrock` 3; in beiden Tracks liegen die Wechsel danach näher am Label, nicht weiter weg.

| Satz | `timing` innerhalb | Median Δ | `root` | `maj/min` | `kind` | `triads` |
|---|---|---|---|---|---|---|
| echt | 78,8 → 90,7 % | +143 → +93 ms | 93,6 → 94,8 % | 93,0 → 94,2 % | 74,4 → 75,5 % | 85,0 → 86,5 % |
| generiert | 99,6 → 100,0 % | +16 → +16 ms | 98,5 | 97,8 | 92,4 | 92,4 |
| generiert-2 | 95,3 → 95,3 % | +21 → +21 ms | 95,3 | 95,0 | 69,6 | 93,2 |
| verstimmt | 83,3 → 83,3 % | +12 → +12 ms | 82,2 | 82,2 | 78,1 | 78,1 |
| tempo | 90,5 → 92,2 % | +44 → +19 ms | 97,8 | 96,1 → 96,2 % | 95,1 | 95,1 |

| Track | `timing` innerhalb 0,3 s | Median Δ | `root` |
|---|---|---|---|
| Late Night Groove | 37,2 → 92,0 % | +400 → +120 ms | 85,4 → 93,2 % |
| Letting Go | 65,6 → 91,3 % | +140 → +95 ms | 89,3 → 93,1 % |
| Before The Dawn | 57,1 → 74,6 % | +220 → +170 ms | 87,6 → 89,2 % |
| Losing Control | 75,6 → 84,9 % | +190 → +160 ms | 91,6 → 92,6 % |
| Back Door Blues | 83,9 → 83,9 % | +80 → +30 ms | 90,8 → 90,8 % |

- **Verloren:** `qmlHtyS_P8k` (170 bpm, `cycle`) `root` und `triads` 99,3 → 99,0 und 83,7 → 83,4; `9pH42-82Mz0` `root` 93,6 → 93,5. Alles andere gleich oder besser.
- **Sicherungen:** Zähler für Tempo, Taktart, Tonart gleich; `changes on the one`, `bars`, `beats`, `tempo steady` in allen Sätzen gleich (die Regel ändert keine Schläge). `triads` und `root` fallen in keinem Satz. In den generierten Sätzen fällt `timing` nicht, der Median von Δ bleibt positiv; je Track ist er bei `step-80-62-hardrock` von +181 auf −18 ms gegangen (der Track hat falsche Schläge, `timing` dort 47,8 → 60,9 %).
- **In der App** (`track-check.mjs`, Late Night Groove): angezeigter Akkord gegen die Analyse 18/20 vor der Änderung an der Seite, 20/20 danach; Korrektur eines Takts, Takt 1 verschieben und „÷2 / ×2“ wie vorher, keine Probleme. Nicht mit eigenen Augen und Ohren geprüft.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.8 %, maj/min 94.2 %, kind 75.5 % (triads 86.5 %, others 43.1 %) | changes on the one 80.9 % | timing +93 ms, apart 130 ms, within 90.7 %, 90 % under 396 ms, drift 10 ms/min, missed 0.5 % | tempo steady 34.5 % at most, 1.8 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 15.1 % at most, 1.6 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.3 %, maj/min 95.0 %, kind 69.6 % (triads 93.2 %, others 39.1 %) | changes on the one 93.2 % | timing +21 ms, apart 21 ms, within 95.3 %, 90 % under 147 ms, drift 208 ms/min, missed 1.4 % | tempo steady 86.5 % at most, 9.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 90.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 110 ms/min, missed 0.0 % | tempo steady 33.3 % at most, 12.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 2: Halbierungsregel, Abstände feiner als das Raster des Modells (Vorschlag Nr. 2) – behalten (`63339ae`)

- **Hypothese:** Die Prüfung „halb oder doppelt so schnell“ (6 %) scheitert am 20-ms-Raster des Modells: 0,42 s gegen 0,39 s sind 7,7 %, gemeint sind beide Male 0,395 s. Mit feineren Abständen wird der Anfang eines doppelt gezählten Abschnitts erkannt. Gewinnen sollte nur „Letting Go“.
- **Änderung:** Der übliche Schlagabstand des Tracks und der in der Umgebung eines Schlags sind jetzt das Mittel aller Abstände, die höchstens 10 % neben dem Median liegen (dieselbe Rechnung stand schon beim Tempo). Die Toleranz bleibt 6 %.
- **Protokoll bei „Letting Go“:** üblicher Abstand 0,7800 → 0,7892 s. Bei 30,48 s jetzt „schneller“ (Umgebung 0,40 statt 0,42 s), der Zwischenschlag fällt weg. Gestrichene Taktanfänge des Modells 44 → 5. Schläge auf dem Achtel-Raster (76,0 bpm, gezählt ab 30,12 s):

| | vorher | nachher |
|---|---|---|
| 30,5 bis 59 s | 37 Schläge, alle auf den Zwischen-Achteln | alle auf den Vierteln |
| 417,3 bis 449 s | 41 Schläge, alle auf den Zwischen-Achteln | alle auf den Vierteln |
| Schlagabstände unter 0,6 s | 20 | 8 |
| Takte mit falscher Länge | 14 von 189 | 6 von 183 |

  Ab 471,8 s (nach der Pause vor dem Solo) liegen die Schläge durchgehend ein Achtel versetzt gegen den Anfang; das ist der Track, kein Fehler der Regel. Vorher wechselte die Lage dort noch zweimal (536 bis 540 s).
- **Zahlen:** Nur „Letting Go“ ändert sich, alle anderen Tracks aller Sätze sind Zeile für Zeile gleich (auch der Satz „tempo“ und der Test 90 auf 126 bpm).

| Letting Go | vorher (Versuch 1) | nachher |
|---|---|---|
| `tempo steady`, Anteil daneben | 14,7 % | 4,3 % |
| `timing` innerhalb 0,3 s | 91,3 % | 91,9 % |
| `root` / `maj/min` / `kind` / `triads` | 93,1 / 93,3 / 70,0 / 91,4 | 93,4 / 93,5 / 71,5 / 93,6 |
| `changes on the one` | 59,9 % (100/22/20/25) | 56,3 % (94/23/25/25) |

  Satz „echt“: `tempo steady` 1,8 → 1,0 %, `timing` 90,7 → 90,8 %, `triads` 86,5 → 86,7 %, `changes on the one` 80,9 → 80,5 %.
- **Sicherung `changes on the one`:** fällt im Satz um 0,4 und beim Track um 3,6 Punkte (erlaubt: 1 und 5). Die Schläge liegen nachweislich besser; die Zahl hängt bei diesem Track an den vorgezogenen Akkorden.
- **Offen danach bei „Letting Go“:** etwa 8 einzelne überzählige Schläge (59,3, 107,1, 113,4, 116,6, 152,5, 208,9, 257,5, 357,0, 454,8, 471,4 s; Vorschlag Nr. 3) und 5 gestrichene Taktanfänge des Modells (116,94 s und vier zwischen 464,7 und 469,5 s, dort beginnt die versetzte Lage des Solos laut Modell schon früher; Vorschlag Nr. 1).

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.8 %, maj/min 94.2 %, kind 75.7 % (triads 86.7 %, others 43.1 %) | changes on the one 80.5 % | timing +94 ms, apart 129 ms, within 90.8 %, 90 % under 394 ms, drift 11 ms/min, missed 0.5 % | tempo steady 34.5 % at most, 1.0 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 15.1 % at most, 1.6 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.3 %, maj/min 95.0 %, kind 69.6 % (triads 93.2 %, others 39.1 %) | changes on the one 93.2 % | timing +21 ms, apart 21 ms, within 95.3 %, 90 % under 147 ms, drift 208 ms/min, missed 1.4 % | tempo steady 86.5 % at most, 9.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 90.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 110 ms/min, missed 0.0 % | tempo steady 33.3 % at most, 12.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 3: Beim Halbieren den Taktanfang des Modells behalten (Vorschlag Nr. 1) – verworfen

- **Hypothese:** Nach Versuch 2 werden bei „Letting Go“ noch 5 Taktanfänge des Modells als Zwischenschlag gestrichen (116,94 s und vier zwischen 464,7 und 469,5 s). Behält man in einem doppelt gezählten Abschnitt von zwei Schlägen im halben Abstand den, der ein Taktanfang des Modells ist, liegen die Schläge dort richtig.
- **Änderung:** Im Zweig „schneller“: Ist der Schlag dazwischen ein Taktanfang des Modells und der zuletzt behaltene keiner, ersetzt er ihn (`swap-to-one`). Griff im Satz „echt“ zweimal, beide Male bei „Letting Go“.
- **Zahlen (gegen Versuch 2):**

| | vorher | nachher |
|---|---|---|
| Letting Go `timing` innerhalb | 91,9 % | 92,5 % |
| Letting Go `tempo steady` daneben | 4,3 % | 4,9 % |
| Letting Go `root` / `triads` | 93,4 / 93,6 | 93,8 / 94,5 |
| echt `tempo steady` | 1,0 % | 1,1 % |
| generiert `tempo steady` | 1,6 % | 1,7 % |
| generiert `bars` / `beats` innerhalb 50 ms | 98,6 / 99,0 % | 97,6 / 98,5 % |
| `dreamy-11` (generiert) `bars` / `beats` / `timing` | 93,8 / 90,6 / 100,0 % | 75,0 / 81,3 / 93,3 % |

- **Urteil:** Kein Hauptmaß gewinnt genug (`timing` echt +0,1), `tempo steady` wird in zwei Sätzen schlechter, und ein generierter Track mit genauen Labels verliert ein Fünftel seiner Taktanfänge. Ein Taktanfang des Modells auf einem Zwischen-Achtel ist nicht verlässlicher als der Schlag davor. Code zurückgesetzt.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.9 %, maj/min 94.2 %, kind 75.7 % (triads 86.8 %, others 43.1 %) | changes on the one 80.7 % | timing +93 ms, apart 129 ms, within 90.9 %, 90 % under 394 ms, drift 10 ms/min, missed 0.5 % | tempo steady 34.5 % at most, 1.1 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 99.6 % | timing +16 ms, apart 24 ms, within 99.6 %, 90 % under 32 ms, drift 20 ms/min, missed 0.0 % | tempo steady 16.0 % at most, 1.7 % off | beats +15 ms, within 50 ms 98.5 %, bars 97.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.3 %, maj/min 95.0 %, kind 69.6 % (triads 93.2 %, others 39.1 %) | changes on the one 93.2 % | timing +21 ms, apart 21 ms, within 95.3 %, 90 % under 147 ms, drift 208 ms/min, missed 1.4 % | tempo steady 86.5 % at most, 9.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 90.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 110 ms/min, missed 0.0 % | tempo steady 33.3 % at most, 12.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 4: Einzelne überzählige Schläge streichen (Vorschlag Nr. 3) – so verworfen

- **Hypothese:** Ein Schlag außerhalb eines doppelt gezählten Abschnitts, der dichter als 0,6 des üblichen Abstands auf den letzten folgt, während der Schlag danach im üblichen Abstand (±15 %) zum letzten liegt, ist überzählig. Gewinnen sollte `tempo steady` bei Letting Go, Losing Control, Back Door Blues, One Last Time, Comfortably Numb.
- **Änderung:** eine Bedingung vor dem Auffüllen (`drop-extra`). Gestrichen: Letting Go 5 (107,08, 113,40, 116,56, 208,92, 471,42 s), Back Door Blues 4, Losing Control 2 (238,32, 505,96 s), One Last Time 1, Comfortably Numb 1; generiert 1, generiert-2 9 (davon `reggae-128-60` 6), tempo 7.
- **Zahlen (gegen Versuch 2):** `tempo steady` echt 1,0 → 0,2 %, tempo 12,4 → 6,4 %, generiert 1,6 → 1,4 %. `country-54-72` (5/4): `bars` 62,5 → 100 %, `root` 93,1 → 99,3 %.
- **Warum verworfen:** In generiert-2 fällt der Zähler für das Tempo von 17/18 auf 16/18 und `tempo steady` steigt von 9,0 auf 12,0 %. Ursache `reggae-128-60` (12/8 bei 60 bpm, das Modell zählt die Achtel im Abstand von 0,33 s): Ohne die sechs überzähligen Schläge schlägt die Prüfung auf Dreierunterteilung an (Verhältnis 5,47 bei Grenze 1,5), jedes Achtel wird noch einmal gedrittelt, gemeldet 179,6 statt 60 bpm. Vorher hatten gerade die überzähligen Schläge die Prüfung unter der Grenze gehalten.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.8 %, maj/min 94.2 %, kind 75.7 % (triads 86.7 %, others 43.1 %) | changes on the one 80.6 % | timing +93 ms, apart 130 ms, within 90.8 %, 90 % under 395 ms, drift 10 ms/min, missed 0.5 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 16/18 | meter 16/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.5 %, maj/min 95.3 %, kind 69.8 % (triads 93.6 %, others 39.1 %) | changes on the one 95.0 % | timing +20 ms, apart 20 ms, within 96.8 %, 90 % under 101 ms, drift 171 ms/min, missed 1.4 % | tempo steady 212.6 % at most, 12.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 92.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 5: Versuch 4 mit einer Grenze für die Dreierunterteilung – behalten (`1a22a89`)

- **Hypothese (aus dem Protokoll von Versuch 4):** Ein Einsatz zeigt sich in der Einsatzstärke von einem halben Spektralfenster vor bis zu einem halben danach (93 ms, mit dem Suchbereich 116 ms). Liegen die Schläge 0,33 s auseinander, fallen beide Drittel des Schlags (111 ms) in diese Reichweite der Schläge selbst, die Mitte nicht. Die Prüfung misst dann die Schläge, nicht Noten auf den Dritteln.
- **Änderung:** Versuch 4, dazu: Die Dreierunterteilung wird nur geprüft, wenn ein Drittel des üblichen Schlagabstands länger ist als diese Reichweite (Schlagabstand über 0,35 s bei 44,1 kHz). **Diese Sperre hielt nur bei 44,1 kHz und ist durch Versuch 7 ersetzt.** Dazu eine Protokollzeile `threes:` hinter `BTG_ANALYSIS_LOG`.
- **Zahlen (gegen Versuch 2):**

| Satz | `tempo steady` daneben | sonst |
|---|---|---|
| echt | 1,0 → 0,2 % | `timing` 90,8 %, `root` 94,8 %, `triads` 86,7 % gleich |
| generiert | 1,6 → 1,4 % | gleich |
| generiert-2 | 9,0 → 6,4 % | `bars` 90,9 → 92,9 %, `timing` 95,3 → 96,8 %, `root` 95,3 → 95,5 %, Zähler gleich |
| verstimmt | 0,3 % | gleich |
| tempo | 12,4 → 6,4 % | gleich |

| Track | `tempo steady` daneben | sonst |
|---|---|---|
| Letting Go | 4,3 → 1,1 % | `timing` 91,9 → 92,5 %, `root` 93,4 → 93,8 % |
| Losing Control | 2,5 → 0,0 % | `timing` 84,9 → 84,0 %, `triads` 88,7 → 87,9 % |
| Back Door Blues | 3,0 → 1,2 % | |
| Comfortably Numb | 2,3 → 0,0 % | |
| One Last Time | 0,2 → 0,0 % | |
| `faster-60-66-psych` (tempo) | 39,4 → 0,0 % | |
| `country-54-72` (generiert-2) | 10,8 → 0,0 % | `bars` 62,5 → 100 %, `timing` 66,7 → 100 % |
| `reggae-128-60` (generiert-2) | 23,6 → 0,0 % | Tempo richtig, Taktart weiter 6/8 statt 12/8 |
| `dreamy-128-90` (generiert-2) | 9,9 → 6,9 % | verliert: `root` 93,2 → 91,8 %, `timing` 86,7 → 80,0 % |

- **Verloren:** `dreamy-128-90` und leicht Losing Control (siehe Tabelle). Kein Satz fällt bei `root`, `maj/min`, `triads` oder `timing`.
- **Sicherungen:** Zähler gleich; `changes on the one` echt 80,5 → 80,6 %, generiert-2 93,2 → 95,0 %; Test 90 auf 126 bpm grün; die Tracks mit hartem Tempowechsel im Satz „tempo“ unverändert.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.8 %, maj/min 94.2 %, kind 75.7 % (triads 86.7 %, others 43.1 %) | changes on the one 80.6 % | timing +93 ms, apart 130 ms, within 90.8 %, 90 % under 395 ms, drift 10 ms/min, missed 0.5 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.5 %, maj/min 95.3 %, kind 69.8 % (triads 93.6 %, others 39.1 %) | changes on the one 95.0 % | timing +20 ms, apart 20 ms, within 96.8 %, 90 % under 101 ms, drift 171 ms/min, missed 1.4 % | tempo steady 59.7 % at most, 6.4 % off | beats +23 ms, within 50 ms 98.9 %, bars 92.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 6: Ein Wechsel der Zählweise ist kein verlorener Puls – verworfen

- **Diagnose `step-80-62-hardrock`** (Satz „tempo“, 80 auf 62 bpm bei 36 s): Das Modell zählt bis zum Wechsel richtig (0,75 s) und danach abwechselnd Achtel (0,48 s) und Viertel (0,96 s), immer auf dem richtigen Raster. Die Prüfung „das Modell hat den Puls verloren“ zählt jeden Übergang zwischen den beiden Zählweisen als Ausreißer (20 von 135 Abständen, Grenze 10 %), verwirft alle Schläge des Modells, und die eigene Schlagsuche meldet 122 bpm.
- **Hypothese:** Ein Abstand, der halb oder doppelt so groß ist wie der übliche in der Umgebung, ist kein Ausreißer. Dann bleiben die Schläge des Modells.
- **Änderung:** eine Bedingung in der Prüfung am Anfang von `analyze`.
- **Zahlen (gegen Versuch 5):** Nur dieser Track ändert sich.

| `step-80-62-hardrock` | vorher | nachher |
|---|---|---|
| `beats` innerhalb 50 ms | 71,9 % | 93,8 % |
| `tempo steady` daneben | 46,3 % | 36,8 % |
| `timing` innerhalb 0,1 s | 60,9 % | 52,2 % |
| `root` / `triads` | 95,9 / 95,9 | 91,9 / 91,9 |
| `changes on the one` | 73,9 % | 52,2 % |

  Satz „tempo“: `tempo steady` 6,4 → 5,2 %, `beats` 94,5 → 97,3 %, aber `timing` 92,2 → 91,1 %, `changes on the one` 90,9 → 88,1 %, `root` 97,8 → 97,3 %, `triads` 95,1 → 94,6 %.
- **Urteil:** `timing` fällt im Satz um mehr als einen Punkt, `changes on the one` um 2,8, `triads` fällt. Die Schläge liegen besser, aber nach dem Tempowechsel bleiben beide Zählweisen nebeneinander stehen (die Regel zum Angleichen vergleicht nur mit dem üblichen Abstand des ganzen Tracks), und die Takte haben abwechselnd 4 und 8 Schläge. Es bräuchte zusätzlich ein Angleichen an die Zählweise der Umgebung; das ist eine zweite Änderung und bisher nur an diesem einen generierten Track belegt. Code zurückgesetzt.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.8 %, maj/min 94.2 %, kind 75.7 % (triads 86.7 %, others 43.1 %) | changes on the one 80.6 % | timing +93 ms, apart 130 ms, within 90.8 %, 90 % under 395 ms, drift 10 ms/min, missed 0.5 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.5 %, maj/min 95.3 %, kind 69.8 % (triads 93.6 %, others 39.1 %) | changes on the one 95.0 % | timing +20 ms, apart 20 ms, within 96.8 %, 90 % under 101 ms, drift 171 ms/min, missed 1.4 % | tempo steady 59.7 % at most, 6.4 % off | beats +23 ms, within 50 ms 98.9 %, bars 92.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.3 %, maj/min 95.7 %, kind 94.6 % (triads 94.6 %, others –) | changes on the one 88.1 % | timing +25 ms, apart 25 ms, within 91.1 %, 90 % under 225 ms, drift 159 ms/min, missed 0.0 % | tempo steady 50.2 % at most, 5.2 % off | beats +24 ms, within 50 ms 97.3 %, bars 85.9 %
```

### Diagnosen ohne Versuch (offen)

Geprüft nach Versuch 5, jeweils ohne Änderung am Code:

- **Before The Dawn** (`timing` 74,6 %): 15 Wechsel G → Dsus2 und G → F werden zwei Schläge zu früh gemeldet (Δ −0,9 bis −1,2 s), immer in der Mitte des zweiten G-Takts. `change-times.mjs`: Der Bass wechselt dort zur Label-Zeit (gehört minus Label −76 bis +174 ms). Die Analyse hört also in den letzten zwei Schlägen des G schon Dm. **Back Door Blues:** dasselbe Muster bei A7 → E, 6-mal. Das ist eine Frage der Akkordbewertung (Auftakte, Übergänge), nicht der Schläge: ein Kandidat für Phase 2.
- **`9pH42-82Mz0`:** Die „Wechsel am nächsten Taktanfang“ sind nach Versuch 1 noch 3. An allen dreien meldet die Analyse Bb → F (halber Takt) → C, das Label Bb → C. Entweder spielt der Track dort F, oder die Analyse verwechselt F und C. Nicht am Audio geprüft; Kandidat für Phase 2.
- **Losing Control:** 4 Wechsel Em → G liegen weiter einen halben Schlag spät; die Regel aus Versuch 1 hat sie nicht verschoben.
- **`slower-80-66-dreamy`** (`bars` 50 %): Die Schläge stimmen. Die Taktanfänge des Modells liegen in den ersten 24 s einen Schlag zu früh, danach richtig; die Eins wird für den ganzen Track gemeinsam gewählt. Bräuchte eine Wahl der Eins je Abschnitt.
- **`reggae-128-60`:** Tempo richtig, Taktart weiter 6/8 statt 12/8 (die Dreierprüfung greift dort jetzt nicht mehr, zu Recht).

### Stand nach Phase 1 (2026-11-17)

Acht gemessene Versuche von höchstens zwölf: behalten 1, 2, 5 und 7, verworfen 1a, 3, 4 und 6 (1a und 7 sind nach der Prüfung nachgetragen, siehe unten). Der Endstand ist nach dem letzten Zurücksetzen und noch einmal nach den Korrekturen aus der Prüfung gemessen; die Zahlen aller Sätze sind gleich denen von Versuch 5. `analysisVersion` steht auf `2026-11-17f`.

| Satz | `timing` innerhalb | Median Δ | `tempo steady` daneben | `root` | `maj/min` | `kind` (`triads`) | auf der Eins | `bars` | Tempo / Taktart / Tonart |
|---|---|---|---|---|---|---|---|---|---|
| echt, vorher | 78,8 % | +143 ms | 1,8 % | 93,6 % | 93,0 % | 74,4 % (85,0) | 80,9 % | – | 12/12, 13/13, 12/13 |
| echt, nachher | **90,8 %** | +93 ms | **0,2 %** | 94,8 % | 94,2 % | 75,7 % (86,7) | 80,6 % | – | 12/12, 13/13, 12/13 |
| generiert, vorher | 99,6 % | +16 ms | 1,6 % | 98,5 % | 97,8 % | 92,4 % (92,4) | 100,0 % | 98,6 % | 18/18, 18/18, 17/18 |
| generiert, nachher | 100,0 % | +16 ms | 1,4 % | 98,5 % | 97,8 % | 92,4 % (92,4) | 100,0 % | 98,6 % | 18/18, 18/18, 17/18 |
| generiert-2, vorher | 95,3 % | +21 ms | 9,0 % | 95,3 % | 95,0 % | 69,6 % (93,2) | 93,2 % | 90,9 % | 17/18, 15/18, 17/18 |
| generiert-2, nachher | 96,8 % | +20 ms | 6,4 % | 95,5 % | 95,3 % | 69,8 % (93,6) | 95,0 % | 92,9 % | 17/18, 15/18, 17/18 |
| verstimmt, vorher und nachher | 83,3 % | +12 ms | 0,3 % | 82,2 % | 82,2 % | 78,1 % (78,1) | 100,0 % | 99,0 % | 6/6, 6/6, 5/6 |
| tempo, vorher | 90,5 % | +44 ms | 12,4 % | 97,8 % | 96,1 % | 95,1 % (95,1) | 90,9 % | 85,9 % | –, 8/8, 8/8 |
| tempo, nachher | 92,2 % | +19 ms | 6,4 % | 97,8 % | 96,2 % | 95,1 % (95,1) | 90,9 % | 85,9 % | –, 8/8, 8/8 |

Echte Tracks mit Zeit-Labels, vorher → nachher:

| Track | `timing` innerhalb 0,3 s | Median Δ | `tempo steady` daneben | `root` |
|---|---|---|---|---|
| Late Night Groove | 37,2 → 92,0 % | +400 → +120 ms | 0,0 % | 85,4 → 93,2 % |
| Letting Go | 65,6 → 92,5 % | +140 → +100 ms | 14,7 → 1,1 % | 89,3 → 93,8 % |
| Before The Dawn | 57,1 → 74,6 % | +220 → +170 ms | 0,0 % | 87,6 → 89,2 % |
| Losing Control | 75,6 → 84,0 % | +190 → +160 ms | 2,5 → 0,0 % | 91,6 → 92,6 % |
| Back Door Blues | 83,9 → 83,9 % | +80 → +30 ms | 3,0 → 1,2 % | 90,8 → 90,8 % |
| `9pH42-82Mz0` | 92,9 → 92,9 % | +100 → +100 ms | 0,0 % | 93,6 → 93,5 % |
| One Last Time | 97,0 → 97,0 % | +150 → +150 ms | 0,2 → 0,0 % | 95,7 → 95,7 % |
| `7Zsqy25jWD4`, `pGi9fs2HhZ0` | 100 % | unverändert | 0,0 % | unverändert |

Verloren haben gegenüber dem Ausgangsstand: `qmlHtyS_P8k` `root` 99,3 → 99,0 %, `9pH42-82Mz0` `root` 93,6 → 93,5 %, „Letting Go“ `changes on the one` 59,9 → 56,9 %, `dreamy-128-90` (generiert-2) `root` 93,2 → 91,8 % und `timing` 86,7 → 80,0 %.

**App gegen Werkzeug im Endstand:** für Letting Go, Late Night Groove und `pGi9fs2HhZ0` ist das ganze JSON der App gleich dem von `btg_analyze` (720, 633 und 773 Schläge; 65, 105 und 0 Akkorde beginnen zwischen den Schlägen). **Nicht abgeglichen** sind die Formate, die die App weiter mit JUCE oder über das System liest: Ogg, AIFF, WMA, M4A und Video. Für sie gilt die Messung nur, soweit ihr Dekoder dieselben Samples liefert.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.8 %, maj/min 94.2 %, kind 75.7 % (triads 86.7 %, others 43.1 %) | changes on the one 80.6 % | timing +93 ms, apart 130 ms, within 90.8 %, 90 % under 395 ms, drift 10 ms/min, missed 0.5 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.5 %, maj/min 95.3 %, kind 69.8 % (triads 93.6 %, others 39.1 %) | changes on the one 95.0 % | timing +20 ms, apart 20 ms, within 96.8 %, 90 % under 101 ms, drift 171 ms/min, missed 1.4 % | tempo steady 59.7 % at most, 6.4 % off | beats +23 ms, within 50 ms 98.9 %, bars 92.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Prüfung durch einen Subagenten (2026-11-17) und Nachträge

Ein Subagent mit frischem Kontext hat nur den Diff gegen `feat/native-spike` und die Anleitung bekommen. Kein kritischer Befund. Keine Sonderfälle für Tracks oder Dateinamen, `native/tools` nur mit den Änderungen aus Phase 0, nichts zu den unangetasteten Tracks im Abschnitt zu Phase 1, die Rechnung der behaltenen Versuche stimmt. Seine Befunde und was daraus wurde:

| Befund | Gewicht | Was daraus wurde |
|---|---|---|
| Die erste Fassung von Versuch 1 war gemessen, aber nicht als Versuch gezählt und ohne `==`-Zeilen | wichtig | nachgetragen als Versuch 1a (unten); die Untergrenze 0,5 für die Lage des Achtels steht jetzt dabei |
| Die Sperre der Dreierprüfung aus Versuch 5 hängt an der Abtastrate und am 20-ms-Raster | wichtig | bestätigt an einer 48-kHz-Kopie von `reggae-128-60` (wieder 179,7 bpm); ersetzt, Versuch 7 (unten) |
| „Kein Fehlalarm in den generierten Sätzen“ ist wörtlich nicht erfüllt | gering | stimmt: 4 von 808 Wechseln wurden verschoben (`dreamy-11` 1, `step-80-62-hardrock` 3), und bei `step-80-62-hardrock` ist der Median von Δ je Track −18 ms. Je Satz fällt `timing` nicht und der Median bleibt positiv. Der Nutzer entscheidet, ob das reicht |
| Versuch 5 bündelt zwei Regeln; Verlust bei `dreamy-128-90` ohne Ursache | gering | Die Wirkung der Sperre allein ist der Unterschied zwischen Versuch 4 und 5: nur `reggae-128-60`. Bei `dreamy-128-90` wurde ein Schlag bei 38,92 s gestrichen; `changes on the one` blieb gleich; warum `root` dort 1,4 Punkte verliert, ist nicht untersucht |
| `analysisVersion` schon am Ende von Phase 1 hochgezählt | gering | Absicht (der Nutzer prüft in der App); nach Phase 2 wird noch einmal gezählt. Die Korrekturen aus der Prüfung ändern kein Ergebnis der gemessenen Tracks; unter `2026-11-17f` ist nichts gemerkt, die Version bleibt |
| Laufzeit je Track nicht dokumentiert | gering | „Letting Go“ (9:30 min), ohne Zwischenspeicher: 12,0 s gesamt, davon 10,1 s das Modell (Grenze 22 s) |
| Neue Zahlen nicht als `knob(...)` | gering | Die Schwellen für überzählige Schläge und die Untergrenze der Dreierprüfung sind jetzt Knöpfe (`EXTRA`, `EXTRA_NEXT`, `THREES_FLOOR`); die Zahlen der Achtel-Messung (0,4, 0,8, 0,3, 16) nicht |
| Dateiendung außerhalb der Codepage wirft unter Windows (`a.мп3`) | gering | bestätigt (der neue Test stürzte ab), behoben |
| Drei Kopien im Speicher beim Dekodieren, Leck bei `bad_alloc` | gering | Puffer in `unique_ptr`, die Bytes der Datei werden vor dem Kopieren freigegeben; es bleiben für einen Moment zwei Kopien der Samples (im Code als Abkürzung markiert) |
| Lage des Achtels ohne Obergrenze (`7Zsqy25jWD4` misst 0,85) | gering | über 0,75 wird nichts verschoben; kein Track der Sätze ändert sich dadurch |
| Halbe Bedingung der Fenstergrenze wirkungslos | gering | gestrichen |
| `track.js`: leerer Edit wird verschieden gewertet | gering | behoben |
| Grenzfälle der vorgezogenen Akkorde ungetestet | gering | Test ergänzt: Schläge von außen mit einem überzähligen 50 ms nach einem Schlag; er fällt weg, die Akkorde bleiben lückenlos |
| `UEBERGABE.md`, `VORSCHLAEGE.md` und die Anleitung veraltet | gering | nachgeführt |
| „`qmlHtyS_P8k` 6 von 120 bei 170 bpm“ nicht belegt | gering | Die Datei hat 48 kHz (wie `V1r4wWATS9Y`), das Spektralfenster ist dort 171 ms lang, der halbe Schlag 176 ms: knapp über der Grenze |

Was er aus den zwei Dateien nicht prüfen konnte, und wie es steht: `native/tools` ist seit Beginn von Phase 1 unverändert (`git diff 22d0840..HEAD -- native/tools` leer); das jüngste Label der echten Tracks ist von 10:34 Uhr, das jüngste der generierten Sätze von 18:53 Uhr, Phase 1 begann um 19:25 Uhr. Die Akkordart wird über die Zeit zugeordnet (Schläge vor dem Ende des Akkords), ein vorgezogener Wechsel ändert die Zuordnung also nicht. Der Abgleich App gegen Werkzeug ist im Endstand wiederholt (drei Tracks, ganzes JSON gleich). Die Regeln A und B für Akkorde in der Anleitung sind in Phase 1 nicht geändert worden.

### Versuch 1a: erste Fassung von Versuch 1 – verworfen (nachgetragen)

- **Unterschied zu Versuch 1:** Die Lage des Achtels wurde gegen die Schlagzeit des Modells gemessen und nicht nach unten begrenzt. Das lange Fenster sieht Einsätze kommen; gerade Tracks lagen bei 0,42 bis 0,47 statt 0,5. Die Strecke bis zum Schlag war damit länger als das Fenster, und die Regel griff auch bei 172 bpm.
- **Zahlen (gegen den Ausgangsstand):** echt `timing` 78,8 → 89,7 %, `root` 93,6 → 94,7 %, `triads` 85,0 → 86,4 %. Verloren: `V1r4wWATS9Y` `root` 96,9 → 95,4 % und `triads` 95,8 → 94,9 % (34 von 323 Wechseln verschoben), `qmlHtyS_P8k` `root` 99,3 → 99,0 %, `9pH42-82Mz0` `timing` 92,9 → 91,9 %.
- **Urteil:** Verstößt gegen die Vorgabe des Nutzers, dass bei einem halben Schlag unter der Fensterlänge alles bleibt wie vorher. In Versuch 1 wird die Lage vom Einsatz auf dem Schlag aus gemessen und ist mindestens 0,5. Die Ausgabedateien dieser Messung sind überschrieben; die Zeilen stammen aus dem Protokoll der Sitzung.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.7 %, maj/min 94.1 %, kind 75.5 % (triads 86.4 %, others 43.1 %) | changes on the one 80.9 % | timing +99 ms, apart 130 ms, within 89.7 %, 90 % under 399 ms, drift 10 ms/min, missed 0.5 % | tempo steady 34.5 % at most, 1.8 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 10 ms/min, missed 0.0 % | tempo steady 15.1 % at most, 1.6 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.3 %, maj/min 95.0 %, kind 69.6 % (triads 93.2 %, others 39.1 %) | changes on the one 93.2 % | timing +21 ms, apart 21 ms, within 95.3 %, 90 % under 147 ms, drift 208 ms/min, missed 1.4 % | tempo steady 86.5 % at most, 9.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 90.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 110 ms/min, missed 0.0 % | tempo steady 33.3 % at most, 12.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 7: Dreierprüfung mit Untergrenze statt Sperre nach Schlagabstand – behalten (`a622b53`)

- **Anlass:** Befund der Prüfung. `reggae-128-60`, mit ffmpeg auf 48 kHz umgerechnet (Datei nur zum Nachsehen in `native/build/phase1`, kein Teil eines Satzes): Die Sperre aus Versuch 5 greift nicht (Grenze 0,32 s, Achtel 0,333 s), gemeldet 179,7 bpm.
- **Ursache (Protokoll `threes:`):** Wo zwischen den Schlägen nichts gespielt wird, sind beide Summen fast null, und ihr Verhältnis sagt nichts: `reggae-128-60` hat auf den Dritteln 0,9 % (44,1 kHz) und 0,5 % (48 kHz) der Stärke auf den Schlägen, in der Mitte noch weniger, Verhältnis 5,47 und 13,71. Der echte 12/8-Track `dreamy-128-90` hat 3,1 %.
- **Änderung:** Die Sperre nach Schlagabstand entfällt. Die Dreierunterteilung gilt nur, wenn die Stärke auf den Dritteln das 1,5-fache der Summe aus der Stärke in der Mitte und einem Hundertstel der Stärke auf den Schlägen übersteigt (`THREES_FLOOR` 0,01, nicht durchprobiert; die Grenze liegt damit bei 1,5 %, zwischen 0,9 und 3,1 %). Keine Abhängigkeit von der Abtastrate.
- **Zahlen:** Alle fünf Sätze Zeile für Zeile gleich Versuch 5. `reggae-128-60` bei 48 kHz: 59,9 bpm, 6/8 (vorher 179,7 bpm). `dreamy-128-90` weiter 12/8 bei 90 bpm.
- **Grenze der Aussage:** Die Untergrenze ist an zwei Tracks abgelesen (einer mit, einer ohne Dreierunterteilung). Der Abstand ist klein (Faktor 1,7 nach unten, 2 nach oben).

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.8 %, maj/min 94.2 %, kind 75.7 % (triads 86.7 %, others 43.1 %) | changes on the one 80.6 % | timing +93 ms, apart 130 ms, within 90.8 %, 90 % under 395 ms, drift 10 ms/min, missed 0.5 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.5 %, maj/min 95.3 %, kind 69.8 % (triads 93.6 %, others 39.1 %) | changes on the one 95.0 % | timing +20 ms, apart 20 ms, within 96.8 %, 90 % under 101 ms, drift 171 ms/min, missed 1.4 % | tempo steady 59.7 % at most, 6.4 % off | beats +23 ms, within 50 ms 98.9 %, bars 92.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

## Phase 2: Akkorde (ab 2026-11-17)

Auftrag und Regeln in [Erkennung messen.md](../Erkennung%20messen.md), Plan in [docs/superpowers/plans/2026-11-17-analysis-phase2.md](../docs/superpowers/plans/2026-11-17-analysis-phase2.md). Hauptmaß ist `kind` im Satz „echt“ (Regeln A und B). Budget: höchstens 18 Versuche, oder bis 6 in Folge verworfen sind. Jeder Versuch steht hier mit seinen `==`-Zeilen, auch der verworfene. Ob ein Versuch bleibt, entscheiden nur die Zahlen von `analysis-score.mjs`.

Hilfsskripte dieses Laufs (nicht in Git, weil `native/tools` gesperrt ist; sie rechnen keine eigenen Trefferquoten):

| Skript | Was es tut |
|---|---|
| `native/build/phase2/measure.ps1` | ruft `analysis-score.mjs` für alle fünf Sätze auf (Originale oder eine Kopien-Fassung) und legt die Ausgabe in einer Datei ab |
| `native/build/phase2/compare.mjs` | legt zwei solche Ausgaben nebeneinander: je Track und je Satz die Felder, die sich unterscheiden; für „echt“ dazu der Zuwachs mit halbierten Gewinnen der `cycle`-Tracks und die Zahl der Tracks mit Gewinn und Verlust |
| `native/build/robust/make.ps1` | erzeugt die Kopien für die Robustheitsprüfung mit ffmpeg |
| `native/build/phase2/trace-all.ps1` | lässt `btg_analyze` mit `BTG_ANALYSIS_LOG` über alle Tracks in allen drei Fassungen laufen, behält JSON und Protokoll, sammelt die Zeile `threes:` |
| `native/build/phase2/chords-diff.mjs` | vergleicht zwei JSON von `btg_analyze` zur selben Musik: Schläge, Taktanfänge, Sekunden mit anderem Grundton oder anderer Akkordart |

### Robustheitsprüfung: andere Abtastrate und MP3 (ohne Versuchszählung)

Gemessen mit dem Stand `da62e4e` (gleich `a622b53`, dazu nur eine Protokollzeile). Der Originalstand ist vorher noch einmal gemessen und Zeile für Zeile gleich dem Endstand von Phase 1.

**Kopien** (unter `native/build/robust/`, je Fassung 13 / 18 / 18 / 6 / 8 Tracks mit kopiertem Label, Dauer höchstens 0,1 s neben der Quelle):

- `rate`: jeder Track in der jeweils anderen Abtastrate, als WAV mit 16 Bit. 9 der 13 echten Tracks haben schon 48 kHz und bekamen 44,1 kHz; die vier übrigen (Before The Dawn, Late Night Groove, Letting Go, Losing Control) und alle generierten Sätze haben 44,1 kHz und bekamen 48 kHz.
- `mp3`: jeder Track neu kodiert mit libmp3lame, 128 kbit/s, Rate wie die Quelle.

**Zahlen je Satz** (Zähler für Tempo, Taktart und Tonart sind in allen drei Fassungen gleich):

| Satz | Fassung | `root` | `maj/min` | `kind` | `triads` | `others` | `timing` innerhalb | Median Δ | `tempo steady` daneben | `bars` |
|---|---|---|---|---|---|---|---|---|---|---|
| echt | Original | 94,8 | 94,2 | 75,7 | 86,7 | 43,1 | 90,8 | +93 ms | 0,2 | – |
| echt | andere Rate | 94,8 | 94,2 | 75,5 | 86,5 | 40,9 | 91,3 | +100 ms | 0,2 | – |
| echt | MP3 | 94,8 | 94,2 | 75,5 | 86,6 | 42,5 | 90,4 | +98 ms | 0,4 | – |
| generiert | Original | 98,5 | 97,8 | 92,4 | 92,4 | – | 100,0 | +16 ms | 1,4 | 98,6 |
| generiert | andere Rate | 98,5 | 97,8 | **94,0** | 94,0 | – | 99,6 | +16 ms | 1,2 | 98,6 |
| generiert | MP3 | 98,3 | 97,6 | 92,0 | 92,0 | – | 99,5 | +19 ms | **2,1** | 96,2 |
| generiert-2 | Original | 95,5 | 95,3 | 69,8 | 93,6 | 39,1 | 96,8 | +20 ms | 6,4 | 92,9 |
| generiert-2 | andere Rate | **94,1** | 93,8 | **67,3** | 89,8 | 39,4 | **93,2** | +41 ms | **0,9** | 91,2 |
| generiert-2 | MP3 | 95,6 | 95,6 | 70,1 | 93,7 | 39,6 | 97,1 | +20 ms | 6,0 | 93,6 |
| verstimmt | Original | 82,2 | 82,2 | 78,1 | 78,1 | – | 83,3 | +12 ms | 0,3 | 99,0 |
| verstimmt | andere Rate | 82,0 | 82,0 | 78,0 | 78,0 | – | **82,2** | +12 ms | 0,0 | 99,0 |
| verstimmt | MP3 | 82,3 | 82,3 | **77,2** | 77,2 | – | 83,3 | +12 ms | 0,3 | 99,0 |
| tempo | Original | 97,8 | 96,2 | 95,1 | 95,1 | – | 92,2 | +19 ms | 6,4 | 85,9 |
| tempo | andere Rate | 97,9 | 96,3 | **95,8** | 95,8 | – | **93,1** | +20 ms | 6,5 | 85,9 |
| tempo | MP3 | **98,9** | 97,3 | **96,2** | 96,2 | – | **94,4** | +12 ms | 6,9 | 92,2 |

Fett: mehr als 0,5 Punkte neben dem Original bei `root`, `kind`, `timing` oder `tempo steady`. Der Satz „echt“ bleibt bei allen vier unter der Schwelle; `others` fällt dort um 2,2 Punkte (andere Rate) und 0,6 (MP3).

**Ursachen** (je Track verglichen: JSON und Protokoll beider Fassungen, die Schläge des Modells aus dem Zwischenspeicher):

1. **Akkordart an der Schwelle.** Bei gleichen Schlägen, Takten und Grundtönen meldet die Analyse für einzelne Akkorde eine andere Art: `maj7` statt `maj`, `dom9` statt `dom7`, `min7` statt `min`, `power` oder `sus4` statt `maj`, `min6` statt `min`. Die Art eines Akkords entscheidet sich an festen Schwellen für die Stärke einzelner Töne; liegt ein Akkord nahe an einer Schwelle, kippt er bei jeder kleinen Änderung des Spektrums. Das Spektralfenster hat 4096 Samples bei halber Rate, also 186 ms bei 44,1 kHz und 171 ms bei 48 kHz; MP3 ändert das Spektrum ebenfalls. In einem generierten Track von 30 bis 50 s sind ein Akkord 3 bis 4 s und damit 6 bis 12 Punkte. Beispiele (andere Rate): `poppunk-11` 72,3 → 84,8 %, `rock-11` 86,5 → 98,7 %, `poppunk-12` 84,8 → 96,4 % (dort verschwinden falsche `maj7`, `dom9`, `min7`); `dreamy-12` 98,1 → 91,9 % (`maj` als `power`); `hardrock-68-180` 91,6 → 79,4 %; `hardrock-colours` 49,7 → 41,5 %. Echte Tracks: `qmlHtyS_P8k` 83,4 → 78,5 % (17 s `maj` als `sus4`), One Last Time `others` 92,1 → 81,9 % (7 s `min7` als `min`), `9pH42-82Mz0` `others` 55,9 → 44,1 %. MP3: `rock-12` 92,6 → 86,5 %, `dreamy-11 −25 Cent` 99,4 → 93,4 %, `qmlHtyS_P8k` 83,4 → 80,8 %. Das erklärt `kind` in „generiert“ (+1,6) und „verstimmt“ (−0,9) und `others` in „echt“.
2. **Akkordfolge an knappen Stellen.** Back Door Blues (andere Rate): 11 s anderer Grundton (E7 statt A7 und umgekehrt), `timing` 83,9 → 91,1 %; vier der sechs Wechsel „zwei Schläge zu früh“ liegen in der Kopie richtig. Late Night Groove: 12 s (Gm7 gegen Bb6), `root` 93,2 → 92,1 %. `dreamy-128-90`: 0,6 s (Bm gegen F#) machen dort 1,4 Punkte `root`; in beiden Kopien steht der Track wieder bei 93,2 %, obwohl der Schlag bei 38,92 s in der Raten-Kopie genauso gestrichen wird.
3. **Fenstergrenze der vorgezogenen Akkorde.** Die Regel aus Versuch 1 von Phase 1 gilt nur, wo die Strecke vom Achtel bis zum Schlag länger ist als das Spektralfenster. Das Fenster hängt an der Abtastrate. Back Door Blues (Swing, Strecke 177 ms): bei 48 kHz 12 von 101 Wechseln vorgezogen, in der 44,1-kHz-Kopie 1 von 100. `qmlHtyS_P8k` (170 bpm, halber Schlag 176 ms): 6 von 120 gegen 0.
4. **„Hat das Modell den Puls verloren?“ ist eine harte Grenze (10 % Ausreißer).** `country-12`: im Original 10 von 71 Abständen daneben (eigene Schlagsuche), als MP3 7 von 70 (Schläge des Modells); `beats` innerhalb 50 ms 98,4 → 84,4 %. `faster-60-66-psych`: im Original 5 von 101 (Modell), als MP3 12 von 108 (eigene Schlagsuche, 126 statt 63 bpm). Das Modell selbst liefert für die MP3-Fassung einzelne Schläge mehr oder weniger (72 gegen 71, 102 gegen 109).
5. **„Sind die Takte des Modells gleichmäßig?“ ist ebenfalls eine harte Grenze (60 % gleich lange Takte).** `slower-80-66-dreamy`: im Original gelten die Takte des Modells (`bars` 50 %), als MP3 nicht (durchgezählt, `bars` 100 %, `root` 90,9 → 99,6 %). `dreamy-11`: umgekehrt, `bars` 93,8 → 50,0 %. `dreamy-128-90`: als MP3 gelten die Takte des Modells, `bars` 93,8 → 100 %. Das erklärt die Bewegung im Satz „tempo“ (MP3) und `tempo steady` in „generiert“ (MP3).
6. **Eigene Schlagsuche wählt zwischen Vielfachen des Tempos.** `rock-34-160` (3/4 bei 160 bpm, schon im Original falsch): Das Modell liefert in beiden Fassungen dieselben 61 Schläge und wird beide Male verworfen. Die eigene Schlagsuche findet bei 44,1 kHz 106 bpm (punktierter Schlag, dann 12/8), bei 48 kHz 80 bpm (halbes Tempo, 4/4). `root` 99,4 → 62,4 %. Dieser eine Track macht in generiert-2 (andere Rate) −2,1 Punkte `root` aus; dass der Satz nur 1,4 verliert, liegt an Gewinnen anderer Tracks (`hardrock-68-180` +5,6, `country-open` +4,1, `dreamy-128-90` +1,4, Ursachen 1 und 2). Er erklärt auch den größten Teil von `kind`, `timing` und `tempo steady` dort.
7. **Kein Versatz durch MP3.** `beats` (Median) in den generierten Sätzen: +15 → +19, +23 → +23, +14 → +14, +19 → +12 ms. Der Vorlauf des Encoders wird beim Dekodieren abgezogen. Die geschätzte Stimmung weicht höchstens 2 Cent ab.

**Dreierprüfung (Untergrenze 1,5 %).** Protokollzeile `threes:` für alle 63 Tracks in allen drei Fassungen (189 Läufe). Die Zahl ist die Stärke auf den Dritteln geteilt durch die Summe aus der Stärke in der Mitte und einem Hundertstel der Stärke auf den Schlägen; über 1,5 gilt die Dreierunterteilung.

| Track | Original | andere Rate | MP3 | Urteil |
|---|---|---|---|---|
| `dreamy-128-90` (12/8) | 3,14 | 3,04 | 3,44 | ja, in allen dreien |
| `rock-34-160` | 1,91 | 0,01 | 2,01 | ja / nein / ja: andere Schläge (Ursache 6), nicht die Untergrenze; auf den Dritteln liegen dort echte Achtel (9,7 % der Stärke auf den Schlägen) |
| `reggae-128-60` (12/8, Schläge sind die Achtel) | 0,78 | 0,51 | 0,50 | nein, in allen dreien |
| `country-open` | 0,43 | 0,52 | 0,32 | nein |
| `country-12` | 0,02 | 0,02 | 0,32 | nein |
| alle übrigen (174 Läufe) | 0,00 bis 0,27 | | | nein |

Der Plan nannte drei Bedingungen: kein Track wechselt sein Urteil, der größte Wert ohne Dreierunterteilung ist höchstens 1,0, der kleinste mit mindestens 2,25. Wörtlich sind die erste und die dritte nicht erfüllt, beide wegen `rock-34-160` (Urteil ja / nein / ja, Werte 1,91 und 2,01). Ich werte den Track nicht als Fall der Untergrenze, weil dort andere Schläge gemessen werden. Ohne ihn gilt: Die Untergrenze hält. Kein Urteil kippt an ihr, der größte Wert ohne Dreierunterteilung ist 0,78 (Faktor 1,9 unter der Grenze), der kleinste echte Fall 3,04 (Faktor 2 darüber). `rock-34-160` liegt mit 1,91 und 2,01 näher an der Grenze (Faktor 1,3); dort ist das Urteil „ja“ zu den Schlägen, die die eigene Schlagsuche liefert, richtig, falsch sind die Schläge.

**Behoben ist nichts.** Keine der Ursachen ist ein klarer, kleiner Fehler: 1 bis 3 folgen daraus, dass das Fenster in Samples feststeht (Vorschlag Nr. 7 in [VORSCHLAEGE.md](VORSCHLAEGE.md): immer bei derselben Rate analysieren); 4 bis 6 sind harte Grenzen in den Regeln für Schläge und Takte, an denen einzelne generierte Tracks liegen.

**Was das für Phase 2 heißt.** Die Zahlen bewegen sich von allein, wenn sich an der Musik nichts ändert:

- Satz „echt“: `root` und `maj/min` 0,0 Punkte, `kind` 0,2, `triads` 0,2, `timing` 0,5, `others` bis 2,2. Ein Gewinn von einem Punkt bei `kind` liegt klar darüber, ein halber Punkt nur knapp. `others` im Satz „echt“ taugt nicht als Beleg für kleine Gewinne.
- Einzelne echte Tracks: `kind` bis 4,9 Punkte (`qmlHtyS_P8k`), `others` bis 11,8. „Vier Tracks gewinnen“ ist bei kleinen Beträgen kein starkes Zeichen.
- generiert-2: `others` 0,5 Punkte. Einzelne generierte Tracks: `kind` bis 12 Punkte.
- Am Schluss werden beide Kopien-Sätze noch einmal gemessen: Ein behaltener Versuch muss dort denselben Gewinn zeigen.

### Ausgangsstand für Phase 2

Gemessen mit `da62e4e`, dreimal, Ausgabe gleich und gleich dem Endstand von Phase 1. Alle Zahlen je Track stehen in [Erkennung messen.md](../Erkennung%20messen.md), „Ausgangsstand für Phase 2“.

Was `--confusions` zeigt. Sekunden im Satz „echt“ bei richtigem Grundton: `dom7 → maj` 167, `min → min7` 148, `min9 → min` 116, `power → min` 83, `sus2 → min` 78, `maj → sus4` 54, `maj7 → maj` 54, `sus2 → maj` 51, `sus2 → add9` 28.

| Track | `kind` (`triads` / `others`) | Was fehlt |
|---|---|---|
| Before The Dawn | 66,5 (86,2 / 0,0) | Dsus2 immer als Dm; G → Dm 12 s und F → Dm 7 s (Wechsel zwei Schläge zu früh) |
| Letting Go | 72,3 (94,5 / 25,1) | Bbsus2 als Bb oder Bbadd9 |
| Losing Control | 52,2 (87,9 / 0,0) | B5 als Bm, Gmaj7 als G |
| Late Night Groove | 69,1 (69,1 / –) | Gm als Gm7 und Bb6 (das Label nennt Dreiklänge) |
| One Last Time | 73,2 (72,2 / 92,1) | Dreiklänge als andere Art gemeldet |
| `V1r4wWATS9Y` (`cycle`) | 49,9 (95,8 / 4,7) | E7 als E, Em7, G6 |
| Back Door Blues | 86,5 (81,8 / 93,5) | E → A 16 s, E → Asus4 7 s, A7 → E7 6 s |
| generiert-2: `country-open`, `psych-open`, `rock-open` | 28,7 / 29,1 / 37,0 | Esus4 als Asus2, A oder Aadd9 (dieselben Töne, anderer Grundton); F#sus4 als B5; `root` 74,0 % bei `country-open` |
| generiert-2 gesamt | `others` 39,1 | `maj7 → maj` 60, `power → maj` 18, `power → min` 18, `sus2 → maj` 17, `add9 → maj` 15, `sus2 → add9` 14, `sus4 → min` 11 |

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.8 %, maj/min 94.2 %, kind 75.7 % (triads 86.7 %, others 43.1 %) | changes on the one 80.6 % | timing +93 ms, apart 130 ms, within 90.8 %, 90 % under 395 ms, drift 10 ms/min, missed 0.5 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.5 %, maj/min 95.3 %, kind 69.8 % (triads 93.6 %, others 39.1 %) | changes on the one 95.0 % | timing +20 ms, apart 20 ms, within 96.8 %, 90 % under 101 ms, drift 171 ms/min, missed 1.4 % | tempo steady 59.7 % at most, 6.4 % off | beats +23 ms, within 50 ms 98.9 %, bars 92.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 1: Ein überzähliger Schlag darf überall zwischen zwei Schlägen liegen – erst knapp behalten (`4415353`), nach der Prüfung zurückgenommen (`4179a5b`), Vorschlag Nr. 11

**Nachtrag nach der Prüfung:** Der Prüf-Subagent wertet das Behalten als Verstoß gegen Punkt 1 der Regel (auf die Genauigkeit der `==`-Zeilen bewegt sich weder `timing` noch `tempo steady` im Satz „echt“ oder „tempo“), und die strenge Fassung von Versuch 2 war bei größerem Gewinn ohne Verlust verworfen worden. Der Versuch ist deshalb zurückgenommen; die Änderung (eine Zahl, ein Test) steht als Vorschlag Nr. 11 in [VORSCHLAEGE.md](VORSCHLAEGE.md). Der Text darunter ist der Stand vor der Prüfung.

Ein Versuch an den Schlägen, gewertet nach den Regeln für Takte und Zeitlage. Anlass: `dreamy-128-90` verliert seit Versuch 5 von Phase 1 1,4 Punkte `root`.

- **Diagnose** (Protokoll; der Bau mit `-Tuning` und `BTG_EXTRA=0` ist der Stand ohne die Regel): Das Modell liefert bei diesem 12/8-Track punktierte Schläge im Abstand von 0,667 s und dazwischen zwei überzählige auf den Achteln, bei 38,92 s (0,24 s nach einem Schlag) und bei 39,80 s (0,44 s nach einem Schlag, also 0,66 des Abstands). Die Regel aus Phase 1 streicht nur, was dichter als 0,6 des Abstands folgt: 38,92 fällt weg, 39,80 bleibt. Der gestrichene Schlag ist kein Schlag des Labels (0,25 s neben dem nächsten). Mit dem übrigen überzähligen Schlag liegt der letzte Taktanfang auf 39,80 statt 40,02 s und der letzte Akkord F# auf 40,70 statt 40,02 s (Label 40,00 s). Der Plan wollte am Achtel-Raster des Labels entscheiden, ob der gestrichene Schlag echt war; das trägt nicht, weil im 12/8 jeder Schlag des Modells auf einem Achtel liegt. Entschieden ist deshalb gegen die Schläge des Labels.
- **Hypothese (vor der Messung):** Ein Schlag zwischen zwei Schlägen im üblichen Abstand ist überzählig, wo immer er liegt, nicht nur in den ersten 60 % der Strecke. Im 12/8 liegen solche Schläge auf einem oder zwei Dritteln. Gewinnen sollte `dreamy-128-90`, vielleicht `tempo steady` bei Back Door Blues und Letting Go. Risiko: Tempowechsel, Swing.
- **Änderung:** `EXTRA` 0,6 → 0,8 (durchprobiert: 0,7 und 0,8, beide mit demselben Ergebnis; 0,8 lässt Abstand zu zwei Dritteln und bleibt unter 0,85, wo die Toleranz des nächsten Schlags beginnt). Neuer Test: ein überzähliger Schlag bei 0,66 des Abstands fällt weg (schlug vorher fehl).
- **Zahlen (gegen den Ausgangsstand):** Zwei Tracks ändern sich, alle anderen 61 sind Zeile für Zeile gleich.

| Track | vorher | nachher |
|---|---|---|
| `dreamy-128-90` `root` / `maj/min` | 91,8 / 79,4 | 93,2 / 80,8 |
| `dreamy-128-90` `timing` innerhalb, `bars`, auf der Eins | 80,0 / 93,8 / 93,3 | 86,7 / 100,0 / 100,0 |
| `dreamy-128-90` `tempo steady` daneben | 6,9 % | 0,0 % |
| Back Door Blues `tempo steady` daneben | 1,2 % | 0,3 % |
| generiert-2 `tempo steady` / `bars` / `timing` | 6,4 / 92,9 / 96,8 | 6,0 / 93,3 / 97,1 |
| echt `tempo steady`, größte Abweichung / daneben | 15,4 / 0,2 | 14,9 / 0,2 |

- **Urteil: behalten, aber knapp, und der Nutzer sollte es sehen.** Punkt 1 der Regel verlangt, dass `tempo steady` (`off`) im Satz „echt“ oder „tempo“ besser wird. Besser wird es im Satz „echt“ nur durch Back Door Blues (1,2 → 0,3 %); das Mittel der 13 Trackwerte geht von 0,24 auf 0,17, die Zeile des Satzes zeigt auf eine Nachkommastelle beide Male 0,2. Ein Gewinn im Sinn der Regel ist das kaum. Für das Behalten spricht: Kein Wert irgendeines Tracks wird schlechter, der vom Nutzer genannte Verlust ist behoben, und die Regel war an der Stelle lückenhaft (wie Versuch 7 von Phase 1, der ohne Änderung der Zahlen blieb). Die Punkte 2 bis 7 sind erfüllt, die Akkordregeln 2 bis 6 ebenfalls.
- **Einordnung:** Die Robustheitsprüfung hat gezeigt, dass `root` bei diesem Track auch ohne die Änderung an 0,6 s hängt (in beiden Kopien 93,2 %). Belastbar ist hier der Gewinn bei den Takten (`bars` 100 %, `tempo steady` 0,0 %), nicht der bei `root`.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.8 %, maj/min 94.2 %, kind 75.7 % (triads 86.7 %, others 43.1 %) | changes on the one 80.6 % | timing +93 ms, apart 130 ms, within 90.8 %, 90 % under 395 ms, drift 10 ms/min, missed 0.5 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.6 %, maj/min 95.3 %, kind 69.9 % (triads 93.7 %, others 39.1 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.1 %, 90 % under 101 ms, drift 149 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 2: Ein Wechsel in der Taktmitte braucht den Bass – verworfen

Ein Versuch an der Lage der Akkordwechsel, gewertet nach den Regeln für die Zeitlage, dazu die Akkordregeln 2 bis 6. Anlass: Before The Dawn und Back Door Blues melden einzelne Wechsel zwei Schläge zu früh.

- **Diagnose** (neue Protokollzeile `change:` je Akkordwechsel: Stelle im Takt, Stärke des alten und des neuen Grundtons im Bass bis zum nächsten Taktanfang; Hilfsskript `native/build/phase2/midbar.mjs` legt die Zeilen neben die Labels). Wechsel in der Taktmitte, deren Akkord über den nächsten Taktanfang bleibt und die das Label ein bis drei Schläge später nennt:

| Track | solche Wechsel | alter Grundton im Bass geteilt durch neuen |
|---|---|---|
| Back Door Blues | 6 (A7 → E) | 3 bis 4: der Bass liegt klar noch auf dem alten |
| Before The Dawn | 16 (12-mal G → Dsus2, 4-mal G → F) | 0,73 bis 1,19: beide etwa gleich stark |
| Letting Go | 6 (Gm11 → Bbsus2) | 0,3 bis 0,5: der Bass liegt schon auf dem neuen |
| One Last Time | 1 | über 1 |

  `9pH42-82Mz0` hat 24 Wechsel in der Taktmitte; keiner bleibt über den Taktanfang, die Regel berührt sie nicht. Die Schwelle des Plans (bei Before The Dawn an 10 von 15 Stellen der alte Grundton stärker) ist verfehlt (5 von 16). Der Versuch lief trotzdem, mit der Grenze aus der Lücke in dieser Tabelle (0,6, zwischen 0,5 und 0,73).
- **Hypothese:** Wo ein Akkord in der Taktmitte beginnt und über den Taktanfang bleibt, der Bass aber nicht auf seinen Grundton gegangen ist, sind die Oberstimmen früh oder spielen einen Übergang; der Akkord beginnt am Taktanfang.
- **Änderung:** eine Regel nach den Durchgangsakkorden, nur in geraden Takten ab vier Schlägen, nicht in 6/8 und 12/8; Knopf `HALF_BASS` (alter Grundton stärker als `HALF_BASS` mal neuer). Test: Oberstimmen jedes vierten Takts zwei Schläge früh, Bass pünktlich; schlug vorher fehl (18 von 24 Wechseln auf dem Taktanfang), danach 23 von 24.
- **Zahlen** (gegen Versuch 1), fünf Werte:

| `HALF_BASS` | echt `timing` | echt `root` / `maj/min` | tempo `timing` | tempo `triads` | tempo `root` |
|---|---|---|---|---|---|
| ohne Regel | 90,8 | 94,8 / 94,2 | 92,2 | 95,1 | 97,8 |
| 0,6 | 93,5 | 95,3 / 94,8 | 89,8 | 94,3 | 97,0 |
| 0,85 | 93,2 | 95,2 / 94,7 | 90,9 | 94,7 | 97,4 |
| 1,0 | 92,5 | 95,1 / 94,5 | 91,4 | 94,9 | 97,6 |
| 1,2 und 1,5 | 92,1 | 95,0 / 94,4 | 92,2 | 95,1 | 97,8 |

  Mit 0,6: Before The Dawn `timing` 74,6 → 87,3 %, `root` 89,2 → 93,1 %; Back Door Blues `timing` 83,9 → 94,6 %, `root` 90,8 → 92,2 %; `hardrock-colours` (generiert-2) `root` 97,2 → 99,2 %. Verloren: `slower-80-66-dreamy` `root` 90,9 → 88,9 %, `timing` 76,5 → 70,6 %; `step-80-62-hardrock` `root` 95,9 → 91,5 %, `timing` 60,9 → 47,8 %. Beide Tracks haben falsche Takte (Taktanfänge des Modells einen Schlag daneben; eigene Schlagsuche mit falschem Tempo): Dort liegt ein echter Wechsel in der „Taktmitte“, und im tiefen Register klingt der alte Grundton als Akkordton weiter.
- **Urteil:** Keine Fassung erfüllt die Regeln. Bis 1,0 fällt `timing` im Satz „tempo“ um mehr als einen Punkt oder `triads` fällt. Ab 1,2 verliert kein Track etwas, aber `timing` im Satz „echt“ steigt nur um 1,3 Punkte (verlangt: 2), fast ganz aus Back Door Blues. Der Bass, wie die Analyse ihn misst (alles unter 260 Hz, also auch tiefe Gitarrentöne), trennt bei Before The Dawn „Oberstimmen früh“ nicht von einem echten Wechsel. Code zurückgesetzt; die strenge Fassung steht als Vorschlag Nr. 8 in [VORSCHLAEGE.md](VORSCHLAEGE.md).

Mit `HALF_BASS` 0,6:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.3 %, maj/min 94.8 %, kind 76.2 % (triads 87.3 %, others 43.6 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.5 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.5 %, kind 70.1 % (triads 93.7 %, others 39.6 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.0 %, maj/min 95.4 %, kind 94.3 % (triads 94.3 %, others –) | changes on the one 90.9 % | timing +46 ms, apart 46 ms, within 89.8 %, 90 % under 267 ms, drift 162 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

Mit `HALF_BASS` 1,2 (gleich 1,5):

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.0 %, maj/min 94.4 %, kind 75.9 % (triads 86.8 %, others 43.6 %) | changes on the one 80.6 % | timing +99 ms, apart 127 ms, within 92.1 %, 90 % under 319 ms, drift 10 ms/min, missed 0.5 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.5 %, kind 70.1 % (triads 93.7 %, others 39.6 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 3: Der Bass zählt in der Taktmitte weniger – verworfen

- **Hypothese (aus Versuch 2):** Der Bass spielt in der Taktmitte oft die Quinte. Zählt er dort (`BASS_HALF` 0,3), gewinnt ein Akkord auf der Quinte einen halben Takt zu früh (Before The Dawn: G → Dm). Gewinnen sollte Before The Dawn; Risiko: `9pH42-82Mz0` mit echten Wechseln in der Taktmitte.
- **Änderung:** `BASS_HALF` 0,3 → 0 / 0,1 / 0,15 / 0,2 (Bau mit `-Tuning`, alle fünf Sätze).
- **Zahlen** (gegen Versuch 1):

| `BASS_HALF` | echt `root` | echt `maj/min` | echt `kind` | echt `timing` | Before The Dawn `root` | `9pH42-82Mz0` `root` |
|---|---|---|---|---|---|---|
| 0,3 (heute) | 94,8 | 94,2 | 75,7 | 90,8 | 89,2 | 93,5 |
| 0,2 | 94,9 | 94,2 | 75,8 | 90,5 | 89,7 | 93,0 |
| 0,15 | 94,7 | 94,0 | 75,7 | 90,3 | 89,7 | 91,3 |
| 0,1 | 94,3 | 93,5 | 75,3 | 89,4 | 89,7 | 89,1 |
| 0 | 93,6 | 92,7 | 74,6 | 87,9 | 89,7 | 87,4 |

- **Urteil:** Die Hypothese stimmt nicht. Before The Dawn gewinnt bei jedem Wert nur 0,5 Punkte; die frühen Wechsel hängen nicht am Gewicht des Basses in der Taktmitte. Je kleiner der Wert, desto mehr verlieren die Tracks, die wirklich in der Taktmitte wechseln (`9pH42-82Mz0`, Letting Go, Losing Control, One Last Time). A und B sind bei keinem Wert erfüllt. Nichts geändert.

Mit `BASS_HALF` 0,2:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 94.9 %, maj/min 94.2 %, kind 75.8 % (triads 86.9 %, others 43.2 %) | changes on the one 80.6 % | timing +93 ms, apart 130 ms, within 90.5 %, 90 % under 393 ms, drift 12 ms/min, missed 0.6 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.6 %, maj/min 95.1 %, kind 69.7 % (triads 93.7 %, others 38.6 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 96.8 %, 90 % under 101 ms, drift 149 ms/min, missed 1.8 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

Mit `BASS_HALF` 0:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 93.6 %, maj/min 92.7 %, kind 74.6 % (triads 85.5 %, others 38.5 %) | changes on the one 80.6 % | timing +89 ms, apart 132 ms, within 87.9 %, 90 % under 476 ms, drift 11 ms/min, missed 2.2 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.8 %, maj/min 96.1 %, kind 69.7 % (triads 94.9 %, others 38.6 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.0 %, 90 % under 101 ms, drift 65 ms/min, missed 2.0 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 4: Ein Wechsel in der Taktmitte, den der Bass erst am Taktanfang macht, gehört an den Taktanfang – behalten (`f1f687a`)

Die eine Nachbesserung zu Versuch 2, gewertet nach den Regeln für die Zeitlage, dazu die Akkordregeln 2 bis 6.

- **Diagnose** (Protokollzeile `change:` jetzt auch mit der Stärke beider Grundtöne im Bass nach dem Taktanfang; `midbar.mjs` über alle fünf Sätze): Versuch 2 fragte, ob der alte Grundton im Bass noch da ist. Das trennt nicht, weil im tiefen Register auch Akkordtöne liegen. Was trennt, ist, wo der Bass kippt. Verhältnis neuer zu alter Grundton im Bass, vor und nach dem Taktanfang:

| Gruppe | Wechsel | vor dem Taktanfang | nach dem Taktanfang | alter Grundton vorher, geteilt durch neuen |
|---|---|---|---|---|
| zu früh gemeldet: Before The Dawn G → Dsus2 | 12 | 0,84 bis 1,38 | 5,9 bis 16,6 | 0,72 bis 1,19 |
| zu früh gemeldet: Back Door Blues A7 → E | 6 | 0,23 bis 0,32 | 28 bis 44 | 3 bis 4 |
| zu früh gemeldet: One Last Time, `hardrock-colours` | je 1 | 0,40 und 0,32 | 5,1 und 4,1 | 2,5 und 3,1 |
| zu früh laut Label, Bass schon auf dem neuen: Letting Go Gm11 → Bbsus2 | 6 | 2,0 bis 3,3 | 12 bis 25 | 0,30 bis 0,50 |
| zu früh laut Label: Before The Dawn G → F | 4 | 0,99 bis 1,21 | 0,94 bis 1,43 | 0,8 bis 1,0 |
| richtig in der Taktmitte (Satz „tempo“, Takte falsch erkannt) | 9 | 0,98 bis 9,7 | 0,39 bis 11,6 | höchstens 0,38, wo das Verhältnis um mehr als das 1,5-fache steigt |

- **Hypothese (vor der Messung):** Ein Akkord, der in der Taktmitte beginnt und über den Taktanfang bleibt, beginnt am Taktanfang, wenn der Bass dort kippt: Bis zum Taktanfang ist der alte Grundton im Bass noch mindestens halb so stark wie der neue, und am Taktanfang steigt das Verhältnis neu zu alt auf mindestens das Dreifache. Erwartet: Before The Dawn 12 von 16, Back Door Blues 6 von 6, je einer bei One Last Time und `hardrock-colours`; keiner der 9 echten Wechsel im Satz „tempo“, keiner bei Letting Go.
- **Änderung:** eine Regel nach den Durchgangsakkorden, nur in geraden Takten ab vier Schlägen, nicht in 6/8 und 12/8. Knöpfe `HALF_STILL` 0,5 und `HALF_TIPS` 3, beide an der Tabelle abgelesen, nicht an den Trefferquoten durchprobiert. Abgelesen heißt aber: an denselben Tracks gewählt, an denen gemessen wird. Die Lücke für `HALF_STILL` ist enger als zuerst notiert: Bei Letting Go, das sich nicht bewegen soll, reicht der alte Grundton bis 0,50 des neuen, die zu frühen Wechsel beginnen bei 0,72. Seit der Prüfung steht der Wert bei 0,6 (Nachtrag unten). Test: Oberstimmen jedes vierten Takts zwei Schläge früh, Bass pünktlich (vorher 18 von 24 Wechseln auf dem Taktanfang, danach 23 von 24); gehen Oberstimmen und Bass zusammen früh, bleibt der Wechsel in der Taktmitte.
- **Zahlen (gegen Versuch 1):** Vier Tracks ändern sich, alle gewinnen; die übrigen 59 sind Zeile für Zeile gleich.

| Track | `timing` innerhalb | `root` | `maj/min` | `kind` (`triads`) |
|---|---|---|---|---|
| Before The Dawn | 74,6 → 84,1 % | 89,2 → 92,2 | 87,8 → 92,2 | 66,5 → 69,9 (86,2 → 90,7) |
| Back Door Blues | 83,9 → 94,6 % | 90,8 → 92,2 | 90,8 → 92,2 | 86,5 → 88,7 (81,8 → 82,7) |
| One Last Time | 97,0 → 98,0 % | 95,7 → 95,9 | 95,7 → 95,9 | 73,2 → 73,4 |
| `hardrock-colours` (generiert-2) | 94,4 → 100,0 % | 97,2 → 99,2 | 97,2 → 99,2 | 49,7 → 53,8 |

| Satz | `timing` innerhalb | Median \|Δ\| | `root` | `maj/min` | `kind` (`triads` / `others`) |
|---|---|---|---|---|---|
| echt | 90,8 → 93,1 % | 130 → 125 ms | 94,8 → 95,2 | 94,2 → 94,7 | 75,7 → 76,2 (86,7 → 87,2 / 43,1 → 43,6) |
| generiert-2 | 97,1 → 97,4 % | 20 ms | 95,6 → 95,7 | 95,3 → 95,5 | 69,9 → 70,1 (93,7 / 39,1 → 39,6) |
| generiert, verstimmt, tempo | unverändert | | | | |

- **Urteil:** `timing` im Satz „echt“ steigt um 2,3 Punkte (verlangt: 2). Kein Zähler, kein `bars`, kein `changes on the one`, kein `tempo steady` ändert sich; `root`, `maj/min` und `triads` fallen in keinem Satz, kein Track verliert irgendwo. Behalten.
- **Offen:** die vier Wechsel G → F bei Before The Dawn (der Bass zeigt dort auch nach dem Taktanfang kein klares F) und die sechs bei Letting Go (der Bass spielt den neuen Grundton schon zwei Schläge vor dem Label). Die beiden Grenzen sind an den Fällen dieser Sätze abgelesen (20 verschobene Wechsel, 10 laut Label zu frühe, die bleiben, 9 echte Wechsel in der Taktmitte); ob sie halten, zeigt die Messung der Kopien am Schluss und die der unangetasteten Tracks.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 76.2 % (triads 87.2 %, others 43.6 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.1 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.5 %, kind 70.1 % (triads 93.7 %, others 39.6 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Diagnose vor den Versuchen an der Akkordart

Zwei Protokollzeilen (`kind:` je Akkord mit der Stärke jedes Tons über dem Grundton, gemessen an Grundton und Quinte) und drei Hilfsskripte unter `native/build/phase2/`: `kinds-by-track.mjs` (welche Label-Art als was gemeldet wird, je Track), `kinds-trace.mjs` (Verteilung der Tonstärken je Label-Art; mit `--rule`, wo eine Bedingung zuträfe) und `kinds-sim.mjs` (liest die Art eines Akkords aus seinen Tönen mit den Schwellen von `analysis.cpp` nach und probiert eine Regel daran aus; stimmt bei 2392 von 2394 Akkorden mit der Analyse überein). Alle drei sagen nur voraus; entschieden wird an `analysis-score.mjs`.

Stärke der Töne nach Label-Art, Tracks mit Zeit-Labels, nur wo der Grundton stimmt (Median, in Klammern 10 % und 90 %):

| Label | Satz | Sekunden | Sekunde | Terz | Quarte | kleine Septime | große Septime |
|---|---|---|---|---|---|---|---|
| Dur-Dreiklang | echt | 1940 | 0,32 (0,14 bis 0,54) | 0,53 (0,38 bis 0,71) | 0,23 | 0,27 | 0,21 (bis 0,36) |
| Moll-Dreiklang | echt | 728 | 0,30 | 0,64 (0,33 bis 0,89) | 0,28 | 0,48 (0,12 bis 0,78) | 0,17 |
| sus2 | echt | 194 | 0,45 (0,37 bis 0,82) | 0,41 (0,32 bis 0,45) | 0,24 | 0,35 | 0,23 |
| Powerchord (B5) | echt | 80 | 0,14 | 0,27 (0,24 bis 0,33) | 0,23 | 0,35 | 0,13 |
| m7 | echt | 58 | 0,48 | 0,92 | 0,71 | 1,00 (0,75 bis 1,16) | 0,29 |
| maj7 (Gmaj7) | echt | 57 | 0,41 | 1,15 | 0,22 | 0,40 | 0,46 (0,19 bis 0,57) |
| Dur-Dreiklang | generiert-2 | 248 | 0,36 | 0,81 (0,42 bis 1,04) | 0,23 | 0,27 | 0,29 (bis 0,41) |
| sus2 | generiert-2 | 29 | 0,78 (0,46 bis 1,07) | 0,35 (0,27 bis 0,58) | 0,37 | 0,34 | 0,24 |
| sus4 | generiert-2 | 22 | 0,49 | 0,35 (0,32 bis 0,72) | 0,76 (0,60 bis 0,97) | 0,47 | 0,29 |
| Powerchord | generiert-2 | 36 | 0,37 | 0,44 (0,29 bis 0,61) | 0,29 | 0,33 | 0,26 |
| maj7 | generiert-2 | 99 | 0,38 | 0,82 | 0,26 | 0,26 | 0,63 (0,52 bis 0,82) |

Was daraus folgt, jeweils ohne Versuch:

- **sus2 (Kandidat des Nutzers).** In echten Tracks ist die Terz auch bei Dreiklängen schwach (Median 0,53), „Terz schwach“ unterscheidet dort nichts. Eine Regel „Sekunde über 0,7, lauter als die Terz, Terz unter 0,5“ träfe 28 s der Label-sus2 (Bbsus2 bei Letting Go), aber 67 s der Label-Dur-Akkorde: F bei Before The Dawn in 54 von 105 s, Eb bei One Last Time in 25 s, Bb bei Letting Go in 18 s. Ohne die Bedingung an die Terz sind es 104 s. `triads` fiele im Satz „echt“, Regel 4 wäre verletzt. Dsus2 bei Before The Dawn hat die Sekunde bei 0,41 und die Terz bei 0,41: im Spektrum ein d-Moll mit Sekunde, nicht zu trennen.
- **Powerchords (Kandidat des Nutzers).** „Terz unter 0,35 und Sekunde unter 0,2“ träfe alle 80 s B5 bei Losing Control, aber nichts in generiert-2 (dort haben Powerchords eine Terz von 0,44), dafür 22 s Em und Am in echten Tracks und 17 s Dur-Akkorde im Satz „tempo“. Der Gewinn käme aus einem Track, `others` in generiert-2 stiege nicht, `triads` fiele im Satz „tempo“: nach den Vorgaben des Nutzers kein Versuch.
- **Septimen, die das Label nicht nennt** (`min → min7` 148 s). Late Night Groove, Label Gm: Septime im Median 0,94, Terz 0,75. Im Spektrum sieht das wie Gm7 aus (gehört ist es nicht); ein Fall für [LABEL-VERDACHT.md](LABEL-VERDACHT.md). One Last Time, Label Gm: Septime 0,75, Terz 0,89; knapp über der Schwelle 0,65. Eine höhere Schwelle für Moll gewänne dort, verlöre aber Dm7 im selben Track und die Septakkorde von generiert-2 (Median 0,67): ein Gewinn aus einem Track gegen genaue Labels, kein Versuch.
- **Septimen, die fehlen** (`maj7 → maj` 54 s bei Losing Control, 60 s in generiert-2). Gmaj7 hat die große Septime bei 0,46, Dur-Dreiklänge in „generiert“ bis 0,57: keine Schwelle trennt das.
- **Grundton bei sus-Akkorden** (Task 7 des Plans, `country-open` 74 % `root`). Esus4 und Asus2 haben dieselben Töne; die Analyse meldet beide Takte als einen Akkord auf A. Eine Umdeutung nach dem Bass müsste den Akkord dazu am Taktanfang teilen. Der Gewinn läge nur in generiert-2; im Satz „echt“ gibt es keinen solchen Fall, A oder B wären dort nicht zu erfüllen. Kein Versuch, Vorschlag Nr. 10 in [VORSCHLAEGE.md](VORSCHLAEGE.md).
- **Back Door Blues, „E → A 16 s, E → Asus4 7 s“:** ein Basslauf in den letzten zwei Schlägen vor B7 und der Turnaround-Takt, den das Label als E führt. Das Spektrum zeigt dort die Töne des Laufs (A, A#, H) und nicht die von E; das Label ist vermutlich gröber als die Musik. Kein Versuch.

### Versuch 5: Knappe Akkordarten folgen dem Track – verworfen

- **Hypothese (aus der Robustheitsprüfung, Ursache 1, und aus `kinds-sim.mjs`):** Die Art eines Akkords kippt, wo ein Ton nahe an seiner Schwelle liegt. Ein Akkord ist knapp, wenn 20 % strengere und 20 % lockerere Schwellen ihn verschieden lesen. Ein knapper Akkord bekommt von diesen Lesarten und seiner eigenen die Art, die die klaren Akkorde mit demselben Grundton und derselben Terz im Track am längsten haben. Erwartet: `triads` steigt in jedem Satz, `kind` im Satz „echt“ um 0,5 bis 1 Punkt, One Last Time verliert etwa 2 Punkte.
- **Änderung:** Die Akkordart wird aus den Tönen mit einem Maß für die Strenge gelesen (bei Strenge 1 Zeile für Zeile dieselben Ergebnisse wie vorher, gemessen); Knopf `K_CLOSE`. Test: C sechsmal, jedes zweite Mal mit einem leisen H; vorher „maj maj7“ im Wechsel, danach sechsmal „maj“; mit lautem H bleibt es Cmaj7.
- **Zahlen** (gegen Versuch 4), vier Werte:

| `K_CLOSE` | echt `kind` | mit halbierten `cycle`-Gewinnen | echt `triads` / `others` | generiert | generiert-2 `kind` (`triads` / `others`) | verstimmt | tempo |
|---|---|---|---|---|---|---|---|
| aus | 76,2 | | 87,2 / 43,6 | 92,4 | 70,1 (93,7 / 39,6) | 78,1 | 95,1 |
| 0,1 | 77,7 | +0,94 | 89,4 / 41,9 | 95,8 | 70,5 (94,8 / 38,6) | 80,1 | 96,2 |
| 0,2 | 77,8 | +1,00 | 89,8 / 36,3 | 93,8 | 70,9 (94,8 / 39,0) | 81,2 | 96,2 |
| 0,3 | 78,3 | +1,51 | 90,4 / 36,6 | 91,7 | 70,7 (94,2 / 39,9) | 80,2 | 95,1 |

  Mit 0,2 je Track: Hard Rock (`cycle`) 83,4 → 99,0, Back Door Blues 88,7 → 92,2, Losing Control 52,2 → 54,0, Before The Dawn 69,9 → 71,1, Letting Go 72,3 → 73,5, `9pH42-82Mz0` 87,5 → 87,9; verloren: One Last Time 73,4 → 71,5, `V1r4wWATS9Y` (`cycle`) 49,9 → 47,9. `root`, `maj/min`, `timing` und alle Zähler unverändert. `others` im Satz „echt“ fällt fast ganz durch `9pH42-82Mz0` (55,9 → 0,0 %; dort tragen wenige Sekunden die Zahl).
- **An den Kopien** (derselbe Stand ohne und mit der Regel, 0,2): MP3: `kind` im Satz „echt“ +1,94 (halbiert +1,14). Andere Rate: +0,36. Der Unterschied ist ein Track: Bei Hard Rock hat der Akkord F die Quarte bei 0,72 bis 0,89 und wird als Fsus4 gelesen. Im Original sind diese Lesungen knapp und die klaren F sind Dur (51 s werden richtig); in der Kopie mit 44,1 kHz sind 23 s klar sus4, die Mehrheit ist sus4, nichts ändert sich.
- **Urteil:** verworfen. Auf den Originalen ist B mit genau +1,00 erreicht, aber 7,8 der 12,0 Track-Punkte kommen aus Hard Rock, und dieser Teil hält bei der anderen Abtastrate nicht (Review Focus 1 des Plans: derselbe Gewinn an den Kopien auf 0,5 Punkte). Was über alle drei Fassungen hält: `triads` steigt in jedem generierten Satz um 1 bis 3 Punkte, `kind` im Satz „echt“ um 0,35 bis 0,45. Das reicht für B nicht. Erste Fassung mit einem Fehler (knappe Sext-Akkorde verloren die Umdeutung Bb6 → Gm7, Late Night Groove `root` −2,7); die Zahlen oben sind die der berichtigten Fassung. Code auf dem Seitenzweig `exp/analysis-close-calls`, siehe Vorschlag Nr. 9.

Mit `K_CLOSE` 0,2:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 77.8 % (triads 89.8 %, others 36.3 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.1 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 93.8 % (triads 93.8 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.5 %, kind 70.9 % (triads 94.8 %, others 39.0 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 81.2 % (triads 81.2 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 96.2 % (triads 96.2 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

Mit `K_CLOSE` 0,1:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 77.7 % (triads 89.4 %, others 41.9 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.1 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 95.8 % (triads 95.8 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.5 %, kind 70.5 % (triads 94.8 %, others 38.6 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 80.1 % (triads 80.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 96.2 % (triads 96.2 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

Mit `K_CLOSE` 0,3:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 78.3 % (triads 90.4 %, others 36.6 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.1 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 91.7 % (triads 91.7 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.5 %, kind 70.7 % (triads 94.2 %, others 39.9 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 80.2 % (triads 80.2 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 6: sus4 nur, wenn die Terz schwach ist – verworfen

- **Hypothese (Task 5 des Plans, geschärft durch Versuch 5):** Ein sus-Akkord hat keine deutliche Terz. Bei Hard Rock hat der Akkord F die Quarte bei 0,72 bis 0,89 und die Terz bei 0,57 bis 0,75: ein Dreiklang mit einem Ton darüber. Erwartet: Hard Rock bei beiden Abtastraten richtig, sonst wenig; im Satz „echt“ etwa +0,75 mit halbiertem `cycle`-Gewinn, also unter der Schwelle.
- **Änderung:** sus4 im Dur-Zweig nur, wenn die Terz unter 0,5 liegt (`K_SUS_THIRD`). Test: C mit lautem F darüber bleibt C (vorher Csus4); C, F, G mit leisem E bleibt Csus4; zwei Takte Stille davor ändern beides nicht.
- **Zahlen** (gegen Versuch 4):

| | Original | andere Rate | MP3 |
|---|---|---|---|
| Hard Rock (`cycle`) `kind` | 83,4 → 99,0 | 78,5 → 99,3 | 80,8 → 98,9 |
| echt `kind` | 76,2 → 77,5 | 75,8 → 77,6 | 75,9 → 77,4 |
| echt `kind`, `cycle` halbiert | +0,66 | +0,87 | +0,76 |
| echt `triads` / `others` | 87,2 → 88,7 / 43,6 → 41,9 | 86,9 → 88,8 / 41,0 → 39,3 | 87,0 → 88,7 / 42,9 → 41,2 |
| generiert-2 `kind` (`others`) | 70,1 → 69,5 (39,6 → 37,7) | 67,5 → 67,1 (39,9 → 38,1) | 70,4 → 69,7 (40,0 → 38,2) |

  Verloren: `rock-open` (generiert-2) `kind` 37,0 → 24,7, `others` 16,3 → 0,0 (seine sus4-Akkorde haben eine Terz von 0,7); `9pH42-82Mz0` `others` 55,9 → 42,2. Alle anderen Tracks gleich.
- **Urteil:** verworfen. Unter einem Punkt, nur zwei Tracks gewinnen, der Gewinn kommt fast ganz aus einem Track, und `others` in generiert-2 fällt um 1,9 Punkte (verlangt: steigt). Was der Versuch zeigt: Der falsche sus4 bei Hard Rock geht bei allen drei Fassungen weg. Zusammen mit Versuch 5 siehe Vorschlag Nr. 9.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 77.5 % (triads 88.7 %, others 41.9 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.1 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.5 %, kind 69.5 % (triads 93.7 %, others 37.7 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 7: Versuch 5 und 6 zusammen – verworfen nach den Vorgaben des Nutzers, Vorschlag Nr. 9

Die eine Nachbesserung zu Versuch 5: Die Mehrheitsregel für knappe Akkordarten hielt bei der anderen Abtastrate nicht, weil der Akkord F bei Hard Rock dort klar als sus4 gelesen wird. Versuch 6 nimmt genau diese Lesung weg. Gemessen ist deshalb beides zusammen (Seitenzweig `exp/analysis-close-calls`, Tests grün).

| gegen Versuch 4 | Original | andere Rate | MP3 |
|---|---|---|---|
| echt `kind` | 76,2 → 77,8 | 75,8 → 77,9 | 75,9 → 77,8 |
| echt `kind`, `cycle`-Gewinne halbiert | +1,00 | +1,23 | +1,14 |
| echt `triads` | 87,2 → 89,8 | 86,9 → 89,9 | 87,0 → 89,7 |
| echt `others` | 43,6 → 36,3 | 41,0 → 35,2 | 42,9 → 35,8 |
| generiert `kind` | 92,4 → 93,8 | 94,0 → 95,7 | 92,0 → 93,8 |
| generiert-2 `kind` (`triads` / `others`) | 70,1 → 70,9 (93,7 → 94,8 / 39,6 → 39,0) | 67,5 → 68,2 (89,8 → 92,1 / 39,9 → 37,4) | 70,4 → 70,9 (93,7 → 94,8 / 40,0 → 39,0) |
| verstimmt `kind` | 78,1 → 81,2 | 78,0 → 81,0 | 77,2 → 80,2 |
| tempo `kind` | 95,1 → 96,2 | 95,7 → 96,2 | 96,2 → 97,3 |
| `root`, `maj/min`, `timing`, Zähler | unverändert | unverändert | unverändert |

Je Track im Original: Hard Rock (`cycle`) 83,4 → 99,0, Back Door Blues 88,7 → 92,2, Losing Control 52,2 → 54,0, Before The Dawn 69,9 → 71,1, Letting Go 72,3 → 73,5, `9pH42-82Mz0` 87,5 → 87,9; One Last Time 73,4 → 71,5, `V1r4wWATS9Y` (`cycle`) 49,9 → 47,9.

- **Für die Regeln der Anleitung:** B ist in allen drei Fassungen erfüllt, `root` und `maj/min` fallen nicht, `triads` steigt in jedem Satz, kein Zähler ändert sich.
- **Gegen die Vorgaben des Nutzers für Phase 2:** Die Änderung enthält eine Regel für sus-Akkorde, und `others` in generiert-2 steigt nicht, sondern fällt (um 0,6, 2,5 und 1,0 Punkte). Im Satz „echt“ kommen 7,8 der 12,0 Track-Punkte aus Hard Rock; ohne diesen Track sind es +0,35. `others` im Satz „echt“ fällt um 6 bis 7 Punkte, fast ganz durch `9pH42-82Mz0` (wenige Sekunden Asus4 und A7, die jetzt als A gelesen werden).
- **Urteil:** nicht behalten. Ob mehr richtige Dreiklänge in allen Sätzen den Verlust bei den anderen Akkordarten aufwiegen, ist eine Entscheidung des Nutzers: Vorschlag Nr. 9 in [VORSCHLAEGE.md](VORSCHLAEGE.md), der Code liegt fertig auf dem Seitenzweig.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 77.8 % (triads 89.8 %, others 36.3 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.1 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 93.8 % (triads 93.8 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.5 %, kind 70.9 % (triads 94.8 %, others 39.0 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 81.2 % (triads 81.2 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 96.2 % (triads 96.2 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 8: Powerchords, die Grenze für „keine Terz“ – verworfen

Nachgeholt nach der Prüfung: Der Kandidat war nach der Diagnose ohne Versuch ausgeschieden, der Plan sah die Messung vor.

- **Hypothese:** Die Grenze „Terz unter 0,2“ ist für Aufnahmen zu streng (B5 bei Losing Control: Terz 0,24 bis 0,33). Erwartet nach der Diagnose: Losing Control gewinnt, Moll-Dreiklänge anderer Tracks und Dur-Akkorde der generierten Sätze werden zu Powerchords.
- **Änderung:** `K_BARE` 0,2 → 0,25 / 0,3 / 0,35 / 0,4 (Bau mit `-Tuning`).
- **Zahlen** (gegen den Stand nach den Korrekturen der Prüfung):

| `K_BARE` | echt `kind` (`triads` / `others`) | generiert `triads` | generiert-2 `triads` / `others` | verstimmt `triads` | tempo `triads` |
|---|---|---|---|---|---|
| 0,2 (heute) | 76,2 (87,2 / 43,6) | 92,4 | 93,6 / 39,6 | 78,1 | 95,1 |
| 0,25 | 76,8 (87,2 / 45,9) | 90,0 | 92,6 / 40,8 | 76,1 | 94,0 |
| 0,3 | 76,7 (86,2 / 48,4) | 87,2 | 89,5 / 42,6 | 73,0 | 92,7 |
| 0,35 | 72,8 (80,7 / 50,6) | 85,8 | 88,4 / 48,4 | 73,0 | 90,6 |
| 0,4 | 66,2 (72,4 / 49,4) | 84,8 | 86,7 / 49,7 | 71,9 | 90,6 |

  Mit 0,35: Losing Control `kind` 52,2 → 73,5 % (`others` 0,0 → 56,2), aber `pGi9fs2HhZ0` 96,6 → 69,6, Before The Dawn 69,9 → 59,8, `dreamy-12` 98,1 → 48,5.
- **Urteil:** verworfen. Bei jedem Wert fällt `triads` in allen vier generierten Sätzen, ab 0,3 auch im Satz „echt“. Der Gewinn im Satz „echt“ bei 0,25 (+0,6) kommt aus einem Track.

Mit `K_BARE` 0,25:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 76.8 % (triads 87.2 %, others 45.9 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.1 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 90.0 % (triads 90.0 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.6 %, maj/min 95.4 %, kind 69.8 % (triads 92.6 %, others 40.8 %) | changes on the one 95.0 % | timing +20 ms, apart 20 ms, within 97.1 %, 90 % under 101 ms, drift 169 ms/min, missed 1.4 % | tempo steady 59.7 % at most, 6.4 % off | beats +23 ms, within 50 ms 98.9 %, bars 92.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 76.1 % (triads 76.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 94.0 % (triads 94.0 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

Mit `K_BARE` 0,35:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 72.8 % (triads 80.7 %, others 50.6 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.1 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 85.8 % (triads 85.8 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.6 %, maj/min 95.4 %, kind 69.9 % (triads 88.4 %, others 48.4 %) | changes on the one 95.0 % | timing +20 ms, apart 20 ms, within 97.1 %, 90 % under 101 ms, drift 169 ms/min, missed 1.4 % | tempo steady 59.7 % at most, 6.4 % off | beats +23 ms, within 50 ms 98.9 %, bars 92.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 73.0 % (triads 73.0 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 90.6 % (triads 90.6 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Versuch 9: sus2 und sus4 nach einer Regel, bei Dur und Moll – verworfen, Vorschlag Nr. 12

Nachgeholt nach der Prüfung, in der Fassung, die der Plan für den Fall vorsieht, dass Versuch 6 verworfen ist: ohne die Bedingung an die Terz.

- **Hypothese:** sus2 wird nur erkannt, wo gar keine Terz da ist. Eine Sekunde oder Quarte, die deutlich da ist (über 0,7) und lauter als die Terz, macht einen sus-Akkord, gleich welche Terz die Glättung gelesen hat; sind beide so, benennt die lautere. Erwartet nach der Diagnose: Die sus-Akkorde von generiert-2 und ein Teil von Bbsus2 bei Letting Go werden gefunden, aber Akkorde, die das Label als Dur führt (F bei Before The Dawn, Eb bei One Last Time, Bb bei Letting Go), werden zu sus2.
- **Änderung:** eine Regel vor den Septimen in beiden Zweigen. Test: D E A mit leisem F wird Dsus2 (vorher Dm), A D E mit leisem C wird Asus4 (vorher Am), D F A mit leisem E bleibt Dm.
- **Zahlen** (gegen den Stand nach den Korrekturen der Prüfung):

| | vorher | nachher |
|---|---|---|
| echt `kind` (`triads` / `others`) | 76,2 (87,2 / 43,6) | 74,8 (84,5 / 46,3) |
| Before The Dawn `kind` (`triads`) | 69,9 (90,7) | 57,6 (74,7) |
| One Last Time `kind` (`triads`) | 73,4 (72,4) | 66,7 (65,4) |
| Letting Go `kind` (`triads` / `others`) | 72,3 (94,5 / 25,1) | 75,8 (89,5 / 46,6) |
| generiert-2 `kind` (`triads` / `others`) | 70,1 (93,6 / 39,6) | 73,7 (93,6 / 49,3) |
| `country-open` / `psych-open` / `rock-open` `kind` | 28,7 / 29,1 / 37,0 | 49,3 / 45,4 / 66,0 |
| generiert, verstimmt, tempo | unverändert | |

- **Urteil:** verworfen. `kind` und `triads` fallen im Satz „echt“ (B und Regel 4). Die Messung trifft die Vorhersage aus den Tonstärken: Wo die Labels genau sind (generiert-2), gewinnt die Regel knapp zehn Punkte bei den anderen Akkordarten, ohne einen Dreiklang zu verlieren. In den echten Tracks spricht sie bei Akkorden an, die die Videos als Dur anzeigen. Ob dort die Regel oder das Label recht hat, lässt sich nur am Audio hören: Vorschlag Nr. 12, Code auf dem Zweig `exp/analysis-sus`.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 74.8 % (triads 84.5 %, others 46.3 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.1 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.6 %, maj/min 95.4 %, kind 73.7 % (triads 93.6 %, others 49.3 %) | changes on the one 95.0 % | timing +20 ms, apart 20 ms, within 97.1 %, 90 % under 101 ms, drift 169 ms/min, missed 1.4 % | tempo steady 59.7 % at most, 6.4 % off | beats +23 ms, within 50 ms 98.9 %, bars 92.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

### Diagnosen ohne Versuch, Nachtrag

- **Losing Control, vier Wechsel Em → G einen halben Schlag spät** (aus Phase 1 offen): in Phase 2 nicht untersucht.
- **Dominante in Moll** (`dreamy-128-90` F# als F#m 5 s, `psych-68-72` F#m als F# 2 s, `V1r4wWATS9Y` E7 als Em7 16 s): Beide Lesarten gehören zur Tonart und bekommen denselben Vorsprung; es entscheidet das Chroma, und der Leitton fehlt bei verzerrten Gitarren oft. Keine Regel gefunden, die nicht die Moll-Dominante (Em in a-Moll) träfe. Kein Versuch.
- **Warum die Versuche hier enden:** 9 von 18 Versuchen sind gemessen, die letzten fünf in Folge verworfen, einer vor der Grenze von sechs. Für jeden weiteren Kandidaten zeigt die Diagnose, dass er an Regel 4 oder an den Labels scheitert; einen sechsten erwartbar verworfenen Versuch habe ich nicht mehr gemessen.

### Prüfung durch einen Subagenten (2026-11-17) und Nachträge

Ein Subagent mit frischem Kontext hat den Diff von Phase 2, die Anleitung, den Plan und die Liste meiner eigenen Entscheidungen bekommen, nichts gebaut und nichts gemessen. Kein kritischer Befund, fünf wichtige. Bestätigt hat er: die Verwerfungen 2, 3, 5, 6 und 7 (bei 7 auch die Lesart der Vorgabe des Nutzers), die Rechnung mit halbierten `cycle`-Gewinnen, höchstens fünf Werte je Knopf, keine Sonderfälle für Tracks oder Dateinamen, neue Zahlen als `knob(...)`, die Protokollzeilen ohne Wirkung auf das Ergebnis, `native/tools` unverändert seit `22d0840`.

| Befund | Gewicht | Was daraus wurde |
|---|---|---|
| Versuch 1 ist behalten, obwohl Punkt 1 der Regel auf die Genauigkeit der `==`-Zeilen nicht erfüllt ist; die strenge Fassung von Versuch 2 wurde bei größerem Gewinn verworfen | wichtig | zurückgenommen (`4179a5b`), Vorschlag Nr. 11 |
| Versuch 4 erfüllt die Regeln, aber knapp; die Grenzen sind an den Testtracks abgelesen; die Messung an den Kopien fehlt im Protokoll; `HALF_STILL` 0,5 liegt am Rand der Lücke; im Satz „tempo“ der Raten-Kopie stand 95,8 gegen 95,7 | wichtig | `HALF_STILL` 0,6 (Mitte der Lücke 0,50 bis 0,72); Kopien gemessen, Tabelle unten; die 0,1 Punkte waren `step-80-62-hardrock`, wo die Regel bei 48 kHz einmal falsch griff, mit 0,6 und der Untergrenze für den Bass nicht mehr |
| Die Regel aus Versuch 4 hat keine Untergrenze für den Bass: Sind beide Grundtöne im tiefen Register fast null, greift sie trotzdem | wichtig | bestätigt mit einem Test (Oberstimmen über 260 Hz, Bass unter 55 Hz: einer von sechs Wechseln wurde verschoben, bei einem Bassanteil von 0,01). Behoben: Der Bass muss mindestens 0,1 des Klangs dieser Schläge ausmachen (`HALF_BASS_MIN`; in der Musik der Sätze 0,17 bis 0,59), und der alte Grundton muss überhaupt da sein. Dazu ein Test für einen Bass, der nie zum neuen Grundton geht |
| Die Tabelle zu Versuch 3 widerspricht in der Zeile 0,2 ihrem `==`-Block | wichtig | berichtigt: 94,9 / 94,2 / 75,8 / 90,5 |
| sus2 und Powerchords sind ohne gemessenen Versuch ausgeschieden; der Grund für das Ende der Versuche fehlt; zwei Punkte der offenen Liste ohne Eintrag | wichtig | beide nachgeholt (Versuche 8 und 9, beide verworfen wie vorhergesagt); Grund und Einträge oben |
| Dreierprüfung: Zwei der drei Bedingungen des Plans sind wörtlich nicht erfüllt; 177 statt 174 Läufe | gering | im Abschnitt offen benannt, Zahl berichtigt |
| „Dieser eine Track erklärt `root`“ in generiert-2 stimmt rechnerisch nicht ganz | gering | berichtigt (−2,1 aus dem Track, +0,7 aus anderen) |
| Vorschlag Nr. 7 nennt als Erwartung die Zahlen der Kopien; Vorschlag Nr. 9 widerspricht Versuch 5 | gering | beide Texte berichtigt |
| „Die Band spielt Gm7“ und „hört, was gespielt wird“ sind gemessen, nicht gehört | gering | umformuliert |
| Die Anleitung stellt die Lesart zu `9pH42-82Mz0` als Anweisung des Nutzers dar | gering | berichtigt: Der Punkt kam mit offenem Platzhalter zurück, gewählt ist die vorsichtige Lesart |
| Der Commit `f1f687a` bündelt Regel, Protokollzeilen und eine Änderung an den Vorschlägen | gering | nicht mehr zu ändern, ohne die Geschichte umzuschreiben |
| Die Protokollzeile `kind:` war nach der Umdeutung Bb6 → Gm7 falsch skaliert | gering | behoben (nur Protokoll) |
| Tests: `HALF_TIPS` ungetestet; kein Test für 3/4, 5/4, 6/8; eine Prüfung ohne Spielraum | gering | Test für den Bass, der nie kippt, ergänzt. Kein Test für ungerade Takte: Dort ist die Regel durch eine Bedingung abgeschaltet, und die Zeilen von `funk-34-60`, `poppunk-34-90`, `blues-54-132`, `country-54-72`, `psych-68-72`, `dreamy-128-90` sind durch Versuch 4 unverändert |
| Die erste, fehlerhafte Fassung von Versuch 5 ist gemessen, aber ohne `==`-Zeilen; die Zeilen der Kopien fehlen | gering | unten nachgetragen |
| Versuch 3 ändert ein Bassgewicht, das die Anleitung als schon gemessen führt; die Versuche 2, 3 und 4 zielen auf dasselbe Symptom | gering | stimmt. Das frühere Ergebnis galt dem einen Bassgewicht vor der Aufteilung nach Stelle im Takt; Versuch 3 galt nur dem Gewicht in der Taktmitte. Versuch 4 ist die eine Nachbesserung zu Versuch 2; Versuch 3 war eine andere Hypothese zur selben Stelle |
| Ein durch Akkordwechsel gefundener Takt mit sechs Schlägen gilt nicht als 6/8, die Regel läuft dort; bei unregelmäßigen Takten des Modells kann die Strecke länger als ein halber Takt sein | gering | bekannte Grenze, kein Fall in den Sätzen |

Was er nicht prüfen konnte, und wie es steht: Bau und Tests grün (`native\build.ps1 -NoApp`, 5 von 5); Laufzeit „Letting Go“ ohne Zwischenspeicher 11,1 s; die Hypothesen stehen mit Uhrzeit nur in meinem Arbeitsprotokoll, belegen lässt sich die Reihenfolge aus den Commits nicht; der `==`-Block von Versuch 7 ist auf den Originalen gleich dem von Versuch 5, weil die zweite Regel dort nur ändert, was die erste schon geändert hatte (an den Kopien unterscheiden sie sich); kein Skript hat in den Testordner geschrieben.

**Versuch 4 an den Kopien** (Stand vor Phase 2 gegen den Endstand, je Fassung; die Regel der Anleitung gilt für die Originale):

| Satz „echt“ | Original | andere Rate | MP3 |
|---|---|---|---|
| `timing` innerhalb | 90,8 → 93,1 (+2,3) | 91,3 → 92,8 (+1,5) | 90,4 → 92,5 (+2,1) |
| `root` | 94,8 → 95,2 | 94,8 → 95,1 | 94,8 → 95,2 |
| `maj/min` | 94,2 → 94,7 | 94,2 → 94,6 | 94,2 → 94,7 |
| `kind` | 75,7 → 76,2 | 75,5 → 75,8 | 75,5 → 75,9 |

In der anderen Abtastrate bleibt der Gewinn bei `timing` unter den zwei Punkten der Regel: Back Door Blues hat dort schon vorher vier der sechs Wechsel richtig (91,1 statt 83,9 %). In keiner Fassung verliert ein Track. Die generierten Sätze: `hardrock-colours` gewinnt in allen drei Fassungen, `funk-11` als MP3, sonst nichts.

Endstand, andere Rate:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.1 %, maj/min 94.6 %, kind 75.8 % (triads 86.9 %, others 41.0 %) | changes on the one 80.6 % | timing +102 ms, apart 130 ms, within 92.8 %, 90 % under 249 ms, drift 9 ms/min, missed 1.1 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 94.0 % (triads 94.0 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 99.6 %, 90 % under 31 ms, drift 12 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.2 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 94.2 %, maj/min 93.9 %, kind 67.5 % (triads 89.8 %, others 39.9 %) | changes on the one 93.0 % | timing +41 ms, apart 41 ms, within 93.5 %, 90 % under 142 ms, drift 97 ms/min, missed 4.7 % | tempo steady 59.7 % at most, 0.9 % off | beats +23 ms, within 50 ms 96.2 %, bars 91.2 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.0 %, maj/min 82.0 %, kind 78.0 % (triads 78.0 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 82.2 %, 90 % under 31 ms, drift 19 ms/min, missed 16.7 % | tempo steady 2.4 % at most, 0.0 % off | beats +14 ms, within 50 ms 99.5 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.9 %, maj/min 96.3 %, kind 95.8 % (triads 95.8 %, others –) | changes on the one 90.3 % | timing +20 ms, apart 26 ms, within 93.1 %, 90 % under 163 ms, drift 67 ms/min, missed 0.0 % | tempo steady 26.0 % at most, 6.5 % off | beats +19 ms, within 50 ms 94.4 %, bars 85.9 %
```

Endstand, MP3:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 75.9 % (triads 87.0 %, others 42.9 %) | changes on the one 80.6 % | timing +106 ms, apart 128 ms, within 92.5 %, 90 % under 251 ms, drift 10 ms/min, missed 0.5 % | tempo steady 16.0 % at most, 0.4 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.0 % (triads 92.0 %, others –) | changes on the one 97.4 % | timing +19 ms, apart 25 ms, within 100.0 %, 90 % under 31 ms, drift 11 ms/min, missed 0.0 % | tempo steady 14.0 % at most, 2.1 % off | beats +19 ms, within 50 ms 97.8 %, bars 96.2 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.7 %, kind 70.4 % (triads 93.7 %, others 40.0 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.8 %, bars 93.6 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.3 %, maj/min 82.3 %, kind 77.2 % (triads 77.2 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 21 ms, within 83.3 %, 90 % under 32 ms, drift 11 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 99.2 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 98.9 %, maj/min 97.3 %, kind 96.2 % (triads 96.2 %, others –) | changes on the one 96.7 % | timing +12 ms, apart 23 ms, within 94.4 %, 90 % under 56 ms, drift 47 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.9 % off | beats +12 ms, within 50 ms 95.8 %, bars 92.2 %
```

**Versuch 5, Nachtrag.** Die erste Fassung (mit dem Fehler bei den Sext-Akkorden, `K_CLOSE` 0,2), gemessen und verworfen vor der Wertung:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.0 %, maj/min 94.5 %, kind 77.8 % (triads 89.8 %, others 36.3 %) | changes on the one 80.6 % | timing +103 ms, apart 125 ms, within 92.4 %, 90 % under 251 ms, drift 9 ms/min, missed 1.3 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 93.8 % (triads 93.8 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.5 %, kind 70.9 % (triads 94.8 %, others 39.0 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.9 %, bars 93.3 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 81.2 % (triads 81.2 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 96.2 % (triads 96.2 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```

An den Kopien, ohne die Regel und mit `K_CLOSE` 0,2 (berichtigte Fassung). Andere Rate:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.1 %, maj/min 94.6 %, kind 75.8 % (triads 86.9 %, others 41.0 %) | changes on the one 80.6 % | timing +102 ms, apart 130 ms, within 92.8 %, 90 % under 249 ms, drift 9 ms/min, missed 1.1 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 94.0 % (triads 94.0 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 99.6 %, 90 % under 31 ms, drift 12 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.2 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 94.2 %, maj/min 93.9 %, kind 67.5 % (triads 89.8 %, others 39.9 %) | changes on the one 93.4 % | timing +41 ms, apart 41 ms, within 93.5 %, 90 % under 142 ms, drift 97 ms/min, missed 4.7 % | tempo steady 14.6 % at most, 0.5 % off | beats +23 ms, within 50 ms 96.2 %, bars 91.6 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.0 %, maj/min 82.0 %, kind 78.0 % (triads 78.0 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 82.2 %, 90 % under 31 ms, drift 19 ms/min, missed 16.7 % | tempo steady 2.4 % at most, 0.0 % off | beats +14 ms, within 50 ms 99.5 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.7 % (triads 95.7 %, others –) | changes on the one 90.3 % | timing +20 ms, apart 26 ms, within 93.1 %, 90 % under 163 ms, drift 66 ms/min, missed 0.0 % | tempo steady 26.0 % at most, 6.5 % off | beats +19 ms, within 50 ms 94.4 %, bars 85.9 %
```

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.1 %, maj/min 94.6 %, kind 76.2 % (triads 88.1 %, others 35.2 %) | changes on the one 80.6 % | timing +102 ms, apart 130 ms, within 92.8 %, 90 % under 249 ms, drift 9 ms/min, missed 1.1 % | tempo steady 14.9 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 95.7 % (triads 95.7 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 99.6 %, 90 % under 31 ms, drift 12 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.2 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 94.2 %, maj/min 93.9 %, kind 68.0 % (triads 91.7 %, others 37.4 %) | changes on the one 93.4 % | timing +41 ms, apart 41 ms, within 93.5 %, 90 % under 142 ms, drift 97 ms/min, missed 4.7 % | tempo steady 14.6 % at most, 0.5 % off | beats +23 ms, within 50 ms 96.2 %, bars 91.6 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.0 %, maj/min 82.0 %, kind 81.0 % (triads 81.0 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 82.2 %, 90 % under 31 ms, drift 19 ms/min, missed 16.7 % | tempo steady 2.4 % at most, 0.0 % off | beats +14 ms, within 50 ms 99.5 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 96.2 % (triads 96.2 %, others –) | changes on the one 90.3 % | timing +20 ms, apart 26 ms, within 93.1 %, 90 % under 163 ms, drift 66 ms/min, missed 0.0 % | tempo steady 26.0 % at most, 6.5 % off | beats +19 ms, within 50 ms 94.4 %, bars 85.9 %
```

MP3:

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 75.9 % (triads 87.0 %, others 42.9 %) | changes on the one 80.6 % | timing +106 ms, apart 128 ms, within 92.5 %, 90 % under 251 ms, drift 10 ms/min, missed 0.5 % | tempo steady 16.0 % at most, 0.3 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.0 % (triads 92.0 %, others –) | changes on the one 97.4 % | timing +19 ms, apart 25 ms, within 100.0 %, 90 % under 31 ms, drift 11 ms/min, missed 0.0 % | tempo steady 14.0 % at most, 2.1 % off | beats +19 ms, within 50 ms 97.8 %, bars 96.2 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.7 %, kind 70.4 % (triads 93.7 %, others 40.0 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.8 %, bars 93.6 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.3 %, maj/min 82.3 %, kind 77.2 % (triads 77.2 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 21 ms, within 83.3 %, 90 % under 32 ms, drift 11 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 99.2 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 98.9 %, maj/min 97.3 %, kind 96.2 % (triads 96.2 %, others –) | changes on the one 96.7 % | timing +12 ms, apart 23 ms, within 94.4 %, 90 % under 56 ms, drift 47 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.9 % off | beats +12 ms, within 50 ms 95.8 %, bars 92.2 %
```

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 77.8 % (triads 89.7 %, others 35.8 %) | changes on the one 80.6 % | timing +106 ms, apart 128 ms, within 92.5 %, 90 % under 251 ms, drift 10 ms/min, missed 0.5 % | tempo steady 16.0 % at most, 0.3 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 93.8 % (triads 93.8 %, others –) | changes on the one 97.4 % | timing +19 ms, apart 25 ms, within 100.0 %, 90 % under 31 ms, drift 11 ms/min, missed 0.0 % | tempo steady 14.0 % at most, 2.1 % off | beats +19 ms, within 50 ms 97.8 %, bars 96.2 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.7 %, maj/min 95.7 %, kind 70.9 % (triads 94.8 %, others 39.0 %) | changes on the one 95.4 % | timing +20 ms, apart 20 ms, within 97.4 %, 90 % under 101 ms, drift 147 ms/min, missed 1.4 % | tempo steady 37.3 % at most, 6.0 % off | beats +23 ms, within 50 ms 98.8 %, bars 93.6 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.3 %, maj/min 82.3 %, kind 80.2 % (triads 80.2 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 21 ms, within 83.3 %, 90 % under 32 ms, drift 11 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 99.2 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 98.9 %, maj/min 97.3 %, kind 97.3 % (triads 97.3 %, others –) | changes on the one 96.7 % | timing +12 ms, apart 23 ms, within 94.4 %, 90 % under 56 ms, drift 47 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.9 % off | beats +12 ms, within 50 ms 95.8 %, bars 92.2 %
```

### Stand nach Phase 2 (2026-11-17)

Neun gemessene Versuche von höchstens achtzehn. Behalten ist einer: Versuch 4. Versuch 1 war knapp behalten und ist nach der Prüfung zurückgenommen. Verworfen: 2, 3, 5, 6, 7, 8, 9. `analysisVersion` steht auf `2026-11-17g`.

| Satz | `root` | `maj/min` | `kind` (`triads` / `others`) | `timing` innerhalb | Median \|Δ\| | `tempo steady` daneben | auf der Eins | `bars` | Tempo / Taktart / Tonart |
|---|---|---|---|---|---|---|---|---|---|
| echt, vorher | 94,8 | 94,2 | 75,7 (86,7 / 43,1) | 90,8 | 130 ms | 0,2 | 80,6 | – | 12/12, 13/13, 12/13 |
| echt, nachher | **95,2** | **94,7** | **76,2** (87,2 / 43,6) | **93,1** | 125 ms | 0,2 | 80,6 | – | 12/12, 13/13, 12/13 |
| generiert-2, vorher | 95,5 | 95,3 | 69,8 (93,6 / 39,1) | 96,8 | 20 ms | 6,4 | 95,0 | 92,9 | 17/18, 15/18, 17/18 |
| generiert-2, nachher | 95,6 | 95,4 | 70,1 (93,6 / 39,6) | 97,1 | 20 ms | 6,4 | 95,0 | 92,9 | 17/18, 15/18, 17/18 |
| generiert, verstimmt, tempo | unverändert | | | | | | | | |

Echte Tracks, vorher → nachher (die übrigen neun sind Zeile für Zeile gleich):

| Track | `timing` innerhalb 0,3 s | `root` | `maj/min` | `kind` |
|---|---|---|---|---|
| Before The Dawn | 74,6 → 84,1 % | 89,2 → 92,2 | 87,8 → 92,2 | 66,5 → 69,9 |
| Back Door Blues | 83,9 → 94,6 % | 90,8 → 92,2 | 90,8 → 92,2 | 86,5 → 88,7 |
| One Last Time | 97,0 → 98,0 % | 95,7 → 95,9 | 95,7 → 95,9 | 73,2 → 73,4 |

Das Hauptziel von Phase 2, `kind` im Satz „echt“ um einen Punkt zu heben, ist nicht erreicht: +0,5, als Folge der besseren Akkordgrenzen. Warum keine Regel für die Akkordart die Regeln erfüllt hat, steht in „Diagnose vor den Versuchen an der Akkordart“ und bei den Versuchen 5 bis 9; was der Nutzer entscheiden kann, in den Vorschlägen Nr. 7 und 9 bis 12.

**App gegen Werkzeug im Endstand:** Für Letting Go, Late Night Groove und `pGi9fs2HhZ0` ist das ganze JSON der App gleich dem von `btg_analyze` (720, 633 und 773 Schläge; 222, 193 und 193 Akkorde). `track-check.mjs` mit Late Night Groove: Anzeige 20/20, keine Probleme. Nicht mit eigenen Augen und Ohren geprüft.

```
== echt: 13 tracks | tempo 12/12 | meter 13/13 | key root 12/13, with mode 12/13 | scale 12/13 | chords root 95.2 %, maj/min 94.7 %, kind 76.2 % (triads 87.2 %, others 43.6 %) | changes on the one 80.6 % | timing +102 ms, apart 125 ms, within 93.1 %, 90 % under 250 ms, drift 9 ms/min, missed 0.5 % | tempo steady 15.4 % at most, 0.2 % off
== generiert: 18 tracks | tempo 18/18 | meter 18/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 98.5 %, maj/min 97.8 %, kind 92.4 % (triads 92.4 %, others –) | changes on the one 100.0 % | timing +16 ms, apart 24 ms, within 100.0 %, 90 % under 32 ms, drift 9 ms/min, missed 0.0 % | tempo steady 6.8 % at most, 1.4 % off | beats +15 ms, within 50 ms 99.0 %, bars 98.6 %
== generiert-2: 18 tracks | tempo 17/18 | meter 15/18 | key root 17/18, with mode 17/18 | scale 17/18 | chords root 95.6 %, maj/min 95.4 %, kind 70.1 % (triads 93.6 %, others 39.6 %) | changes on the one 95.0 % | timing +20 ms, apart 20 ms, within 97.1 %, 90 % under 101 ms, drift 169 ms/min, missed 1.4 % | tempo steady 59.7 % at most, 6.4 % off | beats +23 ms, within 50 ms 98.9 %, bars 92.9 %
== verstimmt: 6 tracks | tempo 6/6 | meter 6/6 | key root 5/6, with mode 5/6 | scale 5/6 | chords root 82.2 %, maj/min 82.2 %, kind 78.1 % (triads 78.1 %, others –) | changes on the one 100.0 % | timing +12 ms, apart 22 ms, within 83.3 %, 90 % under 31 ms, drift 10 ms/min, missed 16.7 % | tempo steady 3.1 % at most, 0.3 % off | beats +14 ms, within 50 ms 98.7 %, bars 99.0 %
== tempo: 8 tracks | tempo 0/0 | meter 8/8 | key root 8/8, with mode 8/8 | scale 8/8 | chords root 97.8 %, maj/min 96.2 %, kind 95.1 % (triads 95.1 %, others –) | changes on the one 90.9 % | timing +19 ms, apart 26 ms, within 92.2 %, 90 % under 154 ms, drift 109 ms/min, missed 0.0 % | tempo steady 27.4 % at most, 6.4 % off | beats +19 ms, within 50 ms 94.5 %, bars 85.9 %
```
