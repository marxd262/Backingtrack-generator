# Machbarkeit: Backingtrack Generator als native App mit JUCE

Stand 2026-11-17, Branch `feat/native-spike`. Alle Messwerte einzeln: `native/ERGEBNISSE.md`. Rechner: Ryzen 7 9800X3D, RTX 4070, Windows 11, Visual Studio 2026, JUCE 9.0.5.

**Ergebnis: Die Portierung gelingt.** Der Nutzer hat den Test am 2026-11-17 für bestanden erklärt; die Web-Version wird durch die native App abgelöst.

## 1. Ergebnis je Schritt

| Schritt | Ergebnis | Zahlen |
|---|---|---|
| 0 Voraussetzungen | Nichts zu installieren. WASAPI geteilt: an allen 7 Ausgängen 480 Frames (10 ms) als einzige Puffergröße | – |
| 1 Gerüst | Kern ohne JUCE, JUCE-Hülle als AudioProcessor (Standalone), CI auf Windows, Linux, macOS grün | erster Build 86 s, EXE 10 MB |
| 2 Oberfläche | Die bestehende Web-Oberfläche läuft unverändert in der WebView2; ersetzt sind zwei Dateien (Player, Sample-Laden) | 0 Fehler bei 97 Dateien, 165 Bilder/s, Anzeigefehler der Position im Mittel 4,7 ms |
| 3 Generator | Schlagzeug und Bass samt Songform, Artikulationen und Mikrotiming in C++, für alle 9 Stile und 9 Grooves | 387 Tracks, 271 052 Ereignisse: 100 % bitgleich auf Windows, Linux und macOS |
| 4 Engine | Sampler für beide Pack-Formate, Transport (Start, Stopp, Tempo, Springen, Schleife), Mixer, Zerre live | Effekt-Regler bis zur Ausgabe etwa 25 bis 30 ms (Web: etwa 95 ms); neue Ereignisse nach rund 9 ms (Web: 100 ms Vorausschau); 0 Aussetzer, Last 1 % eines Puffers; Urteil des Nutzers zum A/B-Paar: „klingen exakt gleich“ |
| 5 Eigene Tracks | Laden (WAV, AIFF, FLAC, MP3, Ogg, WMA über JUCE; M4A/AAC über Media Foundation), Analyse im Hintergrund, synchrone Anzeige, Korrekturen, Systemton-Mitschnitt machbar | 8-Minuten-Track: 1,9 s bis zur Anzeige. Echte Tracks (4): Tempo 4/4, Tonart mit Modus 4/4, Akkord-Grundton 88 %, Dur/Moll 83 %. Generiert (18): Tempo 14/18, Tonart 15/18, Grundton 87 % |
| 6 Trennung (Vorprüfung statt Ausbau) | Demucs (htdemucs) über Python gemessen, nicht in den Kern eingebaut | 8-Minuten-Track: 13 s auf der Grafikkarte, 72 s auf der CPU. **Die Analyse wird mit Stems auf den vier echten Tracks nicht besser:** Grundton 88 bis 90 % statt 88 %, Dur/Moll 74 bis 78 % statt 83 %, Tonart 1 bis 2 von 4 statt 4 von 4 (drei Verdrahtungen geprüft) |

Zu Schritt 6: Die einfache Analyse ist auf die Mischung abgestimmt; mit Stems verschieben sich die Fehler, statt zu verschwinden. Ein faires Urteil über Stems braucht erst die verbesserte Analyse und dichtere Testtracks (Gesang, volle Mischungen). Für den Mixer (Spuren stumm oder leiser) taugen die Stems unabhängig davon.

