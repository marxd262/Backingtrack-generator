# SAMPLE_SOURCES – Kandidaten für den Ersatz von MuseScore_General

Stand: 2026-11-13. Recherchiert, **nichts davon gehört oder heruntergeladen.**
Ziel: Klangbild „kleine Band jammt im Raum“. MuseScore_General wird langfristig vollständig ersetzt.

## Lizenz-Regeln für dieses Projekt

Die App ist öffentlich (derzeit GitHub Pages), die Samples werden also **weitergegeben**. Daher:

| Lizenz | Verwendbar? | Pflicht |
|---|---|---|
| CC0 / Public Domain | ja | nichts (Quelle trotzdem nennen) |
| MIT | ja | Lizenztext beilegen |
| CC-BY | ja | Namensnennung (Credits-Seite + Lizenzdatei je Pack) |
| CC-BY-SA | ja, mit Bedacht | Namensnennung; **bearbeitete Samples** (geschnitten, umkodiert, gemischt) müssen unter CC-BY-SA bleiben. Betrifft nur das Sample-Pack, nicht den Code. |
| CC-BY-NC | vermeiden | Erlaubt nur nicht-kommerzielle Nutzung, verbaut spätere Optionen |
| GPL bei Samples, „royalty-free“ ohne klare Lizenz, „Custom“, „Freemium“ | vermeiden | unklar, ob Weitergabe der Rohdateien erlaubt ist |

**Vor jedem Einbau:** LICENSE-Datei im jeweiligen Repo/Download selbst prüfen und in `src/assets/samples/LICENSE-<pack>.md` ablegen. Die Angaben unten stammen aus Katalogen (v. a. sfzinstruments.github.io) und können abweichen. Beispiel: KVR listet Karoryfer-Libraries als GPL 3, die LICENSE-Datei von Emilyguitar ist aber CC0 1.0 (geprüft).

## Kernband

### Drums (höchste Priorität: größter hörbarer Gewinn, Round-Robins vorhanden)

| Library | Lizenz | Eckdaten | Größe (Download) | Anmerkung |
|---|---|---|---|---|
| **Naked Drums** (Wilkinson Audio, SFZ von kinwie) | CC-BY-4.0 | Yamaha Recording Custom, **10 Round-Robins**, bis 5 Velocity-Layer, Mikrofone: Direct, OH, Close Room, Far Room, Mid-Side, Wide OH | 1,3 GB | Favorit: Room-Mikros erlauben einen echten Raum in den Samples – genau das fehlt aktuell |
| **Muldjord Kit** (DrumGizmo) | CC-BY-4.0 | Multi-Mic-Kit | 347 MB | kleiner Einstieg, gut zum Testen der Pipeline |
| DRS Kit (DrumGizmo) | CC-BY-4.0 | Multi-Mic-Kit | 754 MB | Alternative |
| SM Drums (McLean/Stillwell/Ali) | Public Domain | bis 127 Velocity-Layer × 4 RR (Kick/Snare/Hat) | 2,2+ GB | sehr tief gesampelt, starke Auswahl nötig |
| Salamander Drumkit | CC-BY-SA-3.0 | wenige Layer, viele Samples pro Layer (Closed Hat: 20 pro Layer) | ~370 MB | |
| AVL Drumkits (Glen MacArthur) | CC-BY-SA-3.0 | 5–10 Velocity-Layer, kleiner Speicherbedarf; Kits inkl. „Blonde Bop“ (Jazz) | klein | gut für Jazz/Brushes-Ersatz |
| Swirly Drums (Karoryfer) | CC0-1.0 | Punk/Indie-Drums mit **Besen** | 1,6 GB | Brushes-Ersatz |
| Frankensnare (Karoryfer) | CC0-1.0 | Sammlung von Snares | 900 MB | Snare-Varianten |

Vorgehen: Mehrere Mikrofone beim Import zu **einem Stereo-Mix** (Close + Overhead + Room) herunterrechnen, 3–5 Velocity-Layer und 3–5 Round-Robins auswählen. Optional den Room-Anteil als separaten Layer behalten (Regler „Raum“).

### E-Bass

