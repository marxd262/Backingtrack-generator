// The sampler follows the web app at the tag port-base: src/audio/voices/sampler.js (playNote),
// sample-zones.js, sample-hits.js (format 2 kits), sample.js (notes), and the layer chain of synth.js.
// The fine values of the voices come from tunables.js through sound.json (sound_data.h).
#include "btg/engine.h"

#include "btg/generator.h"
#include "btg/pack.h"
#include "generator_internal.h"
#include "sound_data.h"

#include <nlohmann/json.hpp>

#include <array>
#include <atomic>
#include <iterator>
#include <mutex>
#include <stdexcept>
#include <utility>

namespace btg {
namespace {

using detail::clamp;
using detail::Rng;
using detail::Tuning;
using json = nlohmann::json;

const double FLOOR = 0.0001, MIN_RELEASE = 0.04, MAX_RELEASE = 2.0, CHOKE_TC = 0.012, PI = 3.141592653589793;
const int CHUNK = 256, TONES = 256;
const float MASTER = 0.6f;
const char* const LAYER_NAMES[] = { "drums", "bass", "chords", "pad", "lead", "percussion" };
// DRUM_NAMES, then PERCUSSION_NAMES of src/core/events.js
const char* const HIT_NAMES[] = { "kick", "snare", "hat", "openHat", "tomHigh", "tomMid", "tomLow", "crash", "sideStick", "rimshot", "ride", "rideBell", "hatHalf", "hatPedal",
                                  "shaker", "tambourine", "congaHigh", "congaLow", "bongoHigh", "bongoLow", "claves", "cowbell" };

enum class Art { none, staccato, dead, palmMute, hammer, slideIn, slideOff, choke };

struct PlayEvent {
    double beat = 0.0, durBeats = 0.0;
    Engine::Layer layer = Engine::drums;
    bool hit = false;
    int midi = 0, name = -1; // note: its key; hit: index into HIT_NAMES
    double vel = 0.0;
    Art art = Art::none;
    double artSemi = NAN, artTime = NAN; // NaN = not given
};

struct PlaySong {
    std::vector<PlayEvent> events;
    double lengthBeats = 0.0;
};

struct Note { // what playNote gets
    const Pack* pack;
    const Pack::Zone* zone;
    int sample, key;
    double dur, vel, gain, cents;
    Art art;
    double artSemi, artTime, filter, naturalDecay;
    int delay;
    Engine::Layer layer;
    uint64_t voice; // serial of the voice that starts it
};

// One sounding sample. Points only into its pack, never into the voice that started it: it rings out after a voice change.
struct Tone {
    bool active = false;
    uint64_t serial = 0, voice = 0;
    Engine::Layer layer = Engine::drums;
    int delay = 0; // frames until it starts (position of the event inside the block)
    const float* data = nullptr;
    int channels = 1, frames = 0, loopStart = 0, loopEnd = 0;
    bool loop = false;
    double pos = 0.0, rate = 1.0, rateMul = 1.0;
    // envelope: attack (linear), hold, decay (exponential) to sustain, release (exponential) from the note end
    enum Stage { attack, hold, decay, sustain, release } stage = attack;
    double level = 0.0, peak = 0.0, sustainLevel = 0.0, attackInc = 0.0, decayMul = 1.0, releaseMul = 1.0;
    int holdLeft = 0, decayLeft = 0, releaseN = 1, releaseLeft = 0;
    long long toNoteEnd = 0;
    double tailGain = 1.0, tailMul = 1.0;   // extra decay of the tone (naturalDecay)
    double chokeGain = 1.0, chokeMul = 1.0; // choke: falls with a time constant once chokeIn has run out
    long long chokeIn = -1;
    double glideMul = 1.0;                  // slideIn: the pitch runs up to the note
    int glideLeft = 0;
    long long toOff = -1;                   // slideOff: at the end the pitch runs down and the tone fades
    double offRateMul = 1.0, offFadeMul = 1.0, fadeGain = 1.0;
    bool lowpass = false;
    double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0, z[2][4] = {};
    int offBy = 0;
    double offTime = 0.0;

