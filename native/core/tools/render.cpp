// Offline render of a track with the engine of the core, no JUCE:
//   btg_render <track.json> <folder with the sample packs> <out.wav> [sample rate, default 48000]
// The track is JSON as normalizeTrack() of the web app writes it (see native/tools). Plays the song once.
#include "btg/engine.h"
#include "btg/pack.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

int main(int argc, char** argv) {
    if (argc < 4) { std::printf("usage: btg_render <track.json> <packs folder> <out.wav> [sample rate]\n"); return 2; }
    const double rate = argc > 4 ? std::atof(argv[4]) : 48000.0;
    try {
        std::ifstream file(argv[1], std::ios::binary);
        if (!file) throw std::runtime_error(std::string("cannot open ") + argv[1]);
        const std::string track((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());

        btg::Engine engine;
        engine.setPack(btg::Engine::drums, btg::loadPackFiles(argv[2], "drums-naked"));
        engine.setPack(btg::Engine::bass, btg::loadPackFiles(argv[2], "bass-finger"));
        engine.setTrack(track);
        engine.prepare(rate);
        btg::Transport transport;
        transport.play(0.0, engine.bpm());

        const int block = 480;
        const long long songFrames = static_cast<long long>(engine.lengthBeats() * 60 / engine.bpm() * rate);
        std::vector<float> left(block), right(block);
        std::vector<int16_t> pcm;
        double peak = 0.0, squares = 0.0;
        for (long long done = 0; done < songFrames + static_cast<long long>(0.2 * rate); done += block) {
            if (done >= songFrames) transport.stop(); // the engine fades out
            const auto position = transport.advance(block, rate);
            engine.render(left.data(), right.data(), block, position);
            for (int i = 0; i < block; ++i) {
                for (const float x : { left[i], right[i] }) {
                    peak = std::max(peak, static_cast<double>(std::fabs(x)));
                    squares += static_cast<double>(x) * x;
                    pcm.push_back(static_cast<int16_t>(std::lround(x * 32767.0f)));
                }
            }
        }

        const uint32_t bytes = static_cast<uint32_t>(pcm.size() * 2), hz = static_cast<uint32_t>(rate);
        std::ofstream out(argv[3], std::ios::binary);
        const auto u32 = [&](uint32_t v) { out.write(reinterpret_cast<const char*>(&v), 4); }; // little endian hosts only
        const auto u16 = [&](uint16_t v) { out.write(reinterpret_cast<const char*>(&v), 2); };
        out.write("RIFF", 4); u32(36 + bytes); out.write("WAVEfmt ", 8); u32(16); u16(1); u16(2); u32(hz); u32(hz * 4); u16(4); u16(16);
        out.write("data", 4); u32(bytes);
        out.write(reinterpret_cast<const char*>(pcm.data()), bytes);
        if (!out) throw std::runtime_error(std::string("cannot write ") + argv[3]);

        const double rms = std::sqrt(squares / static_cast<double>(pcm.size()));
        std::printf("%.1f s, peak %.3f, rms %.4f (%.1f dBFS)\n", static_cast<double>(pcm.size() / 2) / rate, peak, rms, 20 * std::log10(std::max(rms, 1e-9)));
        return rms > 0.001 ? 0 : 1; // a silent render is a failure
    } catch (const std::exception& error) {
        std::printf("error: %s\n", error.what());
        return 1;
    }
}
