// The tonewheel organ: src/audio/voices/organ.js line by line (line numbers of that file), its tones built with SynthTone's calls (patch.h)
// into the three entries of the chain its voice instance holds (organ_chain.h). The web reads its fine values at every tone through
// tunedValue; the engine builds the voice again on every setTuning and setSound with the same serial (its voice instance and chain go on),
// so reading them here, when the voice is built, is the same. Here too, on the control thread, the waves of every key at the engine's rate.
// Times are frames from the tone's time 0 (the web's t), or frames of the chain's clock where the chain is set.
// The chain's frame of a tone (play) follows Chromium 158.0.8127.18, modules/webaudio/oscillator_handler.cc 739 to 746 (an oscillator's
// start rounded up) and audio_param_handler.cc 1404 to 1421 and 1516 to 1540 (an event's time rounded up); their notices (Copyright 2022
// The Chromium Authors, BSD-style, with the text of Chromium's LICENSE) stand in organ_chain.cpp's head.
#include "../sound_data.h"
#include "nodes.h"

#include <algorithm>
#include <cmath>
#include <map>
#include <numbers>
#include <string>
#include <vector>

namespace btg::detail {
namespace {

const int HARMONIC[9] = { 1, 3, 2, 4, 6, 8, 10, 12, 16 }; // the partial over the sub-octave of each drawbar (16' ... 1')
const int SEMIS[9] = { -12, 7, 0, 12, 19, 24, 28, 31, 36 };  // the drawbar's wheel in semitones over the key
const int WHEEL_LO = 36, WHEEL_HI = 114;                     // the wheels the manuals use
const int GEARS[12][2] = { { 85, 104 }, { 71, 82 }, { 67, 73 }, { 105, 108 }, { 103, 100 }, { 84, 77 }, { 74, 64 }, { 98, 80 }, { 96, 74 }, { 88, 64 }, { 67, 46 }, { 108, 70 } };
const double NOTE = 0.2, ATTACK = 0.004, RELEASE = 0.012, CLICK_TC = 0.002, HELD_EPS = 0.005, TAIL = 10, GLIDE = 1;
const double DRIVE_MAX = 6, DRIVE_REF = 0.4, RANGE = 4, PHASE = 2.399963;
const char* const DRAWBARS[9] = { "d16", "d513", "d8", "d4", "d223", "d2", "d135", "d113", "d1" }; // tunables.js

// 23: how far the wheels of a pitch class miss equal temperament (cents)
double wheelCents(int pitchClass) { return 1200 * std::log2((40.0 * GEARS[pitchClass][0]) / GEARS[pitchClass][1] / hz(24 + pitchClass)); }

// 43 to 55: the weights of the 17 partials over the sub-octave for key `midi`, as the web's Float32Array holds them (each sum rounded to
// float; a partial past the 17th lost, as a typed array loses it), over their rms by Math.hypot as V8 computes it (over the largest, Kahan's sum)
std::array<float, 17> tonewheelPartials(int midi, const double* bars) {
    std::array<float, 17> out {};
    for (int i = 0; i < 9; ++i) {
        if (!(bars[i] > 0)) continue;
        int wheel = midi + SEMIS[i];
        while (wheel < WHEEL_LO) wheel += 12; // fold-back: a wheel outside the generator plays an octave up or down
        while (wheel > WHEEL_HI) wheel -= 12;
        const double h = HARMONIC[i] * std::pow(2.0, (wheel - midi - SEMIS[i]) / 12.0);
        if (h == std::floor(h) && h < 17) out[static_cast<size_t>(h)] = static_cast<float>(out[static_cast<size_t>(h)] + std::pow(10.0, (-3 * (8 - bars[i])) / 20));
    }
    double largest = 0.0, sum = 0.0, compensation = 0.0;
    for (const float a : out) largest = std::max(largest, std::fabs(static_cast<double>(a)));
    for (const float a : out) {
        if (largest == 0.0) break;
        const double x = std::fabs(static_cast<double>(a)) / largest, summand = x * x - compensation, preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    const double norm = largest > 0.0 ? std::sqrt(sum) * largest : 1.0;
    for (float& a : out) a = static_cast<float>(a / norm);
    return out;
}

// 73: the PeriodicWave's coefficients of key `midi`, real then imaginary, the partials' phases h PHASE (as Float32Arrays)
std::vector<float> coefficients(int midi, const double* bars) {
    const std::array<float, 17> a = tonewheelPartials(midi, bars);
    std::vector<float> c(34);
    for (size_t h = 0; h < 17; ++h) {
        c[h] = static_cast<float>(static_cast<double>(a[h]) * std::cos(static_cast<double>(h) * PHASE));
        c[17 + h] = static_cast<float>(static_cast<double>(a[h]) * std::sin(static_cast<double>(h) * PHASE));
    }
    return c;
}

class Organ final : public Voice {
public:
    struct { double level, click, clickOff, perc, percHarm, percDecay, drive, swell; } fine {}; // tuned(name), tunables.js
    LeslieValues leslie {};
    double bars[9] = {};                  // the drawbars (tunables.js DRAWBARS)
    double rate = 0.0;                    // the rate of the waves (0: none: silent)
    const WaveTables* waves[128] = {};    // per key its PeriodicWave (waveFor), in rawWave's cache
    const WaveTables* lfo[2][2] = {};     // per rotor and mic the Leslie's LFO wave

    bool stereo() const override { return true; } // the Leslie's merger feeds the layer two channels, also with the Leslie off

    void play(const PlayEvent& e, int delay, double secondsPerBeat, VoiceState& state, Tones& tones) const override {
        if (e.hit || tones.sr != rate || tones.noise.empty()) return; // 97: notes only; the waves are for the engine's rate
        // the web plays at the note's time: the engine triggers a glide (slideIn, scoop; only the sampler glides) its lead earlier
        const double lead = e.leadBeats * secondsPerBeat, sr = tones.sr, time = delay + lead * sr; // its tones' time 0 (Tones::startSynth)
        // the chain's frame of the tone: the frame at or after its time (Tones::late), where Chromium's AudioParams take its events (ceil)
        // and its LFOs start (oscillator_handler.cc 739 to 746, as SynthTone::osc)
        delay = static_cast<int>(std::ceil(time + tones.late));
        // 98: the voice instance's chain, built at its first tone, and anew for a tone after its dead
        OrganChain* chain = state.chain >= 0 ? &tones.chains[static_cast<size_t>(state.chain)] : nullptr;
        if (!chain || static_cast<double>(chain->age + delay) > chain->dead) {
            if (!chain) state.chain = tones.takeChain();
            if (state.chain < 0) return;
            chain = &tones.chains[static_cast<size_t>(state.chain)];
            chain->start(layer, tones.gen[layer], ++tones.serial, delay, tones.quantum, lfo);
        }
        const long long t = chain->age + delay; // the tone's frame on the chain's clock
        chain->level.set(fine.level, t);       // 99
        const double end = std::max(0.03, e.durBeats * secondsPerBeat - lead) * sr; // 100
        chain->dead = std::max(chain->dead, static_cast<double>(t) + end + TAIL * sr); // 101 (102: the LFOs' stop is the chain's)
        chain->tune(leslie, t);                // 103, 104
        chain->speed(leslie.leslie == 3 || (leslie.leslie == 1 && e.leslie == 1), leslie, t);
        // 105 to 108: the swell pedal; it glides to a new value over the art's time or the note (at most GLIDE)
        const double pedal = std::pow(10.0, fine.swell * (std::isnan(e.swell) ? 0.0 : e.swell) / 20);
        if (std::isnan(chain->pedal)) chain->swell.setValueAtTime(static_cast<float>(pedal), t);
        else if (pedal != chain->pedal)
            chain->swell.setTargetAtTime(static_cast<float>(pedal), t, (e.art == Art::swell && e.artTime > 0 ? e.artTime : std::min(end / sr, GLIDE)) / 3, sr);
        chain->pedal = pedal;
        // 109 to 112: the preamp
        const double gain = DRIVE_MAX * fine.drive;
        chain->clean.set(gain > 0 ? 0 : 1, t);
        chain->driveIn.set(gain / RANGE, t);
        chain->driveOut.set(gain > 0 ? DRIVE_REF / std::tanh(gain * DRIVE_REF) : 0, t);

        const int midi = std::clamp(e.midi, 0, 127), bus = state.chain * 3;
        const float cents = static_cast<float>(wheelCents(((e.midi % 12) + 12) % 12));
        const double f = hz(e.midi), stop = end + (RELEASE + 0.01) * sr;
        // 115 to 126: an oscillator through a short ramp at the key, into an entry of the chain
        const auto key = [&](SynthTone& tone, int o, double peak, int entry) {
            const int amp = tone.gain(1.0f);
            Param& g = tone.param(amp);
            g.setValueAtTime(0.0f, 0);
            g.linearRampToValueAtTime(static_cast<float>(peak), ATTACK * sr);
            g.setValueAtTime(static_cast<float>(peak), end);
            g.linearRampToValueAtTime(0.0f, end + RELEASE * sr);
            tone.connect(o, amp);
            tone.output(amp);
            tone.bus = bus + entry;
        };
        // 127 to 129: the wheels, one oscillator on the sub-octave with the key's wave
        SynthTone& wheels = tones.startSynth(layer, time, state.serial, RELEASE);
        key(wheels, wheels.osc(*waves[midi], static_cast<float>(f / 2), cents, 0, stop), NOTE, OrganChain::wheels);

        // 131 to 140: the key click, a burst of the noise at the key's start and, softer, at its end, each with its level and its place in
        // the noise from the voice's rng (level, then place; the start's, then the end's)
        const double at[2] = { 0.0, end }, amount[2] = { fine.click, fine.click * fine.clickOff };
        SynthTone* clicks = nullptr;
        int first = -1, sum = -1;
        for (int k = 0; k < 2; ++k) {
            if (!(amount[k] > 0)) continue;
            const double level = amount[k] * (0.7 + 0.6 * state.rng.next()), offset = 0.9 * state.rng.next();
            if (!clicks) {
                clicks = &tones.startSynth(layer, time, state.serial, RELEASE);
                clicks->bus = bus + OrganChain::clicks;
            }
            // start(at, offset, 0.03): the grain plays ceil(0.03 s) of frames from the offset
            const int source = clicks->buffer(tones.noise.data(), static_cast<int>(tones.noise.size()), offset * sr, false, at[k], at[k] + std::ceil(0.03 * sr));
            const int g = clicks->gain(1.0f);
            Param& p = clicks->param(g);
            p.setValueAtTime(static_cast<float>(level), at[k]);
            p.setTargetAtTime(0.0f, at[k], CLICK_TC * sr);
            clicks->connect(source, g);
            if (first < 0) first = g;
            else {
                sum = clicks->gain(1.0f);
                clicks->connect(first, sum);
                clicks->connect(g, sum);
            }
        }
        if (clicks) clicks->output(sum >= 0 ? sum : first);

        // 142 to 149: the percussion, a sine on the 2nd or 3rd partial of the 8' through the chain's one envelope, which only a key struck
        // while no other is held triggers (percussionGate)
        if (fine.perc > 0) {
            if (static_cast<double>(t) >= chain->held - HELD_EPS * sr) {
                chain->percEnv.setValueAtTime(1.0f, t);
                chain->percEnv.setTargetAtTime(0.0f, t, fine.percDecay / std::numbers::ln10, sr); // percDecay: the time to -20 dB
            }
            chain->held = std::max(chain->held, static_cast<double>(t) + end);
            SynthTone& perc = tones.startSynth(layer, time, state.serial, RELEASE);
            key(perc, perc.osc(Wave::sine, static_cast<float>(f * fine.percHarm), cents, 0, stop), NOTE * fine.perc, OrganChain::percussion);
        } else chain->held = std::max(chain->held, static_cast<double>(t) + end);
    }
};

} // namespace

std::shared_ptr<Voice> organVoice(const std::string& key, const Tuning& tuning, double sampleRate) {
    const auto tuned = [&](const std::string& name) { return tunedValue(key, name, tuning); };
    auto voice = std::make_shared<Organ>();
    voice->fine = { tuned("level"), tuned("click"), tuned("clickOff"), tuned("perc"), tuned("percHarm"), tuned("percDecay"), tuned("drive"), tuned("swell") };
    LeslieValues& l = voice->leslie;
    l.leslie = tuned("leslie");
    l.crossover = tuned("crossover");
    for (int r = 0; r < 2; ++r) {
        const std::string rotor = r == 0 ? "horn" : "drum";
        l.slow[r] = tuned(rotor + "Slow");
        l.fast[r] = tuned(rotor + "Fast");
        l.up[r] = tuned(rotor + "Up");
        l.down[r] = tuned(rotor + "Down");
        l.am[r] = tuned(rotor + "Am");
        l.doppler[r] = tuned(rotor + "Doppler");
    }
    voice->rate = sampleRate;
    if (!(sampleRate > 0)) return voice;
    // 68 to 77: a PeriodicWave per key and drawbar setting, without normalisation; built here for every key, never at a tone. Keys of the
    // same partials (those between two fold-backs) share one, and rawWave builds only the ranges their tones read.
    for (int i = 0; i < 9; ++i) voice->bars[i] = tuned(DRAWBARS[i]);
    std::map<std::vector<float>, std::vector<int>> keysOf; // the coefficients and the keys that have them
    for (int midi = 0; midi < 128; ++midi) keysOf[coefficients(midi, voice->bars)].push_back(midi);
    for (const auto& [c, keys] : keysOf) {
        std::vector<float> frequencies, cents;
        for (const int midi : keys) {
            frequencies.push_back(static_cast<float>(hz(midi) / 2));
            cents.push_back(static_cast<float>(wheelCents(midi % 12)));
        }
        const WaveTables& w = rawWave(c.data(), c.data() + 17, 17, sampleRate, frequencies.data(), cents.data(), static_cast<int>(keys.size()));
        for (const int midi : keys) voice->waves[midi] = &w;
    }
    // organ-leslie.js 29 to 32: each mic's LFO, cos(wt - phase) with phase = direction (channel - 0.5) micAngle (the horn turns one way,
    // the drum the other), at the rotor's speeds and between them, and at 440 Hz, the default its first render quantum begins with
    const double micAngle = tuned("micAngle");
    const float frequencies[5] = { 440.0f, static_cast<float>(l.slow[0]), static_cast<float>(l.fast[0]), static_cast<float>(l.slow[1]), static_cast<float>(l.fast[1]) };
    const float cents[5] = {};
    for (int r = 0; r < 2; ++r)
        for (int m = 0; m < 2; ++m) {
            const double direction = r == 0 ? 1 : -1, phase = (direction * (m - 0.5) * micAngle * std::numbers::pi) / 180;
            const float real[2] = { 0.0f, static_cast<float>(std::cos(phase)) }, imag[2] = { 0.0f, static_cast<float>(std::sin(phase)) };
            voice->lfo[r][m] = &rawWave(real, imag, 2, sampleRate, frequencies, cents, 5);
        }
    return voice;
}

OrganKey organKey(const Voice& voice, int midi) {
    OrganKey k;
    const auto* organ = dynamic_cast<const Organ*>(&voice);
    if (!organ || midi < 0 || midi > 127) return k;
    k.wave = organ->waves[midi];
    k.hz = static_cast<float>(hz(midi) / 2);
    k.cents = static_cast<float>(wheelCents(midi % 12));
    const std::vector<float> c = coefficients(midi, organ->bars);
    std::copy(c.begin(), c.begin() + 17, k.real.begin());
    std::copy(c.begin() + 17, c.end(), k.imag.begin());
    return k;
}

} // namespace btg::detail
