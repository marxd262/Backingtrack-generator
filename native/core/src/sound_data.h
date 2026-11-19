#pragma once

// The numbers of the web app's voices: native/core/data/sound.json, written by native/tools/export-events.mjs --data from
// src/audio (tunables.js, pack-id.js, sample-hits.js, synth.js) and embedded by CMake. Control thread only.

#include <map>
#include <set>
#include <string>

namespace btg::detail {

struct Spec { double min = 0.0, max = 0.0, value = 0.0; };
struct SoundData {
    std::map<std::string, std::map<std::string, Spec>> tunables; // "bass/sample/finger", "mix/pan", ... -> name -> spec
    std::map<std::string, std::string> packs;                     // every sample voice "layer/sample/variant" -> pack id
    std::map<std::string, std::map<std::string, int>> hitKeys;    // "drums", "percussion", "drums/sample/rimshot" -> hit name -> key
    std::map<std::string, double> trim;                           // layerAudio: layer -> trim
    std::set<std::string> roomLayers;                             // layerAudio: the layers with room: true (their sum goes into the reverb)
    std::set<std::string> echoLayers;                             // layerAudio: the layers with echo: true (chords, pad, lead: their trim output feeds the echo)
    std::map<std::string, double> kitPan;                        // synth.js KIT_PAN: hit name -> place in the kit (a hit not named stays in the middle)
};
const SoundData& soundData(); // parsed on first use
using Tuning = std::map<std::string, std::map<std::string, double>>;
// Overrides as the web app's setTuning takes them; only finite numbers inside objects count, anything else is left out. Never throws.
Tuning parseTuning(const std::string& json);
// tunables.js, tunedValue: the default of `name` for the voice `key`, overridden by tuning[key][name], clamped to [min, max];
// NaN when the voice has no such value (also when only the override names it).
double tunedValue(const std::string& key, const std::string& name, const Tuning& tuning);

} // namespace btg::detail
