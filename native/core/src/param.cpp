/*
 * The timeline follows Chromium, third_party/blink/renderer/modules/webaudio/audio_param_handler.cc at 158.0.8127.18 (Copyright 2022 The
 * Chromium Authors): the order of events of equal time, the setValue that a first ramp gets, the frame an event begins at (the ceiling of its
 * time: ValuesForFrameRangeImpl, HandleFirstEvent), the formulas of ProcessLinearRamp (its serial loop), ProcessExponentialRamp (pow from
 * value1 to value2, then a double accumulator), ProcessSetTarget (the closed form at its first frame, then the float recursion;
 * HasSetTargetConverged) and ProcessSetTargetFollowedByRamp (a ramp after a setTarget starts from where the approach is). Not taken: the x86
 * loops that start the values over every four frames and every render quantum (param.h); the clamp to the param's nominal range
 * (ValuesForFrameRange's Vclip) and the replacement of a NaN by its default (CalculateFinalValues): for the params a SynthTone exposes the
 * oscillator clamps its frequency itself (ClampFrequency) and the biquad helpers limit the normalised frequency as biquad.cc does
 * (sampler.h), which gives the same values; only a NaN from an input differs. The file's head: "Use of this source code is
 * governed by a BSD-style license that can be found in the LICENSE file." That file's text:
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
 */
#include "param.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace btg::detail {

void Param::insert(uint8_t kind, float v, double frame, double tc) {
    // InsertEvent: a ramp without an event before it starts from the value at the time of the call, here frame 0 (not shifted by late)
    if (count == 0 && (kind == linear || kind == exponential)) insert(set, value, 0.0, 0.0);
    if (count == EVENTS) { overflow = true; return; }
    int i = count; // after every event of the same time (upper_bound)
    while (i > 0 && events[i - 1].frame > frame) { events[i] = events[i - 1]; --i; }
    events[i] = { kind, frame, v, tc };
    ++count;
}

void Param::setValueAtTime(float v, double frame) { insert(set, v, frame + late, 0.0); }
void Param::linearRampToValueAtTime(float v, double frame) { insert(linear, v, frame + late, 0.0); }
void Param::exponentialRampToValueAtTime(float v, double frame) { insert(exponential, v, frame + late, 0.0); }
void Param::setTargetAtTime(float v, double frame, double tc) { insert(tc == 0 ? set : target, v, frame + late, tc); } // tc 0: a setValue

// The part of the timeline from event i on begins at `frame`: what it computes depends on its own kind and on the next event's.
void Param::enter(int i, long long frame) {
    at_ = i;
    const Event& e = events[i];
    const Event* next = i + 1 < count ? &events[i + 1] : nullptr;
    const bool rampNext = next && (next->kind == linear || next->kind == exponential);
    float v1 = e.value;
    double t1 = e.frame;
    const double n = static_cast<double>(frame);
    if (e.kind == target && rampNext) { // the setTarget becomes a setValue of its value at this frame (it began within the last frame)
        v1 = last_ = static_cast<float>(e.value + (last_ - e.value) * std::exp(-(n - t1) / e.tc));
        t1 = n;
    }
    if (next && next->kind == linear) {
        mode_ = ramp;
        from_ = v1;
        to_ = next->value;
        start_ = t1;
        const double span = next->frame - t1;
        k_ = span <= std::numeric_limits<float>::min() ? 0.0f : static_cast<float>(1 / span);
    } else if (next && next->kind == exponential) {
        const float v2 = next->value;
        if (v1 * v2 <= 0 || t1 >= next->frame) { // an error in the web: the value holds
            mode_ = hold;
            last_ = v1;
        } else {
            mode_ = exponent;
            const double span = next->frame - t1;
            mul_ = std::pow(v2 / v1, 1.0 / span);
            last_ = static_cast<float>(v1 * std::pow(v2 / static_cast<double>(v1), (n - t1) / span));
            acc_ = last_;
        }
    } else if (e.kind == target) {
        mode_ = approach;
        converged_ = false;
        to_ = e.value;
        start_ = t1;
        tc_ = e.tc;
        step_ = static_cast<float>(1 - std::exp(-1 / e.tc));
        // the closed form at the first frame: target + (value - target) * exp(-(that frame - the event's time) / tc)
        last_ = static_cast<float>(to_ + (last_ - to_) * std::exp(-(n - t1) / tc_));
    } else { // after a setValue, or after a ramp's end: its value
        mode_ = hold;
        last_ = e.value;
    }
}

void Param::values(int n, const float* added, float* out) {
    if (frame_ == 0) last_ = value;
    for (int i = 0; i < n; ++i, ++frame_) {
        while (at_ + 1 < count && std::ceil(events[at_ + 1].frame) <= static_cast<double>(frame_)) enter(at_ + 1, frame_);
        float v = value;
        if (at_ >= 0) switch (mode_) {
            case hold: v = last_; break;
            case ramp: { // value1 + x (value2 - value1), x from the frame's distance to the ramp's start, in float
                const float x = static_cast<float>((static_cast<double>(frame_) - start_) * k_);
                v = last_ = from_ + x * (to_ - from_);
                break;
            }
            case exponent: v = last_ = static_cast<float>(acc_); acc_ *= mul_; break;
            case approach: {
                if (!converged_) {
                    const bool first = static_cast<double>(frame_) <= std::ceil(start_);
                    if (!first) last_ += (to_ - last_) * step_; // the first frame has its closed form
                    // HasSetTargetConverged: ten time constants past the start, or within kSetTargetThreshold (relative unless the target is 0)
                    constexpr float THRESHOLD = 4.539992976248485e-05f;
                    if (quantum < 0 || first || (quantum + frame_) % 128 == 0) {
                        converged_ = static_cast<double>(frame_) > start_ + 10 * tc_
                            || (to_ == 0 ? std::fabs(last_) < THRESHOLD : std::fabs(to_ - last_) < THRESHOLD * std::fabs(last_));
                        if (converged_) last_ = to_;
                    }
                }
                v = last_;
                break;
            }
        }
        out[i] = added ? v + added[i] : v;
    }
}

} // namespace btg::detail
