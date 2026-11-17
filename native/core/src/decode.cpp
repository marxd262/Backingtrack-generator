// Audio files into memory with the dr_libs decoders (their code sits in dr_flac_impl.cpp).
#include "btg/decode.h"

#include <dr_flac.h>
#include <dr_mp3.h>
#include <dr_wav.h>

#include <cctype>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <memory>

namespace btg {

std::shared_ptr<AudioClip> decodeFile(const std::filesystem::path& file, std::string* error) {
    const auto fail = [&](const char* why) { if (error) *error = why; return nullptr; };
    std::string type; // the ending in lower case; through UTF-8, as string() throws on Windows outside the code page
    for (const char8_t c : file.extension().u8string()) type += c < 128 ? static_cast<char>(std::tolower(c)) : '?';
    if (type != ".mp3" && type != ".flac" && type != ".wav") return fail("not a WAV, FLAC or MP3 file");
    std::ifstream in(file, std::ios::binary);
    if (!in) return fail("cannot open the file");
    // shortcut: the file and, for a moment, two copies of its samples are in memory; decode in pieces when
    // hour-long files matter.
    std::string bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    unsigned int channels = 0, rate = 0;
    unsigned long long frames = 0;
    float* decoded = nullptr;
    if (type == ".mp3") {
        drmp3_config config {};
        drmp3_uint64 n = 0;
        decoded = drmp3_open_memory_and_read_pcm_frames_f32(bytes.data(), bytes.size(), &config, &n, nullptr);
        channels = config.channels; rate = config.sampleRate; frames = n;
    } else if (type == ".flac") {
        drflac_uint64 n = 0;
        decoded = drflac_open_memory_and_read_pcm_frames_f32(bytes.data(), bytes.size(), &channels, &rate, &n, nullptr);
        frames = n;
    } else {
        drwav_uint64 n = 0;
        decoded = drwav_open_memory_and_read_pcm_frames_f32(bytes.data(), bytes.size(), &channels, &rate, &n, nullptr);
        frames = n;
    }
    const std::unique_ptr<float, void (*)(void*)> hold(decoded, std::free); // dr_libs allocate with malloc unless told otherwise
    std::string().swap(bytes);
    if (!decoded || channels == 0 || rate == 0 || frames == 0) return fail("cannot decode the file");
    auto clip = std::make_shared<AudioClip>();
    clip->channels = static_cast<int>(channels);
    clip->rate = rate;
    clip->samples.assign(decoded, decoded + frames * channels);
    return clip;
}

std::vector<float> monoOf(const AudioClip& clip) {
    const size_t channels = static_cast<size_t>(clip.channels);
    std::vector<float> mono(clip.samples.size() / channels);
    for (size_t i = 0; i < mono.size(); ++i) {
        float sum = 0.0f;
        for (size_t c = 0; c < channels; ++c) sum += clip.samples[i * channels + c];
        mono[i] = sum / static_cast<float>(channels);
    }
    return mono;
}

} // namespace btg
