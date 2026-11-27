// Offline render of a track with the engine of the core, no JUCE:
//   btg_render <track.json> <folder with the sample packs> <out.wav> [sample rate, default 48000] [--dry] [--sound <timbre.json>] [--tuning <file.json>] [--tail <seconds>]
//              [--without osc|buffers|both]
// The track is JSON as normalizeTrack() of the web app writes it (see native/tools). Plays the song once, then `tail` seconds (default 0.2) in
// which the tones and the sends ring out; the file holds exactly the song's frames plus the tail's.
// --sound: the timbre as the web app's resolveTrackTimbre(track) gives it (without the option: DEFAULT_TIMBRE), set before the track is built.
// --tuning: fine values as the web app's setTuning takes them ({"bass/sample/finger":{"level":2}}), set before the track is built (before the timbre).
// --dry: no limiter (no glue compressor either). The file is always a 32-bit float WAV, so that nothing clips; for native/tools/sound-compare.mjs.
// --without osc|buffers|both: the test hooks of src/patch.h (exactOscillators, wholeFrameBuffers, both), the "ohne" side of
// native/tools/ab-quirks.mjs; may be given more than once.
#include "../src/patch.h"
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
    double tail = 0.2;
    std::string tuningFile, soundFile;
    std::vector<char*> args;
    for (int i = 0; i < argc; ++i) {
        if (std::string(argv[i]) == "--dry") dry = true;
        else if (std::string(argv[i]) == "--tuning" && i + 1 < argc) tuningFile = argv[++i];
        else if (std::string(argv[i]) == "--sound" && i + 1 < argc) soundFile = argv[++i];
        else if (std::string(argv[i]) == "--tail" && i + 1 < argc) tail = std::atof(argv[++i]);
        else if (std::string(argv[i]) == "--without") { // the last argument without its value is an error too
            const std::string what = i + 1 < argc ? argv[++i] : "";
            if (what != "osc" && what != "buffers" && what != "both") { std::printf("--without osc, buffers or both\n"); return 2; }
            if (what != "buffers") btg::detail::exactOscillators = true;
            if (what != "osc") btg::detail::wholeFrameBuffers = true;
        } else args.push_back(argv[i]);
    }
    argc = static_cast<int>(args.size());
    argv = args.data();
    if (argc < 4) { std::printf("usage: btg_render <track.json> <packs folder> <out.wav> [sample rate] [--dry] [--sound <timbre.json>] [--tuning <file.json>] [--tail <seconds>] [--without osc|buffers|both]\n"); return 2; }
    const double rate = argc > 4 ? std::atof(argv[4]) : 48000.0;
    try {
        std::ifstream file(argv[1], std::ios::binary);
        if (!file) throw std::runtime_error(std::string("cannot open ") + argv[1]);
        const std::string track((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());

        btg::Engine engine;
        // read as UTF-8 (loadPackFiles), where Windows passes argv in its code page: the same for the tools, whose folders are the repository's (ASCII)
        const std::string folder = argv[2];
        engine.setPackSource([folder](const std::string& id) { return btg::loadPackFiles(folder, id); });
        if (!tuningFile.empty()) {
            std::ifstream tuning(tuningFile, std::ios::binary);
            if (!tuning) throw std::runtime_error("cannot open " + tuningFile);
            engine.setTuning(std::string((std::istreambuf_iterator<char>(tuning)), std::istreambuf_iterator<char>()));
        }
        if (!soundFile.empty()) {
            std::ifstream sound(soundFile, std::ios::binary);
            if (!sound) throw std::runtime_error("cannot open " + soundFile);
            engine.setSound(std::string((std::istreambuf_iterator<char>(sound)), std::istreambuf_iterator<char>()));
        }
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
        // then that render's tail with the clock standing at the end (playing, no advance, so no event), in which the tones ring out.
        btg::Transport::Block position;
        const long long total = songFrames + static_cast<long long>(tail * rate);
        for (long long done = 0; done < total; done += position.frames) {
            if (done < songFrames) position = transport.advance(static_cast<int>(std::min<long long>(block, songFrames - done)), rate);
            else // exactly where the last block ended (lengthBeats may lie up to a frame on: a jump); the same start, another count would be a new one
                position = { true, position.beats + position.frames * position.beatsPerFrame, 0.0, static_cast<int>(std::min<long long>(block, total - done)), position.starts };
            engine.render(left.data(), right.data(), position.frames, position);
            for (int i = 0; i < position.frames; ++i) {
                for (const float x : { left[i], right[i] }) {
                    peak = std::max(peak, static_cast<double>(std::fabs(x)));
                    squares += static_cast<double>(x) * x;
                    samples.push_back(x);
                }
            }
        }

        // 32-bit float always: the core does not clamp, and what the chain makes is what gets measured
        const uint32_t bytes = static_cast<uint32_t>(samples.size() * 4), hz = static_cast<uint32_t>(rate);
        std::ofstream out(argv[3], std::ios::binary);
        const auto u32 = [&](uint32_t v) { out.write(reinterpret_cast<const char*>(&v), 4); }; // little endian hosts only
        const auto u16 = [&](uint16_t v) { out.write(reinterpret_cast<const char*>(&v), 2); };
        out.write("RIFF", 4); u32(36 + bytes); out.write("WAVEfmt ", 8); u32(16); u16(3); u16(2); u32(hz); u32(hz * 8); u16(8); u16(32);
        out.write("data", 4); u32(bytes);
        out.write(reinterpret_cast<const char*>(samples.data()), bytes);
        if (!out) throw std::runtime_error(std::string("cannot write ") + argv[3]);

        const double rms = std::sqrt(squares / static_cast<double>(samples.size()));
        const size_t frames = samples.size() / 2;
        std::printf("%zu frames, %.4f s, peak %.3f, rms %.4f (%.1f dBFS)\n", frames, static_cast<double>(frames) / rate, peak, rms, 20 * std::log10(std::max(rms, 1e-9)));
        return rms > 0.001 ? 0 : 1; // a silent render is a failure
    } catch (const std::exception& error) {
        std::printf("error: %s\n", error.what());
        return 1;
    }
}
