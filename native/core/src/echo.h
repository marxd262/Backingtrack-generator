#pragma once

// The echo of synth.js (94 to 100, 303 to 307): a line of at most 3 s (createDelay(3)) read with linear interpolation (Chromium delay.cc),
// a lowpass in the loop and feedback. Per frame and channel: v = the line `delay()` s ago, y = tone(v), the line takes in + feedback * y(128
// frames ago); y is the output. The time jumps to a target or glides to it with the time constant 0.05 s (setTargetAtTime in setTempo).
// Times below one frame are not used (the shortest echo, at 400 bpm, is 0.1125 s).
// The 128 frames in the loop are Chromium's: a graph cycle hands the fed-back signal on one render quantum late, so the first echo comes
// after `delay()`, the second after twice that plus 128 frames (measured against the browser: the echo of a lead, 0.3 % error with it,
// 86 % without; delay.cc alone does not show it).

#include "sampler.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace btg::detail {

struct Echo {
    static constexpr double MAX_SECONDS = 3.0, GLIDE = 0.05;

    // Allocates ceil(3 s * rate) + 2 frames per channel, then reset(); not on the audio thread.
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        glide_ = 1 - std::exp(-1 / (GLIDE * sr_));
        for (std::vector<float>& line : line_) line.assign(static_cast<size_t>(std::ceil(MAX_SECONDS * sr_)) + 2, 0.0f);
        setTone(toneHz_);
        reset();
    }
    // Silence and the tone's state cleared; the time stays.
    void reset() {
        for (std::vector<float>& line : line_) std::fill(line.begin(), line.end(), 0.0f);
        for (Biquad& f : tone_) f.x1 = f.x2 = f.y1 = f.y2 = 0.0;
        for (std::array<float, QUANTUM>& ring : back_) ring.fill(0.0f);
        write_ = 0;
        at_ = 0;
    }
    // Clamped to [0, 3]; now: the time is there at once (a start).
    void setTarget(double seconds, bool now) {
        target_ = std::clamp(seconds, 0.0, MAX_SECONDS);
        if (now) seconds_ = target_;
    }
    // lowpass(hz, Q 1 dB); the state stays.
    void setTone(double hz) {
        toneHz_ = hz;
        const Biquad f = lowpass(hz, 1, sr_);
        for (Biquad& b : tone_) { b.b0 = f.b0; b.b1 = f.b1; b.b2 = f.b2; b.a1 = f.a1; b.a2 = f.a2; }
    }
    // One frame; the time moves one frame towards its target.
    void process(float inLeft, float inRight, double feedback, float& outLeft, float& outRight) {
        if (seconds_ != target_) seconds_ += (target_ - seconds_) * glide_;
        const size_t size = line_[0].size();
        double pos = static_cast<double>(write_) - seconds_ * sr_;
        if (pos < 0) pos += static_cast<double>(size);
        const size_t i1 = std::min(static_cast<size_t>(pos), size - 1), i2 = i1 + 1 < size ? i1 + 1 : 0;
        const float f = static_cast<float>(pos - static_cast<double>(i1));
        const float in[2] = { inLeft, inRight };
        float out[2];
        for (int c = 0; c < 2; ++c) {
            const float s1 = line_[c][i1], s2 = line_[c][i2];
            out[c] = static_cast<float>(tone_[c].process(s1 + f * (s2 - s1)));
            line_[c][write_] = in[c] + static_cast<float>(feedback) * back_[c][at_]; // y of 128 frames ago
            back_[c][at_] = out[c];
        }
        write_ = write_ + 1 < size ? write_ + 1 : 0;
        at_ = at_ + 1 < QUANTUM ? at_ + 1 : 0;
        outLeft = out[0];
        outRight = out[1];
    }
    // The time now, s.
    double delay() const { return seconds_; }

private:
    static constexpr size_t QUANTUM = 128; // Web Audio's render quantum
    std::vector<float> line_[2];
    std::array<float, QUANTUM> back_[2] = {}; // the last 128 outputs: the loop's extra delay
    Biquad tone_[2];
    size_t write_ = 0, at_ = 0;
    double sr_ = 48000.0, seconds_ = 0.0, target_ = 0.0, glide_ = 0.0, toneHz_ = 2400.0;
};

} // namespace btg::detail
