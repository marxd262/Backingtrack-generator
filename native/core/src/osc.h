#pragma once

// Band-limited wave tables and the oscillator, as Chromium's OscillatorNode computes them (osc.cpp names the files). The tables are built
// on the control thread (they allocate); an Oscillator only reads them: no allocation, no lock, no throw.

#include <cstdint>
#include <memory>
#include <vector>

namespace btg::detail {

enum class Wave : uint8_t { sine, square, sawtooth, triangle };

// PeriodicWaveHandler: one table per pitch range (a third of an octave), each higher range with fewer partials.
struct WaveTables {
    int size = 0, ranges = 0;                           // 2048, 4096 or 16384 by the rate; round(3 log2 size)
    float rate = 0.0f, lowest = 0.0f, rateScale = 0.0f; // the rate as float; rate / size (every partial below it); size / rate
    std::vector<float> data;                            // `ranges` tables of `size` floats, range 0 first
    const float* table(int range) const { return data.data() + static_cast<size_t>(range) * static_cast<size_t>(size); }
    // WaveDataForFundamentalFrequency: the table with more partials (higher), the next range's (lower) and the crossfade from higher to lower
    void pair(float hz, const float*& lower, const float*& higher, float& factor) const;
};

struct BasicWaves {
    double rate = 0.0;
    WaveTables wave[4]; // by Wave
};
// Control thread: the four basic waves at `sampleRate`, built at the first call for that rate and kept.
const BasicWaves& basicWaves(double sampleRate);
// Control thread: createPeriodicWave(real, imag, { disableNormalization }) with `count` coefficients; real[0] and imag[0] are not used.
std::shared_ptr<const WaveTables> customWave(const float* real, const float* imag, int count, double sampleRate, bool disableNormalization);

// One OscillatorNode's processing: the read index goes on from call to call.
struct Oscillator {
    const WaveTables* wave = nullptr;
    double index = 0.0; // virtual_read_index (in constant(), from kInterpolate2Point on: at the start of the current block)
    // Frequency and detune constant over the frames (Chromium's k-rate path); `left`: the frames from the first of these to the stop.
    void constant(float hz, float cents, float* out, int count, long long left);
    // Per frame: hz[i] and cents[i] where that param has a timeline or an input (hzMoving, centsMoving), else hz[0] or cents[0] for every frame.
    void moving(const float* hz, const float* cents, bool hzMoving, bool centsMoving, float* out, int count);

private:
    float last_ = 0.0f, factor_ = 0.0f; // the increment the table pair below was chosen for
    const float* lower_ = nullptr;
    const float* higher_ = nullptr;
    int at_ = 0, block_ = 0;            // constant(): frames done of the current block of 128 and its length
    float lanes_[4] = {};               // ProcessKRateVector's four float read indices
    double rest_ = 0.0;                 // ProcessKRateScalar's index for a block's last frames after its groups of four
};

} // namespace btg::detail