| Library | Lizenz | Eckdaten | Größe |
|---|---|---|---|
| **Growlybass** (Karoryfer) | CC0-1.0 | Squier Jazz Bass, roh/DI, mehrere SFZ-Mappings | 160 MB |
| **Fashionbass** (Karoryfer) | CC0-1.0 | Jazz Bass | 302 MB |
| Black And Blue Basses (Karoryfer) | CC0-1.0 | zwei 5-Saiter | 961 MB |
| Swagbass (Karoryfer) | CC0-1.0 | alte Flatwounds, auch tiefer gestimmt | 138 MB |
| Pastabass (Karoryfer) | CC0-1.0 | Squier Bass VI | 301 MB |
| FreePats Clean Electric Bass (Reusenoise) | CC0 1.0 | Yamaha RBX | klein |

Kontrabass/Upright: **Meatbass** (Karoryfer, CC0, 1958 Otto Rubner), D. Smolken Double Bass (Karoryfer, CC0), Sneakybass (CC0, leises Pizzicato, 324 MB).

### E-Gitarre (als DI → Amp/Cab-Simulation, siehe unten)

| Library | Lizenz | Eckdaten | Größe |
|---|---|---|---|
| **Emilyguitar** (Karoryfer) | CC0 1.0 (LICENSE geprüft) | Epiphone, **direkt aufgenommen** (beide PUs), Flatwounds, **4 Velocity-Layer, 3 RR**, Release-Samples mit 4 RR, Geräusche mit 5 RR, Akkord-Mappings (Power/Moll/Dur-Barré) | 98 MB |
| **Shinyguitar** (Karoryfer) | CC0-1.0 | Archtop, **DI + Mikrofon** (mischbar), 4 Velocity-Layer, 4 RR, Release-Samples, gedämpfte Anschläge (5 RR) | 352 MB |
| Black And Green Guitars (Karoryfer) | CC0-1.0 | zwei Hollowbody-E-Gitarren | 500 MB |
| Blue Jeans And Moonbeams (Malaclypse the Younger) | MIT | E- und Akustikgitarren | ? |
| FreePats FSBS Clean/Jazz | CC0 | schon im Projekt | – |

### Akustikgitarre

| Library | Lizenz | Anmerkung |
|---|---|---|
| FreePats Steel-String / Nylon-String Acoustic Guitar | CC0 (FreePats-Projekt; je Instrument prüfen) | |
| Discord SFZ GM Bank – Akustikgitarre | laut Autor (Jeff Learman) CC0; Lizenz steht in der jeweiligen .sfz | Bank erlaubt nur CC0/CC-BY |
| Blue Jeans And Moonbeams | MIT | |

Akustikgitarre ist die dünnste Kategorie bei freien, weitergebbaren Libraries. Hier lohnt evtl. später eine eigene Aufnahme.

### Keys

| Library | Lizenz | Eckdaten | Größe |
|---|---|---|---|
| **Salamander Grand Piano** | CC-BY 3.0 (geprüft) | Yamaha C5, 16 Velocity-Layer, 48 kHz/24 Bit | 394+ MB |
| Splendid Grand Piano (AKAI) | Public Domain | Steinway, 4 Velocity-Layer | 77 MB |
| VCSL Keys (Versilian) | CC0-1.0 | Pianos/Uprights/Cembali | 680 MB |
| LivingRoom Upright – Micro | CC-BY-SA-4.0 | Charakter-Upright | 107 MB |
| Headroom Piano | CC-BY-4.0 | Yamaha C3 | 156 MB |
| **Greg Sullivan E-Pianos** | CC-BY-3.0 | 3 E-Pianos (laut BPB: Hohner, Yamaha, **Wurlitzer EP203W**) | 21,5 MB |
| Rhodes: Discord-GM-Bank-Rhodes | laut Autor CC0 – in .sfz prüfen | |
| ~~jRhodes3d~~ | CC-BY-NC (Samples) | **nicht verwenden** (NC) |

**Orgel: nicht samplen, sondern synthetisieren** (Tonewheel-Additivsynthese mit Zugriegeln, Perkussion, Key-Click, Rotary/Leslie-Simulation). Das klingt besser als jedes Einzel-Sample und braucht keine Dateien. Fremden GPL-Code (z. B. setBfree) nicht kopieren, nur das Prinzip nachbauen.

## Optional (Lead/Farben)

