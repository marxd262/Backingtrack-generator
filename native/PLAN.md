# Machbarkeitstest native App: Voraussetzungen und Plan (Schritt 0)

> Abgeschlossen am 2026-11-17. Ergebnis: `MACHBARKEIT_JUCE.md`. Wie es weitergeht: `PLAN_NATIV.md`.

Stand 2026-11-16, Branch `feat/native-spike` (von `develop`, gleich Tag `port-base`, `3ad994b`). Kein Code in diesem Schritt.

## 1. Werkzeuge unter Windows (geprüft auf diesem Rechner)

| Werkzeug | Stand | Folge |
|---|---|---|
| Visual Studio Community 2026 (18.12), MSVC 14.52, Windows-SDK 10.0.26100, ATL | vorhanden | reicht |
| Visual Studio Build Tools 2019 (16.11) | vorhanden | Rückfall, falls JUCE mit MSVC 14.52 nicht baut (JUCE verlangt mindestens VS 2019) |
| CMake 4.3.1, Ninja 1.13.2 | vorhanden, aber nur in Visual Studio (nicht im `PATH`) | `native/build.ps1` lädt die VS-Umgebung selbst; keine Installation nötig |
| WebView2-Laufzeit 157.0 | vorhanden | reicht |
| WebView2-SDK (NuGet `Microsoft.Web.WebView2`) | fehlt | lädt CMake beim Konfigurieren, keine Handarbeit |
| Node 26.12, Git 2.56, `gh`, ffmpeg 9.0, Python 3.15 | vorhanden | Node für die Gleichheitsprüfung, Python nur für die ONNX-Umwandlung (Schritt 6) |

**Du musst nichts installieren.** Nur wenn du `cmake` selbst aus einer beliebigen Konsole aufrufen willst: `winget install Kitware.CMake Ninja-build.Ninja`, danach neue Konsole. Sonst genügt `native/build.ps1` (kommt in Schritt 1) oder die „Developer PowerShell for VS 2026“.

Rechner: Ryzen 7 9800X3D (8 Kerne), 61,6 GB RAM, RTX 4070 (für DirectML in Schritt 6), 840 GB frei.

## 2. Audio-Ausgabe: WASAPI (geteilt)

Gemessen mit einer kleinen Probe (`IAudioClient3::GetSharedModeEnginePeriod`) an allen sieben aktiven Ausgängen (Focusrite USB, Sound Blaster Z analog und SPDIF, Helix LT, zweimal NVIDIA HDMI, Steam):

- Mischformat überall 48 000 Hz, Periode der Windows-Mischung **10 ms = 480 Frames**, kleinste geteilte Periode ebenfalls 480 Frames. Der Niedriglatenz-Modus von Windows (unter 10 ms im geteilten Betrieb) wird von **keinem** dieser Treiber angeboten.
- Der Realtek-Onboard-Ausgang hat gerade keinen aktiven Endpunkt (nichts eingesteckt) und ist nicht gemessen. Realtek-Herstellertreiber melden üblicherweise ebenfalls 480; nur der Windows-eigene HD-Audio-Treiber geht tiefer.
- Folge: Im geteilten Betrieb ist **480 Frames (10 ms) die stabile und zugleich kleinste Puffergröße**; 960 Frames (20 ms) als sichere Reserve. Erwartete Ausgabelatenz 20 bis 30 ms (Puffer plus Windows-Mischung plus Gerät). Eine Regleränderung wirkt damit nach etwa einem Puffer plus Glättung, also 15 bis 35 ms; die Web-Version braucht rund 100 ms Vorausschau. Ob 480 Frames unter Last ohne Aussetzer laufen, misst Schritt 4 (Zähler für Aussetzer in der App).
- Samplerate: Im geteilten Betrieb gibt Windows 48 kHz vor. Die Packs liegen in 44,1 kHz (Format 2) und 22 bis 48 kHz (Format 1); der Sampler rechnet ohnehin über die Abspielgeschwindigkeit um.
- Exklusiver Betrieb (3 ms möglich) und ASIO sind nicht Teil des Tests. JUCE bietet „Windows Audio“, „Low Latency Mode“ und „Exclusive Mode“ als Gerätetypen an, die Auswahl kostet nichts.

## 3. JUCE: Version und Lizenz (deine Entscheidung vor Schritt 1)

- **Version: JUCE 9.0.5** (2026-11-02), fest angeheftet. Entscheidung des Nutzers vom 2026-11-16, abweichend vom Auftrag (dort JUCE 8): JUCE 8 bekommt nur noch Sicherheits-Releases (`8.0.17-security`), der Port würde ohnehin auf 9 laufen. JUCE 9 liegt nach meinem Wissensstand; vor Schritt 1 lese ich `BREAKING_CHANGES.md` (9.0.0 bis 9.0.5). Eine JUCE-9-Lizenz deckt laut EULA auch alle älteren Versionen.
- **Lizenz:** JUCE ist doppelt lizenziert: AGPLv3 oder kommerzielle EULA. AGPL scheidet nach deiner Regel aus, also die EULA. Stufen (JUCE 8 und 9 gleich, gelesen am 2026-11-16 auf juce.com):

