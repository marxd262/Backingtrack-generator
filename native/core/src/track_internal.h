#pragma once

// The helpers of normalizeTrack and validateTrack (btg/track.h) on JSON values, one function for each of the web app's: completeVoices
// (voices.js), completeJobs (layers.js), checkForm and normalizeForm (form.js), allowedChords and chordOptions (music.js), chordName
// (chords.js). They follow the JavaScript's semantics on any JSON value (typeof, truthiness, coercion in a string) and its names, so that
// native/core/tests/test_logic.cpp can compare them with the web app one by one. Control thread only.
//
// A value is nlohmann::ordered_json: where the JavaScript walks the keys of an object it got, the order is the text's order, and the
// default json would sort them. A missing property ("undefined") is a null pointer where a function takes `const Json*`.

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

namespace btg::detail {

using Json = nlohmann::ordered_json;

// voices.js: per layer { id, variant }; what is missing or invalid gets the default (the first sample variant), a valid voice with no or an
// invalid variant its first variant, a removed voice (chords sample/organ) its successor. A new object.
Json completeVoices(const Json& voices);
// layers.js: per layer with jobs the given job when it is one, else the first. A new object.
Json completeJobs(const Json& jobs);
// form.js: calls add("badForm", { reason }) once for each reason, in the order of the web app; null (or missing) is valid.
void checkForm(const Json& form, const std::function<void(const char* code, Json params)>& add);
// form.js: a copy with the default feel and only known fields. `undefined` (a discarded value, is_discarded()) for null, anything that is not an object stays.
Json normalizeForm(const Json& form);
// music.js: the chords of the key, the diatonic ones (plus the major dominant in minor), as a list of { root, quality }.
// Throws std::invalid_argument where the JavaScript throws (a key without a note name as root or without a known mode).
Json allowedChords(const Json& key);
// music.js: a list of { root, qualities } for the key, qualities in the register's order. Throws like allowedChords.
Json chordOptions(const Json& key);
// chords.js: the root and the symbol of the quality, as the JavaScript concatenates them: a string, or null where it makes a NaN.
// Throws std::invalid_argument for a quality the register does not have.
Json chordName(const Json& chord);

// What harmony.cpp takes from the helpers of track.cpp; each answers as the JavaScript's does.
int noteToPcOf(const Json& name);                    // music.js noteToPc (generator_internal.h has a lenient one of its own); throws std::invalid_argument for what is no note name
bool isValidKeyValue(const Json& key);               // music.js isValidKey
const char* const* spelledNames(const Json& key);    // music.js spelling: the twelve names of the key's spelling; throws like diatonicChords
bool isValidFormValue(const Json& form);             // form.js isValidForm
double formLengthOf(const Json& form);               // form.js formLength
std::string jsStringOf(const Json* v);               // String(v); a null pointer is undefined
bool isObjectPrototypeNameOf(const std::string& name); // 'toString', 'constructor' ...: a name every object has, which `CHORDS[name]` finds although the register has no such entry
Json spreadValue(const Json& source);                // {...source}
Json normalizedTrack(const Json& track);             // track.js normalizeTrack
Json trackErrors(const Json& track);                 // track.js validateTrack: the list of errors

} // namespace btg::detail