**Lizenz der Trennmodelle** (Recherche 2026-11-17, Quellen in `ERGEBNISSE.md`): Die Gewichte von Demucs sind nach Aussage des Autors nicht von der MIT-Lizenz gedeckt und nur für Forschung („not covered by the MIT license, and are provided only for scientific purposes“); sie dürfen nicht ausgeliefert werden. Dasselbe Problem haben alle Modelle, die auf MUSDB18 trainiert sind (Open-Unmix, SCNet, die meisten RoFormer-Gewichte). Einzig Spleeter (Deezer) nennt seine vortrainierten Modelle in der eigenen Veröffentlichung MIT-lizenziert, trainiert auf eigenen Daten; es trennt hörbar schlechter (etwa 5,9 dB SDR statt 8,8). Eine schriftliche Bestätigung von Deezer steht aus.

## 2. Risiken und offene Fragen

1. **Klangabgleich der übrigen Stimmen.** Gehört und für gleich befunden sind Schlagzeug und Bass. Offen: Synths, FM-E-Piano, Orgel mit Leslie, Saitenmodell, Verzerrerketten, Echo, Hall und der Begrenzer des Browsers (heute eine Näherung). Das ist der größte Posten.
2. **Trennmodell.** Kein Modell hat gute Qualität und zugleich saubere Lizenz. Und der Nutzen für die Analyse ist nicht belegt (Abschnitt 1).
3. **Analyse jenseits günstiger Fälle.** Schnelle Stücke werden mit halbem Tempo erkannt; nur 4/4, kein Tempowechsel, nur Dur und Moll; die echten Testtracks sind klar gemischt und ohne Gesang.
4. **Oberfläche.** Die Regler der Web-Oberfläche kennen nur ihren eigenen Zustand; für Presets und spätere DAW-Automation müssen sie an die Parameter der Engine gebunden werden. Die Webdateien und Sample-Packs werden noch aus dem Quellordner des Build-Rechners gelesen.
5. **JUCE-Lizenz.** Stufe Starter (kostenlos bis 20 000 $ Umsatz in 12 Monaten). Ungeklärt: ob ein öffentliches MIT-Repo mit JUCE-Hülle unter der EULA unkritisch ist (vor der ersten Veröffentlichung bei JUCE nachfragen).
6. **CI.** Die Commits ab Schritt 5 sind nicht gepusht und in der CI ungeprüft.

**Unter Linux ungetestet:** die Oberfläche in WebKitGTK (sie nutzt CSS Anchor Positioning, Popover, `:has()`, `color-mix()`; die Seite kommt dort über ein eigenes URL-Schema), Audio über ALSA, JACK und PipeWire, Systemton-Mitschnitt und M4A (beides nur Platzhalter), GPU-Beschleunigung, Video in der WebView. Gebaut und im Kern getestet ist Linux bis Schritt 4.

## 3. Aufwand für die vollständige Portierung

In Arbeitstagen der KI, ohne Hör- und Testzeit des Nutzers. Grundlage: Der halbe Generator samt Prüfstand brauchte etwa einen Tag.

| Phase | Inhalt | Tage |
|---|---|---|
| Kern | Rest des Generators (Akkorde, Pad, Lead, Percussion, alle Regeln), Prüfung des Tracks, Würfeln der Form, Klangmodell aus Schlagworten; Gleichheitsprüfung auf alle Schichten | 3 |
| Engine und Klangabgleich | alle Sample-Stimmen und Format-1-Kits 2; Synth-Stimmen, FM-E-Piano, Orgel mit Leslie, Saitenmodell 5 bis 7; Verzerrer, Vibrato, Chorus, Echo, Hall, Raum 3; Summe mit nachgebautem Kompressor 1 bis 2; Klangregler 2 | 13 bis 16 |
| Oberfläche | alle Regler an die Engine, Zustand an Parameter gebunden, eigenes Fenster mit Audio-Einstellungen, Stimmenwahl, Webdateien eingebettet | 4 bis 6 |
| Analyse und Backingtrack-Seite | Analyse verbessern (Tempo, Taktarten, Tempowechsel, mehr Akkorde, Muster) 3 bis 4; Seite mit Griffbrett, Akkordrad, Spuren, Zoom, Schleifen, Tempo, Video 5 bis 7; Trennung im Kern 3 bis 4 | 11 bis 15 |
| Samples | Packs nach Stimmenwahl, Fortsetzung des pausierten Sample-Wechsels auf der nativen Seite | 2 bis 3 |
| Installer | Installer, Signierung, Updates, Nachladen von Packs und Modell | 2 bis 3 |
| **Summe** | | **35 bis 46** |

