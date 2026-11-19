// The core's compressor on a raw file, for native/tools/compressor-compare.mjs:
//   btg_compressor <in.f32> <out.f32> <rate> <threshold dB> <knee dB> <ratio> <attack s> <release s>
// in and out: stereo, interleaved, 32-bit float, little endian; processed in blocks of 128 frames, as the browser does.
#include "../src/compressor.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

int main(int argc, char** argv) {
    if (argc != 9) { std::printf("usage: btg_compressor <in.f32> <out.f32> <rate> <threshold dB> <knee dB> <ratio> <attack s> <release s>\n"); return 2; }
    try {
        std::ifstream in(argv[1], std::ios::binary);
        if (!in) throw std::runtime_error(std::string("cannot read ") + argv[1]);
        const std::string bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        if (bytes.size() % 8 != 0) throw std::runtime_error(std::string(argv[1]) + " is not stereo 32-bit float");
        const size_t frames = bytes.size() / 8;
        std::vector<float> samples(frames * 2), left(frames), right(frames);
        std::copy(bytes.begin(), bytes.end(), reinterpret_cast<char*>(samples.data())); // little endian hosts only
        for (size_t i = 0; i < frames; ++i) { left[i] = samples[2 * i]; right[i] = samples[2 * i + 1]; }

        btg::detail::Compressor compressor;
        compressor.prepare(static_cast<float>(std::atof(argv[3])));
        compressor.set(static_cast<float>(std::atof(argv[4])), static_cast<float>(std::atof(argv[5])), static_cast<float>(std::atof(argv[6])),
                       static_cast<float>(std::atof(argv[7])), static_cast<float>(std::atof(argv[8])));
        for (size_t at = 0; at < frames; at += 128) compressor.process(&left[at], &right[at], static_cast<int>(std::min<size_t>(128, frames - at)));
        for (size_t i = 0; i < frames; ++i) { samples[2 * i] = left[i]; samples[2 * i + 1] = right[i]; }

        std::ofstream out(argv[2], std::ios::binary);
        out.write(reinterpret_cast<const char*>(samples.data()), static_cast<std::streamsize>(samples.size() * sizeof(float)));
        if (!out) throw std::runtime_error(std::string("cannot write ") + argv[2]);
        return 0;
    } catch (const std::exception& error) {
        std::printf("error: %s\n", error.what());
        return 1;
    }
}
