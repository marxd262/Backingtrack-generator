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
#include <unordered_map>
#include <utility>
#include <vector>

namespace btg::detail {

using Json = nlohmann::ordered_json;

// An object built member by member in linear time: ordered_json's operator[] looks a key up by a linear search, so an object of n members costs n squared (80,000
// keys took seconds). Up to SMALL members a linear search is cheaper than a hash index; beyond, the index is built. set(): a key twice keeps the last value at the first
// one's place (JSON.parse). append(): the caller knows the key is new. build(): the object, once.
class ObjectBuilder {
public:
    ObjectBuilder() = default;
    explicit ObjectBuilder(Json&& existing) { // the members of an object, kept in order
        if (existing.is_object()) for (auto it = existing.begin(); it != existing.end(); ++it) append(it.key(), std::move(it.value()));
    }
    void append(std::string key, Json value) {
        if (!index_.empty()) index_.emplace(key, items_.size());
        items_.emplace_back(std::move(key), std::move(value));
        if (index_.empty() && items_.size() == SMALL) for (size_t i = 0; i < items_.size(); ++i) index_.emplace(items_[i].first, i);
    }
    void set(std::string key, Json value) {
        if (index_.empty()) {
            for (auto& item : items_) if (item.first == key) { item.second = std::move(value); return; }
        } else {
            const auto found = index_.find(key);
            if (found != index_.end()) { items_[found->second].second = std::move(value); return; }
        }
        append(std::move(key), std::move(value));
    }
    Json build() {
        Json out = Json::object();
        // ordered_map is a std::vector of pairs: appending to it directly skips the search that its own insert does
        auto& members = static_cast<std::vector<std::pair<const std::string, Json>>&>(*out.get_ptr<Json::object_t*>());
        members.reserve(items_.size());
        for (auto& item : items_) members.emplace_back(std::move(item.first), std::move(item.second));
        items_.clear();
        index_.clear();
        return out;
    }

private:
    static constexpr size_t SMALL = 16;
    std::vector<std::pair<std::string, Json>> items_;
    std::unordered_map<std::string, size_t> index_;
};

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
// music.js diatonicChords: the chords of the key's steps in the key's spelling, as a list of { root, quality }. Throws like allowedChords.
Json diatonicChordsOf(const Json& key);
// chords.js chordShort: the root and the short symbol of the quality (its symbol where it has none). Domain: a chord of the register (else it throws).
std::string chordShort(const Json& chord);

// What harmony.cpp and form_roll.cpp take from the helpers of track.cpp; each answers as the JavaScript's does.
const Json& musicTable();                            // native/core/data/music.json, parsed once (the tables of the web app, written by export-events.mjs --data)
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
Json parsedText(const std::string& text);            // JSON.parse as track.cpp reads a track's text (see its Reader); text that is no JSON, or nests deeper than 64 levels, is null

} // namespace btg::detail
