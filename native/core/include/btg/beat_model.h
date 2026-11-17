#pragma once

#include "btg/analysis.h"

#include <functional>
#include <string>

namespace btg {

// Beats and bar starts of a track from the Beat This! model (Foscarin, Schlüter, Widmer 2024; code and weights MIT),
// run through ONNX Runtime. `modelPath` (UTF-8) is the ONNX file that native/tools/get-models.mjs downloads.
// Returns an empty grid when the model is missing or fails (the reason in `error`) or when `progress` returns
// false; the analysis then finds the beats itself.
Grid findBeats(const float* mono, size_t frames, double sampleRate, const std::string& modelPath,
               const std::function<bool(double)>& progress = {}, std::string* error = nullptr);

} // namespace btg
