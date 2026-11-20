// The core's layer effects on a raw file, for native/tools/fx-compare.mjs (against the web app's chains in Chromium):
//   btg_fx <in.f32> <out.f32> <rate> none
//   btg_fx <in.f32> <out.f32> <rate> shaper <soft|hard|fuzz|muff|line> <2|4>
//   btg_fx <in.f32> <out.f32> <rate> guitar <bass|chords|pad|lead> <fuzz> <overdrive> <distortion> [--two hard|fuzz|both] [--change <frame> <f> <o> <d>]...
//   btg_fx <in.f32> <out.f32> <rate> mod <vibrato> <chorus> <bpm> [--change <frame> <vibrato> <chorus> <bpm>]...
//   btg_fx <in.f32> <out.f32> <rate> series <layer> <fuzz> <overdrive> <distortion> <vibrato> <chorus> <bpm> [--two hard|fuzz|both]
//                                                                         [--change <frame> <fuzz> <overdrive> <distortion> <vibrato> <chorus> <bpm>]...
//   btg_fx curves <out.f32>      the four curves in the order soft, hard, fuzz, muff (16385 floats each)
// in: mono, 32-bit float, little endian; out: stereo interleaved (L = R except after mod and series), the same frames; processed in blocks of
// 128 frames, as the browser does.
// --two: those 4x shapers run at 2x. --change: set() at that frame with new knobs while playing (the browser: ctx.suspend, set, resume), any number.
// --stereo <frame> (Task 20b; guitar, mod, series, none): in is two channels, interleaved; the chain runs in the left one alone until that
// frame (a multiple of 128) and in both from it on, as Chromium's nodes do once their input has two channels (0: from the start).
// none copies the input (the red run of the comparison). guitar, mod and series build the chain at frame 0 as createInstruments does
// ({ immediate: true }); series is a GuitarFx into a ModFx, set in that order (synth.js applyFx).
//
// The building blocks of the synth voices, for native/tools/voice-compare.mjs (Task 20a). in is the noise buffer the tool makes; out has
// <frames> frames, stereo interleaved; times and time constants are frames:
//   btg_fx <in.f32> <out.f32> <rate> osc <frames> <sine|square|sawtooth|triangle|custom> <hz> <cents> <start> <stop> [--exp <from> <hz> <frame>]
//                                                                    [--fm <hz> <depth>] [--custom <real> <imag> <normalized|raw>]
//       one oscillator of a SynthTone (<hz> its frequency's value before any event); --exp: its frequency set to <from> at the start and
//       ramped exponentially to <hz> at <frame>; --fm: a sine at <hz>
//       through a gain of <depth> into its frequency; --custom (with the wave custom): customWave of those comma-separated coefficients,
//       raw = disableNormalization
//   btg_fx <in.f32> <out.f32> <rate> param <frames> <value> [set <v> <frame> | linear <v> <frame> | exp <v> <frame> | target <v> <frame> <tc>]... [--input]
//       Param::values (L = R) with that intrinsic value and those events; --input: in added at audio rate
//   btg_fx <in.f32> <out.f32> <rate> graph <frames> <1|2|3|4|5>
//       the fixed graphs of voice-compare.mjs, built with SynthTone's calls (the numbers stand in both files)
//   btg_fx <in.f32> <out.f32> <rate> voice <frames> <key> <timbre> [--tuning <json>] [<frame> <midi> <vel> <seconds> [leslie=<v>] [swell=<dB>]
//                                                                    [artTime=<s>]]...  (Task 21; the tuning and the organ's fields Task 20)
//       the synth voice `key` ("chords/epiano/rhodes", "chords/organ/jazz") as setVoices builds it (makeVoice, no pack, the rate) with the
//       timbre as setSound takes it (JSON) and the tuning as setTuning takes it, its notes each from its frame on, through Tones and its organ
//       chains as the engine plays them (the noise of Engine::prepare); no layer chain, no mixer. A note's leslie and swell are the event's
//       fields, artTime gives it the art swell with that time. A name of HIT_NAMES in the place of <midi> is a hit of that name (Task 23).
// The tones render in calls of SYNTH_FRAMES (256) frames, the engine's chunk.
#include "../src/convolver.h"
#include "../src/guitar_fx.h"
#include "../src/mod_fx.h"
#include "../src/patch.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

