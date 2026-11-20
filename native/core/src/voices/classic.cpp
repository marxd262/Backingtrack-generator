// The classic synth on bass, chords, pad and lead: src/audio/voices/classic.js line by line (line numbers of that file), built with
// SynthTone's calls (patch.h), one function per layer. The web reads the live parameter objects of its instruments (synth.js 49 to 57) at
// every tone's start; the engine builds the voice again on every setSound, so reading them here, when the voice is built, is the same.
// Times are frames from the tone's time 0 (the web's t).
#include "../patch.h"

#include <algorithm>
#include <cmath>
#include <tuple>
#include <utility>

namespace btg::detail {
namespace {

const double LEAD_ATTACK = 0.015, LEAD_RELEASE = 0.12; // 77

double hz(int m) { return 440 * std::pow(2.0, (m - 69) / 12.0); } // nodes.js

// nodes.js 15 to 20
void adsr(Param& g, double a, double peak, double hold, double rel, double sr) {
    g.setValueAtTime(0.0001f, 0);
    g.linearRampToValueAtTime(static_cast<float>(peak), a * sr);
    g.setValueAtTime(static_cast<float>(peak), (a + hold) * sr);
    g.exponentialRampToValueAtTime(0.0001f, (a + hold + rel) * sr);
}

// nodes.js 22 to 31 and 33 to 38
int osc(SynthTone& tone, Wave type, double freq, double detune, int dest, double start, double end) {
    const int o = tone.osc(type, static_cast<float>(freq), static_cast<float>(detune), start, end);
    tone.connect(o, dest);
    return o;
}
int gain(SynthTone& tone, double value, int dest) {
    const int g = tone.gain(static_cast<float>(value));
    tone.connect(g, dest);
    return g;
}

// 7 to 27. A BiquadFilterNode's frequency is 350 Hz and its Q 1 before anything sets them, a GainNode's gain 1.
void bassNote(SynthTone& tone, const PlayEvent& e, double dur, double sr, const BassParams& p) {
    const double f = hz(e.midi), end = (dur + 0.1) * sr;
    const int lp = tone.biquad(Filter::lowpass, 350.0f, static_cast<float>(p.q));
    Param& cutoff = tone.param(lp);
    cutoff.setValueAtTime(static_cast<float>(p.lpStart), 0);
    cutoff.exponentialRampToValueAtTime(static_cast<float>(p.lpEnd), p.lpTime * sr);
    const double hold = std::max(p.holdMin, dur - p.holdCut);
    const int a = tone.gain(1.0f);
    adsr(tone.param(a), p.attack, e.vel * p.peak, hold, p.release, sr);
    if (p.sustain < 1) { // 13 to 18: the decay over the hold, without a node at sustain 1
        const int decay = tone.gain(1.0f);
        Param& d = tone.param(decay);
        d.setValueAtTime(1.0f, p.attack * sr);
        d.exponentialRampToValueAtTime(static_cast<float>(p.sustain), (p.attack + hold) * sr);
        tone.connect(a, decay);
        tone.output(decay);
    } else tone.output(a);
    for (const auto& [type, mix] : { std::pair { Wave::sawtooth, p.sawMix }, std::pair { Wave::triangle, p.triMix } }) {
        if (mix == 0) continue;
        const int bus = gain(tone, mix, lp);
        for (const double det : { -p.sawDetune, p.sawDetune }) osc(tone, type, f, det, bus, 0, end);
    }
    osc(tone, Wave::sine, f, 0, gain(tone, p.sineGain, a), 0, end);
    tone.connect(lp, a);
}

// 31 to 51
void chordNote(SynthTone& tone, const PlayEvent& e, double dur, double sr, const ChordParams& p) {
    const double f = hz(e.midi), hold = std::max(0.01, dur * 0.5 * p.holdScale);
    const double end = std::max(dur + 0.3, p.attack + hold + p.release + 0.05) * sr;
    const int lp = tone.biquad(Filter::lowpass, 350.0f, 1.0f);
    Param& cutoff = tone.param(lp);
    cutoff.setValueAtTime(static_cast<float>(p.lpStart), 0);
    cutoff.exponentialRampToValueAtTime(static_cast<float>(p.lpEnd), p.lpTime * sr);
    const int a = tone.gain(1.0f);
    adsr(tone.param(a), p.attack, e.vel * p.peak, hold, p.release, sr);
    osc(tone, Wave::sawtooth, f, 0, lp, 0, end);
    osc(tone, Wave::square, f, 7, lp, 0, end);
    if (p.chorusMix > 0) { // a detuned sawtooth panned left and one right, started 11 and 17 ms after the tone: lp and all behind it in two channels
        for (const int side : { -1, 1 }) {
            const int pan = tone.panner(static_cast<float>(0.6 * side));
            tone.connect(pan, lp);
            osc(tone, Wave::sawtooth, f, side * p.chorusDetune, gain(tone, p.chorusMix, pan), (side < 0 ? 0.011 : 0.017) * sr, end);
        }
    }
    tone.connect(lp, a);
    if (p.tremDepth > 0) { // the tremolo gain: tremBase plus the sine's swing at audio rate
        const int trem = tone.gain(static_cast<float>(p.tremBase)), swing = tone.gain(static_cast<float>(p.tremDepth / 2));
        osc(tone, Wave::sine, p.tremRate, 0, swing, 0, end);
        tone.modulate(swing, tone.param(trem));
        tone.connect(a, trem);
        tone.output(trem);
    } else tone.output(a);
}

// 54 to 72
void padNote(SynthTone& tone, const PlayEvent& e, double dur, double sr, const PadParams& p) {
    const double attack = std::min(p.attack, std::max(p.holdAttack, dur - p.holdCut - p.holdMin + p.holdAttack));
    const double f = hz(e.midi), hold = std::max(p.holdMin, dur - p.holdCut - std::max(0.0, attack - p.holdAttack));
    const double end = std::max(dur + 1, attack + hold + p.release + 0.1) * sr;
    const int lp = tone.biquad(Filter::lowpass, static_cast<float>(p.cutoff), static_cast<float>(p.q));
    const int depth = tone.gain(static_cast<float>(p.lfoDepth)); // 61: the LFO moves the cutoff for the whole tone
    tone.modulate(depth, tone.param(lp));
    osc(tone, Wave::sine, p.lfoSpeed, 0, depth, 0, end);
    const int a = tone.gain(1.0f);
    adsr(tone.param(a), attack, e.vel * p.peak, hold, p.release, sr);
    for (const double det : { -p.spread, 0.0, p.spread }) osc(tone, Wave::sawtooth, f, det, lp, 0, end);
    if (p.extraMix > 0) {
        const int bus = gain(tone, p.extraMix, lp);
        for (const double det : { -p.spread / 2, p.spread / 2 }) osc(tone, Wave::sawtooth, f, det, bus, 0, end);
    }
    if (p.shimmerMix > 0) { // the octaves (2f, 4f) past the lowpass
        for (const auto& [mult, level, det] : { std::tuple { 2.0, 0.8, -4.0 }, std::tuple { 2.0, 0.8, 4.0 }, std::tuple { 4.0, 0.4, 0.0 } })
            osc(tone, Wave::sine, f * mult, det, gain(tone, p.shimmerMix * level, a), 0, end);
    }
    tone.connect(lp, a);
    tone.output(a);
}

// 76 to 85: fixed values
void leadNote(SynthTone& tone, const PlayEvent& e, double dur, double sr) {
    const double f = hz(e.midi), attack = LEAD_ATTACK, release = LEAD_RELEASE, hold = std::max(0.02, dur - 0.03);
    const double end = (attack + hold + release + 0.05) * sr;
    const int lp = tone.biquad(Filter::lowpass, 350.0f, 2.0f);
    Param& cutoff = tone.param(lp);
    cutoff.setValueAtTime(3200.0f, 0);
    cutoff.exponentialRampToValueAtTime(1600.0f, (attack + hold) * sr);
    const int a = tone.gain(1.0f);
    adsr(tone.param(a), attack, e.vel * 0.5, hold, release, sr);
    osc(tone, Wave::sawtooth, f, 0, gain(tone, 0.6, lp), 0, end);
    osc(tone, Wave::triangle, f, 9, gain(tone, 0.6, lp), 0, end);
    tone.connect(lp, a);
    tone.output(a);
}

class Classic final : public Voice {
public:
    BassParams bass {};   // bassParams, chordParams, padParams of the timbre (voice-params.js); the lead has none
    ChordParams chords {};
    PadParams pad {};

