#include "timbre.h"

#include "generator_internal.h"
#include "harmony.h"
#include "sound_data.h"
#include "sound_model.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace btg::detail {
namespace {

// an own property of an object (a list, a text and the rest have none of the names used here); a null pointer is `undefined`
const Json* own(const Json& object, const std::string& key) {
    if (!object.is_object()) return nullptr;
    const auto found = object.find(key);
    return found == object.end() ? nullptr : &*found;
}
const Json* own(const Json* object, const std::string& key) { return object == nullptr ? nullptr : own(*object, key); }

// an own entry of a table of music.json: the web's tables are plain objects, where a name every object has ('toString') finds a function or the prototype, which have no entries of their own
const Json* entryOf(const char* table, const std::string& key) { return own(musicTable().at(table), key); }

bool isNumber(const Json* v) { return v != nullptr && v->is_number(); }
bool isFinite(const Json* v) { return isNumber(v) && std::isfinite(v->get<double>()); } // Number.isFinite
double clamp01(double x) { return clamp(x, 0, 1); }                                    // Math.min(1, Math.max(0, x))

// the field `group.field` of the timbre; a field the 47 do not have is a flaw of the data, not of a caller
double& fieldOf(Timbre& timbre, const std::string& group, const std::string& field) {
    double* found = nullptr;
    forEachField(timbre, [&](const char* g, const char* f, double& value) { if (found == nullptr && group == g && field == f) found = &value; });
    if (found == nullptr) throw std::logic_error("no timbre field " + group + "." + field);
    return *found;
}
// 'group.field'.split('.') for a path of the tables
std::pair<std::string, std::string> splitPath(const std::string& path) {
    const size_t dot = path.find('.');
    return { path.substr(0, dot), path.substr(dot + 1) };
}

Json toJson(Timbre timbre) {
    Json out = Json::object();
    forEachField(timbre, [&](const char* group, const char* field, double& value) { out[group][field] = value; });
    return out;
}

// tags.js collectTags: the chosen tags, each once, in the order they are named. Throws where the web does.
std::vector<std::string> collectTags(const Json& tags) {
    std::vector<std::string> selected;
    // Object.entries(tags ?? {}): a list (its indices are the categories) or a text (its characters) has entries unless it is empty, and none of them is a category;
    // null, a number and a boolean have none
    if (tags.is_array() && !tags.empty()) throw std::invalid_argument("Unknown tag category: 0");
    if (tags.is_string() && !tags.get_ref<const std::string&>().empty()) throw std::invalid_argument("Unknown tag category: 0");
    if (!tags.is_object()) return selected;
    for (const auto& [category, list] : tags.items()) {
        const Json* known = nullptr;
        for (const Json& c : musicTable().at("tags")) if (c.at("id") == category) known = &c.at("tags");
        if (known == nullptr) throw std::invalid_argument("Unknown tag category: " + category);
        // for (const tag of list): a text is read by its characters, a number, null, true and an object are no iterable
        // shortcut: a text as the list of a category throws unless it is empty; the web reads its characters as tags, and none is one as long as no tag has a single character, upgrade: when one has
        if (list.is_string() && list.get_ref<const std::string&>().empty()) continue;
        if (!list.is_array()) throw std::invalid_argument("The list of a category is not iterable");
        for (const Json& tag : list) {
            if (!tag.is_string() || std::find(known->begin(), known->end(), tag) == known->end()) throw std::invalid_argument("Unknown tag");
            const std::string& name = tag.get_ref<const std::string&>();
            if (std::find(selected.begin(), selected.end(), name) == selected.end()) selected.push_back(name);
        }
    }
    return selected;
}

// timbre.js resolveTimbre, typed
Timbre sumOfTags(const Json& tags) {
    Timbre timbre;
    for (const std::string& tag : collectTags(tags)) {
        const Json* effects = entryOf("timbreEffects", tag);
        if (effects == nullptr) continue;
        for (const auto& [path, delta] : effects->items()) {
            const auto [group, field] = splitPath(path);
            fieldOf(timbre, group, field) += delta.get<double>();
        }
    }
    forEachField(timbre, [](const char*, const char*, double& value) { value = clamp01(value); });
    return timbre;
}

// Whether `object[field]` is not undefined where `object` is a group of the track's `timbre` (the web asks `track?.timbre?.[group]?.[field] !== undefined`).
// shortcut: of the members a text or a list has by itself the core knows `length` (both) and `sub` (a text; the knob bass.sub has the name of String.prototype.sub), the ones that name a
// knob today; upgrade: when a knob is named like another member of String.prototype or Array.prototype
bool isSetBy(const Json* group, const std::string& field) {
    if (group == nullptr) return false;
    if (group->is_object()) return own(*group, field) != nullptr;
    if (group->is_array()) return field == "length";
    if (group->is_string()) return field == "length" || field == "sub";
    return false;
}

} // namespace

