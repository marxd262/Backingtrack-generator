// The engine: the events of the song, handed to the voice of each layer (sampler.h), and the layer chain of the web app's
// synth.js (the distortion chain of bass, chords, pad and lead, mute, fader, trim, balance, master, the reverb and the shared room, echo,
// brightness shelf, bus compressor and limiter). The vibrato and chorus of those layers come right behind the distortion chain.
#include "btg/engine.h"

#include "btg/generator.h"
#include "btg/pack.h"
#include "compressor.h"
#include "convolver.h"
#include "echo.h"
#include "guitar_fx.h"
#include "mod_fx.h"
#include "sampler.h"
#include "sound_data.h"
#include "sound_model.h"

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
const double MASTER = 0.6; // synth.js: master.gain.value = MASTER * mix.level

struct PlaySong {
    std::vector<PlayEvent> events; // by trigger beat
    double lengthBeats = 0.0, maxLeadBeats = 0.0;
};

// What the audio thread plays with: the voice of every layer (nullptr = silent), its serial and the layer's place by mix/pan, and the
// sum's values from the timbre (masterParams): gain, shelf and the width that multiplies every place; the sends (masterParams,
// drumParams, mix/room) and their two convolvers, built on the control thread for the rate of the last prepare (none before it) and
// used and changed only by the audio thread; the echo's values (its line lives on the audio side); the bus (applyBus of synth.js); the
// layer effects' values (fxChainParams and the vibrato and chorus knobs, only the four layers with a chain have any).
struct Setup {
    std::shared_ptr<const Voice> voice[Engine::layerCount];
    uint64_t serial[Engine::layerCount] = {};
    float pan[Engine::layerCount] = {};
    detail::FxChainParams fx[Engine::layerCount] = {};
    double vibrato[Engine::layerCount] = {}, chorus[Engine::layerCount] = {}; // modParams takes them with the tempo of the moment
    double masterGain = 0.6, shelfDb = 0.0, shelfHz = 800.0, width = 1.0;
    double reverbWet = 0.15, roomSend = 0.0, roomWet = 1.0, roomTone = 7000.0, roomSends[Engine::layerCount] = {};
    std::shared_ptr<detail::Convolver> reverb, room;
    double echoWet = 0.3, echoFeedback = 0.38, echoTone = 2400.0;
    // The sum's compressors (threshold dB, knee dB, ratio, attack s, release s) and the gains behind them: on = glue compressor, then
    // limiter at the ceiling; off = the old limiter alone (-10 dB, with the make-up the compressor gives itself).
    // The defaults are the web's (MIX_TUNABLES: on 0); only setCompressors() without a setup reads them, and that one never runs without one.
    struct Bus { bool on = false; float glue[5] = { 0, 0, 1, 0.03f, 0.25f }, limiter[5] = { -10, 0, 20, 0.001f, 0.1f }; double glueOut = 1.0, limiterOut = 1.0; } bus;
};

void clear(detail::Biquad& f) { f.x1 = f.x2 = f.y1 = f.y2 = 0.0; } // the filter's state, not its coefficients

} // namespace

struct Engine::Impl {
    // control side, under `control` (every control call and prepare take it; the audio thread never)
    std::recursive_mutex control;
    double rate = 0.0; // of the last prepare: the rate the responses are built for
    // The convolvers of the setups: the same objects while rate and mix.roomSize stay, so that their state goes on across knob moves.
    std::shared_ptr<detail::Convolver> reverb, room;
    double roomSize = NAN; // of `room`
    PackSource source;
    // shortcut: packs are never released while the engine lives (tones point into them); release by reference count when memory matters.
    std::map<std::string, std::shared_ptr<const Pack>> packs;
    struct Chosen { std::string key, status = "silent"; std::shared_ptr<const Voice> voice; uint64_t serial = 0; } chosen[layerCount];
    Tuning tuning;
    detail::Timbre timbre; // DEFAULT_TIMBRE until setSound
    uint64_t serials = 0;
    // Song and setup reach the audio thread through `pending`; it hands the ones it dropped back through `retired`, freed here.
    std::mutex swap;
    std::shared_ptr<const PlaySong> pendingSong, retiredSong;
    std::shared_ptr<const Setup> pendingSetup, retiredSetup;
    std::atomic<bool> hasPending { false };
    std::atomic<double> lengthBeats { 0.0 }, bpm { 120.0 };
    std::atomic<int> beatsPerBar { 4 };
    std::atomic<float> fader[layerCount], pan[layerCount], master { 1.0f }, peaks[layerCount + 1];
    std::atomic<bool> muted[layerCount];
    std::atomic<bool> limiterOn { true };
    float trim[layerCount]; // synth.js, LAYER_AUDIO
    bool roomLayer[layerCount]; // LAYER_AUDIO room: the layer goes into the reverb through roomSend
    bool echoLayer[layerCount]; // LAYER_AUDIO echo: the layer feeds the echo