using namespace btg::detail;

namespace {

void writeFloats(const char* file, const float* data, size_t count) {
    std::ofstream out(file, std::ios::binary);
    out.write(reinterpret_cast<const char*>(data), static_cast<std::streamsize>(count * sizeof(float)));
    if (!out) throw std::runtime_error(std::string("cannot write ") + file);
}

btg::Engine::Layer layerOf(const std::string& name) {
    for (const auto layer : { btg::Engine::bass, btg::Engine::chords, btg::Engine::pad, btg::Engine::lead })
        if (name == LAYER_NAMES[layer]) return layer;
    throw std::runtime_error("no effect chain on layer " + name);
}

std::vector<float> floatsOf(const std::string& list) { // "0,0.5,0.25"
    std::vector<float> values;
    for (size_t at = 0; at <= list.size();) {
        const size_t end = std::min(list.find(',', at), list.size());
        values.push_back(static_cast<float>(std::atof(list.substr(at, end - at).c_str())));
        at = end + 1;
    }
    return values;
}

Wave waveOf(const std::string& name) {
    const char* names[4] = { "sine", "square", "sawtooth", "triangle" };
    for (int i = 0; i < 4; ++i)
        if (name == names[i]) return static_cast<Wave>(i);
    throw std::runtime_error("unknown wave " + name);
}

void renderTone(SynthTone& tone, std::vector<float>& left, std::vector<float>& right) {
    const auto scratch = std::make_unique<SynthTone::Scratch>();
    for (size_t at = 0; at < left.size() && tone.active; at += SYNTH_FRAMES)
        tone.render(&left[at], &right[at], static_cast<int>(std::min<size_t>(SYNTH_FRAMES, left.size() - at)), *scratch);
    if (tone.overflow()) throw std::runtime_error("the graph does not fit a SynthTone");
}

// voice-compare.mjs GRAPHS, the same numbers (48 kHz frames)
void buildGraph(int which, SynthTone& t, const std::vector<float>& noise) {
    const int frames = static_cast<int>(noise.size());
    if (which == 1) { // noise -> lowpass, its frequency ramped exponentially -> a gain with adsr's envelope
        const int source = t.buffer(noise.data(), frames, 0, false, 3000, 36000), lp = t.biquad(Filter::lowpass, 6000.0f, 3.0f), a = t.gain(0.0f);
        Param& f = t.param(lp);
        f.setValueAtTime(6000.0f, 3000);
        f.exponentialRampToValueAtTime(200.0f, 21000);
        Param& g = t.param(a); // adsr(g, 0.0625, 0.0078125, 0.8, 0.09375, 0.3125)
        g.setValueAtTime(0.0001f, 3000);
        g.linearRampToValueAtTime(0.8f, 3375);
        g.setValueAtTime(0.8f, 7875);
        g.exponentialRampToValueAtTime(0.0001f, 22875);
        t.connect(source, lp);
        t.connect(lp, a);
        t.output(a);
    } else if (which == 2) { // a looped buffer from a fractional offset, ended by a duration of 1.5 s
        t.output(t.buffer(noise.data(), frames, 12345.6, true, 1500, 1500 + 72000));
    } else if (which == 3) { // noise -> bandpass -> gain and noise -> highpass -> gain, summed
        const int source = t.buffer(noise.data(), frames, 0, false, 0, 36000), bp = t.biquad(Filter::bandpass, 1800.0f, 0.8f), hp = t.biquad(Filter::highpass, 6000.0f, 0.7f);
        const int a = t.gain(0.7f), b = t.gain(0.4f), sum = t.gain(1.0f);
        t.connect(source, bp);
        t.connect(bp, a);
        t.connect(source, hp);
        t.connect(hp, b);
        t.connect(a, sum);
        t.connect(b, sum);
        t.output(sum);
    } else if (which == 4) { // two oscillators, each through a stereo panner, summed
        const int saw = t.osc(Wave::sawtooth, 330.0f, 0.0f, 0, 24000), square = t.osc(Wave::square, 495.0f, 0.0f, 0, 24000);
        const int left = t.panner(-0.6f), right = t.panner(0.6f), sum = t.gain(1.0f);
        t.connect(saw, left);
        t.connect(square, right);
        t.connect(left, sum);
        t.connect(right, sum);
        t.output(sum);
    } else if (which == 5) { // a sine LFO through a gain into a lowpass's frequency, the lowpass on a sawtooth
        const int lfo = t.osc(Wave::sine, 2.5f, 0.0f, 0, 36000), depth = t.gain(1500.0f), lp = t.biquad(Filter::lowpass, 2000.0f, 6.0f);
        const int saw = t.osc(Wave::sawtooth, 110.0f, 0.0f, 0, 36000);
        t.connect(lfo, depth);
        t.modulate(depth, t.param(lp));
        t.connect(saw, lp);
        t.output(lp);
    } else throw std::runtime_error("graph 1 to 5");
}

} // namespace

