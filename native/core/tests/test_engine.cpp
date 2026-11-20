#include "btg/engine.h"
#include "btg/generator.h"
#include "btg/pack.h"
#include "btg/transport.h"

#include "../src/compressor.h"
#include "../src/convolver.h"
#include "../src/echo.h"
#include "../src/mod_fx.h"
#include "../src/patch.h"
#include "../src/sampler.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <complex>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <new>
#include <stdexcept>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

static int failures = 0;
#define CHECK(cond) \
    do { if (!(cond)) { std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); ++failures; } } while (0)

// Ruling 14: the allocations and frees of the program counted while `counting` is on (the render calls of the check "no allocation in
// render" below): the plain forms are replaced, the array and nothrow forms reach them by the standard's defaults; the aligned forms
// (std::align_val_t) are not counted (nothing in render allocates over-aligned). One thread: the tests render on the calling thread.
static bool counting = false;
static long allocations = 0, frees = 0;
void* operator new(std::size_t size) {
    if (counting) ++allocations;
    if (void* p = std::malloc(size ? size : 1)) return p;
    throw std::bad_alloc();
}
void operator delete(void* p) noexcept {
    if (counting && p) ++frees;
    std::free(p);
}
void operator delete(void* p, std::size_t) noexcept { operator delete(p); }

static const int rate = 48000;
static const char* DRY = R"({"master":{"reverb":0,"echo":0,"roomWet":0}})";

// A kit and a bass built in memory: decaying noise for the hits, a looped sine for the bass.
static std::shared_ptr<const btg::Pack> kit() {
    auto pack = std::make_shared<btg::Pack>();
    pack->version = 2;
    pack->channels = 2;
    const char* names[] = { "kick", "snare", "hat", "openHat", "tomHigh", "tomMid", "tomLow", "crash" };
    unsigned int noise = 1;
    for (int k = 0; k < 8; ++k) {
        pack->keys[names[k]] = 36 + k;
        pack->samples.push_back({ k * 8000, 8000, 44100.0, 0, 0 });
        for (int i = 0; i < 8000; ++i) {
            noise = noise * 1664525u + 1013904223u;
            const float x = (static_cast<float>(noise >> 8) / 8388608.0f - 1.0f) * std::exp(-i / 1500.0f);
            pack->audio.push_back(x);
            pack->audio.push_back(x);
        }
        btg::Pack::Zone zone;
        zone.keyLo = zone.keyHi = zone.rootKey = 36 + k;
        zone.sample = k;
        zone.release = 0.04;
        pack->zones.push_back(zone);
    }
    return pack;
}
// A format-1 kit (no key table of its own): every GM key of HIT_KEYS.drums has a zone with decaying noise, mono.
static std::shared_ptr<const btg::Pack> gmKit() {
    auto pack = std::make_shared<btg::Pack>();
    const int keys[] = { 36, 38, 42, 46, 50, 47, 43, 49, 37, 44 };
    unsigned int noise = 7;
    for (int k = 0; k < 10; ++k) {
        pack->samples.push_back({ k * 8000, 8000, 22050.0, 0, 0 });
        for (int i = 0; i < 8000; ++i) {
            noise = noise * 1664525u + 1013904223u;
            pack->audio.push_back((static_cast<float>(noise >> 8) / 8388608.0f - 1.0f) * std::exp(-i / 1500.0f));
        }
        btg::Pack::Zone zone;
        zone.keyLo = zone.keyHi = zone.rootKey = keys[k];
        zone.sample = k;
        zone.release = 0.04;
        pack->zones.push_back(zone);
    }
    return pack;
}
// The kit of the choke tests: every GM key plays a constant (DC) sample of 40000 frames, so a choke shows as the frame where the level falls.
// Format 2 brings its key table; format 1 gets it from sound.json.
static std::shared_ptr<const btg::Pack> dcKit(bool v2) {
    auto pack = std::make_shared<btg::Pack>();
    pack->version = v2 ? 2 : 1;
    const char* names[] = { "kick", "snare", "hat", "openHat", "tomHigh", "tomMid", "tomLow", "crash", "sideStick", "hatPedal" };
    const int keys[] = { 36, 38, 42, 46, 50, 47, 43, 49, 37, 44 };
    for (int k = 0; k < 10; ++k) {
        pack->keys[names[k]] = keys[k];
        pack->samples.push_back({ k * 40000, 40000, 48000.0, 0, 0 });
        pack->audio.insert(pack->audio.end(), 40000, 1.0f);
        btg::Pack::Zone zone;
        zone.keyLo = zone.keyHi = zone.rootKey = keys[k];
        zone.sample = k;
        pack->zones.push_back(zone);
    }
    return pack;
}
// A looped sine of `period` frames (200, or 10 for a tone above the timbre's lowpass of 400 Hz); the loop holds a whole number of
// periods (20000 / period), so the seam does not click.
static std::shared_ptr<const btg::Pack> tonePack(int rootKey, float amplitude, double release, int period = 200) {
    auto pack = std::make_shared<btg::Pack>();
    pack->samples.push_back({ 0, 22050, 22050.0, 1000, 21000 });
    for (int i = 0; i < 22050; ++i) pack->audio.push_back(amplitude * static_cast<float>(std::sin(2 * 3.14159265358979 * i / period)));
    btg::Pack::Zone zone;
    zone.rootKey = rootKey;
    zone.loop = true;
    zone.hold = 4;
    zone.release = release;
    pack->zones.push_back(zone);
    return pack;
}
// tonePack(57, 0.3, 0.3) in two channels (Task 20b): its sine of 200 frames on the left, one of 160 on the right, so that the layer's chains run
// in two (Voice::stereo); each channel's samples are those of the mono pack of its period.
static std::shared_ptr<const btg::Pack> stereoTone() {
    const auto left = tonePack(57, 0.3f, 0.3, 200), right = tonePack(57, 0.3f, 0.3, 160);
    auto pack = std::make_shared<btg::Pack>(*left);
    pack->channels = 2;
    pack->audio.clear();
    for (size_t i = 0; i < left->audio.size(); ++i) { pack->audio.push_back(left->audio[i]); pack->audio.push_back(right->audio[i]); }
    return pack;
}
// A format-1 hit pack whose one zone answers every key (the percussion of the tempo test): decaying noise, mono.
static std::shared_ptr<const btg::Pack> anyKey() {
    auto pack = std::make_shared<btg::Pack>();
    pack->samples.push_back({ 0, 8000, 22050.0, 0, 0 });
    unsigned int noise = 11;
    for (int i = 0; i < 8000; ++i) {
        noise = noise * 1664525u + 1013904223u;
        pack->audio.push_back((static_cast<float>(noise >> 8) / 8388608.0f - 1.0f) * std::exp(-i / 1500.0f));
    }
    btg::Pack::Zone zone; // keys 0 to 127
    zone.release = 0.04;
    pack->zones.push_back(zone);
    return pack;
}
// The packs of the tests by id; any other id is missing, as the shell's source would say.
static std::shared_ptr<const btg::Pack> source(const std::string& id) {
    if (id == "drums-naked") return kit();
    if (id == "drums-brushes") return gmKit();
    if (id == "bass-finger" || id == "bass-upright") return tonePack(45, 0.5f, 0.2);
    if (id == "bass-pick") return tonePack(45, 0.25f, 0.2);
    if (id == "pad-strings") return tonePack(57, 0.5f, 4.0); // the engine caps the release at 2 s
    if (id == "chords-funk") return tonePack(57, 0.3f, 0.3);
    if (id == "lead-flute") return tonePack(69, 0.3f, 0.2);
    if (id == "percussion-studio") return anyKey();
    throw std::runtime_error("not in the test: " + id);
}

// |H| in dB of a biquad at `hz`.
static double gainDb(const btg::detail::Biquad& f, double hz, double sr) {
    const std::complex<double> z = std::polar(1.0, -2 * 3.14159265358979 * hz / sr); // e^-jw
    return 20 * std::log10(std::abs((f.b0 + f.b1 * z + f.b2 * z * z) / (1.0 + f.a1 * z + f.a2 * z * z)));
}

struct Result { std::vector<float> left, right; double rms = 0.0, peak = 0.0, rmsRight = 0.0; bool finite = true; };

static double rmsOf(const std::vector<float>& x, size_t from, size_t to) {
    double squares = 0.0;
    for (size_t i = from; i < to; ++i) squares += static_cast<double>(x[i]) * x[i];
    return std::sqrt(squares / static_cast<double>(to - from));
}

// One note (midi `midi`, velocity 1, `seconds` long, one beat a second) of the voice `layer` builds with `timbre` from `pack`, rendered
// on the left for `frames` frames: the voice alone, no engine.
static std::vector<float> noteOf(btg::Engine::Layer layer, const char* key, std::shared_ptr<const btg::Pack> pack, const btg::detail::Timbre& timbre, int midi, double seconds, int frames, const char* tuning = "{}") {
    using namespace btg::detail;
    const auto voice = makeVoice(layer, key, std::move(pack), parseTuning(tuning), timbre);
    auto tones = std::make_unique<Tones>();
    tones->sr = rate;
    VoiceState state;
    state.rng = voice->startRng;
    PlayEvent e;
    e.layer = layer;
    e.midi = midi;
    e.vel = 1.0;
    e.durBeats = seconds;
    voice->play(e, 0, 1.0, state, *tones);
    std::vector<float> left(static_cast<size_t>(frames)), right(static_cast<size_t>(frames));
    for (Tone& t : tones->all) if (t.active) t.render(left.data(), right.data(), frames);
    return left;
}

// The envelope of a note in windows of 48 frames: the time to half its highest level and the time from the note's end (`noteEnd` s)
// until it has fallen to a tenth of it.
struct Envelope { double rise, fall; };
static Envelope envelopeOf(const std::vector<float>& x, double noteEnd) {
    const size_t win = 48;
    std::vector<float> peaks;
    for (size_t at = 0; at + win <= x.size(); at += win) peaks.push_back(*std::max_element(x.begin() + static_cast<long>(at), x.begin() + static_cast<long>(at + win), [](float a, float b) { return std::fabs(a) < std::fabs(b); }));
    for (float& p : peaks) p = std::fabs(p);
    float sustain = 0.0f;
    for (size_t i = 0; i < static_cast<size_t>(noteEnd * rate) / win; ++i) sustain = std::max(sustain, peaks[i]);
    Envelope r { -1.0, -1.0 };
    for (size_t i = 0; i < peaks.size() && r.rise < 0; ++i) if (peaks[i] >= 0.5f * sustain) r.rise = static_cast<double>(i * win) / rate;
    for (size_t i = static_cast<size_t>(noteEnd * rate) / win; i < peaks.size() && r.fall < 0; ++i) if (peaks[i] < 0.1f * sustain) r.fall = static_cast<double>(i * win) / rate - noteEnd;
    return r;
}

static Result render(btg::Engine& engine, btg::Transport& transport, double seconds, int blockSize, int sampleRate = rate) {
    Result r;
    std::vector<float> l(blockSize), rr(blockSize);
    for (int done = 0; done < seconds * sampleRate;) {
        const auto block = transport.advance(blockSize, sampleRate);
        engine.render(l.data(), rr.data(), block.frames, block);
        for (int i = 0; i < block.frames; ++i) {
            r.left.push_back(l[i]);
            r.right.push_back(rr[i]);
            r.rms += l[i] * l[i];
            r.rmsRight += rr[i] * rr[i];
            r.peak = std::max(r.peak, static_cast<double>(std::max(std::fabs(l[i]), std::fabs(rr[i]))));
            r.finite = r.finite && std::isfinite(l[i]) && std::isfinite(rr[i]);
        }
        done += block.frames;
    }
    r.rms = std::sqrt(r.rms / static_cast<double>(r.left.size()));
    r.rmsRight = std::sqrt(r.rmsRight / static_cast<double>(r.left.size()));
    return r;
}

// The organ outside an engine (Task 20): Tones at `sr` as Engine::prepare makes them for it (the basic waves, the noise, the chains' delays),
// and one chunk as the engine's chunk loop plays it: the synth tones into their chains' entries (the others into slot 0's channels), then
// every live chain into the two channels of its own slot, frames at to at + count of out[slot]; the render quantum moves on.
using Slots = std::vector<float>[btg::detail::CHAINS][2];
static std::unique_ptr<btg::detail::Tones> organTones(double sr) {
    using namespace btg::detail;
    auto tones = std::make_unique<Tones>();
    tones->sr = sr;
    tones->basic = &basicWaves(sr);
    tones->noise = noiseBuffer(Rng(1).fork("noise"), 1, 1, 0, sr)[0];
    for (OrganChain& c : tones->chains) c.prepare(sr);
    return tones;
}
static void organChunk(btg::detail::Tones& tones, size_t at, int count, Slots& out) {
    using namespace btg::detail;
    for (OrganChain& c : tones.chains) if (c.live) c.clear(count);
    for (SynthTone& t : tones.synth) {
        if (!t.active) continue;
        if (t.bus < 0) { t.render(&out[0][0][at], &out[0][1][at], count, tones.scratch); continue; }
        OrganChain& c = tones.chains[static_cast<size_t>(t.bus / 3)];
        c.heard = true;
        t.render(c.in[t.bus % 3], nullptr, count, tones.scratch);
    }
    for (int s = 0; s < CHAINS; ++s) if (tones.chains[s].live) tones.chains[s].process(&out[s][0][at], &out[s][1][at], count, tones.quantum);
    tones.quantum = (tones.quantum + count) % 128;
}

