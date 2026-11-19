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
// none copies the input (the red run of the comparison). guitar, mod and series build the chain at frame 0 as createInstruments does
// ({ immediate: true }); series is a GuitarFx into a ModFx, set in that order (synth.js applyFx).
#include "../src/guitar_fx.h"
#include "../src/mod_fx.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
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

} // namespace

int main(int argc, char** argv) {
    const std::string usage = "usage: btg_fx <in.f32> <out.f32> <rate> none | shaper <soft|hard|fuzz|muff|line> <2|4> | guitar <layer> <fuzz> <overdrive> <distortion>\n"
                              "                                       | mod <vibrato> <chorus> <bpm> | series <layer> <fuzz> <overdrive> <distortion> <vibrato> <chorus> <bpm>\n"
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
        std::vector<float> right; // the modulation modes' second channel; the others write L = R
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
                } else throw std::runtime_error("unknown option " + option);
            }
            GuitarFx fx;
            fx.prepare(layer, rate, hardFourX, fuzzFourX);
            fx.set(fxChainParams(std::atof(argv[6]), std::atof(argv[7]), std::atof(argv[8]), layer), true);
            for (size_t at = 0, next = 0; at < x.size(); at += 128) {
                while (next < changes.size() && changes[next].frame <= at) fx.set(changes[next++].params, false);
                fx.process(&x[at], static_cast<int>(std::min<size_t>(128, x.size() - at)));
            }
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
                } else throw std::runtime_error("unknown option " + option);
            }
            GuitarFx guitar;
            ModFx modulation;
            const Knobs first = knobs(at);
            if (series) { guitar.prepare(layer, rate, hardFourX, fuzzFourX); guitar.set(first.fx, true); }
            modulation.prepare(rate);
            modulation.set(first.mod, true);
            right.resize(x.size());
            for (size_t from = 0, next = 0; from < x.size(); from += 128) {
                while (next < changes.size() && changes[next].frame <= from) {
                    if (series) guitar.set(changes[next].knobs.fx, false);
                    modulation.set(changes[next++].knobs.mod, false);
                }
                const int count = static_cast<int>(std::min<size_t>(128, x.size() - from));
                if (series) guitar.process(&x[from], count);
                modulation.process(&x[from], &x[from], &right[from], count);
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
