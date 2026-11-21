/*
 * The nodes of a synth tone follow Chromium, third_party/blink/renderer/ at 158.0.8127.18 (audio_utilities.cc: at main, as for mod_fx.cpp):
 *   modules/webaudio/audio_scheduled_source_handler.cc (Copyright 2022 The Chromium Authors): a source's start and end frame, its time
 *                                                       rounded up, the end exclusive; the start time's offset from its frame
 *                                                       (start_frame_offset, Task 22; UpdateSchedulingInfo, Task 23a)
 *   modules/webaudio/audio_buffer_source_handler.cc    (Copyright 2022 The Chromium Authors): at rate 1 the offset rounded to a frame and the
 *                                                       frames copied (ClampGrainParameters, ProcessFastPath), the loop over the whole
 *                                                       buffer, silence after the end without a loop; a start between frames (Task 23a):
 *                                                       the read index moved by the part of a frame since the start time (RenderFromBuffer)
 *                                                       and the buffer read between its samples (ProcessInterpolatedPath)
 *   modules/webaudio/biquad_filter_handler.cc          (Copyright 2022 The Chromium Authors): the coefficients per frame while a param moves,
 *                                                       once otherwise; the frequency over the Nyquist frequency
 *   platform/audio/stereo_panner.cc                    (Copyright 2014 The Chromium Authors): the gains of a mono input, as float
 *   modules/webaudio/oscillator_handler.cc             (Copyright 2022 The Chromium Authors): the first render quantum of an a-rate
 *                                                       oscillator, the increments from the quantum's first frame (Process); the start
 *                                                       frame and read index of a start between frames (Process, Task 23a); in the
 *                                                       context's first render quantum the a-rate path, which leaves that read index at
 *                                                       0 (Process, Phase 5's fix wave)
 *   modules/webaudio/audio_param_handler.cc            (Copyright 2022 The Chromium Authors): a setValue at time 0 gives a param sample-
 *                                                       accurate values in the context's first render quantum (HasSampleAccurateValues,
 *                                                       Phase 5's fix wave)
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
 * And platform/audio/audio_utilities.cc (TimeToSampleFrame: the frame at 1024 times the rate, rounded, then rounded up or to the nearest).
 * Its notice:
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
 * Read only, nothing taken: platform/audio/audio_bus.cc (the up-mix of a mono input into two channels, L = R = x), modules/webaudio/
 * gain_handler.cc, audio_node_input.cc (an input has the most channels of what is connected to it) and audio_handler.cc.
 */
#include "patch.h"

#include "convolver.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <numbers>
#include <utility>

