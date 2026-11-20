/*
 * The wave tables and the oscillator follow Chromium, third_party/blink/renderer/modules/webaudio/ at 158.0.8127.18:
 *   periodic_wave_handler.cc (Copyright 2026 The Chromium Authors): the table size by rate, the number of ranges, the partials each range
 *                             keeps, the basic waves' Fourier coefficients, the normalisation by the first table's peak (0.5 without it),
 *                             the table pair for a frequency and their crossfade
 *   oscillator_handler.cc    (Copyright 2022 The Chromium Authors): frequency and detune in float, the clamp to the Nyquist frequency, the
 *                             increments of the k-rate and the a-rate path, the linear, 3-point and 5-point interpolation, the read index
 *   oscillator_handler.h     (Copyright 2022 The Chromium Authors): the thresholds kInterpolate2Point and kInterpolate3Point
 *   cpu/x86/oscillator_kernel_sse2.cc (Copyright 2020 The Chromium Authors): ProcessKRateVector, the k-rate kernel's four float read
 *                             indices, their step and wrap, the table indices and interpolation factors made from them, the double index
 *                             brought up to date after them; in scalar C++, operation by operation in float, without the intrinsics
 * Each file's head: "Use of this source code is governed by a BSD-style license that can be found in the LICENSE file." That file's text:
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *    * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *    * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *    * Neither the name of Google LLC nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * Not taken from oscillator_kernel_sse2.cc: ProcessARateVectorKernel (its index is a double, as the core's). The inverse transform is the
 * core's fft.h in double, not Chromium's FFTFrame in float: a table differs from the browser's by float rounding.
 */
#include "osc.h"

#include "fft.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <list>
#include <mutex>
#include <numbers>

