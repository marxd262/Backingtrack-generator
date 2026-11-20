#pragma once

// The sampler of the engine. It follows the web app: src/audio/voices/sampler.js (playNote), sample-zones.js,
// sample-hits.js (format 2 kits) and sample.js (notes). The fine values of the voices come from tunables.js through
// sound.json (sound_data.h). The engine (engine.cpp) hands every event to the voice of its layer and renders the tones.

#include "btg/engine.h"
#include "btg/pack.h"
#include "generator_internal.h"
#include "sound_data.h"
#include "sound_model.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <numbers>
#include <string>

namespace btg::detail {

constexpr int TONES = 256;
extern const char* const LAYER_NAMES[Engine::layerCount];
// DRUM_NAMES, then PERCUSSION_NAMES of src/core/events.js
extern const char* const HIT_NAMES[22];

enum class Art { none, staccato, dead, chuck, choke, palmMute, hammer, slideIn, scoop, slideOff, fall, bend, vibrato, swell };
// Every art text the generator writes (articulation.js, organ.js); PlayEvent::artName points into it (art zones compare it).
extern const char* const ART_NAMES[22];

struct PlayEvent {
    double beat = 0.0, durBeats = 0.0; // when the engine triggers it and how long, in beats; a glide's lead is in both
    double leadBeats = 0.0;            // slideIn, scoop: the tone starts this much before its event, the glide ends on the event
    Engine::Layer layer = Engine::drums;
    bool hit = false;
    int midi = 0, name = -1;           // notes; hits: index into HIT_NAMES
    double vel = 0.0;
    Art art = Art::none;               // what the sampler computes (pull is hammer; arts it ignores are none)
    const char* artName = nullptr;     // the event's art text from ART_NAMES, nullptr = none
    double artSemi = NAN, artTime = NAN, artRate = NAN;
    int strumIndex = -1, strumCount = 0; // chords: place of the tone in its stab and the stab's size (Event::strum)
    double strumUp = NAN;
    bool ring = false;
    double t = 0.0;                    // the event's time in the stream (s): the strum compares it
    double beatInBar = NAN;            // Event::beat
    double leslie = NAN, swell = NAN;  // Event::leslie, ::swell (the organ's rules, organ.cpp); NaN: the field is absent
};

struct Biquad { // Web Audio BiquadFilterNode, coefficients divided by a0; process() is direct form 1
    double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0, x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0;
    double process(double x) {
        const double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        return y;
    }
    // BiquadFilterNode as Chromium runs it (third_party/blink/renderer/platform/audio/biquad.cc at 158.0.8127.18, Biquad::Process): the sum in
    // double, the output rounded to float and that kept as the state. The layer effects' chains and the synth tones (patch.h) use it; the
    // sampler's and the sum's filters keep double. The notice of biquad.cc:
    /*
     * Copyright (C) 2010 Google Inc. All rights reserved.
     *
     * Redistribution and use in source and binary forms, with or without
     * modification, are permitted provided that the following conditions
     * are met:
     *
     * 1.  Redistributions of source code must retain the above copyright
     *     notice, this list of conditions and the following disclaimer.
     * 2.  Redistributions in binary form must reproduce the above copyright
     *     notice, this list of conditions and the following disclaimer in the
     *     documentation and/or other materials provided with the distribution.
     * 3.  Neither the name of Apple Computer, Inc. ("Apple") nor the names of
     *     its contributors may be used to endorse or promote products derived
     *     from this software without specific prior written permission.
     *
     * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
     * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
     * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
     * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
     * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
     * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
     * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
     * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
     * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
     * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
     */
    float step(float x) {
        const float y = static_cast<float>(b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2);
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        return y;
    }
};
// The coefficients of a BiquadFilterNode as biquad.cc computes them (SetLowpassParams, SetHighpassParams, SetBandpassParams,
// SetPeakingParams; its notice above, at Biquad::step), for the layer effects and the synth voices: the same formulas as lowpass() and the
// others below, but their pow10 is fdlibm::expf, a float, and the normalised frequency is the float frequency over the Nyquist frequency.
// Lowpass, highpass and bandpass take biquad.cc's limits where that frequency reaches 0 or 1; the peaking filter is used inside them only.
inline double pow10(double x) { return static_cast<double>(static_cast<float>(std::exp(static_cast<double>(static_cast<float>(x * std::numbers::ln10))))); }
inline Biquad normalized(double b0, double b1, double b2, double a0, double a1, double a2) {
    const double inverse = 1 / a0;
    Biquad f;
    f.b0 = b0 * inverse; f.b1 = b1 * inverse; f.b2 = b2 * inverse; f.a1 = a1 * inverse; f.a2 = a2 * inverse;
    return f;
}
inline Biquad lowpassOf(double hz, double qDb, double sr) {
    const double cutoff = std::clamp(hz / (sr / 2), 0.0, 1.0);
    if (cutoff == 1) return normalized(1, 0, 0, 1, 0, 0);
    if (!(cutoff > 0)) return normalized(0, 0, 0, 1, 0, 0);
    const double theta = std::numbers::pi * cutoff, alpha = std::sin(theta) / (2 * pow10(qDb / 20)), cosw = std::cos(theta), beta = (1 - cosw) / 2;
    return normalized(beta, 2 * beta, beta, 1 + alpha, -2 * cosw, 1 - alpha);
}
inline Biquad highpassOf(double hz, double qDb, double sr) {
    const double cutoff = std::clamp(hz / (sr / 2), 0.0, 1.0);
    if (cutoff == 1) return normalized(0, 0, 0, 1, 0, 0);
    if (!(cutoff > 0)) return normalized(1, 0, 0, 1, 0, 0);
    const double theta = std::numbers::pi * cutoff, alpha = std::sin(theta) / (2 * pow10(qDb / 20)), cosw = std::cos(theta), beta = (1 + cosw) / 2;
    return normalized(beta, -2 * beta, beta, 1 + alpha, -2 * cosw, 1 - alpha);
}
inline Biquad bandpassOf(double hz, double q, double sr) {
    const double frequency = std::max(0.0, hz / (sr / 2));
    q = std::max(0.0, q);
    if (!(frequency > 0 && frequency < 1)) return normalized(0, 0, 0, 1, 0, 0);
    if (!(q > 0)) return normalized(1, 0, 0, 1, 0, 0);
    const double w0 = std::numbers::pi * frequency, alpha = std::sin(w0) / (2 * q), k = std::cos(w0);
    return normalized(alpha, 0, -alpha, 1 + alpha, -2 * k, 1 - alpha);
}
inline Biquad peakingOf(double hz, double q, double db, double sr) {
    const double w0 = std::numbers::pi * (hz / (sr / 2)), alpha = std::sin(w0) / (2 * q), k = std::cos(w0), a = pow10(db / 40);
    return normalized(1 + alpha * a, -2 * k, 1 - alpha * a, 1 + alpha / a, -2 * k, 1 - alpha / a);
}
Biquad lowpass(double hz, double qDb, double sr);
Biquad highpass(double hz, double qDb, double sr);
Biquad peaking(double hz, double db, double q, double sr);
Biquad lowshelf(double hz, double db, double sr);
Biquad highshelf(double hz, double db, double sr);

struct Eq { double lowDb, midDb, midHz, highDb, highHz; }; // sampler.js: shelf at 200 Hz, bell at midHz, shelf from highHz

struct Note { // what playNote gets; the defaults are playNote's. Build it with designated initialisers.
    const Pack* pack = nullptr;
    const Pack::Zone* zone = nullptr;
    int sample = 0, key = 0;
    double dur = 0.0, vel = 0.0, gain = 1.0, cents = 0.0;
    Art art = Art::none;
    double artSemi = NAN, artTime = NAN, artRate = NAN, filter = 20000.0, naturalDecay = 0.0;
    double timeScale = 1.0;         // factor on the zone's attack, hold, decay and release (the chords' length and the pad's attack knob)
    double lead = 0.0;             // s the tone starts before its event (glides)
    const Eq* eq = nullptr;         // none; the tone copies what it needs
    bool oneShot = false, ring = false;
    int delay = 0;
    Engine::Layer layer = Engine::drums;
    uint64_t voice = 0;             // serial of the voice that starts it
    float panLeft = 1.0f, panRight = 1.0f; // kit pan: on the tone's left and right output
};

// One sounding sample. Points only into its pack, never into the voice that started it: it rings out after a voice change.
struct Tone {
    bool active = false;
    uint64_t serial = 0, voice = 0;
    Engine::Layer layer = Engine::drums;
    uint8_t gen = 0; // the generation of its layer's chains it was started under (Tones::gen): it rings out through those
    int delay = 0; // frames until it starts (position of the event inside the block)
    const float* data = nullptr;
    int channels = 1, frames = 0, loopStart = 0, loopEnd = 0;
    bool loop = false;
    double pos = 0.0, rate = 1.0, sr = 48000.0; // rate: frames of the sample per output frame at the note's pitch
    // envelope: attack (linear), hold, decay (exponential) to sustain, release (exponential) from the note end
    enum Stage { attack, hold, decay, sustain, release } stage = attack;
    double level = 0.0, peak = 0.0, sustainLevel = 0.0, attackInc = 0.0, decayMul = 1.0, releaseMul = 1.0;
    int holdLeft = 0, decayLeft = 0, releaseN = 1, releaseLeft = 0;
    long long toNoteEnd = 0;
    double tailGain = 1.0, tailMul = 1.0;   // extra decay of the tone (naturalDecay)
    double chokeGain = 1.0, chokeMul = 1.0; // choke: falls with a time constant once chokeIn has run out
    long long chokeIn = -1;
    // The computed articulation that moves pitch, bend shelf or fade, as a function of the time since the start (sampler.js 201 to 234).
    // artFrom, artLength (s): glide 0 and its length; bend hold and bend time; vibrato start and length; fall start and noteEnd - start.
    Art art = Art::none;
    long long age = 0;                       // frames since the start
    double r0 = 1.0, artFrom = 0.0, artLength = 0.0;
    double vibratoCents = 0.0, vibratoHz = 0.0, vibratoX = 0.0; // vibratoX: x where the web's curve ends, (N - 1) / 200
    double shelfDb = 0.0, shelfNow = 0.0;    // bend: the shelf's depth d and its gain now
    int filterCount = 0;
    Biquad filters[5][2];                    // per channel: highpass and EQ (when eq), lowpass (when filter < 20000)
    Biquad shelf[2];                         // bend: high shelf at 1800 Hz, after the lowpass
    int offBy = 0;
    double offTime = 0.0;
    float panLeft = 1.0f, panRight = 1.0f;