namespace btg::detail {
namespace {

// TimeToSampleFrame of a time given in frames: kRoundUp for a source's start and end, kRoundToNearest for a buffer's offset. Clamped to
// [0, NEVER] before the cast: a stop of infinity (the web's "no stop") plays on, a NaN is 0, and the sums on a frame stay in range.
constexpr double NEVER = 4611686018427387904.0; // 2^62 frames
long long frameOf(double frame) { return frame >= 0 ? static_cast<long long>(frame < NEVER ? frame : NEVER) : 0; } // a NaN fails the first test
long long framesUp(double frames) { return frameOf(std::ceil(std::round(frames * 1024) / 1024)); }
long long framesNearest(double frames) { return frameOf(std::round(std::round(frames * 1024) / 1024)); }

// The first render quantum of an a-rate oscillator, as Chromium plays it: not the Web Audio specification, Chromium's behaviour
// (oscillator_handler.cc 739 to 760, Process hands ProcessARate the increments of the whole quantum while the output begins at the
// oscillator's start). An oscillator whose frequency or detune has a timeline or an input runs, from its start to the end of the quantum
// it starts in, on the values of the quantum's first frames: `offset` frames behind its params (before the tone's time 0 their intrinsic
// values, and no input sounds yet). An FM carrier keeps the phase it loses there for its whole tone, so the e-piano's level and colour
// differ from tone to tone with the tone's place in the quantum (measured in Task 21: one tone's level in 50 ms windows up to 2.25 dB off,
// two strikes of the same pitch up to 5.4 dB, a track's level 1.0 to 1.8 dB). The core follows it because the web app sounds like that.
// false takes it out (order() then gives no oscillator the ring, process() hands on nothing).
constexpr bool CHROMIUM_FIRST_QUANTUM = true;

} // namespace

int SynthTone::add(Kind kind) {
    if (nodeCount_ == NODES) { overflow_ = true; return -1; }
    nodes_[nodeCount_] = Node {};
    nodes_[nodeCount_].kind = kind;
    ordered_ = false;
    return nodeCount_++;
}

int SynthTone::osc(Wave wave, float hz, float cents, double start, double stop) {
    if (!basic) { overflow_ = true; return -1; }
    return osc(basic->wave[static_cast<int>(wave)], hz, cents, start, stop);
}

int SynthTone::osc(const WaveTables& wave, float hz, float cents, double start, double stop) {
    const int n = add(source);
    if (n < 0) return n;
    start += late;
    stop += late;
    Node& node = nodes_[n];
    node.oscillator.wave = &wave;
    node.constant[0] = hz;
    node.constant[1] = cents;
    // The start frame and the part of a frame from the start time to it: -start_frame_offset of UpdateSchedulingInfo for a start before its
    // frame; a start within 1/2048 frame after a frame, which TimeToSampleFrame rounds down to it, leaves that frame unwritten (0) and plays
    // from the next with 1 - start_frame_offset (oscillator_handler.cc 739 to 743). Both are the start rounded up. Except in the offline
    // context's first render quantum (Tones::firstQuantum): there every oscillator takes Process's a-rate path (setting a param's .value schedules
    // setValueAtTime at currentTime, 0 there, which gives it sample-accurate values in that quantum: audio_param_handler.cc 1059 to 1073; one
    // with a timeline takes that path anyway), on which the frequency that moves the read index stays 0 (oscillator_handler.cc 710 to 746).
    node.start = frameOf(std::ceil(start));
    node.stop = framesUp(stop);
    node.oscillator.offset = static_cast<int>((quantum + node.start) % 128);
    node.oscillator.lead = node.start < firstQuantum ? 0.0 : std::max(0.0, static_cast<double>(node.start) - start); // (a NaN start: 0)
    end = std::max(end, node.stop);
    return n;
}

int SynthTone::buffer(const float* data, int frames, double offset, bool loop, double start, double stop) {
    if (!data || frames <= 0) { overflow_ = true; return -1; }
    const int n = add(buffered);
    if (n < 0) return n;
    start += late;
    stop += late;
    Node& node = nodes_[n];
    node.data = data;
    node.frames = frames;
    node.read = static_cast<double>(std::min<long long>(framesNearest(offset), frames)); // the offset clamped to the buffer, then to a frame (rate 1)
    if (loop && node.read >= frames) node.read = 0;
    node.loop = loop;
    node.start = framesUp(start);
    node.stop = framesUp(stop);
    // RenderFromBuffer: a start before its frame reads from that much further on (-start_frame_offset); one rounded down to it does not
    node.read += std::max(0.0, static_cast<double>(node.start) - start);
    end = std::max(end, node.stop);
    return n;
}

int SynthTone::gain(float value) {
    const int n = add(amp);
    if (n >= 0) nodes_[n].constant[0] = value;
    return n;
}

int SynthTone::biquad(Filter type, float hz, float q) {
    if (!basic) { overflow_ = true; return -1; } // the rate
    const int n = add(filter);
    if (n < 0) return n;
    Node& node = nodes_[n];
    node.type = type;
    node.constant[0] = hz;
    node.constant[1] = q;
    node.hz = std::numeric_limits<float>::quiet_NaN();
    return n;
}

int SynthTone::panner(float pan) {
    const int n = add(panning);
    if (n < 0) return n;
    // PanToTargetValue, mono input: the pan clamped, the angle in double, the gains as float
    const double radian = (static_cast<double>(std::clamp(pan, -1.0f, 1.0f)) * 0.5 + 0.5) * (std::numbers::pi / 2);
    nodes_[n].gainLeft = static_cast<float>(std::cos(radian));
    nodes_[n].gainRight = static_cast<float>(std::sin(radian));
    return n;
}

Param& SynthTone::param(int node, int which) {
    const bool valid = node >= 0 && node < nodeCount_ && which >= 0 && which < 2
        && (nodes_[node].kind == source || nodes_[node].kind == filter || (nodes_[node].kind == amp && which == 0));
    if (!valid) { overflow_ = true; return spare_; }
    Node& n = nodes_[node];
    if (n.slot[which] >= 0) return params_[n.slot[which]];
    if (paramCount_ == PARAMS) { overflow_ = true; return spare_; }
    const int slot = paramCount_++;
    params_[slot] = Param {};
    params_[slot].value = n.constant[which];
    params_[slot].quantum = quantum; // its frame 0 is the tone's frame 0
    params_[slot].late = late;
    n.slot[which] = slot;
    ordered_ = false;
    return params_[slot];
}

void SynthTone::connect(int from, int to) {
    if (from < 0 || from >= nodeCount_ || to < 0 || to >= nodeCount_ || from == to || nodes_[to].kind == source || nodes_[to].kind == buffered) {
        overflow_ = true;
        return;
    }
    nodes_[to].inputs |= 1u << from;
    ordered_ = false;
}

void SynthTone::modulate(int from, Param& p) {
    bool mine = false; // one of this tone's slots, not the spare
    for (int i = 0; i < paramCount_; ++i) mine = mine || &params_[i] == &p;
    if (from < 0 || from >= nodeCount_ || !mine || p.input >= 0) { overflow_ = true; return; }
    p.input = from;
    ordered_ = false;
}

void SynthTone::output(int node) {
    if (node < 0 || node >= nodeCount_) { overflow_ = true; return; }
    out_ = node;
    ordered_ = false;
}

void SynthTone::choke(long long inFrames, double tc, double sr) {
    if (chokeIn >= 0 && chokeIn <= inFrames) return; // already choked earlier
    chokeIn = inFrames;
    chokeMul = std::exp(-1 / (tc * sr));
}

void SynthTone::release(double sr) {
    if (releaseLeft_ >= 0) return; // falling already
    releaseLeft_ = std::max(1LL, frameOf(releaseSeconds * sr));
    releaseMul_ = std::pow(1e-4, 1.0 / static_cast<double>(releaseLeft_));
}

bool SynthTone::overflow() const {
    if (overflow_) return true;
    for (int i = 0; i < paramCount_; ++i)
        if (params_[i].overflow) return true;
    return false;
}

// The nodes the output pulls, inputs before the nodes they feed (a param's input before the param's node), and every node's channels: a
// panner has two, a gain or a biquad the most of its inputs. False for a graph Chromium would not play this way: a cycle, no output, a
// stereo input into a panner or a param; and for one the core cannot: a second oscillator whose frequency or detune moves.
bool SynthTone::order() {
    if (out_ < 0) return false;
    uint8_t state[NODES] = {}; // 0 not seen, 1 on the path, 2 done
    sequenceCount_ = 0;
    const auto visit = [&](const auto& self, int n) -> bool {
        if (state[n] == 2) return true;
        if (state[n] == 1) return false;
        state[n] = 1;
        Node& node = nodes_[n];
        uint8_t channels = static_cast<uint8_t>(node.kind == panning ? 2 : 1);
        for (int i = 0; i < nodeCount_; ++i) {
            if (!(node.inputs >> i & 1u)) continue;
            if (!self(self, i) || (node.kind == panning && nodes_[i].channels != 1)) return false;
            channels = std::max(channels, nodes_[i].channels);
        }
        for (const int slot : node.slot) {
            const int in = slot >= 0 ? params_[slot].input : -1;
            if (in >= 0 && (!self(self, in) || nodes_[in].channels != 1)) return false;
        }
        node.channels = channels;
        state[n] = 2;
        sequence_[sequenceCount_++] = n;
        return true;
    };
    if (!visit(visit, out_)) return false;
    // Chromium's first quantum (CHROMIUM_FIRST_QUANTUM) keeps the values of one oscillator whose frequency or detune moves: a tone with a
    // second one overflows, wherever they start. That one gets the ring when it starts inside a quantum.
    early_ = -1;
    int moving = 0;
    for (int i = 0; i < sequenceCount_ && CHROMIUM_FIRST_QUANTUM; ++i) {
        const Node& node = nodes_[sequence_[i]];
        const auto moves = [&](int w) { return node.slot[w] >= 0 && params_[node.slot[w]].hasTimeline(); };
        if (node.kind != source || !(moves(0) || moves(1))) continue;
        if (++moving > 1) return false;
        const int offset = static_cast<int>((quantum + node.start) % 128);
        if (offset == 0) continue;
        early_ = sequence_[i];
        earlyOffset_ = offset;
        for (int w = 0; w < 2; ++w) // before the tone's time 0: the timeline's value is the intrinsic one, and nothing sounds into an input
            if (moves(w)) std::fill(earlyValues_[w], earlyValues_[w] + 128, params_[node.slot[w]].value);
    }
    return true;
}

void SynthTone::process(int n, int count, Scratch& s) {
    Node& node = nodes_[n];
    float* out[2] = { s.block[n][0], s.block[n][1] };
    // a param's values over the frames: per frame (into s.values) while it has a timeline or an input, else its one value
    bool moving[2] = { false, false };
    const float* values[2] = { &node.constant[0], &node.constant[1] };
    for (int w = 0; w < 2; ++w) {
        if (node.slot[w] < 0) continue;
        Param& p = params_[node.slot[w]];
        if (!p.hasTimeline()) { values[w] = &p.value; continue; }
        p.values(count, p.input >= 0 ? s.block[p.input][0] : nullptr, s.values[w]);
        values[w] = s.values[w];
        moving[w] = true;
    }
    if (n == early_ && age < node.start + 128 - earlyOffset_) { // the first quantum of an a-rate oscillator (CHROMIUM_FIRST_QUANTUM)
        const long long first = node.start - earlyOffset_; // the quantum's first frame: its values are kept, then handed on
        for (int w = 0; w < 2; ++w) {
            if (!moving[w]) continue;
            float* v = s.values[w];
            for (int i = 0; i < count; ++i) if (age + i >= first && age + i < first + 128) earlyValues_[w][age + i - first] = v[i];
            for (int i = 0; i < count; ++i) if (age + i >= node.start && age + i < node.start + 128 - earlyOffset_) v[i] = earlyValues_[w][age + i - node.start];
        }
    }
    if (node.kind == source || node.kind == buffered) { // silent outside [start, stop)
        const int from = static_cast<int>(std::clamp(node.start - age, 0LL, static_cast<long long>(count)));
        const int to = static_cast<int>(std::clamp(node.stop - age, static_cast<long long>(from), static_cast<long long>(count)));
        std::fill(out[0], out[0] + from, 0.0f);
        std::fill(out[0] + to, out[0] + count, 0.0f);
        if (node.kind == source && to > from) {
            if (!moving[0] && !moving[1]) node.oscillator.constant(*values[0], *values[1], out[0] + from, to - from, node.stop - (age + from));
            else node.oscillator.moving(moving[0] ? values[0] + from : values[0], moving[1] ? values[1] + from : values[1], moving[0], moving[1], out[0] + from, to - from);
        }
        // rate 1: on a whole read index the buffer's frames (ProcessFastPath), between two ProcessInterpolatedPath's linear interpolation in
        // double, the second sample across the loop's end its first frame, at the end without a loop the last one (extrapolated from the two
        // last); the index moves on by 1.0 and keeps its part of a frame (a quantum takes the fast path exactly when that part is 0)
        for (int i = from; node.kind == buffered && i < to; ++i) {
            if (node.read >= node.frames) { out[0][i] = 0.0f; continue; } // the end without a loop
            const auto k = static_cast<long long>(node.read);
            const double f = node.read - static_cast<double>(k);
            if (f == 0) out[0][i] = node.data[k];
            else {
                const long long k2 = k + 1 < node.frames ? k + 1 : node.loop ? static_cast<long long>(node.read + 1.0 - node.frames) : k;
                const double s1 = node.data[k == k2 && k >= 1 ? k - 1 : k], s2 = node.data[k2];
                out[0][i] = static_cast<float>(k == k2 && k >= 1 ? s2 + (s2 - s1) * f : (1.0 - f) * s1 + f * s2);
            }
            node.read += 1.0;
            if (node.read >= node.frames && node.loop) node.read -= node.frames;
        }
        return;
    }
    // the inputs summed; a mono one goes into both channels of a stereo node
    for (int c = 0; c < node.channels; ++c) std::fill(out[c], out[c] + count, 0.0f);
    for (int i = 0; i < nodeCount_; ++i) {
        if (!(node.inputs >> i & 1u)) continue;
        for (int c = 0; c < node.channels; ++c) {
            const float* in = s.block[i][nodes_[i].channels == 1 ? 0 : c];
            for (int k = 0; k < count; ++k) out[c][k] += in[k];
        }
    }
    switch (node.kind) {
        case amp:
            for (int c = 0; c < node.channels; ++c) {
                if (moving[0]) for (int k = 0; k < count; ++k) out[c][k] *= values[0][k];
                else for (int k = 0; k < count; ++k) out[c][k] *= values[0][0];
            }
            break;
        case filter: {
            const double sr = basic->rate;
            for (int k = 0; k < count; ++k) {
                const float hz = moving[0] ? values[0][k] : values[0][0], q = moving[1] ? values[1][k] : values[1][0];
                if (hz != node.hz || q != node.q) { // a param moved (or the first frame): the coefficients of this frame
                    node.hz = hz;
                    node.q = q;
                    const Biquad f = node.type == Filter::lowpass ? lowpassOf(hz, q, sr) : node.type == Filter::highpass ? highpassOf(hz, q, sr) : bandpassOf(hz, q, sr);
                    for (Biquad& b : node.state) { b.b0 = f.b0; b.b1 = f.b1; b.b2 = f.b2; b.a1 = f.a1; b.a2 = f.a2; }
                }
                for (int c = 0; c < node.channels; ++c) out[c][k] = node.state[c].step(out[c][k]);
            }
            break;
        }
        case panning: // the input is mono, in both channels now
            for (int k = 0; k < count; ++k) { out[1][k] *= node.gainRight; out[0][k] *= node.gainLeft; }
            break;
        default: break;
    }
}

void SynthTone::render(float* left, float* right, int count, Scratch& s) {
    for (; count > SYNTH_FRAMES; count -= SYNTH_FRAMES, left += SYNTH_FRAMES, right += right ? SYNTH_FRAMES : 0) render(left, right, SYNTH_FRAMES, s); // the scratch's length
    if (!active) return;
    if (!ordered_ && !overflow_) { ordered_ = true; overflow_ = !order(); }
    if (overflow()) { active = false; return; }
    const int skip = std::min(delay, count); // the frames of the chunk before the tone's time 0
    delay -= skip;
    const int n = static_cast<int>(std::clamp(end + SYNTH_FRAMES - age, 0LL, static_cast<long long>(count - skip)));
    for (int i = 0; i < sequenceCount_; ++i) process(sequence_[i], n, s);
    const Node& o = nodes_[out_];
    const float* l = s.block[out_][0];
    const float* r = s.block[out_][o.channels - 1];
    for (int i = 0; i < n && active; ++i) {
        if (releaseLeft_ > 0) { releaseGain_ *= releaseMul_; if (--releaseLeft_ == 0) active = false; } // its last frame still sounds
        // a choked tone ends at 1e-7, as Tone (sampler.cpp)
        if (chokeIn == 0) { chokeGain *= chokeMul; if (chokeGain < 1e-7) active = false; }
        else if (chokeIn > 0) --chokeIn;
        const double g = chokeGain * releaseGain_;
        left[skip + i] += static_cast<float>(l[i] * g) * panLeft;
        if (right) right[skip + i] += static_cast<float>(r[i] * g) * panRight;
    }
    age += n;
    if (delay == 0 && age >= end + SYNTH_FRAMES) active = false;
}

SynthTone& Tones::startSynth(Engine::Layer layer, double delay, uint64_t voice, double releaseSeconds) {
    SynthTone* tone = &synth[0];
    for (SynthTone& t : synth) {
        if (!t.active) { tone = &t; break; }
        if (t.serial < tone->serial) tone = &t; // all busy: the oldest goes
    }
    *tone = SynthTone {};
    tone->active = true;
    tone->serial = ++serial;
    tone->voice = voice;
    tone->layer = layer;
    tone->gen = gen[layer];
    const double at = delay + late;
    tone->delay = static_cast<int>(at);
    tone->late = at - tone->delay;
    tone->releaseSeconds = releaseSeconds;
    tone->basic = basic;
    tone->quantum = (quantum + tone->delay) % 128;
    tone->firstQuantum = std::max(0, firstQuantum - tone->delay);
    return *tone;
}

int Tones::takeChain() {
    if (!chains[0].prepared()) return -1;
    int taken = -1;
    for (int i = 0; i < CHAINS && taken < 0; ++i) if (!chains[i].live || (chains[i].orphan && !chains[i].busy())) taken = i;
    if (taken < 0) { // all busy: the oldest orphan goes (with one voice instance holding one, the others are orphans)
        const auto rank = [&](int k) { return std::pair(!chains[k].orphan, chains[k].serial); };
        for (int i = 0; i < CHAINS; ++i) if (taken < 0 || rank(i) < rank(taken)) taken = i;
        for (SynthTone& t : synth) if (t.active && t.bus >= 0 && t.bus / 3 == taken) t.active = false; // they would play into the new chain: cut
    }
    chains[static_cast<size_t>(taken)].live = false;
    return taken;
}

std::vector<float> synthNoise(double sampleRate) { return noiseBuffer(Rng(1).fork("noise"), 1, 1, 0, sampleRate)[0]; }

} // namespace btg::detail