namespace btg::detail {
namespace {

constexpr float INTERPOLATE_2_POINT = 0.3f, INTERPOLATE_3_POINT = 0.16f; // oscillator_handler.h
constexpr float CENTS_PER_RANGE = 1200.0f / 3;                          // kCentsPerRange: three ranges per octave

int waveSize(float rate) { return rate <= 24000 ? 2048 : rate <= 88200 ? 4096 : 16384; } // GetPeriodicWaveSize

// CreateBandLimitedTables. The table is sum over the kept k of 2 (a_k cos + b_k sin)(2 pi k n / size) (Chromium's inverse transform of
// the bins size a_k, -size b_k), here the forward transform of a_k + i b_k and its mirror, then normalised.
WaveTables build(const float* real, const float* imag, int count, double sampleRate, bool disableNormalization) {
    WaveTables w;
    w.rate = static_cast<float>(sampleRate);
    w.size = waveSize(w.rate);
    w.ranges = static_cast<int>(std::lround(3 * std::log2(static_cast<float>(w.size))));
    w.lowest = w.rate / static_cast<float>(w.size);
    w.rateScale = static_cast<float>(w.size) / w.rate;
    const int size = w.size, half = size / 2, components = std::min(count, half);
    w.data.resize(static_cast<size_t>(w.ranges) * static_cast<size_t>(size));
    std::vector<std::complex<double>> bins(static_cast<size_t>(size));
    float normalization = 0.5f;
    for (int r = 0; r < w.ranges; ++r) {
        // range r keeps the partials up to 2^(-r/3) of half the size; bin 0 (the DC and the packed Nyquist) is cleared
        const float culling = static_cast<float>(std::pow(2.0, static_cast<double>(-(static_cast<float>(r) * CENTS_PER_RANGE) / 1200.0f)));
        const int keep = std::min(components, static_cast<int>(static_cast<unsigned>(culling * static_cast<float>(half))) + 1);
        std::fill(bins.begin(), bins.end(), std::complex<double>());
        for (int k = 1; k < keep; ++k) {
            bins[static_cast<size_t>(k)] = { real[k], imag[k] };
            bins[static_cast<size_t>(size - k)] = { real[k], -imag[k] };
        }
        fft(bins);
        float* t = w.data.data() + static_cast<size_t>(r) * static_cast<size_t>(size);
        for (int n = 0; n < size; ++n) t[n] = static_cast<float>(bins[static_cast<size_t>(n)].real());
        if (!disableNormalization && r == 0) { // the first range has the most power: its peak scales every range
            float peak = 0.0f;
            for (int n = 0; n < size; ++n) peak = std::max(peak, std::fabs(t[n]));
            if (peak != 0.0f) normalization = 1.0f / peak;
        }
        for (int n = 0; n < size; ++n) t[n] *= normalization;
    }
    return w;
}

// GenerateBasicWaveform: the sine coefficients b_n of the four shapes, in float
WaveTables basic(Wave shape, double sampleRate) {
    const int half = waveSize(static_cast<float>(sampleRate)) / 2;
    std::vector<float> real(static_cast<size_t>(half)), imag(static_cast<size_t>(half));
    for (int n = 1; n < half; ++n) {
        const float piFactor = 2 / (static_cast<float>(n) * std::numbers::pi_v<float>);
        float b = 0.0f;
        switch (shape) {
            case Wave::sine: b = n == 1 ? 1.0f : 0.0f; break;
            case Wave::square: b = (n & 1) ? 2 * piFactor : 0.0f; break;
            case Wave::sawtooth: b = piFactor * ((n & 1) ? 1.0f : -1.0f); break;
            case Wave::triangle: b = (n & 1) ? 2 * (piFactor * piFactor) * ((((n - 1) >> 1) & 1) ? -1.0f : 1.0f) : 0.0f; break;
        }
        imag[static_cast<size_t>(n)] = b;
    }
    return build(real.data(), imag.data(), half, sampleRate, false);
}

float clampToNyquist(float hz, float nyquist) { return std::isnan(hz) ? nyquist : std::clamp(hz, -nyquist, nyquist); } // ClampFrequency

// DoInterpolation: linear (in double) from kInterpolate2Point on, 3-point Lagrange from kInterpolate3Point, 5-point below; then the two tables
float interpolate(double index, float increment, unsigned mask, float tableFactor, const float* lower, const float* higher) {
    double low = 0.0, high = 0.0;
    const unsigned at = static_cast<unsigned>(index);
    if (increment >= INTERPOLATE_2_POINT) {
        const double f = static_cast<float>(index) - static_cast<float>(at);
        const unsigned i0 = at & mask, i1 = (at + 1) & mask;
        high = (1 - f) * higher[i0] + f * higher[i1];
        low = (1 - f) * lower[i0] + f * lower[i1];
    } else if (increment >= INTERPOLATE_3_POINT) {
        const double t = index - at, a[3] = { 0.5 * t * (t - 1), 1 - t * t, 0.5 * t * (t + 1) };
        for (int k = 0; k < 3; ++k) {
            const unsigned i = (at + static_cast<unsigned>(k) - 1) & mask;
            low += a[k] * lower[i];
            high += a[k] * higher[i];
        }
    } else {
        const double t = index - at, t2 = t * t;
        const double a[5] = { t * (t2 - 1) * (t - 2) / 24, -t * (t - 1) * (t2 - 4) / 6, (t2 - 1) * (t2 - 4) / 4, -t * (t + 1) * (t2 - 4) / 6,
                              t * (t2 - 1) * (t + 2) / 24 };
        for (int k = 0; k < 5; ++k) {
            const unsigned i = (at + static_cast<unsigned>(k) - 2) & mask;
            low += a[k] * lower[i];
            high += a[k] * higher[i];
        }
    }
    return static_cast<float>((1 - tableFactor) * high + tableFactor * low);
}

// ProcessKRateScalar and the a-rate vector kernel: linear in float within each table, then the crossfade
float linear(double index, unsigned mask, float tableFactor, const float* lower, const float* higher) {
    const unsigned at = static_cast<unsigned>(index), i0 = at & mask, i1 = (at + 1) & mask;
    const float f = static_cast<float>(index) - static_cast<float>(at);
    const float high = higher[i0] + f * (higher[i1] - higher[i0]), low = lower[i0] + f * (lower[i1] - lower[i0]);
    return high + tableFactor * (low - high);
}

} // namespace

void WaveTables::pair(float hz, const float*& lower, const float*& higher, float& factor) const {
    hz = std::fabs(hz); // a negative frequency plays the positive one's tables
    const float ratio = hz > 0 ? hz / lowest : 0.5f;
    const float pitch = std::clamp(1 + std::log2(ratio) * 1200.0f / CENTS_PER_RANGE, 0.0f, static_cast<float>(ranges - 1));
    const int r = static_cast<int>(pitch);
    higher = table(r);
    lower = table(r < ranges - 1 ? r + 1 : r);
    factor = pitch - static_cast<float>(r);
}

const BasicWaves& basicWaves(double sampleRate) {
    // shortcut: built once per rate and never freed (4 x 36 x 4096 floats = 2.4 MB at 44.1 and 48 kHz, 4 x 42 x 16384 = 11 MB at 96 kHz;
    // ruling 16); tones point into them. Free them through a keeper when memory matters.
    static std::mutex lock;
    static std::list<BasicWaves> built; // a list: what was built keeps its address
    const std::lock_guard<std::mutex> hold(lock);
    for (const BasicWaves& b : built)
        if (b.rate == sampleRate) return b;
    BasicWaves& made = built.emplace_back();
    made.rate = sampleRate;
    for (const Wave w : { Wave::sine, Wave::square, Wave::sawtooth, Wave::triangle }) made.wave[static_cast<int>(w)] = basic(w, sampleRate);
    return made;
}

std::shared_ptr<const WaveTables> customWave(const float* real, const float* imag, int count, double sampleRate, bool disableNormalization) {
    return std::make_shared<const WaveTables>(build(real, imag, count, sampleRate, disableNormalization));
}

// ProcessKRate. Below kInterpolate2Point: DoInterpolation frame by frame, the index in double. From it on Chromium renders each quantum by
// ProcessKRateVector (cpu/x86/oscillator_kernel_sse2.cc 84 to 198): four float read indices made from the double one (118 to 125), each
// group of four frames read from them (141 to 182), then 4 increments added to them and the four wrapped, in float (186 to 188); the frames
// after the last group of four by ProcessKRateScalar from the double index moved on by k * increment (193 to 195); at the quantum's end the
// double index moves on by n * increment (oscillator_handler.cc 518 to 522). Rebuilt here lane by lane in float, in that order: an FM
// carrier integrates the float index's error of its modulator, -69.2 dB with an index in double (Task 20a, round 1). The blocks are
// Chromium's render quanta on the core's grid (Tones::quantum: the quanta counted from a play's first frame; the web's play() falls on one
// of its context's, and a jump does not move them): an oscillator that starts `offset` frames into a quantum renders the 128 - offset
// frames left of it first (Process with a quantum frame offset hands ProcessKRate that many: their groups of four by the lanes, the n mod 4
// after them by ProcessKRateScalar), then whole quanta; test_synth.cpp holds it bit for bit. Not rebuilt: the a-rate vector kernel
// (moving()), whose index is a double already and whose rest is not integrated by anything (the kick's ramp -118.2 dB). An oscillator
// whose frequency or detune has a timeline or an input stays in moving() for its
// whole tone, where Chromium goes back to the k-rate kernel once its events lie 1.5 quanta in the past (audio_param_handler.cc
// HasSampleAccurateValues, HandleAllEventsInThePast): after its ramp the kick's sine keeps the -118.2 dB; a low square or sawtooth after
// a pitch drop would sit near the double index's figures (-93.1 dB, the square at 55 Hz).
void Oscillator::constant(float hz, float cents, float* out, int count, long long left) {
    const WaveTables& w = *wave;
    const float frequency = clampToNyquist(hz * std::exp2(cents / 1200), w.rate / 2); // DetuneToFrequencyMultiplier
    const float* lower;
    const float* higher;
    float factor;
    w.pair(frequency, lower, higher, factor);
    const float increment = frequency * w.rateScale;
    const unsigned mask = static_cast<unsigned>(w.size - 1);
    const double size = w.size, inverse = 1.0 / w.size;
    if (!(increment >= INTERPOLATE_2_POINT)) {
        for (int i = 0; i < count; ++i) {
            out[i] = interpolate(index, std::fabs(increment), mask, factor, lower, higher);
            index += increment;
            index -= std::floor(index * inverse) * size;
        }
        return;
    }
    const float sizeF = static_cast<float>(w.size), inverseF = 1.0f / sizeF, step = 4 * increment;
    const auto wrap = [&](float x) { // WrapVirtualIndexVector, one lane: x - floor(x / size) * size, the floor from a truncation
        const float r = x * inverseF;
        int f = static_cast<int>(r);
        if (r < static_cast<float>(f)) --f;
        return x - static_cast<float>(f) * sizeF;
    };
    for (int i = 0; i < count; ++i) {
        if (at_ == block_) { // a block begins: its length (the rest of the quantum the first time, less at the stop), the lanes from the double index
            block_ = static_cast<int>(std::min<long long>(128 - offset, left - i));
            offset = 0;
            at_ = 0;
            for (int m = 0; m < 4; ++m) lanes_[m] = wrap(static_cast<float>(index + static_cast<double>(static_cast<float>(m) * increment)));
        }
        const int groups = block_ / 4 * 4;
        if (at_ < groups) {
            const int m = at_ & 3;
            const unsigned i0 = static_cast<unsigned>(static_cast<int>(lanes_[m])) & mask, i1 = (i0 + 1) & mask;
            const float f = lanes_[m] - static_cast<float>(static_cast<int>(i0));
            const float high = higher[i0] + f * (higher[i1] - higher[i0]), low = lower[i0] + f * (lower[i1] - lower[i0]);
            out[i] = high + factor * (low - high);
            if (m == 3) for (float& lane : lanes_) lane = wrap(lane + step);
        } else {
            if (at_ == groups) {
                rest_ = index + static_cast<double>(static_cast<float>(groups) * increment);
                rest_ -= std::floor(rest_ * inverse) * size;
            }
            out[i] = linear(rest_, mask, factor, lower, higher);
            rest_ += increment;
            rest_ -= std::floor(rest_ * inverse) * size;
        }
        if (++at_ == block_) {
            index += static_cast<double>(static_cast<float>(block_) * increment);
            index -= std::floor(index * inverse) * size;
        }
    }
}

void Oscillator::moving(const float* hz, const float* cents, bool hzMoving, bool centsMoving, float* out, int count) {
    const WaveTables& w = *wave;
    const float nyquist = w.rate / 2, inverseRateScale = 1 / w.rateScale, k = static_cast<float>(1.0 / 1200);
    // CalculateSampleAccuratePhaseIncrements: what does not move goes into the scale first, then the clamp, then the scale
    float scale = w.rateScale;
    if (!hzMoving) scale *= hz[0];
    if (!centsMoving) scale *= std::exp2(cents[0] / 1200);
    const unsigned mask = static_cast<unsigned>(w.size - 1);
    const double size = w.size, inverse = 1.0 / w.size;
    double at = index;
    for (int i = 0; i < count; ++i) {
        const float v = hzMoving && centsMoving ? std::exp2(cents[i] * k) * hz[i] : hzMoving ? hz[i] : std::exp2(cents[i] * k);
        const float increment = clampToNyquist(v, nyquist) * scale;
        if (!lower_ || increment != last_) { // ProcessARate: the table pair of each frame's frequency, as the increment gives it back
            w.pair(inverseRateScale * increment, lower_, higher_, factor_);
            last_ = increment;
        }
        out[i] = std::fabs(increment) >= INTERPOLATE_2_POINT ? linear(at, mask, factor_, lower_, higher_)
                                                             : interpolate(at, std::fabs(increment), mask, factor_, lower_, higher_);
        at += increment;
        at -= std::floor(at * inverse) * size;
    }
    index = at;
}

} // namespace btg::detail
