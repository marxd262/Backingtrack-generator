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
#include "patch.h"
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
using detail::PlaySong;
using detail::Rng;
using detail::SynthTone;
using detail::Tone;
using detail::Tones;
using detail::Tuning;
using detail::Voice;
using detail::VoiceState;
using json = nlohmann::json;

const int CHUNK = 256;
static_assert(CHUNK == detail::SYNTH_FRAMES, "a synth tone renders at most SYNTH_FRAMES frames per call: the chunk");
const double MASTER = 0.6; // synth.js: master.gain.value = MASTER * mix.level

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

// Tones::late for an event `at` frames into the chunk on `frame`: less than 1/2048 frame after the frame counts as the frame, where
// Chromium starts a buffer (TimeToSampleFrame rounds through 1/1024 frame) while its params' events wait for the next frame, so that no
// tone's start plays its first frame at the gains' defaults (the beat arithmetic puts events on the grid a hair after their frame; a source
// a voice starts at a time it derives, such as the organ's click at a note's end, still can)
double lateOf(double at, int frame) { return at - frame < 1.0 / 2048 ? 0.0 : at - frame; }

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
    std::shared_ptr<const PlaySong> current; // the song last set: the chosen voices are prepared for it at `rate` (Voice::prepare)
    // The keeper (phase-5-design.md 3, "Task 24's buffers"): every set of buffers a prepared voice holds (Voice::held), kept here until its
    // use_count() is 1, so that the last reference is dropped here, on the control thread, never by the audio thread. A tone copies a set only
    // from a voice it plays (a setup's), and voices are freed only on this thread: once neither a voice nor a tone holds a set, nothing can
    // reach it again, and the tones' own drops (a tone reused, or found inactive in the chunk loop) are never the last.
    std::vector<std::shared_ptr<const void>> keep;
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
    // The layers with a distortion chain and a modulation chain behind it (src/core/layers.js 10 to 15: fx), their chains in two generations
    // (phase 5 ruling 5, applyFx): tones.gen[l] is the one a tone started now rings through (Tone::gen). Per generation: whether the chains
    // run in two channels, and the frames rendered since it last had an active tone (up to `drain`: see the chunk loop). The values the
    // current generation was last given (modApplied: vibrato, chorus and the tempo of the last modParams).
    static constexpr Layer FX_LAYERS[] = { bass, chords, pad, lead };
    detail::GuitarFx guitar[2][layerCount];
    detail::ModFx mod[2][layerCount];
    bool stereo[2][layerCount] = {};
    int quietFor[2][layerCount] = {}, drain = 0;
    detail::FxChainParams fxApplied[layerCount] = {};
    double modApplied[layerCount][3] = {};
    bool fxAtOnce = true; // the next playing block with a setup is a start: every layer's chains are built anew (createInstruments, { immediate: true }; applyFx)
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
    bool quiet = false;                         // stopped, faded, no tone and the layer chains drained: the chain is skipped
    float buffers[2][layerCount][2][CHUNK];     // [generation][layer][channel]: what each generation's tones and chains make
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

    // Control thread: a new song or setup or both (nullptr: unchanged) for the audio thread, under one lock, so that it takes a song together
    // with the setup whose voices are prepared for it. What the audio thread gave back since the last publish is freed here, not on the
    // audio thread (after the lock), and then every kept set of buffers that nothing else holds.
    void publish(std::shared_ptr<const PlaySong> newSong, std::shared_ptr<const Setup> made) {
        {
            std::shared_ptr<const PlaySong> oldSongs[2];
            std::shared_ptr<const Setup> oldSetups[2];
            const std::lock_guard<std::mutex> lock(swap);
            oldSongs[0] = std::move(retiredSong);
            oldSetups[0] = std::move(retiredSetup);
            if (newSong) oldSongs[1] = std::exchange(pendingSong, std::move(newSong));
            if (made) oldSetups[1] = std::exchange(pendingSetup, std::move(made));
            hasPending = true;
        }
        release();
    }
    void release() { std::erase_if(keep, [](const std::shared_ptr<const void>& set) { return set.use_count() == 1; }); }
    // Control thread: the layer's voice prepared for the current song at the current rate (Voice::prepare; a voice that computes nothing ahead
    // stays as it is; without a song or a rate it waits). `same`: the layer's voice as it was prepared for this song and rate before it was
    // built again, or nullptr.
    void prepareVoice(int l, const Voice* same) {
        if (!chosen[l].voice || !current || !(rate > 0)) return;
        std::shared_ptr<const Voice> made = chosen[l].voice->prepare(*current, rate, same);
        if (!made) return;
        if (std::shared_ptr<const void> held = made->held(); held && std::find(keep.begin(), keep.end(), held) == keep.end()) keep.push_back(std::move(held));
        chosen[l].voice = std::move(made);
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
        // synth.js 231 to 234: a chain whose chosen voice makes the chorus itself (ownChorus: the classic chord synth) gets 0; the web reads
        // `chosen`, also when that voice failed to build
        const auto chorus = [&](Layer l, double knob) { return detail::ownsChorus(LAYER_NAMES[l], chosen[l].key) ? 0.0 : knob; };
        made->vibrato[bass] = timbre.bass.vibrato; made->chorus[bass] = chorus(bass, timbre.bass.chorus);
        made->vibrato[chords] = timbre.chords.vibrato; made->chorus[chords] = chorus(chords, timbre.chords.chorus);
        made->vibrato[pad] = timbre.pad.vibrato; made->chorus[pad] = chorus(pad, timbre.pad.chorus);
        made->vibrato[lead] = timbre.lead.vibrato; made->chorus[lead] = chorus(lead, timbre.lead.chorus);
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
    void publishSetup() { publish(nullptr, buildSetup()); }
    unsigned chooseVoices(const std::string& voicesJson); // setVoices without the publish (below)
    // Control thread: the built voices again from the current tuning, timbre and rate, with the same serial (the layer's state goes on, as in
    // the web), and prepared; `sameRate`: the rate is the one they were prepared for, so what does not depend on the change is taken over.
    void rebuildVoices(bool sameRate) {
        for (int l = 0; l < layerCount; ++l) {
            if (!chosen[l].voice) continue;
            const std::shared_ptr<const Voice> before = chosen[l].voice;
            chosen[l].voice = makeVoice(static_cast<Layer>(l), chosen[l].key, before->pack, tuning, timbre, rate);
            prepareVoice(l, sameRate ? before.get() : nullptr);
        }
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

    // Audio thread: the chains' values from the setup. At a start every fx layer gets fresh chains built from them at once (the web's new
    // graph at every play()): in its current generation when none of the layer's tones is active there, else in the other one, so that the
    // old song's tones (choked by a stop shortly before, or by this play itself; at a start only they are active) ring out on the chains
    // they began under, as on the web's old graph, while the new song meets fresh ones (phase 5 ruling 5; it replaces ruling P of Phase 4).
    // A third start while both generations still ring resets the one it takes under the tones of two starts before, as every start under
    // ringing tones did before Phase 4 (it needs three starts within the old tones' ring-out of about 0.3 s). Later only the current
    // generation of a layer whose values changed gets them (the web sets them again on every change, with the same result once its ramps
    // are over); the other keeps the values it had when it was left. The modulation chain also follows the tempo (setTempo -> applyFx in
    // synth.js): a change of more than 1e-9 bpm gets a ramp of its rate. The chains run in two channels from a start whose voice feeds two
    // (Voice::stereo) or from a later block whose setup has such a voice (a setup that arrived while playing), until they are reset.
    void applyFx(bool atStart, double tempo) {
        for (const Layer l : FX_LAYERS) {
            const double v = setup->vibrato[l], c = setup->chorus[l];
            const bool twoChannels = setup->voice[l] && setup->voice[l]->stereo();
            int g = tones.gen[l];
            if (atStart) { // an organ chain counts as long as it is busy (its tones or its tail)
                const auto sounds = [l, g](const auto& t) { return t.active && t.layer == l && t.gen == g; };
                const auto rings = [l, g](const detail::OrganChain& chain) { return chain.busy() && chain.layer == l && chain.gen == g; };
                if (std::any_of(tones.all.begin(), tones.all.end(), sounds) || std::any_of(tones.synth.begin(), tones.synth.end(), sounds)
                    || std::any_of(tones.chains.begin(), tones.chains.end(), rings))
                    tones.gen[l] = static_cast<uint8_t>(g = 1 - g);
                guitar[g][l].reset();
                guitar[g][l].set(setup->fx[l], true);
                mod[g][l].reset();
                mod[g][l].set(detail::modParams(v, c, tempo), true);
                stereo[g][l] = twoChannels;
                quietFor[g][l] = drain; // empty
            } else {
                if (!(setup->fx[l] == fxApplied[l])) guitar[g][l].set(setup->fx[l], false);
                if (v != modApplied[l][0] || c != modApplied[l][1] || std::fabs(tempo - modApplied[l][2]) > 1e-9) mod[g][l].set(detail::modParams(v, c, tempo), false);
                stereo[g][l] = stereo[g][l] || twoChannels;
            }
            fxApplied[l] = setup->fx[l];
            modApplied[l][0] = v; modApplied[l][1] = c; modApplied[l][2] = tempo;
        }
    }
    // Audio thread: no generation of a layer chain that is built still has its last tones in its pipelines (the chunk loop says how that is decided).
    bool drained() const {
        for (const Layer l : FX_LAYERS)
            for (int g = 0; g < 2; ++g)
                if ((guitar[g][l].built() || mod[g][l].built()) && quietFor[g][l] < drain) return false;
        return true;
    }

    // Audio thread: layers whose voice changed (all: when playing starts) begin with the state of a voice just built. The organ chain the
    // old state held rings out as an orphan (the web's old chain, on the old `out` or in the old voice's closure).
    void restart(bool all) {
        for (int l = 0; l < layerCount; ++l) {
            const uint64_t serial = setup ? setup->serial[l] : 0;
            if (!all && states[l].serial == serial) continue;
            const Voice* voice = setup ? setup->voice[l].get() : nullptr;
            if (states[l].chain >= 0) tones.chains[static_cast<size_t>(states[l].chain)].orphan = true;
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
        p.dur = e.dur;
        if (e.beat) p.beatInBar = *e.beat;
        if (e.leslie) p.leslie = *e.leslie;
        if (e.swell) p.swell = *e.swell;
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
    Impl& m = *impl_;
    m.lengthBeats = song->lengthBeats;
    m.bpm = built.bpm;
    if (!built.barBeats.empty()) m.beatsPerBar = built.barBeats[0];
    m.current = song;
    // the track's voices (prepared for the new song as they are chosen), every other voice prepared for it, then song and setup in one swap
    const json track = json::parse(trackJson); // buildSong has read it already
    const unsigned changed = track.is_object() && track.contains("voices") ? m.chooseVoices(track.at("voices").dump()) : 0u;
    for (int l = 0; l < layerCount; ++l) if (!(changed >> l & 1u)) m.prepareVoice(l, nullptr);
    m.publish(std::move(song), m.buildSetup());
}

void Engine::setVoices(const std::string& voicesJson) {
    Impl& m = *impl_;
    const std::lock_guard<std::recursive_mutex> hold(m.control);
    if (m.chooseVoices(voicesJson)) m.publishSetup();
}

// Control thread, under `control`: the voices `voicesJson` names that differ from the chosen ones (or failed), built and prepared; one bit
// per layer whose voice changed.
unsigned Engine::Impl::chooseVoices(const std::string& voicesJson) {
    Impl& m = *this;
    const json voices = json::parse(voicesJson, nullptr, false);
    if (!voices.is_object()) return 0u;
    unsigned changed = 0u;
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
        changed |= 1u << l;
        c.key = key;
        c.serial = ++m.serials;
        c.voice = nullptr;
        c.status = "silent";
        const auto id = detail::soundData().packs.find(key);
        if (id == detail::soundData().packs.end()) { // not a sample voice: a synth voice, when the core has it
            c.voice = makeVoice(static_cast<Layer>(l), key, nullptr, m.tuning, m.timbre, m.rate);
            if (c.voice) c.status = "ready";
            m.prepareVoice(l, nullptr);
            continue;
        }
        try {
            std::shared_ptr<const Pack> pack;
            if (const auto held = m.packs.find(id->second); held != m.packs.end()) pack = held->second;
            else {
                pack = m.source(id->second);
                if (pack == nullptr) throw std::runtime_error("no pack");
                m.packs[id->second] = pack;
            }
            c.voice = makeVoice(static_cast<Layer>(l), key, std::move(pack), m.tuning, m.timbre, m.rate);
            if (c.voice) c.status = "ready";
        } catch (const std::exception& error) {
            c.status = "error: " + id->second + ": " + error.what();
        }
    }
    return changed;
}

void Engine::setTuning(const std::string& tuningJson) {
    Impl& m = *impl_;
    const std::lock_guard<std::recursive_mutex> hold(m.control);
    m.tuning = detail::parseTuning(tuningJson);
    m.rebuildVoices(true);
    m.publishSetup();
}

void Engine::setSound(const std::string& timbreJson) {
    Impl& m = *impl_;
    const std::lock_guard<std::recursive_mutex> hold(m.control);
    m.timbre = detail::completeTimbre(timbreJson);
    m.rebuildVoices(true);
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
int Engine::activeSynthTones() const {
    const auto& synth = impl_->tones.synth;
    return static_cast<int>(std::count_if(synth.begin(), synth.end(), [](const detail::SynthTone& t) { return t.active; }));
}
int Engine::busyOrganChains() const {
    const auto& chains = impl_->tones.chains;
    return static_cast<int>(std::count_if(chains.begin(), chains.end(), [](const detail::OrganChain& c) { return c.busy(); }));
}
int Engine::keptBuffers() const {
    const std::lock_guard<std::recursive_mutex> hold(impl_->control);
    return static_cast<int>(impl_->keep.size());
}

void Engine::prepare(double sampleRate) {
    Impl& m = *impl_;
    const std::lock_guard<std::recursive_mutex> hold(m.control);
    const bool newRate = sampleRate != m.rate;
    if (newRate) { m.reverb = nullptr; m.room = nullptr; } // responses for the new rate
    m.rate = sampleRate;
    if (newRate) m.rebuildVoices(false); // the organ's waves and the string voices' buffers are built for the rate
    std::shared_ptr<const Setup> made = m.buildSetup(), old[3]; // what this replaces is freed here, at the end, never on the audio thread
    std::shared_ptr<const PlaySong> oldSongs[2];
    {
        const std::lock_guard<std::mutex> lock(m.swap);
        old[0] = std::move(m.pendingSetup);
        old[1] = std::move(m.retiredSetup);
        oldSongs[0] = std::move(m.retiredSong);
        if (m.pendingSong) { // with the setup prepared for it (the song last set): the two arrive together
            oldSongs[1] = std::exchange(m.song, std::move(m.pendingSong));
            m.reseek = true;
        }
        m.hasPending = false;
    }
    old[2] = std::exchange(m.setup, std::move(made)); // the audio side's: prepare never runs during render
    m.tones.sr = sampleRate;
    m.tones.basic = &detail::basicWaves(sampleRate); // allocates the first time at a rate
    m.tones.quantum = 0;
    for (Tone& t : m.tones.all) t.active = false;
    for (SynthTone& t : m.tones.synth) { t.active = false; t.hold = nullptr; }
    m.tones.noise = detail::synthNoise(sampleRate); // allocates
    for (detail::OrganChain& c : m.tones.chains) c.prepare(sampleRate); // allocates: the Leslie's delays; every chain given up
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
    // the four shapers' latency in series and 0.05 s for the modulation chain (mod_fx.cpp MAX_DELAY, the most one delay holds; the vibrato's
    // delay and a chorus copy's are in series and take 26 ms together with today's values): the chunk loop
    m.drain = 2 * (detail::Shaper::latency(2) + detail::Shaper::latency(4)) + static_cast<int>(std::ceil(0.05 * sampleRate));
    for (const Layer l : Impl::FX_LAYERS) { // the curves and kernels are computed here, never first on the audio thread
        for (int g = 0; g < 2; ++g) {
            m.guitar[g][l].prepare(l, sampleRate);
            m.mod[g][l].prepare(sampleRate); // allocates: the six rings
            m.stereo[g][l] = false;
            m.quietFor[g][l] = m.drain;
        }
        m.tones.gen[l] = 0;
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
    for (auto& s : old) s = nullptr; // what this replaced, then the kept buffers nothing holds any more
    for (auto& s : oldSongs) s = nullptr;
    m.release();
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
        for (SynthTone& t : m.tones.synth) if (t.active) { if (t.delay > 0) t.active = false; else t.choke(0, 0.015, sr); }
        if (m.wetFadeLeft < 0) m.wetFadeLeft = m.wetFadeFrames;
    }
    // The start logic fires once, at the first block of a play (the first block of its lead, when it has one); the song's place is taken at
    // the first block that is not a lead's (startPending), which is no jump: the place is the one the lead stood on. A lead's blocks
    // schedule nothing (other standing blocks, as a render's tail or a test's, are handled as before).
    if (block.playing && (!m.wasPlaying || restarted)) { // the web builds its voices (and its delay, with the time of the tempo) anew at every play()
        m.tones.quantum = 0; // the render quanta are counted from a play's first frame (the web's play() falls on one; a jump does not move them)
        m.restart(true);
        m.echoAtOnce = true;
        m.fxAtOnce = true;
        m.startPending = true;
    }
    if (block.playing && length > 0 && !block.lead) {
        const bool jumped = m.wasPlaying && !m.startPending && std::fabs(block.beats - m.expected) > 1e-6;
        if (jumped) { // held notes end (their release begins; a synth tone falls over its voice's release), hits ring out, what has not begun never will
            for (Tone& t : m.tones.all) {
                if (!t.active) continue;
                if (t.delay > 0) t.active = false;
                else if (t.layer != drums && t.layer != percussion) t.toNoteEnd = 0;
            }
            for (SynthTone& t : m.tones.synth) {
                if (!t.active) continue;
                if (t.delay > 0) t.active = false;
                else if (t.layer != drums && t.layer != percussion) t.release(sr);
            }
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
    // that block builds them in its other generation (applyFx). Not in the echo's block: a start inside the wet fade must still build the chains.
    // The vibrato's rate follows the tempo of the moment: the moving clock's (as the echo's), in a lead the block's own (Transport::Block::bpm),
    // else the song's.
    if (block.playing && m.setup) {
        m.applyFx(m.fxAtOnce, step > 0 ? step * sr * 60 : block.bpm > 0 ? block.bpm : m.bpm.load());
        m.fxAtOnce = false;
    }
    // Stopped, the fade over, no tone left and the layer chains drained: the shelf and the compressors start empty, and the chain is skipped
    // until playing resumes.
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
    } else if (const auto active = [](const auto& t) { return t.active; };
               !m.quiet && m.wetFadeLeft < 0 && std::none_of(m.tones.all.begin(), m.tones.all.end(), active) && std::none_of(m.tones.synth.begin(), m.tones.synth.end(), active)
               && std::none_of(m.tones.chains.begin(), m.tones.chains.end(), [](const detail::OrganChain& c) { return c.busy(); }) && m.drained()) {
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
                        const double at = step > 0 ? (ahead - late.leadBeats) / step : 0.0;
                        m.tones.late = lateOf(at, static_cast<int>(at));
                        voice->play(late, static_cast<int>(at), secondsPerBeat, m.states[e.layer], m.tones);
                        continue;
                    }
                    // the event's frame in the chunk, and the part of a frame after it, which the synth tones start at (Tones::late)
                    const double at = step > 0 ? (e.beat + lap - from) / step : 0.0;
                    const int delay = std::clamp(static_cast<int>(at), 0, count - 1);
                    m.tones.late = lateOf(at, delay);
                    if (voice) voice->play(e, delay, secondsPerBeat, m.states[e.layer], m.tones);
                } else if (m.next >= events.size() && to >= length + lap) {
                    m.next = 0;
                    lap += length;
                    m.skipBefore = -INFINITY;
                } else break;
            }
        }
        for (auto& gen : m.buffers) for (auto& layer : gen) for (auto& channel : layer) std::fill(channel, channel + count, 0.0f);
        for (detail::OrganChain& c : m.tones.chains) if (c.live) c.clear(count);
        bool sounding[2][layerCount] = {}; // a tone of that generation and layer is active in this chunk, or an organ chain is busy
        for (Tone& t : m.tones.all) if (t.active) { sounding[t.gen][t.layer] = true; t.render(m.buffers[t.gen][t.layer][0], m.buffers[t.gen][t.layer][1], count); }
        for (SynthTone& t : m.tones.synth) {
            if (t.active) {
                sounding[t.gen][t.layer] = true;
                if (t.bus < 0) t.render(m.buffers[t.gen][t.layer][0], m.buffers[t.gen][t.layer][1], count, m.tones.scratch);
                else { // into its organ chain's entry
                    detail::OrganChain& c = m.tones.chains[static_cast<size_t>(t.bus / 3)];
                    c.heard = true;
                    t.render(c.in[t.bus % 3], nullptr, count, m.tones.scratch);
                }
            }
            if (!t.active && t.hold) t.hold = nullptr; // its buffer is no longer read: the keeper frees it, this is never the last reference
        }
        // The organ chains, each into the buffer of its layer and generation: one that is busy (a tone played into it in this chunk, or its
        // tail has not passed) and the one a voice instance holds while playing (its LFOs run on, as the web's do until its dead). An orphan
        // that has rung out is free.
        for (detail::OrganChain& c : m.tones.chains) {
            if (!c.live) continue;
            if (c.busy() || (block.playing && !c.orphan)) c.process(m.buffers[c.gen][c.layer][0], m.buffers[c.gen][c.layer][1], count, m.tones.quantum);
            if (c.busy()) sounding[c.gen][c.layer] = true;
            else if (c.orphan) c.live = false;
        }
        m.tones.quantum = (m.tones.quantum + count) % 128;
        // The distortion chains hear the sum of the layer's tones, before mute, fader and trim (synth.js: voice -> fx.input), the modulation
        // chains what comes out of them: in one channel, the right one then taking the left until the chorus makes two of it, or in two where
        // the voice feeds two (Voice::stereo). Each generation hears the tones started under it. The current one runs while playing, as the
        // web's chains do; a generation otherwise runs while it has an active tone and until it has drained: `drain` frames rendered after
        // the last chunk in which it had one (the four shapers' latency in series and 0.05 s for the modulation chain, 3040 frames at
        // 48 kHz: by then its pipelines hold nothing of its tones; what its filters still ring then is cut: 1.7e-7 for one bass tone's
        // tail behind fuzz 1, measured once by a probe, not by a test). A drained generation that is not the current one costs nothing;
        // the output of one that runs joins
        // the current one's.
        for (const Layer l : Impl::FX_LAYERS) {
            const int now = m.tones.gen[l];
            for (const int g : { now, 1 - now }) {
                int& quietFor = m.quietFor[g][l];
                const bool runs = (block.playing && g == now) || sounding[g][l] || quietFor < m.drain;
                quietFor = sounding[g][l] ? 0 : std::min(quietFor + count, m.drain);
                if (!runs) continue;
                float* const bl = m.buffers[g][l][0];
                float* const br = m.buffers[g][l][1];
                if (m.guitar[g][l].built()) m.guitar[g][l].process(bl, br, count, m.stereo[g][l]);
                if (m.mod[g][l].built()) m.mod[g][l].process(bl, br, bl, br, count, m.stereo[g][l]);
                else if (m.guitar[g][l].built() && !m.stereo[g][l]) std::copy(bl, bl + count, br);
                if (g != now)
                    for (int c = 0; c < 2; ++c) for (int i = 0; i < count; ++i) m.buffers[now][l][c][i] += m.buffers[g][l][c][i];
            }
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
                const auto& layer = m.buffers[m.tones.gen[l]][l]; // both generations' output (the chains above)
                const float tl = layer[0][i] * g, tr = layer[1][i] * g; // after mute, fader and trim: the drums' send taps here
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
