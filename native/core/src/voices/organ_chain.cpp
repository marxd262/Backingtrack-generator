/*
 * The organ's chain follows src/audio/voices/organ.js (build, set, 99 to 112, 142 to 147) and organ-leslie.js line by line, and Chromium,
 * third_party/blink/renderer/ at 158.0.8127.18, where a node's behaviour decides a value:
 *   modules/webaudio/audio_param_handler.cc (Copyright 2022 The Chromium Authors): ProcessSetTarget (the value a setTarget starts from, its
 *                                            float recursion, HasSetTargetConverged at the event's first frame and at each render
 *                                            quantum's), HasSampleAccurateValues and HandleAllEventsInThePast (whether a quantum runs the
 *                                            timeline: ChainParam::sampleAccurate)
 *   modules/webaudio/oscillator_handler.cc  (Copyright 2022 The Chromium Authors): Process and CalculateSampleAccuratePhaseIncrements: the
 *                                            a-rate path in a quantum whose frequency is sample-accurate, else the k-rate path, and the
 *                                            increments from the quantum's first frame in the quantum an oscillator starts in
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
 * The discrete time constant 1 - exp(-1 / (rate * tc)) is DiscreteTimeConstantForSampleRate of platform/audio/audio_utilities.cc (read at
 * main, as for compressor.cpp). Its notice:
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
 * Reused, with their notices where they stand: the WaveShaperNode (Shaper, guitar_fx.cpp), the DelayNode at audio rate (ModDelay,
 * mod_fx.cpp), the BiquadFilterNode (Biquad::step and its coefficients, sampler.h; per frame where its frequency changes, as
 * biquad_filter_handler.cc, patch.cpp), the oscillator and its tables (osc.cpp). Read only, nothing taken: modules/webaudio/
 * delay_handler.cc (an input on delayTime makes it a-rate), gain_handler.cc, channel_merger_handler.cc (each input down-mixed to one channel
 * of the output), audio_node_input.cc and platform/audio/audio_bus.cc (a mono input into a two-channel node: L = R).
 * Not rebuilt: the x86 loop of ProcessSetTarget that computes four frames from the value at their start (the serial recursion rounds
 * differently in the last bit); the order in which `pre` sums its many connections (Chromium's is that of a hash set); the LFOs' a-rate
 * path in the quanta before a speed change that Chromium already knows of and the core does not yet (ChainParam::sampleAccurate), and the
 * part of a quantum begun on the k-rate path before an event of the next chunk switches it (Oscillator::sync): both rounding only.
 */
#include "organ_chain.h"

#include <algorithm>
#include <array>
#include <climits>

