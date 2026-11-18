// The sampler follows the web app at the tag port-base: src/audio/voices/sampler.js (playNote),
// sample-zones.js, sample-hits.js (format 2 kits), sample.js (bass), and the layer chain of synth.js.
// Numbers marked "tunables.js" are the shipped values of the voices drums/sample/standard and bass/sample/finger.
#include "btg/engine.h"

#include "btg/generator.h"
#include "btg/pack.h"
#include "generator_internal.h"

#include <array>
#include <atomic>
#include <mutex>

namespace btg {
namespace {

using detail::clamp;
using detail::Rng;

const double FLOOR = 0.0001, MIN_RELEASE = 0.04, MAX_RELEASE = 2.0, CHOKE_TC = 0.012, PI = 3.141592653589793;
const int CHUNK = 256, VOICES = 64;
const float TRIM[Engine::layerCount] = { 0.65f, 0.24f }; // synth.js, LAYER_AUDIO
const float MASTER = 0.6f;

enum class Art { none, staccato, dead, palmMute, hammer, slideIn, slideOff };

struct PlayEvent {
    double beat = 0.0, durBeats = 0.0;
    Engine::Layer layer = Engine::drums;
    int key = 0;
    double vel = 0.0;
    Art art = Art::none;
    double artSemi = NAN, artTime = NAN; // NaN = not given
    double selfChoke = 0.0;              // seconds after which a hit chokes itself, 0 = never
};

struct PlaySong {
    std::vector<PlayEvent> events;
    double lengthBeats = 0.0;
    Rng rngDrums { 1 }, rngBass { 1 };
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
};

struct Voice {
    bool active = false;
    uint64_t serial = 0;
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
    double tailGain = 1.0, tailMul = 1.0;   // extra decay of the voice (naturalDecay)
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
        *this = Voice {};
        const Pack::Sample& s = n.pack->samples[n.sample];
        const Pack::Zone& zone = *n.zone;
        active = true;
        serial = number;
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
    return 20000 * std::pow(softHz / 20000, std::pow((1 - clamp(vel, 0.2, 1)) / 0.8, 1.5));
}

} // namespace

struct Engine::Impl {
    // control side
    std::shared_ptr<const Pack> packs[layerCount];
    std::mutex swap;
    std::shared_ptr<const PlaySong> pending, retired;
    std::atomic<bool> hasPending { false };
    std::atomic<double> lengthBeats { 0.0 }, bpm { 120.0 };
    std::atomic<int> beatsPerBar { 4 };
    std::atomic<float> fader[layerCount], pan[layerCount], master { 1.0f }, drive { 0.0f }, peaks[layerCount + 1];
    std::atomic<bool> muted[layerCount];
    std::atomic<bool> limiterOn { true };

    // audio side
    std::shared_ptr<const PlaySong> song;
    double sr = 48000.0;
    std::array<Voice, VOICES> voices;
    uint64_t serial = 0;
    size_t next = 0;
    double expected = 0.0;
    bool wasPlaying = false, reseek = true;
    Rng rngDrums { 1 }, rngBass { 1 };
    const Pack::Zone* lastZone[128] = {};
    float gainNow[layerCount] = {}, masterNow = 1.0f, driveNow = 0.0f;
    double limiterEnv = 0.0;
    float ahead[2][1024] = {}; // the limiter sees the signal 6 ms before it leaves, like the browser's compressor
    int aheadAt = 0, aheadFrames = 288;
    float buffers[layerCount][2][CHUNK];

    Impl() {
        for (int l = 0; l < layerCount; ++l) { fader[l] = 1.0f; pan[l] = 0.0f; muted[l] = false; }
        for (auto& p : peaks) p = 0.0f;
    }

    Voice* startVoice(const Note& n) {
        Voice* voice = &voices[0];
        for (Voice& v : voices) {
            if (!v.active) { voice = &v; break; }
            if (v.serial < voice->serial) voice = &v; // all busy: the oldest goes
        }
        voice->start(n, sr, ++serial);
        return voice;
    }

