# Credits

Die Sample-Klänge des Backingtrack Generators stammen aus freien Sammlungen. Je Quelle: Name, Urheber, Lizenz, Link und was für die App verändert wurde. Die vollständigen Lizenztexte liegen neben den Packs in `src/assets/samples/` (`LICENSE-*.md`). In der App steht dasselbe auf der Seite „Credits“ (`src/ui/credits.html`, Link auf der Startseite).

## MuseScore_General

- Urheber: S. Christian Collins (MuseScore_General), auf Grundlage von FluidR3 (Frank Wen) und FluidR3Mono (Michael Cowgill); weitere Urheber im Lizenztext
- Lizenz: MIT
- Quelle: https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/
- Verändert: benutzte Instrumente ausgeschnitten, Ogg Vorbis zu 16-Bit-PCM dekodiert, Crash auf 2,5 s gekürzt (`scripts/extract-samples.mjs`)
- Lizenztext: `src/assets/samples/LICENSE-MuseScore_General.md`

## Freepats FSBS Electric Guitar (Clean, Jazz)

- Urheber: FreePats-Projekt
- Lizenz: CC0 1.0 (gemeinfrei; Nennung freiwillig)
- Quelle: https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html
- Verändert: 13 Samples je Gitarre ausgeschnitten, unverändert als 16-Bit-PCM (`scripts/extract-samples.mjs`)
- Lizenztext: `src/assets/samples/LICENSE-Freepats-FSBS.md`

## Naked Drums (SFZ)

- Urheber: Wilkinson Audio (Aufnahme), kinwie (SFZ-Mapping)
- Lizenz: CC-BY 4.0, https://creativecommons.org/licenses/by/4.0/
- Quelle: https://github.com/sfzinstruments/WilkinsonAudio.NakedDrums
- Verändert: Auswahl von 13 Schlägen (90 Zonen), Mikrofone nach dem Standard-Mix des Mappings gemischt: Direkt (Direktmikrofone, Overheads, China/Wide OH) und Raum (Close Room, Far Rooms, Mid-Side), links und rechts getauscht, gekürzt mit Ausblendung, ein Pegelfaktor für das ganze Pack, 16 Bit / 44,1 kHz, FLAC (`scripts/import-sfz.mjs`)
- Lizenztext: `src/assets/samples/LICENSE-drums-naked.md`

## MuldjordKit v1.0 (SFZ)

- Urheber: Lars Muldjord (Aufnahme), kinwie (SFZ-Mapping)
- Lizenz: CC-BY 4.0, https://creativecommons.org/licenses/by/4.0/
- Quelle: https://github.com/sfzinstruments/DrumGizmo.MuldjordKit
- Verändert: Auswahl von 11 Schlägen (86 Zonen), Mikrofone nach dem Standard-Mix des Mappings zu Direkt und Raum gemischt (Triggerkanal weggelassen), links und rechts getauscht, gekürzt mit Ausblendung, Crash um 3 dB angehoben, ein Pegelfaktor für das ganze Pack, 16 Bit / 44,1 kHz, FLAC (`scripts/import-sfz.mjs`)
- Lizenztext: `src/assets/samples/LICENSE-drums-muldjord.md`
