// The FM e-piano: src/audio/voices/epiano.js line by line (line numbers of that file), built with SynthTone's calls (patch.h). The web
// reads its values at every tone's start; the engine builds the voice again on every setSound and setTuning, so reading them here, when
// the voice is built, is the same. Times are frames from the tone's time 0 (the web's t).
#include "nodes.h"

#include <algorithm>
#include <cmath>

namespace btg::detail {
namespace {

const double REL = 0.18; // the fade after the note's end (s)

class Epiano final : public Voice {
public:
    struct { double ratio, index, indexDecay, bell, bellRatio, decay, level; } fine {}; // tuned(name), tunables.js
    ChordsTimbre timbre;                                                                // getTimbre()
    ChordParams params {};                                                              // chordParams (voice-params.js)

    void play(const PlayEvent& e, int delay, double secondsPerBeat, VoiceState& state, Tones& tones) const override {
        if (e.hit) return; // 11
        // the web plays at the note's time: the engine triggers a glide (slideIn, scoop; only the sampler glides) its lead earlier
        const double lead = e.leadBeats * secondsPerBeat;
        const double f = hz(e.midi);
        const double dur = std::max(0.05, e.durBeats * secondsPerBeat - lead);
        const double bright = std::pow(2.0, (timbre.brightness - 0.5) * 2);
        const double stretch = std::pow(3.0, (timbre.length - 0.5) * 2);
        const double decay = fine.decay * stretch;
        const double vel = std::min(1.0, std::max(0.0, e.vel));
        const double index = fine.index * bright * (0.4 + 0.9 * vel);
        const double sr = tones.sr, end = (dur + REL + 0.05) * sr;
        SynthTone& tone = tones.startSynth(layer, delay + lead * sr, state.serial, REL);

        // 23 to 28: a short attack, an exponential decay over the note's length, then the fade
        const int amp = tone.gain(1.0f);
        const double peak = e.vel * params.peak * fine.level;
        Param& level = tone.param(amp);
        level.setValueAtTime(0.0001f, 0);
        level.linearRampToValueAtTime(static_cast<float>(peak), 0.003 * sr);
        level.exponentialRampToValueAtTime(static_cast<float>(std::max(0.0001, peak * std::exp(-dur / decay))), dur * sr);
        level.exponentialRampToValueAtTime(0.0001f, (dur + REL) * sr);

        // 31 to 40: the carrier, frequency-modulated; the modulation's depth (in Hz) falls to a third over indexDecay
        const int carrier = tone.osc(Wave::sine, static_cast<float>(f), 0.0f, 0, end);
        const int depth = tone.gain(1.0f);
        tone.connect(tone.osc(Wave::sine, static_cast<float>(f * fine.ratio), 0.0f, 0, end), depth);
        tone.modulate(depth, tone.param(carrier));
        Param& depthGain = tone.param(depth);
        depthGain.setValueAtTime(static_cast<float>(index * f), 0);
        depthGain.exponentialRampToValueAtTime(static_cast<float>(std::max(1e-3, index * f / 3)), fine.indexDecay * sr);

        // 43 to 46: the bell, a sine at a high multiple, falling fast
        const int bellGain = tone.gain(0.0f);
        tone.connect(bellGain, amp);
        Param& bell = tone.param(bellGain);
        bell.setValueAtTime(static_cast<float>(fine.bell * (0.3 + 0.7 * vel)), 0);
        bell.exponentialRampToValueAtTime(0.0001f, 0.12 * sr);
        tone.connect(tone.osc(Wave::sine, static_cast<float>(std::min(f * fine.bellRatio, sr * 0.45)), 0.0f, 0, 0.15 * sr), bellGain);

        tone.connect(carrier, amp);
        // 50 to 54: the tremolo of the classic chords, only when the sound asks for it
        if (params.tremDepth > 0) {
            const int trem = tone.gain(static_cast<float>(params.tremBase)), swing = tone.gain(static_cast<float>(params.tremDepth / 2));
            tone.connect(tone.osc(Wave::sine, static_cast<float>(params.tremRate), 0.0f, 0, end), swing);
            tone.modulate(swing, tone.param(trem));
            tone.connect(amp, trem);
            tone.output(trem);
        } else tone.output(amp);
    }
};

} // namespace

std::shared_ptr<Voice> epianoVoice(const Tuning& tuning, const Timbre& timbre) {
    const auto tuned = [&](const char* name) { return tunedValue("chords/epiano/rhodes", name, tuning); };
    auto voice = std::make_shared<Epiano>();
    voice->fine = { tuned("ratio"), tuned("index"), tuned("indexDecay"), tuned("bell"), tuned("bellRatio"), tuned("decay"), tuned("level") };
    voice->timbre = timbre.chords;
    voice->params = chordParams(timbre.chords);
    return voice;
}

} // namespace btg::detail