    void start(const Note& n, double sr, uint64_t number) {
        *this = Tone {};
        const Pack::Sample& s = n.pack->samples[n.sample];
        const Pack::Zone& zone = *n.zone;
        active = true;
        serial = number;
        voice = n.voice;
        layer = n.layer;
        delay = n.delay;
        data = n.pack->audio.data() + static_cast<size_t>(s.offset) * n.pack->channels;
        channels = n.pack->channels;
        frames = s.frames;
        loop = zone.loop;
        loopStart = s.loopStart;
        loopEnd = s.loopEnd;

        double dur = n.dur, filter = n.filter, naturalDecay = n.naturalDecay, gain = n.gain;
        if (n.art == Art::dead) { dur = std::min(dur, 0.05); filter = std::min(filter, 900.0); }
        if (n.art == Art::palmMute) { filter = std::min(filter, 1600.0); naturalDecay = naturalDecay > 0 ? std::min(naturalDecay, 0.5) : 0.5; }
        if (n.art == Art::hammer) gain *= 0.85; // no pick attack: quieter, soft start, into the sample
        rate = std::pow(2.0, ((n.key - zone.rootKey) * 100 + zone.tuneCents + n.cents) / 1200) * s.rate / sr;

        const double v = clamp(n.vel, 0, 1);
        const double velocity = !zone.hasVelGain ? v
            : zone.velGain[0] + (zone.velGain[1] - zone.velGain[0]) * (zone.velHi > zone.velLo ? clamp((v * 127 - zone.velLo) / (zone.velHi - zone.velLo), 0, 1) : 1.0);
        peak = std::max(FLOOR, gain * std::pow(10.0, -std::max(0.0, zone.attenuationDb) / 20) * velocity);
        sustainLevel = std::max(FLOOR, peak * std::pow(10.0, -zone.sustainDb / 20));
        const int attackN = std::max(1, static_cast<int>(std::max(n.art == Art::hammer ? 0.02 : 0.003, zone.attack) * sr));
        attackInc = peak / attackN;
        holdLeft = static_cast<int>(zone.hold * sr);
        decayLeft = std::max(1, static_cast<int>(std::max(0.001, zone.decay) * sr));
        decayMul = std::pow(sustainLevel / peak, 1.0 / decayLeft);
        const double span = std::max(0.02, dur);
        toNoteEnd = static_cast<long long>(span * sr);
        releaseN = std::max(1, static_cast<int>((n.art == Art::staccato ? 0.03 : std::min(MAX_RELEASE, std::max(MIN_RELEASE, zone.release))) * sr));
        if (naturalDecay > 0) tailMul = std::pow(10.0, -3 / (naturalDecay * sr));

        const double from = std::pow(2.0, (std::isfinite(n.artSemi) ? n.artSemi : -2.0) / 12);
        if (n.art == Art::slideIn) {
            // shortcut: the glide starts with the note; the web voice starts it artTime early so the target arrives on time. Schedule the lead-in from the event list when slides matter.
            glideLeft = std::max(1, static_cast<int>(std::min(std::isfinite(n.artTime) ? n.artTime : 0.08, span / 2) * sr));
            rateMul = from;
            glideMul = std::pow(1 / from, 1.0 / glideLeft);
        }
        if (n.art == Art::slideOff) {
            const double time = std::min(std::isfinite(n.artTime) ? n.artTime : 0.2, 0.6 * span);
            toOff = static_cast<long long>((span - time) * sr);
            offRateMul = std::pow(from, 1 / ((time + 0.03) * sr));
            offFadeMul = std::pow(0.05, 1 / std::max(1.0, time * sr));
        }
        if (n.art == Art::hammer) pos = std::min(0.03, s.frames / s.rate / 2) * s.rate;
        if (filter < 20000 && filter < 0.45 * sr) { // Web Audio lowpass, Q = 1 dB
            const double w = 2 * PI * filter / sr, alpha = std::sin(w) / (2 * std::pow(10.0, 1.0 / 20)), a0 = 1 + alpha;
            lowpass = true;
            b1 = (1 - std::cos(w)) / a0;
            b0 = b2 = b1 / 2;
            a1 = -2 * std::cos(w) / a0;
            a2 = (1 - alpha) / a0;
        }
    }

    void choke(long long inFrames, double timeConstant, double sr) {
        if (chokeIn >= 0 && chokeIn <= inFrames) return; // already choked earlier
        chokeIn = inFrames;
        chokeMul = std::exp(-1 / (timeConstant * sr));
    }

