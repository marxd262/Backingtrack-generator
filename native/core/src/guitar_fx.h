#pragma once

// The distortion chain of a layer (src/audio/guitar-fx.js, created by createGuitarFx) as the web app's graph computes it in Chromium: its
// gains are AudioParams (Ramp), its filters BiquadFilterNodes (Biquad::step), its four curves WaveShaperNodes with Chromium's oversampling
// (Shaper). Everything runs one frame at a time in float, in the order of the graph (phase-4-design.md 2 to 4). No allocation, no lock,
// no throw once prepared.

#include "btg/engine.h"
#include "sampler.h"
#include "sound_model.h"

namespace btg::detail {

// A gain's AudioParam under to() of guitar-fx.js (135 to 141): cancelScheduledValues(now), setValueAtTime(value, now),
// setTargetAtTime(x, now + delay, tc), setValueAtTime(x, now + delay + 10 tc). One value per frame, computed as Chromium computes them
// (AudioParamHandler::ProcessSetTarget, x86 path: per render quantum of 128 frames, in groups of four from c0 to c3, floats), where a
// call of to() stands at the beginning of a quantum (the web's scripts run between quanta). A Ramp that does not move costs one test.
struct Ramp {
    float value = 0.0f, target = 0.0f, step = 0.0f, last = 0.0f; // value: the approach's state; last: what next() returned last (param.value)
    int hold = 0, end = 0, age = 0, at = 0, size = 0; // frames: until the approach begins, until the value is exactly the target (none: end 0),
                                                      // since to(); the place in buf and the length of the quantum's part that is in it
    bool idle = true, settled = false; // settled: a ramp without an end value has converged (its last buffer is all the target): it then goes idle
    double rate = 1.0, delay = 0.0, tenTc = 0.0;
    float buf[128] = {};
    void jump(float x);                                                                     // param.value = x (and nothing scheduled)
    void to(float x, double delaySeconds, double tc, double sampleRate, bool endsWithValue = true); // from the value now; no end value: the bias
    float next() { return idle ? last : advance(); }

private:
    float advance();
    void part();
};

constexpr int CURVE_POINTS = 16385; // guitar-fx.js POINTS
enum class Curve { soft, hard, fuzz, muff };
const float* guitarCurve(Curve c); // guitar-fx.js 7 to 19, computed once; GuitarFx::prepare touches it first, so it is never first on the audio thread

// One FIR, y[n] = sum k[j]·x[n - j], one frame at a time, written as a scatter into a ring of accumulators (each sample adds k[j]·x to the
// output j frames ahead): the loops carry no dependence, so they vectorise under /fp:precise. K = 128 taps.
struct Fir {
    static constexpr int K = 128;
    const float* kernel = nullptr;
    float acc[K] = {};
    int at = 0;
    float push(float x);
    void reset();
};
// UpSampler (up_sampler.cc), block size 128: even output = the input 64 frames late, odd output = the kernel's interpolation.
struct Up {
    Fir fir;
    float delay[64] = {};
    int pos = 0;
    void prepare();
    void reset();
    void push(float x, float& even, float& odd);
};
// DownSampler (down_sampler.cc): half-band kernel of 256 taps (only the odd ones are kept, 128) plus the centre tap 0.5 on the even samples.
struct Down {
    Fir fir;
    float delay[64] = {}, odd = 0.0f; // the even samples of the 2x stream, 64 frames late; the odd one the last pair ended with
    int pos = 0;
    void prepare();
    void reset();
    float push(float first, float second);
};

// WaveShaperNode with oversample '2x' or '4x' (wave_shaper_handler.cc): up, the curve on every sample, down; 4x runs it twice.
class Shaper {
public:
    void prepare(const float* curve, int points, int factor); // then reset()
    void reset();
    float process(float x); // one frame in, one frame out, late by latency(factor)
    static int latency(int factor); // 128 or 192 frames
private:
    float lookup(float x) const;
    const float* curve_ = nullptr;
    int points_ = 0, factor_ = 2;
    float scale_ = 0.0f;
    Up up1_, up2_;
    Down down1_, down2_;
};

// One layer's chain, mono (the left channel), in place.
class GuitarFx {
public:
    // bass, chords, pad, lead; coefficients, ramp constants, the curves; then reset(). hardFourX and fuzzFourX are the web's oversampling of the
    // two 4x shapers; false makes one 2x: a test hook (native/tools/fx-compare.mjs pins the same shapers of the browser's chain to 2x, so
    // that everything but the 4x stages' second stage, which Chromium convolves by FFT, is compared at near bit level). The engine never passes them.
    void prepare(Engine::Layer layer, double sampleRate, bool hardFourX = true, bool fuzzFourX = true);
    void reset();                                         // not built, every state empty
    void set(const FxChainParams& p, bool atStart);       // guitar-fx.js set(): atStart = createInstruments' { immediate: true }
    bool built() const { return built_; }
    void process(float* x, int count); // untouched while not built

private:
    struct Stage { Ramp bypass, wet, drive, makeup; };
    // the chain's twelve filters in the order of the graph: coefficients from prepare, state from reset
    enum { odHp, odLp, distHp, distLp1, distLp2, fuzzHp, toneLp, toneHp, cabHp, cabPeak, cabLp1, cabLp2, filterCount };

    double rate_ = 48000.0;
    float ref_ = 1.0f, invRef_ = 1.0f;
    bool built_ = false;
    Ramp dry_, wetOut_, cabDry_, cabWet_, bias_;
    Stage od_, dist_, fuzz_;
    Shaper soft_, hard_, fuzzShaper_, muff_;
    Biquad filter_[filterCount];
};

} // namespace btg::detail
