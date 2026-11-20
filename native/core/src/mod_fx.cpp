/*
 * The modulation chain follows Chromium, third_party/blink/renderer/ at 158.0.8127.18 (audio_utilities.cc: at main, as for compressor.cpp):
 *   platform/audio/delay.cc            (the ring of 128 frames more than the longest delay needs, a frame written before it is read)
 *   platform/audio/audio_utilities.cc  (TimeToSampleFrame, the ring's length)
 * Their notice (the same text in both):
 *
 * Copyright (C) 2010, Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1.  Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
 * DAMAGE.
 *
 * And these four files, each with the copyright line given here (its notice is Chromium's LICENSE text below, as the files refer to it):
 *   platform/audio/cpu/x86/delay_sse2.cc  (Copyright 2016 The Chromium Authors: the read position in float, the interpolation)
 *   platform/audio/stereo_panner.cc       (Copyright 2014 The Chromium Authors: the equal-power gains of a mono input, as float; Task 20b:
 *                                           those of a stereo input, which keep one side and add the other's share to it)
 *   modules/webaudio/oscillator_handler.cc (Copyright 2022 The Chromium Authors: the phase of the sine LFO, its increment in float and
 *                                           the double accumulation; the wave table and its interpolation are not taken)
 *   modules/webaudio/delay_handler.cc     (Copyright 2022 The Chromium Authors, Task 20b: a ring per channel, and at the turn of the input
 *                                           to two channels the rings up-mixed with the write index kept: the left one copied to the right)
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
 * The approach of the gains to their targets is Ramp of guitar_fx.cpp (audio_param_handler.cc, whose notice stands there).
 */
#include "mod_fx.h"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace btg::detail {
namespace {

constexpr double TC = 0.02;     // mod-fx.js: the ramps of the knobs
constexpr double MAX_DELAY = 0.05;
constexpr int QUANTUM = 128;    // render quantum: the ring's extra frames (delay.cc BufferLengthForDelay)
// The phase counts entries of a table of 4096 (a power of two: the float rounding of 4096 / rate, and so of the increment, is the same for
// 2048 to 16384: the model's error against the browser's oscillator did not change with the size, 48 kHz). rateScale_ = 4096 / rate in float
// (prepare) is Chromium's RateScale, size / rate in float (periodic_wave_handler.cc 87, read in Task 20a; the size is 4096 up to 88.2 kHz
// and 16384 above, 46 to 54: at 96 kHz the browser's phase is this one times 4, the same roundings).
constexpr int TABLE = 4096;

// audio_utilities.cc TimeToSampleFrame(time, rate, kRoundUp): the frame at 1024 times the rate, rounded, then up
int timeToSampleFrameUp(double time, double rate) { return static_cast<int>(std::ceil(std::round(time * rate * 1024) / 1024)); }

} // namespace

void ModDelay::prepare(double maxDelaySeconds, double sampleRate) {
    rate_ = static_cast<float>(sampleRate);
    max_ = static_cast<float>(maxDelaySeconds);
    ring_.assign(static_cast<size_t>(QUANTUM + timeToSampleFrameUp(maxDelaySeconds, sampleRate)), 0.0f);
    reset();
}

void ModDelay::reset() {
    std::fill(ring_.begin(), ring_.end(), 0.0f);
    write_ = 0;
}

// delay_sse2.cc ProcessARateVector, one frame: the ring holds this frame already (the web writes the whole quantum first, the core one frame
// at a time). The two agree while a read never reaches a frame after the one being computed, which needs a delay of at least one frame (the
// interpolation then reads the frame itself at most); the shortest delay here is 0.0031 s, 147 frames at 48 kHz, and it holds at every rate
// the app runs at (44.1 to 96 kHz; it would not below about 330 Hz). The position is write index + length - delay frames, all float.
float ModDelay::process(float x, float delaySeconds) {
    const int size = length();
    ring_[static_cast<size_t>(write_)] = x;
    const float delay = std::min(std::max(delaySeconds, 0.0f), max_), sizeF = static_cast<float>(size);
    float position = static_cast<float>(write_) + (sizeF - delay * rate_);
    if (position >= sizeF) position -= sizeF;
    int first = static_cast<int>(position);
    if (first >= size) first -= size;
    int second = first + 1;
    if (second >= size) second -= size;
    const float factor = position - static_cast<float>(first), s1 = ring_[static_cast<size_t>(first)], s2 = ring_[static_cast<size_t>(second)];
    if (++write_ >= size) write_ = 0;
    return s1 + factor * (s2 - s1);
}

void ModDelay::copyTo(ModDelay& other) const {
    std::copy(ring_.begin(), ring_.end(), other.ring_.begin());
    other.write_ = write_;
}

float ModFx::Lfo::next(float increment) {
    const float sample = static_cast<float>(std::sin(2 * std::numbers::pi * index / TABLE));
    index += increment;
    index -= std::floor(index * (1.0 / TABLE)) * TABLE;
    return sample;
}

