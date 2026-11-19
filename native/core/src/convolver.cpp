// The convolver of the engine (design: .superpowers/sdd/2026-11-18-generator-port/phase-3-design.md, section 5). normalizationScale
// follows CalculateNormalizationScale of Chromium, third_party/blink/renderer/platform/audio/reverb.cc at 158.0.8127.18, under this notice:
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
#include "convolver.h"

#include "fft.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace btg::detail {
namespace {
constexpr int B = Convolver::BLOCK, N = 2 * B, BINS = B + 1; // block, FFT size, bins 0..B of a real signal
}

std::vector<std::vector<float>> noiseBuffer(Rng rng, double seconds, int channels, double decay, double sampleRate) {
    const size_t length = static_cast<size_t>(std::ceil(sampleRate * seconds));
    std::vector<std::vector<float>> out(static_cast<size_t>(channels), std::vector<float>(length));
    for (std::vector<float>& d : out)
        for (size_t i = 0; i < length; ++i) d[i] = static_cast<float>((rng.next() * 2 - 1) * std::exp((-decay * static_cast<double>(i)) / sampleRate));
    return out;
}

// The browser's level, also its fall with the sample rate (the power of the result goes with 1 / rate: 3 dB less at 96 than at 48 kHz).
// The web app is the reference: nothing compensates it (phase-3-rulings.md, ruling 3).
double normalizationScale(const std::vector<std::vector<float>>& response, double sampleRate) {
    const double kGainCalibration = -58, kGainCalibrationSampleRate = 44100, kMinPower = 0.000125;
    const size_t length = response.empty() ? 0 : response[0].size();
    double power = 0.0;
    for (const std::vector<float>& channel : response)
        for (const float x : channel) power += static_cast<double>(x) * x;
    power = std::sqrt(power / static_cast<double>(response.size() * length));
    if (!std::isfinite(power) || power < kMinPower) power = kMinPower;
    double scale = 1 / power;
    scale *= std::pow(10.0, kGainCalibration * 0.05);
    if (sampleRate != 0) scale *= kGainCalibrationSampleRate / sampleRate;
    if (response.size() == 4) scale *= 0.5;
    return scale;
}

std::vector<std::vector<float>> normalizedNoise(const std::string& label, double seconds, double decay, double sampleRate) {
    std::vector<std::vector<float>> response = noiseBuffer(Rng(1).fork(label), seconds, 2, decay, sampleRate);
    const double scale = normalizationScale(response, sampleRate);
    for (std::vector<float>& channel : response)
        for (float& x : channel) x = static_cast<float>(x * scale);
    return response;
}

// Uniformly partitioned overlap-save with a direct head: taps 0..B-1 in the time domain, partition p holds taps (p+1)·B .. (p+2)·B-1, so its
// block of delay is its offset and nothing is late.
Convolver::Convolver(const std::vector<std::vector<float>>& response)
    : frames_(response.size() == 2 ? static_cast<int>(response[0].size()) : 0), partitions_(frames_ > B ? (frames_ - B + B - 1) / B : 0), work_(N), sumRe_(BINS),
      sumIm_(BINS) {
    if (response.size() != 2 || response[1].size() != response[0].size()) throw std::invalid_argument("Convolver: two channels of the same length");
    const size_t spectra = static_cast<size_t>(partitions_) * BINS;
    for (int c = 0; c < 2; ++c) {
        const std::vector<float>& h = response[c];
        Channel& ch = channels_[c];
        ch.head.assign(h.begin(), h.begin() + std::min(frames_, B));
        ch.acc.assign(B, 0.0f);
        ch.input.assign(N, 0.0f);
        ch.tail.assign(B, 0.0f);
        ch.kernelRe.resize(spectra);
        ch.kernelIm.resize(spectra);
        ch.ringRe.assign(spectra, 0.0f);
        ch.ringIm.assign(spectra, 0.0f);
        for (int p = 0; p < partitions_; ++p) {
            std::fill(work_.begin(), work_.end(), 0.0);
            for (int k = 0; k < B && (p + 1) * B + k < frames_; ++k) work_[k] = h[static_cast<size_t>((p + 1) * B + k)];
            fft(work_);
            for (int k = 0; k < BINS; ++k) {
                ch.kernelRe[static_cast<size_t>(p) * BINS + k] = static_cast<float>(work_[k].real());
                ch.kernelIm[static_cast<size_t>(p) * BINS + k] = static_cast<float>(work_[k].imag());
            }
        }
    }
}

