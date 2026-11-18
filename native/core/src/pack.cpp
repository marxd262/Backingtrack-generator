#include "btg/pack.h"

#include <dr_flac.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <iterator>
#include <stdexcept>

namespace btg {

Pack loadPack(const std::string& text, const unsigned char* audio, size_t size) {
    using json = nlohmann::json;
    const json j = json::parse(text);
    Pack pack;
    pack.version = j.value("version", 1);
    if (pack.version != 1 && pack.version != 2) throw std::runtime_error("pack: unknown version");
    if (j.contains("keys")) pack.keys = j["keys"].get<std::map<std::string, int>>();

    int decodedFrames = 0;
    if (pack.version == 2) {
        unsigned int channels = 0, rate = 0;
        drflac_uint64 frames = 0;
        float* decoded = drflac_open_memory_and_read_pcm_frames_f32(audio, size, &channels, &rate, &frames, nullptr);
        if (!decoded) throw std::runtime_error("pack: the FLAC file cannot be decoded");
        pack.audio.assign(decoded, decoded + frames * channels);
        drflac_free(decoded, nullptr);
        if (static_cast<int>(channels) != j.value("channels", 1) || static_cast<int>(rate) != j.value("rate", 44100)) throw std::runtime_error("pack: channels or rate differ from the JSON");
        pack.channels = static_cast<int>(channels);
        decodedFrames = static_cast<int>(frames);
    } else {
        pack.audio.resize(size / 2);
        for (size_t i = 0; i < pack.audio.size(); ++i) // 16 bit signed, little endian
            pack.audio[i] = static_cast<float>(static_cast<short>(audio[2 * i] | (audio[2 * i + 1] << 8))) / 32768.0f;
        decodedFrames = static_cast<int>(pack.audio.size());
    }

    for (const auto& s : j.at("samples")) {
        Pack::Sample sample;
        // long long: a value that does not fit an int must not wrap around before it is checked
        const long long offset = s.at("offset").get<long long>() / (pack.version == 1 ? 2 : 1); // format 1 counts bytes
        const long long frames = s.at("frames").get<long long>();
        if (offset < 0 || frames < 0 || offset > decodedFrames || frames > decodedFrames - offset) throw std::runtime_error("pack: a sample lies outside the audio file");
        sample.offset = static_cast<int>(offset);
        sample.frames = static_cast<int>(frames);
        sample.rate = s.value("rate", 44100.0);
        if (!(sample.rate >= 1000.0 && sample.rate <= 1e6)) throw std::runtime_error("pack: a sample rate is not between 1000 and 1000000 Hz");
        const long long loopStart = s.value("loopStart", 0LL), loopEnd = s.value("loopEnd", 0LL);
        if (loopStart < 0 || loopStart > frames || loopEnd < 0 || loopEnd > frames) throw std::runtime_error("pack: loop points lie outside their sample");
        sample.loopStart = static_cast<int>(loopStart);
        sample.loopEnd = static_cast<int>(loopEnd);
        pack.samples.push_back(sample);
    }
    const int count = static_cast<int>(pack.samples.size());
    for (const auto& z : j.at("zones")) {
        Pack::Zone zone;
        zone.keyLo = z.value("keyLo", 0);
        zone.keyHi = z.value("keyHi", 127);
        zone.velLo = z.value("velLo", 0);
        zone.velHi = z.value("velHi", 127);
        zone.sample = z.at("sample");
        zone.rootKey = z.value("rootKey", 60);
        zone.tuneCents = z.value("tuneCents", 0.0);
        zone.attenuationDb = z.value("attenuationDb", 0.0);
        zone.attack = z.value("attack", 0.0);
        zone.hold = z.value("hold", 0.0);
        zone.decay = z.value("decay", 0.0);
        zone.release = z.value("release", 0.0);
        zone.sustainDb = z.value("sustainDb", 0.0);
        zone.releaseTrigger = z.value("trigger", "") == "release";
        zone.art = z.value("art", "");
        zone.room = z.value("room", -1);
        zone.offBy = z.value("offBy", 0);
        zone.offTime = z.value("offTime", 0.0);
        if (z.contains("chokes")) zone.chokes = z["chokes"].get<std::vector<int>>();
        if (z.contains("velGain")) {
            zone.hasVelGain = true;
            zone.velGain[0] = z["velGain"][0];
            zone.velGain[1] = z["velGain"][1];
        }
        if (zone.sample < 0 || zone.sample >= count || zone.room >= count) throw std::runtime_error("pack: a zone names a sample that does not exist");
        const Pack::Sample& sample = pack.samples[zone.sample];
        zone.loop = pack.version == 1 && z.value("loop", false) && sample.loopEnd > sample.loopStart && sample.loopEnd <= sample.frames;
        pack.zones.push_back(std::move(zone));
    }
    return pack;
}

std::shared_ptr<const Pack> loadPackFiles(const std::string& folder, const std::string& id) {
    const auto read = [](const std::string& path) {
        std::ifstream file(path, std::ios::binary);
        if (!file) throw std::runtime_error("pack: cannot open " + path);
        return std::string(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
    };
    // The id comes from a page: only a plain name may reach the file system.
    const bool plain = !id.empty() && id.find("..") == std::string::npos
        && std::all_of(id.begin(), id.end(), [](unsigned char c) { return std::isalnum(c) || c == '-' || c == '_' || c == '.'; });
    if (!plain) throw std::runtime_error("pack: the id is not a plain name");
    const std::string text = read(folder + "/" + id + ".json");
    const std::string name = nlohmann::json::parse(text).value("file", id + ".pcm");
    if (name.find_first_of("/\\") != std::string::npos) throw std::runtime_error("pack: the audio file must lie next to the JSON");
    const std::string audio = read(folder + "/" + name);
    return std::make_shared<const Pack>(loadPack(text, reinterpret_cast<const unsigned char*>(audio.data()), audio.size()));
}

} // namespace btg