    // sample-hits.js, format 2
    void hit(const PlayEvent& e, int delay) {
        const Pack& pack = *packs[drums];
        const double pitch = rngDrums.next(), loud = rngDrums.next();
        rngDrums.next(); // third draw of the web voice (spread of the velocity layers, not used by format 2)
        const double gain = 2.5 * std::pow(10.0, -((2 * loud - 1) * 0.7) / 20); // tunables.js: level, humanDb
        const double cents = (2 * pitch - 1) * 6;                                // humanCents
        const double vel = e.vel > 0 ? std::pow(e.vel, 0.5) : e.vel;             // velCurve
        const Pack::Zone* best[16];
        const int count = pickZones(pack, e.key, vel, best, 16);
        if (count == 0) return;
        // round robin: any of the equally good zones, never the one played last on this key
        const Pack::Zone* zone = best[0];
        if (count > 1) {
            const Pack::Zone* pool[16];
            int n = 0;
            for (int i = 0; i < count; ++i) if (best[i] != lastZone[e.key & 127]) pool[n++] = best[i];
            zone = pool[std::min(n - 1, static_cast<int>(rngDrums.next() * n))];
            lastZone[e.key & 127] = zone;
        }
        const auto play = [&](int sample, double g) {
            const Pack::Sample& s = pack.samples[sample];
            const double length = s.frames / s.rate / std::pow(2.0, ((e.key - zone->rootKey) * 100 + zone->tuneCents) / 1200);
            return startVoice({ &pack, zone, sample, e.key, length, vel, g, cents, Art::none, NAN, NAN, 20000.0, 0.0, delay, drums });
        };
        Voice* started[2] = { play(zone->sample, gain), zone->room >= 0 ? play(zone->room, gain * 1.0) : nullptr }; // roomMic 1
        for (Voice& v : voices) {
            if (!v.active || &v == started[0] || &v == started[1] || !v.offBy) continue;
            if (std::find(zone->chokes.begin(), zone->chokes.end(), v.offBy) != zone->chokes.end()) v.choke(delay, v.offTime / 3, sr);
        }
        for (Voice* v : started) {
            if (!v) continue;
            if (e.selfChoke > 0) v->choke(delay + static_cast<long long>(e.selfChoke * sr), CHOKE_TC, sr);
            v->offBy = zone->offBy;
            v->offTime = zone->offTime > 0 ? zone->offTime : 3 * CHOKE_TC;
        }
    }

