#pragma once

// One synth tone: a fixed graph of Web Audio nodes that a voice's play() builds the way its JavaScript builds it (phase-5-design.md 3), with
// Chromium's oscillator (osc.h), AudioParam timeline (param.h), BiquadFilterNode, AudioBufferSourceNode, GainNode and StereoPannerNode
// (patch.cpp names the files). Building and rendering allocate nothing, lock nothing and throw nothing; a graph larger than the fixed sizes
// is not built: the tone carries the overflow flag and stays silent.

#include "btg/engine.h"
#include "osc.h"
#include "param.h"
#include "sampler.h"
#include "voices/organ_chain.h"

#include <array>
#include <cstdint>
#include <vector>

namespace btg::detail {

constexpr int NODES = 16, PARAMS = 6; // the pad's tone has 16 nodes; the e-piano's takes 5 params (amp, carrier, depth, bell, tremolo)
// The most frames one render() takes: the engine's chunk (engine.cpp CHUNK, which asserts that the two are equal).
constexpr int SYNTH_FRAMES = 256;
static_assert(SYNTH_FRAMES == CHAIN_FRAMES, "an organ chain processes the chunk its tones rendered");
constexpr int CHAINS = 4; // organ chain slots (phase 5 ruling 2): one voice instance's and three ringing out

enum class Filter : uint8_t { lowpass, highpass, bandpass }; // the BiquadFilterNode types of the synth voices

struct SynthTone {
    struct Scratch { float block[NODES][2][SYNTH_FRAMES]; float values[2][SYNTH_FRAMES]; }; // every node's output over the chunk; a node's params
    bool active = false; uint64_t serial = 0, voice = 0; Engine::Layer layer = Engine::drums;
    uint8_t gen = 0;                                    // its layer's chain generation at its start, as Tone::gen
    int bus = -1;                                       // -1: the layer's buffer; else the entry bus % 3 of Tones::chains[bus / 3] (the organ)
    int delay = 0;                                      // frames until its time 0 (the event's place in the chunk), as Tone::delay
    float panLeft = 1, panRight = 1;                    // the kit's balance (drums synth), as Tone
    double chokeGain = 1, chokeMul = 1, releaseSeconds = 0; long long chokeIn = -1; // stop; a jump falls over releaseSeconds
    long long age = 0, end = 0; // frames since time 0; the last source's stop: inactive one chunk (SYNTH_FRAMES) after it
    const BasicWaves* basic = nullptr; // the basic waves at the engine's rate, for osc(Wave, ...)
    int quantum = 0;            // the place of time 0 in its render quantum (Tones::startSynth); set before the graph is built