Json resolveTimbre(const Json& tags) { return toJson(sumOfTags(tags)); }

Json resolveTrackTimbre(const Json& track) {
    // the knobs the seed moves with `variety`, by at most DRIFT_SPAN (timbre.js)
    static const char* const DRIFT_FIELDS[][2] = { { "drums", "snareTone" }, { "drums", "hatBright" }, { "bass", "cutoff" }, { "chords", "brightness" },
                                                   { "pad", "cutoff" }, { "pad", "lfoSpeed" }, { "master", "echo" } };
    const double DRIFT_SPAN = 0.08;
    const Json* tags = own(track, "tags");
    Timbre timbre = sumOfTags(tags != nullptr ? *tags : Json());
    const Json* variety = own(track, "variety");
    const Json* seed = own(track, "seed");
    if (variety != nullptr && variety->is_boolean() && variety->get<bool>() && isFinite(seed)) {
        Rng rng = Rng(seedBase(*seed)).fork("timbre-drift");
        for (const auto& path : DRIFT_FIELDS) {
            double& value = fieldOf(timbre, path[0], path[1]);
            value = clamp01(value + (rng.next() * 2 - 1) * DRIFT_SPAN);
        }
    }
    const Json* over = own(track, "timbre");
    if (over == nullptr || !over->is_object()) return toJson(timbre);
    forEachField(timbre, [&](const char* group, const char* field, double& value) {
        const Json* given = own(own(*over, group), field); // a group that is no object has no field
        if (isFinite(given)) value = clamp01(given->get<double>());
    });
    return toJson(timbre);
}

namespace {
// usesTimbreField; `complete`: the voices are completeVoices' already (completeVoices gives such voices back as they are)
bool uses(const Json& voices, bool complete, const Json& path) {
    static const char* const ALWAYS_ON[] = { "fuzz", "overdrive", "distortion", "vibrato", "chorus" }; // the chain and the modulation lie behind every voice
    const std::string text = jsStringOf(&path); // String(path).split('.')
    const size_t first = text.find('.');
    const std::string layer = text.substr(0, first);
    const auto& registry = soundData().uses;
    if (registry.find(layer) == registry.end() || first == std::string::npos) return true;
    const size_t second = text.find('.', first + 1);
    const std::string field = text.substr(first + 1, second == std::string::npos ? std::string::npos : second - first - 1);
    for (const char* always : ALWAYS_ON) if (field == always) return true;
    // `uses.includes(path)` compares the path itself: a list that reads like a path is not in it
    if (!path.is_string()) return false;
    const Json chosen = complete ? Json() : completeVoices(voices);
    return registry.at(layer).at((complete ? voices : chosen).at(layer).at("id").get<std::string>()).count(text) > 0;
}
} // namespace

bool usesTimbreField(const Json& voices, const Json& path) { return uses(voices, false, path); }
bool usesCompleteTimbreField(const Json& chosen, const Json& path) { return uses(chosen, true, path); }