    // sample.js, layer bass with the values of bass/sample/finger
    void note(const PlayEvent& e, int delay, double secondsPerBeat) {
        const Pack& pack = *packs[bass];
        const double pitch = rngBass.next(), loud = rngBass.next();
        const double v = clamp(e.vel, 1.0 / 127, 1);
        const double gain = 4.0 * (std::pow(v, 1.3) / v) * std::pow(10.0, -((2 * loud - 1) * 0.6) / 20); // level, velExp, humanDb
        const Pack::Zone* best[16];
        if (pickZones(pack, e.key, e.vel, best, 16) == 0) return;
        startVoice({ &pack, best[0], best[0]->sample, e.key, e.durBeats * secondsPerBeat, e.vel, gain, (2 * pitch - 1) * 1.5, e.art, e.artSemi, e.artTime,
                     velocityBrightnessHz(e.vel, 2500), 2.5, delay, bass }); // softHz, decay
    }
};

Engine::Engine() : impl_(std::make_unique<Impl>()) {}
Engine::~Engine() = default;

void Engine::setPack(Layer layer, std::shared_ptr<const Pack> pack) { impl_->packs[layer] = std::move(pack); }

void Engine::setTrack(const std::string& trackJson) {
    static const std::map<std::string, std::string> FALLBACK { { "sideStick", "snare" }, { "rimshot", "snare" }, { "ride", "hat" }, { "rideBell", "hat" }, { "hatHalf", "openHat" }, { "hatPedal", "hat" } };
    static const std::map<std::string, Art> ARTS { { "staccato", Art::staccato }, { "dead", Art::dead }, { "palmMute", Art::palmMute }, { "hammer", Art::hammer },
                                                    { "pull", Art::hammer }, { "slideIn", Art::slideIn }, { "slideOff", Art::slideOff } };
    const Song built = buildSong(trackJson);
    auto song = std::make_shared<PlaySong>();
    const Rng seed(built.seed);
    song->rngDrums = seed.fork("voice-drums");
    song->rngBass = seed.fork("voice-bass");
    for (const int beats : built.barBeats) song->lengthBeats += beats;
    const double beatsPerSecond = built.bpm / 60;
    for (const Event& e : built.events) {
        PlayEvent p;
        p.beat = e.t * beatsPerSecond;
        p.vel = e.vel;
        if (e.type == Event::Type::hit && e.layer == "drums" && impl_->packs[drums]) {
            // shortcut: format 2 kits only (the pack names its keys). Format 1 kits need the GM table and their own choke rule.
            const auto& keys = impl_->packs[drums]->keys;
            std::string name = e.name;
            p.selfChoke = e.art == "choke" ? e.artTime.value_or(0.1) : 0.0;
            const auto basic = FALLBACK.find(name);
            if (!keys.count(name) && basic != FALLBACK.end()) {
                if (name == "hatHalf" && p.selfChoke == 0.0) p.selfChoke = 0.1;
                name = basic->second;
            }
            if (!keys.count(name)) continue;
            p.layer = drums;
            p.key = keys.at(name);
        } else if (e.type == Event::Type::note && e.layer == "bass" && impl_->packs[bass]) {
            p.layer = bass;
            p.key = e.midi;
            p.durBeats = e.dur * beatsPerSecond;
            const auto art = ARTS.find(e.art);
            if (art != ARTS.end()) p.art = art->second;
            if (e.artSemi) p.artSemi = *e.artSemi;
            if (e.artTime) p.artTime = *e.artTime;
        } else continue;
        song->events.push_back(p);
    }
    std::stable_sort(song->events.begin(), song->events.end(), [](const PlayEvent& x, const PlayEvent& y) { return x.beat < y.beat; });
    impl_->lengthBeats = song->lengthBeats;
    impl_->bpm = built.bpm;
    if (!built.barBeats.empty()) impl_->beatsPerBar = built.barBeats[0];
    std::shared_ptr<const PlaySong> old; // freed here, not on the audio thread
    {
        const std::lock_guard<std::mutex> lock(impl_->swap);
        old = std::move(impl_->retired);
        impl_->pending = std::move(song);
        impl_->hasPending = true;
    }
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
    m.sr = sampleRate;
    for (Voice& v : m.voices) v.active = false;
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
            m.retired = std::move(m.song);
            m.song = std::move(m.pending);
            m.hasPending = false;
            m.rngDrums = m.song->rngDrums;
            m.rngBass = m.song->rngBass;
            m.reseek = true;
        }
    }
    const double length = m.song ? m.song->lengthBeats : 0.0;
    const double step = block.beatsPerFrame, secondsPerBeat = step > 0 ? 1 / (step * m.sr) : 0.0;
    const float smoothLevel = static_cast<float>(1 - std::exp(-1 / (0.020 * m.sr))), smoothDrive = static_cast<float>(1 - std::exp(-1 / (0.005 * m.sr)));
    // Attack 0.1 ms, not the web's nominal 1 ms: measured against the web render (native/tools/render-ab.mjs) this
    // gives the same RMS and the closest peaks; the browser's compressor reacts faster than its attack value says.
    const double limiterAttack = std::exp(-1 / (0.0001 * m.sr)), limiterRelease = std::exp(-1 / (0.100 * m.sr));

    if (!block.playing && m.wasPlaying)
        for (Voice& v : m.voices) if (v.active) v.choke(0, 0.015, m.sr); // stop: everything fades in about 50 ms
    if (block.playing && length > 0) {
        const bool jumped = m.wasPlaying && std::fabs(block.beats - m.expected) > 1e-6;
        if (jumped) for (Voice& v : m.voices) if (v.active && v.layer == bass) v.toNoteEnd = 0; // held notes end at a jump, hits ring out
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
                    if (e.layer == drums) m.hit(e, delay);
                    else m.note(e, delay, secondsPerBeat);
                } else if (m.next >= events.size() && to >= length + lap) {
                    m.next = 0;
                    lap += length;
                } else break;
            }
        }
        for (auto& layer : m.buffers) for (auto& channel : layer) std::fill(channel, channel + count, 0.0f);
        for (Voice& v : m.voices) if (v.active) v.render(m.buffers[v.layer][0], m.buffers[v.layer][1], count);

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
                const float p = m.pan[l], g = m.gainNow[l] * TRIM[l];
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