void Convolver::process(const float* inLeft, const float* inRight, float* outLeft, float* outRight, int count) {
    const float* in[2] = { inLeft, inRight };
    float* out[2] = { outLeft, outRight };
    const int taps = static_cast<int>(channels_[0].head.size());
    for (int i = 0; i < count; ++i) {
        const int at = at_, first = std::min(taps, B - at);
        for (int c = 0; c < 2; ++c) {
            Channel& ch = channels_[c];
            const float x = in[c][i];
            float* acc = ch.acc.data();
            const float* h = ch.head.data();
            // the head as a scatter, acc[(at + k) mod B] += h[k] * x, in two runs around the wrap
            for (int k = 0; k < first; ++k) acc[at + k] += h[k] * x;
            for (int k = first; k < taps; ++k) acc[at + k - B] += h[k] * x;
            out[c][i] = acc[at] + ch.tail[at];
            acc[at] = 0.0f;
            ch.input[B + at] = x;
        }
        if (++at_ == B) {
            at_ = 0;
            if (partitions_ > 0) block();
        }
    }
}

void Convolver::block() {
    newest_ = newest_ + 1 == partitions_ ? 0 : newest_ + 1;
    for (Channel& ch : channels_) {
        std::copy(ch.input.begin(), ch.input.end(), work_.begin()); // the last two blocks
        fft(work_);
        float* xr = ch.ringRe.data() + static_cast<size_t>(newest_) * BINS;
        float* xi = ch.ringIm.data() + static_cast<size_t>(newest_) * BINS;
        for (int k = 0; k < BINS; ++k) {
            xr[k] = static_cast<float>(work_[k].real());
            xi[k] = static_cast<float>(work_[k].imag());
        }
        // Y = sum over p of H_p · X_{newest - p}, in real arithmetic (no std::complex operator: GCC and Clang guard it with a NaN check)
        std::fill(sumRe_.begin(), sumRe_.end(), 0.0f);
        std::fill(sumIm_.begin(), sumIm_.end(), 0.0f);
        float* yr = sumRe_.data();
        float* yi = sumIm_.data();
        for (int p = 0, slot = newest_; p < partitions_; ++p, slot = slot == 0 ? partitions_ - 1 : slot - 1) {
            const float* hr = ch.kernelRe.data() + static_cast<size_t>(p) * BINS;
            const float* hi = ch.kernelIm.data() + static_cast<size_t>(p) * BINS;
            const float* ar = ch.ringRe.data() + static_cast<size_t>(slot) * BINS;
            const float* ai = ch.ringIm.data() + static_cast<size_t>(slot) * BINS;
            for (int k = 0; k < BINS; ++k) {
                yr[k] += hr[k] * ar[k] - hi[k] * ai[k];
                yi[k] += hr[k] * ai[k] + hi[k] * ar[k];
            }
        }
        // inverse by conjugation: conj(Y) over the full spectrum (Y[N - k] = conj Y[k]), fft, and the real part over N
        for (int k = 0; k < BINS; ++k) work_[k] = { yr[k], -yi[k] };
        for (int k = 1; k < B; ++k) work_[N - k] = { yr[k], yi[k] };
        fft(work_);
        for (int k = 0; k < B; ++k) ch.tail[k] = static_cast<float>(work_[B + k].real() / N); // the valid half: the next block's output
        std::copy(ch.input.begin() + B, ch.input.end(), ch.input.begin());
    }
}

void Convolver::reset() {
    for (Channel& ch : channels_)
        for (std::vector<float>* v : { &ch.acc, &ch.input, &ch.tail, &ch.ringRe, &ch.ringIm }) std::fill(v->begin(), v->end(), 0.0f);
    at_ = 0;
    newest_ = 0;
}

int Convolver::frames() const { return frames_; }
int Convolver::partitions() const { return partitions_; }

} // namespace btg::detail