    void render(float* left, float* right, int count) {
        for (int i = 0; i < count && active; ++i) {
            if (delay > 0) { --delay; continue; }
            if (toNoteEnd == 0 && stage != release) {
                stage = release;
                releaseLeft = releaseN;
                releaseMul = std::pow(FLOOR / std::max(FLOOR, level), 1.0 / releaseN);
            }
            if (toNoteEnd > 0) --toNoteEnd;
            switch (stage) {
                case attack: level += attackInc; if (level >= peak) { level = peak; stage = hold; } break;
                case hold: if (holdLeft-- <= 0) stage = decay; break;
                case decay: level *= decayMul; if (--decayLeft <= 0) { level = sustainLevel; stage = sustain; } break;
                case sustain: break;
                case release: level *= releaseMul; if (--releaseLeft <= 0) active = false; break;
            }
            if (chokeIn == 0) { chokeGain *= chokeMul; if (chokeGain < 1e-4) active = false; }
            else if (chokeIn > 0) --chokeIn;
            if (glideLeft > 0) { rateMul *= glideMul; if (--glideLeft == 0) rateMul = 1.0; }
            if (toOff == 0) { rateMul *= offRateMul; fadeGain *= offFadeMul; }
            else if (toOff > 0) --toOff;
            tailGain *= tailMul;

            if (loop) while (pos >= loopEnd) pos -= loopEnd - loopStart;
            const int at = static_cast<int>(pos);
            if (!loop && at >= frames - 1) { active = false; break; }
            const int after = loop && at + 1 >= loopEnd ? loopStart : at + 1;
            const double frac = pos - at, gain = level * tailGain * chokeGain * fadeGain;
            double out[2];
            for (int c = 0; c < 2; ++c) {
                const int channel = channels == 2 ? c : 0;
                double x = (data[at * channels + channel] * (1 - frac) + data[after * channels + channel] * frac) * gain;
                if (lowpass) {
                    double* s = z[c];
                    const double y = b0 * x + b1 * s[0] + b2 * s[1] - a1 * s[2] - a2 * s[3];
                    s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y;
                    x = y;
                }
                out[c] = x;
            }
            left[i] += static_cast<float>(out[0]);
            right[i] += static_cast<float>(out[1]);
            pos += rate * rateMul;
        }
    }
};

// The pool of tones of all layers.
struct Tones {
    std::array<Tone, TONES> all;
    uint64_t serial = 0;
    double sr = 48000.0;

    Tone* start(const Note& n) {
        Tone* tone = &all[0];
        for (Tone& t : all) {
            if (!t.active) { tone = &t; break; }
            if (t.serial < tone->serial) tone = &t; // all busy: the oldest goes
        }
        tone->start(n, sr, ++serial);
        return tone;
    }
};

// sample-zones.js, pickZones: the best zones by distance of the key, distance of the velocity, width.
// Attack zones without an articulation of their own (the packs in use have no others).
int pickZones(const Pack& pack, int key, double vel01, const Pack::Zone** best, int capacity) {
    const int vel = static_cast<int>(detail::jsRound(clamp(vel01, 0, 1) * 127));
    const auto distance = [](int x, int lo, int hi) { return x < lo ? lo - x : x > hi ? x - hi : 0; };
    int count = 0, score[3] = { 0, 0, 0 };
    for (const Pack::Zone& z : pack.zones) {
        if (z.releaseTrigger || !z.art.empty()) continue;
        const int s[3] = { distance(key, z.keyLo, z.keyHi), distance(vel, z.velLo, z.velHi), z.keyHi - z.keyLo };
        const bool better = count == 0 || std::lexicographical_compare(s, s + 3, score, score + 3);
        if (better) { count = 0; std::copy(s, s + 3, score); }
        if ((better || std::equal(s, s + 3, score)) && count < capacity) best[count++] = &z;
    }
    return count;
}

double velocityBrightnessHz(double vel, double softHz) {
    if (!(softHz < 20000)) return 20000;
    return 20000 * std::pow(softHz / 20000, std::pow((1 - clamp(vel, 0.2, 1)) / 0.8, 1.5));
}

// The fine values a voice reads (tunables.js), NaN where the voice has none.
struct Tuned {
    double level, decay, velExp, softHz, oneShot, humanCents, humanDb, strum, strumUp, strumTilt, lowDb, midDb, midHz, highDb, highHz, layerSpread,
        choke, roomMic, velCurve, kitPan;
};

// What the web keeps inside a voice instance; starts over when the layer gets a new voice and when playing starts.
struct VoiceState {
    Rng rng { 1 };
    const Pack::Zone* lastZone[128] = {}; // round robin: the zone played last on each key
    uint64_t serial = 0;                  // of the voice it belongs to
};

// One layer's chosen voice: built on the control thread, immutable afterwards.
class Voice {
public:
    virtual ~Voice() = default;
    // Audio thread: start what event `e` plays, `delay` frames into the current chunk. No allocation, no lock.
    virtual void play(const PlayEvent& e, int delay, double secondsPerBeat, VoiceState& state, Tones& tones) const = 0;
    Rng startRng { 1 }; // what state.rng starts from: Rng(1).fork("voice-<layer>")
    Tuned tuned {};
    std::shared_ptr<const Pack> pack;
    Engine::Layer layer = Engine::drums;
};

// sample.js, sampleVoice: bass, chords, pad, lead. Not yet: strum, EQ, oneShot, round robin of format 2.
class SampleNotes final : public Voice {
public:
    void play(const PlayEvent& e, int delay, double secondsPerBeat, VoiceState& state, Tones& tones) const override {
        if (e.hit) return;
        double gain = tuned.level, cents = 0.0, filter = 20000.0;
        if (std::isfinite(tuned.velExp)) { // always both draws, so the sequence stays the same
            const double pitch = state.rng.next(), loud = state.rng.next();
            cents = (2 * pitch - 1) * tuned.humanCents;
            const double v = clamp(e.vel, 1.0 / 127, 1);
            gain *= (std::pow(v, tuned.velExp) / v) * std::pow(10.0, -((2 * loud - 1) * tuned.humanDb) / 20);
            filter = std::min(filter, velocityBrightnessHz(e.vel, tuned.softHz));
        }
        const Pack::Zone* best[16];
        if (pickZones(*pack, e.midi, e.vel, best, 16) == 0) return;
        tones.start({ pack.get(), best[0], best[0]->sample, e.midi, e.durBeats * secondsPerBeat, e.vel, gain, cents, e.art, e.artSemi, e.artTime, filter,
                      std::isfinite(tuned.decay) ? tuned.decay : 0.0, delay, layer, state.serial });
    }
};

// sample-hits.js, sampleHitVoice, format 2: drums and percussion.
class SampleHits final : public Voice {
public:
    struct Hit { int key = -1; bool halfChoke = false; };
    std::array<Hit, std::size(HIT_NAMES)> hits; // per HIT_NAMES index: the key that plays it, -1 = none