void ModFx::prepare(double sampleRate) {
    rate_ = sampleRate;
    rateScale_ = static_cast<float>(TABLE) / static_cast<float>(sampleRate); // PeriodicWave::RateScale()
    for (ModDelay& d : vib_) d.prepare(MAX_DELAY, sampleRate);
    for (auto& copy : copy_) for (ModDelay& d : copy) d.prepare(MAX_DELAY, sampleRate);
    // stereo_panner.cc PanToTargetValue: the pan is a float, the angle double, the gains float (copy A at -0.7, copy B at 0.7); the angle of
    // a mono input from (pan + 1) / 2, of a stereo one from pan + 1 (a float sum) at a pan up to 0, else from the pan itself
    for (int i = 0; i < 2; ++i) {
        const float pan = static_cast<float>((i ? 1 : -1) * MOD.chorusPan);
        const double radian = (static_cast<double>(pan) * 0.5 + 0.5) * (std::numbers::pi / 2);
        panGain_[i][0] = static_cast<float>(std::cos(radian));
        panGain_[i][1] = static_cast<float>(std::sin(radian));
        const double stereo = static_cast<double>(pan <= 0 ? pan + 1 : pan) * (std::numbers::pi / 2);
        panStereo_[i][0] = static_cast<float>(std::cos(stereo));
        panStereo_[i][1] = static_cast<float>(std::sin(stereo));
    }
    reset();
}

void ModFx::reset() {
    built_ = stereo_ = false;
    for (Ramp* r : { &dry_, &out_, &straight_, &vibWet_, &vibDepth_, &vibFrequency_, &wet_ }) r->jump(0.0f);
    dry_.jump(1.0f);
    vibLfo_ = {};
    lfo_[0] = lfo_[1] = {};
    for (ModDelay& d : vib_) d.reset();
    for (auto& copy : copy_) for (ModDelay& d : copy) d.reset();
}

void ModFx::set(const ModParams& p, bool atStart) {
    if (!built_) {
        if (!p.active) return;
        // build(): the nodes' first values; the LFOs run from here on (o.start()), the vibrato's already at its own rate
        straight_.jump(1.0f);
        vibFrequency_.jump(static_cast<float>(p.vibrato.hz));
        built_ = true;
    }
    const auto to = [&](Ramp& r, double value) {
        const float v = static_cast<float>(value);
        if (atStart) r.jump(v);
        else r.to(v, 0.0, TC, rate_);
    };
    to(dry_, p.active ? 0 : 1);
    to(out_, p.active ? p.chorus.norm : 0);
    to(straight_, p.vibrato.on ? 0 : 1);
    to(vibWet_, p.vibrato.on ? 1 : 0);
    to(vibDepth_, p.vibrato.depth);
    to(vibFrequency_, p.vibrato.hz);
    to(wet_, p.chorus.wet);
}

void ModFx::process(const float* inL, const float* inR, float* outL, float* outR, int count, bool stereo) {
    if (!built_) {
        const float* const inRight = stereo ? inR : inL;
        if (outL != inL) std::copy(inL, inL + count, outL);
        if (outR != inRight) std::copy(inRight, inRight + count, outR);
        return;
    }
    if (stereo && !stereo_) {
        vib_[0].copyTo(vib_[1]);
        for (auto& copy : copy_) copy[0].copyTo(copy[1]);
        stereo_ = true;
    }
    // AudioParam values are floats; a delay time is the param's own value plus the LFO's output through a gain, in float
    const float vibBase = static_cast<float>(MOD.vibBase), chorusBase = static_cast<float>(MOD.chorusBase), chorusDepth = static_cast<float>(MOD.chorusDepth);
    const float chorusIncrement[2] = { static_cast<float>(MOD.chorusHz[0]) * rateScale_, static_cast<float>(MOD.chorusHz[1]) * rateScale_ };
    for (int i = 0; i < count; ++i) {
        // vibrato: straight through, or all of it through the moved delay (no mixing: that would be a comb)
        const float vibLfo = vibLfo_.next(vibFrequency_.next() * rateScale_);
        const float vibTime = vibBase + vibLfo * vibDepth_.next(), straight = straight_.next(), vibWet = vibWet_.next();
        const float copyTime[2] = { chorusBase + chorusDepth * lfo_[0].next(chorusIncrement[0]), chorusBase + chorusDepth * lfo_[1].next(chorusIncrement[1]) };
        const float wet = wet_.next(), out = out_.next(), dry = dry_.next();
        // chorus: two copies of `post`, each panned, summed, then the wet gain; `post` and the sum go through `out`, the dry path beside it
        if (!stereo) {
            const float in = inL[i];
            const float post = in * straight + vib_[0].process(in, vibTime) * vibWet;
            float sum[2] = { 0.0f, 0.0f };
            for (int c = 0; c < 2; ++c) {
                const float copy = copy_[c][0].process(post, copyTime[c]);
                const float l = copy * panGain_[c][0], r = copy * panGain_[c][1];
                sum[0] += l;
                sum[1] += r;
            }
            outL[i] = in * dry + (post + sum[0] * wet) * out;
            outR[i] = in * dry + (post + sum[1] * wet) * out;
            continue;
        }
        const float in[2] = { inL[i], inR[i] };
        float post[2], copy[2][2]; // [channel], [copy][channel]
        for (int ch = 0; ch < 2; ++ch) {
            post[ch] = in[ch] * straight + vib_[ch].process(in[ch], vibTime) * vibWet;
            for (int c = 0; c < 2; ++c) copy[c][ch] = copy_[c][ch].process(post[ch], copyTime[c]);
        }
        // copy A (pan up to 0) keeps its left and adds its right's share to it, copy B (pan above 0) the other way round
        const float sumL = (copy[0][0] + copy[0][1] * panStereo_[0][0]) + copy[1][0] * panStereo_[1][0];
        const float sumR = copy[0][1] * panStereo_[0][1] + (copy[1][1] + copy[1][0] * panStereo_[1][1]);
        outL[i] = in[0] * dry + (post[0] + sumL * wet) * out;
        outR[i] = in[1] * dry + (post[1] + sumR * wet) * out;
    }
}

} // namespace btg::detail