    // Each returns the node (-1 when the graph is full). Times are frames from the tone's time 0 (a stop of infinity: no stop); hz, cents,
    // value, q, pan the params' values before any event. An oscillator's hz is the node's frequency value, not its first event's: where the
    // JavaScript sets no `.value` (drums.js, percussion.js), the AudioParam's default 440, which Chromium's first quantum plays on before
    // the start. One input per param and one output per tone: where the web connects several nodes to a param or to `out`, a voice sums
    // them in a gain, which costs a node (the pad's tone uses 16 of 16).
    int osc(Wave wave, float hz, float cents, double start, double stop);
    int osc(const WaveTables& wave, float hz, float cents, double start, double stop); // the caller keeps `wave` alive while the tone can play
    int buffer(const float* data, int frames, double offset, bool loop, double start, double stop); // offset in frames of the buffer, rate 1;
                                                                                                     // the caller keeps `data` alive, as `wave`
    int gain(float value);
    int biquad(Filter type, float hz, float q);
    int panner(float pan);                    // a constant pan of a mono input
    Param& param(int node, int which = 0);    // osc: frequency, detune; gain: gain; biquad: frequency, Q
    void connect(int from, int to);           // a node sums its inputs; a mono input into a stereo node goes to both channels
    void modulate(int from, Param& p);        // `from` (mono) added to p at audio rate
    void output(int node);                    // the node the tone plays
    void choke(long long inFrames, double tc, double sr); // inFrames from the tone's own start, as Tone::choke; ends at 1e-7
    void release(double sr);                  // falls to 1e-4 over releaseSeconds, then ends
    void render(float* left, float* right, int count, Scratch&); // adds count frames, in calls of at most SYNTH_FRAMES; node by node;
                                                                 // right nullptr: the left channel alone (an organ chain's entry)
    bool overflow() const;                    // the graph asked for more than the fixed sizes, or was not wired right: silent

private:
    enum Kind : uint8_t { source, buffered, amp, filter, panning };
    struct Node {
        Kind kind = amp;
        Filter type = Filter::lowpass;
        uint8_t channels = 1;
        int slot[2] = { -1, -1 };      // the param slot of each of the node's params, -1: the constant
        float constant[2] = {};
        uint32_t inputs = 0;           // one bit per node
        long long start = 0, stop = 0; // sources: the frames, rounded up as Chromium does
        Oscillator oscillator;
        const float* data = nullptr;   // buffer
        int frames = 0;
        long long read = 0;
        bool loop = false;
        Biquad state[2];               // biquad: coefficients and the state per channel
        float hz = 0.0f, q = 0.0f;     // the values the coefficients are for (NaN: none yet)
        float gainLeft = 0.0f, gainRight = 0.0f; // panner
    };
    int add(Kind kind);
    bool order();
    void process(int node, int count, Scratch& s);
    Node nodes_[NODES];
    Param params_[PARAMS], spare_;     // spare_: what param() gives when the slots are full
    int nodeCount_ = 0, paramCount_ = 0, out_ = -1;
    int sequence_[NODES] = {}, sequenceCount_ = 0;
    bool overflow_ = false, ordered_ = false;
    double releaseGain_ = 1, releaseMul_ = 1;
    long long releaseLeft_ = -1;
    // Chromium's first quantum of an a-rate oscillator (patch.cpp, CHROMIUM_FIRST_QUANTUM): the one oscillator of the tone that needs it
    // (-1 none), its place in that quantum, and its frequency's and detune's values from the quantum's first frame on. A second one
    // overflows the tone.
    int early_ = -1, earlyOffset_ = 0;
    float earlyValues_[2][128] = {};
};

// The pool of tones of all layers: the sample tones and, as many, the synth tones (phase-5-design.md 3).
struct Tones {
    std::array<Tone, TONES> all;
    std::array<SynthTone, TONES> synth;
    SynthTone::Scratch scratch;        // shared by the synth tones: they render one after the other
    uint64_t serial = 0;               // of the last tone started, in either pool
    double sr = 48000.0;
    const BasicWaves* basic = nullptr; // the basic waves at sr (Engine::prepare); every synth tone gets them
    int quantum = 0;                   // the place of the chunk's first frame in its render quantum: frames since the play began, mod 128
    uint8_t gen[Engine::layerCount] = {}; // per layer, the generation of its chains (0 or 1) a tone started now rings through (engine.cpp)
    std::array<OrganChain, CHAINS> chains; // the organ chains of the voice instances (VoiceState::chain) and of those that ring out
    std::vector<float> noise;          // synthNoise(sr) (Engine::prepare)

    Tone* start(const Note& n);
    // A free synth tone, else the oldest (as start), emptied and active, its time 0 `delay` frames into the chunk (and its place in the
    // quantum from there); a jump lets it fall over releaseSeconds (every voice gives its own: 0 would cut it in one frame). The voice then
    // builds its graph.
    SynthTone& startSynth(Engine::Layer layer, int delay, uint64_t voice, double releaseSeconds);
    // A chain slot for a new organ chain, which the voice then starts: one that is not live, else one whose orphan has rung out, else the
    // oldest orphan, whose tones are cut (all four busy: a voice instance and three that ring out, which takes four voice changes or starts
    // within about 0.3 s after the old tones' ends; with one organ layer every other busy chain is an orphan then, without one the oldest
    // chain goes); -1 before the chains are prepared.
    int takeChain();
};

// Control thread (allocates): the synth voices' noise at `sampleRate`, synth.js 60: noiseBuffer(ctx, createRng(1).fork('noise'), 1), one
// second, mono. Engine::prepare, btg_fx (voice-compare.mjs) and the tests make Tones::noise with it.
std::vector<float> synthNoise(double sampleRate);

} // namespace btg::detail
