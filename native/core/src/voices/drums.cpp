// The synth kit: src/audio/voices/drums.js line by line (line numbers of that file), each hit one SynthTone built with its calls (patch.h) and
// the helpers of nodes.js (nodes.h). The web reads drumParams (the live parameter object, synth.js 53) and the fine values at every hit; the
// engine builds the voice again on every setSound and setTuning, so reading them here, when the voice is built, is the same. A hit of
// several branches sums them in a gain (a tone has one output). The oscillators whose frequency the hit moves keep the node's 440 Hz before
// its first event (drums.js sets no .value; patch.h). Times are frames from the hit's time 0 (the web's t).
#include "nodes.h"

#include <algorithm>
#include <array>
#include <iterator>
#include <tuple>

namespace btg::detail {
namespace {

enum class Sound : uint8_t { none, kick, snare, hat, openHat, tomHigh, tomMid, tomLow, crash }; // the names of kit (55, 56)

// 9 to 20
void kick(SynthTone& tone, double v, const DrumParams& p, const Tones& tones) {
    const double sr = tones.sr;
    const int o = tone.osc(Wave::sine, 440.0f, 0.0f, 0, (p.kickDecay + 0.05) * sr), a = tone.gain(1.0f);
    Param& f = tone.param(o);
    f.setValueAtTime(static_cast<float>(p.kickStart), 0);
    f.exponentialRampToValueAtTime(static_cast<float>(p.kickEnd), p.kickDrop * sr);
    Param& g = tone.param(a);
    g.setValueAtTime(static_cast<float>(v * p.kickPeak), 0);
    g.exponentialRampToValueAtTime(0.001f, p.kickDecay * sr);
    tone.connect(o, a);
    if (!(p.kickClick > 0)) { tone.output(a); return; }
    const int n = tone.buffer(tones.noise.data(), static_cast<int>(tones.noise.size()), 0, false, 0, 0.05 * sr); // the click
    const int lp = tone.biquad(Filter::lowpass, 3500.0f, 1.0f), c = tone.gain(1.0f), sum = tone.gain(1.0f);
    adsr(tone.param(c), 0.001, v * p.kickClick, 0, 0.012, sr);
    tone.connect(n, lp);
    tone.connect(lp, c);
    tone.connect(a, sum);
    tone.connect(c, sum);
    tone.output(sum);
}

// 21 to 34
void snare(SynthTone& tone, double v, const DrumParams& p, const Tones& tones) {
    const double sr = tones.sr;
    const float* noise = tones.noise.data();
    const int frames = static_cast<int>(tones.noise.size()), sum = tone.gain(1.0f);
    const int n = tone.buffer(noise, frames, 0, false, 0, (p.snareDecay + 0.09) * sr);
    const int bp = tone.biquad(Filter::bandpass, static_cast<float>(p.snareFreq), static_cast<float>(p.snareQ)), a = gain(tone, 1, sum);
    adsr(tone.param(a), 0.001, v * p.snareNoise, 0.02, p.snareDecay, sr);
    tone.connect(n, bp);
    tone.connect(bp, a);
    if (p.snareClick > 0) { // the bright click
        const int c = tone.buffer(noise, frames, 0, false, 0, 0.05 * sr);
        const int hp = tone.biquad(Filter::highpass, 5000.0f, 1.0f), g = gain(tone, 1, sum);
        adsr(tone.param(g), 0.001, v * p.snareClick, 0, 0.025, sr);
        tone.connect(c, hp);
        tone.connect(hp, g);
    }
    const int b = gain(tone, 1, sum);
    adsr(tone.param(b), 0.001, v * p.snareTone, 0.01, 0.1, sr);
    osc(tone, Wave::triangle, 185, 0, b, 0, 0.15 * sr);
    tone.output(sum);
}

// 35 to 41
void hat(SynthTone& tone, bool open, double v, const DrumParams& p, const Tones& tones) {
    const double sr = tones.sr, hold = open ? 0.06 : 0.01, decay = open ? p.hatOpenDecay : p.hatClosedDecay;
    const int n = tone.buffer(tones.noise.data(), static_cast<int>(tones.noise.size()), 0, false, 0, std::max(0.35, hold + decay + 0.05) * sr);
    const int hp = tone.biquad(Filter::highpass, static_cast<float>(p.hatFreq), 1.0f), a = tone.gain(1.0f);
    adsr(tone.param(a), 0.001, v * p.hatPeak, hold, decay, sr);
    tone.connect(n, hp);
    tone.connect(hp, a);
    tone.output(a);
}

// 42 to 47
void tom(SynthTone& tone, double f, double v, double sr) {
    const int o = tone.osc(Wave::sine, 440.0f, 0.0f, 0, 0.42 * sr), a = tone.gain(1.0f);
    Param& freq = tone.param(o);
    freq.setValueAtTime(static_cast<float>(f * 1.35), 0);
    freq.exponentialRampToValueAtTime(static_cast<float>(f), 0.14 * sr);
    Param& g = tone.param(a);
    g.setValueAtTime(static_cast<float>(v * 0.7), 0);
    g.exponentialRampToValueAtTime(0.001f, 0.38 * sr);
    tone.connect(o, a);
    tone.output(a);
}

// 49 to 54: the noise looped (the buffer is 1 s long)
void crash(SynthTone& tone, double v, const Tones& tones) {
    const double sr = tones.sr;
    const int n = tone.buffer(tones.noise.data(), static_cast<int>(tones.noise.size()), 0, true, 0, 1.7 * sr);
    const int hp = tone.biquad(Filter::highpass, 3000.0f, 1.0f), a = tone.gain(1.0f);
    adsr(tone.param(a), 0.002, v * 0.3, 0.05, 1.5, sr);
    tone.connect(n, hp);
    tone.connect(hp, a);
    tone.output(a);
}

class Drums final : public Voice {
public:
    struct Hit { Sound sound = Sound::none; double vel = 1; float panLeft = 1, panRight = 1; }; // what a name plays, its velocity's factor, its place
    std::array<Hit, std::size(HIT_NAMES)> hits {};
    DrumParams p {};

