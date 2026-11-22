#include "harmony.h"
#include "generator_internal.h" // Rng (createRng), jsRound and r6 (Math.round)

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <vector>

extern const unsigned char btg_music_json[]; // native/core/data/music.json, embedded by CMake
extern const unsigned int btg_music_json_size;

namespace btg::detail {
namespace {

// ---------- the tables (music.json, written by native/tools/export-events.mjs --data) ----------

struct ChordInfo { std::vector<int> intervals; std::vector<std::string> on; }; // CHORDS (chords.js)
struct StyleColors { std::string chordColor, chordColorAlt; };                   // a style's own; empty = it has none
struct Data {
    std::map<std::string, ChordInfo> chords;
    std::map<std::string, int> dominant;                                         // MODES[mode].dominant (music.js)
    std::map<std::string, std::vector<std::vector<int>>> progressions;           // PROGRESSION_TEMPLATES: mode -> the degrees of each template
    std::map<std::string, std::map<std::string, std::string>> colors;            // TABLE (harmony.js): colour -> base -> quality
    std::map<std::string, std::string> dominantColors;                           // DOMINANT: colour -> quality of the dominant
    std::map<std::string, StyleColors> styles;                                   // STYLE_PRESETS' chordColor and chordColorAlt
    std::map<std::string, std::vector<int>> scales;                              // SCALES (music.js)
    std::vector<double> standardTuning;                                          // STANDARD_TUNING (fretboard.js)
    double frets = 0;                                                            // FRETS
    std::vector<std::string> degrees, roman;                                     // DEGREES, ROMAN
};

const Data& data() {
    static const Data table = [] {
        // a bad embedded file throws: that is a build error, not a user error
        const Json j = Json::parse(btg_music_json, btg_music_json + btg_music_json_size);
        Data d;
        for (const auto& [id, c] : j.at("chords").items()) d.chords[id] = { c.at("intervals").get<std::vector<int>>(), c.at("on").get<std::vector<std::string>>() };
        for (const auto& [id, m] : j.at("modes").items()) d.dominant[id] = m.at("dominant").get<int>();
        for (const auto& [mode, templates] : j.at("progressions").items())
            for (const auto& t : templates) d.progressions[mode].push_back(t.at("degrees").get<std::vector<int>>());
        for (const auto& [color, row] : j.at("chordColors").at("table").items()) d.colors[color] = row.get<std::map<std::string, std::string>>();
        d.dominantColors = j.at("chordColors").at("dominant").get<std::map<std::string, std::string>>();
        for (const auto& [id, s] : j.at("styleColors").items())
            d.styles[id] = { s.value("chordColor", std::string()), s.value("chordColorAlt", std::string()) };
        for (const auto& [id, steps] : j.at("scales").items()) d.scales[id] = steps.get<std::vector<int>>();
        const Json& fretboard = j.at("fretboard");
        d.standardTuning = fretboard.at("standardTuning").get<std::vector<double>>();
        d.frets = fretboard.at("frets").get<double>();
        d.degrees = fretboard.at("degrees").get<std::vector<std::string>>();
        d.roman = fretboard.at("roman").get<std::vector<std::string>>();
        return d;
    }();
    return table;
}

// ---------- JavaScript's values ----------

const Json* own(const Json& object, const char* key) { // an own property of what was parsed from JSON; only an object has them
    if (!object.is_object()) return nullptr;
    const auto found = object.find(key);
    return found == object.end() ? nullptr : &*found;
}
const Json* own(const Json* object, const char* key) { return object == nullptr ? nullptr : own(*object, key); }
Json valueOf(const Json* v) { return v == nullptr ? Json() : *v; } // undefined as null

bool isIntegerNumber(double d) { return std::isfinite(d) && std::floor(d) == d; } // Number.isInteger
bool isInteger(const Json& v) { return v.is_number() && isIntegerNumber(v.get<double>()); }
double jsMod(double a, double b) { return std::fmod(a, b); }                        // a % b: the sign of a
double mod12(double n) { return jsMod(jsMod(n, 12) + 12, 12); }
double jsMax(double a, double b) { return std::isnan(a) || std::isnan(b) ? NAN : std::max(a, b); } // Math.max

[[noreturn]] void thrown(const char* what) { throw std::invalid_argument(what); } // where the web app throws a TypeError or an Error

} // namespace

// createRng(seed): the seed as an unsigned 32-bit integer (seed >>> 0); a missing seed or null counts as 0, as in the web app (declared in harmony.h: form_roll.cpp reads it too).
// shortcut: the coercions of JavaScript are not rebuilt for values no caller sends (a text, true or a list as seed: `>>> 0` makes 5, 1, 5 of them); they throw
// std::invalid_argument instead of differing silently. Upgrade: when a track from a file with other types in `seed` is loaded (validateTrack does not check it).
uint32_t seedBase(const Json& seed) {
    if (seed.is_null()) return 0;
    if (!seed.is_number()) thrown("the seed is a number");
    const double d = seed.get<double>();
    if (!std::isfinite(d)) return 0;
    const double m = jsMod(std::trunc(d), 4294967296.0);
    return static_cast<uint32_t>(m < 0 ? m + 4294967296.0 : m);
}

namespace {

const ChordInfo* chordSpec(const std::string& quality) { // Object.hasOwn(CHORDS, quality): the key is the quality as a text
    const auto found = data().chords.find(quality);
    return found == data().chords.end() ? nullptr : &found->second;
}

// music.js noteToPc(chord.root); `chord` null or undefined throws, anything but an object has no root
int rootPc(const Json* chord) {
    if (chord == nullptr || chord->is_null()) thrown("Cannot read properties of undefined");
    return noteToPcOf(valueOf(own(*chord, "root")));
}

// a.quality === b.quality: objects and lists are the same only if they are the same object
bool strictEqual(const Json* a, const Json* b) {
    if (a == nullptr || b == nullptr) return a == b;
    if (a->is_structured() || b->is_structured()) return a == b;
    return *a == *b;
}
// fretboard.js sameChord
bool sameChord(const Json* a, const Json* b) { return rootPc(a) == rootPc(b) && strictEqual(own(a, "quality"), own(b, "quality")); }

} // namespace

// ---------- form.js: chordIndex and sectionAt on JSON ----------

std::optional<SectionHit> sectionAt(const Json& form, double bar) {
    const Json* sections = own(form, "sections");
    if (sections == nullptr || !sections->is_array() || !isIntegerNumber(bar) || bar < 0) return std::nullopt;
    double start = 0;
    for (size_t index = 0; index < sections->size(); ++index) {
        const Json* bars = own((*sections)[index], "bars");
        if (bars == nullptr || !isInteger(*bars) || bars->get<double>() < 1) return std::nullopt;
        if (bar < start + bars->get<double>()) return SectionHit { index, bar - start };
        start += bars->get<double>();
    }
    return std::nullopt;
}

ChordIndex::ChordIndex(const Json& bars, const Json& form) : count_(static_cast<double>(bars.size())) {
    if (!isValidFormValue(form)) return;
    double start = 0; // a valid form's parts all have whole bars of at least 1, so sectionAt meets no part that stops it
    for (const Json& section : form.at("sections")) ends_.push_back(start += section.at("bars").get<double>());
}

double ChordIndex::operator()(double barIndex) const {
    if (ends_.empty()) return jsMod(barIndex, count_); // no valid form (a valid one has at least one part)
    const double bar = jsMod(barIndex, ends_.back()); // formLength: the end of the last part
    if (isIntegerNumber(bar) && bar >= 0)              // sectionAt: none for what is no index
        for (size_t i = 0; i < ends_.size(); ++i) if (bar < ends_[i]) return jsMod(bar - (i ? ends_[i - 1] : 0), count_);
    return jsMod(barIndex, count_);
}

namespace {

// bars[i], or none where that is undefined
const Json* barAt(const Json& bars, double i) { return isIntegerNumber(i) && i >= 0 && i < static_cast<double>(bars.size()) ? &bars[static_cast<size_t>(i)] : nullptr; }
// bars[chordIndex(track, i)].chord, where bars[...] must exist (the web app's TypeError otherwise); the chord itself may be undefined
const Json* chordOfBar(const Json& bars, const ChordIndex& index, double i) {
    const Json* bar = barAt(bars, index(i));
    if (bar == nullptr || bar->is_null()) thrown("Cannot read properties of undefined (reading 'chord')");
    return own(*bar, "chord");
}

// the track's bars (an array, or the web app's TypeError) and form (missing is null)
const Json& barsOf(const Json& track) {
    const Json* bars = own(track, "bars");
    if (bars == nullptr || !bars->is_array()) thrown("bars is not a list");
    return *bars;
}
Json formOf(const Json& track) { return valueOf(own(track, "form")); }

} // namespace

// ---------- progressions.js ----------

Json progressionFor(const Json& key, const Json& seed) {
    const Json chords = allowedChords(key);
    Rng rng(seedBase(seed));
    const auto templates = data().progressions.find(jsStringOf(own(key, "mode")));
    if (templates == data().progressions.end()) thrown("no progression for the mode");
    const std::vector<int>& degrees = rng.pick(templates->second);
    Json out = Json::array();
    for (const int i : degrees) out.push_back(static_cast<size_t>(i) < chords.size() ? chords[static_cast<size_t>(i)] : Json::object()); // {...undefined} is {}
    return out;
}

// ---------- harmony.js ----------

namespace {

// stepBase(chord, key): the base (maj, min, dim) of the step the chord belongs to in the key, none for an unknown quality or a root that is no step; throws like the JavaScript
std::optional<std::string> stepBase(const Json& chord, const Json& key) {
    if (chord.is_null()) thrown("Cannot read properties of null (reading 'quality')");
    const ChordInfo* spec = chordSpec(jsStringOf(own(chord, "quality")));
    if (spec == nullptr) return std::nullopt;
    const int pc = rootPc(&chord);
    // diatonicChords(key).find: allowedChords adds the major dominant in minor at the end, with the root of the fifth step, which `find` meets first
    for (const Json& step : allowedChords(key))
        if (noteToPcOf(step.at("root")) == pc) return spec->on.size() == 1 ? spec->on[0] : step.at("quality").get<std::string>();
    return std::nullopt;
}

} // namespace

Json colorChord(const Json& chord, const Json& color, const Json& key) {
    const std::string colorName = jsStringOf(&color);
    const auto table = data().colors.find(colorName);
    if (table == data().colors.end()) return spreadValue(chord);
    try {
        const std::optional<std::string> base = stepBase(chord, key);
        if (!base) return spreadValue(chord);
        bool dominant = false;
        if (*base == "maj" && data().dominantColors.count(colorName)) {
            const std::string mode = jsStringOf(own(key, "mode"));
            dominant = rootPc(&chord) == noteToPcOf(allowedChords(key).at(static_cast<size_t>(data().dominant.at(mode))).at("root"));
        }
        return Json::object({ { "root", valueOf(own(chord, "root")) }, { "quality", dominant ? data().dominantColors.at(colorName) : table->second.at(*base) } });
    } catch (const std::exception&) { // the web's guards: whatever the lookups throw leaves the chord as it is
        return spreadValue(chord);
    }
}

// shortcut: the keys of a bar (and of a chord) keep the order of the input, where the web's spread puts integer-like keys first; bars carry named fields only,
// upgrade: when an object with integer-like keys is passed and a caller reads the order of its keys.
Json colorProgression(const Json& bars, const Json& color, const Json& key) {
    if (!bars.is_array()) thrown("bars.map is not a function");
    Json out = Json::array();
    for (const Json& bar : bars) {
        if (bar.is_null()) thrown("Cannot read properties of null (reading 'chord')");
        Json colored = spreadValue(bar);
        colored["chord"] = colorChord(valueOf(own(bar, "chord")), color, key);
        out.push_back(std::move(colored));
    }
    return out;
}

// ---------- tags.js ----------

// shortcut: takes the style's id and looks the colours up in the built-in table (music.json), not a preset object; a chordColor of "" counts as none (the web's `??` keeps it),
// upgrade: when a style can come from outside STYLE_PRESETS (then pass its colours in).
std::string styleChordColor(const Json& style, const Json& seed, bool variety) {
    const StyleColors* preset = nullptr;
    if (style.is_string()) {
        const auto found = data().styles.find(style.get<std::string>());
        if (found != data().styles.end()) preset = &found->second;
    }
    const std::string color = preset != nullptr && !preset->chordColor.empty() ? preset->chordColor : "triads";
    if (variety && preset != nullptr && !preset->chordColorAlt.empty() && Rng(seedBase(seed)).fork("chordColor").next() < 0.25) return preset->chordColorAlt;
    return color;
}

// ---------- timeline.js ----------

Json chordTimeline(const Json& input) {
    const Json track = normalizedTrack(input);
    // shortcut: the exception carries no list of errors (the web's has `.errors`), upgrade: when a caller shows them (it can call validateTrack itself now)
    if (!trackErrors(track).empty()) thrown("Invalid track"); // checkedTrack
    // barTimeline also holds the meter's grid, the next chord, the steps and the end of each bar; chordTimeline reads none of them
    const Json& bars = track.at("bars");
    const Json form = formOf(track);
    const double bpm = track.at("bpm").get<double>(), length = track.at("length").get<double>();
    const ChordIndex chordIndex(bars, form);
    double startBeat = 0;
    Json out = Json::array();
    for (double index = 0; index < length; ++index) {
        const Json& bar = *barAt(bars, chordIndex(index));
        const double beats = bar.at("beats").get<double>();
        out.push_back(Json::object({ { "time", r6((startBeat * 60) / bpm) }, { "bar", static_cast<size_t>(index) },{ "chord", spreadValue(bar.at("chord")) }, { "durationSec", r6((beats * 60) / bpm) } }));
        startBeat += beats;
    }
    return out;
}

// ---------- fretboard.js ----------

namespace {

// the pitch classes of the chord's tones; no, an invalid or an unknown chord gives none
std::vector<double> chordPcs(const Json& chord) {
    if (!chord.is_object()) return {}; // what is no object has no root: noteToPc throws in the web app, and the catch gives []
    const ChordInfo* spec = chordSpec(jsStringOf(own(chord, "quality")));
    int pc = 0;
    try { pc = rootPc(&chord); } catch (const std::invalid_argument&) { return {}; }
    if (spec == nullptr) return {};
    std::vector<double> out;
    for (const int interval : spec->intervals) out.push_back((12 * (3 + 1) + pc + interval) % 12); // chordMidi(chord, 3).map((m) => m % 12)
    return out;
}
bool includes(const std::vector<double>& list, double pc) { return std::find(list.begin(), list.end(), pc) != list.end(); }

} // namespace

std::string degreeLabel(const Json& key, double pc) {
    const double index = mod12(pc - noteToPcOf(valueOf(own(key, "root"))));
    // shortcut: a pitch class that is no integer throws (the web app answers undefined, which no JSON can hold), upgrade: when a caller has pitch classes that are no integers
    if (!isIntegerNumber(index)) thrown("no degree for a pitch class that is no integer");
    return data().degrees.at(static_cast<size_t>(index));
}

Json fretboardNotes(const Json& options) {
    if (options.is_null()) thrown("Cannot destructure"); // fretboardNotes(undefined)
    const Json key = valueOf(own(options, "key"));
    if (!isValidKeyValue(key)) return Json::array();
    const auto scale = data().scales.find(jsStringOf(own(options, "scale")));
    if (scale == data().scales.end()) return Json::array(); // SCALES[scale].map is not a function: the web app's catch
    std::vector<double> scaleSet;
    for (const int step : scale->second) scaleSet.push_back((noteToPcOf(key.at("root")) + step) % 12);
    const std::vector<double> cur = chordPcs(valueOf(own(options, "current"))), nxt = chordPcs(valueOf(own(options, "next")));
    const double curRoot = cur.empty() ? NAN : cur[0]; // the root is the first tone (undefined without a chord: nothing equals it)

    // the defaults apply to a missing value only: a tuning that is null has no forEach
    // shortcut: a tuning entry that is no number, and frets that is neither a number nor null, throw (the web's `open + fret` and `fret <= frets` coerce them),
    // upgrade: when a tuning or a fret count from a file with other types is loaded; the web UI never passes either.
    std::vector<double> tuning = data().standardTuning;
    if (const Json* given = own(options, "tuning")) {
        if (!given->is_array()) thrown("tuning.forEach is not a function");
        tuning.clear();
        for (const Json& open : *given) {
            if (!open.is_number()) thrown("the open strings are numbers");
            tuning.push_back(open.get<double>());
        }
    }
    double frets = data().frets;
    if (const Json* given = own(options, "frets")) {
        if (given->is_null()) frets = 0; // fret <= null compares with 0
        else if (given->is_number()) frets = given->get<double>();
        else thrown("frets is a number");
    }

    const char* const* names = spelledNames(key);
    Json notes = Json::array();
    for (size_t string = 0; string < tuning.size(); ++string) {
        for (int fret = 0; fret <= frets; ++fret) {
            const double pc = mod12(tuning[string] + fret);
            const bool inScale = includes(scaleSet, pc), isCur = includes(cur, pc), isNext = includes(nxt, pc);
            if (!inScale && !isCur && !isNext) continue;
            std::string degree = degreeLabel(key, pc); // throws for a pitch class that is no whole number, so `pc` below is one
            // built in place (as ObjectBuilder::build does), not with Json::object({ ... }), which is several times slower: the session asks for the notes 30 times a second
            Json note = Json::object();
            auto& members = static_cast<std::vector<std::pair<const std::string, Json>>&>(*note.get_ptr<Json::object_t*>());
            members.reserve(9);
            members.emplace_back("string", string);
            members.emplace_back("fret", fret);
            members.emplace_back("pc", static_cast<int>(pc)); // whole: a text of the notes writes it without a fraction
            members.emplace_back("name", names[static_cast<size_t>(pc)]);
            members.emplace_back("degree", std::move(degree));
            members.emplace_back("scale", inScale);
            members.emplace_back("current", isCur);
            members.emplace_back("next", isNext);
            members.emplace_back("root", isCur && pc == curRoot);
            notes.push_back(std::move(note));
        }
    }
    return notes;
}

Json nextDistinctChord(const Json& bars, const Json& length, const Json& barIndex, const Json& form) {
    if (!bars.is_array() || bars.empty() || !isInteger(length) || length.get<double>() < 1) return Json();
    const double count = length.get<double>();
    const double start = isInteger(barIndex) && barIndex.get<double>() > 0 ? jsMod(barIndex.get<double>(), count) : 0;
    try { // a bar that is no chord: no result instead of an exception
        const ChordIndex index(bars, form);
        const Json* cur = chordOfBar(bars, index, start);
        for (double step = 1; step < count; ++step) {
            const Json* c = chordOfBar(bars, index, jsMod(start + step, count));
            if (!sameChord(cur, c)) return *c;
        }
    } catch (const std::exception&) { // the web's catch-all
    }
    return Json();
}

Json progressionRoles(const Json& track, const Json& bar) {
    if (track.is_null()) thrown("Cannot destructure");
    const Json& bars = barsOf(track);
    const Json form = formOf(track);
    // shortcut: a `bar` that is a text or other non-number, and a `length` that is neither a number nor null, throw (the web's `from + step` and Math.max coerce them),
    // upgrade: when a track from a file with other types is shown; the web UI hands null or an integer bar and a numeric length.
    if (!bar.is_null() && !bar.is_number()) thrown("bar is a number or null");
    const double from = bar.is_null() ? 0 : bar.get<double>();
    std::vector<std::string> roles(bars.size(), "later");
    const ChordIndex chordIndex(bars, form);
    const double nowIdx = chordIndex(from);
    if (barAt(bars, nowIdx) != nullptr) roles[static_cast<size_t>(nowIdx)] = "now"; // another property of the array is no entry of the list
    const Json* length = own(track, "length");
    if (length != nullptr && !length->is_null() && !length->is_number()) thrown("length is a number");
    const double total = length == nullptr ? NAN : length->is_null() ? 1 : jsMax(length->get<double>(), 1);
    for (double step = 1; step < total; ++step) {
        const double i = chordIndex(jsMod(from + step, total));
        if (i == nowIdx) continue; // the same entry (a single chord): stays now
        if (barAt(bars, i) == nullptr || barAt(bars, nowIdx) == nullptr) thrown("Cannot read properties of undefined (reading 'chord')");
        if (!sameChord(own(*barAt(bars, i), "chord"), own(*barAt(bars, nowIdx), "chord"))) {
            if (roles[static_cast<size_t>(i)] == "later") roles[static_cast<size_t>(i)] = "next";
            break;
        }
        roles[static_cast<size_t>(i)] = "hold";
    }
    return Json(roles);
}

std::string romanDegree(const Json& key, const Json& chord) {
    const int pc = rootPc(&chord);
    const double index = mod12(pc - noteToPcOf(valueOf(own(key, "root"))));
    std::string numeral = data().roman.at(static_cast<size_t>(index));
    const std::string quality = jsStringOf(own(chord, "quality"));
    const ChordInfo* spec = chordSpec(quality);
    if (spec == nullptr && isObjectPrototypeNameOf(quality)) thrown("Cannot read properties of undefined (reading 'includes')"); // CHORDS['toString'].intervals
    if (spec != nullptr && std::find(spec->intervals.begin(), spec->intervals.end(), 3) != spec->intervals.end())
        for (char& c : numeral) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c | 0x20); // ASCII only: std::tolower follows the C locale
    return numeral;
}