| Stufe | Grenze (Umsatz oder Finanzierung der letzten 12 Monate) | Preis |
|---|---|---|
| Starter | bis 20 000 US-Dollar | kostenlos |
| Indie | bis 300 000 US-Dollar | 40 $/Monat oder 800 $ einmalig je Nutzer |
| Pro | unbegrenzt | 175 $/Monat oder 3500 $ einmalig je Nutzer |

- **Zutreffend: Starter**, solange du als Einzelperson mit JUCE-Produkten höchstens 20 000 $ im Jahr einnimmst (bei einer Firma zählt der gesamte Firmenumsatz). Darüber: Indie kaufen oder Entwicklung und Verteilung einstellen.
- **Was daraus folgt:** Verteilen und Verkaufen der App ist erlaubt, auch ohne Quelltext. Ein Startbildschirm „Made with JUCE“ wird nicht verlangt. JUCE selbst darf nicht einzeln weitergegeben werden, deshalb kommt es per FetchContent und nicht ins Repo. Mit der Nutzung nimmst du die EULA an.
- **Offen:** Das Repo ist öffentlich und MIT. Abschnitt 2.3 der EULA verbietet alles, was JUCE selbst unter eine Open-Source-Lizenz mit Offenlegungspflicht bringt. Eigener MIT-Code neben JUCE ist nach meinem Verständnis unkritisch, die EULA sagt es aber nicht ausdrücklich. Vor der ersten Veröffentlichung einer Binärdatei bei sales@juce.com klären. Für den Test ohne Belang. Der Kern ohne JUCE bleibt davon unberührt.

## 4. Aufbau

```
native/
  core/      C++20, ohne JUCE: Generator, Sampler und DSP, Analyse, Schnittstelle Zeitgeber
  core/tests Tests des Kerns (laufen unter Windows und Linux)
  app/       JUCE-Hülle: AudioProcessor, Standalone, WebView, Transport der App
  platform/  Schnittstellen mit win/ und linux/ (Systemton-Mitschnitt, GPU-Beschleunigung; Linux zuerst Platzhalter)
  tools/     Node-Skripte (Ereignis-Export aus port-base), Modell-Download
```

- Zeitgeber: Der Kern kennt nur `TransportSource` (Position in Schlägen, Tempo, läuft/steht, Schleife). Die App liefert ihren eigenen Transport, später ein Plugin den `AudioPlayHead` der DAW.
- Plugin-Formate später: `FORMATS Standalone` in `juce_add_plugin` um `VST3` (und CLAP über eine Erweiterung) ergänzen; die Hülle ist von Anfang an ein AudioProcessor.
- Parameter: `AudioProcessorValueTreeState`, damit dieselben Parameter später die DAW automatisieren kann.

## 5. Schritte, Aufwand, Ergebnis

Aufwand in Arbeitstagen von mir, ohne deine Testzeit.

| Schritt | Inhalt | Aufwand | Messwert am Ende |
|---|---|---|---|
| 1 Gerüst | CMake, JUCE per FetchContent, Standalone mit Audio-Einstellungen und Testton, Kern-Bibliothek mit Test, CI Windows und Linux | 1 | Bauzeiten, Größe der EXE, CI grün |
| 2 Oberfläche | `src/ui` aus der WebView (WebView2), Brücke in beide Richtungen, Pegel und Position zur UI | 1,5 bis 2,5 | Liste: läuft unverändert / bricht / anzupassen; Bildrate der Anzeige |
| 3 Generator | Drums und Bass für zwei Stile mit Songform und Artikulationen in C++; Node-Export aus `port-base`, Vergleich je Ereignis | 2 bis 3 | Anteil identischer Ereignisse über Seeds und Einstellungen |
| 4 Engine | Sampler nach `docs/PACK_FORMAT.md` (Format 1 und 2), Transport, ein Effekt, Reaktionszeit, Offline-WAV, A/B gegen Web | 3 bis 4 | Reaktionszeit in ms je Puffergröße, Aussetzer, CPU-Last |
| 5 Analyse | Datei laden, Tempo, Takt 1, Akkorde, Tonart, Anzeige, Korrektur, Systemton-Mitschnitt, Trefferquoten | 3 bis 4 | Trefferquoten generiert und echt, Rechenzeit |
| 6 Trennung | Trennmodell über ONNX Runtime, Erkennung auf getrennten Spuren, CPU und GPU | 2 bis 4 | Trefferquote vorher/nachher, Rechenzeit für 5 Minuten, Paketgröße |
| 7 Bericht | `native/MACHBARKEIT_JUCE.md` | 0,5 | – |

Summe 13 bis 19 Arbeitstage.

Wichtige Festlegungen je Schritt:

