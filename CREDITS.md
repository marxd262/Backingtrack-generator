# Credits

Die Sample-Klänge des Backingtrack Generators stammen aus freien Sammlungen. Je Quelle: Name, Urheber, Lizenz, Link und was für die App verändert wurde. Die vollständigen Lizenztexte liegen neben den Packs in `src/assets/samples/` (`LICENSE-*.md`). In der App steht dasselbe auf der Seite „Credits“ (`src/ui/credits.html`, Link auf der Startseite). Programmcode aus fremden Quellen steht am Ende; dieser Abschnitt (Chromium) kommt mit der nativen App auf die Seite „Credits“ (Task 35).

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

## Chromium (Web Audio): Kompressor, Normierung des Halls, Verzerrerkette, Vibrato und Chorus, Bausteine der Synth-Stimmen

- Urheber: Google Inc. (Copyright 2010: `reverb.cc`, `audio_utilities.cc`, `biquad.cc`, `delay.cc`; Copyright 2011: `dynamics_compressor.cc`; Copyright 2013: `up_sampler.cc`, `down_sampler.cc`) und The Chromium Authors (Copyright 2026: `periodic_wave_handler.cc`; Copyright 2022: `wave_shaper_handler.cc`, `audio_param_handler.cc`, `oscillator_handler.cc`, `oscillator_handler.h`, `audio_scheduled_source_handler.cc`, `audio_buffer_source_handler.cc`, `biquad_filter_handler.cc`; Copyright 2020: `oscillator_kernel_sse2.cc`; Copyright 2016: `delay_sse2.cc`; Copyright 2014: `stereo_panner.cc`)
- Lizenz: BSD-3-Clause (`reverb.cc`, `dynamics_compressor.cc`, `biquad.cc`, `up_sampler.cc`, `down_sampler.cc`, `wave_shaper_handler.cc`, `audio_param_handler.cc`, `oscillator_handler.cc`, `oscillator_handler.h`, `oscillator_kernel_sse2.cc`, `periodic_wave_handler.cc`, `audio_scheduled_source_handler.cc`, `audio_buffer_source_handler.cc`, `biquad_filter_handler.cc`, `delay_sse2.cc`, `stereo_panner.cc`) und BSD mit zwei Bedingungen (`audio_utilities.cc`, `delay.cc`), Wortlaut unten
- Quelle: https://chromium.googlesource.com/chromium/src/+/refs/tags/158.0.8127.18/third_party/blink/renderer/platform/audio/ (`delay_sse2.cc` darin unter `cpu/x86/`; `audio_utilities.cc`: gelesen am Stand main) und .../modules/webaudio/ (`wave_shaper_handler.cc`, `audio_param_handler.cc`, `oscillator_handler.cc`, `oscillator_handler.h`, `cpu/x86/oscillator_kernel_sse2.cc`, `periodic_wave_handler.cc`, `audio_scheduled_source_handler.cc`, `audio_buffer_source_handler.cc`, `biquad_filter_handler.cc`)
- Nur gelesen, nichts übernommen (für die Bausteine der Synth-Stimmen): `audio_node_input.cc`, `audio_handler.cc`, `channel_merger_handler.cc`, `audio_param.cc` unter .../modules/webaudio/ und `audio_bus.cc` unter .../platform/audio/
- Verändert: nach C++ für den Kern übertragen, ohne Chromium; der Kompressor in `native/core/src/compressor.cpp` (ohne die Messung der Pegelminderung; mit den zwei Einzeilern `DecibelsToLinear` und `LinearToDecibels` aus `audio_utilities.cc`), die Normierung der Impulsantwort in `native/core/src/convolver.cpp`; die Verzerrerkette der Schichten in `native/core/src/guitar_fx.cpp` (die Überabtastung der Wellenformer aus `up_sampler.cc`, `down_sampler.cc` und `wave_shaper_handler.cc`, die Annäherung der Reglerwerte aus `audio_param_handler.cc`, die diskrete Zeitkonstante der Annäherung, `DiscreteTimeConstantForSampleRate`, aus `audio_utilities.cc`), ihre Filterkoeffizienten und ihr Rechenschritt des Filters aus `biquad.cc` in `native/core/src/sampler.h` (`lowpassOf`, `highpassOf`, `peakingOf`, `Biquad::step`); Vibrato und Chorus der Schichten in `native/core/src/mod_fx.cpp` (der Verzögerungsring und die Reihenfolge Schreiben vor Lesen aus `delay.cc`, die Länge des Rings mit `TimeToSampleFrame` aus `audio_utilities.cc`, die Leseposition und die Interpolation in float aus `delay_sse2.cc`, die Verstärkungen der Stereo-Lage eines Mono-Eingangs aus `stereo_panner.cc`, die Phase der Sinus-LFOs, ihr Schritt in float und die Summe in double, aus `oscillator_handler.cc`; dessen Wellentabelle ist nicht übernommen); die Bausteine der Synth-Stimmen: die Wellentabellen in `native/core/src/osc.cpp` aus `periodic_wave_handler.cc` (die Rücktransformation mit eigenem Code in double), der Oszillator dort aus `oscillator_handler.cc` und `oscillator_handler.h`, bei fester Frequenz mit dem Leseindex in vier float-Bahnen aus `oscillator_kernel_sse2.cc` (`ProcessKRateVector`, in skalarem C++), die Zeitachse eines Reglers in `native/core/src/param.cpp` aus `audio_param_handler.cc` und `DiscreteTimeConstantForSampleRate` aus `audio_utilities.cc` (ohne den Neubeginn je Renderblock), der Synth-Ton in `native/core/src/patch.cpp` (Start und Ende einer Quelle aus `audio_scheduled_source_handler.cc` mit `TimeToSampleFrame` aus `audio_utilities.cc`, die Pufferquelle aus `audio_buffer_source_handler.cc`, die Koeffizienten je Frame aus `biquad_filter_handler.cc`, die Verstärkungen der Stereo-Lage aus `stereo_panner.cc`) und dazu der Bandpass und die Grenzfälle der Filterkoeffizienten aus `biquad.cc` in `native/core/src/sampler.h` (`bandpassOf`)
- Wortlaut von `reverb.cc`, `dynamics_compressor.cc` und `biquad.cc` (in den Dateien gleich, nur das Jahr unterscheidet sich):

