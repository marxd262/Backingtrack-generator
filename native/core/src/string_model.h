#pragma once

// The string model of the web app: src/audio/string-model.js (line numbers of that file), a pure function that computes one note of a
// plucked string ahead as a buffer (a sum of decaying partials, a burst of attack noise, the pickup's lowpass, two body resonances and the
// hand's damping after the note's end). The voices bass/string/finger and chords/string/electric play it (voices/string.cpp).

#include <cmath>
#include <cstdint>
#include <vector>

namespace btg::detail {

// STRING_DEFAULTS' names (15 to 24); NaN where the web's params object has no finite value: clean() (34 to 41) takes the default there and
// clamps the others to RANGES.
struct StringParams {
    double pluckPos = NAN, brightness = NAN, decay = NAN, excite = NAN, stiffness = NAN, pickupPos = NAN, pickupLp = NAN, body = NAN;
};

// 47 to 130: the web's Float32Array, ceil(seconds * sampleRate) samples (those from `stop` on are 0, as the web computes nothing there).
// dur and vel NaN: the web's defaults (seconds and 0.8); seed: createRng(seed). Throws std::invalid_argument where the web throws its RangeError.
std::vector<float> renderString(double midi, double seconds, double dur, double vel, double sampleRate, uint32_t seed, const StringParams& params);

} // namespace btg::detail