int main(int argc, char** argv) {
    const std::string usage = "usage: btg_fx <in.f32> <out.f32> <rate> none | shaper <soft|hard|fuzz|muff|line> <2|4> | guitar <layer> <fuzz> <overdrive> <distortion>\n"
                              "                                       | mod <vibrato> <chorus> <bpm> | series <layer> <fuzz> <overdrive> <distortion> <vibrato> <chorus> <bpm>\n"
                              "                                       | osc <frames> <wave> <hz> <cents> <start> <stop> [--exp <from> <hz> <frame>] [--fm <hz> <depth>]\n"
                              "                                                                        [--custom <real> <imag> <normalized|raw>]\n"
                              "                                       | param <frames> <value> [set|linear|exp <v> <frame> | target <v> <frame> <tc>]... [--input]\n"
                              "                                       | graph <frames> <1..5>\n"
                              "                                       | voice <frames> <key> <timbre> [--tuning <json>] [<frame> <midi> <vel> <seconds> [leslie=<v>] [swell=<dB>] [artTime=<s>]]...\n"
                              "       btg_fx curves <out.f32>\n";
    try {
        if (argc == 3 && std::string(argv[1]) == "curves") {
            std::vector<float> all;
            for (const Curve c : { Curve::soft, Curve::hard, Curve::fuzz, Curve::muff }) all.insert(all.end(), guitarCurve(c), guitarCurve(c) + CURVE_POINTS);
            writeFloats(argv[2], all.data(), all.size());
            return 0;
        }
        if (argc < 5) { std::printf("%s", usage.c_str()); return 2; }
        std::ifstream in(argv[1], std::ios::binary);
        if (!in) throw std::runtime_error(std::string("cannot read ") + argv[1]);
        const std::string bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        if (bytes.size() % 4 != 0) throw std::runtime_error(std::string(argv[1]) + " is not 32-bit float");
        std::vector<float> x(bytes.size() / 4);
        std::copy(bytes.begin(), bytes.end(), reinterpret_cast<char*>(x.data())); // little endian hosts only
        const double rate = std::atof(argv[3]);
        const std::string mode = argv[4];
        if (mode == "osc" || mode == "param" || mode == "graph" || mode == "voice") {
            if (argc < 7) { std::printf("%s", usage.c_str()); return 2; }
            const size_t frames = static_cast<size_t>(std::atoll(argv[5]));
            std::vector<float> left(frames), right(frames);
            SynthTone tone;
            tone.active = true;
            tone.basic = &basicWaves(rate);
            if (mode == "osc") {
                if (argc < 11) { std::printf("%s", usage.c_str()); return 2; }
                const double start = std::atof(argv[9]), stop = std::atof(argv[10]);
                std::shared_ptr<const WaveTables> custom; // the wave `custom`: --custom <real> <imag> <normalized|raw>, held while the tone plays
                for (int i = 11; i + 3 < argc; ++i) {
                    if (std::string(argv[i]) != "--custom") continue;
                    const std::vector<float> real = floatsOf(argv[i + 1]), imag = floatsOf(argv[i + 2]);
                    if (real.size() != imag.size()) throw std::runtime_error("--custom: as many real as imaginary coefficients");
                    custom = customWave(real.data(), imag.data(), static_cast<int>(real.size()), rate, std::string(argv[i + 3]) == "raw");
                }
                if ((std::string(argv[6]) == "custom") != static_cast<bool>(custom)) throw std::runtime_error("the wave custom goes with --custom");
                const float hz = static_cast<float>(std::atof(argv[7])), cents = static_cast<float>(std::atof(argv[8]));
                const int o = custom ? tone.osc(*custom, hz, cents, start, stop) : tone.osc(waveOf(argv[6]), hz, cents, start, stop);
                for (int i = 11; i < argc;) {
                    const std::string option = argv[i];
                    if (option == "--custom" && i + 3 < argc) {
                        i += 4;
                    } else if (option == "--exp" && i + 3 < argc) {
                        Param& f = tone.param(o);
                        f.setValueAtTime(static_cast<float>(std::atof(argv[i + 1])), start);
                        f.exponentialRampToValueAtTime(static_cast<float>(std::atof(argv[i + 2])), std::atof(argv[i + 3]));
                        i += 4;
                    } else if (option == "--fm" && i + 2 < argc) {
                        const int m = tone.osc(Wave::sine, static_cast<float>(std::atof(argv[i + 1])), 0.0f, start, stop), depth = tone.gain(static_cast<float>(std::atof(argv[i + 2])));
                        tone.connect(m, depth);
                        tone.modulate(depth, tone.param(o));
                        i += 3;
                    } else throw std::runtime_error("unknown option " + option);
                }
                tone.output(o);
                renderTone(tone, left, right);
            } else if (mode == "param") {
                Param p;
                p.value = static_cast<float>(std::atof(argv[6]));
                bool input = false;
                for (int i = 7; i < argc;) {
                    const std::string kind = argv[i];
                    if (kind == "--input") { input = true; ++i; continue; }
                    const int width = kind == "target" ? 4 : 3;
                    if (i + width > argc) throw std::runtime_error("event " + kind + ": too few numbers");
                    const float v = static_cast<float>(std::atof(argv[i + 1]));
                    const double frame = std::atof(argv[i + 2]);
                    if (kind == "set") p.setValueAtTime(v, frame);
                    else if (kind == "linear") p.linearRampToValueAtTime(v, frame);
                    else if (kind == "exp") p.exponentialRampToValueAtTime(v, frame);
                    else if (kind == "target") p.setTargetAtTime(v, frame, std::atof(argv[i + 3]));
                    else throw std::runtime_error("unknown event " + kind);
                    i += width;
                }
                if (p.overflow) throw std::runtime_error("more events than a Param holds");
                std::vector<float> added(frames, 0.0f);
                std::copy(x.begin(), x.begin() + static_cast<long>(std::min(frames, x.size())), added.begin());
                for (size_t at = 0; at < frames; at += SYNTH_FRAMES) {
                    const int count = static_cast<int>(std::min<size_t>(SYNTH_FRAMES, frames - at));
                    p.values(count, input ? &added[at] : nullptr, &left[at]);
                }
                right = left;
            } else if (mode == "voice") {
                if (argc < 8) { std::printf("%s", usage.c_str()); return 2; }
                const std::string key = argv[6];
                const auto layer = std::find_if(std::begin(LAYER_NAMES), std::end(LAYER_NAMES), [&](const char* n) { return key.rfind(std::string(n) + "/", 0) == 0; });
                if (layer == std::end(LAYER_NAMES)) throw std::runtime_error("no layer in " + key);
                struct Note { size_t frame; PlayEvent e; };
                std::vector<Note> notes;
                std::string tuning = "{}";
                for (int i = 8; i < argc;) {
                    const std::string token = argv[i];
                    if (token == "--tuning" && i + 1 < argc) { tuning = argv[i + 1]; i += 2; continue; }
                    if (const size_t eq = token.find('='); eq != std::string::npos) { // a field of the note before
                        if (notes.empty()) throw std::runtime_error(token + " before any note");
                        const std::string name = token.substr(0, eq);
                        const double v = std::atof(token.substr(eq + 1).c_str());
                        PlayEvent& e = notes.back().e;
                        if (name == "leslie") e.leslie = v;
                        else if (name == "swell") e.swell = v;
                        else if (name == "artTime") { e.art = Art::swell; e.artTime = v; }
                        else throw std::runtime_error("unknown field " + name);
                        ++i;
                        continue;
                    }
                    if (i + 3 >= argc) { std::printf("%s", usage.c_str()); return 2; }
                    Note n { static_cast<size_t>(std::atoll(argv[i])), {} };
                    const auto name = std::find_if(std::begin(HIT_NAMES), std::end(HIT_NAMES), [&](const char* h) { return std::string(h) == argv[i + 1]; });
                    n.e.hit = name != std::end(HIT_NAMES); // a hit of that name (Task 23), else a note of that midi
                    if (n.e.hit) n.e.name = static_cast<int>(name - std::begin(HIT_NAMES));
                    else n.e.midi = std::atoi(argv[i + 1]);
                    n.e.vel = std::atof(argv[i + 2]);
                    n.e.durBeats = std::atof(argv[i + 3]); // one beat a second
                    notes.push_back(n);
                    i += 4;
                }
                const auto voice = makeVoice(static_cast<btg::Engine::Layer>(layer - std::begin(LAYER_NAMES)), key, nullptr, parseTuning(tuning), completeTimbre(argv[7]), rate);
                if (!voice) throw std::runtime_error("the core has no synth voice " + key);
                const auto tones = std::make_unique<Tones>();
                tones->sr = rate;
                tones->basic = &basicWaves(rate);
                tones->noise = synthNoise(rate); // as Engine::prepare
                for (OrganChain& c : tones->chains) c.prepare(rate);
                VoiceState state;
                state.rng = voice->startRng;
                for (size_t at = 0; at < frames; at += SYNTH_FRAMES) {
                    const int count = static_cast<int>(std::min<size_t>(SYNTH_FRAMES, frames - at));
                    tones->quantum = static_cast<int>(at % 128); // the render's frame 0 is the play's first frame, as the context's
                    for (Note& n : notes) { // the notes that begin in this chunk, as the engine hands them to the voice
                        if (n.frame < at || n.frame >= at + count) continue;
                        n.e.layer = voice->layer;
                        voice->play(n.e, static_cast<int>(n.frame - at), 1.0, state, *tones);
                    }
                    // as the engine's chunk: a tone into its organ chain's entry or out; then the chains, playing (engine.cpp)
                    for (OrganChain& c : tones->chains) if (c.live) c.clear(count);
                    for (SynthTone& t : tones->synth) {
                        if (!t.active) continue;
                        if (t.bus < 0) t.render(&left[at], &right[at], count, tones->scratch);
                        else {
                            OrganChain& c = tones->chains[static_cast<size_t>(t.bus / 3)];
                            c.heard = true;
                            t.render(c.in[t.bus % 3], nullptr, count, tones->scratch);
                        }
                    }
                    for (OrganChain& c : tones->chains) if (c.live) c.process(&left[at], &right[at], count, tones->quantum);
                }
                for (const SynthTone& t : tones->synth) if (t.overflow()) throw std::runtime_error("the voice's graph does not fit a SynthTone");
                for (const OrganChain& c : tones->chains) if (c.overflow()) throw std::runtime_error("an organ chain's param had more events waiting than it holds");
            } else {
                buildGraph(std::atoi(argv[6]), tone, x);
                renderTone(tone, left, right);
            }
            std::vector<float> both(frames * 2);
            for (size_t i = 0; i < frames; ++i) { both[2 * i] = left[i]; both[2 * i + 1] = right[i]; }
            writeFloats(argv[2], both.data(), both.size());
            return 0;
        }
        std::vector<float> right; // the second channel: the modulation modes' and that of a stereo input; the others write L = R
        long long stereoFrom = -1;
        for (int i = 5; i + 1 < argc; ++i)
            if (std::string(argv[i]) == "--stereo") stereoFrom = std::atoll(argv[i + 1]);
        if (stereoFrom >= 0) {
            if (stereoFrom % 128 != 0) throw std::runtime_error("--stereo: the frame must be a multiple of 128 (the browser changes between render quanta)");
            const size_t frames = x.size() / 2;
            right.resize(frames);
            for (size_t i = 0; i < frames; ++i) { right[i] = x[2 * i + 1]; x[i] = x[2 * i]; }
            x.resize(frames);
        }
        const auto stereoAt = [&](size_t frame) { return stereoFrom >= 0 && static_cast<long long>(frame) >= stereoFrom; };
        if (mode == "shaper") {
            if (argc != 7) { std::printf("%s", usage.c_str()); return 2; }
            static const float line[2] = { -1.0f, 1.0f };
            const std::string curve = argv[5];
            const float* points = curve == "soft" ? guitarCurve(Curve::soft) : curve == "hard" ? guitarCurve(Curve::hard) : curve == "fuzz" ? guitarCurve(Curve::fuzz)
                                : curve == "muff" ? guitarCurve(Curve::muff) : curve == "line" ? line : nullptr;
            if (!points) throw std::runtime_error("unknown curve " + curve);
            const int factor = std::atoi(argv[6]);
            if (factor != 2 && factor != 4) throw std::runtime_error("oversample must be 2 or 4");
            Shaper shaper;
            shaper.prepare(points, curve == "line" ? 2 : CURVE_POINTS, factor);
            for (float& v : x) v = shaper.process(v);
        } else if (mode == "guitar") {
            if (argc < 9) { std::printf("%s", usage.c_str()); return 2; }
            const btg::Engine::Layer layer = layerOf(argv[5]);
            // options: --two hard|fuzz|both (those shapers at 2x), --change <frame> <fuzz> <overdrive> <distortion> (frame a multiple of 128)
            bool hardFourX = true, fuzzFourX = true;
            struct Change { size_t frame; FxChainParams params; };
            std::vector<Change> changes;
            for (int i = 9; i < argc;) {
                const std::string option = argv[i];
                if (option == "--two" && i + 1 < argc) {
                    const std::string which = argv[i + 1];
                    if (which != "hard" && which != "fuzz" && which != "both") throw std::runtime_error("--two: hard, fuzz or both");
                    hardFourX = which == "fuzz";
                    fuzzFourX = which == "hard";
                    i += 2;
                } else if (option == "--change" && i + 4 < argc) {
                    const size_t frame = static_cast<size_t>(std::atoll(argv[i + 1]));
                    if (frame % 128 != 0) throw std::runtime_error("--change: the frame must be a multiple of 128 (the browser changes between render quanta)");
                    if (!changes.empty() && frame <= changes.back().frame) throw std::runtime_error("--change: the frames must ascend");
                    changes.push_back({ frame, fxChainParams(std::atof(argv[i + 2]), std::atof(argv[i + 3]), std::atof(argv[i + 4]), layer) });
                    i += 5;
                } else if (option == "--stereo" && i + 1 < argc) i += 2;
                else throw std::runtime_error("unknown option " + option);
            }
            GuitarFx fx;
            fx.prepare(layer, rate, hardFourX, fuzzFourX);
            fx.set(fxChainParams(std::atof(argv[6]), std::atof(argv[7]), std::atof(argv[8]), layer), true);
            for (size_t at = 0, next = 0; at < x.size(); at += 128) {
                while (next < changes.size() && changes[next].frame <= at) fx.set(changes[next++].params, false);
                fx.process(&x[at], right.empty() ? nullptr : &right[at], static_cast<int>(std::min<size_t>(128, x.size() - at)), stereoAt(at));
            }
            if (stereoFrom > 0) std::copy(x.begin(), x.begin() + std::min(stereoFrom, static_cast<long long>(x.size())), right.begin()); // mono: L = R
        } else if (mode == "mod" || mode == "series") {
            const bool series = mode == "series";
            const int at = series ? 6 : 5, width = series ? 6 : 3; // the first knob in argv; knobs per set: fuzz, overdrive, distortion (series), vibrato, chorus, bpm
            if (argc < at + width) { std::printf("%s", usage.c_str()); return 2; }
            const btg::Engine::Layer layer = series ? layerOf(argv[5]) : btg::Engine::bass;
            struct Knobs { FxChainParams fx; ModParams mod; };
            const auto knobs = [&](int from) {
                Knobs k {};
                if (series) { k.fx = fxChainParams(std::atof(argv[from]), std::atof(argv[from + 1]), std::atof(argv[from + 2]), layer); from += 3; }
                k.mod = modParams(std::atof(argv[from]), std::atof(argv[from + 1]), std::atof(argv[from + 2]));
                return k;
            };
            bool hardFourX = true, fuzzFourX = true;
            struct Change { size_t frame; Knobs knobs; };
            std::vector<Change> changes;
            for (int i = at + width; i < argc;) {
                const std::string option = argv[i];
                if (series && option == "--two" && i + 1 < argc) {
                    const std::string which = argv[i + 1];
                    if (which != "hard" && which != "fuzz" && which != "both") throw std::runtime_error("--two: hard, fuzz or both");
                    hardFourX = which == "fuzz";
                    fuzzFourX = which == "hard";
                    i += 2;
                } else if (option == "--change" && i + width < argc) {
                    const size_t frame = static_cast<size_t>(std::atoll(argv[i + 1]));
                    if (frame % 128 != 0) throw std::runtime_error("--change: the frame must be a multiple of 128 (the browser changes between render quanta)");
                    if (!changes.empty() && frame <= changes.back().frame) throw std::runtime_error("--change: the frames must ascend");
                    changes.push_back({ frame, knobs(i + 2) });
                    i += 2 + width;
                } else if (option == "--stereo" && i + 1 < argc) i += 2;
                else throw std::runtime_error("unknown option " + option);
            }
            GuitarFx guitar;
            ModFx modulation;
            const Knobs first = knobs(at);
            if (series) { guitar.prepare(layer, rate, hardFourX, fuzzFourX); guitar.set(first.fx, true); }
            modulation.prepare(rate);
            modulation.set(first.mod, true);
            right.resize(x.size()); // a stereo input's right channel, processed in place
            for (size_t from = 0, next = 0; from < x.size(); from += 128) {
                while (next < changes.size() && changes[next].frame <= from) {
                    if (series) guitar.set(changes[next].knobs.fx, false);
                    modulation.set(changes[next++].knobs.mod, false);
                }
                const int count = static_cast<int>(std::min<size_t>(128, x.size() - from));
                if (series) guitar.process(&x[from], &right[from], count, stereoAt(from));
                modulation.process(&x[from], &right[from], &x[from], &right[from], count, stereoAt(from));
            }
        } else if (mode != "none") {
            std::printf("%s", usage.c_str());
            return 2;
        }
        if (right.empty()) right = x;
        std::vector<float> both(x.size() * 2);
        for (size_t i = 0; i < x.size(); ++i) { both[2 * i] = x[i]; both[2 * i + 1] = right[i]; }
        writeFloats(argv[2], both.data(), both.size());
        return 0;
    } catch (const std::exception& error) {
        std::printf("error: %s\n", error.what());
        return 1;
    }
}
