#pragma once

// An AudioParam: its intrinsic value, a timeline of up to EVENTS events and an optional input added at audio rate, one value per frame as
// Chromium's audio_param_handler.cc computes it (param.cpp). Times and time constants are frames from the tone's time 0, as double. No
// allocation, no lock, no throw.
//
// Chromium computes the values per render quantum of 128 frames and starts some of them over at every quantum (an exponential ramp from its
// closed form, a setTarget's groups of four frames). The core has no such grid: the running values (the exponential's accumulator, the
// setTarget's value) go on from frame to frame across calls, so the values do not depend on how a render is cut into calls.

#include <cstdint>

namespace btg::detail {

constexpr int EVENTS = 6; // adsr's four events, the epiano's amp four

struct Param {
    enum Kind : uint8_t { set, linear, exponential, target };
    float value = 0.0f; // the intrinsic value: before the first event, and what the input adds to while there is none
    struct Event { uint8_t kind; double frame; float value; double tc; } events[EVENTS] = {};
    int count = 0, input = -1; // input: the node whose output SynthTone adds at audio rate, -1 none
    bool overflow = false;     // an event beyond EVENTS was asked for and not taken
    // The place of frame 0 in its render quantum (a SynthTone's): a setTarget is tested for convergence at its own first frame and at each
    // quantum's first frame, as ProcessSetTarget tests it (Task 20); -1: at every frame (the param kind of voice-compare.mjs measures that).
    int quantum = -1;
    void setValueAtTime(float v, double frame);
    void linearRampToValueAtTime(float v, double frame);
    void exponentialRampToValueAtTime(float v, double frame);
    void setTargetAtTime(float v, double frame, double tc);
    // The next `frames` values, from frame 0 on (each call goes on where the last one ended): the timeline, plus added[i] (the input's block)
    // unless added is nullptr.
    void values(int frames, const float* added, float* out);
    bool hasTimeline() const { return count > 0 || input >= 0; }

private:
    enum Mode : uint8_t { hold, ramp, exponent, approach };
    void insert(uint8_t kind, float v, double frame, double tc);
    void enter(int i, long long frame);
    long long frame_ = 0; // the next frame values() computes
    int at_ = -1;         // the event whose part of the timeline that frame lies in, -1 before the first
    Mode mode_ = hold;
    bool converged_ = false;
    float last_ = 0.0f, from_ = 0.0f, to_ = 0.0f, k_ = 0.0f, step_ = 0.0f; // last_: Chromium's running `value`
    double start_ = 0.0, tc_ = 0.0, acc_ = 0.0, mul_ = 1.0;
};

} // namespace btg::detail
