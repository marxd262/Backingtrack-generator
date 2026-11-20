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
    void copyTo(ModDelay& other) const;         // the ring and its write index into a ring of the same length (no allocation)

private:
    std::vector<float> ring_;
    int write_ = 0;
    float rate_ = 48000.0f, max_ = 0.05f;
};

// One layer's chain: one channel or two in, left and right out. With two, every node runs in two channels as Chromium runs it once its input
// has two: a ring per channel for the vibrato's delay and for each copy (one delay kernel per channel), the delay times, gains and LFOs once.
class ModFx {
public:
    void prepare(double sampleRate); // six rings of 0.05 s (allocates), ramp constants, the panners' gains; then reset()
    void reset();                    // not built, mono, every state empty, LFO phases 0
    void set(const ModParams& p, bool atStart); // mod-fx.js set(): atStart = createInstruments' { immediate: true }
    bool built() const { return built_; }
    // An output may be its channel's input. stereo false: inL alone is read (inR may be null); true: both. Not built: the outputs are the
    // input, bit for bit (mono: inL on both). The first stereo call turns the chain to two channels for good (until reset): each left ring is
    // copied into the right one, as Chromium's DelayNode up-mixes its rings into the new channel layout (delay_handler.cc 145 to 196), and the
    // panners take the formula of a stereo input (stereo_panner.cc 126 to 152), under which an up-mixed mono copy at -0.7 comes out at
    // 1.891 x on the left instead of 0.972 x (+5.8 dB).
    void process(const float* inL, const float* inR, float* outL, float* outR, int count, bool stereo);

private:
    // An OscillatorNode of type sine (oscillator_handler.cc): the phase counts wave-table entries (4096) in double and goes on by the float
    // increment frequency * (4096 / rate), the way Chromium accumulates it. The core computes sin() of that phase, not Chromium's table. Measured
    // against a bare OscillatorNode: it differs from this by 3e-7 below an increment of 0.3 entries per frame (the table's and its linear
    // interpolation's own size) and by up to 6e-6 from 0.3 on (measured: 3.9e-6 at 3.52 Hz and 2.2e-6 at 3.6 Hz, 48 kHz; the worst over the
    // vibrato's 4 to 5.5 Hz 5.98e-6 at 44.1 kHz and 5.96e-6 at 48 kHz; less at some frequencies, 7e-7 at 4 Hz and 44.1 kHz, 5e-7 at 10 Hz and
    // 48 kHz), where oscillator_handler.cc goes to ProcessKRateVector (504 to 509). Its x86 body, cpu/x86/oscillator_kernel_sse2.cc, carries the
    // read index in float within a render quantum: the indices of the first four frames as floats (118 to 125), then 4 * increment added and
    // wrapped in float (186 to 188); only at the quantum's end is the double index recomputed (193 to 195). Not rebuilt here (phase 5 ruling
    // 7); since Task 20a Oscillator::constant (osc.cpp) has that kernel, and the LFO's up to 6e-6 could be removed with it.
    struct Lfo {
        double index = 0.0;
        float next(float increment);
    };

    double rate_ = 48000.0;
    float rateScale_ = 0.0f, panGain_[2][2] = {}, panStereo_[2][2] = {}; // 4096 / rate; [copy][left, right] of a mono and of a stereo input
    bool built_ = false, stereo_ = false;
    Ramp dry_, out_, straight_, vibWet_, vibDepth_, vibFrequency_, wet_;
    Lfo vibLfo_, lfo_[2];
    ModDelay vib_[2], copy_[2][2]; // [channel], [copy][channel]
};

} // namespace btg::detail