bool isSoundOnlyChange(const Json& prevTags, const Json& nextTags) {
    // the chosen tags as the web's Set holds them: a number, a text, a boolean and null once however often named, a list or an object (never the same one twice) each
    const auto selected = [](const Json& tags, std::vector<Json>& out) {
        if (!tags.is_object() && !tags.is_array()) return false; // typeof tags !== 'object' || tags === null
        for (const Json& list : tags) {                           // Object.values(tags)
            if (!list.is_array()) return false;
            for (const Json& tag : list) if (tag.is_structured() || std::find(out.begin(), out.end(), tag) == out.end()) out.push_back(tag);
        }
        return true;
    };
    std::vector<Json> a, b;
    if (!selected(prevTags, a) || !selected(nextTags, b)) return false;
    bool changed = false;
    const auto soundOnly = [&](const Json& tag) { // Object.hasOwn(TIMBRE_EFFECTS, tag) && !Object.hasOwn(EFFECTS, tag): the tag is read as a property name
        changed = true;
        const std::string name = jsStringOf(&tag);
        return entryOf("timbreEffects", name) != nullptr && entryOf("tagPlayEffects", name) == nullptr;
    };
    bool every = true;
    for (const Json& tag : a) if (tag.is_structured() || std::find(b.begin(), b.end(), tag) == b.end()) every = soundOnly(tag) && every;
    for (const Json& tag : b) if (tag.is_structured() || std::find(a.begin(), a.end(), tag) == a.end()) every = soundOnly(tag) && every;
    return changed && every;
}

Json tagEffect(const Json& tag, const Json& track) {
    const Json* form = own(track, "form");
    const Json* voices = own(track, "voices");
    return tagEffect(tag, track, form != nullptr && isValidFormValue(*form), completeVoices(voices != nullptr ? *voices : Json()));
}

Json tagEffect(const Json& tag, const Json& track, bool hasForm, const Json& chosen) {
    const std::string key = jsStringOf(&tag); // TAG_PLAY_EFFECTS[tag]: the tag as a property name
    Json play = Json::array();
    if (const Json* effects = entryOf("tagPlayEffects", key))
        for (const auto& [param, value] : effects->items())
            if (!(param == "buildUp" && hasForm)) play.push_back(Json::object({ { "param", param }, { "value", value } }));
    Json sound = Json::array();
    bool anyArrives = false;
    if (const Json* effects = entryOf("timbreEffects", key)) {
        const Json* timbre = own(track, "timbre");
        for (const auto& [path, delta] : effects->items()) {
            const auto [group, field] = splitPath(path);
            Json blocked; // null
            if (!usesCompleteTimbreField(chosen, Json(path))) blocked = "voice";
            else if (isSetBy(own(timbre, group), field)) blocked = "knob";
            anyArrives = anyArrives || blocked.is_null();
            sound.push_back(Json::object({ { "path", path }, { "delta", delta }, { "blocked", blocked } }));
        }
    }
    Json formEffects = Json::array();
    if (hasForm)
        if (const Json* factors = own(musicTable().at("form").at("devFactors"), key))
            for (const auto& [type, factor] : factors->items()) formEffects.push_back(Json::object({ { "type", type }, { "factor", factor } }));
    Json kinds = Json::array();
    if (!play.empty()) kinds.push_back("play");
    if (!sound.empty()) kinds.push_back("sound");
    if (!formEffects.empty()) kinds.push_back("form");
    return Json::object({ { "play", play }, { "sound", sound }, { "form", formEffects }, { "kinds", kinds },
                          { "effective", !play.empty() || !formEffects.empty() || anyArrives } });
}

Json organTuning(const Json& organ) {
    Json over = Json::object();
    const Json* leslie = own(organ, "leslie");
    const Json* code = own(musicTable().at("organ").at("leslieCode"), jsStringOf(leslie)); // Object.hasOwn(LESLIE_CODE, organ?.leslie): the value as a property name
    if (code != nullptr && !(leslie->is_string() && leslie->get_ref<const std::string&>() == "auto")) over["leslie"] = *code;
    const Json* drive = own(organ, "drive");
    if (isNumber(drive) && drive->get<double>() >= 0 && drive->get<double>() <= 1) over["drive"] = *drive;
    Json out = Json::object();
    if (over.empty()) return out;
    for (const Json& variant : musicTable().at("voices").at("chords").at("organ")) out["chords/organ/" + variant.get<std::string>()] = over;
    return out;
}

double presetDrive(const Json& variant) {
    const auto& tunables = soundData().tunables;
    const auto preset = tunables.find("chords/organ/" + jsStringOf(&variant)); // TUNABLES[`chords/organ/${variant}`]?.drive.value ?? 0
    if (preset == tunables.end()) return 0;
    const auto drive = preset->second.find("drive");
    if (drive == preset->second.end()) throw std::invalid_argument("Cannot read properties of undefined (reading 'value')");
    return drive->second.value;
}

} // namespace btg::detail
