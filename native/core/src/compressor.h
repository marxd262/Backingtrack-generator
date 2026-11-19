#pragma once

#include <array>

namespace btg::detail {

// Chromium's DynamicsCompressor (dynamics_compressor.cc at 158.0.8127.18), two channels, without the metering. The parameters hold until
// set() changes them (the browser reads them once per 128 frames). No allocation anywhere: the pre-delay rings are 2 x 1024 floats.
class Compressor {
public:
    void prepare(float sampleRate);  // pre-delay (unsigned)(0.006f * rate) frames, at most 1023; then reset()
    void reset();                    // a fresh node: detector 0, gain 1, max attack diff -1, rings zero, read 0, write = pre-delay, a new division
    void set(float threshold, float knee, float ratio, float attack, float release); // dB, dB, 1, s, s; the static curve is recomputed when they change
    void process(float* left, float* right, int count); // in place; any count: the 32-frame divisions run on across calls
    int preDelay() const { return static_cast<int>(preDelayFrames_); }

private:
    static constexpr int MAX_PRE_DELAY_FRAMES = 1024, MAX_PRE_DELAY_FRAMES_MASK = MAX_PRE_DELAY_FRAMES - 1, NUMBER_OF_DIVISION_FRAMES = 32;

    void update(); // what Process derives from the parameters at the top of every call
    float kneeCurve(float x, float k) const;
    float saturate(float x, float k) const;
    float kAtSlope(float desiredSlope) const;
    float updateStaticCurveParameters(float dbThreshold, float dbKnee, float ratio);

    // the node's parameters (defaults as DynamicsCompressor::InitializeParameters) and what they give
    float sampleRate_ = 48000.0f, threshold_ = -24.0f, knee_ = 30.0f, ratio_ = 12.0f, attack_ = 0.003f, release_ = 0.250f;
    float k_ = 0.0f, linearPostGain_ = 1.0f, attackFrames_ = 1.0f, satReleaseFrames_ = 1.0f, a_ = 0.0f, b_ = 0.0f, c_ = 0.0f, d_ = 0.0f, e_ = 0.0f;

    // state
    float detectorAverage_ = 0.0f, compressorGain_ = 1.0f, dbMaxAttackCompressionDiff_ = -1.0f;
    unsigned preDelayFrames_ = 256;
    std::array<float, MAX_PRE_DELAY_FRAMES> preDelayBuffers_[2] = {};
    int preDelayReadIndex_ = 0, preDelayWriteIndex_ = 256;
    int divisionLeft_ = 0;                                       // frames left in the division that runs; 0: the next frame begins one
    float scaledDesiredGain_ = 0.0f, envelopeRate_ = 0.0f;       // of that division

    // the static curve (names of the source)
    float curveRatio_ = -1, slope_ = -1, linearThreshold_ = -1, dbThreshold_ = -1, dbKnee_ = -1, kneeThreshold_ = -1, dbKneeThreshold_ = -1,
          dbYKneeThreshold_ = -1, curveK_ = -1;
};

} // namespace btg::detail