    void start(const Note& n, double sampleRate, uint64_t number);
    void choke(long long inFrames, double timeConstant, double sampleRate); // inFrames count from the tone's own start, not from the chunk's
    void render(float* left, float* right, int count);
};

struct Tones; // the pool of tones of all layers (patch.h: its synth tones need SynthTone, which needs Biquad above)

// sample-zones.js, pickZones over artZones(zones, art): the zones as good as the best (key distance, velocity distance, width),
// in list order. Release zones never count. `own` (optional) says whether zones of this art were found.
int pickZones(const Pack& pack, int key, double vel01, const char* art, const Pack::Zone** best, int capacity, bool* own = nullptr);

double velocityBrightnessHz(double vel, double softHz);

// The fine values a voice reads (tunables.js), NaN where the voice has none.
struct Tuned {
    double level, decay, velExp, softHz, oneShot, humanCents, humanDb, strum, strumUp, strumTilt, lowDb, midDb, midHz, highDb, highHz, layerSpread,
        choke, roomMic, velCurve, kitPan;
};

// What the web keeps inside a voice instance; starts over when the layer gets a new voice and when playing starts.
struct VoiceState {
    Rng rng { 1 };
    const Pack::Zone* lastZone[128] = {}; // round robin: the zone played last on each key
    uint64_t serial = 0;                  // of the voice it belongs to
    double lastSong = -INFINITY;          // strum: stream time of the last chord tone and its place in the run
    int strumRun = 0;
    const Pack::Zone* lastNoteZone[128][23] = {}; // round robin of format-2 notes by key and art: 0 = none, 1 + ART_NAMES index
    int openHat = -1;                     // format-1 kits: index in Tones::all of the last open hat's tone, and that tone's serial
    uint64_t openHatSerial = 0;           // (a reused tone is not choked)
    int chain = -1;                       // the organ: its chain's slot in Tones::chains (organ.js `let chain`), -1 none yet
};

// One layer's chosen voice: built on the control thread, immutable afterwards.
class Voice {
public:
    virtual ~Voice() = default;
    // Audio thread: start what event `e` plays, `delay` frames into the current chunk. No allocation, no lock.
    virtual void play(const PlayEvent& e, int delay, double secondsPerBeat, VoiceState& state, Tones& tones) const = 0;
    // Audio thread: whether the voice feeds its layer in two channels, so that Chromium runs the layer's chains in two (phase-5-design.md 4).
    virtual bool stereo() const { return pack && pack->channels == 2; }
    Rng startRng { 1 }; // what state.rng starts from: Rng(1).fork("voice-<layer>")
    Tuned tuned {};
    std::shared_ptr<const Pack> pack;
    Engine::Layer layer = Engine::drums;
};

// The voice for the sample voice `key` ("bass/sample/finger") with its pack, or with pack nullptr for the synth voice `key`
// ("chords/epiano/rhodes"); nullptr for a voice the core cannot play (the layer is silent). `timbre` is the sound model's (sound_model.h):
// the lowpass and time scale of the note voices, the width of the kit's pan, what the synth voices read of it. `sampleRate`: the rate the
// organ builds its wave tables for (0: none yet, the organ is silent; the engine builds its voices again when prepare sets the rate).
std::shared_ptr<const Voice> makeVoice(Engine::Layer layer, const std::string& key, std::shared_ptr<const Pack> pack, const Tuning& tuning, const Timbre& timbre,
                                       double sampleRate = 0.0);
std::shared_ptr<Voice> epianoVoice(const Tuning& tuning, const Timbre& timbre);                      // voices/epiano.cpp
std::shared_ptr<Voice> organVoice(const std::string& key, const Tuning& tuning, double sampleRate); // voices/organ.cpp
struct WaveTables;
// Tests only: what an organ voice plays key `midi` with: its wave (nullptr for another voice or none yet), the wheels' frequency and detune,
// and the coefficients the wave was built from (a full build of them is the wave every range of it must equal)
struct OrganKey { const WaveTables* wave = nullptr; float hz = 0.0f, cents = 0.0f; std::array<float, 17> real {}, imag {}; };
OrganKey organKey(const Voice& voice, int midi);

} // namespace btg::detail