```
    Copyright (C) 2010, 2011 Google Inc. All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

    1.  Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.
    2.  Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.
    3.  Neither the name of Apple Computer, Inc. ("Apple") nor the names of
        its contributors may be used to endorse or promote products derived
        from this software without specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
    WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
    DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
    THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

- Wortlaut von `audio_utilities.cc` und `delay.cc` (in beiden Dateien gleich):

```
    Copyright (C) 2010, Google Inc. All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:
    1.  Redistributions of source code must retain the above copyright
       notice, this list of conditions and the following disclaimer.
    2.  Redistributions in binary form must reproduce the above copyright
       notice, this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS'' AND
    ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS BE LIABLE
    FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
    DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
    SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
    CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
    LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
    OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
    DAMAGE.
```

- Wortlaut von `up_sampler.cc` und `down_sampler.cc` (in beiden Dateien gleich):

```
    Copyright (C) 2013 Google Inc. All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are
    met:

        * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
        * Redistributions in binary form must reproduce the above
    copyright notice, this list of conditions and the following disclaimer
    in the documentation and/or other materials provided with the
    distribution.
        * Neither the name of Google Inc. nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
    "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
    LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
    A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
    OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
    LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
    DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
    OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

- Wortlaut von `delay_sse2.cc` („Copyright 2016 The Chromium Authors“), `stereo_panner.cc` („Copyright 2014 The Chromium Authors“), `periodic_wave_handler.cc` („Copyright 2026 The Chromium Authors“) und `oscillator_kernel_sse2.cc` („Copyright 2020 The Chromium Authors“); derselbe Text wie unten, der der Datei `LICENSE` von Chromium:

```
    Copyright 2016 The Chromium Authors (delay_sse2.cc)
    Copyright 2014 The Chromium Authors (stereo_panner.cc)
    Copyright 2026 The Chromium Authors (periodic_wave_handler.cc)
    Copyright 2020 The Chromium Authors (oscillator_kernel_sse2.cc)

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are
    met:

       * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
       * Redistributions in binary form must reproduce the above
    copyright notice, this list of conditions and the following disclaimer
    in the documentation and/or other materials provided with the
    distribution.
       * Neither the name of Google LLC nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
    "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
    LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
    A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
    OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
    LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
    DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
    OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

- Wortlaut von `wave_shaper_handler.cc`, `audio_param_handler.cc`, `oscillator_handler.cc`, `oscillator_handler.h`, `audio_scheduled_source_handler.cc`, `audio_buffer_source_handler.cc` und `biquad_filter_handler.cc` (alle „Copyright 2022 The Chromium Authors“; der Text ist der der Datei `LICENSE` von Chromium, dort mit „Copyright 2015 The Chromium Authors“):

```
    Copyright 2022 The Chromium Authors

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are
    met:

       * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
       * Redistributions in binary form must reproduce the above
    copyright notice, this list of conditions and the following disclaimer
    in the documentation and/or other materials provided with the
    distribution.
       * Neither the name of Google LLC nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
    "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
    LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
    A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
    OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
    LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
    DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
    OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