namespace btg::detail {
namespace {

const double BASE = 0.0005;                 // organ-leslie.js: the delay beyond the Doppler depth (s)
const float BUTTERWORTH_DB = -3.0103f;      // the crossover's Q (dB)
const double SETTLE = 3;                    // the inertia's fine values are the time to about 95 %: time constant = time / 3
const double CLICK_HP = 1000, DC_HP = 20;   // organ.js: the clicks' highpass, the preamp's (Hz)
const double RANGE = 4, BIAS = 0.2;         // organ.js: the curve tanh(RANGE x + BIAS) - tanh(BIAS) over the shaper's input -1..1
constexpr int TUBE_POINTS = 4097;
constexpr float THRESHOLD = 4.539992976248485e-05f; // kSetTargetThreshold

const float* tube() { // organ.js 35, computed once; prepare() touches it first, so it is never first on the audio thread
    static const auto curve = [] {
        std::array<float, TUBE_POINTS> c {};
        for (int i = 0; i < TUBE_POINTS; ++i) c[static_cast<size_t>(i)] = static_cast<float>(std::tanh(RANGE * (i / 2048.0 - 1) + BIAS) - std::tanh(BIAS));
        return c;
    }();
    return curve.data();
}

void empty(Biquad& f) { f.x1 = f.x2 = f.y1 = f.y2 = 0.0; }

} // namespace

void ChainParam::reset(float initial) {
    value = initial;
    applied = NAN;
    overflow = false;
    count_ = 0;
    listed_ = approaching_ = false;
}

void ChainParam::insert(const Event& e) {
    if (count_ == PENDING) { overflow = true; return; }
    int i = count_; // after every event of the same frame
    while (i > 0 && pending_[i - 1].frame > e.frame) { pending_[i] = pending_[i - 1]; --i; }
    pending_[i] = e;
    ++count_;
}

void ChainParam::setValueAtTime(float v, long long frame) { insert({ frame, v, 0.0f, false }); }

void ChainParam::setTargetAtTime(float v, long long frame, double tcSeconds, double sampleRate) {
    rate_ = sampleRate;
    insert({ frame, v, static_cast<float>(tcSeconds), tcSeconds != 0 }); // a time constant of 0 is a setValue
}

float ChainParam::next(long long frame, bool quantumStart) {
    bool first = false;
    while (count_ > 0 && pending_[0].frame <= frame) { // the events whose frame has come, in order
        now_ = pending_[0];
        std::copy(pending_ + 1, pending_ + count_, pending_);
        --count_;
        listed_ = true;
        approaching_ = first = now_.target;
        if (!now_.target) value = now_.v;
        else step_ = static_cast<float>(1 - std::exp(-1 / (rate_ * static_cast<double>(now_.tc))));
    }
    if (!approaching_) return value;
    if (!first) value += (now_.v - value) * step_; // at its own frame (a whole frame) the closed form gives the value it starts from
    if (first || quantumStart) { // HasSetTargetConverged: ten time constants past its start, or within the threshold (relative unless the target is 0)
        const bool converged = static_cast<double>(frame) / rate_ > static_cast<double>(now_.frame) / rate_ + static_cast<double>(10.0f * now_.tc)
            || (now_.v == 0 ? std::fabs(value) < THRESHOLD : std::fabs(now_.v - value) < THRESHOLD * std::fabs(value));
        if (converged) { value = now_.v; approaching_ = false; }
    }
    return value;
}

// Over the events scheduled so far: the core sees an event in the chunk it lies in, Chromium as soon as the page schedules it (voice-compare's
// page before the render, the app 0.1 s ahead), and IsEventCurrent keeps the old setValue listed until the next event's time. So from the
// moment a speed change is scheduled the browser's LFOs run a-rate (in voice-compare from the chain's first setValue on), the core's k-rate
// until the change's chunk: not rebuilt, rounding only (the float lanes against the double index, at the fast horn's increment of 0.57).
bool ChainParam::sampleAccurate(long long frame, bool remove) {
    const int listed = (listed_ ? 1 : 0) + count_;
    bool accurate = false;
    if (listed > 0) { // the first event set or setTarget after the quantum: not yet; two or more: yes; one: a setTarget from its quantum on, a set in it
        const Event& e = listed_ ? now_ : pending_[0];
        accurate = !(e.frame > frame + 128) && (listed >= 2 || e.target || !(e.frame < frame));
    }
    if (remove && listed_ && count_ == 0 && now_.frame + 192 < frame) { // every event 1.5 quanta in the past: given up, a setTarget once converged
        const bool converged = !now_.target || static_cast<double>(frame) / rate_ > static_cast<double>(now_.frame) / rate_ + static_cast<double>(10.0f * now_.tc)
            || (now_.v == 0 ? std::fabs(value) < THRESHOLD : std::fabs(now_.v - value) < THRESHOLD * std::fabs(value));
        if (converged) {
            if (now_.target) value = now_.v;
            listed_ = approaching_ = false;
        }
    }
    return accurate;
}

void OrganChain::prepare(double sampleRate) {
    rate_ = sampleRate;
    // the tail: the shaper's latency and 0.3 s; the delays hold at most 2.5 ms (BASE and twice the deepest Doppler), the 20 Hz highpass
    // (Q 1 dB) rings with a time constant of 18 ms, so after 0.3 s its state is below 1e-7 of where the last tone left it
    tail_ = Shaper::latency(2) + static_cast<int>(std::ceil(0.3 * sampleRate));
    for (auto& rotor : delay_) for (ModDelay& d : rotor) d.prepare(0.02, sampleRate); // createDelay(0.02)
    shaper_.prepare(tube(), TUBE_POINTS, 2);
    const Biquad c = highpassOf(CLICK_HP, 1, sampleRate), d = highpassOf(DC_HP, 1, sampleRate); // Q 1: the node's default
    clicks_ = c;
    dc_ = d;
    live = false;
}

bool OrganChain::prepared() const { return delay_[0][0].length() > 0; }

bool OrganChain::overflow() const {
    for (const ChainParam* p : { &level, &swell, &clean, &driveIn, &driveOut, &percEnv, &dry_, &wet_ })
        if (p->overflow) return true;
    for (int r = 0; r < 2; ++r)
        for (const ChainParam* p : { &crossover_[r], &am_[r], &doppler_[r], &delayTime_[r], &speed_[r] })
            if (p->overflow) return true;
    return false;
}

void OrganChain::start(Engine::Layer l, uint8_t g, uint64_t s, int delay, int quantum, const WaveTables* const lfo[2][2]) {
    live = true;
    orphan = heard = false;
    layer = l;
    gen = g;
    serial = s;
    age = 0;
    dead = delay; // organ.js 91: dead: t
    held = -INFINITY;
    pedal = rotorHz[0] = rotorHz[1] = NAN;
    quietFor_ = 0;
    // every param at its node's default: the gains 1, percEnv 0 (82), the crossover 350 Hz, delayTime 0, the LFOs' frequency 440 Hz
    for (ChainParam* p : { &level, &swell, &clean, &driveIn, &driveOut, &dry_, &wet_, &am_[0], &am_[1], &doppler_[0], &doppler_[1] }) p->reset(1.0f);
    percEnv.reset(0.0f);
    for (int r = 0; r < 2; ++r) {
        crossover_[r].reset(350.0f);
        delayTime_[r].reset(0.0f);
        speed_[r].reset(440.0f);
        bandHz_[r] = NAN;
        for (Biquad& b : band_[r]) empty(b);
        for (int m = 0; m < 2; ++m) {
            delay_[r][m].reset();
            lfo_[r][m] = Oscillator {};
            lfo_[r][m].wave = lfo[r][m];
        }
        aRate_[r] = false;
        std::fill(std::begin(early_[r]), std::end(early_[r]), 440.0f); // before the start the frequency is its default
    }
    empty(clicks_);
    empty(dc_);
    shaper_.reset();
    lfoStart_ = delay;
    lfoOffset_ = (quantum + delay) % 128;
}

void OrganChain::tune(const LeslieValues& v, long long frame) {
    const bool on = v.leslie > 0;
    dry_.set(on ? 0 : 1, frame);
    wet_.set(on ? 1 : 0, frame);
    for (int r = 0; r < 2; ++r) {
        const double depth = v.doppler[r] / 1000;
        crossover_[r].set(v.crossover, frame);
        am_[r].set(v.am[r], frame);
        doppler_[r].set(-depth, frame);
        delayTime_[r].set(BASE + depth, frame);
    }
}

void OrganChain::speed(bool fast, const LeslieValues& v, long long frame) {
    for (int r = 0; r < 2; ++r) {
        const double hz = fast ? v.fast[r] : v.slow[r];
        if (hz == rotorHz[r]) continue;
        if (std::isnan(rotorHz[r])) speed_[r].setValueAtTime(static_cast<float>(hz), frame); // the first time without inertia
        else speed_[r].setTargetAtTime(static_cast<float>(hz), frame, (hz > rotorHz[r] ? v.up[r] : v.down[r]) / SETTLE, rate_);
        rotorHz[r] = hz;
    }
}

void OrganChain::clear(int count) {
    for (auto& entry : in) std::fill(entry, entry + count, 0.0f);
    heard = false;
}

void OrganChain::process(float* left, float* right, int count, int quantum) {
    // The LFOs, rotor by rotor, in parts that end where a render quantum ends; in each quantum the path Chromium takes: a-rate while the
    // frequency is sample-accurate (and in the quantum an LFO starts in), else k-rate (the float lanes, Oscillator::constant)
    for (int r = 0; r < 2; ++r) {
        for (int i = 0; i < count;) {
            const int pos = (quantum + i) % 128, n = std::min(count - i, 128 - pos);
            const long long frame = age + i;
            if (pos == 0) aRate_[r] = speed_[r].sampleAccurate(frame, true);
            else if (i == 0 && !aRate_[r]) aRate_[r] = speed_[r].sampleAccurate(frame - pos, false); // an event this chunk brought into a quantum begun before
            float* hz = hz_[r] + i;
            for (int k = 0; k < n; ++k) hz[k] = speed_[r].next(frame + k, pos == 0 && k == 0);
            // the quantum the LFOs start in: they run on the frequency of the quantum's frames from its first on (oscillator_handler.cc
            // Process hands ProcessARate the increments of the whole quantum while the output begins at the start), before the start the default
            const long long first = lfoStart_ - lfoOffset_, inFirst = 128 - lfoOffset_;
            for (int k = 0; k < n; ++k) {
                const long long f = frame + k;
                if (f >= first && f - first < inFirst) early_[r][f - first] = hz[k];
                if (f >= lfoStart_ && f - lfoStart_ < inFirst) hz[k] = early_[r][f - lfoStart_];
            }
            const int from = static_cast<int>(std::clamp(lfoStart_ - frame, 0LL, static_cast<long long>(n))); // before the start: silent
            const bool startQuantum = frame + from - lfoStart_ < inFirst;
            for (int m = 0; m < 2; ++m) {
                float* out = wave_[r][m] + i;
                std::fill(out, out + from, 0.0f);
                if (from == n) continue;
                Oscillator& o = lfo_[r][m];
                const float cents = 0.0f;
                if (aRate_[r] || startQuantum) {
                    o.sync();
                    o.moving(hz + from, &cents, true, false, out + from, n - from);
                } else o.constant(hz[from], cents, out + from, n - from, LLONG_MAX / 4);
            }
            i += n;
        }
    }
    // The graph, frame by frame (organ.js 87 to 90, organ-leslie.js 21 to 41), in float as Chromium's nodes compute it
    for (int i = 0; i < count; ++i) {
        const long long f = age + i;
        const bool q = (quantum + i) % 128 == 0;
        const float lv = level.next(f, q), sw = swell.next(f, q), cl = clean.next(f, q), di = driveIn.next(f, q), dout = driveOut.next(f, q);
        const float pe = percEnv.next(f, q), dr = dry_.next(f, q), wt = wet_.next(f, q);
        // pre: the wheels, the clicks through their highpass, the percussion through its envelope; the swell; the clean path and the
        // preamp, both into the Leslie
        const float pre = in[wheels][i] + clicks_.step(in[clicks][i]) + in[percussion][i] * pe;
        const float s = pre * sw;
        const float x = s * cl + dc_.step(shaper_.process(s * di)) * dout;
        // per rotor the crossover (horn highpass, drum lowpass), per mic the delay the LFO moves (Doppler) and the gain it moves (1 + am LFO),
        // into the merger's channel of the mic
        float mix[2] = { 0.0f, 0.0f };
        for (int r = 0; r < 2; ++r) {
            const float hz = crossover_[r].next(f, q);
            if (hz != bandHz_[r]) { // new coefficients from this frame on, the states stay
                const Biquad c = r == 0 ? highpassOf(hz, BUTTERWORTH_DB, rate_) : lowpassOf(hz, BUTTERWORTH_DB, rate_);
                for (Biquad& b : band_[r]) { b.b0 = c.b0; b.b1 = c.b1; b.b2 = c.b2; b.a1 = c.a1; b.a2 = c.a2; }
                bandHz_[r] = hz;
            }
            const float band = band_[r][1].step(band_[r][0].step(x));
            const float am = am_[r].next(f, q), doppler = doppler_[r].next(f, q), time = delayTime_[r].next(f, q);
            for (int m = 0; m < 2; ++m) {
                const float lfo = wave_[r][m][i];
                mix[m] += delay_[r][m].process(band, time + lfo * doppler) * (1.0f + lfo * am);
            }
        }
        // the output: dry (one channel, in both) and wet; the level
        const float d = x * dr;
        left[i] += (d + mix[0] * wt) * lv;
        right[i] += (d + mix[1] * wt) * lv;
    }
    age += count;
    quietFor_ = heard ? 0 : std::min(quietFor_ + count, tail_);
}

} // namespace btg::detail
