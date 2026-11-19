#include "sound_data.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <limits>

extern const unsigned char btg_sound_json[]; // native/core/data/sound.json, embedded by CMake
extern const unsigned int btg_sound_json_size;

namespace btg::detail {

using json = nlohmann::json;

const SoundData& soundData() {
    static const SoundData data = [] {
        // a bad embedded file throws: that is a build error, not a user error
        const json j = json::parse(btg_sound_json, btg_sound_json + btg_sound_json_size);
        SoundData out;
        for (const auto& [key, specs] : j.at("tunables").items())
            for (const auto& [name, s] : specs.items()) out.tunables[key][name] = { s.at("min").get<double>(), s.at("max").get<double>(), s.at("value").get<double>() };
        out.packs = j.at("packs").get<std::map<std::string, std::string>>();
        out.hitKeys = j.at("hitKeys").get<std::map<std::string, std::map<std::string, int>>>();
        for (const auto& [layer, audio] : j.at("layerAudio").items()) {
            out.trim[layer] = audio.at("trim").get<double>();
            if (audio.value("room", false)) out.roomLayers.insert(layer);
        }
        out.kitPan = j.at("kitPan").get<std::map<std::string, double>>();
        return out;
    }();
    return data;
}

Tuning parseTuning(const std::string& text) {
    const json j = json::parse(text, nullptr, false);
    Tuning out;
    if (!j.is_object()) return out;
    for (const auto& [key, values] : j.items()) {
        if (!values.is_object()) continue;
        for (const auto& [name, value] : values.items())
            if (value.is_number() && std::isfinite(value.get<double>())) out[key][name] = value.get<double>();
    }
    return out;
}

double tunedValue(const std::string& key, const std::string& name, const Tuning& tuning) {
    const auto& tunables = soundData().tunables;
    const auto voice = tunables.find(key);
    if (voice == tunables.end()) return std::numeric_limits<double>::quiet_NaN();
    const auto spec = voice->second.find(name);
    if (spec == voice->second.end()) return std::numeric_limits<double>::quiet_NaN();
    const Spec& s = spec->second;
    const auto over = tuning.find(key);
    if (over != tuning.end()) {
        const auto value = over->second.find(name);
        if (value != over->second.end()) return std::clamp(value->second, s.min, s.max);
    }
    return std::clamp(s.value, s.min, s.max);
}

} // namespace btg::detail
