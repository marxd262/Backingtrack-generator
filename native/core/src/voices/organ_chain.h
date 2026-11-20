#pragma once

// The chain one organ voice instance keeps for all its tones: src/audio/voices/organ.js `build` and the lines of its returned function that
// set the chain, and organ-leslie.js. Its tones enter at three places (the wheels into `pre`, the key clicks through their highpass, the
// percussion through its envelope); then the swell pedal, the clean path beside the tube preamp, the Leslie, the level; two channels out.
// Its params are AudioParams on the chain's own clock, its LFOs Chromium's oscillators on a custom wave (organ_chain.cpp names the files).
// Four of them live in Tones (patch.h) as slots, allocated with the engine; a voice instance (VoiceState::chain) holds one. No allocation,
// no lock, no throw once prepared.

#include "btg/engine.h"
#include "../guitar_fx.h"
#include "../mod_fx.h"
#include "../osc.h"

#include <cmath>
#include <cstdint>

namespace btg::detail {

constexpr int CHAIN_FRAMES = 256; // the most frames one process() takes: the engine's chunk (patch.h asserts that the two are equal)

// One AudioParam of the chain: its node's default, then setValueAtTime and setTargetAtTime at frames of the chain's clock (each at or after
// the frame computed last), one value per frame as audio_param_handler.cc computes it: a setTarget starts from the value it finds, goes on by
// the float recursion and is tested for convergence where Chromium tests it, at its own first frame and at each render quantum's.
struct ChainParam {
    float value = 0.0f;  // the value of the frame computed last: the node's default before the first event
    double applied = NAN; // organ.js set(): the value set() scheduled last
    bool overflow = false; // more events were waiting than it holds: the later ones were dropped
    void reset(float initial);
    void setValueAtTime(float v, long long frame);
    void setTargetAtTime(float v, long long frame, double tcSeconds, double sampleRate);
    void set(double v, long long frame) { if (!(applied == v)) { applied = v; setValueAtTime(static_cast<float>(v), frame); } } // a change only
    float next(long long frame, bool quantumStart); // the value of `frame`, the frame after the one before
    // HasSampleAccurateValues for the render quantum that begins at `frame`, with the events scheduled so far; remove: HandleAllEventsInThePast
    // at that quantum (once per quantum, before its first value): the events whose time has passed are given up when nothing is left to run.
    bool sampleAccurate(long long frame, bool remove);

private:
    struct Event { long long frame; float v, tc; bool target; }; // tc: the time constant in seconds, a float as ProcessSetTarget takes it
    static constexpr int PENDING = 8;
    Event pending_[PENDING] = {};
    int count_ = 0;
    Event now_ {};           // the event whose part of the timeline the frames are in
    bool listed_ = false;    // Chromium still lists it (it removes it once it lies 1.5 quanta in the past and, a setTarget, has converged)
    bool approaching_ = false;
    float step_ = 0.0f;
    double rate_ = 48000.0;
    void insert(const Event& e);
};

// The fine values of organ-leslie.js a tone reads (tunables.js): leslie (0 off, 1 the event's field, 2 slow, 3 fast) and per rotor (horn,
// drum) its speeds, inertia, amplitude modulation and Doppler depth; the crossover.
struct LeslieValues { double leslie, slow[2], fast[2], up[2], down[2], am[2], doppler[2], crossover; };

class OrganChain {
public:
    enum Bus { wheels, clicks, percussion }; // the entries, as SynthTone::bus % 3
    float in[3][CHAIN_FRAMES] = {};          // what the tones of this chunk rendered into each entry (mono)
    bool live = false;   // started and not given up (Tones::takeChain frees it)
    bool orphan = false; // no voice instance holds it any more (Engine: a restart, a new voice): it rings out and is then free
    bool heard = false;  // a tone rendered into it in this chunk
    Engine::Layer layer = Engine::chords;
    uint8_t gen = 0;     // its layer's chain generation at its start: it plays into that generation's buffer
    uint64_t serial = 0; // in the order of starts, shared with the tones' (Tones::serial)
    long long age = 0;   // its clock: frames from the first frame of the chunk it was started in
    // organ.js's chain object, in frames of its clock: dead (no LFO runs after it: a later tone builds the chain anew), held (the latest key
    // end, percussionGate), pedal (the swell's last value, NaN: none yet), and the Leslie's rotor speeds (NaN: none yet)
    double dead = 0.0, held = -INFINITY, pedal = NAN, rotorHz[2] = { NAN, NAN };
    ChainParam level, swell, clean, driveIn, driveOut, percEnv;

    void prepare(double sampleRate); // the four Leslie delays (allocates: Engine::prepare), the curve and the fixed filters
    bool prepared() const;
    // build(): every state empty, every param at its node's default, the LFOs (on these waves: [rotor][mic]) starting `delay` frames into the
    // current chunk, whose first frame lies `quantum` frames into its render quantum
    void start(Engine::Layer layer, uint8_t gen, uint64_t serial, int delay, int quantum, const WaveTables* const lfo[2][2]);
    void tune(const LeslieValues& v, long long frame);            // organ-leslie.js tune()
    void speed(bool fast, const LeslieValues& v, long long frame); // organ-leslie.js speed()
    void clear(int count); // the entries silent and heard false, at every chunk's start
    // The chunk: adds the chain's output to left and right (the buffer of its layer and generation); `quantum`: the place of the chunk's
    // first frame in its render quantum. Its clock then moves on.
    void process(float* left, float* right, int count, int quantum);
    // A tone rendered into it in this chunk or its tail has not passed: TAIL frames after the last such chunk, by then the Leslie's delays
    // and the preamp's shaper hold nothing of its tones and the 20 Hz highpass behind it has rung out (organ_chain.cpp)
    bool busy() const { return live && (heard || quietFor_ < tail_); }
    bool overflow() const; // a param had more events waiting than it holds (a tool or a test reports it)

private:
    double rate_ = 48000.0;
    int tail_ = 0, quietFor_ = 0;
    ChainParam dry_, wet_, crossover_[2], am_[2], doppler_[2], delayTime_[2], speed_[2]; // per rotor; its two mics and bands share them
    Biquad clicks_, dc_, band_[2][2];      // the clicks' highpass, the preamp's; per rotor the two crossover filters
    float bandHz_[2] = {};                 // the frequency the crossover's coefficients are for
    Shaper shaper_;
    ModDelay delay_[2][2];                 // [rotor][mic]
    Oscillator lfo_[2][2];
    long long lfoStart_ = 0;               // the frame the LFOs start at (organ-leslie.js 36: lfo.start(t0))
    int lfoOffset_ = 0;                    // its place in its render quantum
    float early_[2][128] = {};             // per rotor, Chromium's first quantum of the LFOs: the frequency from the quantum's first frame on
    bool aRate_[2] = {};                   // per rotor, the path of the current render quantum: a-rate (sample-accurate frequency) or k-rate
    float hz_[2][CHAIN_FRAMES] = {}, wave_[2][2][CHAIN_FRAMES] = {};
};

} // namespace btg::detail
