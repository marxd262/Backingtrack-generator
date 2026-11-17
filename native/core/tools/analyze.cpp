// Analysis of an audio file with the core, no JUCE:
//   btg_analyze <audio.wav|.flac|.mp3> [out.json] [drums.wav bass.wav rest.wav] [--beats beats.json]
// --beats (last): beats and bar starts from elsewhere, { "beats": [seconds...], "downbeats": [...] }, for measuring.
// Otherwise the beats come from the Beat This! model in native/models (native/tools/get-models.mjs), if it is
// there and the environment does not say BTG_NO_BEAT_MODEL=1; without it the analysis tracks the beats itself.
// BTG_BEATS_CACHE=<folder>: the model's beats are kept there per file name and read back the next time, so loops
// over the chord analysis do not wait for the model. They hold only while the file has the same size and date.
// With the three stems of the same track (same rate; lengths may differ by the decoder's padding) the analysis
// takes the beats from the drums, the chord roots from the bass and the chords from the rest.
// Prints the result as JSON (or writes it to out.json) and the timing to stderr.
#include "btg/analysis.h"
#include "btg/decode.h"
#ifdef BTG_BEAT_MODEL
#include "btg/beat_model.h"
#endif

#include <chrono>
#include <cstdio>
#include <filesystem>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

static std::vector<float> decodeMono(const std::string& path, unsigned int& rate) {
    std::string error;
    const auto clip = btg::decodeFile(path, &error);
    if (!clip) throw std::runtime_error(error + ": " + path);
    rate = static_cast<unsigned int>(clip->rate);
    return btg::monoOf(*clip);
}

// The numbers of the array after "key" in a small JSON file; enough for the files the measuring scripts write.
static std::vector<double> numbersAfter(const std::string& text, const std::string& key) {
    std::vector<double> numbers;
    size_t at = text.find("\"" + key + "\"");
    if (at == std::string::npos) return numbers;
    at = text.find('[', at);
    const size_t end = text.find(']', at);
    while (at != std::string::npos && ++at < end) {
        char* next = nullptr;
        numbers.push_back(std::strtod(text.c_str() + at, &next));
        at = text.find(',', static_cast<size_t>(next - text.c_str()));
    }
    return numbers;
}

int main(int argc, char** argv) {
    btg::Grid grid;
    if (argc > 3 && std::string(argv[argc - 2]) == "--beats") {
        std::ifstream file(argv[argc - 1], std::ios::binary);
        const std::string text((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
        grid.beats = numbersAfter(text, "beats");
        grid.downbeats = numbersAfter(text, "downbeats");
        if (grid.beats.empty()) { std::fprintf(stderr, "error: no beats in %s\n", argv[argc - 1]); return 1; }
        argc -= 2;
    }
    if (argc < 2 || argc == 4 || argc == 5) { std::printf("usage: btg_analyze <audio.wav|.flac|.mp3> [out.json] [drums.wav bass.wav rest.wav]\n"); return 2; }
    try {
        const auto clock = [] { return std::chrono::steady_clock::now(); };
        const auto started = clock();
        unsigned int rate = 0;
        const std::vector<float> mono = decodeMono(argv[1], rate);
        std::vector<float> parts[3];
        btg::Stems stems;
        if (argc > 5) {
            for (int i = 0; i < 3; ++i) {
                unsigned int stemRate = 0;
                parts[i] = decodeMono(argv[3 + i], stemRate);
                if (stemRate != rate) throw std::runtime_error("the stems must have the rate of the track");
                parts[i].resize(mono.size(), 0.0f);
            }
            stems = { parts[0].data(), parts[1].data(), parts[2].data() };
        }
        const auto decodedAt = clock();
#ifdef BTG_BEAT_MODEL
        if (grid.beats.empty() && !std::getenv("BTG_NO_BEAT_MODEL")) {
            std::string why, cache;
            // size in bytes and date in whole seconds: kept beats count only for the very file they were found in
            const long long size = static_cast<long long>(std::filesystem::file_size(argv[1]));
            const long long date = std::chrono::duration_cast<std::chrono::seconds>(std::filesystem::last_write_time(argv[1]).time_since_epoch()).count();
            if (const char* folder = std::getenv("BTG_BEATS_CACHE")) {
                const std::string path = argv[1];
                cache = std::string(folder) + "/" + path.substr(path.find_last_of("/\\") + 1) + ".beats.json";
                std::ifstream kept(cache, std::ios::binary);
                const std::string text((std::istreambuf_iterator<char>(kept)), std::istreambuf_iterator<char>());
                if (numbersAfter(text, "file") == std::vector<double> { static_cast<double>(size), static_cast<double>(date) }) {
                    grid.beats = numbersAfter(text, "beats");
                    grid.downbeats = numbersAfter(text, "downbeats");
                }
            }
            if (grid.beats.empty()) {
                grid = btg::findBeats(mono.data(), mono.size(), rate, std::string(BTG_MODELS_DIR) + "/beat_this.onnx", {}, &why);
                if (!cache.empty() && !grid.beats.empty()) {
                    std::ofstream keep(cache, std::ios::binary);
                    keep.precision(10);
                    keep << "{\"file\":[" << size << "," << date << "],\"beats\":[";
                    for (size_t i = 0; i < grid.beats.size(); ++i) keep << (i ? "," : "") << grid.beats[i];
                    keep << "],\"downbeats\":[";
                    for (size_t i = 0; i < grid.downbeats.size(); ++i) keep << (i ? "," : "") << grid.downbeats[i];
                    keep << "]}\n";
                }
            }
            if (grid.beats.empty()) std::fprintf(stderr, "no beats from the model (%s): own beat tracker\n", why.c_str());
            else std::fprintf(stderr, "beat model: %zu beats, %zu bars, %.0f ms\n", grid.beats.size(), grid.downbeats.size(),
                              std::chrono::duration<double, std::milli>(clock() - decodedAt).count());
        }
#endif

        const btg::Analysis result = btg::analyze(mono.data(), mono.size(), rate, {}, stems, grid);
        const auto done = clock();
        const auto ms = [](auto a, auto b) { return std::chrono::duration<double, std::milli>(b - a).count(); };
        std::fprintf(stderr, "%.1f s of audio, decode %.0f ms, analysis %.0f ms\n", static_cast<double>(mono.size()) / rate, ms(started, decodedAt), ms(decodedAt, done));
        if (result.beats.empty()) throw std::runtime_error("the track is too short to analyse");
        const std::string json = btg::toJson(result);
        if (argc > 2) std::ofstream(argv[2], std::ios::binary) << json << "\n";
        else std::printf("%s\n", json.c_str());
        return 0;
    } catch (const std::exception& error) {
        std::fprintf(stderr, "error: %s\n", error.what());
        return 1;
    }
}