Json beatsUntilChange(const Json& track, double songSec) {
    if (track.is_null()) thrown("Cannot destructure");
    const Json& bars = barsOf(track);
    const Json form = formOf(track);
    const Json* lengthValue = own(track, "length");
    const Json* bpmValue = own(track, "bpm");
    // shortcut: a length that is a text, no `bpm` or one that is no number, and (in `dur`) a bar without a numeric `beats` throw (the web goes on with NaN or a coerced text),
    // upgrade: when a track from a file with other types is played; the web UI hands a normalised track and a numeric tempo.
    if ((lengthValue != nullptr && !lengthValue->is_null() && !lengthValue->is_number()) || bpmValue == nullptr || !bpmValue->is_number()) thrown("length and bpm are numbers");
    // no length (undefined or null) makes no bars, and every comparison with it is false: the same as NaN
    const double length = lengthValue == nullptr || lengthValue->is_null() ? NAN : lengthValue->get<double>(), bpm = bpmValue->get<double>();
    const ChordIndex index(bars, form);
    const auto dur = [&](double i) {
        const Json* bar = barAt(bars, index(i));
        const Json* beats = own(bar, "beats");
        if (beats == nullptr || !beats->is_number()) thrown("Cannot read properties of undefined (reading 'beats')");
        return (beats->get<double>() * 60) / bpm;
    };
    // Array.from({ length }, ...).reduce((a, b) => a + b, 0): the list has floor(length) entries (none for a length below 1)
    double loopSec = 0;
    for (double i = 0; i + 1 <= length; ++i) loopSec += dur(i);
    const double pos = jsMod(jsMod(songSec, loopSec) + loopSec, loopSec);
    double bar = 0, start = 0;
    while (bar < length - 1 && start + dur(bar) <= pos) start += dur(bar++);
    const Json* cur = chordOfBar(bars, index, bar);
    double end = start + dur(bar);
    for (double step = 1; step < length; ++step) {
        const double i = jsMod(bar + step, length);
        if (!sameChord(cur, chordOfBar(bars, index, i))) return jsMax(1, std::ceil(((end - pos) * bpm) / 60 - 1e-9));
        end += dur(i);
    }
    return Json();
}

} // namespace btg::detail