    SampleHits(Engine::Layer voiceLayer, const std::string& key, const Pack& p) {
        static const std::map<std::string, std::string> DRUM_FALLBACK { // src/core/event-helpers.js
            { "sideStick", "snare" }, { "rimshot", "snare" }, { "ride", "hat" }, { "rideBell", "hat" }, { "hatHalf", "openHat" }, { "hatPedal", "hat" } };
        const auto& hitKeys = detail::soundData().hitKeys;
        const auto own = hitKeys.find(key);
        const auto& keyMap = own != hitKeys.end() ? own->second : hitKeys.at(LAYER_NAMES[voiceLayer]);
        const auto& gm = hitKeys.at("drums");
        for (size_t i = 0; i < hits.size(); ++i) {
            std::string n = HIT_NAMES[i];
            // a name the voice's key map puts on the GM key of another plays that one's sample (kit rimshot: snare -> sideStick)
            const auto mapped = keyMap.find(n);
            if (p.version == 2 && mapped != keyMap.end() && (!gm.count(n) || gm.at(n) != mapped->second))
                for (const auto& [name, gmKey] : gm) if (gmKey == mapped->second) { n = name; break; }
            const auto fallback = DRUM_FALLBACK.find(n);
            if (!p.keys.count(n) && fallback != DRUM_FALLBACK.end()) {
                hits[i].halfChoke = n == "hatHalf"; // the open hat stands in and chokes itself after 0.1 s
                n = fallback->second;
            }
            const auto found = p.keys.find(n);
            hits[i].key = found != p.keys.end() ? found->second : -1;
        }
    }