    void play(const PlayEvent& e, int delay, double, VoiceState& state, Tones& tones) const override {
        if (!e.hit || e.name < 0 || e.name >= static_cast<int>(hits.size())) return; // 60: hits only
        const Hit& h = hits[static_cast<size_t>(e.name)];
        if (h.sound == Sound::none) return;
        // a hit rings out over a jump (engine.cpp), so the release time is never used
        SynthTone& tone = tones.startSynth(layer, delay, state.serial, 0.0);
        tone.panLeft = h.panLeft;
        tone.panRight = h.panRight;
        const double v = e.vel * h.vel;
        switch (h.sound) {
            case Sound::kick: kick(tone, v, p, tones); break;
            case Sound::snare: snare(tone, v, p, tones); break;
            case Sound::hat: hat(tone, false, v, p, tones); break;
            case Sound::openHat: hat(tone, true, v, p, tones); break;
            case Sound::tomHigh: tom(tone, 200, v, tones.sr); break; // TOMS (6)
            case Sound::tomMid: tom(tone, 150, v, tones.sr); break;
            case Sound::tomLow: tom(tone, 110, v, tones.sr); break;
            case Sound::crash: crash(tone, v, tones); break;
            case Sound::none: break;
        }
    }
};

} // namespace

std::shared_ptr<Voice> drumsVoice(const Tuning& tuning, const Timbre& timbre, double kit) {
    const auto tuned = [&](const char* name) { return tunedValue("drums/synth/classic", name, tuning); };
    static const std::map<std::string, Sound> KIT { { "kick", Sound::kick }, { "snare", Sound::snare }, { "hat", Sound::hat }, { "openHat", Sound::openHat },
                                                    { "crash", Sound::crash }, { "tomHigh", Sound::tomHigh }, { "tomMid", Sound::tomMid }, { "tomLow", Sound::tomLow } };
    auto voice = std::make_shared<Drums>();
    voice->p = drumParams(timbre.drums);
    for (size_t i = 0; i < voice->hits.size(); ++i) {
        const std::string name = HIT_NAMES[i];
        Drums::Hit& h = voice->hits[i];
        // 60 to 62: the half-open hat plays the closed one, the other names their DRUM_FALLBACK; the side stick quieter by its fine value, the
        // pedalled hat silent while its fine value is below 1
        const auto fallback = DRUM_FALLBACK.find(name);
        auto sound = KIT.find(name);
        if (sound == KIT.end()) sound = KIT.find(name == "hatHalf" ? "hat" : fallback != DRUM_FALLBACK.end() ? fallback->second : "");
        h.sound = sound != KIT.end() && !(name == "hatPedal" && tuned("hatPedal") < 1) ? sound->second : Sound::none;
        if (name == "sideStick") h.vel = tuned("sideStick");
        std::tie(h.panLeft, h.panRight) = kitBalance(name, kit); // synth.js 198
    }
    return voice;
}

} // namespace btg::detail
