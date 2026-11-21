// The string voices bass/string/finger and chords/string/electric: src/audio/voices/string.js line by line (line numbers of that file).
// Every tone is a buffer of the string model (string_model.h, renderString) played by a buffer source at rate 1 into a gain of `level`. The
// web computes a buffer when a note first needs it, on the thread that schedules; the core must not compute or allocate on the audio
// thread, so prepare() computes, on the control thread, every buffer a play of the song from bar 0 needs (phase 5 ruling 11), and play()
// only finds it. The web reads its values at every tone's start; the engine builds the voice again on every setSound and setTuning (and
// prepares it again when its params changed), so the values read here, when the voice is built, are the ones the web reads; the seeds of
// the buffers computed after such a change while playing are not the web's (the shortcut at prepare).
#include "../string_model.h"
#include "nodes.h"

#include <algorithm>
#include <atomic>
#include <climits>
#include <compare>
#include <iterator>
#include <map>

namespace btg::detail {
namespace {

const double MAX_DUR = 3.5;     // 8: longer notes are cut
const int ROUND_ROBIN = 3;      // 10
const int VEL_STEPS = 8;        // 11
const char* const PARAM_NAMES[8] = { "pluckPos", "brightness", "decay", "excite", "stiffness", "pickupPos", "pickupLp", "body" }; // 14
// A jump lets a ringing tone fall (SynthTone::release): the web's voice has no release of its own, the buffer holds the note's end, where
// the model's hand damps with RELEASE_TC 0.02 s (string-model.js 28, 126). The same fall, to 1e-4 in 0.02 * ln(1e4) s.
const double RELEASE = 0.02 * std::log(1e4);

std::atomic<long long> exactFound { 0 }, turnFound { 0 }, durFound { 0 }, noneFound { 0 }; // stringLookups()

// What the web's cache id (49) holds beside the rate and the params, which are the prepared voice's own: the midi, the velocity step, the
// rounded dur in steps of 50 ms (43: dur = durStep / 20) and the turn.
struct Key {
    int midi = 0, vel = 0, dur = 0, turn = 0;
    auto operator<=>(const Key&) const = default;
};
// The buffers a song needs, by key (sorted): the web's cache after a play of the song from bar 0.
struct Buffers {
    std::vector<Key> keys;
    std::vector<std::vector<float>> data;
};

int durStepOf(double dur) { return static_cast<int>(jsRound(std::min(MAX_DUR, std::max(0.05, dur)) * 20)); } // 43
int velStepOf(double vel) { return static_cast<int>(jsRound(clamp(vel, 0, 1) * VEL_STEPS)); }               // 45

class StringVoice final : public Voice {
public:
    StringParams params; // paramsNow (23 to 37)
    double rate = 0.0;   // the rate `buffers` is for
    // shortcut: no eviction above string.js's CACHE_SAMPLES (16e6 samples, 9 and 57 to 61): the set holds what the song needs, so memory grows
    // with the song, and a song whose notes need more than 16e6 samples gets other attack-noise seeds in the web after an eviction; rebuild
    // the eviction when such songs are played.
    std::shared_ptr<const Buffers> buffers;

    void play(const PlayEvent& e, int delay, double secondsPerBeat, VoiceState& state, Tones& tones) const override {
        if (e.hit || !buffers) return; // 40
        // the web plays at the note's time: the engine triggers a glide (slideIn, scoop; only the sampler glides) its lead earlier. At the
        // song's tempo the note's dur is the event's own seconds, as the web's (the beats round); at another tempo the web's dur / rate.
        const double lead = e.leadBeats * secondsPerBeat, scaled = (e.durBeats - e.leadBeats) * secondsPerBeat;
        const int durStep = durStepOf(std::fabs(scaled - e.dur) < 1e-9 ? e.dur : scaled);
        const int velStep = velStepOf(e.vel);
        uint8_t& turns = state.turns[e.midi & 127][velStep]; // 46 to 48
        const int turn = turns;
        turns = static_cast<uint8_t>((turn + 1) % ROUND_ROBIN);
        // 49, 50: the prepared buffer. shortcut: a key the set does not hold (a start elsewhere than bar 0, a loop's later lap whose turn has
        // none, a live tempo other than the song's) plays the buffer of the same midi and velocity step with the nearest dur, any turn
        // (ruling 11): the laps after the first replay the first one's buffers, another tempo the song's tempo's; prepare per start bar, lap
        // or tempo when such a play must sound as the web's.
        const std::vector<Key>& keys = buffers->keys;
        const Key want { e.midi, velStep, durStep, turn };
        auto found = std::lower_bound(keys.begin(), keys.end(), want);
        if (found != keys.end() && *found == want) ++exactFound;
        else {
            const auto from = std::lower_bound(keys.begin(), keys.end(), Key { e.midi, velStep, INT_MIN, INT_MIN });
            const auto to = std::upper_bound(from, keys.end(), Key { e.midi, velStep, INT_MAX, INT_MAX });
            if (from == to) { ++noneFound; return; }
            found = std::lower_bound(from, to, Key { e.midi, velStep, durStep, INT_MIN }); // the shortest dur from durStep on
            if (found == to || (found != from && durStep - std::prev(found)->dur < found->dur - durStep)) found = std::prev(found);
            ++(found->dur == durStep ? turnFound : durFound);
        }
        const std::vector<float>& data = buffers->data[static_cast<size_t>(found - keys.begin())];
        // 63 to 71: the chords strum the tones of one song time (e.t), in the events' order
        double later = 0.0;
        if (layer == Engine::chords) {
            state.strumRun = std::fabs(e.t - state.lastSong) < 0.001 ? state.strumRun + 1 : 0;
            state.lastSong = e.t;
            later = state.strumRun * tuned.strum;
        }
        // 72 to 77: the buffer at rate 1 into a gain of `level`, from the tone's time 0 (the strum's start) until its end
        SynthTone& tone = tones.startSynth(layer, delay + (lead + later) * tones.sr, state.serial, RELEASE);
        tone.hold = buffers;
        const int source = tone.buffer(data.data(), static_cast<int>(data.size()), 0, false, 0, static_cast<double>(data.size()));
        const int amp = tone.gain(static_cast<float>(tuned.level));
        tone.connect(source, amp);
        tone.output(amp);
    }