    void play(const PlayEvent& e, int delay, double, VoiceState& state, Tones& tones) const override {
        if (!e.hit || e.name < 0) return;
        const Hit& hit = hits[static_cast<size_t>(e.name)];
        if (hit.key < 0) return;
        double selfChoke = e.art == Art::choke ? (std::isfinite(e.artTime) ? e.artTime : 0.1) : 0.0;
        if (hit.halfChoke && selfChoke == 0.0) selfChoke = 0.1;
        double cents = 0.0, gain = tuned.level;
        if (std::isfinite(tuned.humanDb)) { // always all three draws, so the sequence stays the same
            const double pitch = state.rng.next(), loud = state.rng.next();
            state.rng.next(); // spread of the velocity layers, format 1 only
            cents = (2 * pitch - 1) * tuned.humanCents;
            gain *= std::pow(10.0, -((2 * loud - 1) * tuned.humanDb) / 20);
        }
        const double vel = e.vel > 0 && std::isfinite(tuned.velCurve) ? std::pow(e.vel, tuned.velCurve) : e.vel;
        const Pack::Zone* best[16];
        const int count = pickZones(*pack, hit.key, vel, best, 16);
        if (count == 0) return;
        // round robin: any of the equally good zones, never the one played last on this key
        const Pack::Zone* zone = best[0];
        if (count > 1) {
            const Pack::Zone* pool[16];
            int n = 0;
            for (int i = 0; i < count; ++i) if (best[i] != state.lastZone[hit.key & 127]) pool[n++] = best[i];
            zone = pool[std::min(n - 1, static_cast<int>(state.rng.next() * n))];
            state.lastZone[hit.key & 127] = zone;
        }
        const auto start = [&](int sample, double g) {
            const Pack::Sample& s = pack->samples[sample];
            const double length = s.frames / s.rate / std::pow(2.0, ((hit.key - zone->rootKey) * 100 + zone->tuneCents) / 1200);
            return tones.start({ pack.get(), zone, sample, hit.key, length, vel, g, cents, Art::none, NAN, NAN, 20000.0, 0.0, delay, layer, state.serial });
        };
        Tone* started[2] = { start(zone->sample, gain), zone->room >= 0 ? start(zone->room, gain * (std::isfinite(tuned.roomMic) ? tuned.roomMic : 1.0)) : nullptr };
        for (Tone& t : tones.all) { // the library's off_by among this voice's tones
            if (!t.active || &t == started[0] || &t == started[1] || !t.offBy || t.voice != state.serial) continue;
            if (std::find(zone->chokes.begin(), zone->chokes.end(), t.offBy) != zone->chokes.end()) t.choke(delay, t.offTime / 3, tones.sr);
        }
        for (Tone* t : started) {
            if (!t) continue;
            if (selfChoke > 0) t->choke(delay + static_cast<long long>(selfChoke * tones.sr), CHOKE_TC, tones.sr);
            t->offBy = zone->offBy;
            t->offTime = zone->offTime > 0 ? zone->offTime : 3 * CHOKE_TC;
        }
    }
};

// The voice for the sample voice `key` ("bass/sample/finger") with its pack; nullptr for a voice the core cannot play (the layer is silent).
std::shared_ptr<const Voice> makeVoice(Engine::Layer layer, const std::string& key, std::shared_ptr<const Pack> pack, const Tuning& tuning) {
    std::shared_ptr<Voice> voice;
    if (layer == Engine::drums || layer == Engine::percussion) {
        // shortcut: kits of format 1 (GM keys, their own choke rule) are not ported, their layer is silent; port them with the kit cases.
        if (pack->version != 2) return nullptr;
        voice = std::make_shared<SampleHits>(layer, key, *pack);
    } else {
        voice = std::make_shared<SampleNotes>();
    }
    const auto v = [&](const char* name) { return detail::tunedValue(key, name, tuning); };
    voice->tuned = { v("level"), v("decay"), v("velExp"), v("softHz"), v("oneShot"), v("humanCents"), v("humanDb"), v("strum"), v("strumUp"), v("strumTilt"),
                     v("lowDb"), v("midDb"), v("midHz"), v("highDb"), v("highHz"), v("layerSpread"), v("choke"), v("roomMic"), v("velCurve"), v("kitPan") };
    voice->startRng = Rng(1).fork(std::string("voice-") + LAYER_NAMES[layer]); // synth.js: every voice forks from the seed 1, not the track's
    voice->pack = std::move(pack);
    voice->layer = layer;
    return voice;
}

// What the audio thread plays with: the voice of every layer (nullptr = silent) and its serial.
struct Setup {
    std::shared_ptr<const Voice> voice[Engine::layerCount];
    uint64_t serial[Engine::layerCount] = {};
};

} // namespace

struct Engine::Impl {
    // control side
    PackSource source;
    // shortcut: packs are never released while the engine lives (tones point into them); release by reference count when memory matters.
    std::map<std::string, std::shared_ptr<const Pack>> packs;
    struct Chosen { std::string key, status = "silent"; std::shared_ptr<const Voice> voice; uint64_t serial = 0; } chosen[layerCount];
    Tuning tuning;
    uint64_t serials = 0;
    // Song and setup reach the audio thread through `pending`; it hands the ones it dropped back through `retired`, freed here.
    std::mutex swap;
    std::shared_ptr<const PlaySong> pendingSong, retiredSong;
    std::shared_ptr<const Setup> pendingSetup, retiredSetup;
    std::atomic<bool> hasPending { false };
    std::atomic<double> lengthBeats { 0.0 }, bpm { 120.0 };
    std::atomic<int> beatsPerBar { 4 };
    std::atomic<float> fader[layerCount], pan[layerCount], master { 1.0f }, drive { 0.0f }, peaks[layerCount + 1];
    std::atomic<bool> muted[layerCount];
    std::atomic<bool> limiterOn { true };
    float trim[layerCount]; // synth.js, LAYER_AUDIO

    // audio side
    std::shared_ptr<const PlaySong> song;
    std::shared_ptr<const Setup> setup;
    VoiceState states[layerCount];
    Tones tones;
    size_t next = 0;
    double expected = 0.0;
    bool wasPlaying = false, reseek = true;
    float gainNow[layerCount] = {}, masterNow = 1.0f, driveNow = 0.0f;
    double limiterEnv = 0.0;
    float ahead[2][1024] = {}; // the limiter sees the signal 6 ms before it leaves, like the browser's compressor
    int aheadAt = 0, aheadFrames = 288;
    float buffers[layerCount][2][CHUNK];

    Impl() {
        for (int l = 0; l < layerCount; ++l) {
            fader[l] = 1.0f;
            pan[l] = 0.0f;
            muted[l] = false;
            trim[l] = static_cast<float>(detail::soundData().trim.at(LAYER_NAMES[l]));
        }
        for (auto& p : peaks) p = 0.0f;
    }

    // Control thread. What the audio thread gave back since the last publish is freed here, not on the audio thread.
    template <typename T> void publish(std::shared_ptr<const T> object, std::shared_ptr<const T>& pending, std::shared_ptr<const T>& retired) {
        std::shared_ptr<const T> old[2];
        const std::lock_guard<std::mutex> lock(swap);
        old[0] = std::move(retired);
        old[1] = std::exchange(pending, std::move(object));
        hasPending = true;
    }
    void publishSetup() {
        auto made = std::make_shared<Setup>();
        for (int l = 0; l < layerCount; ++l) {
            made->voice[l] = chosen[l].voice;
            made->serial[l] = chosen[l].serial;
        }
        publish<Setup>(std::move(made), pendingSetup, retiredSetup);
    }

