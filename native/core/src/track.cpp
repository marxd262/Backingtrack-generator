#include "btg/track.h"
#include "track_internal.h"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <map>
#include <set>
#include <stdexcept>
#include <utility>
#include <vector>

extern const unsigned char btg_music_json[]; // native/core/data/music.json, embedded by CMake
extern const unsigned int btg_music_json_size;
extern const unsigned char btg_grooves_json[]; // native/core/data/grooves.json
extern const unsigned int btg_grooves_json_size;

namespace btg::detail {
namespace {

// ---------- the tables (music.json, written by native/tools/export-events.mjs --data) ----------

struct Voice { std::string id; std::vector<std::string> variants; };
struct LayerSpec { std::string id; bool defaultOn; std::vector<std::string> jobs; };
struct ChordSpec { std::string id, symbol; std::vector<std::string> on; };
struct Mode { std::vector<int> steps; std::vector<std::string> qualities; int parentMajor; };
struct Tag { std::string id; std::vector<std::string> tags; };
struct Music {
    std::vector<std::pair<std::string, std::vector<Voice>>> voices;                           // VOICES: layer -> voices, in register order
    std::map<std::string, std::map<std::string, std::pair<std::string, std::string>>> moved;  // MOVED: layer -> "id/variant" -> { id, variant }
    std::vector<LayerSpec> layers;                                                            // LAYERS in order
    std::vector<ChordSpec> chords;                                                            // CHORDS in register order
    std::map<std::string, Mode> modes;                                                        // MODES
    std::set<std::string> meters, grooves;                                                    // keys of METERS and GROOVES
    std::vector<Tag> tags;                                                                    // TAG_CATEGORIES
    std::vector<std::string> partTypes, transitions;                                          // form-types.js
    double parts = 0, bars = 0, length = 0, levelMin = 0, levelMax = 0, densityMin = 0, densityMax = 0, dynamicsMax = 0; // FORM_LIMITS, DYNAMICS_MAX
    std::vector<std::pair<std::string, double>> feelDefaults;                                 // FEEL_DEFAULTS in order
};

const Json& musicJson() {
    // a bad embedded file throws: that is a build error, not a user error
    static const Json table = Json::parse(btg_music_json, btg_music_json + btg_music_json_size);
    return table;
}

const Music& music() {
    static const Music data = [] {
        const Json& j = musicJson();
        Music m;
        for (const auto& [layer, ids] : j.at("voices").items()) {
            auto& list = m.voices.emplace_back(layer, std::vector<Voice>()).second;
            for (const auto& [id, variants] : ids.items()) list.push_back({ id, variants.get<std::vector<std::string>>() });
        }
        for (const auto& [layer, moves] : j.at("movedVoices").items())
            for (const auto& [key, to] : moves.items()) m.moved[layer][key] = { to.at("id").get<std::string>(), to.at("variant").get<std::string>() };
        for (const auto& [id, l] : j.at("layers").items()) m.layers.push_back({ id, l.at("defaultOn").get<bool>(), l.at("jobs").get<std::vector<std::string>>() });
        for (const auto& [id, c] : j.at("chords").items()) m.chords.push_back({ id, c.at("symbol").get<std::string>(), c.at("on").get<std::vector<std::string>>() });
        for (const auto& [id, mode] : j.at("modes").items())
            m.modes[id] = { mode.at("steps").get<std::vector<int>>(), mode.at("qualities").get<std::vector<std::string>>(), mode.at("parentMajor").get<int>() };
        for (const auto& meter : j.at("meters")) m.meters.insert(meter.get<std::string>());
        for (const auto& category : j.at("tags")) m.tags.push_back({ category.at("id").get<std::string>(), category.at("tags").get<std::vector<std::string>>() });
        const Json& form = j.at("form");
        m.partTypes = form.at("partTypes").get<std::vector<std::string>>();
        m.transitions = form.at("transitions").get<std::vector<std::string>>();
        const Json& limits = form.at("limits");
        m.parts = limits.at("parts").get<double>(); m.bars = limits.at("bars").get<double>(); m.length = limits.at("length").get<double>();
        m.levelMin = limits.at("levelMin").get<double>(); m.levelMax = limits.at("levelMax").get<double>();
        m.densityMin = limits.at("densityMin").get<double>(); m.densityMax = limits.at("densityMax").get<double>();
        m.dynamicsMax = form.at("dynamicsMax").get<double>();
        for (const auto& [k, v] : form.at("feelDefaults").items()) m.feelDefaults.emplace_back(k, v.get<double>());
        const Json grooves = Json::parse(btg_grooves_json, btg_grooves_json + btg_grooves_json_size);
        for (auto it = grooves.begin(); it != grooves.end(); ++it) m.grooves.insert(it.key());
        return m;
    }();
    return data;
}

bool has(const std::vector<std::string>& list, const std::string& s) { return std::find(list.begin(), list.end(), s) != list.end(); }

// ---------- JavaScript's values ----------
// A property that is missing (undefined) is a null pointer; null, 0 and "" are values. Only the order of keys and the text of numbers need care.

using Val = const Json*;
using Add = std::function<void(const char*, Json)>;

Val own(const Json& object, const std::string& key) { // an own property of an object parsed from JSON; an array's named properties are none (its `length` is the caller's)
    if (!object.is_object()) return nullptr;
    const auto found = object.find(key);
    return found == object.end() ? nullptr : &*found;
}
bool isNullish(Val v) { return v == nullptr || v->is_null(); }                       // v == null
bool isString(Val v) { return v != nullptr && v->is_string(); }
bool isRecord(Val v) { return v != nullptr && v->is_object(); }                      // form.js, voices.js: an object that is no array
bool isObject(Val v) { return v != nullptr && (v->is_object() || v->is_array()); }  // track.js: also an array
bool isFinite(Val v) { return v != nullptr && v->is_number() && std::isfinite(v->get<double>()); } // Number.isFinite
bool isInteger(Val v) { return isFinite(v) && std::floor(v->get<double>()) == v->get<double>(); }  // Number.isInteger
bool isPosInt(Val v) { return isInteger(v) && v->get<double>() > 0; }
bool inRange(Val v, double lo, double hi) { return isFinite(v) && v->get<double>() >= lo && v->get<double>() <= hi; } // form.js

const char* typeOf(Val v) {
    if (v == nullptr) return "undefined";
    if (v->is_string()) return "string";
    if (v->is_number()) return "number";
    if (v->is_boolean()) return "boolean";
    return "object"; // null, array, object
}

// Number::toString (ECMAScript 6.1.6.1.20) from the shortest digits that read back as the same double
std::string jsNumber(double v) {
    if (std::isnan(v)) return "NaN";
    if (v == 0) return "0";
    if (std::isinf(v)) return v < 0 ? "-Infinity" : "Infinity";
    const std::string sign = v < 0 ? "-" : "";
    char buffer[64];
    // std::to_chars on double (the exact, locale-free shortest digits) needs libc++ 14 or later; on Apple a deployment target of macOS 13.3 or later
    const auto written = std::to_chars(buffer, buffer + sizeof buffer, std::fabs(v), std::chars_format::scientific);
    const std::string scientific(buffer, written.ptr);
    const size_t e = scientific.find('e');
    std::string digits;
    for (const char c : scientific.substr(0, e)) if (c != '.') digits += c;
    const int k = static_cast<int>(digits.size()), n = std::atoi(scientific.c_str() + e + 1) + 1;
    if (k <= n && n <= 21) return sign + digits + std::string(static_cast<size_t>(n - k), '0');
    if (0 < n && n <= 21) return sign + digits.substr(0, static_cast<size_t>(n)) + "." + digits.substr(static_cast<size_t>(n));
    if (-6 < n && n <= 0) return sign + "0." + std::string(static_cast<size_t>(-n), '0') + digits;
    const std::string exponent = std::string(n - 1 < 0 ? "-" : "+") + std::to_string(std::abs(n - 1));
    return sign + digits.substr(0, 1) + (k > 1 ? "." + digits.substr(1) : "") + "e" + exponent;
}

std::string jsString(Val v); // String(v), as `${v}` and `+` make it

// Array.prototype.join: null (and undefined) become the empty text
std::string jsJoin(const Json& array, const char* separator) {
    std::string out;
    for (size_t i = 0; i < array.size(); ++i) {
        if (i) out += separator;
        if (!array[i].is_null()) out += jsString(&array[i]);
    }
    return out;
}

std::string jsString(Val v) {
    if (v == nullptr) return "undefined";
    switch (v->type()) {
    case Json::value_t::null: return "null";
    case Json::value_t::boolean: return v->get<bool>() ? "true" : "false";
    case Json::value_t::string: return v->get<std::string>();
    case Json::value_t::array: return jsJoin(*v, ",");
    case Json::value_t::object: return "[object Object]";
    default: return jsNumber(v->get<double>());
    }
}

// track.js `show`: a parameter value without String(); numbers and texts stay, the rest becomes its name
Json show(Val v) {
    if (v != nullptr && (v->is_number() || v->is_string())) return *v;
    return v != nullptr && v->is_null() ? "null" : typeOf(v);
}

Json number(double v) { return std::floor(v) == v && std::fabs(v) < 9007199254740992.0 ? Json(static_cast<std::int64_t>(v)) : Json(v); }

// Object.entries order: the keys that are array indices (0 to 2^32 - 2, no leading zero) first, ascending, then the others as written
struct Entry { const std::string* key; const Json* value; };
bool isIndex(const std::string& key) {
    if (key.empty() || key.size() > 10 || (key.size() > 1 && key[0] == '0')) return false;
    for (const char c : key) if (c < '0' || c > '9') return false;
    return std::strtoull(key.c_str(), nullptr, 10) <= 4294967294ULL;
}
std::vector<Entry> entries(const Json& object) {
    std::vector<Entry> indices, others;
    for (auto it = object.begin(); it != object.end(); ++it) (isIndex(it.key()) ? indices : others).push_back({ &it.key(), &it.value() });
    std::stable_sort(indices.begin(), indices.end(), [](const Entry& a, const Entry& b) { return std::strtoull(a.key->c_str(), nullptr, 10) < std::strtoull(b.key->c_str(), nullptr, 10); });
    indices.insert(indices.end(), others.begin(), others.end());
    return indices;
}

// {...source}: an object's own keys, an array's indices, a string's UTF-16 code units; nothing else has any. A code unit that is half of a
// surrogate pair cannot be a UTF-8 text: it becomes U+FFFD (the web app's output keeps the lone surrogate, as an escape).
void spread(Json& out, Val source) {
    if (source == nullptr) return;
    ObjectBuilder members(std::move(out)); // linear in the number of keys
    if (source->is_object()) {
        for (const Entry& e : entries(*source)) members.set(*e.key, *e.value);
    } else if (source->is_array()) {
        for (size_t i = 0; i < source->size(); ++i) members.set(std::to_string(i), (*source)[i]);
    } else if (source->is_string()) {
        const std::string& s = source->get_ref<const std::string&>();
        size_t unit = 0;
        for (size_t at = 0; at < s.size(); ++unit) {
            const auto lead = static_cast<unsigned char>(s[at]);
            const size_t bytes = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
            if (bytes < 4) { members.set(std::to_string(unit), s.substr(at, bytes)); }
            else { members.set(std::to_string(unit), "\xEF\xBF\xBD"); members.set(std::to_string(++unit), "\xEF\xBF\xBD"); }
            at += bytes;
        }
    }
    out = members.build();
}

// ---------- voices.js ----------

const std::vector<std::string>* variantsOf(const std::string& layer, const std::string& id) {
    for (const auto& [name, list] : music().voices)
        if (name == layer) for (const Voice& v : list) if (v.id == id) return &v.variants;
    return nullptr;
}
bool isVoiceLayer(const std::string& layer) { return std::any_of(music().voices.begin(), music().voices.end(), [&](const auto& l) { return l.first == layer; }); }
// MOVED: the successor of a removed voice, or none
const std::pair<std::string, std::string>* movedTo(const std::string& layer, const std::string& id, const std::string& variant) {
    const auto moves = music().moved.find(layer);
    if (moves == music().moved.end()) return nullptr;
    const auto to = moves->second.find(id + "/" + variant);
    return to == moves->second.end() ? nullptr : &to->second;
}
// voices.js isVoice: the layer knows the voice `id` and, when `variant` is given, that variant (a removed voice with a successor counts as known)
bool isVoice(const std::string& layer, Val id, Val variant = nullptr) {
    if (!isString(id)) return false;
    const std::vector<std::string>* variants = variantsOf(layer, id->get<std::string>());
    if (variants == nullptr) return false;
    return variant == nullptr || (isString(variant) && (has(*variants, variant->get<std::string>()) || movedTo(layer, id->get<std::string>(), variant->get<std::string>()) != nullptr));
}

// ---------- layers.js ----------

const LayerSpec* layerOf(const std::string& id) { // Object.hasOwn(LAYERS, id)
    for (const LayerSpec& l : music().layers) if (l.id == id) return &l;
    return nullptr;
}
bool isJob(const std::string& layer, Val job) {
    const LayerSpec* spec = layerOf(layer);
    return spec != nullptr && isString(job) && has(spec->jobs, job->get<std::string>());
}

// ---------- form.js ----------

// the sum of the `bars` of the parts that are finite numbers
double formLength(Val form) {
    Val sections = isRecord(form) ? own(*form, "sections") : nullptr;
    double sum = 0;
    if (sections == nullptr || !sections->is_array()) return sum;
    for (const Json& s : *sections) {
        Val bars = own(s, "bars");
        sum += isFinite(bars) ? bars->get<double>() : 0.0;
    }
    return sum;
}

const std::vector<std::string> SECTION_KEYS { "type", "bars", "level", "density", "transition", "crash", "locked" };

// only the known own fields that are not null
Json pick(const Json& source, const std::vector<std::string>& keys) {
    Json out = Json::object();
    for (const std::string& k : keys) if (Val v = own(source, k); !isNullish(v)) out[k] = *v;
    return out;
}

bool isValidForm(const Json& form) {
    bool ok = form.is_object();
    if (ok) checkForm(form, [&](const char*, Json) { ok = false; });
    return ok;
}

// ---------- music.js, chords.js ----------

// music.js noteToPc; throws where the web app does, for anything that is no note name (A to G, then # or b)
int noteToPc(const std::string& s) {
    static const int LETTER_PC[7] { 9, 11, 0, 2, 4, 5, 7 }; // A to G
    if (s.empty() || s.size() > 2 || s[0] < 'A' || s[0] > 'G' || (s.size() == 2 && s[1] != '#' && s[1] != 'b')) throw std::invalid_argument("Unknown note name");
    return (LETTER_PC[s[0] - 'A'] + (s.size() == 2 ? (s[1] == '#' ? 1 : -1) : 0) + 12) % 12;
}
int noteToPc(Val name) { return noteToPc(isString(name) ? name->get<std::string>() : std::string()); }
bool isNoteName(Val name) {
    try { noteToPc(name); return true; } catch (const std::invalid_argument&) { return false; }
}
// MODES[mode], the web app's key lookup (also an array of one text counts as that text); none for a name that is no own entry
const Mode* modeOf(Val mode) {
    const auto found = music().modes.find(jsString(mode));
    return found == music().modes.end() ? nullptr : &found->second;
}
bool isValidKey(Val key) { return isObject(key) && isNoteName(own(*key, "root")) && isString(own(*key, "mode")) && modeOf(own(*key, "mode")) != nullptr; }

// the names every object inherits (Object.prototype): CHORDS[name] is no entry of the register, and not undefined either
bool isObjectPrototypeName(const std::string& name) {
    static const char* const INHERITED[] { "constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty", "__lookupGetter__", "__lookupSetter__",
                                           "isPrototypeOf", "propertyIsEnumerable", "toString", "valueOf", "__proto__", "toLocaleString" };
    return std::find(std::begin(INHERITED), std::end(INHERITED), name) != std::end(INHERITED);
}

using NamedChord = std::pair<std::string, std::string>; // root, quality

// music.js spelling: the twelve names of the key; a sign on the root counts, else the signature of the parent major key
const char* const* spelling(const Json& key, int root, const Mode* mode) {
    static const char* const SHARP_NAMES[12] { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
    static const char* const FLAT_NAMES[12] { "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B" };
    static const int FLAT_MAJOR_PCS[6] { 5, 10, 3, 8, 1, 6 }; // F, Bb, Eb, Ab, Db, Gb
    const char last = own(key, "root")->get_ref<const std::string&>().back();
    if (last == '#') return SHARP_NAMES;
    if (last == 'b') return FLAT_NAMES;
    if (mode == nullptr) throw std::invalid_argument("Unknown mode"); // MODES[key.mode].parentMajor
    return std::find(std::begin(FLAT_MAJOR_PCS), std::end(FLAT_MAJOR_PCS), (root + mode->parentMajor + 12) % 12) != std::end(FLAT_MAJOR_PCS) ? FLAT_NAMES : SHARP_NAMES;
}

std::vector<NamedChord> diatonicChords(const Json& key) {
    const int root = noteToPc(own(key, "root"));
    const Mode* mode = modeOf(own(key, "mode"));
    if (mode == nullptr) throw std::invalid_argument("Unknown mode");
    const char* const* names = spelling(key, root, mode);
    std::vector<NamedChord> chords;
    for (size_t i = 0; i < mode->steps.size(); ++i) chords.emplace_back(names[(root + mode->steps[i]) % 12], mode->qualities[i]);
    return chords;
}

// ---------- track.js ----------

constexpr double MIN_BPM = 20, MAX_BPM = 400, MAX_BEATS = 16;
const double MAX_LENGTH = 512;

// tags: missing/null or { category: [tag ids] }
void checkTags(Val tags, const Add& add) {
    if (isNullish(tags)) return;
    if (!isRecord(tags)) { add("badTags", Json::object()); return; }
    for (const Entry& e : entries(*tags)) {
        const std::string& category = *e.key;
        const auto known = std::find_if(music().tags.begin(), music().tags.end(), [&](const Tag& t) { return t.id == category; });
        if (known == music().tags.end() || !e.value->is_array()) { add("badTags", Json::object({ { "category", category } })); continue; }
        for (const Json& tag : *e.value)
            if (!isString(&tag) || !has(known->tags, tag.get<std::string>())) add("badTags", Json::object({ { "category", category }, { "tag", show(&tag) } }));
    }
}

// voices: missing/null or { layer: missing/null | id | { id?, variant? } }
void checkVoices(Val voices, const Add& add) {
    if (isNullish(voices)) return;
    if (!isRecord(voices)) { add("badVoice", Json::object({ { "layer", "?" }, { "voice", show(voices) } })); return; }
    for (const Entry& e : entries(*voices)) {
        const std::string& layer = *e.key;
        Val given = e.value;
        if (!isVoiceLayer(layer)) {
            add("badVoice", Json::object({ { "layer", layer }, { "voice", given->is_null() ? Json("?") : show(isObject(given) ? own(*given, "id") : given) } }));
            continue;
        }
        if (given->is_null()) continue;
        Val rec = isRecord(given) ? given : nullptr;
        Val id = rec ? own(*rec, "id") : given;
        Val variant = rec ? own(*rec, "variant") : nullptr;
        const bool ok = rec ? (id == nullptr ? variant == nullptr : isVoice(layer, id) && (variant == nullptr || isVoice(layer, id, variant))) : isVoice(layer, id);
        if (!ok) {
            const Json shownId = show(id), shownVariant = show(variant);
            add("badVoice", Json::object({ { "layer", layer }, { "voice", variant == nullptr ? shownId : Json(jsString(&shownId) + "/" + jsString(&shownVariant)) } }));
        }
    }
}

// jobs: missing/null or { layer: job }; a null job counts as missing
void checkJobs(Val jobs, const Add& add) {
    if (isNullish(jobs)) return;
    if (!isRecord(jobs)) { add("badJob", Json::object({ { "layer", "?" }, { "job", show(jobs) } })); return; }
    for (const Entry& e : entries(*jobs))
        if (!e.value->is_null() && !isJob(*e.key, e.value)) add("badJob", Json::object({ { "layer", *e.key }, { "job", show(e.value) } }));
}

// the defaults, over them the given jobs (null counts as missing); anything that is not an object stays, for validateTrack to report
Json normalizeJobs(Val jobs) {
    if (!isNullish(jobs) && !isRecord(jobs)) return *jobs;
    ObjectBuilder out(completeJobs(Json())); // linear in the number of keys (operator[] searches them one by one)
    if (isRecord(jobs)) for (const Entry& e : entries(*jobs)) if (!e.value->is_null()) out.set(*e.key, *e.value);
    return out.build();
}

Json validateTrackValue(const Json& track) {
    const Json none = Json::object();
    const Json& t = isObject(&track) ? track : none;
    Json errors = Json::array();
    const Add add = [&](const char* code, Json params) { errors.push_back(Json::object({ { "code", code }, { "params", std::move(params) } })); };
    const auto number01 = [&](const char* name, const char* code) { // missing or null counts as the default; else a finite number from 0 to 1
        Val v = own(t, name);
        if (!isNullish(v) && !inRange(v, 0, 1)) add(code, Json::object({ { name, show(v) } }));
    };

    Val bpm = own(t, "bpm");
    if (!inRange(bpm, MIN_BPM, MAX_BPM)) add("badBpm", Json::object({ { "bpm", show(bpm) } }));
    Json arrayLength;
    Val length = t.is_array() ? &(arrayLength = number(static_cast<double>(t.size()))) : own(t, "length"); // an array's length is its size
    if (!isPosInt(length) || length->get<double>() > MAX_LENGTH) add("badLength", Json::object({ { "length", show(length) } }));
    // meter: missing or null counts as 4/4; else one of the supported, as the text '2/4' in the message, '?' for what is not usable
    Val meter = own(t, "meter");
    if (!isNullish(meter)) {
        const bool pair = meter->is_array() && meter->size() == 2;
        const bool supported = pair && isInteger(&(*meter)[0]) && isInteger(&(*meter)[1]) && music().meters.count(jsString(&(*meter)[0]) + "/" + jsString(&(*meter)[1])) > 0;
        if (!supported) add("badMeter", Json::object({ { "meter", pair ? jsJoin(*meter, "/") : "?" } }));
    }
    Val groove = own(t, "groove");
    if (!isNullish(groove) && !(isString(groove) && music().grooves.count(groove->get<std::string>()) > 0)) add("badGroove", Json::object({ { "groove", show(groove) } }));
    number01("complexity", "badComplexity");
    number01("loose", "badLoose");
    number01("ornaments", "badOrnaments");
    checkVoices(own(t, "voices"), add);
    checkJobs(own(t, "jobs"), add);
    Val form = own(t, "form");
    checkForm(form == nullptr ? Json() : *form, add);
    Val key = own(t, "key");
    const bool keyOk = isValidKey(key);
    if (!keyOk) add("badKey", Json::object());
    checkTags(own(t, "tags"), add);
    Val bars = own(t, "bars");
    if (bars == nullptr || !bars->is_array() || bars->empty()) {
        add("emptyBars", Json::object());
        return errors;
    }

    // the key is not valid: no check of the chords against it, badKey is reported; else the steps of the key as (pitch class, base)
    std::vector<std::pair<int, std::string>> steps;
    if (keyOk) for (const Json& c : allowedChords(*key)) steps.emplace_back(noteToPc(&c.at("root")), c.at("quality").get<std::string>());

    for (size_t i = 0; i < bars->size(); ++i) {
        Val b = &(*bars)[i];
        const int bar = static_cast<int>(i) + 1;
        Val chord = isObject(b) ? own(*b, "chord") : nullptr;
        Val root = isObject(chord) ? own(*chord, "root") : nullptr;
        if (!isString(root)) { add("badBar", Json::object({ { "bar", bar } })); continue; }
        Val quality = own(*chord, "quality");
        const ChordSpec* spec = nullptr; // isChordQuality: only own entries of the register
        if (isString(quality)) for (const ChordSpec& c : music().chords) if (c.id == quality->get<std::string>()) spec = &c;
        const std::string rootName = root->get<std::string>();
        const Json shownQuality = show(quality);
        const std::string name = spec ? rootName + spec->symbol : rootName + jsString(&shownQuality);
        Val beats = own(*b, "beats");
        if (!isPosInt(beats) || beats->get<double>() > MAX_BEATS) add("badBeats", Json::object({ { "bar", bar }, { "beats", show(beats) } }));
        if (spec == nullptr) {
            add("unknownQuality", Json::object({ { "bar", bar }, { "chord", name } }));
        } else if (keyOk) {
            bool inKey = false;
            if (isNoteName(root)) {
                const int pc = noteToPc(root);
                for (const auto& [stepPc, base] : steps) inKey = inKey || (stepPc == pc && has(spec->on, base));
            }
            if (!inKey) add("chordNotInKey", Json::object({ { "bar", bar }, { "chord", name } }));
        }
    }
    return errors;
}

Json normalizeTrackValue(const Json& track) {
    const Json none = Json::object();
    const Json& t = isObject(&track) ? track : none; // structuredClone: the copy is the output's
    Json out = Json::object();
    spread(out, &t);
    // Songform: with a valid form the length is derived (the sum of the parts); without, everything stays as it was
    Val given = own(t, "form");
    const Json form = normalizeForm(given == nullptr ? Json() : *given);
    if (!form.is_discarded()) out["form"] = form;
    Val meter = own(t, "meter");
    out["meter"] = isNullish(meter) ? Json::array({ 4, 4 }) : *meter;
    Json arrayLength;
    Val length = t.is_array() ? &(arrayLength = number(static_cast<double>(t.size()))) : own(t, "length");
    if (isValidForm(form)) out["length"] = number(formLength(&form));
    else out["length"] = isNullish(length) ? Json(24) : *length;
    Json layers = Json::object();
    for (const LayerSpec& l : music().layers) layers[l.id] = l.defaultOn;
    spread(layers, own(t, "layers"));
    out["layers"] = layers;
    out["jobs"] = normalizeJobs(own(t, "jobs"));
    Val tags = own(t, "tags");
    out["tags"] = isNullish(tags) ? Json::object() : *tags;
    Val seed = own(t, "seed");
    out["seed"] = isNullish(seed) ? Json(1) : *seed;
    return out;
}

// JSON.parse, as far as the library's parser differs from it: a number that overflows is Infinity (the library refuses it), and a lone
// surrogate escape is accepted (it becomes U+FFFD: a UTF-8 text cannot hold it, where the web app keeps it). Every number is a double;
// as JSON.stringify writes it, one that is a whole number below 2^53 is an integer here. A key twice: the last value, the first place.
//
// Depth: the web's validateTrack takes any depth (its JSON.parse is not recursive), its normalizeTrack fails near 2000 levels (structuredClone
// throws a RangeError). The core's reader and the helpers below recurse, and 2000 levels do not fit a secondary thread's 512 KB stack on macOS or
// WebAssembly's default 64 KB; nothing the app reads nests beyond about 20. So nesting beyond MAX_DEPTH levels counts as no JSON, as `null`.
// shortcut: 64 levels, where the web takes more; lift it if a format ever nests deeper (then make the reader and jsString iterative).
//
// Two more places where the reader is not JSON.parse (profiles.h names them): a lone surrogate escape ("\ud83d") becomes U+FFFD (string(), below), and bytes that are no
// valid UTF-8 pass through unchanged where the web, which gets a decoded text, has U+FFFD for them.
// shortcut: the text is taken as UTF-8 and not checked, upgrade: when a shell hands the core texts it did not decode itself and a damaged file must read as the web reads it.
constexpr int MAX_DEPTH = 64;

class Reader {
public:
    explicit Reader(const std::string& text) : s(text) {}
    bool parse(Json& out) { return value(out) && (skip(), at == s.size()); }

private:
    const std::string& s;
    size_t at = 0;
    int depth = 0;

    void skip() { while (at < s.size() && (s[at] == ' ' || s[at] == '\t' || s[at] == '\n' || s[at] == '\r')) ++at; }
    bool literal(const char* word) {
        const size_t n = std::char_traits<char>::length(word);
        if (s.compare(at, n, word) != 0) return false;
        at += n;
        return true;
    }
    static void utf8(std::string& out, unsigned cp) {
        if (cp < 0x80) out += static_cast<char>(cp);
        else if (cp < 0x800) { out += static_cast<char>(0xC0 | (cp >> 6)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
        else if (cp < 0x10000) { out += static_cast<char>(0xE0 | (cp >> 12)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
        else { out += static_cast<char>(0xF0 | (cp >> 18)); out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
    }
    bool hex4(unsigned& unit) { // four hex digits at `at`
        if (at + 4 > s.size()) return false;
        unit = 0;
        for (int i = 0; i < 4; ++i, ++at) {
            const char c = s[at];
            const int d = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
            if (d < 0) return false;
            unit = unit * 16 + static_cast<unsigned>(d);
        }
        return true;
    }
    bool string(std::string& out) {
        ++at; // the opening quote
        while (at < s.size()) {
            const char c = s[at++];
            if (c == '"') return true;
            if (static_cast<unsigned char>(c) < 0x20) return false;
            if (c != '\\') { out += c; continue; }
            if (at >= s.size()) return false;
            switch (s[at++]) {
            case '"': out += '"'; break;
            case '\\': out += '\\'; break;
            case '/': out += '/'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case 'u': {
                unsigned unit = 0;
                if (!hex4(unit)) return false;
                if (unit >= 0xD800 && unit < 0xDC00 && at + 1 < s.size() && s[at] == '\\' && s[at + 1] == 'u') { // a pair?
                    const size_t before = at;
                    unsigned low = 0;
                    at += 2;
                    if (hex4(low) && low >= 0xDC00 && low < 0xE000) { utf8(out, 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)); break; }
                    at = before; // not a pair: the first is alone, the second is read on its own
                }
                // shortcut: a lone surrogate becomes U+FFFD where the web keeps it, upgrade: when texts are held in UTF-16 or a name with one must survive
                utf8(out, unit >= 0xD800 && unit < 0xE000 ? 0xFFFD : unit);
                break;
            }
            default: return false;
            }
        }
        return false;
    }
    bool digits() {
        const size_t from = at;
        while (at < s.size() && s[at] >= '0' && s[at] <= '9') ++at;
        return at > from;
    }
    bool numberValue(Json& out) {
        const size_t start = at;
        if (at < s.size() && s[at] == '-') ++at;
        if (at < s.size() && s[at] == '0') ++at;
        else if (!(at < s.size() && s[at] >= '1' && s[at] <= '9' && digits())) return false;
        if (at < s.size() && s[at] == '.') { ++at; if (!digits()) return false; }
        if (at < s.size() && (s[at] == 'e' || s[at] == 'E')) {
            ++at;
            if (at < s.size() && (s[at] == '+' || s[at] == '-')) ++at;
            if (!digits()) return false;
        }
        // The grammar is checked; the value is the library's (exact, and independent of the C locale's decimal point, which the C library's own conversion is not). It
        // refuses only a number that overflows: that is Infinity by the sign. A number below the smallest is 0. -0 is read with its sign, but number() stores it as the
        // integer 0: JSON.stringify prints -0 as 0, so the texts are the web's, and no rule of the logic reads the sign of a zero.
        const std::string token = s.substr(start, at - start);
        const Json parsed = Json::parse(token, nullptr, false);
        double v = parsed.is_discarded() ? (token[0] == '-' ? -HUGE_VAL : HUGE_VAL) : parsed.get<double>();
        if (v == 0 && token[0] == '-') v = -0.0;
        out = number(v);
        return true;
    }
    bool value(Json& out) {
        skip();
        if (at >= s.size()) return false;
        switch (s[at]) {
        case '{': return object(out);
        case '[': return array(out);
        case '"': { std::string text; if (!string(text)) return false; out = std::move(text); return true; }
        case 't': out = true; return literal("true");
        case 'f': out = false; return literal("false");
        case 'n': out = nullptr; return literal("null");
        default: return numberValue(out);
        }
    }
    bool object(Json& out) {
        if (++depth > MAX_DEPTH) return false;
        ++at;
        out = Json::object();
        skip();
        if (at < s.size() && s[at] == '}') { ++at; --depth; return true; }
        ObjectBuilder members; // linear in the number of keys (operator[] searches them one by one)
        for (;;) {
            skip();
            std::string key;
            if (at >= s.size() || s[at] != '"' || !string(key)) return false;
            skip();
            if (at >= s.size() || s[at++] != ':') return false;
            Json v;
            if (!value(v)) return false;
            members.set(std::move(key), std::move(v));
            skip();
            if (at >= s.size()) return false;
            if (s[at] == ',') { ++at; continue; }
            if (s[at++] == '}') { --depth; out = members.build(); return true; }
            return false;
        }
    }
    bool array(Json& out) {
        if (++depth > MAX_DEPTH) return false;
        ++at;
        out = Json::array();
        skip();
        if (at < s.size() && s[at] == ']') { ++at; --depth; return true; }
        for (;;) {
            Json v;
            if (!value(v)) return false;
            out.push_back(std::move(v));
            skip();
            if (at >= s.size()) return false;
            if (s[at] == ',') { ++at; continue; }
            if (s[at++] == ']') { --depth; return true; }
            return false;
        }
    }
};

// text that is no JSON counts as null
Json parseTrack(const std::string& text) {
    Json parsed;
    return Reader(text).parse(parsed) ? parsed : Json();
}

std::string dump(const Json& j) { return j.dump(-1, ' ', false, Json::error_handler_t::replace); }

} // namespace

Json completeVoices(const Json& voices) {
    Json out = Json::object();
    for (const auto& entry : music().voices) {
        const std::string& layer = entry.first;
        Val given = isRecord(&voices) ? own(voices, layer) : nullptr;
        Val id = isString(given) ? given : isRecord(given) ? own(*given, "id") : nullptr;
        if (!isVoice(layer, id)) { // the default: the first sample variant
            out[layer] = Json::object({ { "id", "sample" }, { "variant", variantsOf(layer, "sample")->front() } });
            continue;
        }
        Val givenVariant = isRecord(given) ? own(*given, "variant") : nullptr;
        const std::string idName = id->get<std::string>();
        const std::string variant = givenVariant != nullptr && isVoice(layer, id, givenVariant) ? givenVariant->get<std::string>() : variantsOf(layer, idName)->front();
        const auto* successor = movedTo(layer, idName, variant);
        out[layer] = successor ? Json::object({ { "id", successor->first }, { "variant", successor->second } }) : Json::object({ { "id", idName }, { "variant", variant } });
    }
    return out;
}

Json completeJobs(const Json& jobs) {
    const Json none = Json::object();
    const Json& given = jobs.is_object() ? jobs : none; // an array, a text and a number have none of the layers' names
    Json out = Json::object();
    for (const LayerSpec& l : music().layers) {
        if (l.jobs.empty()) continue;
        Val job = own(given, l.id);
        out[l.id] = isJob(l.id, job) ? *job : Json(l.jobs.front());
    }
    return out;
}

void checkForm(const Json& form, const std::function<void(const char*, Json)>& add) {
    if (form.is_null()) return;
    const Music& m = music();
    std::set<std::string> seen; // the same message once (many parts that are broken the same way)
    const auto bad = [&](const char* reason) { if (seen.insert(reason).second) add("badForm", Json::object({ { "reason", reason } })); };
    if (!form.is_object()) return bad("form");
    Val sections = own(form, "sections");
    Val feel = own(form, "feel");
    if (!isNullish(feel)) {
        if (!feel->is_object()) bad("feel");
        else for (const auto& knob : m.feelDefaults) { Val v = own(*feel, knob.first); if (!isNullish(v) && !inRange(v, 0, knob.first == "dynamics" ? m.dynamicsMax : 1)) bad("feel"); }
    }
    if (sections == nullptr || !sections->is_array() || sections->empty() || static_cast<double>(sections->size()) > m.parts) return bad("sections");
    for (const Json& s : *sections) {
        if (!s.is_object()) { bad("sections"); continue; }
        Val type = own(s, "type");
        if (!isString(type) || !has(m.partTypes, type->get<std::string>())) bad("type");
        Val bars = own(s, "bars");
        if (!(isInteger(bars) && bars->get<double>() >= 1 && bars->get<double>() <= m.bars)) bad("bars");
        Val level = own(s, "level"), density = own(s, "density"), transition = own(s, "transition"), crash = own(s, "crash"), locked = own(s, "locked");
        if (!isNullish(level) && !inRange(level, m.levelMin, m.levelMax)) bad("level");
        if (!isNullish(density) && !inRange(density, m.densityMin, m.densityMax)) bad("density");
        if (!isNullish(transition) && !(isString(transition) && has(m.transitions, transition->get<std::string>()))) bad("transition");
        if (!isNullish(crash) && !crash->is_boolean()) bad("crash");
        if (!isNullish(locked) && !locked->is_boolean()) bad("locked");
    }
    if (formLength(&form) > m.length) bad("length");
}

Json normalizeForm(const Json& form) {
    if (form.is_null()) return Json(Json::value_t::discarded);
    if (!form.is_object()) return form;
    Json out = pick(form, { "sections" });
    if (Val v = own(form, "template"); isString(v)) out["template"] = *v;
    if (Val v = own(form, "auto"); v != nullptr && v->is_boolean()) out["auto"] = *v;
    if (Val sections = own(form, "sections"); sections != nullptr && sections->is_array()) {
        Json list = Json::array();
        for (const Json& s : *sections) list.push_back(s.is_object() ? pick(s, SECTION_KEYS) : s);
        out["sections"] = list;
    }
    Json defaults = Json::object();
    std::vector<std::string> keys;
    for (const auto& [k, v] : music().feelDefaults) { defaults[k] = v; keys.push_back(k); }
    Val feel = own(form, "feel");
    if (isNullish(feel)) out["feel"] = defaults;
    else if (feel->is_object()) {
        const Json given = pick(*feel, keys);
        for (auto it = given.begin(); it != given.end(); ++it) defaults[it.key()] = it.value();
        out["feel"] = defaults;
    }
    else out["feel"] = *feel;
    return out;
}

Json allowedChords(const Json& key) {
    std::vector<NamedChord> chords = diatonicChords(key);
    Val mode = own(key, "mode");
    if (isString(mode) && mode->get<std::string>() == "minor") chords.emplace_back(chords[4].first, "maj"); // the major dominant: E in A minor
    Json out = Json::array();
    for (const auto& [root, quality] : chords) out.push_back(Json::object({ { "root", root }, { "quality", quality } }));
    return out;
}

Json chordOptions(const Json& key) {
    struct Step { int pc; std::string root; std::set<std::string> bases; };
    std::vector<Step> byPc; // a Map by pitch class, in the order it first gets one
    for (const Json& chord : allowedChords(key)) {
        const std::string root = chord.at("root").get<std::string>();
        const int pc = noteToPc(root);
        auto step = std::find_if(byPc.begin(), byPc.end(), [&](const Step& s) { return s.pc == pc; });
        if (step == byPc.end()) { byPc.push_back({ pc, root, {} }); step = byPc.end() - 1; }
        step->bases.insert(chord.at("quality").get<std::string>());
    }
    Json out = Json::array();
    for (const Step& step : byPc) {
        Json qualities = Json::array();
        for (const ChordSpec& c : music().chords)
            if (std::any_of(c.on.begin(), c.on.end(), [&](const std::string& base) { return step.bases.count(base) > 0; })) qualities.push_back(c.id);
        out.push_back(Json::object({ { "root", step.root }, { "qualities", qualities } }));
    }
    return out;
}

Json chordName(const Json& chord) {
    Val root = own(chord, "root");
    const std::string quality = jsString(own(chord, "quality")); // CHORDS[quality]: the key is the quality as a text
    for (const ChordSpec& c : music().chords) if (c.id == quality) return jsString(root) + c.symbol;
    // the names every object has (Object.prototype) give no symbol: root + undefined is a text for a text, an array and an object, else NaN (null in JSON)
    if (!isObjectPrototypeName(quality)) throw std::invalid_argument("Unknown chord quality");
    return isString(root) || isObject(root) ? Json(jsString(root) + "undefined") : Json();
}

// what harmony.cpp and form_roll.cpp take from the helpers above
const Json& musicTable() { return musicJson(); }
int noteToPcOf(const Json& name) { return noteToPc(&name); }
bool isValidKeyValue(const Json& key) { return isValidKey(&key); }
const char* const* spelledNames(const Json& key) { return spelling(key, noteToPc(own(key, "root")), modeOf(own(key, "mode"))); }
bool isValidFormValue(const Json& form) { return isValidForm(form); }
double formLengthOf(const Json& form) { return formLength(&form); }
std::string jsStringOf(const Json* v) { return jsString(v); }
bool isObjectPrototypeNameOf(const std::string& name) { return isObjectPrototypeName(name); }
Json spreadValue(const Json& source) { Json out = Json::object(); spread(out, &source); return out; }
Json normalizedTrack(const Json& track) { return normalizeTrackValue(track); }
Json trackErrors(const Json& track) { return validateTrackValue(track); }
Json parsedText(const std::string& text) { return parseTrack(text); }

} // namespace btg::detail

namespace btg {

std::string normalizeTrack(const std::string& trackJson) {
    try { return detail::dump(detail::normalizeTrackValue(detail::parseTrack(trackJson))); }
    catch (...) { try { return detail::dump(detail::normalizeTrackValue(detail::Json())); } catch (...) { return "{}"; } }
}

std::string validateTrack(const std::string& trackJson) {
    try { return detail::dump(detail::validateTrackValue(detail::parseTrack(trackJson))); }
    catch (...) { try { return detail::dump(detail::validateTrackValue(detail::Json())); } catch (...) { return "[]"; } }
}

} // namespace btg
