/*
 * The oversampling of the wave shapers follows Chromium, third_party/blink/renderer/platform/audio/ at 158.0.8127.18:
 *   up_sampler.cc   (the 128-tap kernel, the even samples 64 frames late, the odd ones by convolution)
 *   down_sampler.cc (the half-band kernel of 256 taps with its odd terms, the 0.5 centre term, the odd samples one frame late)
 * Their notice (the same text in both):
 *
 * Copyright (C) 2013 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
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
 * The curve lookup, the 2x/4x cascade and its latency follow third_party/blink/renderer/modules/webaudio/wave_shaper_handler.cc, and the
 * approach of a gain to its target (one step per frame, in float) audio_param_handler.cc in the same directory, both at 158.0.8127.18.
 * Their notice (Chromium's LICENSE, with the copyright line of both files):
 *
 * Copyright 2022 The Chromium Authors
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
 * The filters' coefficients (SetLowpassParams, SetHighpassParams, SetPeakingParams) follow platform/audio/biquad.cc; its filter step is
 * Biquad::step of sampler.h, which carries the same notice at the function. Its notice:
 *
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
 *
 * The discrete time constant of an approach, 1 - exp(-1 / (rate * tc)), is DiscreteTimeConstantForSampleRate of platform/audio/audio_utilities.cc
 * (read at main, as for compressor.cpp). Its notice:
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
 * Read only, nothing taken: direct_convolver.cc (Copyright (C) 2012 Intel Inc.) and simple_fft_convolver.cc, whose convolutions the
 * streaming FIRs below equal up to rounding.
 */
#include "guitar_fx.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>