    std::shared_ptr<const Voice> prepare(const PlaySong& song, double sampleRate, const Voice* same) const override {
        auto made = std::make_shared<StringVoice>(*this);
        made->rate = sampleRate;
        const auto* before = dynamic_cast<const StringVoice*>(same);
        const auto equal = [](const StringParams& a, const StringParams& b) {
            return a.pluckPos == b.pluckPos && a.brightness == b.brightness && a.decay == b.decay && a.excite == b.excite && a.stiffness == b.stiffness
                && a.pickupPos == b.pickupPos && a.pickupLp == b.pickupLp && a.body == b.body;
        };
        if (before && before->buffers && before->rate == sampleRate && equal(before->params, params)) {
            made->buffers = before->buffers;
            return made;
        }
        // The notes of the layer as the web's voice meets them, in the stream's order (by time: the engine's order but for a glide, which it
        // triggers its lead early), with the turns and the seeds of a voice built afresh, as every play() of the web builds it: 46 to 56.
        // shortcut: the whole song's buffers in one call on the control thread (it blocks the caller: test_engine.cpp prints the time per
        // voice for the nine band tracks, "string prepare"); compute them on a thread of their own or step by step when that is too long.
        // shortcut: a setSound or setTuning that changes the params while playing computes the set by this walk from bar 0 with the start
        // rng, where the web's voice draws the new buffers' seeds from its rng as far as it has run (and keys the params by toFixed(4)): the
        // notes after the change get other attack-noise seeds than the web's; walk from the place of the play with the voice's running rng
        // when they must be the web's.
        std::vector<const PlayEvent*> notes;
        for (const PlayEvent& e : song.events) if (e.layer == layer && !e.hit) notes.push_back(&e);
        std::stable_sort(notes.begin(), notes.end(), [](const PlayEvent* x, const PlayEvent* y) { return x->t < y->t; });
        Rng rng = startRng;
        uint8_t turns[128][VEL_STEPS + 1] = {};
        std::map<Key, std::vector<float>> cache;
        for (const PlayEvent* e : notes) {
            const int durStep = durStepOf(e->dur), velStep = velStepOf(e->vel);
            uint8_t& turn = turns[e->midi & 127][velStep];
            const Key key { e->midi, velStep, durStep, turn };
            turn = static_cast<uint8_t>((turn + 1) % ROUND_ROBIN);
            if (cache.count(key)) continue;
            const double dur = durStep / 20.0;
            const auto seed = static_cast<uint32_t>(std::floor(rng.next() * 2147483648.0)); // 52: drawn on a miss only
            cache.emplace(key, renderString(e->midi, dur + 0.3, dur, static_cast<double>(velStep) / VEL_STEPS, sampleRate, seed, params));
        }
        auto set = std::make_shared<Buffers>();
        for (auto& [key, data] : cache) {
            set->keys.push_back(key);
            set->data.push_back(std::move(data));
        }
        made->buffers = std::move(set);
        return made;
    }

    std::shared_ptr<const void> held() const override { return buffers; }
};

} // namespace

std::shared_ptr<Voice> stringVoice(Engine::Layer layer, const std::string& key, const Tuning& tuning, const Timbre& timbre) {
    double p[8];
    for (int i = 0; i < 8; ++i) p[i] = tunedValue(key, PARAM_NAMES[i], tuning); // 26
    StringParams params { p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7] };
    if (layer == Engine::bass) { // 27 to 31
        const BassTimbre& t = timbre.bass;
        params.brightness = clamp(params.brightness + (t.cutoff - 0.5) * 0.8 - 0.3 * t.sub, 0, 1);
        params.decay *= std::pow(2.0, (0.5 - t.pluck) * 2);
        params.excite *= 1 - 0.6 * t.roundness;
        params.body = clamp(params.body + 0.5 * t.sub, 0, 1);
    } else { // 33, 34
        const ChordsTimbre& t = timbre.chords;
        params.brightness = clamp(params.brightness + (t.brightness - 0.5) * 0.8, 0, 1);
        params.decay *= std::pow(3.0, (t.length - 0.5) * 2);
    }
    auto voice = std::make_shared<StringVoice>();
    voice->params = params;
    return voice;
}

StringLookups stringLookups() { return { exactFound.load(), turnFound.load(), durFound.load(), noneFound.load() }; }

std::pair<int, size_t> stringBuffers(const Voice& voice) {
    const auto* v = dynamic_cast<const StringVoice*>(&voice);
    if (!v || !v->buffers) return { 0, 0 };
    size_t bytes = 0;
    for (const std::vector<float>& d : v->buffers->data) bytes += d.size() * sizeof(float);
    return { static_cast<int>(v->buffers->data.size()), bytes };
}

} // namespace btg::detail