    // audio side
    std::shared_ptr<const PlaySong> song;
    std::shared_ptr<const Setup> setup;
    VoiceState states[layerCount];
    Tones tones;
    size_t next = 0;
    double expected = 0.0;
    bool wasPlaying = false, reseek = true;
    bool startPending = false; // a play began and the clock has not moved yet (a lead): the song's place is taken at its first moving block
    unsigned starts = 0; // Transport::Block::starts of the last block
    double skipBefore = -INFINITY; // song beat of the last jump less a frame: events triggered before it do not play (but see render)
    float gainNow[layerCount] = {}, panNow[layerCount] = {}, masterNow = 1.0f;
    // The layers with a distortion chain and a modulation chain behind it (src/core/layers.js 10 to 15: fx), their state, and the values they
    // were last given (modApplied: vibrato, chorus and the tempo of the last modParams).
    static constexpr Layer FX_LAYERS[] = { bass, chords, pad, lead };
    detail::GuitarFx guitar[layerCount];
    detail::ModFx mod[layerCount];
    detail::FxChainParams fxApplied[layerCount] = {};
    double modApplied[layerCount][3] = {};
    bool fxAtOnce = true; // the next playing block with a setup is a start: the chains of a layer with no active tone are built anew (createInstruments, { immediate: true })
    double masterGainNow = MASTER, shelfNow = 0.0, shelfSet = 0.0; // the sum's gain (synth.js `master`) and the shelf's gain now, and the one its coefficients are for
    detail::Biquad shelf[2];
    detail::Compressor glue, limiter; // Chromium's compressors (limiter: the name of the node in synth.js); each keeps its state across a restart
    double glueOutNow = 1.0, limiterOutNow = 1.0; // the gains behind them
    bool glueWasIn = false, limiterWasIn = false; // in the chain in the last chunk (a compressor that comes back is reset)
    // the sends now (they follow the setup's values) and the room's return filters, and the tone their coefficients are for
    double reverbWetNow = 0.0, roomWetNow = 0.0, roomSendNow = 0.0, roomToneSet = 7000.0;
    float roomSendsNow[layerCount] = {};
    detail::Biquad roomHp[2], roomLp[2];
    detail::Echo echo;
    double echoWetNow = 0.0, echoFeedbackNow = 0.0, echoToneSet = 2400.0;
    bool echoAtOnce = true; // the next playing block with a tempo sets the echo's time at once (a start), later ones glide
    double wetAt[CHUNK];    // the wet fade's value of each frame of the chunk, for the second pass
    int wetFadeFrames = 2400, wetFadeLeft = -1; // the wet returns' fade after a stop or a restart: frames left, -1 = none
    bool wetClosed = false;                     // a stop's fade is over: the wet returns stay at 0 until playing resumes
    bool quiet = false;                         // stopped, faded and no tone: the chain is skipped
    float buffers[layerCount][2][CHUNK];
    float mixed[2][CHUNK], reverbIn[2][CHUNK], reverbOut[2][CHUNK], roomIn[2][CHUNK], roomOut[2][CHUNK], shelved[2][CHUNK];

