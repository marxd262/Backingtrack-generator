/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
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
// Ported to the core from Chromium, third_party/blink/renderer/platform/audio/dynamics_compressor.cc at 158.0.8127.18; the metering is left out.
#include "compressor.h"

#include <algorithm>
#include <cfloat>
#include <cmath>
#include <numbers>

namespace btg::detail {
namespace {

constexpr float kPiOverTwoFloat = static_cast<float>(std::numbers::pi / 2);

constexpr float kPreDelay = 0.006f; // seconds

// Release zone values 0 -> 1.
constexpr float kReleaseZone1 = 0.09f;
constexpr float kReleaseZone2 = 0.16f;
constexpr float kReleaseZone3 = 0.42f;
constexpr float kReleaseZone4 = 0.98f;

constexpr float kABase = 0.9999999999999998f * kReleaseZone1 +
                         1.8432219684323923e-16f * kReleaseZone2 -
                         1.9373394351676423e-16f * kReleaseZone3 +
                         8.824516011816245e-18f * kReleaseZone4;
constexpr float kBBase =
    -1.5788320352845888f * kReleaseZone1 + 2.3305837032074286f * kReleaseZone2 -
    0.9141194204840429f * kReleaseZone3 + 0.1623677525612032f * kReleaseZone4;
constexpr float kCBase =
    0.5334142869106424f * kReleaseZone1 - 1.272736789213631f * kReleaseZone2 +
    0.9258856042207512f * kReleaseZone3 - 0.18656310191776226f * kReleaseZone4;
constexpr float kDBase =
    0.08783463138207234f * kReleaseZone1 - 0.1694162967925622f * kReleaseZone2 +
    0.08588057951595272f * kReleaseZone3 - 0.00429891410546283f * kReleaseZone4;
constexpr float kEBase = -0.042416883008123074f * kReleaseZone1 +
                         0.1115693827987602f * kReleaseZone2 -
                         0.09764676325265872f * kReleaseZone3 +
                         0.028494263462021576f * kReleaseZone4;

// Detector release time.
constexpr float kSatReleaseTime = 0.0025f;

// Returns x if x is finite (not NaN or infinite), otherwise returns default_value
float ensureFinite(float x, float defaultValue) { return std::isfinite(x) ? x : defaultValue; }

// decibelsToLinear and linearToDecibels (the two lines below, up to the next blank line) are from Chromium,
// third_party/blink/renderer/platform/audio/audio_utilities.cc (powf(10, 0.05f * decibels) and 20 * log10f(linear)); the notice of
// that file, which covers these two lines and nothing else in this file (the rest is covered by the notice at the head of this file):
/*
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
float decibelsToLinear(float decibels) { return std::pow(10.0f, 0.05f * decibels); }
float linearToDecibels(float linear) { return 20 * std::log10(linear); }

// DenormalDisabler::FlushDenormalFloatToZero
float flushDenormalFloatToZero(float f) { return std::fabs(f) < FLT_MIN ? 0.0f : f; }

} // namespace

void Compressor::prepare(float sampleRate) {
    sampleRate_ = sampleRate;
    // SetPreDelayTime(kPreDelay)
    unsigned preDelayFrames = static_cast<unsigned>(kPreDelay * sampleRate_);
    if (preDelayFrames > MAX_PRE_DELAY_FRAMES - 1) preDelayFrames = MAX_PRE_DELAY_FRAMES - 1;
    preDelayFrames_ = preDelayFrames;
    update();
    reset();
}

// The browser's node is new at every play(): the constructor's Reset() and the first Process's SetPreDelayTime(), which puts the write index
// at the pre-delay (Reset() alone leaves it at kDefaultPreDelayFrames, 256).
void Compressor::reset() {
    detectorAverage_ = 0;
    compressorGain_ = 1;
    for (std::array<float, MAX_PRE_DELAY_FRAMES>& buffer : preDelayBuffers_) buffer.fill(0.0f);
    preDelayReadIndex_ = 0;
    preDelayWriteIndex_ = static_cast<int>(preDelayFrames_);
    dbMaxAttackCompressionDiff_ = -1; // uninitialized state
    divisionLeft_ = 0;
}

void Compressor::set(float threshold, float knee, float ratio, float attack, float release) {
    threshold_ = threshold;
    knee_ = knee;
    ratio_ = ratio;
    attack_ = attack;
    release_ = release;
    update();
}

// What Process computes at its top from the five parameters.
void Compressor::update() {
    const float dbThreshold = threshold_;
    const float dbKnee = knee_;
    const float ratio = ratio_;
    const float attackTime = attack_;
    const float releaseTime = release_;
    const float sampleRate = sampleRate_;

    k_ = updateStaticCurveParameters(dbThreshold, dbKnee, ratio);

    // Makeup gain with empirical/perceptual tuning.
    linearPostGain_ = std::pow(1 / saturate(1, k_), 0.6f);

    // Attack parameters.
    attackFrames_ = std::max(0.001f, attackTime) * sampleRate;

    // Release parameters.
    const float releaseFrames = sampleRate * releaseTime;

    satReleaseFrames_ = kSatReleaseTime * sampleRate;

    // Polynomial of the form y = a + b*x + c*x^2 + d*x^3 + e*x^4; x ranges from 0 -> 3 (-15 -10 -5 0db)
    a_ = releaseFrames * kABase;
    b_ = releaseFrames * kBBase;
    c_ = releaseFrames * kCBase;
    d_ = releaseFrames * kDBase;
    e_ = releaseFrames * kEBase;
}

void Compressor::process(float* left, float* right, int count) {
    float* const channels[2] = { left, right };
    int preDelayReadIndex = preDelayReadIndex_;
    int preDelayWriteIndex = preDelayWriteIndex_;
    float detectorAverage = detectorAverage_;
    float compressorGain = compressorGain_;

    for (int frameIndex = 0; frameIndex < count; ++frameIndex) {
        if (divisionLeft_ == 0) { // a new division of 32 frames
            divisionLeft_ = NUMBER_OF_DIVISION_FRAMES;

            // Calculate desired gain

            detectorAverage = ensureFinite(detectorAverage, 1);

            const float desiredGain = detectorAverage;

            // Pre-warp so we get desired_gain after sin() warp below.
            scaledDesiredGain_ = std::asin(desiredGain) / kPiOverTwoFloat;

            // Deal with envelopes

            // envelope_rate is the rate we slew from current compressor level to the
            // desired level.  The exact rate depends on if we're attacking or
            // releasing and by how much.
            envelopeRate_ = 0.0f;

            const bool isReleasing = scaledDesiredGain_ > compressorGain;

            // compression_diff_db is the difference between current compression level
            // and the desired level.
            float dbCompressionDiff = 0.0f;

            if (scaledDesiredGain_ == 0) {
                dbCompressionDiff = isReleasing ? -1.0f : 1.0f;
            } else {
                dbCompressionDiff = linearToDecibels(compressorGain / scaledDesiredGain_);
            }

            if (isReleasing) {
                // Release mode - db_compression_diff should be negative dB
                dbMaxAttackCompressionDiff_ = -1;

                dbCompressionDiff = ensureFinite(dbCompressionDiff, -1);

                // Adaptive release - higher compression (lower db_compression_diff)
                // releases faster.

                // Contain within range: -12 -> 0 then scale to go from 0 -> 3
                float x = dbCompressionDiff;
                x = std::clamp(x, -12.0f, 0.0f);
                x = 0.25f * (x + 12);

                // Compute adaptive release curve using 4th order polynomial.
                const float x2 = x * x;
                const float x3 = x2 * x;
                const float x4 = x2 * x2;
                const float calcReleaseFrames = a_ + b_ * x + c_ * x2 + d_ * x3 + e_ * x4;

                constexpr float kDbSpacing = 5;
                const float dbPerFrame = kDbSpacing / calcReleaseFrames;

                envelopeRate_ = decibelsToLinear(dbPerFrame);
            } else {
                // Attack mode - db_compression_diff should be positive dB

                dbCompressionDiff = ensureFinite(dbCompressionDiff, 1);

                // As long as we're still in attack mode, use a rate based off
                // the largest db_compression_diff we've encountered so far.
                if (dbMaxAttackCompressionDiff_ == -1 || dbMaxAttackCompressionDiff_ < dbCompressionDiff) {
                    dbMaxAttackCompressionDiff_ = dbCompressionDiff;
                }

                const float dbEffAttenDiff = std::max(0.5f, dbMaxAttackCompressionDiff_);

                const float x = 0.25f / dbEffAttenDiff;
                envelopeRate_ = 1 - std::pow(x, 1 / attackFrames_);
            }
        }

        float compressorInput = 0;

        // Predelay signal, computing compression amount from un-delayed version.
        for (int j = 0; j < 2; ++j) {
            const float undelayedSource = channels[j][frameIndex];
            preDelayBuffers_[j][static_cast<size_t>(preDelayWriteIndex)] = undelayedSource;

            const float absUndelayedSource = undelayedSource > 0 ? undelayedSource : -undelayedSource;
            if (compressorInput < absUndelayedSource) {
                compressorInput = absUndelayedSource;
            }
        }

        // Calculate shaped power on undelayed input.

        const float scaledInput = compressorInput;
        const float absInput = scaledInput > 0 ? scaledInput : -scaledInput;

        // Put through shaping curve.
        const float shapedInput = saturate(absInput, k_);

        const float attenuation = absInput <= 0.0001f ? 1 : shapedInput / absInput;

        const float dbAttenuation = std::max(2.0f, -linearToDecibels(attenuation));

        const float dbPerFrame = dbAttenuation / satReleaseFrames_;

        const float satReleaseRate = decibelsToLinear(dbPerFrame) - 1;

        const bool isRelease = (attenuation > detectorAverage);
        const float rate = isRelease ? satReleaseRate : 1;

        detectorAverage += (attenuation - detectorAverage) * rate;
        detectorAverage = std::min(1.0f, detectorAverage);

        detectorAverage = ensureFinite(detectorAverage, 1);

        // Exponential approach to desired gain.
        if (envelopeRate_ < 1) {
            // Attack - reduce gain to desired.
            compressorGain += (scaledDesiredGain_ - compressorGain) * envelopeRate_;
        } else {
            // Release - exponentially increase gain to 1.0
            compressorGain *= envelopeRate_;
            compressorGain = std::min(1.0f, compressorGain);
        }

        // Warp pre-compression gain to smooth out sharp exponential transition points.
        const float postWarpCompressorGain = static_cast<float>(std::sin(static_cast<double>(kPiOverTwoFloat * compressorGain)));

        // Calculate total gain using the linear post-gain.
        const float totalGain = linearPostGain_ * postWarpCompressorGain;

        // Apply final gain.
        for (int j = 0; j < 2; ++j) {
            channels[j][frameIndex] = preDelayBuffers_[j][static_cast<size_t>(preDelayReadIndex)] * totalGain;
        }

        preDelayReadIndex = (preDelayReadIndex + 1) & MAX_PRE_DELAY_FRAMES_MASK;
        preDelayWriteIndex = (preDelayWriteIndex + 1) & MAX_PRE_DELAY_FRAMES_MASK;

        if (--divisionLeft_ == 0) { // the division's end: the locals back to the state, denormals flushed
            detectorAverage = flushDenormalFloatToZero(detectorAverage);
            compressorGain = flushDenormalFloatToZero(compressorGain);
        }
    }

    preDelayReadIndex_ = preDelayReadIndex;
    preDelayWriteIndex_ = preDelayWriteIndex;
    detectorAverage_ = detectorAverage;
    compressorGain_ = compressorGain;
}

// Exponential curve for the knee.
// It is 1st derivative matched at linear_threshold_ and asymptotically
// approaches the value linear_threshold_ + 1 / k.
float Compressor::kneeCurve(float x, float k) const {
    // Linear up to threshold.
    if (x < linearThreshold_) {
        return x;
    }

    return linearThreshold_ + (1 - static_cast<float>(std::exp(static_cast<double>(-k * (x - linearThreshold_))))) / k;
}

// Full compression curve with constant ratio after knee.
float Compressor::saturate(float x, float k) const {
    if (x < kneeThreshold_) {
        return kneeCurve(x, k);
    }
    // Constant ratio after knee.
    const float dbX = linearToDecibels(x);
    const float dbY = dbYKneeThreshold_ + slope_ * (dbX - dbKneeThreshold_);
    return decibelsToLinear(dbY);
}

float Compressor::kAtSlope(float desiredSlope) const {
    const float dbX = dbThreshold_ + dbKnee_;
    const float x = decibelsToLinear(dbX);
    float x2 = 1;
    float dbX2 = 0;

    if (!(x < linearThreshold_)) {
        x2 = static_cast<float>(x * 1.001);
        dbX2 = linearToDecibels(x2);
    }

    // Approximate k given initial values.
    float minK = static_cast<float>(0.1);
    float maxK = 10000;
    float k = 5;

    float slope = 1;
    for (int i = 0; i < 15; ++i) {
        // A high value for k will more quickly asymptotically approach a slope of 0.

        // Approximate 1st derivative with input and output expressed in dB.
        // This slope is equal to the inverse of the compression "ratio".
        if (!(x < linearThreshold_)) {
            const float dbY = linearToDecibels(kneeCurve(x, k));
            const float dbY2 = linearToDecibels(kneeCurve(x2, k));
            slope = (dbY2 - dbY) / (dbX2 - dbX);
        }

        if (slope < desiredSlope) {
            // k is too high.
            maxK = k;
        } else {
            // k is too low.
            minK = k;
        }

        // Re-calculate based on geometric mean.
        k = std::sqrt(minK * maxK);
    }

    return k;
}

float Compressor::updateStaticCurveParameters(float dbThreshold, float dbKnee, float ratio) {
    if (dbThreshold != dbThreshold_ || dbKnee != dbKnee_ || ratio != curveRatio_) {
        // Threshold and knee.
        dbThreshold_ = dbThreshold;
        linearThreshold_ = decibelsToLinear(dbThreshold);
        dbKnee_ = dbKnee;

        // Compute knee parameters.
        curveRatio_ = ratio;
        slope_ = 1 / curveRatio_;

        const float k = kAtSlope(1 / curveRatio_);

        dbKneeThreshold_ = dbThreshold + dbKnee;
        kneeThreshold_ = decibelsToLinear(dbKneeThreshold_);

        dbYKneeThreshold_ = linearToDecibels(kneeCurve(kneeThreshold_, k));

        curveK_ = k;
    }
    return curveK_;
}

} // namespace btg::detail