## 4. Verteilung unter Windows

Recherche vom 2026-11-17; Preise und Regeln ändern sich, vor dem Kauf prüfen.

- **Signierung:** Ohne Signatur zeigt SmartScreen „Der Computer wurde durch Windows geschützt“, und der Ruf beginnt mit jeder Version neu. Mit Signatur erscheint der Herausgebername, die Warnung bleibt aber, bis genug Downloads zusammen sind (laut Microsoft Wochen und Hunderte Installationen); der Ruf hängt dann an der Signatur und geht auf neue Versionen über. Ein EV-Zertifikat bringt keinen Vorteil mehr.
- **Kosten:** Azure Artifact Signing 9,99 $ im Monat, aber Einzelpersonen nur aus den USA und Kanada; für ein deutsches Gewerbe ungeklärt. Sonst Cloud-Zertifikate: SSL.com ab 180 $ im Jahr, Certum ab 209 €. Der Microsoft Store signiert kostenlos (Anmeldung seit 2025 gratis), verlangt aber sein eigenes Paketformat und eine Prüfung.
- **Installer und Updates:** Velopack (MIT) installiert ohne Administratorrechte ins Benutzerprofil und bringt Updates mit; Alternative NSIS oder Inno Setup mit WinSparkle.
- **WebView2:** in Windows 11 enthalten; unter Windows 10 fast immer vorhanden, sonst lädt der 2 MB große Installer von Microsoft sie nach.
- **Größe:** App 10 MB, Sample-Packs rund 50 MB, ein Trennmodell 80 bis 170 MB (beim ersten Gebrauch nachladen).

## 5. Spätere Ergänzungen

| Ergänzung | Inhalt | Tage |
|---|---|---|
| Linux | Feinschliff der Oberfläche in WebKitGTK, PipeWire, Pakete (AppImage, deb, Flatpak) | 4 bis 6 |
| Plugins | VST3 und CLAP aus demselben AudioProcessor, Transport der DAW an der vorhandenen Schnittstelle; ARA lohnt hier nicht | 5 bis 8 |
| macOS | Build läuft in der CI schon; Audio, WebView, Signierung und Notarisierung (99 $ im Jahr) | 3 bis 5 |
| Aufnahme und ASIO | Eingang, Latenzausgleich, ASIO als Gerätetyp | 2 bis 3 |

## 6. Die Web-App

Sie bleibt als Stand `port-base` eingefroren und dient als Demo und als Referenz: Der Generator wird weiter Ereignis für Ereignis gegen sie geprüft, der Klang Stimme für Stimme gegen ihren Render. Neue Funktionen kommen nur noch in die native App.

## 7. Empfehlung

**Weitermachen: ja.** Die drei harten Fragen sind beantwortet: Die Oberfläche lässt sich übernehmen, der Generator lässt sich bitgleich portieren, und die native Engine klingt wie das Web und reagiert schneller.

Reihenfolge (Einzelheiten und das erste Arbeitspaket: `native/PLAN_NATIV.md`):

1. Analyse verbessern und die Backingtrack-Seite ausbauen (der Wunsch des Nutzers; messbar an Labels).
2. Generator vollständig portieren und alle Sample-Stimmen spielen (mechanisch, bitgleich prüfbar).
3. Synth-Stimmen und Effekte, Stimme für Stimme mit A/B gegen das Web.
4. Fenster, Einstellungen und Bindung der Regler.
5. Installer und Signierung.

Die Quellentrennung kommt erst, wenn ihr Nutzen für die Analyse an dichteren Tracks belegt und die Lizenz geklärt ist.