    Impl() {
        for (int l = 0; l < layerCount; ++l) {
            fader[l] = 1.0f;
            pan[l] = NAN;
            muted[l] = false;
            trim[l] = static_cast<float>(detail::soundData().trim.at(LAYER_NAMES[l]));
            roomLayer[l] = detail::soundData().roomLayers.count(LAYER_NAMES[l]) > 0;
            echoLayer[l] = detail::soundData().echoLayers.count(LAYER_NAMES[l]) > 0;
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
    // Control thread, under `control`: the setup of the control state. From the first prepare on it carries the convolvers; a new
    // mix.roomSize (exact compare, as applyRoom) gets a new, empty room: its tail is cut, as Chromium's ConvolverHandler::SetBuffer does.
    std::shared_ptr<Setup> buildSetup() {
        auto made = std::make_shared<Setup>();
        for (int l = 0; l < layerCount; ++l) {
            made->voice[l] = chosen[l].voice;
            made->serial[l] = chosen[l].serial;
            made->pan[l] = static_cast<float>(detail::tunedValue("mix/pan", LAYER_NAMES[l], tuning));
            made->roomSends[l] = detail::tunedValue("mix/room", LAYER_NAMES[l], tuning);
        }
        const detail::MasterParams mix = detail::masterParams(timbre.master);
        made->masterGain = MASTER * mix.level;
        made->shelfDb = mix.shelfDb;
        made->shelfHz = mix.shelfFreq;
        made->width = mix.width;
        made->reverbWet = mix.reverbWet;
        made->roomSend = detail::drumParams(timbre.drums).roomSend;
        made->roomWet = mix.roomWet * detail::tunedValue("mix/room", "wet", tuning);
        made->roomTone = detail::tunedValue("mix/room", "tone", tuning);
        made->echoWet = mix.echoWet;
        made->echoFeedback = mix.echoFeedback;
        made->echoTone = mix.echoTone;
        made->fx[bass] = detail::fxChainParams(timbre.bass.fuzz, timbre.bass.overdrive, timbre.bass.distortion, bass);
        made->fx[chords] = detail::fxChainParams(timbre.chords.fuzz, timbre.chords.overdrive, timbre.chords.distortion, chords);
        made->fx[pad] = detail::fxChainParams(timbre.pad.fuzz, timbre.pad.overdrive, timbre.pad.distortion, pad);
        made->fx[lead] = detail::fxChainParams(timbre.lead.fuzz, timbre.lead.overdrive, timbre.lead.distortion, lead);
        // shortcut: the chain always takes the chorus knob; synth.js 231 and 234 (ownChorus) give it 0 where the voice makes the chorus
        // itself (the classic chord synth). Task 22, which ports that voice, adds the rule.
        made->vibrato[bass] = timbre.bass.vibrato; made->chorus[bass] = timbre.bass.chorus;
        made->vibrato[chords] = timbre.chords.vibrato; made->chorus[chords] = timbre.chords.chorus;
        made->vibrato[pad] = timbre.pad.vibrato; made->chorus[pad] = timbre.pad.chorus;
        made->vibrato[lead] = timbre.lead.vibrato; made->chorus[lead] = timbre.lead.chorus;
        // applyBus (synth.js 77 to 86); the compressor's own make-up (autoMakeupDb, knee 0) is taken back by the gain behind it
        const auto v = [&](const char* name) { return detail::tunedValue("mix/bus", name, tuning); };
        const auto autoMakeupDb = [](double threshold, double ratio) { return -0.6 * threshold * (1 - 1 / ratio); };
        const bool on = v("on") >= 0.5;
        const double glueDb = on ? v("glueDb") : 0, glueRatio = on ? v("glueRatio") : 1, ceiling = on ? v("ceilingDb") : -10;
        made->bus = { on, { static_cast<float>(glueDb), 0, static_cast<float>(glueRatio), static_cast<float>(v("glueAttack")), static_cast<float>(v("glueRelease")) },
                      { static_cast<float>(ceiling), 0, 20, 0.001f, 0.1f }, on ? std::pow(10.0, (v("gainDb") - autoMakeupDb(glueDb, glueRatio)) / 20) : 1.0,
                      on ? std::pow(10.0, -autoMakeupDb(ceiling, 20) / 20) : 1.0 };
        if (rate > 0) {
            if (!reverb) reverb = std::make_shared<detail::Convolver>(detail::normalizedNoise("reverb", 2, 3, rate));
            if (!room || roomSize != mix.roomSize) {
                room = std::make_shared<detail::Convolver>(detail::normalizedNoise("room", mix.roomSize, 6.9 / mix.roomSize, rate));
                roomSize = mix.roomSize;
            }
            made->reverb = reverb;
            made->room = room;
        }
        return made;
    }
    void publishSetup() { publish<Setup>(buildSetup(), pendingSetup, retiredSetup); }
    // Control thread: the built voices again from the current tuning and timbre, with the same serial (the layer's state goes on, as in the web).
    void rebuildVoices() {
        for (int l = 0; l < layerCount; ++l)
            if (chosen[l].voice) chosen[l].voice = makeVoice(static_cast<Layer>(l), chosen[l].key, chosen[l].voice->pack, tuning, timbre);
    }
    // Audio thread: where the layer goes, the mixer's pan or else the place mix/pan gives it, times the timbre's width (synth.js 173).
    float panTarget(int l) const {
        const float p = pan[l];
        const double place = std::isnan(p) ? (setup ? setup->pan[l] : 0.0f) : p;
        return static_cast<float>(std::clamp((setup ? setup->width : 1.0) * place, -1.0, 1.0));
    }
    // Audio thread: the compressors' parameters from the setup (they jump: the web ramps them 20 ms, design open point 9); their state stays.
    void setCompressors() {
        const Setup::Bus defaults {};
        const Setup::Bus& b = setup ? setup->bus : defaults;
        glue.set(b.glue[0], b.glue[1], b.glue[2], b.glue[3], b.glue[4]);
        limiter.set(b.limiter[0], b.limiter[1], b.limiter[2], b.limiter[3], b.limiter[4]);
    }
    // Audio thread: the sum's gain, shelf and sends at the values the setup says, at once, with the filters' state empty.
    void settleSum() {
        masterGainNow = setup ? setup->masterGain : MASTER;
        shelfNow = shelfSet = setup ? setup->shelfDb : 0.0;
        for (detail::Biquad& f : shelf) f = detail::highshelf(setup ? setup->shelfHz : 800.0, shelfNow, tones.sr);
        if (setup) {
            reverbWetNow = setup->reverbWet;
            roomWetNow = setup->roomWet;
            roomSendNow = setup->roomSend;
            for (int l = 0; l < layerCount; ++l) roomSendsNow[l] = static_cast<float>(setup->roomSends[l]);
            roomToneSet = setup->roomTone;
            echoWetNow = setup->echoWet;
            echoFeedbackNow = setup->echoFeedback;
            echo.setTone(echoToneSet = setup->echoTone);
            glueOutNow = setup->bus.glueOut;
            limiterOutNow = setup->bus.limiterOut;
        }
        setCompressors();
        for (int c = 0; c < 2; ++c) {
            roomHp[c] = detail::highpass(120, 1, tones.sr);
            roomLp[c] = detail::lowpass(roomToneSet, 1, tones.sr);
        }
    }
    // Audio thread: the sends empty (convolvers, room filters, echo), as in the web's new graph at every play().
    void clearSends() {
        if (setup && setup->reverb) setup->reverb->reset();
        if (setup && setup->room) setup->room->reset();
        echo.reset();
        for (detail::Biquad* f : { &roomHp[0], &roomHp[1], &roomLp[0], &roomLp[1] }) clear(*f);
    }

    // Audio thread: the chains' values from the setup. At a start a layer none of whose tones is active gets its chains built anew from them
    // (the web's new graph at every play()). A start that finds a tone of the layer still ringing (choked by a stop shortly before, or by this
    // play itself; at a start only the old song's tones are active) never resets a chain under it: a built distortion chain and the
    // modulation chain take the values as a change, as in mid-play (ruling P); an unbuilt distortion chain is still built at once, its
    // creation fade passes the input bit for bit. The cost: after such a start the new song meets the old chains (bias settled, LFO phases
    // running on) instead of ones that are 0.15 s old. Later only a layer whose values changed gets them (the web sets them again on every
    // change, with the same result once its ramps are over). The modulation chain also follows the tempo (setTempo -> applyFx in synth.js):
    // a change of more than 1e-9 bpm gets a ramp of its rate.
    void applyFx(bool atStart, double tempo) {
        for (const Layer l : FX_LAYERS) {
            const double v = setup->vibrato[l], c = setup->chorus[l];
            const bool ringing = atStart && std::any_of(tones.all.begin(), tones.all.end(), [l](const Tone& t) { return t.active && t.layer == l; });
            if (atStart && !(ringing && guitar[l].built())) {
                guitar[l].reset();
                guitar[l].set(setup->fx[l], true);
            } else if (!(setup->fx[l] == fxApplied[l])) guitar[l].set(setup->fx[l], false);
            if (atStart && !ringing) {
                mod[l].reset();
                mod[l].set(detail::modParams(v, c, tempo), true);
            } else if (v != modApplied[l][0] || c != modApplied[l][1] || std::fabs(tempo - modApplied[l][2]) > 1e-9) {
                mod[l].set(detail::modParams(v, c, tempo), false);
            }
            fxApplied[l] = setup->fx[l];
            modApplied[l][0] = v; modApplied[l][1] = c; modApplied[l][2] = tempo;
        }
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

void Engine::setPackSource(PackSource source) {
    const std::lock_guard<std::recursive_mutex> hold(impl_->control);
    impl_->source = std::move(source);
}

void Engine::setTrack(const std::string& trackJson) {
    const std::lock_guard<std::recursive_mutex> hold(impl_->control);
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
    const std::lock_guard<std::recursive_mutex> hold(m.control);
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
            c.voice = makeVoice(static_cast<Layer>(l), key, std::move(pack), m.tuning, m.timbre);
            if (c.voice) c.status = "ready";
        } catch (const std::exception& error) {
            c.status = "error: " + id->second + ": " + error.what();
        }
    }
    if (changed) m.publishSetup();
}

void Engine::setTuning(const std::string& tuningJson) {
    Impl& m = *impl_;
    const std::lock_guard<std::recursive_mutex> hold(m.control);
    m.tuning = detail::parseTuning(tuningJson);
    m.rebuildVoices();
    m.publishSetup();
}

void Engine::setSound(const std::string& timbreJson) {
    Impl& m = *impl_;
    const std::lock_guard<std::recursive_mutex> hold(m.control);
    m.timbre = detail::completeTimbre(timbreJson);
    m.rebuildVoices();
    m.publishSetup();
}

std::string Engine::voiceStatus() const {
    const std::lock_guard<std::recursive_mutex> hold(impl_->control);
    nlohmann::ordered_json status = nlohmann::ordered_json::object();
    for (int l = 0; l < layerCount; ++l) status[LAYER_NAMES[l]] = impl_->chosen[l].status;
    return status.dump(-1, ' ', false, nlohmann::ordered_json::error_handler_t::replace); // a reason need not be UTF-8 (paths)
}

double Engine::lengthBeats() const { return impl_->lengthBeats; }
double Engine::bpm() const { return impl_->bpm; }
int Engine::beatsPerBar() const { return impl_->beatsPerBar; }
void Engine::setLevel(Layer layer, float fader) { impl_->fader[layer] = std::clamp(fader, 0.0f, 1.0f); }
void Engine::setMuted(Layer layer, bool muted) { impl_->muted[layer] = muted; }
void Engine::setPan(Layer layer, float pan) { impl_->pan[layer] = std::isnan(pan) ? pan : std::clamp(pan, -1.0f, 1.0f); }
void Engine::setMaster(float fader) { impl_->master = std::clamp(fader, 0.0f, 1.0f); }
void Engine::setLimiter(bool on) { impl_->limiterOn = on; }
float Engine::takePeak(int channel) { return impl_->peaks[channel].exchange(0.0f); }

void Engine::prepare(double sampleRate) {
    Impl& m = *impl_;
    const std::lock_guard<std::recursive_mutex> hold(m.control);
    if (sampleRate != m.rate) { m.reverb = nullptr; m.room = nullptr; } // responses for the new rate
    m.rate = sampleRate;
    std::shared_ptr<const Setup> made = m.buildSetup(), old[3]; // what this replaces is freed here, at the end, never on the audio thread
    {
        const std::lock_guard<std::mutex> lock(m.swap);
        old[0] = std::move(m.pendingSetup);
        old[1] = std::move(m.retiredSetup);
        m.hasPending = m.pendingSong != nullptr;
    }
    old[2] = std::exchange(m.setup, std::move(made)); // the audio side's: prepare never runs during render
    m.tones.sr = sampleRate;
    for (Tone& t : m.tones.all) t.active = false;
    m.restart(true);
    for (int l = 0; l < layerCount; ++l) {
        m.gainNow[l] = m.muted[l] ? 0.0f : m.fader[l] * m.fader[l];
        m.panNow[l] = m.panTarget(l);
    }
    m.masterNow = m.master * m.master;
    m.echo.prepare(sampleRate); // allocates: the line's size depends on the rate
    m.echoAtOnce = true;
    m.glue.prepare(static_cast<float>(sampleRate)); // a fresh node, before settleSum gives it its parameters
    m.limiter.prepare(static_cast<float>(sampleRate));
    m.settleSum();
    for (const Layer l : Impl::FX_LAYERS) { // allocation-free; the curves and kernels are computed here, never first on the audio thread
        m.guitar[l].prepare(l, sampleRate);
        m.mod[l].prepare(sampleRate); // allocates: the three rings
        m.fxApplied[l] = {};
        for (double& v : m.modApplied[l]) v = 0.0;
    }
    m.fxAtOnce = true;
    m.clearSends(); // a cached convolver may hold an old tail
    m.wetFadeFrames = std::max(1, static_cast<int>(std::lround(0.05 * sampleRate)));
    m.wetFadeLeft = -1;
    m.wetClosed = false;
    m.quiet = false;
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
                const bool first = !m.setup;
                m.retiredSetup = std::move(m.setup);
                m.setup = std::move(m.pendingSetup);
                m.restart(false);
                if (first) { // the places, the gain, the shelf and the sends at once, not a sweep from the middle
                    for (int l = 0; l < layerCount; ++l) m.panNow[l] = m.panTarget(l);
                    m.settleSum();
                } else {
                    if (m.setup->roomTone != m.roomToneSet) { // new coefficients, the state stays (the web ramps the tone: design open point 9)
                        const detail::Biquad f = detail::lowpass(m.setup->roomTone, 1, m.tones.sr);
                        for (detail::Biquad& b : m.roomLp) { b.b0 = f.b0; b.b1 = f.b1; b.b2 = f.b2; b.a1 = f.a1; b.a2 = f.a2; }
                        m.roomToneSet = m.setup->roomTone;
                    }
                    if (m.setup->echoTone != m.echoToneSet) m.echo.setTone(m.echoToneSet = m.setup->echoTone);
                    m.setCompressors();
                }
            }
            m.hasPending = false;
        }
    }
    const double sr = m.tones.sr, length = m.song ? m.song->lengthBeats : 0.0;
    const double step = block.beatsPerFrame, secondsPerBeat = step > 0 ? 1 / (step * sr) : 0.0;
    const float smoothLevel = static_cast<float>(1 - std::exp(-1 / (0.020 * sr)));

    const bool restarted = block.playing && m.wasPlaying && block.starts != m.starts; // play() again, no stopped block between
    m.starts = block.starts;
    // stop: everything fades in about 50 ms; a tone that has not begun (strum, a later event of the block) never will. The wet returns
    // fade linearly over the web's 0.05 s (play.js FADE) and the sends are emptied at its end. Playing by then (a restart): the returns open
    // at once. Stopped: they stay at 0 (the web is silent 50 ms after a stop), while the choked tones still feed the sends, and the first
    // playing block empties the sends again and opens them (the web builds a new graph at every play()).
    if (m.wasPlaying && (!block.playing || restarted)) {
        for (Tone& t : m.tones.all) if (t.active) { if (t.delay > 0) t.active = false; else t.choke(0, 0.015, sr); }
        if (m.wetFadeLeft < 0) m.wetFadeLeft = m.wetFadeFrames;
    }
    // The start logic fires once, at the first block of a play (the first block of its lead, when it has one); the song's place is taken at
    // the first block that is not a lead's (startPending), which is no jump: the place is the one the lead stood on. A lead's blocks
    // schedule nothing (other standing blocks, as a render's tail or a test's, are handled as before).
    if (block.playing && (!m.wasPlaying || restarted)) { // the web builds its voices (and its delay, with the time of the tempo) anew at every play()
        m.restart(true);
        m.echoAtOnce = true;
        m.fxAtOnce = true;
        m.startPending = true;
    }
    if (block.playing && length > 0 && !block.lead) {
        const bool jumped = m.wasPlaying && !m.startPending && std::fabs(block.beats - m.expected) > 1e-6;
        if (jumped) // held notes end (their release begins), hits ring out, what has not begun never will
            for (Tone& t : m.tones.all) {
                if (!t.active) continue;
                if (t.delay > 0) t.active = false;
                else if (t.layer != drums && t.layer != percussion) t.toNoteEnd = 0;
            }
        if (jumped || m.startPending || m.reseek) {
            // After a jump or a start, what lies less than a frame before the new place belongs to its first frame (a loop wraps up
            // to a frame after its start), and the cursor goes back to the earliest trigger whose note may still lie ahead (a glide
            // begins its lead earlier). A new song while playing goes on from the place itself: what lies before it has been played.
            const bool jump = jumped || m.startPending;
            m.skipBefore = std::fmod(block.beats, length) - (jump ? step : 0.0);
            m.next = static_cast<size_t>(std::lower_bound(m.song->events.begin(), m.song->events.end(), m.skipBefore - (jump ? m.song->maxLeadBeats : 0.0),
                                                          [](const PlayEvent& e, double b) { return e.beat < b; }) - m.song->events.begin());
            m.reseek = false;
        }
    }
    if (!block.lead) m.startPending = false;
    m.wasPlaying = block.playing;
    m.expected = block.beats + frames * step;
    // echoTime(bpm) = 60 / bpm * 0.75 with bpm = step * sr * 60; a tempo change glides (setTempo). A standing or stopped block leaves it.
    // A start inside the wet fade (a restart, or a start before a stop's 50 ms are over) finds the old song's echoes in the line: the time
    // stays where it is, not even gliding, until the fade is over and the line is cleared (the end of the chunk loop sets it then).
    if (block.playing && step > 0 && !(m.echoAtOnce && m.wetFadeLeft >= 0)) {
        m.echo.setTarget(0.75 / (step * sr), m.echoAtOnce);
        m.echoAtOnce = false;
    }
    // The layer effects: built at a play's first block, a lead's too (the creation fade and the bias then run in the lead as in the live web
    // app), and not again when the clock begins to move; later blocks only hand over what changed. A layer whose old tones still ring at
    // that block keeps its chains (applyFx). Not in the echo's block: a start inside the wet fade must still build the chains.
    // The vibrato's rate follows the tempo of the moment: the moving clock's (as the echo's), in a lead the block's own (Transport::Block::bpm),
    // else the song's.
    if (block.playing && m.setup) {
        m.applyFx(m.fxAtOnce, step > 0 ? step * sr * 60 : block.bpm > 0 ? block.bpm : m.bpm.load());
        m.fxAtOnce = false;
    }
    // Stopped, the fade over and no tone left: the shelf and the compressors start empty, and the chain is skipped until playing resumes.
    if (block.playing) {
        if (m.quiet) { // a new song's sound is there from its first frame, not gliding in from the last song's (every state it touches is empty)
            for (int l = 0; l < layerCount; ++l) m.panNow[l] = m.panTarget(l);
            m.settleSum();
        }
        m.quiet = false;
        if (m.wetClosed) {
            m.clearSends();
            m.wetClosed = false;
        }
    } else if (!m.quiet && m.wetFadeLeft < 0 && std::none_of(m.tones.all.begin(), m.tones.all.end(), [](const Tone& t) { return t.active; })) {
        for (detail::Biquad& f : m.shelf) clear(f);
        m.glue.reset();
        m.limiter.reset();
        m.quiet = true;
    }
    if (m.quiet) {
        std::fill(left, left + frames, 0.0f);
        std::fill(right, right + frames, 0.0f);
        return;
    }

    for (int done = 0; done < frames; done += CHUNK) {
        const int count = std::min(CHUNK, frames - done);
        if (block.playing && length > 0 && !block.lead) {
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
                    const int delay = step > 0 ? std::clamp(static_cast<int>((e.beat + lap - from) / step), 0, count - 1) : 0;
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
        // The distortion chains hear the sum of the layer's tones, before mute, fader and trim (synth.js: voice -> fx.input), the modulation
        // chains what comes out of them; mono, so the right channel takes the left (the four layers' packs are mono: guitar_fx.cpp, the
        // shortcut at process) until the chorus makes two channels of it.
        for (const Layer l : Impl::FX_LAYERS) {
            if (m.guitar[l].built()) m.guitar[l].process(m.buffers[l][0], count);
            if (m.mod[l].built()) m.mod[l].process(m.buffers[l][0], m.buffers[l][0], m.buffers[l][1], count);
            else if (m.guitar[l].built()) std::copy(m.buffers[l][0], m.buffers[l][0] + count, m.buffers[l][1]);
        }

        const float masterTarget = m.master * m.master;
        const bool limit = m.limiterOn;
        const Setup* s = m.setup.get();
        const double masterGainTarget = s ? s->masterGain : MASTER, shelfTarget = s ? s->shelfDb : 0.0, shelfHz = s ? s->shelfHz : 800.0;
        const double reverbWetTarget = s ? s->reverbWet : 0.0, roomWetTarget = s ? s->roomWet : 0.0, roomSendTarget = s ? s->roomSend : 0.0;
        const double echoWetTarget = s ? s->echoWet : 0.0, echoFeedbackTarget = s ? s->echoFeedback : 0.0;
        const double glueOutTarget = s ? s->bus.glueOut : 1.0, limiterOutTarget = s ? s->bus.limiterOut : 1.0;
        float peak[layerCount + 1] = {};
        // First pass: the layers and the echo's return into the dry sum (m = dry · master gain), the reverb's input (m and the drums' send)
        // and the room's. The wet fade's value of each frame is kept for the second pass.
        for (int i = 0; i < count; ++i) {
            float sum[2] = { 0.0f, 0.0f }, room[2] = { 0.0f, 0.0f }, drumsSend[2] = { 0.0f, 0.0f }, echoIn[2] = { 0.0f, 0.0f };
            for (int l = 0; l < layerCount; ++l) {
                const float target = m.muted[l] ? 0.0f : m.fader[l] * m.fader[l];
                m.gainNow[l] += smoothLevel * (target - m.gainNow[l]);
                m.panNow[l] += smoothLevel * (m.panTarget(l) - m.panNow[l]);
                m.roomSendsNow[l] += smoothLevel * ((s ? static_cast<float>(s->roomSends[l]) : 0.0f) - m.roomSendsNow[l]);
                const float g = m.gainNow[l] * m.trim[l];
                const float tl = m.buffers[l][0][i] * g, tr = m.buffers[l][1][i] * g; // after mute, fader and trim: the drums' send taps here
                const float x = tl * (1 - m.panNow[l]), y = tr * (1 + m.panNow[l]);   // synth.js balance: the room's send taps here
                peak[l] = std::max(peak[l], std::max(std::fabs(x), std::fabs(y)));
                sum[0] += x;
                sum[1] += y;
                room[0] += m.roomSendsNow[l] * x;
                room[1] += m.roomSendsNow[l] * y;
                if (m.roomLayer[l]) { drumsSend[0] += tl; drumsSend[1] += tr; }
                if (m.echoLayer[l]) { echoIn[0] += tl; echoIn[1] += tr; }
            }
            double wet = m.wetClosed ? 0.0 : 1.0;
            if (m.wetFadeLeft >= 0) { // at 0 it stays 0 to the end of the chunk; after it the sends are emptied
                wet = static_cast<double>(m.wetFadeLeft) / m.wetFadeFrames;
                if (m.wetFadeLeft > 0) --m.wetFadeLeft;
            }
            m.wetAt[i] = wet;
            m.echoWetNow += smoothLevel * (echoWetTarget - m.echoWetNow);
            m.echoFeedbackNow += smoothLevel * (echoFeedbackTarget - m.echoFeedbackNow);
            float echoOut[2];
            m.echo.process(echoIn[0], echoIn[1], m.echoFeedbackNow, echoOut[0], echoOut[1]);
            // The sum (synth.js 64, 91, 100, 102): the master gain; the echo's return is in it, so the reverb hears it and the drums' send.
            m.masterGainNow += smoothLevel * (masterGainTarget - m.masterGainNow);
            m.roomSendNow += smoothLevel * (roomSendTarget - m.roomSendNow);
            for (int c = 0; c < 2; ++c) {
                const double dry = (sum[c] + wet * m.echoWetNow * echoOut[c]) * m.masterGainNow;
                m.mixed[c][i] = static_cast<float>(dry);
                m.reverbIn[c][i] = static_cast<float>(dry + m.roomSendNow * drumsSend[c]);
                m.roomIn[c][i] = room[c];
            }
        }
        if (s && s->reverb) s->reverb->process(m.reverbIn[0], m.reverbIn[1], m.reverbOut[0], m.reverbOut[1], count);
        else for (auto& channel : m.reverbOut) std::fill(channel, channel + count, 0.0f);
        if (s && s->room) s->room->process(m.roomIn[0], m.roomIn[1], m.roomOut[0], m.roomOut[1], count);
        else for (auto& channel : m.roomOut) std::fill(channel, channel + count, 0.0f);
        // Second pass (synth.js 88 to 91, 214 to 226): the bus is the dry sum, the reverb's return and the room's (120 Hz highpass, tone lowpass),
        // then the brightness shelf. Wet values and the shelf follow their targets.
        for (int i = 0; i < count; ++i) {
            m.reverbWetNow += smoothLevel * (reverbWetTarget - m.reverbWetNow);
            m.roomWetNow += smoothLevel * (roomWetTarget - m.roomWetNow);
            const double wet = m.wetAt[i];
            double bus[2];
            for (int c = 0; c < 2; ++c) {
                const double room = m.roomLp[c].process(m.roomHp[c].process(m.roomOut[c][i])) * m.roomWetNow;
                bus[c] = m.mixed[c][i] + wet * (m.reverbWetNow * m.reverbOut[c][i] + room);
            }
            m.shelfNow += smoothLevel * (shelfTarget - m.shelfNow);
            if (std::fabs(m.shelfNow - m.shelfSet) > 1e-4) { // new coefficients, the filters' state stays
                const detail::Biquad f = detail::highshelf(shelfHz, m.shelfNow, sr);
                for (detail::Biquad& b : m.shelf) { b.b0 = f.b0; b.b1 = f.b1; b.b2 = f.b2; b.a1 = f.a1; b.a2 = f.a2; }
                m.shelfSet = m.shelfNow;
            }
            for (int c = 0; c < 2; ++c) m.shelved[c][i] = static_cast<float>(m.shelf[c].process(bus[c]));
        }
        // The bus compressors (applyBus): glue, its gain, limiter, its gain; the glue only when the bus is on. Limiter off: none of it.
        // One that was left out comes back empty (its ring would replay up to 1024 frames from before, its detector and gain are stale).
        const bool glueIn = limit && s && s->bus.on;
        if (glueIn && !m.glueWasIn) m.glue.reset();
        if (limit && !m.limiterWasIn) m.limiter.reset();
        m.glueWasIn = glueIn;
        m.limiterWasIn = limit;
        if (limit) {
            if (glueIn) {
                m.glue.process(m.shelved[0], m.shelved[1], count);
                for (int i = 0; i < count; ++i) {
                    m.glueOutNow += smoothLevel * (glueOutTarget - m.glueOutNow);
                    for (auto& channel : m.shelved) channel[i] *= static_cast<float>(m.glueOutNow);
                }
            }
            m.limiter.process(m.shelved[0], m.shelved[1], count);
            for (int i = 0; i < count; ++i) {
                m.limiterOutNow += smoothLevel * (limiterOutTarget - m.limiterOutNow);
                for (auto& channel : m.shelved) channel[i] *= static_cast<float>(m.limiterOutNow);
            }
        }
        // The master fader; nothing clamps here (the shell clips), so that what the chain makes is what gets measured.
        for (int i = 0; i < count; ++i) {
            m.masterNow += smoothLevel * (masterTarget - m.masterNow);
            const float l = m.shelved[0][i] * m.masterNow, r = m.shelved[1][i] * m.masterNow;
            peak[layerCount] = std::max(peak[layerCount], std::max(std::fabs(l), std::fabs(r)));
            left[done + i] = l;
            right[done + i] = r;
        }
        if (m.wetFadeLeft == 0) {
            m.clearSends();
            m.wetFadeLeft = -1;
            m.wetClosed = !block.playing;
            if (block.playing && step > 0 && m.echoAtOnce) { // the start's time, held back while the old echoes faded
                m.echo.setTarget(0.75 / (step * sr), true);
                m.echoAtOnce = false;
            }
        }
        for (int c = 0; c <= layerCount; ++c) if (peak[c] > m.peaks[c].load()) m.peaks[c].store(peak[c]);
    }
}

} // namespace btg