    bool stereo() const override { return layer == Engine::chords && chords.chorusMix > 0; } // 41: the panners
    void play(const PlayEvent& e, int delay, double secondsPerBeat, VoiceState& state, Tones& tones) const override {
        if (e.hit) return; // 92: notes only
        // the web plays at the note's time: the engine triggers a glide (slideIn, scoop; only the sampler glides) its lead earlier
        const double lead = e.leadBeats * secondsPerBeat, dur = e.durBeats * secondsPerBeat - lead, sr = tones.sr;
        const double release = layer == Engine::bass ? bass.release : layer == Engine::chords ? chords.release : layer == Engine::pad ? pad.release : LEAD_RELEASE;
        SynthTone& tone = tones.startSynth(layer, delay + static_cast<int>(lead * sr), state.serial, release);
        if (layer == Engine::bass) bassNote(tone, e, dur, sr, bass);
        else if (layer == Engine::chords) chordNote(tone, e, dur, sr, chords);
        else if (layer == Engine::pad) padNote(tone, e, dur, sr, pad);
        else leadNote(tone, e, dur, sr);
    }
};

} // namespace

std::shared_ptr<Voice> classicVoice(const Timbre& timbre) {
    auto voice = std::make_shared<Classic>();
    voice->bass = bassParams(timbre.bass);
    voice->chords = chordParams(timbre.chords);
    voice->pad = padParams(timbre.pad);
    return voice;
}

} // namespace btg::detail