int main(int argc, char** argv) {
    // The organ's waves (Task 20; organ.js waveFor, built at makeVoice for every key, rawWave keeping only the ranges a key's tone reads),
    // first, so that the cache is cold: every key 0 to 127 of the four presets reads at its wheels' frequency (as Oscillator::constant
    // computes it) the same pair of tables and the same crossfade as from a full build of its partials (customWave: every range), bit for
    // bit, at 48, 96 and 44.1 kHz, and a second build of the voice reads the same tables. Printed: what the cache grew by and what makeVoice
    // took, cold (the preset's first voice at the rate; the first at a rate also builds the Leslie's LFO waves) and warm.
    {
        using namespace btg::detail;
        for (const double sr : { 48000.0, 96000.0, 44100.0 }) {
            for (const char* preset : { "jazz", "rock", "gospel", "ballad" }) {
                const std::string key = std::string("chords/organ/") + preset;
                const size_t before = rawWaveBytes();
                auto began = std::chrono::steady_clock::now();
                const auto voice = makeVoice(btg::Engine::chords, key, nullptr, {}, Timbre {}, sr);
                const double cold = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - began).count();
                const size_t grew = rawWaveBytes() - before;
                began = std::chrono::steady_clock::now();
                const auto again = makeVoice(btg::Engine::chords, key, nullptr, {}, Timbre {}, sr);
                const double warm = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - began).count();
                int same = 0;
                for (int midi = 0; midi < 128; ++midi) {
                    const OrganKey k = organKey(*voice, midi);
                    if (!k.wave || organKey(*again, midi).wave != k.wave) continue;
                    const auto full = customWave(k.real.data(), k.imag.data(), 17, sr, true);
                    const float f = std::clamp(k.hz * std::exp2(k.cents / 1200), -full->rate / 2, full->rate / 2);
                    const float* lower[2];
                    const float* higher[2];
                    float factor[2];
                    k.wave->pair(f, lower[0], higher[0], factor[0]);
                    full->pair(f, lower[1], higher[1], factor[1]);
                    const size_t bytes = static_cast<size_t>(full->size) * sizeof(float);
                    same += factor[0] == factor[1] && std::memcmp(lower[0], lower[1], bytes) == 0 && std::memcmp(higher[0], higher[1], bytes) == 0;
                }
                std::printf("organ %s at %.0f Hz: the wave cache grew by %.2f MB, makeVoice %.1f ms cold, %.1f ms warm; %d of 128 keys read a full build's tables\n",
                            preset, sr, static_cast<double>(grew) / 1048576.0, cold, warm, same);
                CHECK(same == 128);
            }
        }
    }

    // Transport: loop and jump.
    btg::Transport transport;
    transport.setLoop(4.0, 8.0);
    transport.play(6.0, 120.0); // 2 beats per second
    int frames = 0, cuts = 0;
    double last = 6.0, lowest = 100.0, highest = 0.0;
    while (frames < 5 * rate) {
        const auto block = transport.advance(480, rate);
        CHECK(block.playing && block.frames >= 1 && block.frames <= 480);
        if (block.beats < last) ++cuts; // wrapped
        last = block.beats;
        lowest = std::min(lowest, block.beats);
        highest = std::max(highest, block.beats + block.frames * block.beatsPerFrame);
        frames += block.frames;
    }
    CHECK(cuts == 2);                                   // 10 beats from 6 in a loop of 4: wraps at 8 twice, the third comes at exactly 5 s
    CHECK(lowest >= 4.0 && highest <= 8.0 + 1e-4);      // never outside the loop (at most one frame over)
    transport.setLoop(0.0, 0.0);
    transport.seek(32.0);
    CHECK(std::fabs(transport.advance(480, rate).beats - 32.0) < 1e-12);

    // The lead (the web app starts its song 0.15 s after play()): 7200 standing frames at 48 kHz (playing blocks at the start place,
    // beatsPerFrame 0), the block that holds the end cut there, then the clock moves from the start place; one start in all. A seek during
    // the lead moves the place it stands on and the lead goes on; a stop stops it; a second play starts a new lead; lead 0 moves at once.
    {
        const auto standing = [&](btg::Transport& t, int block) { // frames of standing blocks until the clock moves; the first moving block
            int total = 0;
            btg::Transport::Block b = t.advance(block, rate);
            while (b.playing && b.lead && b.beatsPerFrame == 0.0) { total += b.frames; b = t.advance(block, rate); }
            return std::make_pair(total, b);
        };
        btg::Transport t;
        t.play(8.0, 120.0, 0.15);
        CHECK(t.standing() && t.beats() == 8.0); // what the shell reports before the audio thread has taken the play
        const auto first = t.advance(1000, rate);
        CHECK(first.playing && first.beats == 8.0 && first.beatsPerFrame == 0.0 && first.frames == 1000 && first.starts == 1 && first.lead);
        const auto [rest, moving] = standing(t, 1000);
        CHECK(rest == 6200 && moving.beats == 8.0 && moving.beatsPerFrame == 120.0 / 60.0 / rate && moving.frames == 1000 && moving.starts == 1 && !moving.lead); // the cut block held 200
        CHECK(t.advance(1000, rate).starts == 1 && std::fabs(t.beats() - (8.0 + 2000 * 120.0 / 60.0 / rate)) < 1e-9 && !t.standing());

        btg::Transport s; // a seek during the lead, a tempo change (takes effect when the clock moves)
        s.play(8.0, 120.0, 0.15);
        s.advance(1000, rate);
        s.seek(12.0);
        s.setTempo(60.0);
        const auto moved = standing(s, 1000);
        CHECK(moved.first == 6200 && moved.second.beats == 12.0 && moved.second.beatsPerFrame == 60.0 / 60.0 / rate);

        btg::Transport u; // a stop in the lead: stopped blocks, no lead left; a new play: a new lead and a second start
        u.play(8.0, 120.0, 0.15);
        u.advance(1000, rate);
        u.stop();
        CHECK(!u.advance(1000, rate).playing);
        u.play(4.0, 120.0, 0.15);
        const auto again = standing(u, 480);
        CHECK(again.first == 7200 && again.second.beats == 4.0 && again.second.starts == 2);

        btg::Transport w; // a second play during the lead (no stop between): a new lead from the new place, a second start, no block of the song before it
        w.play(8.0, 120.0, 0.15);
        w.advance(1000, rate);
        w.play(4.0, 90.0, 0.15);
        const auto replayed = standing(w, 480);
        CHECK(replayed.first == 7200 && replayed.second.beats == 4.0 && replayed.second.starts == 2 && replayed.second.beatsPerFrame == 90.0 / 60.0 / rate);

        btg::Transport v; // a play and a seek before the audio thread looks: the seek is the later control and wins, the lead stands there
        v.play(8.0, 120.0, 0.15);
        v.seek(20.0);
        const auto sought = standing(v, 1000);
        CHECK(sought.first == 7200 && sought.second.beats == 20.0 && sought.second.starts == 1);
        v.seek(30.0); // a seek while moving is a jump of the clock, as before
        CHECK(v.advance(480, rate).beats == 30.0);

        btg::Transport y; // a seek before a play does not survive it: the play's place wins
        y.seek(50.0);
        y.play(8.0, 120.0);
        CHECK(y.advance(480, rate).beats == 8.0);

        btg::Transport z; // lead 0: as before
        z.play(8.0, 120.0);
        const auto now = z.advance(480, rate);
        CHECK(now.playing && now.beatsPerFrame > 0.0 && now.frames == 480 && now.starts == 1);
    }

    // A pack that points outside its audio file is refused.
    bool refused = false;
    const unsigned char pcm[8] = {};
    try { btg::loadPack(R"({"samples":[{"offset":0,"frames":100,"rate":22050}],"zones":[{"sample":0}]})", pcm, sizeof pcm); } catch (const std::exception&) { refused = true; }
    CHECK(refused);
    CHECK(btg::loadPack(R"({"samples":[{"offset":0,"frames":4,"rate":22050}],"zones":[{"sample":0}]})", pcm, sizeof pcm).zones.size() == 1);

    // The filters of the Web Audio spec: the gain where each type defines it.
    {
        using namespace btg::detail;
        CHECK(std::fabs(gainDb(peaking(2400, -6, 0.8, 48000), 2400, 48000) + 6) < 0.01);
        CHECK(std::fabs(gainDb(lowshelf(200, 5, 48000), 0, 48000) - 5) < 0.01);
        CHECK(std::fabs(gainDb(highshelf(2600, -4, 48000), 24000, 48000) + 4) < 0.01);
        CHECK(std::fabs(gainDb(lowpass(1000, 1, 48000), 1000, 48000) - 1) < 0.01); // Q in dB is the gain at the corner
        CHECK(std::fabs(gainDb(highpass(50, 1, 48000), 50, 48000) - 1) < 0.01);
        CHECK(std::fabs(gainDb(highshelf(1800, 0, 48000), 5000, 48000)) < 1e-9);    // 0 dB passes unchanged
    }
    // sample-zones.js, artZones: own zones for an art when the pack has them, else the plain ones; release zones never.
    {
        btg::Pack pack;
        pack.samples.push_back({ 0, 4, 22050.0, 0, 0 });
        for (const char* art : { "", "palmMute", "" }) { btg::Pack::Zone z; z.keyLo = 40; z.keyHi = 80; z.art = art; pack.zones.push_back(z); }
        pack.zones[2].releaseTrigger = true;
        const btg::Pack::Zone* best[4];
        bool own = false;
        CHECK(btg::detail::pickZones(pack, 60, 0.8, "palmMute", best, 4, &own) == 1 && best[0] == &pack.zones[1] && own);
        CHECK(btg::detail::pickZones(pack, 60, 0.8, "dead", best, 4, &own) == 1 && best[0] == &pack.zones[0] && !own);
        CHECK(btg::detail::pickZones(pack, 60, 0.8, nullptr, best, 4, &own) == 1 && best[0] == &pack.zones[0] && !own);
    }
    // convolver.h: the same as a direct convolution, without latency, for any chunk size. 3000 taps: the head (512) and five partitions,
    // the last one cut short.
    {
        unsigned int seed = 3;
        const auto noise = [&] { seed = seed * 1664525u + 1013904223u; return static_cast<float>(seed >> 8) / 8388608.0f - 1.0f; };
        std::vector<std::vector<float>> h(2, std::vector<float>(3000)), x(2, std::vector<float>(6000)), y(2, std::vector<float>(6000));
        for (auto& c : h) for (float& v : c) v = 0.01f * noise();
        for (auto& c : x) for (float& v : c) v = noise();
        btg::detail::Convolver conv(h);
        CHECK(conv.frames() == 3000 && conv.partitions() == 5);
        const int sizes[] = { 1, 7, 256, 480, 513, 64 };
        for (int at = 0, k = 0; at < 6000; at += sizes[k++ % 6])
            conv.process(&x[0][at], &x[1][at], &y[0][at], &y[1][at], std::min(sizes[k % 6], 6000 - at));
        double worst = 0.0;
        for (int c = 0; c < 2; ++c)
            for (int n = 0; n < 6000; ++n) {
                double want = 0.0;
                for (int k = 0; k <= std::min(n, 2999); ++k) want += static_cast<double>(h[c][k]) * x[c][n - k];
                worst = std::max(worst, std::fabs(want - y[c][n]));
            }
        CHECK(worst < 1e-5);
        conv.reset();
        std::vector<float> silence(600, 0.0f), out(600, 1.0f), out2(600, 1.0f);
        conv.process(silence.data(), silence.data(), out.data(), out2.data(), 600);
        CHECK(*std::max_element(out.begin(), out.end()) == 0.0f && *std::min_element(out.begin(), out.end()) == 0.0f);
    }
    // Chromium reverb.cc, CalculateNormalizationScale: 1 / rms over both channels, times 10^(-58/20), times 44100 / rate; silence: 1 / 0.000125.
    {
        using btg::detail::normalizationScale;
        const std::vector<std::vector<float>> ir = { { 0.5f, -0.5f, 0.5f, -0.5f }, { 1.0f, 1.0f, -1.0f, -1.0f } }; // rms sqrt(5 / 8)
        CHECK(std::fabs(normalizationScale(ir, 48000) / (1 / std::sqrt(0.625) * std::pow(10.0, -2.9) * 44100 / 48000) - 1) < 1e-6);
        CHECK(std::fabs(normalizationScale({ { 0.0f, 0.0f }, { 0.0f, 0.0f } }, 44100) / (1 / 0.000125 * std::pow(10.0, -2.9)) - 1) < 1e-6);
    }
    // Review Focus 5, the responses: at 44.1, 48 and 96 kHz the reverb (2 s, decay 3) and the room (0.4 s, decay 6.9 / 0.4) have the same length
    // in seconds and decay at the same speed (power from 0.5..1.0 s to 1.0..1.5 s: e^-3 = -13.03 dB; room 0.05..0.2 s to 0.2..0.35 s:
    // e^-5.175 = -22.47 dB; the tolerances cover the noise of the draws), and their summed square goes with Chromium's normalisation,
    // 10^-5.8 * 44100^2 * seconds / rate per channel: the reverb's power is 3.01 dB lower at 96 kHz than at 48 kHz (design open point 3).
    for (const double sr : { 44100.0, 48000.0, 96000.0 }) {
        const auto reverb = btg::detail::normalizedNoise("reverb", 2.0, 3.0, sr), room = btg::detail::normalizedNoise("room", 0.4, 6.9 / 0.4, sr);
        const auto energy = [sr](const std::vector<float>& x, double from, double to) {
            double s = 0.0;
            for (size_t i = static_cast<size_t>(from * sr); i < static_cast<size_t>(to * sr); ++i) s += static_cast<double>(x[i]) * x[i];
            return s;
        };
        CHECK(reverb.size() == 2 && reverb[0].size() == static_cast<size_t>(std::ceil(2.0 * sr)) && room[1].size() == static_cast<size_t>(std::ceil(0.4 * sr)));
        CHECK(std::fabs(10 * std::log10(energy(reverb[0], 1.0, 1.5) / energy(reverb[0], 0.5, 1.0)) + 13.03) < 0.3);
        CHECK(std::fabs(10 * std::log10(energy(room[0], 0.2, 0.35) / energy(room[0], 0.05, 0.2)) + 22.47) < 0.5);
        const double perChannel = (energy(reverb[0], 0.0, 2.0) + energy(reverb[1], 0.0, 2.0)) / 2;
        CHECK(std::fabs(10 * std::log10(perChannel / (std::pow(10.0, -5.8) * 44100.0 * 44100.0 * 2.0 / sr))) < 0.01);
    }
    // echo.h: at 20 bpm the echo comes 2.25 s late (synth.js echoTime: 60 / bpm * 0.75) and fits its 3 s line, also at 96 kHz; with
    // feedback 0.5 it comes again after twice the time and the browser's 128 frames in the loop (inside the 10 ms looked at), nothing
    // between; a longer time stops at 3 s (createDelay(3)); a new time glides
    // with the time constant 0.05 s: 63.2 % of the way after 0.05 s, within 1e-4 s after 0.5 s.
    for (const double sr : { 48000.0, 96000.0 }) {
        btg::detail::Echo echo;
        echo.prepare(sr);
        echo.setTone(2400);
        echo.setTarget(60.0 / 20 * 0.75, true);
        CHECK(echo.delay() == 2.25);
        std::vector<float> out(static_cast<size_t>(4.7 * sr));
        for (size_t i = 0; i < out.size(); ++i) { float right = 0.0f; echo.process(i == 0 ? 1.0f : 0.0f, 0.0f, 0.5, out[i], right); }
        size_t once = 0;
        while (once < out.size() && std::fabs(out[once]) <= 1e-3) ++once;
        CHECK(once == static_cast<size_t>(std::llround(2.25 * sr)));
        double between = 0.0, again = 0.0;
        for (size_t i = once + static_cast<size_t>(0.1 * sr); i < 2 * once; ++i) between = std::max(between, std::fabs(static_cast<double>(out[i])));
        for (size_t i = 2 * once; i < 2 * once + static_cast<size_t>(0.01 * sr); ++i) again = std::max(again, std::fabs(static_cast<double>(out[i])));
        CHECK(between < 1e-6 && again > 1e-3);
        size_t second = once + static_cast<size_t>(0.1 * sr); // the second echo's first frame: exactly 128 frames late (the browser's cycle)
        while (second < out.size() && std::fabs(out[second]) <= 1e-9) ++second;
        CHECK(second == 2 * once + 128);
        echo.setTarget(4.0, true);
        CHECK(echo.delay() == 3.0);
        echo.setTarget(0.45, true);
        echo.setTarget(0.3, false);
        float l = 0.0f, r = 0.0f;
        for (int i = 0; i < static_cast<int>(0.05 * sr); ++i) echo.process(0.0f, 0.0f, 0.0, l, r);
        CHECK(std::fabs(echo.delay() - (0.3 + 0.15 * std::exp(-1.0))) < 1e-4);
        for (int i = 0; i < static_cast<int>(0.45 * sr); ++i) echo.process(0.0f, 0.0f, 0.0, l, r);
        CHECK(std::fabs(echo.delay() - 0.3) < 1e-4);
        // A time of 1000.25 frames reads linearly between two frames (Chromium delay.cc): an impulse comes out as its neighbours 1000 and
        // 1001 frames later weighted 0.75 and 0.25, before the tone filter; the filter sits behind that and is linear, so the output is
        // 0.75 r[n] + 0.25 r[n - 1] for r = the same filter's answer to an impulse at exactly 1000 frames (whole frames: no interpolation).
        {
            btg::detail::Echo whole, fraction;
            for (btg::detail::Echo* e : { &whole, &fraction }) { e->prepare(sr); e->setTone(2400); }
            whole.setTarget(1000.0 / sr, true);
            fraction.setTarget(1000.25 / sr, true);
            std::vector<float> exact(1200), x(1200);
            double worst = 0.0, level = 0.0;
            for (size_t i = 0; i < exact.size(); ++i) {
                float unused = 0.0f, outFraction = 0.0f;
                whole.process(i == 0 ? 1.0f : 0.0f, 0.0f, 0.0, exact[i], unused);
                fraction.process(i == 0 ? 1.0f : 0.0f, 0.0f, 0.0, outFraction, unused);
                x[i] = outFraction;
                if (i >= 1000) { worst = std::max(worst, std::fabs(static_cast<double>(outFraction) - (0.75 * exact[i] + 0.25 * exact[i - 1]))); level = std::max(level, std::fabs(static_cast<double>(exact[i]))); }
            }
            CHECK(level > 1e-3 && worst < 1e-7 && x[999] == 0.0f);
        }
    }

    // compressor.h, Chromium's DynamicsCompressor: the signal leaves (unsigned)(0.006f * rate) frames late (288 at 48 kHz, 264 at 44.1, 576 at
    // 96); below the threshold it only gets the automatic make-up (1 / Saturate(1))^0.6, with knee 0 10^(-0.6 * threshold * (1 - 1/ratio) / 20):
    // 4.5709 for -24 dB and ratio 12, 1.6218 for -14 dB and ratio 2. One impulse of -40 dBFS after 1 s of silence (the detector has settled),
    // chunks of 100 frames; every other frame stays exactly 0. This says nothing about the 32-frame division across calls: the signal lies
    // below both thresholds, so detector and gain are 1 in every division (the check after this loop does that).
    for (const auto& [sr, late] : { std::pair { 48000.0f, 288 }, std::pair { 44100.0f, 264 }, std::pair { 96000.0f, 576 } })
        for (const auto& [threshold, ratio, makeup] : { std::tuple { -24.0f, 12.0f, 4.5709 }, std::tuple { -14.0f, 2.0f, 1.6218 } }) {
            btg::detail::Compressor c;
            c.prepare(sr);
            c.set(threshold, 0.0f, ratio, 0.003f, 0.25f);
            CHECK(c.preDelay() == late);
            std::vector<float> l(static_cast<size_t>(sr) + 1000, 0.0f), r(l.size(), 0.0f);
            l[static_cast<size_t>(sr)] = 0.01f;
            for (size_t at = 0; at < l.size(); at += 100) c.process(&l[at], &r[at], static_cast<int>(std::min<size_t>(100, l.size() - at)));
            const size_t peakAt = static_cast<size_t>(std::max_element(l.begin(), l.end(), [](float a, float b) { return std::fabs(a) < std::fabs(b); }) - l.begin());
            CHECK(peakAt == static_cast<size_t>(sr) + late);
            CHECK(std::fabs(l[peakAt] / 0.01 / makeup - 1) < 1e-3);
            CHECK(std::count_if(l.begin(), l.end(), [](float x) { return x != 0.0f; }) == 1 && *std::max_element(r.begin(), r.end()) == 0.0f);
        }
    // The length of the calls changes nothing: noise at 0 dBFS, 40 dB lower, +3 dBFS, -30 dBFS (0.3 s each, so attack and release both run
    // and the compressor really works the signal), through the glue's and the limiter's settings in one call and in calls of 100, 7 and 128
    // frames (the engine's chunks have remainders; the browser's calls have 128): the four outputs are bit-identical, and the quiet stretch
    // comes out louder against its input than the loud one by at least 10 % (the signal was compressed).
    for (const auto& setting : { std::tuple { -14.0f, 2.0f, 0.03f, 0.25f }, std::tuple { -2.0f, 20.0f, 0.001f, 0.1f } }) {
        const float threshold = std::get<0>(setting), ratio = std::get<1>(setting), attack = std::get<2>(setting), release = std::get<3>(setting); // plain locals: older Clang cannot capture structured bindings
        const size_t part = 14400, frames = 4 * part;
        std::vector<float> left(frames), right(frames);
        unsigned int seed = 5;
        const auto noise = [&] { seed = seed * 1664525u + 1013904223u; return static_cast<float>(seed >> 8) / 8388608.0f - 1.0f; };
        const float amplitude[4] = { 1.0f, 0.01f, 1.4125f, 0.0316f };
        for (size_t i = 0; i < frames; ++i) { left[i] = amplitude[i / part] * noise(); right[i] = 0.6f * amplitude[i / part] * noise(); }
        const auto through = [&](size_t chunk) {
            btg::detail::Compressor c;
            c.prepare(48000.0f);
            c.set(threshold, 0.0f, ratio, attack, release);
            std::vector<float> l = left, r = right;
            for (size_t at = 0; at < frames; at += chunk) c.process(&l[at], &r[at], static_cast<int>(std::min(chunk, frames - at)));
            return std::make_pair(l, r);
        };
        const auto whole = through(frames);
        for (const size_t chunk : { 100, 7, 128 }) CHECK(through(chunk) == whole);
        const auto gainOf = [&](size_t from) { // output (late by the pre-delay) against input over 0.1 s
            return rmsOf(whole.first, from + 288, from + 288 + 4800) / rmsOf(left, from, from + 4800);
        };
        CHECK(gainOf(part - 4800) * 1.1 < gainOf(2 * part - 4800)); // measured: 0.756 against 1.616 (glue), 0.938 against 1.122 (limiter)
    }

    // Engine with the fixture track.
    if (argc < 2) { std::printf("usage: btg_engine_tests <track.json>\n"); return 2; }
    std::ifstream file(argv[1], std::ios::binary);
    const std::string track((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    CHECK(!track.empty());
    // Printed, not asserted (Task 21): what prepare costs the first time at a rate, when it builds the basic waves (ruling 16), against a
    // second engine's prepare at that rate (the waves are kept). Before any other engine of this program is prepared.
    for (const double sr : { 48000.0, 96000.0 }) {
        double ms[2];
        for (double& m : ms) {
            btg::Engine e;
            const auto began = std::chrono::steady_clock::now();
            e.prepare(sr);
            m = 1000 * std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();
        }
        std::printf("prepare at %.0f Hz: %.0f ms the first time (it builds the basic waves), %.0f ms the second\n", sr, ms[0], ms[1]);
    }
    const auto play = [&](int blockSize, bool muteAll, double startBeats) {
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(DRY);
        engine.setTrack(track);
        engine.setMuted(btg::Engine::drums, muteAll);
        engine.setMuted(btg::Engine::bass, muteAll);
        engine.prepare(rate);
        btg::Transport t;
        t.play(startBeats, engine.bpm());
        CHECK(engine.lengthBeats() > 0 && engine.bpm() > 0);
        return render(engine, t, 20.0, blockSize);
    };
    const Result a = play(480, false, 0.0), again = play(480, false, 0.0), small = play(64, false, 0.0);
    CHECK(a.rms > 0.01 && a.peak <= 1.0);
    CHECK(a.left == again.left);                            // same track, same sound
    CHECK(std::fabs(small.rms / a.rms - 1.0) < 0.02);       // the block size does not change the mix
    CHECK(play(480, true, 0.0).peak == 0.0);                // muted layers are silent
    CHECK(play(480, false, 64.0).rms > 0.01);               // starting inside the song plays

    // mix/bus on 0 takes the old limiter alone (-10 dB with its make-up), on 1 the glue and the limiter: both finite, below 1.0, not the same.
    // The fine value's default is on 0 (tunables.js, MIX_TUNABLES), so no tuning is the old limiter.
    {
        const auto bus = [&](const char* tuning) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setTuning(tuning);
            engine.setTrack(track);
            engine.prepare(rate);
            btg::Transport t;
            t.play(0.0, engine.bpm());
            return render(engine, t, 5.0, 480);
        };
        const Result glued = bus(R"({"mix/bus":{"on":1}})"), old = bus(R"({"mix/bus":{"on":0}})");
        CHECK(glued.finite && old.finite && glued.peak < 1.0 && old.peak < 1.0 && glued.left != old.left);
        CHECK(bus("{}").left == old.left);
    }

    // The distortion chain in the engine (phase-4-design.md 3): the bass alone (drums muted), dry, no limiter, from beat 64 where the
    // fixture's bass plays; f has bass.fuzz 1, c not. near(): within 1e-6 (the sum's shelf carries the rounding of a different past).
    {
        const char *CLEAN = R"({"master":{"reverb":0,"echo":0,"roomWet":0}})", *FUZZ = R"({"master":{"reverb":0,"echo":0,"roomWet":0},"bass":{"fuzz":1}})";
        const auto make = [&](const char* sound) {
            auto e = std::make_unique<btg::Engine>();
            e->setPackSource(source); e->setSound(sound); e->setTrack(track); e->setMuted(btg::Engine::drums, true); e->setLimiter(false); e->prepare(rate);
            return e;
        };
        const auto near = [](const Result& a, const Result& b, size_t from, size_t to) {
            for (size_t i = from; i < to; ++i) if (std::fabs(a.left[i] - b.left[i]) > 1e-6f) return false;
            return true;
        };
        const auto differs = [](const Result& a, const Result& b, size_t from, size_t to) {
            for (size_t i = from; i < to; ++i) if (std::fabs(a.left[i] - b.left[i]) > 1e-3f) return true;
            return false;
        };
        const size_t hold = static_cast<size_t>(0.08 * rate), lazy = static_cast<size_t>(0.15 * rate), n = static_cast<size_t>(0.5 * rate);
        { // 1. a start: the creation fade lets the input through for 0.08 s, then the chain
            auto f = make(FUZZ), c = make(CLEAN);
            btg::Transport tf, tc;
            tf.play(64.0, f->bpm()); tc.play(64.0, c->bpm());
            const Result a = render(*f, tf, 0.5, 480), b = render(*c, tc, 0.5, 480);
            CHECK(rmsOf(b.left, 0, hold) > 1e-3 && near(a, b, 0, hold)); // passes red too
            CHECK(differs(a, b, hold, n));                                // red: there is no chain
        }
        { // 2. a jump keeps the chain: no new fade after it
            auto f = make(FUZZ), c = make(CLEAN);
            btg::Transport tf, tc;
            tf.play(64.0, f->bpm()); tc.play(64.0, c->bpm());
            render(*f, tf, 1.0, 480); render(*c, tc, 1.0, 480);
            tf.seek(64.0); tc.seek(64.0);
            CHECK(differs(render(*f, tf, 0.1, 480), render(*c, tc, 0.1, 480), 0, hold)); // red: no chain
        }
        { // 3. a restart (play again, no stop) inside a note of the bass (1.55 s after beat 64; see 9) gives the new song a fresh chain, as
          // the web's new graph at every play() (phase 5 ruling 5): the old tones ring out on the chain they began under (9, 11) and the new
          // song's first 0.08 s pass dry. So the restart's render less that of the same engine stopped there instead (the old tail alone)
          // equals the clean engine's taken the same way within 1e-6 for 0.08 s, and then differs. A start after a stop that has fallen
          // quiet (no tone left, the output exactly 0) builds it anew: dry for 0.08 s again.
            auto f = make(FUZZ), c = make(CLEAN), fs = make(FUZZ), cs = make(CLEAN);
            btg::Transport tf, tc, tfs, tcs;
            for (auto [e, t] : { std::pair { f.get(), &tf }, std::pair { c.get(), &tc }, std::pair { fs.get(), &tfs }, std::pair { cs.get(), &tcs } }) {
                t->play(64.0, e->bpm());
                render(*e, *t, 1.55, 480);
            }
            tf.play(64.0, f->bpm()); tc.play(64.0, c->bpm()); tfs.stop(); tcs.stop();
            const auto newSong = [&](btg::Engine& e, btg::Transport& t, btg::Engine& stopped, btg::Transport& ts) {
                Result r = render(e, t, 1.0, 480);
                const Result tail = render(stopped, ts, 1.0, 480);
                for (size_t i = 0; i < r.left.size(); ++i) r.left[i] -= tail.left[i];
                return r;
            };
            const Result fNew = newSong(*f, tf, *fs, tfs), cNew = newSong(*c, tc, *cs, tcs);
            CHECK(rmsOf(cNew.left, 0, hold) > 1e-3 && near(fNew, cNew, 0, hold)); // red: the chain kept under the old tones (ruling P)
            CHECK(differs(fNew, cNew, hold, n));                                  // red: no chain
            tf.stop(); tc.stop();
            CHECK(render(*f, tf, 1.0, 480).left.back() == 0.0f && render(*c, tc, 1.0, 480).left.back() == 0.0f);
            tf.play(64.0, f->bpm()); tc.play(64.0, c->bpm());
            const Result a = render(*f, tf, 0.5, 480), b = render(*c, tc, 0.5, 480);
            CHECK(near(a, b, 0, hold));      // red: the chain kept across a quiet stop
            CHECK(differs(a, b, hold, n));   // red: no chain
        }
        { // 4. the first knob above 0 while playing: dry for 0.15 s (LAZY), then the chain
            auto f = make(CLEAN), c = make(CLEAN);
            btg::Transport tf, tc;
            tf.play(64.0, f->bpm()); tc.play(64.0, c->bpm());
            render(*f, tf, 1.0, 480); render(*c, tc, 1.0, 480);
            f->setSound(FUZZ);
            const Result a = render(*f, tf, 0.6, 480), b = render(*c, tc, 0.6, 480);
            CHECK(near(a, b, 0, lazy));                                       // passes red too
            CHECK(differs(a, b, lazy, a.left.size()));                        // red: no chain
        }
        { // 5. back to 0 while playing: the chain is no longer heard (within 1e-6) from 0.21 s after the change (the ramp ends 0.2 s after it
          // reaches the chain, the block after the control call), and the first 50 ms differ (a ramp, not a jump)
            auto f = make(FUZZ), c = make(CLEAN);
            btg::Transport tf, tc;
            tf.play(64.0, f->bpm()); tc.play(64.0, c->bpm());
            render(*f, tf, 1.0, 480); render(*c, tc, 1.0, 480);
            f->setSound(CLEAN);
            const Result a = render(*f, tf, 1.0, 480), b = render(*c, tc, 1.0, 480);
            CHECK(differs(a, b, 0, static_cast<size_t>(0.05 * rate)));       // the ramp, not a jump; red: no chain
            CHECK(near(a, b, static_cast<size_t>(0.21 * rate), a.left.size())); // passes red too
        }
        { // 6. a start with the web app's lead: the chain is built at the lead's first block and not again when the clock begins to move, so
          // its creation fade has run by the song's first frame (0.15 s, fade over at 0.16 s): the song's first 0.08 s are not dry again
            auto f = make(FUZZ), c = make(CLEAN);
            btg::Transport tf, tc;
            tf.play(64.0, f->bpm(), 0.15); tc.play(64.0, c->bpm(), 0.15);
            const Result a = render(*f, tf, 0.15 + 0.5, 480), b = render(*c, tc, 0.15 + 0.5, 480);
            const size_t lead = static_cast<size_t>(0.15 * rate);
            CHECK(rmsOf(b.left, lead, lead + hold) > 1e-3 && differs(a, b, lead, lead + hold)); // red: no chain; a rebuild when the clock moves
        }
        // 7. vibrato and chorus: chorus 1 puts copies left and right, so the bass is no longer one signal on both sides (correlation 1
        // without it: the balance only scales); all back to 0 while playing: the chain leaves the path exactly 0.2 s after the change.
        const auto correlation = [](const Result& r) {
            double lr = 0, ll = 0, rr = 0;
            for (size_t i = 0; i < r.left.size(); ++i) { lr += r.left[i] * r.right[i]; ll += r.left[i] * r.left[i]; rr += r.right[i] * r.right[i]; }
            return lr / std::sqrt(ll * rr);
        };
        const char* BOTH = R"({"master":{"reverb":0,"echo":0,"roomWet":0},"bass":{"vibrato":1,"chorus":1}})";
        {
            auto f = make(BOTH), c = make(CLEAN);
            btg::Transport tf, tc;
            tf.play(64.0, f->bpm()); tc.play(64.0, c->bpm());
            const Result a = render(*f, tf, 2.0, 480), b = render(*c, tc, 2.0, 480);
            std::printf("chorus: correlation of left and right %.4f (without: %.6f)\n", correlation(a), correlation(b));
            CHECK(std::fabs(correlation(b) - 1) < 1e-6); // passes red too
            CHECK(correlation(a) < 0.99);                // red: no chorus (estimate with it: about 0.8)
            f->setSound(CLEAN); c->setSound(CLEAN);
            const Result a2 = render(*f, tf, 1.0, 480), b2 = render(*c, tc, 1.0, 480);
            CHECK(differs(a2, b2, 0, static_cast<size_t>(0.05 * rate)));              // the ramp; red: no chain
            CHECK(near(a2, b2, static_cast<size_t>(0.21 * rate), a2.left.size()));     // passes red too
        }
        // 8. the tempo in a lead: the vibrato's rate follows the tempo (4 Hz at 60 bpm, 5.5 Hz from 120), and a lead's blocks stand
        // (beatsPerFrame 0), so they carry it (Block::bpm). The same play twice, the second told 60 bpm in its lead's blocks: its chain is
        // built at 4 Hz and moves to 5.5 Hz when the clock does, so the first 0.2 s of the song differ; red: no chain, or a chain that
        // ignores the block's tempo (both would then be the same).
        {
            const char* VIBRATO = R"({"master":{"reverb":0,"echo":0,"roomWet":0},"bass":{"vibrato":1}})";
            const auto play = [&](double leadTempo) {
                auto e = make(VIBRATO);
                btg::Transport t;
                t.play(64.0, 160.0, 0.15);
                Result r;
                std::vector<float> l(480), rr(480);
                for (int done = 0; done < 0.9 * rate;) {
                    auto block = t.advance(480, rate);
                    if (block.lead) block.bpm = leadTempo;
                    e->render(l.data(), rr.data(), block.frames, block);
                    r.left.insert(r.left.end(), l.begin(), l.begin() + block.frames);
                    done += block.frames;
                }
                return r;
            };
            const Result same = play(160.0), told = play(60.0), again = play(160.0);
            const size_t lead = static_cast<size_t>(0.15 * rate);
            CHECK(near(same, again, 0, same.left.size()));                  // deterministic
            CHECK(differs(same, told, lead, lead + static_cast<size_t>(0.2 * rate))); // red: no chain, or the block's tempo is not read
        }
        // 9. a start under ringing tones leaves the old tones on the chains they began under (phase 5 ruling 5; ruling P of Phase 4 kept the
        // chains for it): a stop (or a play with no stopped block between) chokes the old tones, which ring on through those chains; a play
        // 20 ms after the stop, or at once, with the app's lead must leave them ringing as a stop alone does. From the stop to the end of the
        // lead (the new song schedules nothing in it) the engine that got the play, less what its new chains make by themselves in the lead
        // (a fresh engine's lead: the fuzz's bias through its highpass, 2.8e-4; 0 for the others), equals within 1e-6 the same engine that
        // only got the stop, up to where that one falls quiet (its output exactly 0 to the end). The layer alone (sends 0, no limiter; the
        // chords from the fixture with its chords switched on), stopped 1.55 s after beat 64, inside a note of the bass (at 1 s the fixture's
        // bass is between two notes); `peak` is what still rings from the play on. The chords also with the e-piano (Task 21): its synth tones
        // ring through the chorus (red when the start looks only at the sample tones). And the residual R-1 of Phase 4's re-review: a play
        // that switches the distortion on (the sound given just before it, and before the stop of the engine it is compared with) leaves the
        // old tones clean, as on the web's old graph: red when they ring through the chain the new song gets.
        {
            std::string chorded = track;
            chorded.replace(chorded.find("\"chords\":false"), 14, "\"chords\":true");
            const char* DISTORTION = R"({"master":{"reverb":0,"echo":0,"roomWet":0},"bass":{"distortion":1}})";
            // name, sound, the layer alone, voices, the sound given at the play (nullptr: none)
            const std::tuple<const char*, const char*, btg::Engine::Layer, const char*, const char*> cases[] = {
                { "bass fuzz 1", FUZZ, btg::Engine::bass, nullptr, nullptr },
                { "bass vibrato 1", R"({"master":{"reverb":0,"echo":0,"roomWet":0},"bass":{"vibrato":1}})", btg::Engine::bass, nullptr, nullptr },
                { "chords chorus 1", R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"chorus":1}})", btg::Engine::chords, nullptr, nullptr },
                { "chords chorus 1, e-piano", R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"chorus":1}})", btg::Engine::chords, R"({"chords":{"id":"epiano","variant":"rhodes"}})", nullptr },
                { "bass clean, distortion 1 from the play on", CLEAN, btg::Engine::bass, nullptr, DISTORTION } };
            for (const auto& c : cases)
                for (const double gap : { 0.02, 0.0 }) {
                    const char* name = std::get<0>(c);
                    const btg::Engine::Layer alone = std::get<2>(c);
                    const auto run = [&](int mode) { // 0: the play, 1: a stop instead, 2: a fresh engine's lead
                        auto e = make(mode == 2 && std::get<4>(c) ? std::get<4>(c) : std::get<1>(c));
                        if (alone == btg::Engine::chords) e->setTrack(chorded);
                        if (std::get<3>(c)) e->setVoices(std::get<3>(c));
                        for (int l = 0; l < btg::Engine::layerCount; ++l) e->setMuted(static_cast<btg::Engine::Layer>(l), l != alone);
                        btg::Transport t;
                        Result r;
                        if (mode < 2) {
                            t.play(64.0, e->bpm());
                            render(*e, t, 1.55, 480);
                            if (gap > 0) { t.stop(); r = render(*e, t, gap, 480); }
                            if (std::get<4>(c)) e->setSound(std::get<4>(c));
                        }
                        if (mode == 1) t.stop(); else t.play(64.0, e->bpm(), 0.15);
                        const Result lead = render(*e, t, 0.15, 480);
                        r.left.insert(r.left.end(), lead.left.begin(), lead.left.end());
                        return r;
                    };
                    const Result a = run(0), b = run(1), own = run(2);
                    const size_t played = static_cast<size_t>(std::lround(gap * rate));
                    size_t quiet = b.left.size();
                    while (quiet > 0 && b.left[quiet - 1] == 0.0f) --quiet;
                    double most = 0.0, level = 0.0;
                    for (size_t i = 0; i < quiet; ++i) {
                        most = std::max(most, static_cast<double>(std::fabs(a.left[i] - (i >= played ? own.left[i - played] : 0.0f) - b.left[i])));
                        if (i >= played) level = std::max(level, static_cast<double>(std::fabs(b.left[i])));
                    }
                    std::printf("start under ringing tones, %s, play %.0f ms after the stop: largest difference to a stop alone %.2e up to %.0f ms after the stop (peak %.3f)\n",
                                name, 1000 * gap, most, 1000.0 * static_cast<double>(quiet) / rate, level);
                    CHECK(a.left.size() == b.left.size() && quiet > played + 2400 && level > 0.01 && most < 1e-6);
                }
            // 10. the cut of a choked tone is no step behind a strong distortion (ruling Q): the chords alone with distortion 1 (sends 0, no
            // limiter), stopped 1 s after beat 64. From 100 ms after the stop on (the chain holds the layer about 80 ms), relative to the
            // output's peak in the second before the stop: the largest difference between two successive samples, printed only (up to 135 ms
            // it is the tail's own slope, -59 dB at 100 ms for a tail of about 100 Hz at -21 dB, which no cut changes), and the largest second
            // difference, asserted below -80 dB (a step of s gives s; the tail's own is -94 dB at 100 ms). With the cut at 1e-4 the tones
            // ended 138 ms after the stop and the engine fell quiet at the next block, from the tail at -45 dB: a step of -51 dB.
            {
                auto e = make(R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"distortion":1}})");
                e->setTrack(chorded);
                for (int l = 0; l < btg::Engine::layerCount; ++l) e->setMuted(static_cast<btg::Engine::Layer>(l), l != btg::Engine::chords);
                btg::Transport t;
                t.play(64.0, e->bpm());
                const Result before = render(*e, t, 1.0, 480);
                t.stop();
                const Result after = render(*e, t, 0.5, 480);
                double peak = 0.0, first = 0.0, second = 0.0;
                for (size_t i = before.left.size() - rate; i < before.left.size(); ++i) peak = std::max(peak, static_cast<double>(std::fabs(before.left[i])));
                for (size_t i = static_cast<size_t>(0.1 * rate); i < after.left.size(); ++i) {
                    const double x = after.left[i], y = after.left[i - 1], z = after.left[i - 2];
                    first = std::max(first, std::fabs(x - y));
                    second = std::max(second, std::fabs(x - 2 * y + z));
                }
                std::printf("stop behind distortion 1: from 100 ms after the stop, successive samples differ by %.1f dB at most, second difference %.1f dB (re the peak %.3f before it)\n",
                            20 * std::log10(first / peak), 20 * std::log10(second / peak), peak);
                CHECK(peak > 0.01 && second < 1e-4 * peak);
            }
            // 11. the new song after a restart under ringing tones meets fresh chains, as the web's new graph at every play() (phase 5 ruling
            // 5), the cases of 9 with the play at once: the restart with the app's lead, its render less that of the same engine stopped there
            // instead (the old tails on their own chains, 9), equals within 1e-6 a fresh engine started at the same place with the same lead,
            // from the restart through 1 s of the song, both channels. Red when a start keeps the chains of a layer whose tones ring (ruling
            // P: the LFO phases run on, the bias has settled) or resets them under the old tones. Then a stop: the engine falls quiet (both
            // generations of the chains drained): its output is exactly 0 from 0.5 s after it, and a play 1 s after it with another sound (the
            // sum's brightness and width) equals exactly a fresh engine with that sound, which needs the start out of quiet (settleSum: the
            // sum's values at once). Red when quiet never comes (an output of 0 alone does not show that).
            const char* OTHER = R"({"master":{"reverb":0,"echo":0,"roomWet":0,"brightness":0.9,"width":0.9}})";
            for (const auto& c : cases) {
                const btg::Engine::Layer alone = std::get<2>(c);
                Result again; // mode 0: the play after the stop
                const auto run = [&](int mode) { // 0: restart, 1: stopped instead, 2: fresh, 3: fresh with OTHER
                    auto e = make(mode == 3 ? OTHER : mode == 2 && std::get<4>(c) ? std::get<4>(c) : std::get<1>(c));
                    if (alone == btg::Engine::chords) e->setTrack(chorded);
                    if (std::get<3>(c)) e->setVoices(std::get<3>(c));
                    for (int l = 0; l < btg::Engine::layerCount; ++l) e->setMuted(static_cast<btg::Engine::Layer>(l), l != alone);
                    e->prepare(rate); // the mutes at once: given after a prepare they fade in 20 ms, which the fresh engine would still show
                    btg::Transport t;
                    if (mode == 3) {
                        t.play(64.0, e->bpm());
                        return render(*e, t, 0.5, 480);
                    }
                    if (mode < 2) {
                        t.play(64.0, e->bpm());
                        render(*e, t, 1.55, 480);
                        if (std::get<4>(c)) e->setSound(std::get<4>(c));
                    }
                    if (mode == 1) t.stop(); else t.play(64.0, e->bpm(), 0.15);
                    Result r = render(*e, t, 1.15, 480);
                    if (mode == 0) {
                        t.stop();
                        const Result after = render(*e, t, 1.0, 480);
                        r.peak = 0.0; // here: the largest sample from 0.5 s after the stop on
                        for (size_t i = static_cast<size_t>(0.5 * rate); i < after.left.size(); ++i)
                            r.peak = std::max(r.peak, static_cast<double>(std::max(std::fabs(after.left[i]), std::fabs(after.right[i]))));
                        e->setSound(OTHER);
                        t.play(64.0, e->bpm());
                        again = render(*e, t, 0.5, 480);
                    }
                    return r;
                };
                const Result a = run(0), b = run(1), fresh = run(2), anew = run(3);
                double most = 0.0;
                for (size_t i = 0; i < fresh.left.size(); ++i)
                    for (const auto side : { &Result::left, &Result::right })
                        most = std::max(most, static_cast<double>(std::fabs((a.*side)[i] - (b.*side)[i] - (fresh.*side)[i])));
                const bool same = again.left == anew.left && again.right == anew.right;
                std::printf("restart under ringing tones, %s: the new song against a fresh engine, largest difference %.2e (song peak %.3f); after a stop %.2e, "
                            "then a play with another sound %s a fresh engine's\n", std::get<0>(c), most, fresh.peak, a.peak, same ? "equals" : "DIFFERS from");
                CHECK(a.left.size() == fresh.left.size() && b.left.size() == fresh.left.size() && fresh.peak > 0.01 && most < 1e-6 && a.peak == 0.0);
                CHECK(anew.peak > 0.01 && same);
            }
            // 12. the turn to two channels under a ringing distorted tone (phase 5 ruling 4): the chords alone with distortion 1 hold a stab
            // of the mono test pack (the fixture without its rhythm: a stab of 2.09 s); 0.5 s into it the chords change to a voice with a
            // two-channel pack, so their chains run in two channels from the block that takes the setup on, while the old mono tone rings
            // on (no new tone in the next 1.5 s). The right channel goes on from the left one's states: the largest difference of two
            // successive samples on the right in the 50 ms from the turn stays within 1.1 times the largest in the 0.2 s before it.
            // Chromium empties the states there (the core departs from it, guitar_fx.cpp): a step of about the tail's level (measured with
            // the right states emptied: 1.18 times, so this bound alone is a thin one). The pan is 0, so that the sides are the same until the
            // turn, and in those 50 ms, the old mono tone alone, the right channel stays the left one within 1e-6 (emptied: by the tail's
            // level). That the turn came shows once the new voice plays: its right channel is not its left.
            {
                std::string held = chorded;
                const std::string rhythm = R"("rhythm":["funky","syncopated"])";
                held.replace(held.find(rhythm), rhythm.size(), R"("rhythm":[])");
                double longest = -1.0;
                for (const btg::Event& e : btg::buildEvents(held))
                    if (longest < 0 && e.type == btg::Event::Type::note && e.layer == "chords" && e.dur >= 2.0) longest = e.t * (100.0 / 60.0);
                auto e = make(R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"distortion":1}})");
                e->setPackSource([](const std::string& id) { return id == "chords-steel" ? stereoTone() : source(id); });
                e->setTrack(held);
                for (int l = 0; l < btg::Engine::layerCount; ++l) e->setMuted(static_cast<btg::Engine::Layer>(l), l != btg::Engine::chords);
                e->setPan(btg::Engine::chords, 0.0f);
                btg::Transport t;
                t.play(longest, e->bpm());
                const Result before = render(*e, t, 0.5, 480);
                e->setVoices(R"({"chords":{"id":"sample","variant":"steel"}})");
                const Result after = render(*e, t, 0.05, 480), later = render(*e, t, 2.5, 480);
                double own = 0.0, step = std::fabs(after.right[0] - before.right.back()), apart = 0.0, sides = 0.0;
                for (size_t i = before.right.size() - rate / 5; i < before.right.size(); ++i) own = std::max(own, static_cast<double>(std::fabs(before.right[i] - before.right[i - 1])));
                for (size_t i = 1; i < after.right.size(); ++i) step = std::max(step, static_cast<double>(std::fabs(after.right[i] - after.right[i - 1])));
                for (size_t i = 0; i < after.right.size(); ++i) apart = std::max(apart, static_cast<double>(std::fabs(after.right[i] - after.left[i])));
                for (size_t i = 0; i < later.right.size(); ++i) sides = std::max(sides, static_cast<double>(std::fabs(later.right[i] - later.left[i])));
                std::printf("turn to two channels under distortion 1: on the right, largest step %.2e in the 50 ms from it, %.2e in the 0.2 s before; right against left %.2e there; "
                            "then the sides differ by %.3f (%s)\n", step, own, apart, sides, e->voiceStatus().c_str());
                CHECK(longest > 0 && own > 1e-3 && step < 1.1 * own && apart < 1e-6 && sides > 0.01 && e->voiceStatus().find(R"("chords":"ready")") != std::string::npos);
            }
        }
    }

    // The lead (design: the web app starts its song 0.15 s after play(); the limiter settles while its input is silent). The limiter's gain
    // (limited render over the same render without the limiter, rms over windows; the limiter delays by its 288 frames of pre-delay) in
    // the first 20 ms of the song against its gain from 0.3 to 0.5 s: with the lead within 0.5 dB; without it the first 20 ms are ducked.
    {
        const auto gainsAt = [&](double lead) {
            const auto played = [&](bool limiter) {
                btg::Engine engine;
                engine.setPackSource(source);
                engine.setTrack(track);
                engine.setLimiter(limiter);
                engine.prepare(rate);
                btg::Transport t;
                t.play(0.0, engine.bpm(), lead);
                return render(engine, t, lead + 0.6, 480).left;
            };
            const std::vector<float> on = played(true), off = played(false);
            const size_t from = static_cast<size_t>(std::lround(lead * rate)), delay = 288;
            const auto gain = [&](size_t at, size_t length) { return 20 * std::log10(rmsOf(on, from + at + delay, from + at + delay + length) / rmsOf(off, from + at, from + at + length)); };
            return std::make_pair(gain(0, 960), gain(14400, 9600));
        };
        const auto [startedLead, steadyLead] = gainsAt(0.15);
        const auto [startedNone, steadyNone] = gainsAt(0.0);
        std::printf("limiter gain, first 20 ms against 0.3 to 0.5 s: with the lead %.2f against %.2f dB, without %.2f against %.2f dB\n", startedLead, steadyLead, startedNone, steadyNone);
        CHECK(std::fabs(startedLead - steadyLead) < 0.5);
        CHECK(steadyNone - startedNone > 3.0); // the documented red: several dB lower without the lead
    }

    // The lead delays the song and changes nothing else: from the beat 64 (inside the song, with held notes and glides that begin before
    // it) a start with the lead plays, after its 7200 frames, exactly what a start without the lead plays (no limiter: the compressors
    // would see the lead's silence; the sends begin empty in both), within 1e-6 (the convolvers' FFT blocks begin 7200 frames earlier).
    {
        const auto played = [&](double lead) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setTrack(track);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm(), lead);
            return render(engine, t, lead + 2.0, 480).left;
        };
        const std::vector<float> plain = played(0.0), led = played(0.15);
        double most = 0.0, level = 0.0;
        for (size_t i = 0; i < plain.size(); ++i) { most = std::max(most, static_cast<double>(std::fabs(led[i + 7200] - plain[i]))); level = std::max(level, static_cast<double>(std::fabs(plain[i]))); }
        std::printf("start at beat 64 with the lead against without: largest difference %.2e (peak %.3f)\n", most, level);
        CHECK(led.size() == plain.size() + 7200 && level > 0.05 && most < 1e-6); // measured 1.2e-7: the convolvers' blocks of 512 begin 7200 frames earlier, other float rounding of the FFT
        double silent = 0.0;
        for (size_t i = 0; i < 7200; ++i) silent = std::max(silent, static_cast<double>(std::fabs(led[i])));
        CHECK(silent == 0.0); // nothing plays during the lead
    }

    // A stop and a play back to back (the web UI's restart) with the lead: the old song's sends are cleared within the lead (the wet fade
    // takes 50 ms) and open again before the song, so from the first moving frame on the output is a fresh engine's started with the same
    // lead, apart from what the engine remembers of the old music: the old tones' choke tails (a choked tone ends at a gain of 1e-7, 0.24 s
    // after the restart, so up to 0.09 s into the song) and the compressors' state, which has the lead's silence to recover. The bound: the largest absolute
    // difference to that fresh engine over the whole song stretch (1 s, peak 0.26) stays below 1e-6 (measured 3e-8, a few float
    // roundings); the first 50 ms are looked at apart, because there the compressors would show it first. The lead
    // itself is not compared. (The same check with lead 0 gives 0.22 in the first 50 ms and 0.066 after: the old song's
    // fade and tails and the cleared sends.)
    {
        const double lead = 0.15;
        const auto played = [&](bool restart) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setTrack(track);
            engine.prepare(rate);
            btg::Transport t;
            t.play(0.0, engine.bpm(), lead);
            if (restart) {
                render(engine, t, lead + 2.0, 480);
                t.stop();
                t.play(0.0, engine.bpm(), lead);
            }
            return render(engine, t, lead + 1.0, 480).left;
        };
        const std::vector<float> again = played(true), fresh = played(false);
        const size_t from = static_cast<size_t>(std::lround(lead * rate));
        double first = 0.0, later = 0.0, level = 0.0;
        for (size_t i = from; i < again.size(); ++i) {
            const double d = std::fabs(again[i] - fresh[i]);
            (i < from + 2400 ? first : later) = std::max(i < from + 2400 ? first : later, d);
            level = std::max(level, static_cast<double>(std::fabs(fresh[i])));
        }
        std::printf("restart with the lead: against a fresh engine, largest difference %.2e in the first 50 ms of the song, %.2e after (song peak %.3f)\n", first, later, level);
        CHECK(level > 0.05 && first < 1e-6 && later < 1e-6);
    }

    // A new song's sound is there from the first frame: an engine that played one timbre, was stopped until it fell quiet (the chain is
    // skipped then, so nothing moves) and was given another timbre (brightness, reverb, echo, width, room), starts exactly as a fresh engine
    // with that timbre does. The smoothed values of the sum (master gain, shelf, sends, bus gains) must not glide in from the old song's.
    // The limiter stays on: the compressors are reset when the engine falls quiet, so their state is a fresh one's too.
    {
        const char* OLD = R"({"master":{"brightness":0.1,"reverb":0.2,"echo":0.1,"width":0.1,"roomWet":0.1,"roomSize":0.1}})";
        const char* NEW = R"({"master":{"brightness":0.9,"reverb":0.9,"echo":0.6,"width":0.9,"roomWet":0.8,"roomSize":0.7}})";
        const auto started = [&](bool played) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(played ? OLD : NEW);
            engine.setTrack(track);
            engine.prepare(rate);
            btg::Transport t;
            if (played) {
                t.play(0.0, engine.bpm());
                render(engine, t, 1.0, 480);
                t.stop();
                render(engine, t, 6.0, 480); // the tones, the wet fade and the room's and echo's tails are over: quiet
                engine.setSound(NEW);
            }
            t.play(0.0, engine.bpm());
            return render(engine, t, 0.5, 480);
        };
        const Result again = started(true), fresh = started(false);
        double most = 0.0;
        for (size_t i = 0; i < fresh.left.size(); ++i) most = std::max(most, static_cast<double>(std::fabs(again.left[i] - fresh.left[i])));
        std::printf("new sound after a quiet stop: largest difference to a fresh engine %.3e\n", most);
        CHECK(fresh.peak > 0.01 && most == 0.0);
    }

    // A compressor that was left out of the chain starts empty when it comes back: its pre-delay ring would otherwise play up to 1024
    // frames of what went in before the switch (and the detector and gain would be stale). Play 2 s, switch off, play 1 s, switch on:
    // the compressor that comes back delivers exactly 0 for its first 288 frames (its pre-delay), not old audio. The limiter's switch
    // (setLimiter) brings back the limiter (default bus: old limiter alone) or both (on 1: glue first, limiter behind it: 576 frames);
    // the bus's switch (mix/bus on 1 -> 0 -> 1) brings back the glue only, so the limiter's own late frames (0..287) are still music
    // and the glue's silence reaches the output at 288..575.
    {
        const auto peakOf = [](const Result& r, size_t from, size_t to) { return *std::max_element(r.left.begin() + static_cast<long>(from), r.left.begin() + static_cast<long>(to), [](float a, float b) { return std::fabs(a) < std::fabs(b); }); };
        const auto afterSwitch = [&](const char* tuning, const char* off, bool limiterSwitch) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setTuning(tuning);
            engine.setTrack(track);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            render(engine, t, 2.0, 480);
            if (limiterSwitch) engine.setLimiter(false); else engine.setTuning(off);
            render(engine, t, 1.0, 480);
            if (limiterSwitch) engine.setLimiter(true); else engine.setTuning(tuning);
            return render(engine, t, 0.1, 480);
        };
        const char *ON = R"({"mix/bus":{"on":1}})", *OFF = R"({"mix/bus":{"on":0}})";
        const Result limiterOnly = afterSwitch(OFF, OFF, true), both = afterSwitch(ON, ON, true), glueOnly = afterSwitch(ON, OFF, false);
        CHECK(peakOf(limiterOnly, 0, 288) == 0.0f && std::fabs(peakOf(limiterOnly, 288, 2000)) > 0.01f);
        CHECK(peakOf(both, 0, 576) == 0.0f && std::fabs(peakOf(both, 576, 2000)) > 0.01f);
        CHECK(std::fabs(peakOf(glueOnly, 0, 288)) > 0.01f && peakOf(glueOnly, 288, 576) == 0.0f && std::fabs(peakOf(glueOnly, 576, 2000)) > 0.01f);
    }

    // Tempo extremes: all six layers (test packs), reverb, room (1 s) and echo up and every layer effect at 1 (fuzz, overdrive, distortion,
    // vibrato, chorus on bass, chords, pad and lead), the limiter on; at 20 and at 400 bpm, 20 s each: every
    // sample finite, and the render takes less than a quarter of the time it plays (the load limit of the plan; on CI, where the runners
    // are slower and shared, printed and not asserted: ruling S, CMake passes --ci when the environment has CI). The peak: the core's
    // limiter equals Chromium's compressor sample for sample (compressor-compare.mjs); with every effect on these loud synthetic packs
    // reach 0.412 (20 bpm) and 0.469 (400 bpm) at the fader's 0.7, which is a gain of 0.49 (the square), so about 0.84 and 0.96 before it
    // (Phase 3 measured 0.869 and 1.064 at the fader's 1 without the effects); no web render of these packs exists. The test asserts only
    // that the peak stays below 1.0 at the fader's 0.7 (about 2.0 before the fader: a runaway chain would not); "below full scale
    // at both tempos" is proven with the real packs in mix.json (mix-funk-20bpm, mix-funk-400bpm).
    // Both start at beat 64, where all six layers play (20 bpm for 20 s covers only 6.7 beats), and every layer has a peak after the render
    // (this also catches a pack that did not load). Then 400 bpm at 96 kHz (blocks of 480 frames), its load printed only: Phase 5's design
    // needs the figure (ruling S). And 400 bpm at 48 and 96 kHz with the e-piano on the chords (Task 21, design 6), printed only.
    {
        std::string band = track;
        for (const char* layer : { "chords", "pad", "lead", "percussion" }) {
            const std::string off = std::string("\"") + layer + "\":false";
            band.replace(band.find(off), off.size(), std::string("\"") + layer + "\":true");
        }
        band.replace(band.find("\"lead\":\"off\""), 12, "\"lead\":\"melody\""); // the lead layer plays only with a job
        const std::vector<btg::Event> events = btg::buildEvents(band);
        int layers = 0;
        for (const char* name : { "drums", "bass", "chords", "pad", "lead", "percussion" })
            layers += std::any_of(events.begin(), events.end(), [&](const btg::Event& e) { return e.layer == name; });
        CHECK(layers == 6);
        const bool onCi = argc > 2 && std::string(argv[2]) == "--ci";
        const char* EVERY = R"({"master":{"reverb":1,"echo":1,"roomWet":1,"roomSize":1},"bass":{"fuzz":1,"overdrive":1,"distortion":1,"vibrato":1,"chorus":1},
                "chords":{"fuzz":1,"overdrive":1,"distortion":1,"vibrato":1,"chorus":1},"pad":{"fuzz":1,"overdrive":1,"distortion":1,"vibrato":1,"chorus":1},
                "lead":{"fuzz":1,"overdrive":1,"distortion":1,"vibrato":1,"chorus":1}})";
        // And (Task 20) with the organ on the chords, the Leslie fast and the drive at 1, printed only. And (Task 22) with the classic synth
        // on bass, chords, pad and lead, dry (no send, no layer effect) and with every effect on, printed only.
        const char* CLASSIC4 = R"({"bass":{"id":"synth","variant":"classic"},"chords":{"id":"synth","variant":"classic"},"pad":{"id":"synth","variant":"classic"},"lead":{"id":"synth","variant":"classic"}})";
        const char* CHORDS[5] = { "", R"({"chords":{"id":"epiano","variant":"rhodes"}})", R"({"chords":{"id":"organ","variant":"jazz"}})", CLASSIC4, CLASSIC4 };
        const char* NAMES[5] = { "", " with the e-piano on the chords", " with the organ on the chords (Leslie fast, drive 1)",
                                 " with the classic synth on bass, chords, pad and lead, every effect on", " with the classic synth on bass, chords, pad and lead, dry" };
        for (const auto& [bpm, sr, chordsVoice] : { std::tuple { 20.0, rate, 0 }, std::tuple { 400.0, rate, 0 }, std::tuple { 400.0, 96000, 0 },
                                                    std::tuple { 400.0, rate, 1 }, std::tuple { 400.0, 96000, 1 }, std::tuple { 400.0, rate, 2 }, std::tuple { 400.0, 96000, 2 },
                                                    std::tuple { 400.0, rate, 3 }, std::tuple { 400.0, 96000, 3 }, std::tuple { 400.0, rate, 4 }, std::tuple { 400.0, 96000, 4 } }) {
            btg::Engine engine;
            engine.setPackSource(source);
            if (chordsVoice == 2) engine.setTuning(R"({"chords/organ/jazz":{"leslie":3,"drive":1}})");
            engine.setSound(chordsVoice == 4 ? DRY : EVERY);
            engine.setTrack(band);
            if (chordsVoice > 0) engine.setVoices(CHORDS[chordsVoice]);
            engine.setMaster(0.7f); // fader 0.7 = gain 0.49 (see above)
            engine.prepare(sr);
            btg::Transport t;
            t.play(64.0, bpm);
            const auto began = std::chrono::steady_clock::now();
            const Result r = render(engine, t, 20.0, 480, sr);
            const double load = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count() / 20.0;
            const bool asserted = sr == rate && !onCi && chordsVoice == 0;
            std::printf("tempo %.0f bpm at %d Hz%s: peak %.3f, load %.1f %%%s\n", bpm, sr, NAMES[chordsVoice], r.peak, 100 * load, asserted ? "" : " (not asserted)");
            CHECK(r.finite && r.peak < 1.0 && r.rms > 0.001);
            for (int l = 0; l < btg::Engine::layerCount; ++l) {
                const bool sounded = engine.takePeak(l) > 0.0f;
                if (!sounded) std::printf("tempo %.0f bpm: the layer %s is silent\n", bpm, btg::detail::LAYER_NAMES[l]);
                CHECK(sounded);
            }
            if (asserted) CHECK(load < 0.25);
        }
        // Printed only (Task 20b, what the second generation of the chains costs): the load of the 0.3 s after a restart under ringing tones
        // (the band as above at 400 bpm, restarted 2 s after beat 64, so that the old tones ring out on the four layers' old chains while the
        // new song runs through fresh ones), against the 0.3 s after a fresh start at the same place, at 48 and 96 kHz.
        for (const int sr : { rate, 96000 }) {
            double load[2];
            for (const bool restart : { false, true }) {
                btg::Engine engine;
                engine.setPackSource(source);
                engine.setSound(EVERY);
                engine.setTrack(band);
                engine.setMaster(0.7f);
                engine.prepare(sr);
                btg::Transport t;
                t.play(64.0, 400.0);
                if (restart) {
                    render(engine, t, 2.0, 480, sr);
                    t.play(64.0, 400.0);
                }
                const auto began = std::chrono::steady_clock::now();
                render(engine, t, 0.3, 480, sr);
                load[restart] = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count() / 0.3;
            }
            std::printf("restart under ringing tones at %d Hz, every effect on: load %.1f %% in the 0.3 s after it, %.1f %% after a fresh start (not asserted)\n",
                        sr, 100 * load[1], 100 * load[0]);
        }
        // The engine's wiring of the vibrato, absolute (review I-3): each of the four layers alone (the others muted), from beat 64 with no
        // lead, reverb, echo and room 0, no limiter, fader and master 1: what stands behind the chain is gains (trim, fader, balance, master
        // gain 0.6), the shelf at 0 dB (an identity up to double rounding) and sends with a wet gain of 0. So the render with only its vibrato
        // at 1 must equal ModFx (prepared, set at once with modParams(1, 0, tempo)) fed with the same render with the vibrato at 0 (each
        // channel through its own chain), from the first frame on, over 1.5 s. A scaled input gives a scaled output (ring, interpolation and gains are linear), so
        // the only difference left is float rounding: about a dozen roundings of 6e-8 of the signal each (the chain's three gains and two
        // sums, the interpolation, the engine's trim, balance, master gain and the shelf's cast), so 2e-6 of the render's peak is the
        // tolerance (about 30 steps at the peak). Bass at 60, 100 and 160 bpm (4, 5 and 5.5 Hz: modParams clamps from 120 bpm on); the
        // others at 100. The tempo is also shown to count: the 60 bpm render with the vibrato on does not equal ModFx at the tempo 160 (a
        // tempo that the engine took wrongly would not equal the right one). A layer's knob taken from another layer, a wrong tempo, or a
        // ramp instead of an at-once start fail here.
        // A tempo change in mid-play (review M-2): the bass at 60 bpm, the transport told 160 bpm after 0.75 s. The engine hands the new rate
        // to the chain at the first block rendered after the change (applyFx reads the tempo from that block's beatsPerFrame), frame 36000
        // here: so the render with the vibrato on equals ModFx set at once for 60 bpm and given set(modParams(1, 0, 160), false) at that
        // frame, fed the render with the vibrato at 0 (with the knob at 0 and at 1 the notes move the same way with the tempo), within the
        // same tolerance; and it does not equal the chain that never got the change.
        {
            const auto alone = [&](btg::Engine::Layer layer, double vibrato, double bpm, double toBpm = 0.0) {
                btg::Engine engine;
                engine.setPackSource(source);
                engine.setSound(std::string(R"({"master":{"reverb":0,"echo":0,"roomWet":0},")") + btg::detail::LAYER_NAMES[layer] + R"(":{"vibrato":)" + std::to_string(vibrato) + "}}");
                engine.setTrack(band);
                for (int l = 0; l < btg::Engine::layerCount; ++l) engine.setMuted(static_cast<btg::Engine::Layer>(l), l != layer);
                engine.setLimiter(false);
                engine.prepare(rate);
                btg::Transport t;
                t.play(64.0, bpm);
                if (toBpm == 0.0) return render(engine, t, 1.5, 480);
                Result r = render(engine, t, 0.75, 480);
                t.setTempo(toBpm);
                const Result rest = render(engine, t, 0.75, 480);
                r.left.insert(r.left.end(), rest.left.begin(), rest.left.end());
                r.right.insert(r.right.end(), rest.right.begin(), rest.right.end());
                r.peak = std::max(r.peak, rest.peak);
                return r;
            };
            const auto throughChain = [&](const Result& dry, double bpm, double toBpm = 0.0, size_t at = 0) {
                // each channel of the render through its own chain: the layer's balance (1 - pan, 1 + pan) stands behind the chain, so the
                // two sides carry different gains of the same mono signal
                Result r;
                r.left.resize(dry.left.size());
                r.right.resize(dry.left.size());
                std::vector<float> unused(dry.left.size());
                for (const bool side : { false, true }) {
                    btg::detail::ModFx chain;
                    chain.prepare(rate);
                    chain.set(btg::detail::modParams(1, 0, bpm), true);
                    const std::vector<float>& in = side ? dry.right : dry.left;
                    float* out = (side ? r.right : r.left).data();
                    const size_t first = toBpm > 0 ? at : in.size();
                    chain.process(in.data(), nullptr, out, unused.data(), static_cast<int>(first), false);
                    if (first == in.size()) continue;
                    chain.set(btg::detail::modParams(1, 0, toBpm), false);
                    chain.process(in.data() + first, nullptr, out + first, unused.data(), static_cast<int>(in.size() - first), false);
                }
                return r;
            };
            const auto worst = [](const Result& a, const Result& b) {
                double m = 0.0;
                for (size_t i = 0; i < a.left.size(); ++i) {
                    m = std::max(m, static_cast<double>(std::fabs(a.left[i] - b.left[i])));
                    m = std::max(m, static_cast<double>(std::fabs(a.right[i] - b.right[i])));
                }
                return m;
            };
            for (const auto layer : { btg::Engine::bass, btg::Engine::chords, btg::Engine::pad, btg::Engine::lead })
                for (const double bpm : { 60.0, 100.0, 160.0 }) {
                    if (layer != btg::Engine::bass && bpm != 100.0) continue;
                    const Result off = alone(layer, 0.0, bpm), on = alone(layer, 1.0, bpm);
                    const double error = worst(on, throughChain(off, bpm)), effect = worst(on, off), tolerance = 2e-6 * off.peak;
                    std::printf("wiring %s at %.0f bpm: peak %.4f, effect of the vibrato %.4f, error against ModFx %.2e (tolerance %.2e)\n",
                                btg::detail::LAYER_NAMES[layer], bpm, off.peak, effect, error, tolerance);
                    CHECK(off.peak > 1e-3 && effect > 0.01 * off.peak && error <= tolerance);
                    if (layer == btg::Engine::bass && bpm == 60.0) CHECK(worst(on, throughChain(off, 160.0)) > 0.01 * off.peak);
                }
            const Result off = alone(btg::Engine::bass, 0.0, 60.0, 160.0), on = alone(btg::Engine::bass, 1.0, 60.0, 160.0);
            const double error = worst(on, throughChain(off, 60.0, 160.0, 36000)), unchanged = worst(on, throughChain(off, 60.0)), tolerance = 2e-6 * off.peak;
            std::printf("wiring bass from 60 to 160 bpm: peak %.4f, error against ModFx changed at frame 36000 %.2e (tolerance %.2e), against ModFx left at 60 bpm %.4f\n",
                        off.peak, error, tolerance, unchanged);
            CHECK(off.left.size() == 72000 && error <= tolerance && unchanged > 0.01 * off.peak);
            // In two channels (Task 20b): the chords play a two-channel pack (stereoTone), so their chains run in two from the start
            // (Voice::stereo). The chords alone as above at 100 bpm, their pan 0 (the balance then scales both sides by 1). Chorus 1: the
            // render equals ModFx in two channels (set at once with modParams(0, 1, 100)) fed the two channels of the render with the chorus
            // at 0, from the first frame, within the tolerance above (the copies' panners mix the sides, so each channel through its own
            // chain, which holds for the vibrato, does not hold here). Distortion 1 (not linear: the gains behind the chain cannot be taken
            // out of its input): the render's left equals that of the mono pack of the left channel alone, its right that of the right
            // channel alone, bit for bit (each channel has its own filter and shaper states, the gains are one). Red when the chains of a
            // two-channel voice run on its left channel only.
            const auto stereoChords = [&](std::shared_ptr<const btg::Pack> pack, const char* sound) {
                btg::Engine engine;
                engine.setPackSource([pack](const std::string& id) { return id == "chords-funk" ? pack : source(id); });
                engine.setSound(sound);
                engine.setTrack(band);
                for (int l = 0; l < btg::Engine::layerCount; ++l) engine.setMuted(static_cast<btg::Engine::Layer>(l), l != btg::Engine::chords);
                engine.setPan(btg::Engine::chords, 0.0f);
                engine.setLimiter(false);
                engine.prepare(rate);
                btg::Transport t;
                t.play(64.0, 100.0);
                return render(engine, t, 1.5, 480);
            };
            const char *CHORUS = R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"chorus":1}})", *DISTORTED = R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"distortion":1}})";
            const Result dry = stereoChords(stereoTone(), DRY), chorused = stereoChords(stereoTone(), CHORUS);
            Result expected;
            expected.left.resize(dry.left.size());
            expected.right.resize(dry.left.size());
            btg::detail::ModFx chain;
            chain.prepare(rate);
            chain.set(btg::detail::modParams(0, 1, 100), true);
            chain.process(dry.left.data(), dry.right.data(), expected.left.data(), expected.right.data(), static_cast<int>(dry.left.size()), true);
            const double chorusError = worst(chorused, expected), sides = worst({ dry.left, dry.left }, { dry.right, dry.right });
            std::printf("wiring chords in two channels: peak %.4f, the sides differ by %.4f, chorus 1 against ModFx in two channels %.2e (tolerance %.2e)\n",
                        dry.peak, sides, chorusError, 2e-6 * dry.peak);
            CHECK(dry.peak > 1e-3 && sides > 0.1 * dry.peak && chorusError <= 2e-6 * dry.peak);
            const Result both = stereoChords(stereoTone(), DISTORTED), leftAlone = stereoChords(tonePack(57, 0.3f, 0.3, 200), DISTORTED),
                         rightAlone = stereoChords(tonePack(57, 0.3f, 0.3, 160), DISTORTED);
            std::printf("wiring chords in two channels, distortion 1: left against the left channel's mono pack %.2e, right against the right one's %.2e (peak %.4f)\n",
                        worst({ both.left, both.left }, { leftAlone.left, leftAlone.left }), worst({ both.right, both.right }, { rightAlone.right, rightAlone.right }), both.peak);
            CHECK(both.peak > 1e-3 && both.left == leftAlone.left && both.right == rightAlone.right && both.right != leftAlone.right);
        }
        // The echo's time in the engine, with the pad alone (sustained sines, echo 1, reverb and room 0, no limiter).
        std::string pad = band;
        for (const char* layer : { "drums", "bass", "chords", "lead", "percussion" }) {
            const std::string on = std::string("\"") + layer + "\":true";
            pad.replace(pad.find(on), on.size(), std::string("\"") + layer + "\":false");
        }
        const auto engineWith = [&](const char* sound) {
            auto e = std::make_unique<btg::Engine>();
            e->setPackSource(source);
            e->setSound(sound);
            e->setTrack(pad);
            e->setLimiter(false);
            e->prepare(rate);
            return e;
        };
        const char* ECHO = R"({"master":{"reverb":0,"echo":0.25,"roomWet":0}})"; // feedback 0.24: the repeats die within a second
        const char* NO_ECHO = R"({"master":{"reverb":0,"echo":0,"roomWet":0}})";
        // A start sets the time at once, never glides from the old tempo: an engine that played at 120 bpm, stopped and starts at 60 bpm
        // sounds exactly as a fresh one started at 60 bpm (a glide from 0.375 s to 0.75 s would show for the first 0.3 s).
        {
            auto used = engineWith(ECHO), fresh = engineWith(ECHO);
            btg::Transport t, t2;
            t.play(0.0, 120.0);
            render(*used, t, 2.0, 480);
            t.stop();
            render(*used, t, 0.3, 480);
            t.play(0.0, 60.0);
            t2.play(0.0, 60.0);
            const Result a = render(*used, t, 3.0, 480), b = render(*fresh, t2, 3.0, 480);
            double most = 0.0;
            for (size_t i = 0; i < a.left.size(); ++i) most = std::max(most, static_cast<double>(std::fabs(a.left[i] - b.left[i])));
            CHECK(b.peak > 0.01 && most == 0.0);
        }
        // A start inside the wet fade does not click: a restart from 120 to 60 bpm with no stopped block between (the web UI's stop and play
        // back to back), and a start 20 ms after a stop (30 ms of the fade left). The old song's echoes are still in the line and fade out
        // over the 50 ms; the echo's time must not jump under them (a jump from 0.375 s to 0.75 s steps the sines): the wet part (echo minus
        // its dry twin, which restarts the same way) has no step over the 50 ms from the start above 0.08 of its level (the bound of the glide
        // check below; 0.03 is a clean 240 Hz sine; measured 0.013). From the end of the fade the sends are empty and the time is the new
        // tempo's: against a fresh engine at 60 bpm the output is the same where no echo of the new song's first 50 ms (cleared with the old
        // echoes, ruled) can be: from 0.2 s (the choke tails of the old tones, up to 0.02 at 50 ms, ring until 0.24 s: measured 3.8e-7 at
        // most) to the first echo at 0.75 s, within 1e-6; and from 0.85 s to 1.4 s (the echo of what came after 50 ms, which a time still at 0.375 s would put somewhere
        // else) within 2e-4 (the old tails' own echoes; measured 8e-5; the echo itself is 0.07).
        for (const double gap : { -1.0, 0.02 }) {
            const auto played = [&](const char* sound) {
                auto e = engineWith(sound);
                btg::Transport t;
                t.play(0.0, 120.0);
                render(*e, t, 2.0, 480);
                if (gap >= 0) {
                    t.stop();
                    render(*e, t, gap, 480);
                }
                t.play(0.0, 60.0);
                return render(*e, t, 1.5, 480).left;
            };
            const std::vector<float> echoed = played(ECHO), dry = played(NO_ECHO);
            double level = 0.0, step = 0.0;
            for (size_t i = 1; i < 2400; ++i) {
                level = std::max(level, static_cast<double>(std::fabs(echoed[i] - dry[i])));
                step = std::max(step, static_cast<double>(std::fabs((echoed[i] - dry[i]) - (echoed[i - 1] - dry[i - 1]))));
            }
            auto fresh = engineWith(ECHO);
            btg::Transport t2;
            t2.play(0.0, 60.0);
            const std::vector<float> reference = render(*fresh, t2, 1.5, 480).left;
            double early = 0.0, late = 0.0, heard = 0.0;
            for (size_t i = 9600; i < 36000; ++i) early = std::max(early, static_cast<double>(std::fabs(echoed[i] - reference[i])));
            for (size_t i = 40800; i < 67200; ++i) { late = std::max(late, static_cast<double>(std::fabs(echoed[i] - reference[i]))); heard = std::max(heard, static_cast<double>(std::fabs(reference[i] - dry[i]))); }
            std::printf("echo start (gap %.2f): step %.3f of level %.4f, same as fresh: %.2e (0.2 to 0.75 s), %.2e (0.85 to 1.4 s, echo level %.4f)\n", gap, level > 0 ? step / level : 0.0, level, early, late, heard);
            CHECK(level > 0.005 && step < 0.08 * level);
            CHECK(early < 1e-6 && late < 2e-4 && heard > 0.005);
        }
        // A tempo change while playing glides: the wet part (echo minus its dry twin) of a pad that plays at 60 bpm and goes to 70 bpm at
        // 1.5 s has no jump (its largest step from one frame to the next stays below 0.08 of its level over the next 0.2 s; a jump of the
        // echo's time from 0.75 s to 0.643 s breaks the sines by a good part of their level), and the glide arrives: from 2.6 s (the repeats
        // of the glide have died) the wet part equals that of an engine that played at 70 bpm from the start (the pad's sine starts with its note).
        {
            const auto wetPart = [&](double startBpm, double changeAt, double toBpm) {
                auto e = engineWith(ECHO), dry = engineWith(NO_ECHO);
                btg::Transport t[2];
                std::vector<double> out[2];
                std::unique_ptr<btg::Engine>* both[2] = { &e, &dry };
                for (int k = 0; k < 2; ++k) t[k].play(0.0, startBpm);
                const auto run = [&](double seconds) { for (int k = 0; k < 2; ++k) for (const float x : render(**both[k], t[k], seconds, 480).left) out[k].push_back(x); };
                if (changeAt > 0) { run(changeAt); for (btg::Transport& x : t) x.setTempo(toBpm); run(3.4 - changeAt); } else run(3.4);
                for (size_t i = 0; i < out[0].size(); ++i) out[0][i] -= out[1][i];
                return out[0];
            };
            const std::vector<double> changed = wetPart(60.0, 1.5, 70.0), steady = wetPart(70.0, 0.0, 0.0);
            const size_t from = static_cast<size_t>(1.5 * rate), to = from + rate / 5;
            double level = 0.0, step = 0.0;
            for (size_t i = from; i < to; ++i) { level = std::max(level, std::fabs(changed[i])); step = std::max(step, std::fabs(changed[i] - changed[i - 1])); }
            double gap = 0.0, rms = 0.0;
            for (size_t i = static_cast<size_t>(2.6 * rate); i < static_cast<size_t>(3.3 * rate); ++i) { gap += (changed[i] - steady[i]) * (changed[i] - steady[i]); rms += steady[i] * steady[i]; }
            std::printf("echo glide: step %.3f of level %.4f, settled gap %.4f of rms\n", step / level, level, std::sqrt(gap / rms));
            CHECK(level > 0.005 && step < 0.08 * level); // measured 0.030; a jump of the time: 0.137
            CHECK(std::sqrt(gap / rms) < 0.15); // measured 0.068 (the note's length in seconds is fixed when it starts); a time that never arrives: 1.74
        }
    }

    // Live: a new track, a jump and a loop while playing do not break the stream.
    btg::Engine engine;
    engine.setPackSource(source);
    engine.setSound(DRY);
    engine.setTrack(track);
    engine.prepare(rate);
    btg::Transport live;
    live.play(0.0, engine.bpm());
    CHECK(render(engine, live, 2.0, 480).rms > 0.005);
    engine.setTrack(track);
    live.setTempo(180.0);
    live.seek(40.0);
    CHECK(render(engine, live, 2.0, 480).rms > 0.005);
    live.setLoop(40.0, 44.0);
    const Result looped = render(engine, live, 6.0, 480);
    CHECK(looped.rms > 0.005 && looped.peak <= 1.0);
    CHECK(live.beats() >= 40.0 && live.beats() < 44.0);
    live.stop();
    CHECK(render(engine, live, 1.0, 480).left.back() == 0.0f); // silent a second after the stop

    // A new start restarts the voices also when no stopped block falls between stop and play (the web UI's restart sends
    // stop, track, play back to back): 0.5 s after it, the engine sounds as a fresh one started there.
    {
        const auto from64 = [&](bool playedBefore) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(DRY);
            engine.setTrack(track);
            // its subject is the voices: the compressors keep their state across a restart without a stopped block (design open point 7), and
            // their gain remembers more than 0.5 s of the music before, which the peak follower of Phase 2 did not
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            if (playedBefore) {
                t.play(0.0, engine.bpm());
                render(engine, t, 1.0, 480);
            }
            t.play(64.0, engine.bpm());
            return render(engine, t, 2.0, 480);
        };
        const Result fresh = from64(false), restarted = from64(true);
        double most = 0.0;
        for (size_t i = rate / 2; i < fresh.left.size(); ++i) most = std::max(most, static_cast<double>(std::fabs(fresh.left[i] - restarted.left[i])));
        CHECK(most < 1e-6);
    }

    // The voice chosen plays (upright: the same test pack as finger, level 3 instead of 4 in tunables.js), a fine value acts
    // and is clamped, a voice the core does not have is silent and says so. Drums muted, no limiter: the bass alone, linear.
    const auto bassOnly = [&](const char* voices, const char* tuning) {
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(DRY);
        engine.setTrack(track);
        engine.setVoices(voices);
        engine.setTuning(tuning);
        engine.setMuted(btg::Engine::drums, true);
        engine.setLimiter(false);
        engine.prepare(rate);
        btg::Transport t;
        t.play(64.0, engine.bpm());
        const double rms = render(engine, t, 5.0, 480).rms;
        return std::make_pair(rms, engine.voiceStatus());
    };
    const char* finger = R"({"bass":{"id":"sample","variant":"finger"}})";
    const auto plain = bassOnly(finger, "{}");
    const auto upright = bassOnly(R"({"bass":{"id":"sample","variant":"upright"}})", "{}");
    const auto quieter = bassOnly(finger, R"({"bass/sample/finger":{"level":2}})");
    const auto clamped = bassOnly(finger, R"({"bass/sample/finger":{"level":100}})");
    const auto broken = bassOnly(finger, "not json");
    const auto synth = bassOnly(R"({"bass":{"id":"none","variant":"none"}})", "{}"); // a key no voice has (Task 22: synth/classic plays)
    CHECK(plain.first > 0.005);
    // Linear only to about 0.1 %: a tone's release ends at an absolute floor of 0.0001, as in the web (sampler.js FLOOR).
    CHECK(std::fabs(upright.first / plain.first / 0.75 - 1) < 3e-3); // same draws (fork "voice-bass" of seed 1), only the level differs
    CHECK(std::fabs(quieter.first / plain.first / 0.5 - 1) < 3e-3);
    CHECK(std::fabs(clamped.first / plain.first / 2.0 - 1) < 3e-3);  // level is at most 8
    CHECK(broken.first == plain.first);                          // a tuning that is not JSON counts as none
    CHECK(synth.first == 0.0 && synth.second.find(R"("bass":"silent")") != std::string::npos);
    CHECK(plain.second.find(R"({"drums":"ready","bass":"ready",)") == 0);

    // Review Focus 1: a pack that is missing or cut off. Its layer is silent and says which pack and why; the others play.
    {
        btg::Engine engine;
        engine.setPackSource([](const std::string& id) -> std::shared_ptr<const btg::Pack> {
            static const unsigned char none[8] = {};
            if (id == "pad-strings") return btg::loadPackFiles("no-such-folder", id);                                        // the file is missing
            if (id == "chords-funk") return std::make_shared<const btg::Pack>(btg::loadPack(R"({"samples":[{"offset":0,)", none, sizeof none)); // the JSON is cut off
            return source(id);
        });
        engine.setSound(DRY);
        engine.setTrack(track);
        const std::string status = engine.voiceStatus();
        CHECK(status.find(R"("pad":"error: pad-strings: pack: cannot open no-such-folder/pad-strings.json")") != std::string::npos);
        CHECK(status.find(R"("chords":"error: chords-funk: )") != std::string::npos);
        CHECK(status.find(R"({"drums":"ready","bass":"ready",)") == 0);
        engine.prepare(rate);
        btg::Transport t;
        t.play(64.0, engine.bpm());
        const Result r = render(engine, t, 5.0, 480);
        CHECK(std::isfinite(r.rms) && r.rms > 0.01);
    }

    // A damaged pack (a sample rate that is zero, negative or infinite; loop points outside the sample; an offset that does not fit an int
    // or whose sum with the frames overflows) is an error of its layer: the status names the pack, the other layers play with finite samples.
    {
        const char* damaged[] = {
            R"({"offset":0,"frames":8,"rate":0})",
            R"({"offset":0,"frames":8,"rate":-44100})",
            R"({"offset":0,"frames":8,"rate":1e999})",
            R"({"offset":0,"frames":8,"loopStart":-1,"loopEnd":4})",
            R"({"offset":0,"frames":8,"loopStart":2,"loopEnd":9})",
            R"({"offset":0,"frames":8,"loopStart":9,"loopEnd":0})",
            R"({"offset":0,"frames":8,"loopStart":0,"loopEnd":-3})",
            R"({"offset":2000000000,"frames":2000000000})",  // 1e9 + 2e9 frames overflows an int
            R"({"offset":4294967296,"frames":8})",           // 2^32 bytes: truncated to 0 by a cast to int
            R"({"offset":9223372036854775807,"frames":9223372036854775807})", // offset/2 + frames overflows even a long long
            R"({"offset":0,"frames":8,"rate":1e-300})",      // a rate outside 1000 .. 1000000 Hz makes frames / rate huge
            R"({"offset":0,"frames":8,"rate":5e6})",
        };
        static const unsigned char audio[16] = {};
        for (const char* sample : damaged) {
            const std::string text = std::string(R"({"version":1,"samples":[)") + sample + R"(],"zones":[{"sample":0}]})";
            bool threw = false;
            try { btg::loadPack(text, audio, sizeof audio); } catch (const std::exception&) { threw = true; }
            CHECK(threw);
            if (!threw) std::printf("  not rejected: %s\n", sample);
            btg::Engine engine;
            engine.setPackSource([&](const std::string& id) -> std::shared_ptr<const btg::Pack> {
                if (id == "pad-strings") return std::make_shared<const btg::Pack>(btg::loadPack(text, audio, sizeof audio));
                return source(id);
            });
            engine.setSound(DRY);
            engine.setTrack(track);
            CHECK(engine.voiceStatus().find(R"("pad":"error: pad-strings: )") != std::string::npos);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            const Result r = render(engine, t, 2.0, 480);
            CHECK(std::isfinite(r.rms) && r.rms > 0.01);
        }
        // an id that is not a plain name never reaches the file system: the folder does not exist, yet the reason is the id
        for (const char* id : { "", "..", "../x", "a/b", "a\\b", "C:x", "a..b", "a b", "x.json/../y" }) {
            std::string reason;
            try { btg::loadPackFiles("no-such-folder", id); } catch (const std::exception& error) { reason = error.what(); }
            CHECK(reason.find("not a plain name") != std::string::npos);
        }
        // a good pack is still taken: loop points at the edges of the sample
        const char* fine = R"({"version":1,"samples":[{"offset":0,"frames":8,"rate":44100,"loopStart":0,"loopEnd":8}],"zones":[{"sample":0,"loop":true}]})";
        CHECK(btg::loadPack(fine, audio, sizeof audio).samples.size() == 1);
    }

    // Review Focus 2: the bass changes its voice in every block for 10 s. Old tones ring out and nothing clicks: the second
    // difference of these sines stays below 0.01; a cut tone jumps by its amplitude (0.1 and more). The voice does change:
    // the pick's test pack has half the amplitude, so the run is clearly quieter than with the finger voice alone.
    {
        double rms[2] = {};
        for (const bool alternate : { true, false }) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(DRY);
            engine.setTrack(track);
            engine.setMuted(btg::Engine::drums, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            std::vector<float> l(480), r(480), out;
            for (int block = 0; block < 1000; ++block) {
                engine.setVoices(alternate && block % 2 ? R"({"bass":{"id":"sample","variant":"pick"}})" : R"({"bass":{"id":"sample","variant":"finger"}})");
                const auto b = t.advance(480, rate);
                engine.render(l.data(), r.data(), b.frames, b);
                out.insert(out.end(), l.begin(), l.begin() + b.frames);
            }
            bool finite = true;
            double jump = 0.0, squares = 0.0;
            for (size_t i = 2; i < out.size(); ++i) {
                finite = finite && std::isfinite(out[i]);
                jump = std::max(jump, std::fabs(out[i] - 2.0 * out[i - 1] + out[i - 2]));
                squares += static_cast<double>(out[i]) * out[i];
            }
            rms[alternate ? 0 : 1] = std::sqrt(squares / static_cast<double>(out.size()));
            CHECK(finite);
            CHECK(jump < 0.01); // -40 dBFS
            CHECK(rms[alternate ? 0 : 1] > 0.005);
            CHECK(engine.voiceStatus().find(R"("bass":"ready")") != std::string::npos);
        }
        CHECK(std::fabs(rms[0] / rms[1] - 1) > 0.1);
    }

    // Review Focus 4: a jump or a loop wrap while a pad chord is held. The held tones end at once, 2.5 s later the output is
    // below -60 dBFS. The pad switches to a silent voice at the jump, so only what sounded before can still be heard.
    {
        std::string band = track;
        band.replace(band.find(R"("pad":false)"), 11, R"("pad":true)");
        double from = -1.0; // beat of the first pad note of at least 2 s (track-funk: 100 bpm; the same product as setTrack, to the bit)
        for (const btg::Event& e : btg::buildEvents(band))
            if (e.type == btg::Event::Type::note && e.layer == "pad" && e.dur >= 2.0) { from = e.t * (100.0 / 60.0); break; }
        CHECK(from >= 0.0);
        for (const bool loop : { false, true }) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(DRY);
            engine.setTrack(band);
            engine.setMuted(btg::Engine::drums, true);
            engine.setMuted(btg::Engine::bass, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            t.play(from, engine.bpm());
            CHECK(render(engine, t, 0.3, 480).rms > 0.001); // the pad sounds
            engine.setVoices(R"({"pad":{"id":"none","variant":"none"}})"); // a key no voice has
            if (loop) t.setLoop(from - 4.0, from + 1.0); else t.seek(from + 8.0);
            const Result after = render(engine, t, 2.6, 480);
            double tail = 0.0; // the last 0.1 s
            for (size_t i = after.left.size() - rate / 10; i < after.left.size(); ++i) tail = std::max(tail, static_cast<double>(std::fabs(after.left[i])));
            CHECK(tail < 0.001);
        }
        // A block that stands still where the last one ended (btg_render's 0.2 s after the song) is no jump: the held pad tone keeps
        // its level. One frame further on (1/28800 beat at 100 bpm, 48 kHz) is a jump, and the tone's release begins.
        for (const double off : { 0.0, 1.0 / 28800 }) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(DRY);
            engine.setTrack(band);
            engine.setMuted(btg::Engine::drums, true);
            engine.setMuted(btg::Engine::bass, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            t.play(from, engine.bpm());
            std::vector<float> l(480), r(480), out;
            btg::Transport::Block last;
            for (int i = 0; i < 60; ++i) { // 0.6 s: past the swell (0.37 s) of the chord held for 2.4 s
                last = t.advance(480, rate);
                engine.render(l.data(), r.data(), last.frames, last);
                out.insert(out.end(), l.begin(), l.begin() + last.frames);
            }
            const btg::Transport::Block stand { true, last.beats + last.frames * last.beatsPerFrame + off, 0.0, 480, last.starts };
            for (int i = 0; i < 50; ++i) { // 0.5 s
                engine.render(l.data(), r.data(), stand.frames, stand);
                out.insert(out.end(), l.begin(), l.end());
            }
            const auto rms = [&](size_t at) { double s = 0.0; for (size_t i = at; i < at + rate / 10; ++i) s += static_cast<double>(out[i]) * out[i]; return std::sqrt(s / (rate / 10)); };
            // the last 0.1 s against the 0.1 s before the stand (measured 0.985 and 0.136; the chord's three sines beat a little)
            const double kept = rms(out.size() - rate / 10) / rms(28800 - rate / 10);
            CHECK(off == 0.0 ? kept > 0.9 : kept < 0.5);
        }
    }

    // A slide's tone begins before its note (the lead). A start, a seek or a loop that lands on the note still plays it, with what
    // is left of the lead. Until the jump the bass plays a silent voice, so the 0.1 s after it hold only the slide's tone.
    {
        double slide = -1.0; // beat of the first bass slideIn with a lead (track-funk: 100 bpm)
        for (const btg::Event& e : btg::buildEvents(track))
            if (e.type == btg::Event::Type::note && e.layer == "bass" && e.art == "slideIn" && e.t > 0.02) { slide = e.t * (100.0 / 60.0); break; }
        CHECK(slide > 0.0);
        for (const int how : { 0, 1, 2 }) { // start there, seek there, a loop that starts there wraps
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(DRY);
            engine.setTrack(track);
            engine.setMuted(btg::Engine::drums, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            if (how > 0) {
                engine.setVoices(R"({"bass":{"id":"none","variant":"none"}})"); // a key no voice has
                if (how == 2) t.setLoop(slide, slide + 1.0);
                t.play(how == 1 ? slide - 8.0 : slide + 0.5, engine.bpm());
                render(engine, t, 0.3, 480); // the loop: up to its end
                engine.setVoices(R"({"bass":{"id":"sample","variant":"finger"}})");
                if (how == 1) t.seek(slide);
            } else {
                t.play(slide, engine.bpm());
            }
            const Result after = render(engine, t, 0.15, 480);
            double squares = 0.0; // 0.02 s to 0.12 s: the slide's note is 0.13 s long
            for (int i = rate / 50; i < rate * 12 / 100; ++i) squares += static_cast<double>(after.left[i]) * after.left[i];
            CHECK(std::sqrt(squares / (rate / 10)) > 0.01);
        }
    }

    // A format-1 kit plays through the key table of sound.json (hitKeys "drums").
    {
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(DRY);
        engine.setTrack(track);
        engine.setVoices(R"({"drums":{"id":"sample","variant":"brushes"}})");
        engine.setMuted(btg::Engine::bass, true);
        engine.prepare(rate);
        btg::Transport t;
        t.play(64.0, engine.bpm());
        CHECK(engine.voiceStatus().find(R"({"drums":"ready",)") == 0);
        CHECK(render(engine, t, 5.0, 480).rms > 0.01);
    }

    // Chokes land on the web's time: a self-choke 0.1 s after the hit's own start, a closed hat at its own time on an open hat that began
    // earlier in the same chunk (the tone's frame count starts at its own start, not at the chunk's). Both formats; a constant sample,
    // so the choke is the frame where the level has fallen by 1 %. At 12 ms time constant that is 6 frames after the choke begins.
    for (const bool v2 : { true, false }) {
        using namespace btg::detail;
        const std::string key = v2 ? "drums/sample/standard" : "drums/sample/brushes";
        const auto voice = makeVoice(btg::Engine::drums, key, dcKit(v2), {}, Timbre {});
        CHECK(voice != nullptr);
        if (!voice) continue;
        const auto nameIndex = [](const char* name) { return static_cast<int>(std::find_if(std::begin(HIT_NAMES), std::end(HIT_NAMES), [&](const char* n) { return std::string(n) == name; }) - std::begin(HIT_NAMES)); };
        const auto fallsAt = [&](Tone& tone) { // frame of the first fall below 99 % of the plateau
            std::vector<float> l(20000), r(20000);
            tone.render(l.data(), r.data(), 20000);
            size_t top = 0;
            for (size_t i = 0; i < l.size(); ++i) if (l[i] > l[top]) top = i;
            for (size_t i = top; i < l.size(); ++i) if (l[i] < 0.99f * l[top]) return static_cast<int>(i);
            return -1;
        };
        {   // a crash with art choke 0.1 s that starts at frame 200 of its chunk
            auto tones = std::make_unique<Tones>();
            tones->sr = rate;
            VoiceState state;
            state.rng = voice->startRng;
            PlayEvent e;
            e.hit = true;
            e.name = nameIndex("crash");
            e.vel = 1.0;
            e.art = Art::choke;
            e.artTime = 0.1;
            voice->play(e, 200, 0.5, state, *tones);
            const int at = fallsAt(tones->all[0]);
            CHECK(std::abs(at - (200 + 4800)) < 48); // 0.1 s after its own start, within 1 ms
        }
        if (v2) continue; // the closing hat's rule is format 1's
        {   // an open hat at frame 100, a closed hat at frame 250 of the same chunk
            auto tones = std::make_unique<Tones>();
            tones->sr = rate;
            VoiceState state;
            state.rng = voice->startRng;
            PlayEvent e;
            e.hit = true;
            e.vel = 1.0;
            e.name = nameIndex("openHat");
            voice->play(e, 100, 0.5, state, *tones);
            e.name = nameIndex("hat");
            voice->play(e, 250, 0.5, state, *tones);
            const int at = fallsAt(tones->all[0]);
            CHECK(std::abs(at - 250) < 48); // at the closed hat's time, within 1 ms
        }
    }

    // A hand-filled first block that stands still (beatsPerFrame 0) between a slide's trigger and its note. A still block plays only
    // such a late event (on the regular path its events would lie before the place, which no first block has); with no step to divide
    // by, it starts at frame 0. Unguarded, (ahead - lead) / 0 is +inf and its cast to int undefined: ARM64 saturates to INT_MAX (the tone
    // never starts), x64 gives INT_MIN (it starts at once as well).
    {
        double slide = -1.0, lead = 0.0;
        for (const btg::Event& e : btg::buildEvents(track))
            if (e.type == btg::Event::Type::note && e.layer == "bass" && e.art == "slideIn" && e.t > 0.02) {
                slide = e.t * (100.0 / 60.0);
                lead = std::min(e.artTime ? *e.artTime : 0.08, e.t) * (100.0 / 60.0);
                break;
            }
        CHECK(slide > 0.0 && lead > 0.0);
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(DRY);
        engine.setTrack(track);
        engine.setMuted(btg::Engine::drums, true);
        engine.setLimiter(false); // no look-ahead: frame 0 of the output is frame 0 of the tone
        engine.prepare(rate);
        std::vector<float> l(480), r(480);
        const btg::Transport::Block still { true, slide - lead / 2, 0.0, 480, 1 };
        engine.render(l.data(), r.data(), still.frames, still);
        double squares = 0.0;
        for (int i = 0; i < 200; ++i) squares += static_cast<double>(l[i]) * l[i];
        CHECK(std::sqrt(squares / 200) > 0.01); // the first 200 frames: silent when the tone starts anywhere after them
    }

    // The balance of the web mixer: left 1 - p, right 1 + p. A pan of NaN puts the layer where mix/pan says.
    const auto sides = [&](btg::Engine::Layer layer, const char* voices, float pan, const char* tuning) {
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(DRY);
        engine.setTrack(track);
        engine.setVoices(voices);
        engine.setTuning(tuning);
        engine.setMuted(layer == btg::Engine::bass ? btg::Engine::drums : btg::Engine::bass, true);
        engine.setLimiter(false);
        engine.setPan(layer, pan);
        engine.prepare(rate);
        btg::Transport t;
        t.play(64.0, engine.bpm());
        const Result r = render(engine, t, 5.0, 480);
        return r.rmsRight / r.rms;
    };
    const char* fingerBass = R"({"bass":{"id":"sample","variant":"finger"}})";
    CHECK(std::fabs(sides(btg::Engine::bass, fingerBass, 0.5f, "{}") - 3.0) < 0.01);                                       // 1.5 / 0.5
    CHECK(std::fabs(sides(btg::Engine::bass, fingerBass, NAN, "{}") - 1.0) < 0.01);                                        // mix/pan bass: 0
    CHECK(std::fabs(sides(btg::Engine::bass, fingerBass, NAN, R"({"mix/pan":{"bass":-0.5}})") - 1.0 / 3.0) < 0.01);
    // Kit pan: a format-1 kit spreads its hits by mix/pan "kit" (hi-hat right, crash and floor tom left); a format-2 kit (kitPan 0) does not.
    const char* brushes = R"({"drums":{"id":"sample","variant":"brushes"}})";
    const char* standard = R"({"drums":{"id":"sample","variant":"standard"}})";
    CHECK(std::fabs(sides(btg::Engine::drums, brushes, 0.0f, R"({"mix/pan":{"kit":0}})") - 1.0) < 1e-6);
    CHECK(sides(btg::Engine::drums, brushes, 0.0f, "{}") > 1.02);
    CHECK(std::fabs(sides(btg::Engine::drums, standard, 0.0f, "{}") - sides(btg::Engine::drums, standard, 0.0f, R"({"mix/pan":{"kit":0}})")) < 1e-9);

    // setSound: master.width spreads the layers (synth.js 173: mix.width = 2 * master.width times the pan, then clamped): width 0 is mono,
    // 1 doubles the bass's pan of 0.25 to 0.5 (1.5 / 0.5), the neutral 0.5 keeps it (1.25 / 0.75). A timbre that is no JSON is the neutral one.
    // The timbres are dry (reverb, echo and room at 0) so that only the dry layers are measured, also once the sends exist (Task 14).
    {
        const auto ratio = [&](const char* sound) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(sound);
            engine.setTrack(track);
            engine.setMuted(btg::Engine::drums, true);
            engine.setLimiter(false);
            engine.setPan(btg::Engine::bass, 0.25f);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            const Result r = render(engine, t, 5.0, 480);
            return r.rmsRight / r.rms;
        };
        CHECK(std::fabs(ratio(R"({"master":{"width":0,"reverb":0,"echo":0,"roomWet":0}})") - 1.0) < 1e-6);
        CHECK(std::fabs(ratio(R"({"master":{"width":1,"reverb":0,"echo":0,"roomWet":0}})") - 3.0) < 0.01);
        CHECK(std::fabs(ratio(R"({"master":{"reverb":0,"echo":0,"roomWet":0}})") - 1.25 / 0.75) < 0.01);
        CHECK(ratio("no json") == ratio("{}"));
    }
    // Review Focus 5, pitch: the bass test tone (a 200-frame sine at 22050 Hz, root key 45: 110.25 Hz) at key 57 is 220.5 Hz at 44.1, 48
    // and 96 kHz, within 2 cents, measured between the first and the last upward zero crossing after 0.1 s.
    for (const double sr : { 44100.0, 48000.0, 96000.0 }) {
        const auto pack = tonePack(45, 0.5f, 0.2);
        auto tones = std::make_unique<btg::detail::Tones>(); // 256 tones: too large for the stack
        tones->sr = sr;
        tones->start({ .pack = pack.get(), .zone = &pack->zones[0], .sample = 0, .key = 57, .dur = 2.0, .vel = 1.0, .layer = btg::Engine::bass });
        std::vector<float> l(static_cast<size_t>(sr)), r(l.size());
        for (size_t at = 0; at < l.size(); at += 256)
            for (btg::detail::Tone& t : tones->all) if (t.active) t.render(&l[at], &r[at], static_cast<int>(std::min<size_t>(256, l.size() - at)));
        double first = -1.0, last = -1.0;
        int crossings = 0;
        for (size_t i = static_cast<size_t>(0.1 * sr); i + 1 < l.size(); ++i)
            if (l[i] <= 0 && l[i + 1] > 0) {
                last = (static_cast<double>(i) + l[i] / (l[i] - l[i + 1])) / sr;
                if (first < 0) first = last;
                ++crossings;
            }
        CHECK(std::fabs(1200 * std::log2((crossings - 1) / (last - first) / 220.5)) < 2);
    }
    // ... the engine builds the responses for the rate it is prepared at: at 44.1 and 96 kHz the drums' reverb rings on after the song stands
    // (the last hit dies within 0.2 s) until about 2.14 s, and is gone from 2.25 s on (a response built for 48 kHz would ring at 44.1 kHz until
    // about 2.32 s, and end at 96 kHz before 1.6 s). Played from beat 64: the fixture's intro (9.6 s) has no drums.
    for (const double sr : { 44100.0, 96000.0 }) {
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(R"({"master":{"reverb":1,"echo":0,"roomWet":0}})");
        engine.setTrack(track);
        engine.setMuted(btg::Engine::bass, true);
        engine.setLimiter(false);
        engine.prepare(sr);
        btg::Transport t;
        t.play(64.0, engine.bpm());
        std::vector<float> l(480), r(480), after;
        btg::Transport::Block b;
        for (double done = 0; done < 2.0 * sr; done += b.frames) { b = t.advance(480, sr); engine.render(l.data(), r.data(), b.frames, b); }
        const btg::Transport::Block still { true, b.beats + b.frames * b.beatsPerFrame, 0.0, 480, b.starts };
        while (after.size() < 2.6 * sr) { engine.render(l.data(), r.data(), 480, still); after.insert(after.end(), l.begin(), l.end()); }
        const auto peak = [&](double from, double to) {
            double p = 0.0;
            for (size_t i = static_cast<size_t>(from * sr); i < static_cast<size_t>(to * sr); ++i) p = std::max(p, std::fabs(static_cast<double>(after[i])));
            return p;
        };
        CHECK(peak(1.6, 1.9) > 1e-6);
        CHECK(peak(2.25, 2.6) < 1e-9);
    }
    // A stop: the wet returns fade with the web's 0.05 s (play.js FADE), 0.2 s after it everything is exactly silent; a start after that
    // sounds as a fresh engine (reverb, room and their filters start empty, as the web's new graph at every play()). From beat 64 the
    // drums and the bass still sound when the fade ends (the choke takes about 0.14 s), and their tails go into the closed sends after it.
    for (const double from : { 0.0, 64.0 }) {
        const char* WET = R"({"master":{"reverb":1,"roomWet":1}})";
        btg::Engine used, fresh;
        for (btg::Engine* e : { &used, &fresh }) { e->setPackSource(source); e->setSound(WET); e->setTrack(track); e->setLimiter(false); e->prepare(rate); }
        btg::Transport t, t2;
        t.play(from, used.bpm());
        render(used, t, 2.0, 480);
        t.stop();
        const Result after = render(used, t, 0.3, 480);
        double late = 0.0;
        for (size_t i = rate / 5; i < after.left.size(); ++i) late = std::max(late, std::fabs(static_cast<double>(after.left[i])));
        CHECK(late == 0.0);
        t.play(0.0, used.bpm());
        t2.play(0.0, fresh.bpm());
        CHECK(render(used, t, 0.5, 480).left == render(fresh, t2, 0.5, 480).left);
    }
    // The stop as heard, from beat 64: the wet part of the output (the difference to a dry twin: the same engine, track and transport with
    // reverb, echo and room at 0) fades linearly over the 2400 frames of 0.05 s from the peak it had before the stop, and is exactly 0 from
    // the fade's end on, while the choke tails still ring and feed the sends. A start 80 ms after the stop (the fade over, the tails still
    // ringing) sounds wet as a fresh engine started there (measured 5e-5 of its peak apart: the tails after the start); a start 20 ms after
    // it (inside the fade) brings back no tail of what played before the stop: from the fade's end on its wet part is the same whether beat
    // 64 or beat 32 played before (measured 9e-4 apart: the choke tails; uncleared sends 0.26). Limits 1 % of the peak.
    {
        const char* WET = R"({"master":{"reverb":1,"roomWet":1}})";
        // play `before` s from beat `from` and stop for `stopped` s (neither when before is 0), then play `after` s from beat 64; wet minus dry, left
        const auto wetPart = [&](double from, double before, double stopped, double after) {
            btg::Engine e[2];
            btg::Transport t[2];
            std::vector<double> out[2];
            for (int k = 0; k < 2; ++k) { e[k].setPackSource(source); e[k].setSound(k ? DRY : WET); e[k].setTrack(track); e[k].setLimiter(false); e[k].prepare(rate); }
            const auto run = [&](double seconds) { for (int k = 0; k < 2; ++k) for (const float x : render(e[k], t[k], seconds, 480).left) out[k].push_back(x); };
            if (before > 0) {
                for (btg::Transport& x : t) x.play(from, e[0].bpm());
                run(before);
                for (btg::Transport& x : t) x.stop();
                run(stopped);
            }
            for (btg::Transport& x : t) x.play(64.0, e[0].bpm());
            run(after);
            for (size_t i = 0; i < out[0].size(); ++i) out[0][i] -= out[1][i];
            return out[0];
        };
        const auto peakIn = [](const std::vector<double>& x, size_t from, size_t to) { double p = 0.0; for (size_t i = from; i < to; ++i) p = std::max(p, std::fabs(x[i])); return p; };
        const auto rmsIn = [](const std::vector<double>& x, size_t from, size_t to) { double s = 0.0; for (size_t i = from; i < to; ++i) s += x[i] * x[i]; return std::sqrt(s / static_cast<double>(to - from)); };
        const size_t stop = 2 * rate, fade = rate / 20; // the stop's frame, the fade's frames
        const std::vector<double> stopped = wetPart(64.0, 2.0, 0.3, 0.0), fresh = wetPart(64.0, 0.0, 0.0, 0.5);
        const double before = peakIn(stopped, 0, stop);
        double over = 0.0; // the most a frame of the fade lies above the line from that peak to 0 (one frame allowed for rounding), in units of the peak
        for (size_t n = 0; n < fade; ++n) over = std::max(over, std::fabs(stopped[stop + n]) / before - (1 - (static_cast<double>(n) - 1) / fade));
        const double fadeLevel = rmsIn(stopped, stop, stop + 480) / rmsIn(stopped, stop - 480, stop);
        const double afterFade = peakIn(stopped, stop + fade, stopped.size());
        const std::vector<double> late = wetPart(64.0, 2.0, 0.08, 0.5), early = wetPart(64.0, 2.0, 0.02, 0.5), early32 = wetPart(32.0, 2.0, 0.02, 0.5);
        double most = 0.0;
        for (size_t i = 0; i < fresh.size(); ++i) most = std::max(most, std::fabs(late[stop + rate * 8 / 100 + i] - fresh[i]));
        const double lateGap = most / peakIn(fresh, 0, fresh.size());
        most = 0.0;
        for (size_t i = stop + fade; i < early.size(); ++i) most = std::max(most, std::fabs(early[i] - early32[i]));
        const double earlyGap = most / peakIn(early, stop + fade, early.size());
        CHECK(before > 0.01 && over <= 0.0);
        CHECK(fadeLevel > 0.5);  // a fade, not a cut
        CHECK(afterFade == 0.0); // the returns stay closed
        CHECK(lateGap < 0.01);   // the start empties the sends
        CHECK(earlyGap < 0.01);  // the fade's end empties them
    }

    // setSound reaches the voices, in the order the app sends it (setTuning, setTrack, setSound; play.js) and while playing. The bass plays a
    // tone of 2205 Hz at its root, so that cutoff 0 (a lowpass at 400 Hz) takes a lot of it away: that effect lives in the voice, not in the sum.
    // Every engine starts from DRY (neutral voices, no sends), so that only the dry bass is compared.
    {
        const auto bright = [](const std::string& id) -> std::shared_ptr<const btg::Pack> { return id == "bass-finger" ? tonePack(45, 0.5f, 0.2, 10) : source(id); };
        const char* dark = R"({"bass":{"cutoff":0},"master":{"reverb":0,"echo":0,"roomWet":0}})";
        const auto heard = [&](const char* sound, bool afterTrack) {
            btg::Engine engine;
            engine.setPackSource(bright);
            engine.setSound(DRY);
            if (sound && !afterTrack) engine.setSound(sound);
            engine.setTrack(track);
            if (sound && afterTrack) engine.setSound(sound);
            engine.setMuted(btg::Engine::drums, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            return render(engine, t, 5.0, 480);
        };
        const Result neutral = heard(nullptr, false), before = heard(dark, false), after = heard(dark, true);
        CHECK(before.rms < 0.7 * neutral.rms); // the timbre acts in the voice
        CHECK(after.left == before.left);      // setSound after setTrack sounds as setSound before it
        // setSound while playing: what starts after it sounds as the timbre says (the bass's notes end within a bar, 2.4 s), as in an
        // engine that had the timbre from the start; with no setSound after DRY it stays neutral.
        const auto changing = [&](const char* sound, bool atStart) {
            btg::Engine engine;
            engine.setPackSource(bright);
            engine.setSound(DRY);
            if (sound && atStart) engine.setSound(sound);
            engine.setTrack(track);
            engine.setMuted(btg::Engine::drums, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            render(engine, t, 1.0, 480);
            if (sound && !atStart) engine.setSound(sound);
            return render(engine, t, 5.0, 480).left;
        };
        const auto fromStart = changing(dark, true), whilePlaying = changing(dark, false), never = changing(nullptr, false);
        const size_t from = 3 * rate, to = 5 * rate;
        CHECK(std::fabs(rmsOf(whilePlaying, from, to) / rmsOf(fromStart, from, to) - 1.0) < 1e-3);
        CHECK(rmsOf(never, from, to) > 1.2 * rmsOf(fromStart, from, to));
    }

    // The sampler's timbre, voice by voice: the lowpass of the brightness knobs (bass.cutoff, chords.brightness, pad.cutoff), the time scale of
    // chords.length and pad.attack, the kit's pan by the width. Notes of a tone at 2205 Hz, above the lowpass at 400 Hz of knob 0.
    {
        using namespace btg::detail;
        const auto timed = [](double attack, double release) { auto p = std::make_shared<btg::Pack>(*tonePack(45, 0.5f, release, 10)); p->zones[0].attack = attack; return std::shared_ptr<const btg::Pack>(p); };
        struct Knob { btg::Engine::Layer layer; const char* key; double* (*field)(Timbre&); };
        const Knob lowpass[] = { { btg::Engine::bass, "bass/sample/finger", [](Timbre& t) { return &t.bass.cutoff; } },
                                 { btg::Engine::chords, "chords/sample/funk", [](Timbre& t) { return &t.chords.brightness; } },
                                 { btg::Engine::pad, "pad/sample/strings", [](Timbre& t) { return &t.pad.cutoff; } } };
        for (const Knob& k : lowpass) {
            const auto level = [&](double value) { Timbre t; *k.field(t) = value; return rmsOf(noteOf(k.layer, k.key, timed(0.0, 0.2), t, 45, 0.5, rate / 2), rate / 10, rate / 2); };
            const double dark = level(0.0), quarter = level(0.1), middle = level(0.5), open = level(1.0);
            CHECK(dark < 0.4 * middle);                  // 400 Hz against a tone of 2205 Hz
            CHECK(quarter > dark && quarter < middle);
            CHECK(middle == open);                       // from 0.5 up the voice is not filtered
        }
        const Knob scaled[] = { { btg::Engine::chords, "chords/sample/funk", [](Timbre& t) { return &t.chords.length; } },
                                { btg::Engine::pad, "pad/sample/strings", [](Timbre& t) { return &t.pad.attack; } } };
        for (const Knob& k : scaled) {
            const auto times = [&](double value) { Timbre t; *k.field(t) = value; return envelopeOf(noteOf(k.layer, k.key, timed(0.1, 0.6), t, 45, 1.0, 3 * rate, "{\"chords/sample/funk\":{\"decay\":10,\"oneShot\":0}}"), 1.0); }; // the guitar's natural decay at its slowest, no one-shot end of the sample
            const Envelope shortest = times(0.0), middle = times(0.5), longest = times(1.0);
            CHECK(std::fabs(middle.rise - 0.05) < 0.01 && middle.fall > 0.05);           // attack 0.1 s reaches half at 0.05 s
            CHECK(std::fabs(longest.rise / middle.rise / 3 - 1) < 0.12 && std::fabs(longest.fall / middle.fall / 3 - 1) < 0.12);
            CHECK(std::fabs(shortest.rise / middle.rise * 3 - 1) < 0.12 && std::fabs(shortest.fall / middle.fall * 3 - 1) < 0.12);
        }
        // the lead has neither (sample.js 46 to 75)
        Timbre all;
        all.bass.cutoff = all.chords.brightness = all.pad.cutoff = 0.0;
        all.chords.length = all.pad.attack = 1.0;
        CHECK(noteOf(btg::Engine::lead, "lead/sample/flute", timed(0.1, 0.6), all, 45, 1.0, rate) == noteOf(btg::Engine::lead, "lead/sample/flute", timed(0.1, 0.6), Timbre {}, 45, 1.0, rate));
        // the kit's pan: width * mix/pan kit * the hat's place (KIT_PAN), as a ratio of the right to the left level of a constant sample
        const auto nameIndex = [](const char* name) { return static_cast<int>(std::find_if(std::begin(HIT_NAMES), std::end(HIT_NAMES), [&](const char* n) { return std::string(n) == name; }) - std::begin(HIT_NAMES)); };
        const auto hatSides = [&](double width) {
            Timbre t;
            t.master.width = width;
            const auto voice = makeVoice(btg::Engine::drums, "drums/sample/brushes", dcKit(false), {}, t);
            auto tones = std::make_unique<Tones>();
            tones->sr = rate;
            VoiceState state;
            state.rng = voice->startRng;
            PlayEvent e;
            e.hit = true;
            e.vel = 1.0;
            e.name = nameIndex("hat");
            voice->play(e, 0, 0.5, state, *tones);
            std::vector<float> left(4000), right(4000);
            for (Tone& tone : tones->all) if (tone.active) tone.render(left.data(), right.data(), 4000);
            return right[3000] / left[3000];
        };
        const double place = soundData().kitPan.at("hat") * tunedValue("mix/pan", "kit", {});
        for (const double width : { 0.0, 0.25, 0.5, 1.0 }) {
            const double pan = std::min(1.0, 2 * width * place); // mix.width = 2 * master.width
            CHECK(place > 0.0 && std::fabs(hatSides(width) - (1 + pan) / (1 - pan)) < 1e-4);
        }
    }

    // The FM e-piano (Task 21) and with it the engine's synth tones. `keys`: the fixture with the chords alone (drums and bass off), dry, no
    // limiter, so that what sounds is the e-piano and nothing behind it keeps a tail of its own (stopped, the engine gives exactly 0).
    // `held`: the same without the rhythm tags, so that the stab at 12.52 beats is held 2.09 s and the one at 26.5 beats (0.9 s) is
    // followed by 3.3 s of nothing.
    {
        using namespace btg::detail;
        std::printf("sizeof(SynthTone) %zu bytes, the pool of %d synth tones %.2f MB\n", sizeof(SynthTone), TONES, TONES * sizeof(SynthTone) / 1048576.0);
        const char* EPIANO = R"({"chords":{"id":"epiano","variant":"rhodes"}})";
        const char* SILENT = R"({"chords":{"id":"none","variant":"none"}})"; // a key no voice has: silent through the synth voices' path
        std::string keys = track;
        keys.replace(keys.find("\"drums\":true"), 12, "\"drums\":false");
        keys.replace(keys.find("\"bass\":true"), 11, "\"bass\":false");
        keys.replace(keys.find("\"chords\":false"), 14, "\"chords\":true");
        std::string held = keys;
        const std::string rhythm = R"("rhythm":["funky","syncopated"])";
        held.replace(held.find(rhythm), rhythm.size(), R"("rhythm":[])");
        double longest = -1.0, gapped = -1.0, nextStab = -1.0; // beats: the held stab, the one of 0.9 s and the next stab after it
        for (const btg::Event& e : btg::buildEvents(held)) {
            if (e.type != btg::Event::Type::note || e.layer != "chords") continue;
            const double beat = e.t * (100.0 / 60.0);
            if (longest < 0 && e.dur >= 2.0) longest = beat;
            if (gapped >= 0 && nextStab < 0 && beat > gapped + 1e-6) nextStab = beat;
            if (gapped < 0 && e.dur > 0.8 && e.dur < 1.5) gapped = beat;
        }
        CHECK(longest > 0 && gapped > 0 && nextStab > gapped);
        const auto make = [&](const std::string& song, const char* voices) {
            auto e = std::make_unique<btg::Engine>();
            e->setPackSource(source);
            e->setSound(DRY);
            e->setTrack(song);
            if (voices) e->setVoices(voices);
            e->setLimiter(false);
            e->prepare(rate);
            return e;
        };
        const auto peakIn = [](const std::vector<float>& x, double from, double to) {
            float p = 0.0f;
            for (size_t i = static_cast<size_t>(from * rate); i < std::min(x.size(), static_cast<size_t>(to * rate)); ++i) p = std::max(p, std::fabs(x[i]));
            return p;
        };
        // It plays: the chords with chords/epiano/rhodes are ready and have a level.
        {
            auto e = make(keys, EPIANO);
            CHECK(e->voiceStatus().find(R"("chords":"ready")") != std::string::npos);
            btg::Transport t;
            t.play(64.0, e->bpm());
            const Result r = render(*e, t, 2.0, 480);
            const float level = e->takePeak(btg::Engine::chords);
            std::printf("e-piano: chords peak %.3f, rms %.4f\n", level, r.rms);
            CHECK(r.finite && level > 0.01f && r.rms > 1e-3);
        }
        // Review Focus 5, pitch: one tone (A3, 220 Hz, velocity 0.5) at 44.1 and 96 kHz within 2 cents, between the first and the last upward
        // zero crossing from 0.4 s on: the bell has ended (0.15 s) and the index has fallen to a third (0.35 s), 0.62, so the carrier's
        // frequency f (1 + 0.62 sin) stays above 0 and its phase rises: one upward crossing per period.
        for (const double sr : { 44100.0, 96000.0 }) {
            const auto voice = makeVoice(btg::Engine::chords, "chords/epiano/rhodes", nullptr, {}, Timbre {});
            auto tones = std::make_unique<Tones>();
            tones->sr = sr;
            tones->basic = &basicWaves(sr);
            VoiceState state;
            PlayEvent e;
            e.layer = btg::Engine::chords;
            e.midi = 57;
            e.vel = 0.5;
            e.durBeats = 2.0;
            voice->play(e, 0, 1.0, state, *tones);
            std::vector<float> l(static_cast<size_t>(1.2 * sr)), r(l.size());
            for (size_t at = 0; at < l.size(); at += SYNTH_FRAMES)
                for (SynthTone& t : tones->synth) if (t.active) t.render(&l[at], &r[at], static_cast<int>(std::min<size_t>(SYNTH_FRAMES, l.size() - at)), tones->scratch);
            double first = -1.0, last = -1.0;
            int crossings = 0;
            for (size_t i = static_cast<size_t>(0.4 * sr); i + 1 < l.size(); ++i)
                if (l[i] <= 0 && l[i + 1] > 0) {
                    last = (static_cast<double>(i) + l[i] / (l[i] - l[i + 1])) / sr;
                    if (first < 0) first = last;
                    ++crossings;
                }
            const double cents = 1200 * std::log2((crossings - 1) / (last - first) / 220.0);
            std::printf("e-piano at %.0f Hz: A3 %+.3f cents off 220 Hz over %d periods\n", sr, cents, crossings - 1);
            CHECK(crossings > 100 && std::fabs(cents) < 2);
        }
        // A glide's note (slideIn, scoop: the guitars' arts, kept by a live voice change) is triggered its lead early for the sampler; the
        // e-piano ignores the art and plays at the note, as the web: a lead of 0.05 s, the first 2400 frames silent (and the next: its sines
        // start at 0), then the note's 0.5 s, its fade (0.18 s) and silence once its sources stop (0.05 s later).
        {
            const auto voice = makeVoice(btg::Engine::chords, "chords/epiano/rhodes", nullptr, {}, Timbre {});
            auto tones = std::make_unique<Tones>();
            tones->sr = rate;
            tones->basic = &basicWaves(rate);
            VoiceState state;
            PlayEvent e;
            e.layer = btg::Engine::chords;
            e.midi = 57;
            e.vel = 0.8;
            e.art = Art::slideIn;
            e.leadBeats = 0.05;
            e.durBeats = 0.55;
            voice->play(e, 0, 1.0, state, *tones);
            std::vector<float> l(rate), r(rate);
            for (size_t at = 0; at < l.size(); at += SYNTH_FRAMES)
                for (SynthTone& t : tones->synth) if (t.active) t.render(&l[at], &r[at], SYNTH_FRAMES, tones->scratch);
            const auto first = static_cast<size_t>(std::find_if(l.begin(), l.end(), [](float x) { return x != 0.0f; }) - l.begin());
            std::printf("e-piano under a glide's lead: first sound at frame %zu\n", first);
            CHECK(first == 2401 && peakIn(l, 0.55, 0.73) > 1e-3 && peakIn(l, 0.8, 1.0) == 0.0f);
        }
        // Stop and silence: the stop chokes the synth tones (15 ms, ended at 1e-7: 0.24 s); while they still ring after the wet fade (50 ms)
        // the engine is not quiet, and then the output is exactly 0. Red when quiet looks at the sample tones only (silent from 50 ms).
        {
            auto e = make(held, EPIANO);
            btg::Transport t;
            t.play(longest, e->bpm());
            render(*e, t, 0.5, 480);
            t.stop();
            const Result after = render(*e, t, 0.5, 480);
            std::printf("e-piano stop: peak from 60 to 150 ms after it %.2e, from 0.3 s %.2e\n", peakIn(after.left, 0.06, 0.15), peakIn(after.left, 0.3, 0.5));
            CHECK(peakIn(after.left, 0.06, 0.15) > 1e-6 && peakIn(after.left, 0.3, 0.5) == 0.0f && e->activeSynthTones() == 0);
        }
        // A jump under the held chord, the chords switched to a silent voice with it (so only what rang can sound): the old tones fall over
        // the e-piano's REL (0.18 s) without a step (the largest difference of two successive samples from the jump on stays within 10 % of
        // the tone's own in its last 0.2 s before it; a cut is a step of its level: red with releaseSeconds 0), and are gone after it: none
        // is active from REL and two chunks on, and the output stays below -180 dBFS (playing, the sum's filters are not cleared).
        {
            auto e = make(held, EPIANO);
            btg::Transport t;
            t.play(longest, e->bpm());
            const Result before = render(*e, t, 1.0, 480);
            e->setVoices(SILENT);
            t.seek(longest + 8.0);
            const Result falling = render(*e, t, 0.18 + 2.0 * SYNTH_FRAMES / rate, 480);
            const int left = e->activeSynthTones();
            const Result rest = render(*e, t, 0.3, 480);
            double own = 0.0, jump = std::fabs(falling.left[0] - before.left.back());
            for (size_t i = before.left.size() - rate / 5; i < before.left.size(); ++i) own = std::max(own, static_cast<double>(std::fabs(before.left[i] - before.left[i - 1])));
            for (size_t i = 1; i < falling.left.size(); ++i) jump = std::max(jump, static_cast<double>(std::fabs(falling.left[i] - falling.left[i - 1])));
            std::printf("e-piano jump: largest step %.2e after it, %.2e before it; %d synth tones active %.3f s after it, then peak %.2e\n", jump, own, left,
                        static_cast<double>(falling.left.size()) / rate, peakIn(rest.left, 0.0, 0.3));
            CHECK(own > 1e-3 && jump < 1.1 * own && left == 0 && peakIn(rest.left, 0.0, 0.3) < 1e-9f);
        }
        // A loop of one beat over the held chord: every lap starts its three tones again and the wrap lets the last lap's fall (0.18 s of the
        // 0.6 s lap), so at most six are active; red when a jump leaves the synth tones ringing (they pile up: each rings 2.3 s).
        {
            auto e = make(held, EPIANO);
            btg::Transport t;
            t.setLoop(longest, longest + 1.0);
            t.play(longest, e->bpm());
            std::vector<float> l(480), r(480);
            int most = 0;
            for (int block = 0; block < 600; ++block) { // 6 s, ten laps
                const auto b = t.advance(480, rate);
                e->render(l.data(), r.data(), b.frames, b);
                most = std::max(most, e->activeSynthTones());
            }
            std::printf("e-piano loop: at most %d synth tones active over ten laps\n", most);
            CHECK(most >= 3 && most <= 6);
        }
        // A voice change under a ringing tone (the stab of 0.9 s, its tone 1.13 s): the chords go to a sample guitar 0.3 s in, and a control
        // call after it frees the setup that held the e-piano while its tone rings. The tail equals the render without the change, exactly,
        // until the next stab (3.3 s later); from it on the guitar plays.
        {
            const auto run = [&](bool change) {
                auto e = make(held, EPIANO);
                btg::Transport t;
                t.play(gapped, e->bpm());
                Result r = render(*e, t, 0.3, 480);
                if (change) e->setVoices(R"({"chords":{"id":"sample","variant":"funk"}})");
                const Result taken = render(*e, t, 0.01, 480); // the block that takes the new setup
                e->setSound(DRY); // a publish: it frees the setup the audio side retired (with the e-piano, when changed)
                const Result rest = render(*e, t, 4.0, 480);
                for (const Result* more : { &taken, &rest }) r.left.insert(r.left.end(), more->left.begin(), more->left.end());
                return r;
            };
            const Result changed = run(true), kept = run(false);
            const size_t next = static_cast<size_t>((nextStab - gapped) * 0.6 * rate) - SYNTH_FRAMES;
            bool same = changed.left.size() == kept.left.size();
            for (size_t i = 0; same && i < next; ++i) same = changed.left[i] == kept.left[i];
            bool differs = false;
            for (size_t i = next; i < changed.left.size(); ++i) differs = differs || std::fabs(changed.left[i] - kept.left[i]) > 1e-3f;
            std::printf("e-piano voice change: tail peak %.3f from the change to 1.2 s\n", peakIn(changed.left, 0.31, 1.2));
            CHECK(same && peakIn(changed.left, 0.31, 1.2) > 0.01f && differs);
        }
        // A restart with the app's lead (stop and play back to back) under the e-piano equals a fresh engine started the same way, within 1e-6,
        // from the song's first frame on: the render quanta are counted from the play's first frame, so the new song's tones get the places
        // in the quantum (and so the sound) a fresh engine gives them. 2.15 s before the restart (806.25 quanta, the stab of 0.9 s rung out,
        // the next 3.3 s after it): red when a start does not reset the count (every place 32 frames off).
        {
            const double lead = 0.15;
            const auto played = [&](bool restart) {
                auto e = make(held, EPIANO);
                btg::Transport t;
                t.play(gapped, e->bpm(), lead);
                if (restart) {
                    render(*e, t, lead + 2.0, 480);
                    t.stop();
                    t.play(gapped, e->bpm(), lead);
                }
                return render(*e, t, lead + 1.5, 480).left;
            };
            const std::vector<float> again = played(true), fresh = played(false);
            double most = 0.0;
            for (size_t i = static_cast<size_t>(std::lround(lead * rate)); i < again.size(); ++i) most = std::max(most, static_cast<double>(std::fabs(again[i] - fresh[i])));
            std::printf("e-piano restart with the lead: against a fresh engine, largest difference %.2e (song peak %.3f)\n", most, peakIn(fresh, lead, lead + 1.5));
            CHECK(peakIn(fresh, lead, lead + 1.5) > 0.01f && most < 1e-6);
        }
        // The pool is full: 266 tones started into 256: the ten oldest are taken (serials 1 to 10 gone), the new ones begin at age 0, the
        // others go on where they were (one chunk rendered before), the sample pool is not touched.
        {
            const auto voice = makeVoice(btg::Engine::chords, "chords/epiano/rhodes", nullptr, {}, Timbre {});
            auto tones = std::make_unique<Tones>();
            tones->sr = rate;
            tones->basic = &basicWaves(rate);
            VoiceState state;
            PlayEvent e;
            e.layer = btg::Engine::chords;
            e.midi = 60;
            e.vel = 0.8;
            e.durBeats = 1.0;
            for (int i = 0; i < TONES; ++i) voice->play(e, 0, 1.0, state, *tones);
            std::vector<float> l(SYNTH_FRAMES), r(SYNTH_FRAMES);
            for (SynthTone& t : tones->synth) t.render(l.data(), r.data(), SYNTH_FRAMES, tones->scratch);
            for (int i = 0; i < 10; ++i) voice->play(e, 0, 1.0, state, *tones);
            int active = 0, fresh = 0, kept = 0;
            uint64_t lowest = UINT64_MAX;
            for (const SynthTone& t : tones->synth) {
                active += t.active;
                lowest = std::min(lowest, t.serial);
                if (t.serial > static_cast<uint64_t>(TONES)) fresh += t.age == 0;
                else kept += t.age == SYNTH_FRAMES;
            }
            CHECK(active == TONES && lowest == 11 && fresh == 10 && kept == TONES - 10);
            CHECK(std::none_of(tones->all.begin(), tones->all.end(), [](const Tone& t) { return t.active; }));
        }
        // No allocation and no free in render (ruling 14): one run with sample voices (drums, bass, the chords' guitar), the e-piano and (Task
        // 20) the organ, voice changes while playing (guitar, e-piano, organ, each way), a restart (play again, no stop between), a jump and a
        // stop under the organ, the counts armed around the render calls only (the control calls allocate). Red with an allocation in the
        // audio path.
        {
            std::string chorded = track;
            chorded.replace(chorded.find("\"chords\":false"), 14, "\"chords\":true");
            auto e = make(chorded, EPIANO);
            btg::Transport t;
            std::vector<float> l(480), r(480);
            const auto counted = [&](double seconds) {
                counting = true;
                for (int done = 0; done < seconds * rate;) {
                    const auto b = t.advance(480, rate);
                    e->render(l.data(), r.data(), b.frames, b);
                    done += b.frames;
                }
                counting = false;
            };
            const char* ORGAN = R"({"chords":{"id":"organ","variant":"jazz"}})";
            t.play(64.0, e->bpm());
            counted(1.0);
            e->setVoices(R"({"chords":{"id":"sample","variant":"funk"}})");
            counted(0.5);
            e->setVoices(EPIANO);
            counted(0.5);
            e->setVoices(ORGAN);
            counted(0.5);
            e->setVoices(R"({"chords":{"id":"sample","variant":"funk"}})");
            counted(0.5);
            e->setVoices(ORGAN);
            counted(0.5);
            t.play(64.0, e->bpm());
            counted(1.0);
            t.seek(32.0);
            counted(0.5);
            t.stop();
            counted(0.5);
            std::printf("render: %ld allocations, %ld frees (%s), %d organ chains busy at the end\n", allocations, frees, e->voiceStatus().c_str(), e->busyOrganChains());
            CHECK(allocations == 0 && frees == 0 && e->voiceStatus().find(R"("chords":"ready")") != std::string::npos);
        }

        // The tonewheel organ (Task 20): its voice (voices/organ.cpp) and the chain slots of its voice instances (organ_chain.h), on the
        // tracks above, dry, no limiter. NOCLICK: no key click, whose levels come from the voice instance's rng.
        const char* ORGAN = R"({"chords":{"id":"organ","variant":"jazz"}})";
        const char* FUNK = R"({"chords":{"id":"sample","variant":"funk"}})";
        const char* NOCLICK = R"({"chords/organ/jazz":{"click":0}})";
        const auto organ = [&](const std::string& song, const char* voices, const char* tuning = "{}", const char* sound = DRY) {
            auto e = std::make_unique<btg::Engine>();
            e->setPackSource(source);
            e->setTuning(tuning);
            e->setSound(sound);
            e->setTrack(song);
            e->setVoices(voices);
            e->setLimiter(false);
            e->prepare(rate);
            return e;
        };
        const auto both = [](const Result& r) { std::vector<float> x(r.left); x.insert(x.end(), r.right.begin(), r.right.end()); return x; };
        // It plays in two channels: the chords with chords/organ/jazz are ready and have a level; with the Leslie on (always fast) the two
        // channels are no longer one signal (their correlation below 0.99; the layer's balance alone scales them), with it off they are (0.9999).
        for (const int leslie : { 3, 0 }) {
            const std::string tuning = R"({"chords/organ/jazz":{"leslie":)" + std::to_string(leslie) + "}}";
            auto e = organ(keys, ORGAN, tuning.c_str());
            btg::Transport t;
            t.play(64.0, e->bpm());
            const Result r = render(*e, t, 2.0, 480);
            const float level = e->takePeak(btg::Engine::chords);
            double lr = 0.0, ll = 0.0, rr = 0.0;
            for (size_t i = 0; i < r.left.size(); ++i) { lr += static_cast<double>(r.left[i]) * r.right[i]; ll += static_cast<double>(r.left[i]) * r.left[i]; rr += static_cast<double>(r.right[i]) * r.right[i]; }
            const double correlation = lr / std::sqrt(ll * rr);
            std::printf("organ, leslie %d: chords peak %.3f, rms %.4f, left and right correlate %.5f\n", leslie, level, r.rms, correlation);
            CHECK(e->voiceStatus().find(R"("chords":"ready")") != std::string::npos && r.finite && level > 0.01f && r.rms > 1e-3);
            CHECK(leslie == 3 ? correlation < 0.99 : correlation > 0.9999);
        }
        // Review Focus 5, pitch: one tone through the voice and its chain with only the 8' drawbar (a pure partial: a sine at the key), no
        // Leslie, no click, no percussion, no drive: C4 at 44.1 and 96 kHz within 0.05 cents of 261.63 Hz detuned by its wheels (GEARS of C,
        // 85 / 104: -0.58 cents), between the first and the last upward zero crossing from 0.2 s on.
        for (const double sr : { 44100.0, 96000.0 }) {
            const char* PURE = R"({"chords/organ/jazz":{"d16":0,"d513":0,"leslie":0,"click":0,"perc":0,"drive":0}})";
            const auto voice = makeVoice(btg::Engine::chords, "chords/organ/jazz", nullptr, parseTuning(PURE), Timbre {}, sr);
            auto tones = organTones(sr);
            VoiceState state;
            state.rng = voice->startRng;
            PlayEvent e;
            e.layer = btg::Engine::chords;
            e.midi = 60;
            e.vel = 0.8;
            e.durBeats = 1.5;
            const size_t frames = static_cast<size_t>(1.2 * sr);
            Slots out;
            for (auto& slot : out) for (auto& channel : slot) channel.assign(frames, 0.0f);
            for (size_t at = 0; at < frames; at += SYNTH_FRAMES) {
                if (at == 0) voice->play(e, 0, 1.0, state, *tones);
                organChunk(*tones, at, static_cast<int>(std::min<size_t>(SYNTH_FRAMES, frames - at)), out);
            }
            const std::vector<float>& l = out[0][0];
            double first = -1.0, last = -1.0;
            int crossings = 0;
            for (size_t i = static_cast<size_t>(0.2 * sr); i + 1 < l.size(); ++i)
                if (l[i] <= 0 && l[i + 1] > 0) {
                    last = (static_cast<double>(i) + l[i] / (l[i] - l[i + 1])) / sr;
                    if (first < 0) first = last;
                    ++crossings;
                }
            const double wheel = 1200 * std::log2(40.0 * 85 / 104 / (440 * std::pow(2.0, (24 - 69) / 12.0)));
            const double cents = 1200 * std::log2((crossings - 1) / (last - first) / (440 * std::pow(2.0, (60 - 69) / 12.0))) - wheel;
            std::printf("organ at %.0f Hz: C4 %+.4f cents off 261.63 Hz detuned by %.3f cents, over %d periods\n", sr, cents, wheel, crossings - 1);
            CHECK(crossings > 200 && std::fabs(cents) < 0.05);
        }
        // A voice change under a ringing organ (the stab of 0.9 s): the chords go to a sample guitar 0.3 s in, and a control call after it
        // frees the setup that held the organ. Its chain, now an orphan, rings out with its tones: the render equals the one without the
        // change, exactly, until a tone's end (the stab and its release); from there to the next stab (3.3 s later) only the chain's own
        // ringing differs (the orphan is given up after its tail, the kept chain rings on: below 1e-6); from the next stab on the guitar plays.
        {
            double gappedDur = 0.0;
            for (const btg::Event& ev : btg::buildEvents(held))
                if (ev.type == btg::Event::Type::note && ev.layer == "chords" && std::fabs(ev.t * (100.0 / 60.0) - gapped) < 1e-6) gappedDur = std::max(gappedDur, ev.dur);
            const auto run = [&](bool change) {
                auto e = organ(held, ORGAN);
                btg::Transport t;
                t.play(gapped, e->bpm());
                Result r = render(*e, t, 0.3, 480);
                if (change) e->setVoices(FUNK);
                const Result taken = render(*e, t, 0.01, 480);
                e->setSound(DRY);
                const Result rest = render(*e, t, 4.0, 480);
                for (const Result* more : { &taken, &rest }) {
                    r.left.insert(r.left.end(), more->left.begin(), more->left.end());
                    r.right.insert(r.right.end(), more->right.begin(), more->right.end());
                }
                return r;
            };
            const Result changed = run(true), kept = run(false);
            const size_t ends = static_cast<size_t>((gappedDur + 0.012 + 0.01) * rate), next = static_cast<size_t>((nextStab - gapped) * 0.6 * rate) - SYNTH_FRAMES;
            bool same = changed.left.size() == kept.left.size();
            double ringing = 0.0;
            for (size_t i = 0; same && i < next; ++i) {
                const double d = std::max(std::fabs(changed.left[i] - kept.left[i]), std::fabs(changed.right[i] - kept.right[i]));
                if (i < ends) same = d == 0.0;
                else ringing = std::max(ringing, d);
            }
            bool differs = false;
            for (size_t i = next; same && i < changed.left.size(); ++i) differs = differs || std::fabs(changed.left[i] - kept.left[i]) > 1e-3f;
            std::printf("organ voice change: equal until the tones' end (%.3f s); then the chain's ringing differs by %.2e; tail peak %.3f\n",
                        static_cast<double>(ends) / rate, ringing, peakIn(changed.left, 0.31, 0.9));
            CHECK(same && ringing < 1e-6 && peakIn(changed.left, 0.31, 0.9) > 0.01f && differs);
        }
        // A restart while organ tones ring (the held stab, 0.5 s in), with the chords' distortion at 1 so that the layer chains matter: the old
        // tones keep their chain slot and their layer chains, the new song's first tone takes a fresh slot. The restarted render less a
        // stop alone at that moment (the old tail) equals a fresh engine started at the new place, within 1e-6, over 1.5 s.
        {
            const char* DIST = R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"distortion":1}})";
            const auto run = [&](int how) { // 0: play again under the ringing organ; 1: a stop at that moment; 2: a fresh engine started there
                auto e = organ(held, ORGAN, "{}", DIST);
                btg::Transport t;
                if (how < 2) {
                    t.play(longest, e->bpm());
                    render(*e, t, 0.5, 480);
                }
                if (how == 1) t.stop();
                else t.play(gapped, e->bpm());
                return render(*e, t, 1.5, 480);
            };
            const Result restarted = run(0), stopped = run(1), fresh = run(2);
            double most = 0.0;
            for (size_t i = 0; i < restarted.left.size(); ++i)
                most = std::max({ most, std::fabs(static_cast<double>(restarted.left[i]) - stopped.left[i] - fresh.left[i]),
                                  std::fabs(static_cast<double>(restarted.right[i]) - stopped.right[i] - fresh.right[i]) });
            std::printf("organ restart: restarted less the stop alone against a fresh engine, largest difference %.2e (old tail peak %.3f, new song peak %.3f)\n",
                        most, peakIn(stopped.left, 0.0, 0.2), peakIn(fresh.left, 0.0, 1.5));
            CHECK(peakIn(stopped.left, 0.0, 0.2) > 0.01f && peakIn(fresh.left, 0.0, 1.5) > 0.01f && most < 1e-6);
        }
        // A restart inside a chain's tail (Task 20's fix round 1): the stab of 0.9 s, the chords' distortion at 1, played until a whole block
        // after its last organ tone ended, when no tone is active and the chain is still busy (its 0.3 s tail). The chain alone keeps its
        // generation from counting as drained and makes applyFx flip, so that its tail rings out on the old layer chains while the new song
        // (the same stab again) meets fresh ones: the restarted render less a stop alone at that block equals a fresh engine within 1e-6.
        {
            const char* DIST = R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"distortion":1}})";
            std::vector<float> l(480), r(480);
            const auto blocks = [&](btg::Engine& e, btg::Transport& t, int n, std::vector<float>* out) {
                for (int k = 0; k < n; ++k) {
                    const auto b = t.advance(480, rate);
                    e.render(l.data(), r.data(), b.frames, b);
                    if (out) for (int i = 0; i < b.frames; ++i) { out[0].push_back(l[i]); out[1].push_back(r[i]); }
                }
            };
            int before = 0, busy = 0; // blocks from the play to the one after the last tone ended; the chains busy there
            {
                auto e = organ(held, ORGAN, "{}", DIST);
                btg::Transport t;
                t.play(gapped, e->bpm());
                for (bool gone = false; before < 1000 && !gone; ++before) {
                    blocks(*e, t, 1, nullptr);
                    gone = before > 10 && e->activeSynthTones() == 0;
                }
                blocks(*e, t, 1, nullptr);
                ++before;
                busy = e->busyOrganChains();
            }
            const auto run = [&](int how) { // 0: play again there; 1: a stop there; 2: a fresh engine started there
                auto e = organ(held, ORGAN, "{}", DIST);
                btg::Transport t;
                if (how < 2) {
                    t.play(gapped, e->bpm());
                    blocks(*e, t, before, nullptr);
                }
                if (how == 1) t.stop();
                else t.play(gapped, e->bpm());
                std::vector<float> out[2];
                blocks(*e, t, 150, out);
                return std::array<std::vector<float>, 2> { out[0], out[1] };
            };
            const auto restarted = run(0), stopped = run(1), fresh = run(2);
            double most = 0.0, tail = 0.0;
            for (int c = 0; c < 2; ++c)
                for (size_t i = 0; i < restarted[c].size(); ++i) {
                    most = std::max(most, std::fabs(static_cast<double>(restarted[c][i]) - stopped[c][i] - fresh[c][i]));
                    tail = std::max(tail, static_cast<double>(std::fabs(stopped[c][i])));
                }
            std::printf("organ restart in a chain's tail (%.3f s after the play, %d chain busy, no tone): restarted less the stop alone against a fresh engine, largest difference %.2e (the tail alone peaks at %.2e)\n",
                        before * 480.0 / rate, busy, most, tail);
            CHECK(busy == 1 && tail > 0.0 && peakIn(fresh[0], 0.0, 1.5) > 0.01f && most < 1e-6);
        }
        // setTuning with leslie 3 (always fast) between two stabs acts from the next tone (the web reads it there: organ.js 104), not before:
        // the render equals the one without it up to the next stab, then the rotors speed up and it differs.
        {
            const auto run = [&](bool change) {
                auto e = organ(held, ORGAN);
                btg::Transport t;
                t.play(gapped, e->bpm());
                Result r = render(*e, t, 1.2, 480);
                if (change) e->setTuning(R"({"chords/organ/jazz":{"leslie":3}})");
                const Result rest = render(*e, t, 3.5, 480);
                r.left.insert(r.left.end(), rest.left.begin(), rest.left.end());
                r.right.insert(r.right.end(), rest.right.begin(), rest.right.end());
                return r;
            };
            const Result changed = run(true), kept = run(false);
            const size_t next = static_cast<size_t>((nextStab - gapped) * 0.6 * rate) - 2;
            bool same = changed.left.size() == kept.left.size();
            for (size_t i = 0; same && i < next; ++i) same = changed.left[i] == kept.left[i] && changed.right[i] == kept.right[i];
            double after = 0.0;
            for (size_t i = next; same && i < changed.left.size(); ++i) after = std::max(after, static_cast<double>(std::fabs(changed.left[i] - kept.left[i])));
            std::printf("organ setTuning leslie 3: equal until the next stab (%.3f s), then up to %.3f apart\n", static_cast<double>(next) / rate, after);
            CHECK(same && after > 1e-3);
        }
        // TAIL (organ.js 30, 98): a tone more than 10 s after the last one's end builds the chain anew: from its frame on it equals the same
        // tone of a fresh voice instance at the same place in the render quantum, bit for bit; one inside the 10 s plays on the old chain (its
        // LFOs have turned on): it differs. One voice instance through Tones; the tones on a chunk's and a quantum's first frame. Red when the
        // chain is never built anew (the first half fails) or always (the second).
        {
            const auto voice = makeVoice(btg::Engine::chords, "chords/organ/jazz", nullptr, parseTuning(NOCLICK), Timbre {}, rate);
            const auto play = [&](std::vector<std::pair<size_t, int>> notes, size_t frames) { // frame and key, 0.5 s each; both channels summed over the slots
                auto tones = organTones(rate);
                VoiceState state;
                state.rng = voice->startRng;
                Slots out;
                for (auto& slot : out) for (auto& channel : slot) channel.assign(frames, 0.0f);
                for (size_t at = 0; at < frames; at += SYNTH_FRAMES) {
                    const int count = static_cast<int>(std::min<size_t>(SYNTH_FRAMES, frames - at));
                    for (const auto& [frame, midi] : notes) {
                        if (frame < at || frame >= at + count) continue;
                        PlayEvent e;
                        e.layer = btg::Engine::chords;
                        e.midi = midi;
                        e.vel = 0.8;
                        e.durBeats = 0.5;
                        voice->play(e, static_cast<int>(frame - at), 1.0, state, *tones);
                    }
                    organChunk(*tones, at, count, out);
                }
                std::vector<float> sum(2 * frames, 0.0f);
                for (auto& slot : out) for (size_t i = 0; i < frames; ++i) { sum[i] += slot[0][i]; sum[frames + i] += slot[1][i]; }
                return sum;
            };
            // 10.6 s and 9.6 s after the first tone's start (its end 0.5 s), on chunk boundaries (1988 and 1800 chunks); not at 10 s, where the
            // slow rotors (0.8 and 0.7 Hz) have turned a whole number of times and the old chain sounds as a fresh one
            const size_t after = 508928, inside = 460800;
            const std::vector<float> fresh = play({ { 0, 60 } }, 48000);
            const std::vector<float> anew = play({ { 0, 57 }, { after, 60 } }, after + 48000), on = play({ { 0, 57 }, { inside, 60 } }, inside + 48000);
            bool same = true;
            double apart = 0.0;
            for (size_t c = 0; c < 2; ++c)
                for (size_t i = 0; i < 48000; ++i) {
                    same = same && anew[c * (after + 48000) + after + i] == fresh[c * 48000 + i];
                    apart = std::max(apart, static_cast<double>(std::fabs(on[c * (inside + 48000) + inside + i] - fresh[c * 48000 + i])));
                }
            std::printf("organ TAIL: a tone 10.1 s after the last one's end %s a fresh instance's; one 9.1 s after it differs by up to %.3f\n", same ? "equals" : "DIFFERS FROM", apart);
            CHECK(same && apart > 1e-3);
        }
        // Quick voice changes (Review Focus 2): the chords switch between the organ, the sample guitar and the e-piano every 0.25 s for 10 s.
        // Old tones ring out on their chains and nothing clicks, measured as Phase 2's test does: the second difference stays below 0.01
        // (-40 dBFS), with the organ's preset drive (0.25) in (measured 0.0022; 0.0035 with the drive off). Click, percussion and the
        // e-piano's bell are off: with them on the same run measures 0.5942 without any cut (Task 20's fix round 1), their own high partials.
        {
            const char* SMOOTH = R"({"chords/organ/jazz":{"click":0,"perc":0},"chords/epiano/rhodes":{"bell":0}})";
            auto e = organ(keys, ORGAN, SMOOTH);
            btg::Transport t;
            t.play(64.0, e->bpm());
            std::vector<float> l(480), r(480), out;
            const char* cycle[3] = { ORGAN, FUNK, EPIANO };
            int most = 0;
            for (int block = 0; block < 1000; ++block) {
                if (block % 25 == 0) e->setVoices(cycle[block / 25 % 3]);
                const auto b = t.advance(480, rate);
                e->render(l.data(), r.data(), b.frames, b);
                for (int i = 0; i < b.frames; ++i) { out.push_back(l[i]); out.push_back(r[i]); }
                most = std::max(most, e->busyOrganChains());
            }
            bool finite = true;
            double jump = 0.0, squares = 0.0;
            for (size_t i = 4; i < out.size(); ++i) {
                finite = finite && std::isfinite(out[i]);
                jump = std::max(jump, static_cast<double>(std::fabs(out[i] - 2.0f * out[i - 2] + out[i - 4]))); // per channel (interleaved)
                squares += static_cast<double>(out[i]) * out[i];
            }
            std::printf("organ, guitar and e-piano every 0.25 s: largest second difference %.4f, rms %.4f, at most %d organ chains busy\n", jump,
                        std::sqrt(squares / static_cast<double>(out.size())), most);
            CHECK(finite && jump < 0.01 && squares > 0.0 && most >= 1 && most <= CHAINS);
        }
        // A jump under the held organ chord, the chords switched to a silent voice with it: the organ's tones fall over its RELEASE (12 ms)
        // and none is active two chunks after it; the chain, an orphan now, rings out and is given up after its tail (0.3 s): no chain is
        // busy 0.5 s after the jump and the output stays below 1e-6 (playing, the sum's filters are not cleared).
        {
            auto e = organ(held, ORGAN);
            btg::Transport t;
            t.play(longest, e->bpm());
            render(*e, t, 1.0, 480);
            e->setVoices(SILENT);
            t.seek(longest + 8.0);
            render(*e, t, 0.012 + 2.0 * SYNTH_FRAMES / rate, 480);
            const int tonesLeft = e->activeSynthTones();
            render(*e, t, 0.5, 480);
            const int chainsLeft = e->busyOrganChains();
            const Result rest = render(*e, t, 0.3, 480);
            std::printf("organ jump: %d synth tones active after the release, %d organ chains busy 0.5 s later, then peak %.2e\n", tonesLeft, chainsLeft, rest.peak);
            CHECK(tonesLeft == 0 && chainsLeft == 0 && rest.peak < 1e-6);
        }
        // A loop of one beat over the held organ chord: every lap starts its three keys again (wheels, click and percussion: nine tones) and the
        // wrap lets the last lap's fall over 12 ms, so at most eighteen are active; the voice instance keeps its one chain (a loop gives up
        // nothing). Red when a jump leaves the organ's tones ringing (they pile up: each rings 2.1 s) or a lap takes a new chain.
        {
            auto e = organ(held, ORGAN);
            btg::Transport t;
            t.setLoop(longest, longest + 1.0);
            t.play(longest, e->bpm());
            std::vector<float> l(480), r(480);
            int most = 0, chains = 0;
            for (int block = 0; block < 600; ++block) { // 6 s, ten laps
                const auto b = t.advance(480, rate);
                e->render(l.data(), r.data(), b.frames, b);
                most = std::max(most, e->activeSynthTones());
                chains = std::max(chains, e->busyOrganChains());
            }
            std::printf("organ loop: at most %d synth tones active and %d organ chain busy over ten laps\n", most, chains);
            CHECK(most >= 9 && most <= 18 && chains == 1);
        }
        // Stop and silence: the stop chokes the organ's tones (15 ms, ended at 1e-7); while its chain's tail still sounds after them (its
        // delays, the preamp's shaper and highpass) the engine is not quiet, and then the output is exactly 0. Red when quiet does not look at
        // the chain slots (the engine falls silent with the last tone).
        {
            auto e = organ(held, ORGAN);
            btg::Transport t;
            t.play(longest, e->bpm());
            render(*e, t, 0.5, 480);
            t.stop();
            std::vector<float> l(480), r(480);
            bool tailSounds = false, tonesGone = false;
            float lastPeak = 0.0f;
            for (int block = 0; block < 200; ++block) { // 2 s
                const auto b = t.advance(480, rate);
                e->render(l.data(), r.data(), b.frames, b);
                float peak = 0.0f;
                for (int i = 0; i < b.frames; ++i) peak = std::max({ peak, std::fabs(l[i]), std::fabs(r[i]) });
                tailSounds = tailSounds || (tonesGone && e->busyOrganChains() > 0 && peak > 0.0f); // a whole block after the last tone ended
                tonesGone = e->activeSynthTones() == 0;
                if (block >= 180) lastPeak = std::max(lastPeak, peak);
            }
            std::printf("organ stop: the chain's tail sounds after the last tone: %s; the last 0.2 s peak %.1e, %d chains busy\n", tailSounds ? "yes" : "no", lastPeak,
                        e->busyOrganChains());
            CHECK(tailSounds && lastPeak == 0.0f && e->busyOrganChains() == 0);
        }
        // All four slots busy (Tones::takeChain): four voice instances one after the other (10 chunks apart), each holding a long note, each
        // given up when the next comes as a restart gives it up (orphan); a fifth then takes the oldest orphan's slot: that one's tones are cut
        // and from the fifth's start the slot plays it alone (as a fresh instance's tone there, bit for bit), while the other three slots play
        // as they do without the fifth, bit for bit.
        {
            const auto voice = makeVoice(btg::Engine::chords, "chords/organ/jazz", nullptr, parseTuning(NOCLICK), Timbre {}, rate);
            const size_t apart = 10 * SYNTH_FRAMES, frames = 4 * apart + 192 * SYNTH_FRAMES; // whole chunks
            const auto run = [&](int instances, Slots& out, int (&slot)[5]) {
                auto tones = organTones(rate);
                VoiceState states[5];
                for (VoiceState& s : states) s.rng = voice->startRng;
                for (auto& s : out) for (auto& channel : s) channel.assign(frames, 0.0f);
                for (size_t at = 0; at < frames; at += SYNTH_FRAMES) {
                    for (int k = 0; k < instances; ++k) {
                        if (at != static_cast<size_t>(k) * apart) continue;
                        if (k > 0 && states[k - 1].chain >= 0) tones->chains[static_cast<size_t>(states[k - 1].chain)].orphan = true; // given up (Engine::restart)
                        PlayEvent e;
                        e.layer = btg::Engine::chords;
                        e.midi = 57 + 2 * k;
                        e.vel = 0.8;
                        e.durBeats = 2.0;
                        voice->play(e, 0, 1.0, states[k], *tones);
                    }
                    organChunk(*tones, at, SYNTH_FRAMES, out);
                }
                for (int k = 0; k < 5; ++k) slot[k] = states[k].chain;
            };
            Slots four, five, single;
            int fourSlots[5], fiveSlots[5], singleSlots[5];
            run(4, four, fourSlots);
            run(5, five, fiveSlots);
            {
                auto tones = organTones(rate); // a fresh instance's tone of key 65
                VoiceState state;
                state.rng = voice->startRng;
                PlayEvent e;
                e.layer = btg::Engine::chords;
                e.midi = 65;
                e.vel = 0.8;
                e.durBeats = 2.0;
                for (auto& s : single) for (auto& channel : s) channel.assign(frames, 0.0f);
                for (size_t at = 0; at < frames; at += SYNTH_FRAMES) {
                    if (at == 0) voice->play(e, 0, 1.0, state, *tones);
                    organChunk(*tones, at, SYNTH_FRAMES, single);
                }
                singleSlots[0] = state.chain;
            }
            bool chained = singleSlots[0] >= 0; // every instance holds a chain (a silent organ has none: the check fails)
            for (int k = 0; k < 5; ++k) chained = chained && fiveSlots[k] >= 0 && (k == 4 || fourSlots[k] >= 0);
            const int taken = chained ? fiveSlots[4] : -1;
            bool others = chained, before = chained, alone = chained;
            for (int k = 1; k < 4 && chained; ++k) others = others && fiveSlots[k] == fourSlots[k] && five[fiveSlots[k]][0] == four[fourSlots[k]][0] && five[fiveSlots[k]][1] == four[fourSlots[k]][1];
            for (int c = 0; c < 2 && chained; ++c)
                for (size_t i = 0; i < frames; ++i) {
                    if (i < 4 * apart) before = before && five[taken][c][i] == four[taken][c][i];
                    else alone = alone && five[taken][c][i] == single[singleSlots[0]][c][i - 4 * apart];
                }
            std::printf("organ, four chains busy: the fifth instance took slot %d (the first instance's: %d); the other three %s, the taken slot %s before and %s after\n",
                        taken, fourSlots[0], others ? "unchanged" : "CHANGED", before ? "unchanged" : "CHANGED", alone ? "plays the fifth alone" : "DOES NOT play the fifth alone");
            CHECK(taken == fourSlots[0] && others && before && alone);
        }

        // The classic synth (Task 22) on bass, chords, pad and lead: its voice (voices/classic.cpp) on the tracks above and on `four` (the
        // fixture with those four layers alone, the lead playing a melody) and `pads` (the pad alone), dry, no limiter.
        {
            const char* CLASSIC = R"({"bass":{"id":"synth","variant":"classic"},"chords":{"id":"synth","variant":"classic"},"pad":{"id":"synth","variant":"classic"},"lead":{"id":"synth","variant":"classic"}})";
            const char* CLASSIC_CHORDS = R"({"chords":{"id":"synth","variant":"classic"}})";
            const char* CLASSIC_PAD = R"({"pad":{"id":"synth","variant":"classic"}})";
            const char* SILENT_PAD = R"({"pad":{"id":"none","variant":"none"}})";
            const auto swap = [](std::string& s, const std::string& from, const std::string& to) { s.replace(s.find(from), from.size(), to); };
            std::string four = track, pads = track;
            swap(four, "\"drums\":true", "\"drums\":false");
            swap(four, "\"chords\":false", "\"chords\":true");
            swap(four, "\"pad\":false", "\"pad\":true");
            swap(four, "\"lead\":false", "\"lead\":true");
            swap(four, "\"lead\":\"off\"", "\"lead\":\"melody\""); // the lead layer plays only with a job
            swap(pads, "\"drums\":true", "\"drums\":false");
            swap(pads, "\"bass\":true", "\"bass\":false");
            swap(pads, "\"pad\":false", "\"pad\":true");
            const btg::Engine::Layer FOUR[4] = { btg::Engine::bass, btg::Engine::chords, btg::Engine::pad, btg::Engine::lead };
            const auto interleaved = [&](btg::Engine& e, btg::Transport& t, int blocks, const auto& before) {
                std::vector<float> l(480), r(480), out;
                for (int block = 0; block < blocks; ++block) {
                    before(block);
                    const auto b = t.advance(480, rate);
                    e.render(l.data(), r.data(), b.frames, b);
                    for (int i = 0; i < b.frames; ++i) { out.push_back(l[i]); out.push_back(r[i]); }
                }
                return out;
            };
            const auto secondDifference = [](const std::vector<float>& out) { // per channel of an interleaved render; a NaN is the largest
                double jump = 0.0;
                for (size_t i = 4; i < out.size(); ++i) {
                    const double d = std::fabs(out[i] - 2.0f * out[i - 2] + out[i - 4]);
                    if (!(d <= jump)) jump = d;
                }
                return jump;
            };
            // It plays: bass, chords, pad and lead with synth/classic are ready and each has a level.
            {
                auto e = make(four, CLASSIC);
                btg::Transport t;
                t.play(64.0, e->bpm());
                const Result r = render(*e, t, 4.0, 480);
                bool all = r.finite;
                for (const btg::Engine::Layer l : FOUR) {
                    const float level = e->takePeak(l);
                    std::printf("classic: %s peak %.3f\n", LAYER_NAMES[l], level);
                    all = all && level > 0.01f && e->voiceStatus().find(std::string("\"") + LAYER_NAMES[l] + "\":\"ready\"") != std::string::npos;
                }
                CHECK(all);
            }
            // The chords' chains run in two channels while their chorus is above 0 (Voice::stereo: the voice's two panned saws), in one at 0.
            // With the chain's vibrato at 1, so that a chain is built (its chorus is 0 by ownsChorus): at 0 the layer's two channels are one
            // signal that its balance alone scales (correlation above 0.9999), at 1 they are not (below 0.99). A chain in one channel gives the
            // right the left's signal.
            for (const double chorus : { 1.0, 0.0 }) {
                const std::string sound = std::string(R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"vibrato":1,"chorus":)") + (chorus > 0 ? "1" : "0") + "}}";
                auto e = organ(keys, CLASSIC_CHORDS, "{}", sound.c_str());
                btg::Transport t;
                t.play(64.0, e->bpm());
                const Result r = render(*e, t, 2.0, 480);
                double lr = 0.0, ll = 0.0, rr = 0.0;
                for (size_t i = 0; i < r.left.size(); ++i) { lr += static_cast<double>(r.left[i]) * r.right[i]; ll += static_cast<double>(r.left[i]) * r.left[i]; rr += static_cast<double>(r.right[i]) * r.right[i]; }
                const double correlation = lr / std::sqrt(ll * rr);
                std::printf("classic chords, chorus %.0f, the chain's vibrato 1: left and right correlate %.5f, rms %.4f\n", chorus, correlation, r.rms);
                CHECK(r.finite && r.rms > 1e-3 && (chorus > 0 ? correlation < 0.99 : correlation > 0.9999));
            }
            // Review Focus 5, pitch: the bass's sine (sub 1 and cutoff 0: sineGain 3, its saws at 0.4 through a lowpass that has fallen to
            // 56 Hz by 0.15 s): A2 at 44.1 and 96 kHz within 2 cents of 110 Hz, between the first and the last upward zero crossing from 0.2 s on.
            for (const double sr : { 44100.0, 96000.0 }) {
                Timbre timbre;
                timbre.bass.sub = 1;
                timbre.bass.cutoff = 0;
                const auto voice = makeVoice(btg::Engine::bass, "bass/synth/classic", nullptr, {}, timbre, sr);
                auto tones = std::make_unique<Tones>();
                tones->sr = sr;
                tones->basic = &basicWaves(sr);
                VoiceState state;
                PlayEvent e;
                e.layer = btg::Engine::bass;
                e.midi = 45;
                e.vel = 0.8;
                e.durBeats = 2.0;
                voice->play(e, 0, 1.0, state, *tones);
                std::vector<float> l(static_cast<size_t>(1.2 * sr)), r(l.size());
                for (size_t at = 0; at < l.size(); at += SYNTH_FRAMES)
                    for (SynthTone& t : tones->synth) if (t.active) t.render(&l[at], &r[at], static_cast<int>(std::min<size_t>(SYNTH_FRAMES, l.size() - at)), tones->scratch);
                double first = -1.0, last = -1.0;
                int crossings = 0;
                for (size_t i = static_cast<size_t>(0.2 * sr); i + 1 < l.size(); ++i)
                    if (l[i] <= 0 && l[i + 1] > 0) {
                        last = (static_cast<double>(i) + l[i] / (l[i] - l[i + 1])) / sr;
                        if (first < 0) first = last;
                        ++crossings;
                    }
                const double cents = 1200 * std::log2((crossings - 1) / (last - first) / 110.0);
                std::printf("classic bass at %.0f Hz: A2 %+.3f cents off 110 Hz over %d periods\n", sr, cents, crossings - 1);
                CHECK(crossings > 100 && std::fabs(cents) < 2);
            }
            // Review Focus 2: the chords switch between the organ, the sample guitar and the classic synth every 0.25 s for 10 s. Old tones
            // ring out and nothing clicks, by Task 20's measure: the second difference stays below 0.01 (-40 dBFS), on a sound whose own high
            // partials lie under it, as there (the organ's click and percussion off): the chords' brightness 0 (the classic chords' lowpass
            // from 720 to 450 Hz). The classic chords alone, without any change, measure 0.0462 at the neutral sound, 0.0030 at brightness 0.
            const char* DARK = R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"brightness":0}})";
            {
                auto e = organ(keys, ORGAN, R"({"chords/organ/jazz":{"click":0,"perc":0}})", DARK);
                btg::Transport t;
                t.play(64.0, e->bpm());
                const char* cycle[3] = { ORGAN, FUNK, CLASSIC_CHORDS };
                const std::vector<float> out = interleaved(*e, t, 1000, [&](int block) { if (block % 25 == 0) e->setVoices(cycle[block / 25 % 3]); });
                double squares = 0.0;
                for (const float x : out) squares += static_cast<double>(x) * x;
                const double jump = secondDifference(out);
                std::printf("classic, organ and guitar every 0.25 s: largest second difference %.4f, rms %.4f\n", jump, std::sqrt(squares / static_cast<double>(out.size())));
                CHECK(jump < 0.01 && squares > 0.0);
            }
            // A voice change while playing changes ownsChorus (synth.js 276: setVoices sets the chains again, without `immediate`: a ramp). The
            // chords' chorus at 1: classic for 1 s (the voice's own chorus, the chain's 0), the sample guitar for 1 s (the chain's chorus comes
            // in), classic again for 3 s (it goes out). No step above Task 20's measure in either direction (the second difference below 0.01;
            // brightness 0 as above: alone, at chorus 1, the classic chords measure 0.0018);
            // from 0.2 s to 1 s after the change to the guitar the render differs from the same with the chorus knob at 0 by more than a tenth
            // of that one's rms (the chain's chorus is heard); its last 0.5 s equal the render that stays classic within 1e-5 (the chain's
            // chorus is out again).
            {
                const auto run = [&](const char* chorus, bool change) {
                    const std::string sound = std::string(R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"brightness":0,"chorus":)") + chorus + "}}";
                    auto e = organ(keys, CLASSIC_CHORDS, "{}", sound.c_str());
                    btg::Transport t;
                    t.play(64.0, e->bpm());
                    return interleaved(*e, t, 500, [&](int block) {
                        if (change && block == 100) e->setVoices(FUNK);
                        if (change && block == 200) e->setVoices(CLASSIC_CHORDS);
                    });
                };
                const std::vector<float> changed = run("1", true), knobOff = run("0", true), stays = run("1", false);
                const auto from = [](double seconds) { return static_cast<size_t>(2 * seconds * rate); }; // interleaved
                double apart = 0.0, off = 0.0, back = 0.0;
                for (size_t i = from(1.2); i < from(2.0); ++i) {
                    const double d = changed[i] - knobOff[i];
                    apart += d * d;
                    off += static_cast<double>(knobOff[i]) * knobOff[i];
                }
                for (size_t i = from(4.5); i < changed.size(); ++i) back = std::max(back, static_cast<double>(std::fabs(changed[i] - stays[i])));
                const double jump = secondDifference(changed);
                std::printf("classic chords chorus 1 to the guitar and back: largest second difference %.4f; the chain's chorus under the guitar %.1f dB "
                            "of the render without it; the last 0.5 s %.1e off the render that stays classic\n", jump, 10 * std::log10(apart / off), back);
                CHECK(jump < 0.01 && apart > 0.01 * off && back < 1e-5);
            }
            // Review Focus 4: a jump under a held pad chord, the pad switched to a silent voice with it: the old tones fall over the pad's
            // release (0.9 s) without a step (the largest difference of two successive samples from the jump on within 10 % of the tones' own in
            // their last 0.2 s before it) and are gone after it: none is active from the release and two chunks on, and the output stays below
            // -180 dBFS. A loop of one beat (0.6 s) over that chord: every lap starts its tones again and the wrap lets the last lap's fall
            // over 0.9 s, so the tones of at most three laps are active; red when a jump leaves the tones ringing (each rings 3 s and more).
            {
                double padFrom = -1.0; // beat of the first pad note of at least 2 s
                for (const btg::Event& ev : btg::buildEvents(pads))
                    if (ev.type == btg::Event::Type::note && ev.layer == "pad" && ev.dur >= 2.0) { padFrom = ev.t * (100.0 / 60.0); break; }
                int lap = 0; // the pad's notes in one lap of the loop
                for (const btg::Event& ev : btg::buildEvents(pads))
                    if (ev.type == btg::Event::Type::note && ev.layer == "pad" && ev.t * (100.0 / 60.0) > padFrom - 1e-6 && ev.t * (100.0 / 60.0) < padFrom + 1.0) ++lap;
                CHECK(padFrom >= 0.0 && lap > 0);
                {
                    auto e = make(pads, CLASSIC_PAD);
                    btg::Transport t;
                    t.play(padFrom, e->bpm());
                    const Result before = render(*e, t, 1.0, 480);
                    e->setVoices(SILENT_PAD);
                    t.seek(padFrom + 8.0);
                    const Result falling = render(*e, t, 0.9 + 2.0 * SYNTH_FRAMES / rate, 480);
                    const int left = e->activeSynthTones();
                    const Result rest = render(*e, t, 0.3, 480);
                    double own = 0.0, jump = std::fabs(falling.left[0] - before.left.back());
                    for (size_t i = before.left.size() - rate / 5; i < before.left.size(); ++i) own = std::max(own, static_cast<double>(std::fabs(before.left[i] - before.left[i - 1])));
                    for (size_t i = 1; i < falling.left.size(); ++i) jump = std::max(jump, static_cast<double>(std::fabs(falling.left[i] - falling.left[i - 1])));
                    std::printf("classic pad jump: largest step %.2e after it, %.2e before it; %d synth tones active %.3f s after it, then peak %.2e\n", jump, own, left,
                                static_cast<double>(falling.left.size()) / rate, rest.peak);
                    CHECK(own > 1e-4 && jump < 1.1 * own && left == 0 && rest.peak < 1e-9);
                }
                {
                    auto e = make(pads, CLASSIC_PAD);
                    btg::Transport t;
                    t.setLoop(padFrom, padFrom + 1.0);
                    t.play(padFrom, e->bpm());
                    int most = 0;
                    interleaved(*e, t, 600, [&](int) { most = std::max(most, e->activeSynthTones()); }); // 6 s, ten laps
                    std::printf("classic pad loop: at most %d synth tones active over ten laps of %d notes\n", most, lap);
                    CHECK(most >= lap && most <= 3 * lap);
                }
            }
            // Stop and silence with the four layers: the stop chokes the tones (15 ms, ended at 1e-7: 0.24 s); while they ring after the wet
            // fade (50 ms) the output is not 0, from 0.5 s on it is exactly 0 in both channels and no synth tone is active.
            {
                auto e = make(four, CLASSIC);
                btg::Transport t;
                t.play(64.0, e->bpm());
                render(*e, t, 1.0, 480);
                t.stop();
                const Result after = render(*e, t, 1.0, 480);
                const float late = std::max(peakIn(after.left, 0.5, 1.0), peakIn(after.right, 0.5, 1.0));
                std::printf("classic stop: peak from 60 to 150 ms after it %.2e, from 0.5 s %.2e\n", peakIn(after.left, 0.06, 0.15), late);
                CHECK(peakIn(after.left, 0.06, 0.15) > 1e-6 && late == 0.0f && e->activeSynthTones() == 0);
            }
            // No allocation and no free in render (ruling 14) with the classic synth: the four layers from their sample voices to synth/classic
            // and back and to it again while playing, the chords' chorus turned on (the voice built again, the chain in two channels), a
            // restart, a jump and a stop, the counts armed around the render calls only.
            {
                auto e = make(four, nullptr); // the fixture's sample voices
                btg::Transport t;
                std::vector<float> l(480), r(480);
                const auto counted = [&](double seconds) {
                    counting = true;
                    for (int done = 0; done < seconds * rate;) {
                        const auto b = t.advance(480, rate);
                        e->render(l.data(), r.data(), b.frames, b);
                        done += b.frames;
                    }
                    counting = false;
                };
                allocations = frees = 0;
                t.play(64.0, e->bpm());
                counted(0.5);
                e->setVoices(CLASSIC);
                counted(0.5);
                e->setVoices(R"({"bass":{"id":"sample","variant":"finger"},"chords":{"id":"sample","variant":"funk"},"pad":{"id":"sample","variant":"strings"},"lead":{"id":"sample","variant":"flute"}})");
                counted(0.5);
                e->setVoices(CLASSIC);
                counted(0.5);
                e->setSound(R"({"master":{"reverb":0,"echo":0,"roomWet":0},"chords":{"chorus":1}})");
                counted(0.5);
                t.play(64.0, e->bpm());
                counted(1.0);
                t.seek(32.0);
                counted(0.5);
                t.stop();
                counted(0.5);
                std::printf("classic render: %ld allocations, %ld frees (%s)\n", allocations, frees, e->voiceStatus().c_str());
                CHECK(allocations == 0 && frees == 0 && e->voiceStatus().find(R"("chords":"ready")") != std::string::npos);
            }
        }
    }

    std::printf(failures ? "%d check(s) failed\n" : "all checks passed\n", failures);
    return failures ? 1 : 0;
}