namespace btg::detail {
namespace {

// guitar-fx.js: the creation fade (a start) and the lazy one (a first knob while playing), the bias, the ramps of the knobs
struct Fade { double delay, tc; };
constexpr Fade CREATE { 0.08, 0.008 }, LAZY { 0.15, 0.02 };
constexpr double BIAS_TC = 0.04, TC = 0.02, FUZZ_DRIVE_TC = 0.1;
constexpr float FUZZ_BIAS = 0.06f;
constexpr double Q_DB = 0.7; // filter(): Q 0.7 (dB for lowpass and highpass), the peaking's Q is 1.2 (linear)

// The filters' coefficients as biquad.cc computes them (SetLowpassParams, SetHighpassParams, SetPeakingParams for 0 < cutoff < 1): the same
// formulas as sampler.h's, but its pow10 is fdlibm::expf, a float, and the normalised cutoff is the float frequency over the Nyquist.
double pow10(double x) { return static_cast<double>(static_cast<float>(std::exp(static_cast<double>(static_cast<float>(x * std::numbers::ln10))))); }
Biquad normalized(double b0, double b1, double b2, double a0, double a1, double a2) {
    const double inverse = 1 / a0;
    Biquad f;
    f.b0 = b0 * inverse; f.b1 = b1 * inverse; f.b2 = b2 * inverse; f.a1 = a1 * inverse; f.a2 = a2 * inverse;
    return f;
}
Biquad lowpassOf(double hz, double qDb, double sr) {
    const double theta = std::numbers::pi * (hz / (sr / 2)), alpha = std::sin(theta) / (2 * pow10(qDb / 20)), cosw = std::cos(theta), beta = (1 - cosw) / 2;
    return normalized(beta, 2 * beta, beta, 1 + alpha, -2 * cosw, 1 - alpha);
}
Biquad highpassOf(double hz, double qDb, double sr) {
    const double theta = std::numbers::pi * (hz / (sr / 2)), alpha = std::sin(theta) / (2 * pow10(qDb / 20)), cosw = std::cos(theta), beta = (1 + cosw) / 2;
    return normalized(beta, -2 * beta, beta, 1 + alpha, -2 * cosw, 1 - alpha);
}
Biquad peakingOf(double hz, double q, double db, double sr) {
    const double w0 = std::numbers::pi * (hz / (sr / 2)), alpha = std::sin(w0) / (2 * q), k = std::cos(w0), a = pow10(db / 40);
    return normalized(1 + alpha * a, -2 * k, 1 - alpha * a, 1 + alpha / a, -2 * k, 1 - alpha / a);
}

struct Kernels { float up[Fir::K], down[Fir::K]; };

// up_sampler.cc MakeKernel(128): an ideal band-limited filter that samples between the source frames (offset -0.5), Blackman window
// (alpha 0.16), for the odd output frames. down_sampler.cc MakeReducedKernel(256): the half-band filter, the odd terms only.
const Kernels& kernels() {
    static const Kernels built = [] {
        Kernels k {};
        const double alpha = 0.16, a0 = 0.5 * (1.0 - alpha), a1 = 0.5, a2 = 0.5 * alpha, twoPi = 2 * std::numbers::pi;
        const int upSize = 128, downSize = 256;
        for (int i = 0; i < upSize; ++i) {
            const double s = std::numbers::pi * (i - upSize / 2 + 0.5), sinc = !s ? 1.0 : std::sin(s) / s;
            const double x = (i + 0.5) / upSize, window = a0 - a1 * std::cos(twoPi * x) + a2 * std::cos(twoPi * 2.0 * x);
            k.up[i] = static_cast<float>(sinc * window);
        }
        for (int i = 1; i < downSize; i += 2) {
            const double s = 0.5 * std::numbers::pi * (i - downSize / 2), sinc = (!s ? 1.0 : std::sin(s) / s) * 0.5;
            const double x = static_cast<double>(i) / downSize, window = a0 - a1 * std::cos(twoPi * x) + a2 * std::cos(twoPi * 2.0 * x);
            k.down[(i - 1) / 2] = static_cast<float>(sinc * window);
        }
        return k;
    }();
    return built;
}

// guitar-fx.js 7 to 19: 16385 points, x from -1 to 1, in double, stored as float
struct Curves { std::array<std::array<float, CURVE_POINTS>, 4> value; };
const Curves& curves() {
    static const Curves& built = *[] {
        static Curves c; // static storage: 256 KB is no stack object
        for (int i = 0; i < CURVE_POINTS; ++i) {
            const double x = (2.0 * i) / (CURVE_POINTS - 1) - 1;
            c.value[0][i] = static_cast<float>(std::tanh(2.5 * x));
            const double z = x / 0.1;
            c.value[1][i] = static_cast<float>(z / std::pow(1 + std::pow(std::fabs(z), 6), 1.0 / 6));
            const double f = std::tanh(6 * x);
            c.value[2][i] = static_cast<float>((f + 0.3 * f * f) / 1.3);
            c.value[3][i] = static_cast<float>(std::tanh(3 * x));
        }
        return &c;
    }();
    return built;
}

} // namespace

const float* guitarCurve(Curve c) { return curves().value[static_cast<size_t>(c)].data(); }

void Ramp::jump(float x) { value = target = last = x; idle = true; }

void Ramp::to(float x, double delaySeconds, double tc, double sampleRate, bool endsWithValue) {
    target = x;
    value = last;
    rate = sampleRate;
    delay = delaySeconds;
    const float timeConstant = static_cast<float>(tc); // the event's time constant is a float (ProcessSetTarget)
    tenTc = static_cast<double>(10.0f * timeConstant);  // kTimeConstantsToConverge * time_constant, in floats
    step = static_cast<float>(1 - std::exp(-1 / (sampleRate * timeConstant)));
    hold = static_cast<int>(std::ceil(delaySeconds * sampleRate));
    end = endsWithValue ? static_cast<int>(std::ceil((delaySeconds + 10 * tc) * sampleRate)) : 0;
    age = at = size = 0;
    idle = settled = false;
}

// The part of the SetTarget event that lies in one render quantum (ProcessSetTarget): from the quantum's start, or the event's, to the
// quantum's end, or the event's.
void Ramp::part() {
    constexpr float THRESHOLD = 4.539992976248485e-05f; // kSetTargetThreshold
    const int length = std::min(128 - (age & 127), end > 0 ? end - age : 128);
    size = length;
    at = 0;
    float v = value;
    // a quantum later: the next value of the approach. At the event's start the value is target + (value - target) * exp(-(its start - the
    // event's start) / tc), whose exponential is 1 here: the float difference is what rounds (it does not give `value` back for every pair)
    if (age != hold) v += (target - v) * step;
    else v = static_cast<float>(static_cast<double>(target) + static_cast<double>(v - target));
    // HasSetTargetConverged: 10 time constants have passed, or the value is within the threshold of the target
    const bool converged = static_cast<double>(age) / rate > delay + tenTc
        || (target == 0 ? std::fabs(v) < THRESHOLD : std::fabs(target - v) < THRESHOLD * std::fabs(v));
    if (converged) {
        std::fill(buf, buf + length, target);
        value = target;
        settled = end == 0; // later quanta would fill the target again: from the end of this buffer the ramp is idle, and `age` stops counting
        return;
    }
    // four frames at a time from the value at their start, v + delta·c0 .. c2, then v + delta·c3 (c1 to c3 expand the recursion), then the rest one by one
    const float c0 = step, c1 = c0 * (2 - c0), c2 = c0 * ((c0 - 3) * c0 + 3), c3 = c0 * (c0 * ((4 - c0) * c0 - 6) + 4);
    int k = 0;
    for (; k + 4 <= length; k += 4) {
        const float delta = target - v;
        buf[k] = v;
        buf[k + 1] = v + delta * c0;
        buf[k + 2] = v + delta * c1;
        buf[k + 3] = v + delta * c2;
        v += delta * c3;
    }
    for (; k < length; ++k) {
        buf[k] = v;
        v += (target - v) * c0;
    }
    value = buf[length - 1];
}

float Ramp::advance() {
    float out;
    if (age < hold) out = value; // setValueAtTime(param.value, now): held
    else if (end > 0 && age >= end) { // setValueAtTime(x, now + delay + 10 tc)
        value = last = target;
        idle = true;
        return target;
    } else {
        if (at >= size) part();
        out = buf[at++];
    }
    ++age;
    last = out;
    if (settled && at >= size) idle = true; // last is the target; next() returns it from here, bit for bit what the next quanta would fill
    return out;
}

void Fir::reset() { std::fill(std::begin(acc), std::end(acc), 0.0f); at = 0; }

namespace {
// sum[j] += k[j] * x for j < n. The kernel is a pointer member and `at` another member, so the compiler must assume that the stores may change
// what the loop reads; the promise of __restrict holds: the kernel is shared static data (kernels()), `sum` points into the object's own
// accumulators, and the two calls of Fir::push touch disjoint parts of them. The parameters carry it, so it ends with the call.
void scatter(float* __restrict sum, const float* __restrict k, int n, float x) {
    for (int j = 0; j < n; ++j) sum[j] += k[j] * x;
}
} // namespace

float Fir::push(float x) {
    const int first = K - at;
    scatter(acc + at, kernel, first, x);
    scatter(acc, kernel + first, K - first, x);
    const float y = acc[at];
    acc[at] = 0.0f;
    at = (at + 1) & (K - 1);
    return y;
}

void Up::prepare() { fir.kernel = kernels().up; }
void Up::reset() { fir.reset(); std::fill(std::begin(delay), std::end(delay), 0.0f); pos = 0; }
void Up::push(float x, float& even, float& odd) {
    even = delay[pos];
    delay[pos] = x;
    pos = (pos + 1) & 63;
    odd = fir.push(x);
}

void Down::prepare() { fir.kernel = kernels().down; }
void Down::reset() { fir.reset(); std::fill(std::begin(delay), std::end(delay), 0.0f); odd = 0.0f; pos = 0; }
float Down::push(float first, float second) {
    float y = fir.push(odd); // the odd sample of the 2x stream before this pair: one frame late, as the reduced kernel's shift
    y += 0.5f * delay[pos]; // the centre term: the even sample 128 stream frames (64 of ours) back
    delay[pos] = first;
    pos = (pos + 1) & 63;
    odd = second;
    return y;
}

void Shaper::prepare(const float* curve, int points, int factor) {
    curve_ = curve;
    points_ = points;
    factor_ = factor;
    scale_ = static_cast<float>(0.5 * (points - 1));
    up1_.prepare(); up2_.prepare(); down1_.prepare(); down2_.prepare();
    reset();
}

void Shaper::reset() { up1_.reset(); up2_.reset(); down1_.reset(); down2_.reset(); }

int Shaper::latency(int factor) { return factor == 2 ? 128 : 192; }

// WaveShaperHandler::WaveShaperCurveValues, the x86 path, all in float: the index, its clamped neighbour, the interpolation
float Shaper::lookup(float x) const {
    float v = (x + 1.0f) * scale_;
    const float top = static_cast<float>(points_ - 1);
    if (!(v > 0.0f)) v = 0.0f; // also a NaN
    else if (v > top) v = top;
    const int max = points_ - 1, i1 = std::min(static_cast<int>(v), max), i2 = std::min(i1 + 1, max);
    const float f = v - static_cast<float>(i1), v1 = curve_[i1], v2 = curve_[i2];
    return f * (v2 - v1) + v1;
}

float Shaper::process(float x) {
    float even, odd;
    up1_.push(x, even, odd);
    if (factor_ == 2) return down1_.push(lookup(even), lookup(odd));
    float pair[2];
    const float stream[2] = { even, odd };
    for (int k = 0; k < 2; ++k) {
        float e, o;
        up2_.push(stream[k], e, o);
        pair[k] = down2_.push(lookup(e), lookup(o));
    }
    return down1_.push(pair[0], pair[1]);
}

void GuitarFx::prepare(Engine::Layer layer, double sampleRate, bool hardFourX, bool fuzzFourX) {
    const LayerFx& p = layerFx(layer);
    rate_ = sampleRate;
    ref_ = static_cast<float>(p.ref);
    invRef_ = static_cast<float>(1 / p.ref);
    soft_.prepare(guitarCurve(Curve::soft), CURVE_POINTS, 2);
    hard_.prepare(guitarCurve(Curve::hard), CURVE_POINTS, hardFourX ? 4 : 2);
    fuzzShaper_.prepare(guitarCurve(Curve::fuzz), CURVE_POINTS, fuzzFourX ? 4 : 2);
    muff_.prepare(guitarCurve(Curve::muff), CURVE_POINTS, 2);
    // every AudioParam value is a float first
    const auto f = [](double v) { return static_cast<double>(static_cast<float>(v)); };
    const double q = f(Q_DB);
    filter_[odHp] = highpassOf(f(720), q, sampleRate);
    filter_[odLp] = lowpassOf(f(3500), q, sampleRate);
    filter_[distHp] = highpassOf(f(p.distHp), q, sampleRate);
    filter_[distLp1] = lowpassOf(f(6000), q, sampleRate);
    filter_[distLp2] = lowpassOf(f(4500), q, sampleRate);
    filter_[fuzzHp] = highpassOf(f(35), q, sampleRate);
    filter_[toneLp] = lowpassOf(f(p.toneHz), q, sampleRate);
    filter_[toneHp] = highpassOf(f(p.toneHz), q, sampleRate);
    filter_[cabHp] = highpassOf(f(p.cabHp), q, sampleRate);
    filter_[cabPeak] = peakingOf(f(p.cabPeakHz), f(1.2), f(p.cabPeakDb), sampleRate);
    filter_[cabLp1] = lowpassOf(f(p.cabLp), q, sampleRate);
    filter_[cabLp2] = lowpassOf(f(p.cabLp * 1.2), q, sampleRate);
    reset();
}

void GuitarFx::reset() {
    built_ = false;
    for (Ramp* r : { &dry_, &wetOut_, &cabDry_, &cabWet_, &bias_, &od_.bypass, &od_.wet, &od_.drive, &od_.makeup, &dist_.bypass, &dist_.wet, &dist_.drive,
                     &dist_.makeup, &fuzz_.bypass, &fuzz_.wet, &fuzz_.drive, &fuzz_.makeup }) r->jump(0.0f);
    dry_.jump(1.0f);
    for (Biquad& b : filter_) b.x1 = b.x2 = b.y1 = b.y2 = 0.0;
    soft_.reset(); hard_.reset(); fuzzShaper_.reset(); muff_.reset();
}

void GuitarFx::set(const FxChainParams& p, bool atStart) {
    bool immediate = atStart;
    Fade fade { 0.0, TC };
    if (!built_) {
        if (!p.active) return;
        // build(): the nodes' first values; the chain itself fades in after a delay (the first 80 ms or 150 ms are the dry path)
        for (Stage* s : { &od_, &dist_, &fuzz_ }) { s->bypass.jump(1.0f); s->wet.jump(0.0f); s->drive.jump(1.0f); s->makeup.jump(1.0f); }
        wetOut_.jump(0.0f);
        cabDry_.jump(1.0f);
        cabWet_.jump(0.0f);
        bias_.jump(0.0f);
        // ConstantSource offset, setTargetAtTime from the build; no setValueAtTime ends it (Chromium's convergence test does, at a quantum's start)
        bias_.to(FUZZ_BIAS, 0.0, BIAS_TC, rate_, false);
        built_ = true;
        fade = atStart ? CREATE : LAZY;
        immediate = true;
    }
    const auto to = [&](Ramp& r, double value, Fade by = { 0.0, TC }) {
        const float v = static_cast<float>(value);
        if (immediate && by.delay == 0.0) r.jump(v);
        else r.to(v, by.delay, by.tc, rate_);
    };
    to(dry_, p.active ? 0 : 1, fade);
    to(wetOut_, p.active ? 1 : 0, fade);
    const FxStage* values[3] = { &p.od, &p.dist, &p.fuzz };
    Stage* stages[3] = { &od_, &dist_, &fuzz_ };
    for (int i = 0; i < 3; ++i) {
        to(stages[i]->bypass, 1 - values[i]->mix);
        to(stages[i]->wet, values[i]->mix);
        to(stages[i]->drive, values[i]->drive, i == 2 ? Fade { 0.0, FUZZ_DRIVE_TC } : Fade { 0.0, TC });
        to(stages[i]->makeup, values[i]->makeup);
    }
    to(cabDry_, 1 - p.cab);
    to(cabWet_, p.cab);
}

// shortcut: mono, the left channel; the stereo voices of Phase 5 need a second state of every filter and shaper. When the input becomes
// stereo, Chromium's WaveShaperNode uninitialises and re-initialises itself (wave_shaper_handler.cc 400 to 420): its shapers' state is lost.
void GuitarFx::process(float* x, int count) {
    if (!built_) return;
    for (int i = 0; i < count; ++i) {
        const float in = x[i], s = in * ref_; // the input node (gain 1), then `scaled`
        // overdrive: the highpassed copy driven and added to the signal, soft clipping at 2x, lowpass
        const float odBypass = s * od_.bypass.next();
        const float odDriven = filter_[odHp].step(s) * od_.drive.next();
        const float odClipped = soft_.process(s + odDriven);
        const float odOut = odBypass + (filter_[odLp].step(odClipped) * od_.makeup.next()) * od_.wet.next();
        // distortion: highpass, drive, lowpass, hard clipping at 4x, lowpass
        const float distBypass = odOut * dist_.bypass.next();
        const float distDriven = filter_[distHp].step(odOut) * dist_.drive.next();
        const float distClipped = hard_.process(filter_[distLp1].step(distDriven));
        const float distOut = distBypass + (filter_[distLp2].step(distClipped) * dist_.makeup.next()) * dist_.wet.next();
        // fuzz: the bias in front of the drive, the Fuzz Face curve at 4x, highpass, 1.5, the Big Muff curve at 2x, the tone's two branches
        const float fuzzBypass = distOut * fuzz_.bypass.next();
        const float fuzzDriven = (distOut + bias_.next()) * fuzz_.drive.next();
        const float muff = muff_.process(filter_[fuzzHp].step(fuzzShaper_.process(fuzzDriven)) * 1.5f);
        const float tone = filter_[toneLp].step(muff) * 0.7f + filter_[toneHp].step(muff) * 0.6f;
        const float fuzzOut = fuzzBypass + (tone * fuzz_.makeup.next()) * fuzz_.wet.next();
        // cabinet: highpass, bell, two lowpasses; the dry part of the cabinet stage beside it; then 1 / ref and the chain's output gain
        const float cabDried = fuzzOut * cabDry_.next();
        const float cabbed = filter_[cabLp2].step(filter_[cabLp1].step(filter_[cabPeak].step(filter_[cabHp].step(fuzzOut)))) * cabWet_.next();
        const float wet = ((cabDried + cabbed) * invRef_) * wetOut_.next();
        x[i] = in * dry_.next() + wet;
    }
}

} // namespace btg::detail