    // Audio thread: layers whose voice changed (all: when playing starts) begin with the state of a voice just built.
    void restart(bool all) {
        for (int l = 0; l < layerCount; ++l) {
            const uint64_t serial = setup ? setup->serial[l] : 0;
            if (!all && states[l].serial == serial) continue;
            const Voice* voice = setup ? setup->voice[l].get() : nullptr;
            states[l] = VoiceState {};
            states[l].rng = voice ? voice->startRng : Rng(1);
            states[l].serial = serial;
        }
    }
};

Engine::Engine() : impl_(std::make_unique<Impl>()) {}
Engine::~Engine() = default;

void Engine::setPackSource(PackSource source) { impl_->source = std::move(source); }

void Engine::setTrack(const std::string& trackJson) {
    static const std::map<std::string, Art> ARTS { { "staccato", Art::staccato }, { "dead", Art::dead }, { "palmMute", Art::palmMute }, { "hammer", Art::hammer },
                                                    { "pull", Art::hammer }, { "slideIn", Art::slideIn }, { "slideOff", Art::slideOff }, { "choke", Art::choke } };
    const Song built = buildSong(trackJson);
    auto song = std::make_shared<PlaySong>();
    for (const int beats : built.barBeats) song->lengthBeats += beats;
    const double beatsPerSecond = built.bpm / 60;
    for (const Event& e : built.events) {
        if (e.type != Event::Type::note && e.type != Event::Type::hit) continue;
        PlayEvent p;
        const auto layer = std::find(std::begin(LAYER_NAMES), std::end(LAYER_NAMES), e.layer);
        if (layer == std::end(LAYER_NAMES)) continue;
        p.layer = static_cast<Layer>(layer - std::begin(LAYER_NAMES));
        p.hit = e.type == Event::Type::hit;
        if (p.hit) {
            const auto name = std::find(std::begin(HIT_NAMES), std::end(HIT_NAMES), e.name);
            if (name == std::end(HIT_NAMES)) continue;
            p.name = static_cast<int>(name - std::begin(HIT_NAMES));
        }
        p.beat = e.t * beatsPerSecond;
        p.durBeats = e.dur * beatsPerSecond;
        p.midi = e.midi;
        p.vel = e.vel;
        const auto art = ARTS.find(e.art);
        if (art != ARTS.end()) p.art = art->second;
        if (e.artSemi) p.artSemi = *e.artSemi;
        if (e.artTime) p.artTime = *e.artTime;
        song->events.push_back(p);
    }
    std::stable_sort(song->events.begin(), song->events.end(), [](const PlayEvent& x, const PlayEvent& y) { return x.beat < y.beat; });
    impl_->lengthBeats = song->lengthBeats;
    impl_->bpm = built.bpm;
    if (!built.barBeats.empty()) impl_->beatsPerBar = built.barBeats[0];
    impl_->publish<PlaySong>(std::move(song), impl_->pendingSong, impl_->retiredSong);
    const json track = json::parse(trackJson); // buildSong has read it already
    if (track.is_object() && track.contains("voices")) setVoices(track.at("voices").dump());
}

void Engine::setVoices(const std::string& voicesJson) {
    Impl& m = *impl_;
    const json voices = json::parse(voicesJson, nullptr, false);
    if (!voices.is_object()) return;
    bool changed = false;
    for (int l = 0; l < layerCount; ++l) {
        const auto given = voices.find(LAYER_NAMES[l]);
        if (given == voices.end() || !given->is_object()) continue;
        const auto text = [&](const char* field) {
            const auto f = given->find(field);
            return f != given->end() && f->is_string() ? f->get<std::string>() : std::string();
        };
        const std::string key = std::string(LAYER_NAMES[l]) + "/" + text("id") + "/" + text("variant");
        Impl::Chosen& c = m.chosen[l];
        if (key == c.key && c.status.rfind("error: ", 0) != 0) continue; // unchanged: its state goes on
        changed = true;
        c.key = key;
        c.serial = ++m.serials;
        c.voice = nullptr;
        c.status = "silent";
        const auto id = detail::soundData().packs.find(key);
        if (id == detail::soundData().packs.end()) continue; // not a sample voice
        try {
            std::shared_ptr<const Pack> pack;
            if (const auto held = m.packs.find(id->second); held != m.packs.end()) pack = held->second;
            else {
                pack = m.source(id->second);
                if (pack == nullptr) throw std::runtime_error("no pack");
                m.packs[id->second] = pack;
            }
            c.voice = makeVoice(static_cast<Layer>(l), key, std::move(pack), m.tuning);
            if (c.voice) c.status = "ready";
        } catch (const std::exception& error) {
            c.status = "error: " + id->second + ": " + error.what();
        }
    }
    if (changed) m.publishSetup();
}

void Engine::setTuning(const std::string& tuningJson) {
    Impl& m = *impl_;
    m.tuning = detail::parseTuning(tuningJson);
    for (int l = 0; l < layerCount; ++l) // same serial: the layer's state goes on, as in the web
        if (m.chosen[l].voice) m.chosen[l].voice = makeVoice(static_cast<Layer>(l), m.chosen[l].key, m.chosen[l].voice->pack, m.tuning);
    m.publishSetup();
}

std::string Engine::voiceStatus() const {
    nlohmann::ordered_json status = nlohmann::ordered_json::object();
    for (int l = 0; l < layerCount; ++l) status[LAYER_NAMES[l]] = impl_->chosen[l].status;
    return status.dump(-1, ' ', false, nlohmann::ordered_json::error_handler_t::replace); // a reason need not be UTF-8 (paths)
}

double Engine::lengthBeats() const { return impl_->lengthBeats; }
double Engine::bpm() const { return impl_->bpm; }
int Engine::beatsPerBar() const { return impl_->beatsPerBar; }
void Engine::setLevel(Layer layer, float fader) { impl_->fader[layer] = std::clamp(fader, 0.0f, 1.0f); }
void Engine::setMuted(Layer layer, bool muted) { impl_->muted[layer] = muted; }
void Engine::setPan(Layer layer, float pan) { impl_->pan[layer] = std::clamp(pan, -1.0f, 1.0f); }
void Engine::setMaster(float fader) { impl_->master = std::clamp(fader, 0.0f, 1.0f); }
void Engine::setBassDrive(float amount) { impl_->drive = std::clamp(amount, 0.0f, 1.0f); }
void Engine::setLimiter(bool on) { impl_->limiterOn = on; }
float Engine::takePeak(int channel) { return impl_->peaks[channel].exchange(0.0f); }

void Engine::prepare(double sampleRate) {
    Impl& m = *impl_;
    m.tones.sr = sampleRate;
    for (Tone& t : m.tones.all) t.active = false;
    m.restart(true);
    for (int l = 0; l < layerCount; ++l) m.gainNow[l] = m.muted[l] ? 0.0f : m.fader[l] * m.fader[l];
    m.masterNow = m.master * m.master;
    m.driveNow = m.drive;
    m.limiterEnv = 0.0;
    m.aheadFrames = std::clamp(static_cast<int>(0.006 * sampleRate), 1, 1024);
    m.aheadAt = 0;
    for (auto& channel : m.ahead) std::fill(std::begin(channel), std::end(channel), 0.0f);
    m.reseek = true;
    m.wasPlaying = false;
}

void Engine::render(float* left, float* right, int frames, const Transport::Block& block) {
    Impl& m = *impl_;
    if (m.hasPending) {
        const std::unique_lock<std::mutex> lock(m.swap, std::try_to_lock); // never waits: a busy lock means next block
        if (lock.owns_lock()) {
            // retired is empty here: every publish emptied it before it set pending, so nothing is freed on this thread
            if (m.pendingSong) {
                m.retiredSong = std::move(m.song);
                m.song = std::move(m.pendingSong);
                m.reseek = true;
            }
            if (m.pendingSetup) {
                m.retiredSetup = std::move(m.setup);
                m.setup = std::move(m.pendingSetup);
                m.restart(false);
            }
            m.hasPending = false;
        }
    }
    const double sr = m.tones.sr, length = m.song ? m.song->lengthBeats : 0.0;
    const double step = block.beatsPerFrame, secondsPerBeat = step > 0 ? 1 / (step * sr) : 0.0;
    const float smoothLevel = static_cast<float>(1 - std::exp(-1 / (0.020 * sr))), smoothDrive = static_cast<float>(1 - std::exp(-1 / (0.005 * sr)));
    // Attack 0.1 ms, not the web's nominal 1 ms: measured against the web render (native/tools/render-ab.mjs) this
    // gives the same RMS and the closest peaks; the browser's compressor reacts faster than its attack value says.
    const double limiterAttack = std::exp(-1 / (0.0001 * sr)), limiterRelease = std::exp(-1 / (0.100 * sr));

    if (!block.playing && m.wasPlaying)
        for (Tone& t : m.tones.all) if (t.active) t.choke(0, 0.015, sr); // stop: everything fades in about 50 ms
    if (block.playing && !m.wasPlaying) m.restart(true); // the web builds its voices anew at every play()
    if (block.playing && length > 0) {
        const bool jumped = m.wasPlaying && std::fabs(block.beats - m.expected) > 1e-6;
        if (jumped) for (Tone& t : m.tones.all) if (t.active && t.layer == bass) t.toNoteEnd = 0; // held notes end at a jump, hits ring out
        if (jumped || !m.wasPlaying || m.reseek) {
            const double at = std::fmod(block.beats, length);
            m.next = static_cast<size_t>(std::lower_bound(m.song->events.begin(), m.song->events.end(), at, [](const PlayEvent& e, double b) { return e.beat < b; }) - m.song->events.begin());
            m.reseek = false;
        }
    }
    m.wasPlaying = block.playing;
    m.expected = block.beats + frames * step;

    for (int done = 0; done < frames; done += CHUNK) {
        const int count = std::min(CHUNK, frames - done);
        if (block.playing && length > 0) {
            // events of this chunk start `delay` frames in; past the end the song begins again
            const double from = std::fmod(block.beats + done * step, length), to = from + count * step;
            double lap = 0.0;
            const auto& events = m.song->events;
            for (;;) {
                if (m.next < events.size() && events[m.next].beat + lap < to) {
                    const PlayEvent& e = events[m.next++];
                    const int delay = std::clamp(static_cast<int>((e.beat + lap - from) / step), 0, count - 1);
                    if (m.setup && m.setup->voice[e.layer]) m.setup->voice[e.layer]->play(e, delay, secondsPerBeat, m.states[e.layer], m.tones);
                } else if (m.next >= events.size() && to >= length + lap) {
                    m.next = 0;
                    lap += length;
                } else break;
            }
        }
        for (auto& layer : m.buffers) for (auto& channel : layer) std::fill(channel, channel + count, 0.0f);
        for (Tone& t : m.tones.all) if (t.active) t.render(m.buffers[t.layer][0], m.buffers[t.layer][1], count);

        const float driveTarget = m.drive, masterTarget = m.master * m.master;
        const bool limit = m.limiterOn;
        float peak[layerCount + 1] = {};
        for (int i = 0; i < count; ++i) {
            // drive on the bass: a soft clipper, blended in so that 0 leaves the signal untouched
            m.driveNow += smoothDrive * (driveTarget - m.driveNow);
            if (m.driveNow > 1e-4f) {
                const float amount = std::min(1.0f, m.driveNow * 10), push = 1 + 30 * m.driveNow, level = 1 / (1 + 3 * m.driveNow);
                for (int c = 0; c < 2; ++c) {
                    float& x = m.buffers[bass][c][i];
                    x += amount * (std::tanh(x * push) * level - x);
                }
            }
            float sum[2] = { 0.0f, 0.0f };
            for (int l = 0; l < layerCount; ++l) {
                const float target = m.muted[l] ? 0.0f : m.fader[l] * m.fader[l];
                m.gainNow[l] += smoothLevel * (target - m.gainNow[l]);
                const float p = m.pan[l], g = m.gainNow[l] * m.trim[l];
                const float x = m.buffers[l][0][i] * g * (p > 0 ? 1 - p : 1), y = m.buffers[l][1][i] * g * (p < 0 ? 1 + p : 1);
                peak[l] = std::max(peak[l], std::max(std::fabs(x), std::fabs(y)));
                sum[0] += x;
                sum[1] += y;
            }
            // Limiter as in the web sum (-10 dB, ratio 20, 1 ms / 100 ms, with its automatic make-up of 5.7 dB).
            // shortcut: plain peak follower with 6 ms look-ahead, not the browser's compressor (its knee and adaptive release); the sound match of the full port needs that one rebuilt.
            double gain = MASTER; // limiter off: the sum only gets the fixed master gain
            if (limit) {
                const double in = std::max(std::fabs(sum[0]), std::fabs(sum[1])) * MASTER;
                m.limiterEnv = in + (m.limiterEnv - in) * (in > m.limiterEnv ? limiterAttack : limiterRelease);
                for (int c = 0; c < 2; ++c) std::swap(sum[c], m.ahead[c][m.aheadAt]); // out comes what went in 6 ms ago
                m.aheadAt = (m.aheadAt + 1) % m.aheadFrames;
                const double over = 20 * std::log10(std::max(m.limiterEnv, 1e-9)) + 10;
                gain = (over > 0 ? std::pow(10.0, -over * (1 - 1.0 / 20) / 20) : 1.0) * 1.928 * MASTER;
            }
            m.masterNow += smoothLevel * (masterTarget - m.masterNow);
            float l = static_cast<float>(sum[0] * gain) * m.masterNow, r = static_cast<float>(sum[1] * gain) * m.masterNow;
            if (limit) { l = std::clamp(l, -1.0f, 1.0f); r = std::clamp(r, -1.0f, 1.0f); }
            peak[layerCount] = std::max(peak[layerCount], std::max(std::fabs(l), std::fabs(r)));
            left[done + i] = l;
            right[done + i] = r;
        }
        for (int c = 0; c <= layerCount; ++c) if (peak[c] > m.peaks[c].load()) m.peaks[c].store(peak[c]);
    }
}

} // namespace btg