| Instrument | Library | Lizenz |
|---|---|---|
| Altsax | Weresax (Karoryfer) | CC0-1.0 |
| Saxofone (S/A/T/B) | MTG Solo Sax | CC-BY-4.0, 110 MB |
| Baritonsax | Bear Sax (Karoryfer) | CC0-1.0 |
| Flöte | Ixox Flute | CC-BY-4.0, 10,7 MB |
| Streicher, Bläser, Flöte | VSCO 2 Community Edition | CC0 |
| Pads | weiter Synth – Pads sind ohnehin synthetisch | – |

## Cab-Impulsantworten (für DI-Gitarre/-Bass)

| Pack | Lizenz | Inhalt |
|---|---|---|
| Zach Weeks „TL806 and Basement 1960B“ | CC-BY-SA-4.0 | 4 IRs: EV TL802 1×12 (SM57, Bändchen, Summe) + Marshall 1960B 4×12, 96 kHz/24 Bit |

Die meisten freien Cab-IRs (God's Cab, Origin Effects, Metal Cabs …) sind „free download“ **ohne** klare Weitergabe-Lizenz → nicht einbauen, ohne beim Autor nachzufragen. Alternative: eigene IRs aufnehmen oder aus dem bestehenden Lautsprecher-Filtermodell (`guitar-fx.js`) erzeugen.

## Effekte statt Samples – was geht, was nicht

Geht gut (eine DI-Aufnahme → viele Klänge):
- E-Gitarre DI → Amp-Klangregelung → Drive/Fuzz → **Cab-IR** → Modulation (Chorus, Tremolo, Phaser, Wah) → Raum. Clean, Crunch, Blues, Rock, Funk aus einem Sample-Set.
- E-Bass DI → Kompressor → Amp/Cab → leichter Drive. Mehrere Basssounds aus einem Set.
- Rhodes/Wurli → Tremolo, Chorus, Drive.

Geht nicht (braucht eigene Samples):
- Akustik-/Nylon-/12-Saiter aus E-Gitarre (Korpusresonanz und Anschlag fehlen).
- **Spieltechniken**: Palm Mute, Dead Notes, Slides, Hammer-ons, Slap, Pick vs. Finger. Für Realismus wichtiger als zusätzliche Klangfarben.
- Tonabnehmer-Position nur grob per EQ.

Folgerung: lieber **wenige Instrumente mit vielen Velocity-Layern, Round-Robins, Release-Samples und Artikulationen** als viele flache Instrumente.

## Größe und Hosting

- GitHub Pages: veröffentlichte Seite max. 1 GB, Repo empfohlen max. 1 GB, Bandbreite weich 100 GB/Monat.
- Die Downloads oben sind Roh-Libraries (24 Bit, teils Multi-Mic). Nach Auswahl (Layer/RR/Notenbereich), Downmix und Kompression wird das deutlich kleiner. Zielgröße je Instrument beim Import festlegen und messen.
- Aktuell: unkomprimiertes 16-Bit-PCM (47,9 MB). Ein komprimiertes Format (z. B. Opus/OGG, FLAC) spart viel; Unterstützung von `decodeAudioData` in allen Zielbrowsern (v. a. Safari) prüfen.
- Pro Instrument nachladen (gibt es schon), dazu Browser-Cache (Cache API/Service Worker), damit wiederkehrende Nutzer nicht neu laden.
- Wenn Bandbreite knapp wird: Samples getrennt von der App hosten (CDN/Objektspeicher), App bleibt auf Pages. Dafür ist **kein Wechsel des Tech-Stacks** nötig.

## Quellen

- https://sfzinstruments.github.io/ (Kataloge: drums, basses, guitars, pianos, woodwinds, strings, percussion)
- https://github.com/sfzinstruments/karoryfer.emilyguitar (LICENSE: CC0 1.0)
- https://github.com/sfzinstruments/WilkinsonAudio.NakedDrums
- https://github.com/sfzinstruments/SalamanderGrandPiano
- https://github.com/sfzinstruments/Discord-SFZ-GM-Bank
- https://www.bandshed.net/avldrumkits/
- https://freepats.zenvoid.org/
- https://versilian-studios.com/vsco-community/
- https://zachweeks.gumroad.com/l/tl806cabir
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
