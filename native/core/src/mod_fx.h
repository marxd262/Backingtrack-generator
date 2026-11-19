#pragma once

// The modulation chain of a layer (src/audio/mod-fx.js, created by createModFx): vibrato, a delay moved by an LFO whose rate follows the
// tempo, and chorus, two moved copies panned left and right. Like guitar_fx.h it computes the way the web app's graph does in Chromium, one
// frame at a time in float, in the order of the graph (phase-4-design.md 2, 3 and 5). No allocation, no lock, no throw once prepared.

#include "guitar_fx.h"
#include "sound_model.h"

#include <vector>

namespace btg::detail {

// A DelayNode at audio rate (platform/audio/delay.cc, cpu/x86/delay_sse2.cc): the ring holds 128 + TimeToSampleFrame(max, rate, up) frames,
// a frame is written before it is read, the read position is computed in float.
class ModDelay {
public:
    void prepare(double maxDelaySeconds, double sampleRate); // allocates: not on the audio thread; then reset()
    void reset();                                            // zeros, write index 0
    int length() const { return static_cast<int>(ring_.size()); }
    float process(float x, float delaySeconds); // writes x, then reads delaySeconds back (clamped to [0, max])

private:
    std::vector<float> ring_;
    int write_ = 0;
    float rate_ = 48000.0f, max_ = 0.05f;
};

// One layer's chain: mono in, left and right out.
class ModFx {
public:
    void prepare(double sampleRate); // three rings of 0.05 s (allocates), ramp constants, the panners' gains; then reset()
    void reset();                    // not built, every state empty, LFO phases 0
    void set(const ModParams& p, bool atStart); // mod-fx.js set(): atStart = createInstruments' { immediate: true }
    bool built() const { return built_; }
    // x may be left or right. Not built: both outputs are x, bit for bit.
    // shortcut: mono, one signal in; the stereo voices of Phase 5 need the panner's stereo case (stereo_panner.cc) and a second ring per copy.
    void process(const float* x, float* left, float* right, int count);

private:
    // An OscillatorNode of type sine (oscillator_handler.cc): the phase counts wave-table entries (4096) in double and goes on by the float
    // increment frequency * (4096 / rate), the way Chromium accumulates it. The core computes sin() of that phase, not Chromium's table. Measured
    // against a bare OscillatorNode: it differs from this by 3e-7 below an increment of 0.3 entries per frame (the table's and its linear
    // interpolation's own size) and by 2e-6 to 6e-6 from 0.3 on (the vibrato's 4 to 5.5 Hz at 44.1 and 48 kHz), where oscillator_handler.cc
    // goes to ProcessKRateVector (its x86 body is not here; that it carries the read index in float is a hypothesis). Not rebuilt.
    struct Lfo {
        double index = 0.0;
        float next(float increment);
    };

    double rate_ = 48000.0;
    float rateScale_ = 0.0f, panGain_[2][2] = {}; // 4096 / rate; [copy][left, right]
    bool built_ = false;
    Ramp dry_, out_, straight_, vibWet_, vibDepth_, vibFrequency_, wet_;
    Lfo vibLfo_, lfo_[2];
    ModDelay vib_, copy_[2];
};

} // namespace btg::detail
