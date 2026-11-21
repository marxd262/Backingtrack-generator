#pragma once

#include <string>

namespace btg {

// The track format's defaults and checks, ported from src/core/track.js (and what it reads: voices.js, layers.js, form.js, music.js,
// chords.js). Both take the track as JSON text and give JSON text; text that is no JSON counts as `null`. Neither throws.
// Not used by the engine yet: native/core/tests/test_logic.cpp holds them equal to the web app's functions.

// normalizeTrack(): the track with meter, length (the form's, when it has a valid one), layers, jobs, tags and seed filled in, as a JSON object.
std::string normalizeTrack(const std::string& trackJson);

// validateTrack(): a JSON list of { "code", "params" } in the order the web app reports them; "[]" means the track is valid.
// The codes are VALIDATION_CODES of track.js (the web app also reports badLoose and badOrnaments).
std::string validateTrack(const std::string& trackJson);

} // namespace btg
