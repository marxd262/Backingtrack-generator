#pragma once

// The small Web Audio helpers of src/audio/nodes.js (line numbers of that file) that the voice files share, built with SynthTone's calls
// (patch.h). Times are frames from the tone's time 0 (the web's t).

#include "../patch.h"

#include <cmath>

namespace btg::detail {

inline double hz(int m) { return 440 * std::pow(2.0, (m - 69) / 12.0); } // 3

// 15 to 20
inline void adsr(Param& g, double a, double peak, double hold, double rel, double sr) {
    g.setValueAtTime(0.0001f, 0);
    g.linearRampToValueAtTime(static_cast<float>(peak), a * sr);
    g.setValueAtTime(static_cast<float>(peak), (a + hold) * sr);
    g.exponentialRampToValueAtTime(0.0001f, (a + hold + rel) * sr);
}

// 22 to 31 and 33 to 38
inline int osc(SynthTone& tone, Wave type, double freq, double detune, int dest, double start, double end) {
    const int o = tone.osc(type, static_cast<float>(freq), static_cast<float>(detune), start, end);
    tone.connect(o, dest);
    return o;
}
inline int gain(SynthTone& tone, double value, int dest) {
    const int g = tone.gain(static_cast<float>(value));
    tone.connect(g, dest);
    return g;
}

} // namespace btg::detail
