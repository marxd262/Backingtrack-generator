// The synth percussion: src/audio/voices/percussion.js line by line (line numbers of that file), each hit one SynthTone built with its calls
// (patch.h) and the helpers of nodes.js (nodes.h); the SynthTone is `hit` here, as `tone` is the name of a function of the file. A hit of two
// branches sums them in a gain (a tone has one output). The oscillator whose frequency `tone` moves keeps the node's 440 Hz before its
// first event (percussion.js sets no .value; patch.h). No fine values, no place in the kit. Times are frames from the hit's time 0 (the web's t).
#include "nodes.h"

#include <initializer_list>
#include <iterator>
#include <string_view>

namespace btg::detail {
namespace {

struct Band { Filter type; double freq, q; }; // a BiquadFilterNode's type, frequency and Q

// 11 to 16: noise through a filter, attack a, peak, decay; returns its gain
int burst(SynthTone& hit, const Tones& tones, Band filter, double a, double peak, double decay) {
    const double sr = tones.sr;
    const int n = hit.buffer(tones.noise.data(), static_cast<int>(tones.noise.size()), 0, false, 0, (a + decay + 0.02) * sr);
    const int f = hit.biquad(filter.type, static_cast<float>(filter.freq), static_cast<float>(filter.q)), g = hit.gain(1.0f);
    adsr(hit.param(g), a, peak, 0, decay, sr);
    hit.connect(n, f);
    hit.connect(f, g);
    return g;
}

// 18 to 23: a decaying tone whose pitch falls from drop times freq to freq in fall; returns its gain
int tone(SynthTone& hit, Wave type, double freq, double drop, double fall, double peak, double decay, double sr) {
    const int o = hit.osc(type, 440.0f, 0.0f, 0, (decay + 0.02) * sr), g = hit.gain(1.0f);
    Param& f = hit.param(o);
    f.setValueAtTime(static_cast<float>(freq * drop), 0);
    f.exponentialRampToValueAtTime(static_cast<float>(freq), fall * sr);
    adsr(hit.param(g), 0.001, peak, 0, decay, sr);
    hit.connect(o, g);
    return g;
}

// the two branches of a hit into one gain, its output
void both(SynthTone& hit, int first, int second) {
    const int sum = hit.gain(1.0f);
    hit.connect(first, sum);
    hit.connect(second, sum);
    hit.output(sum);
}

// 25 to 28: a conga or bongo, the body and a short noise click
void drum(SynthTone& hit, double freq, Wave type, double decay, double v, const Tones& tones) {
    const int body = tone(hit, type, freq, 1.15, 0.03, v * 0.9, decay, tones.sr);
    const int click = burst(hit, tones, { Filter::bandpass, 1800, 0.8 }, 0.001, v * 0.35, 0.012);
    both(hit, body, click);
}

// 30 to 39: partials at once, decaying together, through the filter where there is one; returns their gain
int partials(SynthTone& hit, Wave type, std::initializer_list<double> freqs, double peak, double decay, const Band* filter, double sr) {
    const int g = hit.gain(1.0f);
    adsr(hit.param(g), 0.001, peak, 0, decay, sr);
    int dest = g;
    if (filter) {
        dest = hit.biquad(filter->type, static_cast<float>(filter->freq), static_cast<float>(filter->q));
        hit.connect(dest, g);
    }
    for (const double freq : freqs) osc(hit, type, freq, 0, dest, 0, (decay + 0.02) * sr);
    return g;
}

class Percussion final : public Voice {
public:
    void play(const PlayEvent& e, int delay, double, VoiceState& state, Tones& tones) const override {
        if (!e.hit || e.name < 0 || e.name >= static_cast<int>(std::size(HIT_NAMES))) return; // 58: hits of the eight names only
        const std::string_view name = HIT_NAMES[e.name];
        const double v = e.vel, sr = tones.sr;
        const auto start = [&]() -> SynthTone& { return tones.startSynth(layer, delay, state.serial, 0.0); }; // a hit rings out over a jump
        // 41 to 55
        if (name == "shaker") {
            SynthTone& hit = start();
            hit.output(burst(hit, tones, { Filter::bandpass, 7000, 0.7 }, 0.012, v * 0.8, 0.07));
        } else if (name == "tambourine") { // and the jingles: three detuned squares, filtered above
            const Band jingles { Filter::highpass, 4500, 0.7 };
            SynthTone& hit = start();
            const int shake = burst(hit, tones, { Filter::highpass, 6000, 1 }, 0.002, v * 0.6, 0.13);
            const int ring = partials(hit, Wave::square, { 5200, 6900, 8300 }, v * 0.06, 0.15, &jingles, sr);
            both(hit, shake, ring);
        } else if (name == "congaHigh") drum(start(), 330, Wave::sine, 0.28, v, tones);
        else if (name == "congaLow") drum(start(), 220, Wave::sine, 0.34, v, tones);
        else if (name == "bongoHigh") drum(start(), 450, Wave::triangle, 0.18, v, tones);
        else if (name == "bongoLow") drum(start(), 320, Wave::triangle, 0.22, v, tones);
        else if (name == "cowbell") { // two detuned squares through a bandpass
            const Band bell { Filter::bandpass, 670, 1.2 };
            SynthTone& hit = start();
            hit.output(partials(hit, Wave::square, { 540, 800 }, v * 0.5, 0.3, &bell, sr));
        } else if (name == "claves") {
            SynthTone& hit = start();
            hit.output(partials(hit, Wave::sine, { 2500, 2650 }, v * 0.8, 0.07, nullptr, sr));
        }
    }
};

} // namespace

std::shared_ptr<Voice> percussionVoice() { return std::make_shared<Percussion>(); }

} // namespace btg::detail
