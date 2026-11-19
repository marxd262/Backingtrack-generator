#pragma once

// The convolution of the engine's reverb and room, and their impulse responses as the web app makes them (src/audio/nodes.js noiseBuffer,
// synth.js 66 and 223) and as Chromium's ConvolverNode normalises them.

#include "generator_internal.h"

#include <complex>
#include <string>
#include <vector>

namespace btg::detail {

// nodes.js noiseBuffer: `channels` channels of ceil(sampleRate * seconds) frames, channel after channel from `rng`:
// (rng.next() * 2 - 1) * exp((-decay * i) / sampleRate), rounded to float. Channel-major.
std::vector<std::vector<float>> noiseBuffer(Rng rng, double seconds, int channels, double decay, double sampleRate);
// Chromium reverb.cc, CalculateNormalizationScale: the factor a normalising ConvolverNode applies to its buffer (double arithmetic).
double normalizationScale(const std::vector<std::vector<float>>& response, double sampleRate);
// What synth.js gives its convolver, as the node holds it: noiseBuffer(Rng(1).fork(label), seconds, 2, decay) times its normalisation.
std::vector<std::vector<float>> normalizedNoise(const std::string& label, double seconds, double decay, double sampleRate);

// Two-channel convolution without latency (design section 5): left input with the left response, right with the right. Built on the
// control thread (allocates everything there); process() and reset() run on the audio thread and never allocate.
class Convolver {
public:
    static constexpr int BLOCK = 512;
    explicit Convolver(const std::vector<std::vector<float>>& response); // two channels of the same length
    void process(const float* inLeft, const float* inRight, float* outLeft, float* outRight, int count); // out = the convolution, any count
    void reset();          // silence
    int frames() const;     // taps per channel
    int partitions() const; // ceil((frames - BLOCK) / BLOCK), 0 when frames <= BLOCK

private:
    // Per channel: the head (taps 0..BLOCK-1) and the ring of BLOCK accumulators it scatters into; the input of the last two blocks;
    // the partitions' output for the current block; the spectra of the partitions (bins 0..BLOCK) and the ring of the last input spectra.
    struct Channel { std::vector<float> head, acc, input, tail, kernelRe, kernelIm, ringRe, ringIm; };
    void block(); // a block of input is complete: the partitions' output for the next one
    int frames_ = 0, partitions_ = 0, at_ = 0, newest_ = 0;
    Channel channels_[2];
    std::vector<std::complex<double>> work_;
    std::vector<float> sumRe_, sumIm_;
};

} // namespace btg::detail
