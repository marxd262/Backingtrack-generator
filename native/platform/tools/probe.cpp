// Tries the system functions from the command line:
//   btg_platform_probe loopback <seconds> <out.wav>   records what the system plays (mono, 16 bit)
//   btg_platform_probe decode <file> [out.wav]        decodes with the system's decoder
#include "btg_platform/system_audio.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>

int main(int argc, char** argv) {
    const std::string mode = argc > 1 ? argv[1] : "";
    if (!((mode == "loopback" && argc > 3) || (mode == "decode" && argc > 2))) {
        std::printf("usage: btg_platform_probe loopback <seconds> <out.wav> | decode <file> [out.wav]\n");
        return 2;
    }
    const auto started = std::chrono::steady_clock::now();
    const btg::platform::Audio audio = mode == "loopback" ? btg::platform::captureSystemAudio(std::atof(argv[2])) : btg::platform::decodeWithSystem(argv[2]);
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    if (!audio.error.empty()) { std::printf("not available: %s\n", audio.error.c_str()); return 1; }

    // to mono, 16 bit
    const size_t frames = audio.samples.size() / static_cast<size_t>(audio.channels);
    std::string pcm(frames * 2, '\0');
    double squares = 0.0, peak = 0.0;
    for (size_t i = 0; i < frames; ++i) {
        float sum = 0.0f;
        for (int c = 0; c < audio.channels; ++c) sum += audio.samples[i * audio.channels + c];
        const float x = sum / static_cast<float>(audio.channels);
        squares += static_cast<double>(x) * x;
        peak = std::max(peak, static_cast<double>(std::fabs(x)));
        const auto v = static_cast<int16_t>(std::lround(std::max(-1.0f, std::min(1.0f, x)) * 32767.0f));
        pcm[2 * i] = static_cast<char>(v & 0xff);
        pcm[2 * i + 1] = static_cast<char>((v >> 8) & 0xff);
    }
    const double rms = frames ? std::sqrt(squares / static_cast<double>(frames)) : 0.0;
    std::printf("%d channels, %.0f Hz, %.2f s, rms %.1f dBFS, peak %.3f, took %.0f ms\n", audio.channels, audio.rate, static_cast<double>(frames) / audio.rate,
                20 * std::log10(std::max(rms, 1e-9)), peak, ms);
    const char* file = mode == "loopback" ? argv[3] : argc > 3 ? argv[3] : nullptr;
    if (file) {
        const uint32_t bytes = static_cast<uint32_t>(pcm.size()), hz = static_cast<uint32_t>(audio.rate);
        std::ofstream out(file, std::ios::binary);
        const auto u32 = [&](uint32_t v) { out.write(reinterpret_cast<const char*>(&v), 4); }; // little endian hosts only
        const auto u16 = [&](uint16_t v) { out.write(reinterpret_cast<const char*>(&v), 2); };
        out.write("RIFF", 4); u32(36 + bytes); out.write("WAVEfmt ", 8); u32(16); u16(1); u16(1); u32(hz); u32(hz * 2); u16(2); u16(16);
        out.write("data", 4); u32(bytes);
        out.write(pcm.data(), bytes);
    }
    return 0;
}
