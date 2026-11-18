// Offline render of a track with the engine of the core, no JUCE:
//   btg_render <track.json> <folder with the sample packs> <out.wav> [sample rate, default 48000] [--dry]
// The track is JSON as normalizeTrack() of the web app writes it (see native/tools). Plays the song once, then 0.2 s in which the tones ring out.
// --dry: no limiter (the sum only gets the master gain), written as 32-bit float WAV so that nothing clips; for native/tools/sound-compare.mjs.
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
    bool dry = false;
    std::vector<char*> args;
    for (int i = 0; i < argc; ++i) {
        if (std::string(argv[i]) == "--dry") dry = true;
        else args.push_back(argv[i]);
    }
    argc = static_cast<int>(args.size());
    argv = args.data();
    if (argc < 4) { std::printf("usage: btg_render <track.json> <packs folder> <out.wav> [sample rate] [--dry]\n"); return 2; }
    const double rate = argc > 4 ? std::atof(argv[4]) : 48000.0;
    try {
        std::ifstream file(argv[1], std::ios::binary);
        if (!file) throw std::runtime_error(std::string("cannot open ") + argv[1]);
        const std::string track((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());

        btg::Engine engine;
        const std::string folder = argv[2];
        engine.setPackSource([folder](const std::string& id) { return btg::loadPackFiles(folder, id); });
        engine.setTrack(track);
        std::printf("voices: %s\n", engine.voiceStatus().c_str());
        engine.setLimiter(!dry);
        engine.prepare(rate);
        btg::Transport transport;
        transport.play(0.0, engine.bpm());

        const int block = 480;
        const long long songFrames = static_cast<long long>(engine.lengthBeats() * 60 / engine.bpm() * rate);
        std::vector<float> left(block), right(block);
        std::vector<float> samples;
        double peak = 0.0, squares = 0.0;
        // As native/tools/web-render.mjs renders: the song once (the last block ends on its end, so nothing of the next lap starts),
        // then that render's 0.2 s with the clock standing at the end (playing, no advance, so no event), in which the tones ring out.
        btg::Transport::Block position;
        for (long long done = 0; done < songFrames + static_cast<long long>(0.2 * rate); done += position.frames) {
            if (done < songFrames) position = transport.advance(static_cast<int>(std::min<long long>(block, songFrames - done)), rate);
            else // exactly where the last block ended (lengthBeats may lie up to a frame on: a jump); the same start, another count would be a new one
                position = { true, position.beats + position.frames * position.beatsPerFrame, 0.0, block, position.starts };
            engine.render(left.data(), right.data(), position.frames, position);
            for (int i = 0; i < position.frames; ++i) {
                for (const float x : { left[i], right[i] }) {
                    peak = std::max(peak, static_cast<double>(std::fabs(x)));
                    squares += static_cast<double>(x) * x;
                    samples.push_back(x);
                }
            }
        }

        std::vector<int16_t> pcm;
        if (!dry) for (const float x : samples) pcm.push_back(static_cast<int16_t>(std::lround(x * 32767.0f)));
        const uint32_t width = dry ? 4 : 2, bytes = static_cast<uint32_t>(samples.size() * width), hz = static_cast<uint32_t>(rate);
        std::ofstream out(argv[3], std::ios::binary);
        const auto u32 = [&](uint32_t v) { out.write(reinterpret_cast<const char*>(&v), 4); }; // little endian hosts only
        const auto u16 = [&](uint16_t v) { out.write(reinterpret_cast<const char*>(&v), 2); };
        out.write("RIFF", 4); u32(36 + bytes); out.write("WAVEfmt ", 8); u32(16); u16(dry ? 3 : 1); u16(2); u32(hz); u32(hz * 2 * width); u16(static_cast<uint16_t>(2 * width)); u16(static_cast<uint16_t>(8 * width));
        out.write("data", 4); u32(bytes);
        out.write(dry ? reinterpret_cast<const char*>(samples.data()) : reinterpret_cast<const char*>(pcm.data()), bytes);
        if (!out) throw std::runtime_error(std::string("cannot write ") + argv[3]);

        const double rms = std::sqrt(squares / static_cast<double>(samples.size()));
        std::printf("%.1f s, peak %.3f, rms %.4f (%.1f dBFS)\n", static_cast<double>(samples.size() / 2) / rate, peak, rms, 20 * std::log10(std::max(rms, 1e-9)));
        return rms > 0.001 ? 0 : 1; // a silent render is a failure
    } catch (const std::exception& error) {
        std::printf("error: %s\n", error.what());
        return 1;
    }
}