- **2:** Die UI ruft heute `play()` aus `src/audio` (Web Audio) direkt auf. In der WebView ersetzt ein Brücken-Modul diesen Player (gleiche Methoden: `setLevel`, `setTempo`, `setTimbre`, `level()`, `songTime()` …) und spricht mit der Engine. `src/` bleibt unverändert; die Dateien werden über den Ressourcen-Anbieter von JUCE ausgeliefert, das Brücken-Modul liegt in `native/`.
- **3:** Der Zufall ist mulberry32 mit FNV-1a-Verzweigung (`src/core/rng.js`), also bitgenau portierbar. Der Export läuft gegen einen Arbeitsbaum von `port-base` (`git worktree`), nicht gegen den Arbeitsstand.
- **4:** FLAC und WAV im Kern mit dr_libs (gemeinfrei), JSON mit nlohmann/json (MIT), damit der Sampler ohne JUCE testbar bleibt.
- **5:** Dekodieren der Nutzerdateien in der Hülle (JUCE: WAV, FLAC, MP3; M4A/AAC über Media Foundation, nur Windows, hinter Schnittstelle). Label-Format: eine JSON-Datei neben dem Track (`tempo`, `beat1`, `key`, `chords: [{t, chord}]`). Der Ordner `C:\dev\samples-raw\analysis-tests\` **existiert noch nicht**; die echten Tracks brauche ich vor Schritt 5.
- **6:** Erst prüfen, ob die Gewichte von Demucs weitergegeben werden dürfen (trainiert auf MUSDB18-HQ, das nur für Forschung freigegeben ist). Ausweichmöglichkeiten mit geklärter Lizenz kommen in den Bericht des Schritts.

## 6. Größte Risiken

1. **Klangabgleich (Schritt 4 und Vollport):** Die Web-Version nutzt Bausteine des Browsers (Kompressor, Faltungshall, Filter, Rampen). Gleicher Klang heißt, deren Verhalten nachzubauen, vor allem den Begrenzer. Im Test nur Schlagzeug, Bass und ein Effekt; der Aufwand für alle Stimmen (Orgel mit Leslie, FM-E-Piano, Saitenmodell, Verzerrer) ist der größte Posten des Vollports.
2. **Trennmodell (Schritt 6):** Umwandlung nach ONNX (die Spektralteile müssen aus dem Modell heraus in den Kern), Lizenz der Gewichte, Rechenzeit auf der CPU.
3. **Oberfläche in der WebView (Schritt 2):** Kopplung der UI an Web Audio (Pegelanzeige, Abspielposition, Laden der Packs), ES-Module über den Ressourcen-Anbieter, `localStorage`. Unter Linux (WebKitGTK) zusätzlich Darstellung und Tempo der Canvas-Anzeigen.
4. **Gleichheit des Generators (Schritt 3):** `Math.round` rundet anders als `std::round`, die Sortierung muss stabil sein, Rundung auf 6 Stellen, Reihenfolge der Zufallsziehungen. Lösbar, aber jede Abweichung verschiebt alle folgenden Ziehungen.
5. **Erkennung auf echten Tracks (Schritt 5):** Die einfache Methode wird bei dichten Mischungen deutlich schlechter sein als bei generierten Tracks. Das ist erwartet und der Anlass für Schritt 6.
6. **Werkzeugkette:** JUCE 9 kenne ich nur aus seiner Dokumentation, und JUCE 9 mit MSVC 14.52 und CMake 4.3 ist ungeprüft. Rückfall: Build Tools 2019.
7. **GPU:** DirectML wird von Microsoft nur noch gepflegt, nicht weiterentwickelt; für den Test reicht es, für das Produkt ist die Wahl offen.

## 7. CI (GitHub Actions, Vorschlag)

Das Repo ist öffentlich, die Standard-Runner kosten nichts. Neue Datei `.github/workflows/native.yml`, ausgelöst nur bei Änderungen unter `native/**` und an der Datei selbst (Push auf `feat/native-spike`, Pull Requests nach `develop`); `pages.yml` bleibt unberührt.

| Job | Runner | Tut |
|---|---|---|
| `windows` | `windows-latest` | MSVC und Ninja, konfigurieren, Kern und App bauen, alle Tests (`ctest`), EXE als Artefakt |
| `linux` | `ubuntu-24.04` | Pakete für JUCE (ALSA, JACK, X11, Freetype, Fontconfig, libcurl, WebKitGTK 4.1, GTK 3), Kern und App bauen, **Kern-Tests** samt Gleichheitsprüfung |
| `macos` (optional) | `macos-latest` | nur kompilieren, darf scheitern (`continue-on-error`) |

- Gleichheitsprüfung: Checkout mit Tags, `git worktree add` für `port-base`, Node erzeugt die Ereignis-JSON, der C++-Test vergleicht. Keine großen Testdaten im Repo. Der Tag `port-base` liegt auf `origin`.
- Abhängigkeiten als Archiv per FetchContent mit festem Hash. Kein Zwischenspeicher, solange der Download klein bleibt (JUCE: 25 MB).
- Modelle (Schritt 6) lädt die CI nicht; Tests, die ein Modell brauchen, werden ohne Modell übersprungen und laufen lokal.
- Gepusht wird erst nach deinem OK; bis dahin ist „CI grün“ nicht nachweisbar.
