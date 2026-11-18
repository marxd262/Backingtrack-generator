// The engine: the events of the song, handed to the voice of each layer (sampler.h), and the layer chain of the web app's
// synth.js (mute, fader, trim, balance, master, limiter).
#include "btg/engine.h"

#include "btg/generator.h"
#include "btg/pack.h"
#include "sampler.h"
#include "sound_data.h"

#include <nlohmann/json.hpp>

#include <atomic>
#include <iterator>
#include <mutex>
#include <stdexcept>
#include <utility>

namespace btg {
namespace {

using detail::ART_NAMES;
using detail::Art;
using detail::HIT_NAMES;
using detail::LAYER_NAMES;
using detail::makeVoice;
using detail::PlayEvent;
using detail::Rng;
using detail::Tone;
using detail::Tones;
using detail::Tuning;
using detail::Voice;
using detail::VoiceState;
using json = nlohmann::json;

const int CHUNK = 256;
const float MASTER = 0.6f;

struct PlaySong {
    std::vector<PlayEvent> events; // by trigger beat
    double lengthBeats = 0.0, maxLeadBeats = 0.0;
};

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
    unsigned starts = 0; // Transport::Block::starts of the last block
    double skipBefore = -INFINITY; // song beat of the last jump less a frame: events triggered before it do not play (but see render)
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
    static const std::map<std::string, Art> ARTS {
        { "staccato", Art::staccato }, { "dead", Art::dead }, { "chuck", Art::chuck }, { "choke", Art::choke }, { "palmMute", Art::palmMute }, { "hammer", Art::hammer },
        { "pull", Art::hammer }, { "slideIn", Art::slideIn }, { "scoop", Art::scoop }, { "slideOff", Art::slideOff }, { "fall", Art::fall }, { "bend", Art::bend },
        { "vibrato", Art::vibrato }, { "swell", Art::swell } };
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
        const auto artName = std::find(std::begin(ART_NAMES), std::end(ART_NAMES), e.art);
        if (artName != std::end(ART_NAMES)) p.artName = *artName;
        if (e.artSemi) p.artSemi = *e.artSemi;
        if (e.artTime) p.artTime = *e.artTime;
        if (e.artRate) p.artRate = *e.artRate;
        if (e.strum) { p.strumIndex = e.strum->first; p.strumCount = e.strum->second; }
        if (e.strumUp) p.strumUp = *e.strumUp;
        p.ring = e.ring;
        p.t = e.t;
        if (e.beat) p.beatInBar = *e.beat;
        if (p.art == Art::slideIn || p.art == Art::scoop) { // sampler.js: the glide starts early so that the note arrives on time (offline: room = t)
            const double lead = e.t > 0.02 ? std::min(std::isfinite(p.artTime) ? p.artTime : 0.08, e.t) : 0.0;
            p.leadBeats = lead * beatsPerSecond;
            p.beat -= p.leadBeats;
            p.durBeats += p.leadBeats;
            song->maxLeadBeats = std::max(song->maxLeadBeats, p.leadBeats);
        }
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

    const bool restarted = block.playing && m.wasPlaying && block.starts != m.starts; // play() again, no stopped block between
    m.starts = block.starts;
    // stop: everything fades in about 50 ms; a tone that has not begun (strum, a later event of the block) never will
    if (m.wasPlaying && (!block.playing || restarted))
        for (Tone& t : m.tones.all) if (t.active) { if (t.delay > 0) t.active = false; else t.choke(0, 0.015, sr); }
    if (block.playing && (!m.wasPlaying || restarted)) m.restart(true); // the web builds its voices anew at every play()
    if (block.playing && length > 0) {
        const bool jumped = m.wasPlaying && !restarted && std::fabs(block.beats - m.expected) > 1e-6;
        if (jumped) // held notes end (their release begins), hits ring out, what has not begun never will
            for (Tone& t : m.tones.all) {
                if (!t.active) continue;
                if (t.delay > 0) t.active = false;
                else if (t.layer != drums && t.layer != percussion) t.toNoteEnd = 0;
            }
        if (jumped || restarted || !m.wasPlaying || m.reseek) {
            // After a jump or a start, what lies less than a frame before the new place belongs to its first frame (a loop wraps up
            // to a frame after its start), and the cursor goes back to the earliest trigger whose note may still lie ahead (a glide
            // begins its lead earlier). A new song while playing goes on from the place itself: what lies before it has been played.
            const bool jump = jumped || restarted || !m.wasPlaying;
            m.skipBefore = std::fmod(block.beats, length) - (jump ? step : 0.0);
            m.next = static_cast<size_t>(std::lower_bound(m.song->events.begin(), m.song->events.end(), m.skipBefore - (jump ? m.song->maxLeadBeats : 0.0),
                                                          [](const PlayEvent& e, double b) { return e.beat < b; }) - m.song->events.begin());
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
                    const Voice* voice = m.setup ? m.setup->voice[e.layer].get() : nullptr;
                    if (e.beat + lap < m.skipBefore) {
                        // triggered before the place just jumped to: gone, unless it is a glide whose note is still ahead. That one
                        // begins now with the lead that is left (sampler.js 128: 20 ms or less is none, the tone begins on its note).
                        const double note = e.beat + e.leadBeats + lap;
                        if (note < m.skipBefore || !voice) continue;
                        const double ahead = std::max(0.0, note - from);
                        PlayEvent late = e;
                        late.leadBeats = ahead * secondsPerBeat > 0.02 ? ahead : 0.0;
                        late.durBeats -= e.leadBeats - late.leadBeats;
                        voice->play(late, step > 0 ? static_cast<int>((ahead - late.leadBeats) / step) : 0, secondsPerBeat, m.states[e.layer], m.tones);
                        continue;
                    }
                    const int delay = std::clamp(static_cast<int>((e.beat + lap - from) / step), 0, count - 1);
                    if (voice) voice->play(e, delay, secondsPerBeat, m.states[e.layer], m.tones);
                } else if (m.next >= events.size() && to >= length + lap) {
                    m.next = 0;
                    lap += length;
                    m.skipBefore = -INFINITY;
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
