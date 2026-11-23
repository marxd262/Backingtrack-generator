// The parts of a profile, the profile files, the factory profiles, the session as parts and the last session (profiles.h), line by line from
// core/profile-parts.js, core/profile.js, ui/profile-factory.js, ui/profile-session.js and ui/session-store.js, on JSON values.
// native/core/tests/test_logic.cpp compares them with the web app one by one (the cases of native/tools/export-logic.mjs, Task 30a).
#include "profiles.h"

#include "form_internal.h"
#include "generator_internal.h"
#include "sound_model.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <optional>
#include <set>
#include <stdexcept>
#include <unordered_set>

extern const unsigned char btg_grooves_json[]; // native/core/data/grooves.json, embedded by CMake
extern const unsigned int btg_grooves_json_size;

namespace btg::detail {
namespace {

constexpr size_t MAX_BARS = 512;
constexpr double MAX_SEED = 4294967295.0;

const Json& music() { return musicTable(); }

// ---------- the JavaScript's strings (UTF-8; a lone surrogate is kept as its three bytes, WTF-8) ----------

std::vector<char32_t> decode(const std::string& s) { // a byte that starts no valid sequence is U+FFFD
    std::vector<char32_t> out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size();) {
        const auto b = static_cast<unsigned char>(s[i]);
        const size_t n = b < 0x80 ? 1 : (b >> 5) == 6 ? 2 : (b >> 4) == 14 ? 3 : (b >> 3) == 30 ? 4 : 0;
        char32_t cp = n == 1 ? b : n == 2 ? b & 0x1F : n == 3 ? b & 0x0F : b & 0x07; // the bits of the lead byte
        bool good = n != 0 && i + n <= s.size();
        for (size_t k = 1; good && k < n; ++k) {
            const auto c = static_cast<unsigned char>(s[i + k]);
            good = (c >> 6) == 2;
            cp = (cp << 6) | (c & 0x3F);
        }
        if (good && n == 4) good = cp >= 0x10000 && cp <= 0x10FFFF;
        if (good && n == 3) good = cp >= 0x800;
        if (good && n == 2) good = cp >= 0x80;
        if (!good) { out.push_back(0xFFFD); ++i; continue; }
        out.push_back(cp);
        i += n;
    }
    return out;
}
void encode(std::string& out, char32_t cp) {
    if (cp < 0x80) out += static_cast<char>(cp);
    else if (cp < 0x800) { out += static_cast<char>(0xC0 | (cp >> 6)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) { out += static_cast<char>(0xE0 | (cp >> 12)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
    else { out += static_cast<char>(0xF0 | (cp >> 18)); out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
}
std::string encode(const std::vector<char32_t>& cps, size_t from, size_t to) {
    std::string out;
    for (size_t i = from; i < to; ++i) encode(out, cps[i]);
    return out;
}
// the white space of String.prototype.trim: WhiteSpace and LineTerminator of ECMAScript
bool isJsSpace(char32_t c) {
    return (c >= 0x09 && c <= 0x0D) || c == 0x20 || c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000 || c == 0xFEFF;
}

// ---------- values ----------

bool isObject(const Json& v) { return v.is_object(); }                          // typeof 'object', not null, no array (the profile files' isObject)
bool isNumber(const Json* v) { return v != nullptr && v->is_number(); }
bool isInteger(const Json* v) { return isNumber(v) && std::isfinite(v->get<double>()) && std::floor(v->get<double>()) == v->get<double>(); } // Number.isInteger
bool num01(const Json& v) { return v.is_number() && v.get<double>() >= 0 && v.get<double>() <= 1; }                                           // NaN and Infinity fall through
bool isFiniteNumber(const Json* v) { return isNumber(v) && std::isfinite(v->get<double>()); }
const std::vector<std::string>& partIds() { static const std::vector<std::string> ids { "harmony", "tempo", "rhythm", "style", "sound", "voices", "layers", "mixer", "variant", "form" }; return ids; }
const std::vector<std::string>& chordColors() { static const std::vector<std::string> ids = keysOf(music().at("chordColors").at("table")); return ids; } // CHORD_COLORS
const Json& meterGrid() { return music().at("meterGrid"); }

} // namespace

// ---------- shared (profiles.h) ----------

const Json* member(const Json& object, const std::string& key) {
    if (!object.is_object()) return nullptr;
    const auto found = object.find(key);
    return found == object.end() ? nullptr : &*found;
}
const Json& orNull(const Json* v) { static const Json none; return v == nullptr ? none : *v; }
bool truthy(const Json& v) {
    switch (v.type()) {
    case Json::value_t::null: return false;
    case Json::value_t::boolean: return v.get<bool>();
    case Json::value_t::string: return !v.get_ref<const std::string&>().empty();
    case Json::value_t::array: case Json::value_t::object: return true;
    default: return v.get<double>() != 0;
    }
}
Json num(double v) { return std::floor(v) == v && std::fabs(v) < 9007199254740992.0 ? Json(static_cast<std::int64_t>(v)) : Json(v); }
double numberOf(const Json& v) {
    if (!v.is_number()) throw std::invalid_argument("a number is expected");
    return v.get<double>();
}
bool oneOf(const Json& v, const std::vector<std::string>& list) { return v.is_string() && std::find(list.begin(), list.end(), v.get_ref<const std::string&>()) != list.end(); }
std::vector<std::string> keysOf(const Json& object) {
    std::vector<std::string> out;
    for (auto it = object.begin(); it != object.end(); ++it) out.push_back(it.key());
    return out;
}
const std::vector<std::string>& layerIds() { static const std::vector<std::string> ids = keysOf(music().at("layers")); return ids; }
const std::vector<std::string>& voiceLayers() { static const std::vector<std::string> ids = keysOf(music().at("voices")); return ids; }
const std::vector<std::string>& mixNames() { static const std::vector<std::string> ids = [] { std::vector<std::string> out = layerIds(); out.push_back("master"); return out; }(); return ids; }
const std::vector<std::string>& scaleNames() { static const std::vector<std::string> ids = keysOf(music().at("scaleModes")); return ids; }
const std::vector<std::string>& styleIds() { static const std::vector<std::string> ids = [] { std::vector<std::string> out; for (const Json& p : music().at("styles")) out.push_back(p.at("id")); return out; }(); return ids; }
std::string meterKey(const Json& meter) {
    constexpr double SAFE = 9007199254740991.0;
    if (!meter.is_array() || meter.size() != 2 || !isInteger(&meter[0]) || !isInteger(&meter[1])) return "";
    if (std::fabs(meter[0].get<double>()) > SAFE || std::fabs(meter[1].get<double>()) > SAFE) return "";
    return std::to_string(static_cast<std::int64_t>(meter[0].get<double>())) + "/" + std::to_string(static_cast<std::int64_t>(meter[1].get<double>()));
}
double convertTempo(double bpm, const std::string& fromKey, const std::string& toKey) {
    if (!meterGrid().contains(fromKey) || !meterGrid().contains(toKey)) return bpm;
    const int from = meterGrid().at(fromKey).at("sub").get<int>(), to = meterGrid().at(toKey).at("sub").get<int>();
    if (from == to) return bpm;
    return std::min(200.0, std::max(40.0, jsRound(bpm * (to == 3 ? 2.0 / 3.0 : 3.0 / 2.0))));
}

namespace {

const std::vector<std::string>& leslieModes() { static const std::vector<std::string> ids = music().at("organ").at("leslieModes").get<std::vector<std::string>>(); return ids; }
const std::vector<std::string>& templateIds() { static const std::vector<std::string> ids = music().at("form").at("templateIds").get<std::vector<std::string>>(); return ids; }
const std::vector<std::string>& timbreGroups() { // DEFAULT_TIMBRE's groups, in order
    static const std::vector<std::string> ids = [] {
        std::vector<std::string> out;
        Timbre t;
        forEachField(t, [&](const char* group, const char*, double&) { if (out.empty() || out.back() != group) out.push_back(group); });
        return out;
    }();
    return ids;
}
std::vector<std::string> timbreFields(const std::string& group) {
    std::vector<std::string> out;
    Timbre t;
    forEachField(t, [&](const char* g, const char* field, double&) { if (group == g) out.push_back(field); });
    return out;
}
bool hasGroove(const std::string& id) {
    static const Json grooves = Json::parse(btg_grooves_json, btg_grooves_json + btg_grooves_json_size);
    return grooves.contains(id);
}
bool isMeter(const Json& meter) { return meterGrid().contains(meterKey(meter)); }
// voices.js isVoice: `variant` null pointer is the web's undefined
bool isVoice(const std::string& layer, const Json* id, const Json* variant) {
    if (!music().at("voices").contains(layer) || id == nullptr || !id->is_string() || !music().at("voices").at(layer).contains(id->get_ref<const std::string&>())) return false;
    if (variant == nullptr) return true;
    if (!variant->is_string()) return false;
    const std::string& name = id->get_ref<const std::string&>();
    const Json& variants = music().at("voices").at(layer).at(name);
    if (std::find(variants.begin(), variants.end(), *variant) != variants.end()) return true;
    const Json& moved = music().at("movedVoices");
    return moved.contains(layer) && moved.at(layer).contains(name + "/" + variant->get_ref<const std::string&>());
}
bool isJob(const std::string& layer, const Json& job) { // layers.js: jobsFor(layer).includes(job)
    if (!music().at("layers").contains(layer)) return false;
    const Json& jobs = music().at("layers").at(layer).at("jobs");
    return job.is_string() && std::find(jobs.begin(), jobs.end(), job) != jobs.end();
}
double nearestSize(double x) { // TARGET_SIZES.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a))
    const Json& sizes = music().at("form").at("targetSizes");
    double a = sizes.at(0).get<double>();
    for (size_t i = 1; i < sizes.size(); ++i) { const double b = sizes.at(i).get<double>(); if (std::fabs(b - x) < std::fabs(a - x)) a = b; }
    return a;
}

// a copy of the value as JSON.stringify and JSON.parse make it: a number that is not finite is null, a minus zero a zero
Json jsonRoundTrip(const Json& v) {
    if (v.is_number()) {
        const double d = v.get<double>();
        return std::isfinite(d) ? (d == 0 ? Json(0) : v) : Json();
    }
    if (v.is_array()) { Json out = Json::array(); for (const Json& x : v) out.push_back(jsonRoundTrip(x)); return out; }
    if (v.is_object()) { ObjectBuilder out; for (auto it = v.begin(); it != v.end(); ++it) out.append(it.key(), jsonRoundTrip(it.value())); return out.build(); }
    return v;
}

// profile-parts.js trackOk: validateTrack(normalizeTrack({ ...BASE, ...patch })) has no error of `code`
bool trackOk(const char* field, const Json& value, const char* code) {
    Json track = Json::parse(R"({"key":{"root":"A","mode":"minor"},"bpm":100,"bars":[{"chord":{"root":"A","quality":"min"},"beats":4}]})");
    track[field] = value;
    for (const Json& e : trackErrors(normalizedTrack(track))) if (e.at("code") == code) return false;
    return true;
}

// ---------- sanitizeParts ----------

bool forbidden(const std::string& k) { return k == "__proto__" || k == "constructor" || k == "prototype"; }

class Sanitizer {
public:
    int skipped = 0;
    Json run(const Json& raw) {
        Json parts = Json::object();
        if (!raw.is_object()) { skipped = 1; return parts; }
        const Json top = fields(raw);
        for (const std::string& id : partIds()) {
            const Json* part = member(top, id);
            if (part == nullptr) continue;
            if (!part->is_object()) { bad(); continue; }
            Json out = Json::object();
            const Json f = fields(*part);
            clean(id, f, out);
            if (!out.empty()) parts[id] = std::move(out);
        }
        return parts;
    }

private:
    using Check = std::function<bool(const Json&, const std::string&)>;
    using Pick = std::function<Json(const Json&, const std::string&)>;
    void bad() { ++skipped; }
    // eigene Einträge ohne die Schlüssel, die den Prototyp erreichen könnten (die zählen als ungültig)
    Json fields(const Json& o) {
        ObjectBuilder out;
        for (auto it = o.begin(); it != o.end(); ++it) { if (forbidden(it.key())) bad(); else out.append(it.key(), it.value()); }
        return out.build();
    }
    // a dictionary { id: value }: only known ids, each entry checked by itself; unknown ids are ignored. nullopt is the web's undefined.
    std::optional<Json> dict(const Json* raw, const std::vector<std::string>& ids, const Check& ok, const Pick& pick = [](const Json& v, const std::string&) { return v; }) {
        if (raw == nullptr || !raw->is_object()) { bad(); return std::nullopt; }
        const Json d = fields(*raw);
        Json out = Json::object();
        for (const std::string& id : ids) {
            const Json* v = member(d, id);
            if (v == nullptr) continue;
            if (ok(*v, id)) out[id] = pick(*v, id); else bad();
        }
        return out;
    }
    static bool nonEmpty(const std::optional<Json>& o) { return o.has_value() && !o->empty(); }

    // harmony is indivisible: key, bars and meter must make a valid part of a track together
    static std::optional<Json> cleanHarmonyCore(const Json& h) {
        const Json* key = member(h, "key");
        const Json* meter = member(h, "meter");
        const Json* bars = member(h, "bars");
        if (key == nullptr || !isValidKeyValue(*key) || meter == nullptr || !isMeter(*meter) || bars == nullptr || !bars->is_array() || bars->size() > MAX_BARS) return std::nullopt;
        Json cleanKey = Json::object({ { "root", key->at("root") }, { "mode", key->at("mode") } });
        Json cleanMeter = Json::array({ (*meter)[0], (*meter)[1] });
        Json cleanBars = Json::array();
        const double beats = meterGrid().at(meterKey(cleanMeter)).at("beats").get<double>();
        for (const Json& b : *bars) {
            // the web reads b.chord.root: a bar or a chord that is no object either throws (null) or has no root and quality, and a track with such a chord is not valid: null in all cases
            const Json* chord = member(b, "chord");
            if (chord == nullptr || !chord->is_object()) return std::nullopt;
            Json bar = Json::object();
            Json c = Json::object();
            if (const Json* root = member(*chord, "root")) c["root"] = *root;
            if (const Json* quality = member(*chord, "quality")) c["quality"] = *quality;
            bar["chord"] = std::move(c);
            const Json* b2 = member(b, "beats");
            if (b2 == nullptr || !b2->is_number() || b2->get<double>() != beats) return std::nullopt;
            bar["beats"] = *b2;
            cleanBars.push_back(std::move(bar));
        }
        Json track = Json::object({ { "key", cleanKey }, { "bars", cleanBars }, { "meter", cleanMeter }, { "bpm", 100 } });
        if (!trackErrors(normalizedTrack(track)).empty()) return std::nullopt;
        return Json::object({ { "key", std::move(cleanKey) }, { "bars", std::move(cleanBars) }, { "meter", std::move(cleanMeter) } });
    }

    void clean(const std::string& id, const Json& f, Json& out) {
        if (id == "harmony") harmony(f, out);
        else if (id == "tempo") tempo(f, out);
        else if (id == "rhythm") rhythm(f, out);
        else if (id == "style") style(f, out);
        else if (id == "sound") sound(f, out);
        else if (id == "voices") voices(f, out);
        else if (id == "layers") layers(f, out);
        else if (id == "mixer") mixer(f, out);
        else if (id == "variant") variant(f, out);
        else form(f, out);
    }

    void harmony(const Json& f, Json& out) {
        const std::optional<Json> core = cleanHarmonyCore(f);
        if (!core) return bad();
        for (auto it = core->begin(); it != core->end(); ++it) out[it.key()] = it.value();
        const auto optional = [&](const char* name, const std::function<bool(const Json&)>& ok) {
            if (const Json* v = member(f, name)) { if (ok(*v)) out[name] = *v; else bad(); }
        };
        optional("scale", [](const Json& v) { return oneOf(v, scaleNames()); });
        optional("chordColor", [](const Json& v) { return oneOf(v, chordColors()); });
        optional("chordColorFromStyle", [](const Json& v) { return v.is_boolean(); });
    }
    void tempo(const Json& f, Json& out) {
        if (const Json* bpm = member(f, "bpm")) { if (bpm->is_number() && trackOk("bpm", *bpm, "badBpm")) out["bpm"] = *bpm; else bad(); }
        // the meter in which bpm counts; without bpm it says nothing
        if (const Json* meter = member(f, "meter")) {
            if (!isMeter(*meter)) bad();
            else if (out.contains("bpm")) out["meter"] = Json::array({ (*meter)[0], (*meter)[1] });
        }
    }
    void rhythm(const Json& f, Json& out) {
        if (const Json* v = member(f, "groove")) { if (v->is_null() || (v->is_string() && hasGroove(v->get_ref<const std::string&>()))) out["groove"] = *v; else bad(); }
        for (const char* name : { "complexity", "loose", "ornaments" })
            if (const Json* v = member(f, name)) { if (v->is_null() || num01(*v)) out[name] = *v; else bad(); }
        if (const Json* v = member(f, "length")) { if (v->is_number() && trackOk("length", *v, "badLength")) out["length"] = *v; else bad(); }
    }
    void style(const Json& f, Json& out) {
        if (const Json* v = member(f, "style")) { if (oneOf(*v, styleIds())) out["style"] = *v; else bad(); }
        if (const Json* v = member(f, "tags")) {
            // isPlain(f.tags) && no badTags: the value is { category: [tags] } with known names, so every entry is a list and [...list] is a copy
            if (v->is_object() && trackOk("tags", *v, "badTags")) out["tags"] = *v; else bad();
        }
    }
    void sound(const Json& f, Json& out) {
        if (const Json* organ = member(f, "organ")) {
            if (!organ->is_object()) bad();
            else {
                const Json g = fields(*organ);
                Json o = Json::object();
                if (const Json* leslie = member(g, "leslie")) { if (oneOf(*leslie, leslieModes())) o["leslie"] = *leslie; else bad(); }
                if (const Json* drive = member(g, "drive")) { if (drive->is_null() || num01(*drive)) o["drive"] = *drive; else bad(); }
                if (!o.empty()) out["organ"] = std::move(o);
            }
        }
        const Json* timbre = member(f, "timbre");
        if (timbre == nullptr) return;
        if (!timbre->is_object()) return bad();
        const std::optional<Json> groups = dict(timbre, timbreGroups(), [](const Json& v, const std::string&) { return v.is_object(); },
            [this](const Json& g, const std::string& group) { return *dict(&g, timbreFields(group), [](const Json& v, const std::string&) { return num01(v); }); });
        Json result = Json::object();
        for (auto it = groups->begin(); it != groups->end(); ++it) if (!it.value().empty()) result[it.key()] = it.value();
        // {} resets when loaded: valid only if it was meant so (given empty), not if everything was invalid
        if (!result.empty() || timbre->empty()) out["timbre"] = std::move(result);
    }
    void voices(const Json& f, Json& out) {
        if (const Json* v = member(f, "voices")) {
            const std::optional<Json> d = dict(v, voiceLayers(), [this](const Json& value, const std::string& layer) {
                if (value.is_string()) return isVoice(layer, &value, nullptr);
                if (!value.is_object()) return false;
                const Json r = fields(value);
                return isVoice(layer, member(r, "id"), member(r, "variant"));
            }, [](const Json& value, const std::string&) {
                if (value.is_string()) return Json::object({ { "id", value } });
                const Json* variant = member(value, "variant");
                Json pick = Json::object({ { "id", orNull(member(value, "id")) } });
                if (variant != nullptr) pick["variant"] = *variant;
                return pick;
            });
            if (nonEmpty(d)) out["voices"] = *d;
        }
        if (const Json* v = member(f, "jobs")) {
            const std::optional<Json> d = dict(v, layerIds(), [](const Json& value, const std::string& layer) { return isJob(layer, value); });
            if (nonEmpty(d)) out["jobs"] = *d;
        }
    }
    void layers(const Json& f, Json& out) {
        if (const Json* v = member(f, "layers")) {
            const std::optional<Json> d = dict(v, layerIds(), [](const Json& value, const std::string&) { return value.is_boolean(); });
            if (nonEmpty(d)) out["layers"] = *d;
        }
    }
    void mixer(const Json& f, Json& out) {
        if (const Json* v = member(f, "mix")) {
            const std::optional<Json> d = dict(v, mixNames(), [](const Json& value, const std::string&) { return num01(value); });
            if (nonEmpty(d)) out["mix"] = *d;
        }
        if (const Json* v = member(f, "pan")) {
            const std::optional<Json> d = dict(v, layerIds(), [](const Json& value, const std::string&) { return value.is_number() && value.get<double>() >= -1 && value.get<double>() <= 1; });
            if (nonEmpty(d)) out["pan"] = *d;
        }
    }
    void variant(const Json& f, Json& out) {
        if (const Json* v = member(f, "seed")) { if (isInteger(v) && v->get<double>() >= 0 && v->get<double>() <= MAX_SEED) out["seed"] = *v; else bad(); }
        if (const Json* v = member(f, "variety")) { if (v->is_boolean()) out["variety"] = *v; else bad(); }
    }
    void form(const Json& f, Json& out) {
        const Json* given = member(f, "form");
        if (given == nullptr) return;
        if (!given->is_object()) return bad();
        const Json g = fields(*given);
        const Json* list = member(g, "sections");
        if (list == nullptr || !list->is_array()) return bad();
        Json sections = Json::array();
        double total = 0;
        // each part is checked like checkForm; what goes beyond 64 parts or the total length falls away (counted at once, also for huge lists)
        for (size_t i = 0; i < list->size(); ++i) {
            if (static_cast<double>(sections.size()) >= formLimit("parts")) { skipped += static_cast<int>(list->size() - i); break; }
            const Json& raw = (*list)[i];
            Json one;
            bool have = false;
            if (raw.is_object()) {
                const Json normalized = normalizeForm(Json::object({ { "sections", Json::array({ fields(raw) }) } }));
                one = normalized.at("sections").at(0);
                have = true;
            }
            if (!have || !isValidFormValue(Json::object({ { "sections", Json::array({ one }) } })) || total + one.at("bars").get<double>() > formLimit("length")) { bad(); continue; }
            total += one.at("bars").get<double>();
            sections.push_back(std::move(one));
        }
        if (sections.empty()) return;
        Json feel = Json::object();
        if (const Json* gf = member(g, "feel")) {
            if (!gf->is_object()) bad();
            else {
                const Json e = fields(*gf);
                for (auto it = e.begin(); it != e.end(); ++it) {
                    if (!music().at("form").at("feelDefaults").contains(it.key())) continue;
                    const double max = it.key() == "dynamics" ? music().at("form").at("dynamicsMax").get<double>() : 1;
                    if (it.value().is_number() && it.value().get<double>() >= 0 && it.value().get<double>() <= max) feel[it.key()] = it.value(); else bad();
                }
            }
        }
        // template and auto as normalizeForm checks them; an unknown template falls back to pop
        const Json* tpl = member(g, "template");
        const Json* automatic = member(g, "auto");
        if (tpl != nullptr && !oneOf(*tpl, templateIds())) bad();
        if (automatic != nullptr && !automatic->is_boolean()) bad();
        const Json resolved = resolveTemplate(tpl != nullptr && oneOf(*tpl, templateIds()) ? *tpl : Json(), Json(), Json());
        out["form"] = normalizeForm(Json::object({ { "template", resolved.at("template") }, { "auto", automatic != nullptr && automatic->is_boolean() ? *automatic : resolved.at("auto") },
                                                   { "feel", feel }, { "sections", sections } }));
    }
};

// ---------- the files ----------

const Json REJECT = Json::parse(R"({"ok":false,"errors":[{"code":"badProfile","params":{}}]})");
// cleanName: a text that is not blank, trimmed and cut at 60 UTF-16 code units (not trimmed again), else "Importiert"
Json cleanName(const Json* v) {
    if (v != nullptr && v->is_string() && !jsTrim(v->get_ref<const std::string&>()).empty()) return jsSlice(jsTrim(v->get_ref<const std::string&>()), NAME_LIMIT);
    return "Importiert";
}

Json exportNode(const Json& node) { // nothing (null) for what is no profile and no folder
    const Json* type = member(node, "type");
    if (type != nullptr && *type == "profile") return Json::object({ { "type", "profile" }, { "name", cleanName(member(node, "name")) }, { "parts", sanitizeParts(orNull(member(node, "parts"))).at("parts") } });
    if (type != nullptr && *type == "folder") {
        Json items = Json::array();
        const Json* list = member(node, "items");
        if (list != nullptr && list->is_array()) for (const Json& item : *list) { Json e = exportNode(item); if (!e.is_null()) items.push_back(std::move(e)); }
        return Json::object({ { "type", "folder" }, { "name", cleanName(member(node, "name")) }, { "items", std::move(items) } });
    }
    return Json();
}

struct Read { int nodes = 0, skipped = 0; };

Json readNode(const Json& raw, size_t level, Read& st, bool asFolder) {
    const auto drop = [&] { ++st.skipped; return Json(); };
    if (!raw.is_object() || level > DEPTH_LIMIT || st.nodes >= static_cast<int>(NODE_LIMIT)) return drop();
    const Json* given = member(raw, "type");
    const bool isProfile = !asFolder && given != nullptr && *given == "profile";
    if (isProfile) {
        const Json r = sanitizeParts(orNull(member(raw, "parts")));
        st.skipped += r.at("skipped").get<int>();
        if (r.at("parts").empty()) return drop();
        ++st.nodes;
        return Json::object({ { "type", "profile" }, { "name", cleanName(member(raw, "name")) }, { "parts", r.at("parts") } });
    }
    const Json* items = member(raw, "items");
    if (!(asFolder || (given != nullptr && *given == "folder")) || items == nullptr || !items->is_array()) return drop();
    ++st.nodes;
    Json list = Json::array();
    for (const Json& item : *items) { Json n = readNode(item, level + 1, st, false); if (!n.is_null()) list.push_back(std::move(n)); }
    return Json::object({ { "type", "folder" }, { "name", cleanName(member(raw, "name")) }, { "items", std::move(list) } });
}

// an old file (commit 561bc10: track, scale, style, chordColor, chordColorFromStyle, mix) -> every part but `form`; usable only with a valid harmony
Json legacyParts(const Json& raw, int& skipped) {
    const Json* raw0 = member(raw, "track");
    if (raw0 == nullptr || !raw0->is_object()) return Json();
    Json track = *raw0;
    if (member(*raw0, "meter") == nullptr) { track = spreadValue(*raw0); track["meter"] = Json::array({ 4, 4 }); } // old files had no meter: 4/4
    Json session = Json::object({ { "track", std::move(track) } });
    for (const char* name : { "scale", "style", "chordColor", "chordColorFromStyle", "mix" }) if (const Json* v = member(raw, name)) session[name] = *v;
    Json ids = Json::array();
    for (const std::string& id : partIds()) if (id != "form") ids.push_back(id);
    const Json r = sanitizeParts(jsonRoundTrip(captureParts(session, ids))); // the round trip: missing fields instead of undefined
    skipped += r.at("skipped").get<int>();
    return r.at("parts").contains("harmony") ? r.at("parts") : Json();
}

} // namespace

// ---------- text helpers ----------

std::vector<char32_t> codePoints(const std::string& text) { return decode(text); }
void appendCodePoint(std::string& text, char32_t cp) { encode(text, cp); }

size_t utf16Length(const std::string& text) {
    size_t units = 0;
    int expect = 0; // continuation bytes still to come
    for (const char c : text) {
        const auto b = static_cast<unsigned char>(c);
        if (b >= 0x80 && b < 0xC0) { if (expect > 0) --expect; else ++units; continue; } // a continuation byte, or a stray one (U+FFFD)
        expect = b < 0xC0 ? 0 : b < 0xE0 ? 1 : b < 0xF0 ? 2 : b < 0xF8 ? 3 : 0;
        units += b >= 0xF0 && b < 0xF8 ? 2 : 1;
    }
    return units;
}
std::string jsTrim(const std::string& text) {
    const std::vector<char32_t> cps = decode(text);
    size_t from = 0, to = cps.size();
    while (from < to && isJsSpace(cps[from])) ++from;
    while (to > from && isJsSpace(cps[to - 1])) --to;
    return encode(cps, from, to);
}
std::string jsTrimEnd(const std::string& text) {
    const std::vector<char32_t> cps = decode(text);
    size_t to = cps.size();
    while (to > 0 && isJsSpace(cps[to - 1])) --to;
    return encode(cps, 0, to);
}
std::string jsSlice(const std::string& text, size_t units) {
    std::string out;
    size_t used = 0;
    for (const char32_t cp : decode(text)) {
        const size_t width = cp >= 0x10000 ? 2 : 1;
        if (used + width <= units) { encode(out, cp); used += width; continue; }
        if (width == 2 && used + 1 == units) encode(out, 0xD800 + ((cp - 0x10000) >> 10)); // the cut falls inside a pair: its high half stays
        break;
    }
    return out;
}
namespace {
void quoteInto(std::string& out, const std::string& text) {
    static const char* HEX = "0123456789abcdef";
    out += '"';
    // printable ASCII without a quote or a backslash stands as it is (most texts: names, ids, keys); the rest is decoded (escapes, surrogates, bytes that are no UTF-8)
    if (std::all_of(text.begin(), text.end(), [](char c) { return c >= 0x20 && c < 0x7F && c != '"' && c != '\\'; })) { out += text; out += '"'; return; }
    for (const char32_t cp : decode(text)) {
        if (cp == '"') out += "\\\"";
        else if (cp == '\\') out += "\\\\";
        else if (cp == '\b') out += "\\b";
        else if (cp == '\f') out += "\\f";
        else if (cp == '\n') out += "\\n";
        else if (cp == '\r') out += "\\r";
        else if (cp == '\t') out += "\\t";
        else if (cp < 0x20 || (cp >= 0xD800 && cp < 0xE000)) { out += "\\u"; for (int shift = 12; shift >= 0; shift -= 4) out += HEX[(cp >> shift) & 0xF]; }
        else encode(out, cp);
    }
    out += '"';
}
// JSON.stringify's SerializeJSONProperty with `gap` (empty: no line breaks) at the indentation `indent`
void stringifyInto(std::string& out, const Json& v, const std::string& gap, const std::string& indent) {
    switch (v.type()) {
    case Json::value_t::null: out += "null"; return;
    case Json::value_t::boolean: out += v.get<bool>() ? "true" : "false"; return;
    case Json::value_t::number_integer: case Json::value_t::number_unsigned: case Json::value_t::number_float: {
        const double d = v.get<double>();
        // a whole number up to 2^53 is its digits (as Number::toString writes it, -0 as 0), without the detour of the shortest digits
        if (std::floor(d) == d && std::fabs(d) <= 9007199254740992.0) { out += std::to_string(static_cast<long long>(d)); return; }
        out += std::isfinite(d) ? jsStringOf(&v) : "null";
        return;
    }
    case Json::value_t::string: quoteInto(out, v.get_ref<const std::string&>()); return;
    case Json::value_t::array: {
        if (v.empty()) { out += "[]"; return; }
        const std::string inner = indent + gap;
        out += '[';
        for (size_t i = 0; i < v.size(); ++i) {
            if (i) out += ',';
            if (!gap.empty()) { out += '\n'; out += inner; }
            if (v[i].is_discarded()) out += "null"; else stringifyInto(out, v[i], gap, inner);
        }
        if (!gap.empty()) { out += '\n'; out += indent; }
        out += ']';
        return;
    }
    default: { // object; a discarded value (undefined) is left out
        const std::string inner = indent + gap;
        bool first = true;
        out += '{';
        for (auto it = v.begin(); it != v.end(); ++it) {
            if (it.value().is_discarded()) continue;
            if (!first) out += ',';
            if (!gap.empty()) { out += '\n'; out += inner; }
            quoteInto(out, it.key());
            out += gap.empty() ? ":" : ": ";
            stringifyInto(out, it.value(), gap, inner);
            first = false;
        }
        if (!first && !gap.empty()) { out += '\n'; out += indent; }
        out += '}';
    }
    }
}
} // namespace

std::string stringify(const Json& v, size_t indent) {
    std::string out;
    stringifyInto(out, v, std::string(std::min<size_t>(indent, 10), ' '), "");
    return out;
}

// ---------- profile-parts.js ----------

Json PART_IDS() { Json out = Json::array(); for (const std::string& id : partIds()) out.push_back(id); return out; }
Json PART_PRESETS() {
    return Json::object({ { "all", PART_IDS() }, { "sound", Json::array({ "sound", "voices", "mixer" }) }, { "rhythm", Json::array({ "tempo", "rhythm" }) }, { "none", Json::array() } });
}

Json captureParts(const Json& session, const Json& ids) {
    if (!session.is_object() || !isObject(orNull(member(session, "track")))) throw std::invalid_argument("captureParts: no session"); // the web: a TypeError
    if (!ids.is_null() && !ids.is_array()) throw std::invalid_argument("captureParts: ids is no list");
    const Json& t = *member(session, "track");
    // a field that is not there (the web's undefined) is left out
    const auto put = [](Json& object, const char* key, const Json* v) { if (v != nullptr) object[key] = *v; };
    const auto putOrNull = [](Json& object, const char* key, const Json* v) { object[key] = v == nullptr || v->is_null() ? Json() : *v; }; // v ?? null
    Json out = Json::object();
    for (const std::string& id : partIds()) {
        if (!ids.is_null() && std::find(ids.begin(), ids.end(), Json(id)) == ids.end()) continue;
        Json part = Json::object();
        if (id == "harmony") {
            put(part, "key", member(t, "key")); put(part, "scale", member(session, "scale")); put(part, "bars", member(t, "bars"));
            put(part, "chordColor", member(session, "chordColor")); put(part, "chordColorFromStyle", member(session, "chordColorFromStyle")); put(part, "meter", member(t, "meter"));
        } else if (id == "tempo") {
            put(part, "bpm", member(t, "bpm")); put(part, "meter", member(t, "meter")); // bpm counts the pulse of this meter (applyParts converts)
        } else if (id == "rhythm") {
            putOrNull(part, "groove", member(t, "groove")); putOrNull(part, "complexity", member(t, "complexity")); putOrNull(part, "loose", member(t, "loose"));
            putOrNull(part, "ornaments", member(t, "ornaments")); put(part, "length", member(t, "length"));
        } else if (id == "style") {
            put(part, "style", member(session, "style")); put(part, "tags", member(t, "tags"));
        } else if (id == "sound") {
            const Json* timbre = member(t, "timbre");
            part["timbre"] = timbre == nullptr || timbre->is_null() ? Json::object() : *timbre;
            const Json* organ = member(session, "organ");
            if (organ != nullptr && truthy(*organ)) part["organ"] = *organ; // organ is missing in sessions without those knobs
        } else if (id == "voices") {
            // complete (the defaults too): loading mixes per key, an empty object could never bring the default back
            part["voices"] = completeVoices(orNull(member(t, "voices"))); part["jobs"] = completeJobs(orNull(member(t, "jobs")));
        } else if (id == "layers") {
            put(part, "layers", member(t, "layers"));
        } else if (id == "mixer") {
            put(part, "mix", member(session, "mix"));
            const Json* pan = member(session, "pan");
            if (pan != nullptr && truthy(*pan)) part["pan"] = *pan; // pan is missing in sessions without the pan knobs
        } else if (id == "variant") {
            put(part, "seed", member(t, "seed")); put(part, "variety", member(t, "variety"));
        } else { // without a (valid) form there is no part
            const Json& form = orNull(member(t, "form"));
            if (!isValidFormValue(form)) continue;
            part["form"] = normalizeForm(form);
        }
        out[id] = std::move(part);
    }
    return out;
}

Json sanitizeParts(const Json& raw) {
    try { // mirrors the JavaScript's try/catch at this place; no input known that reaches it
        Sanitizer s;
        Json parts = s.run(raw);
        return Json::object({ { "parts", std::move(parts) }, { "skipped", s.skipped } });
    } catch (const std::exception&) { return Json::object({ { "parts", Json::object() }, { "skipped", 1 } }); }
}

Json applyParts(const Json& session, const Json& partsGiven) {
    if (!session.is_object() || !isObject(orNull(member(session, "track")))) throw std::invalid_argument("applyParts: no session");
    Json s = session;
    const Json p = partsGiven.is_object() ? partsGiven : Json::object(); // `parts ?? {}`; what is no object has no part, as in the destructuring
    Json t = session.at("track"); // s.track, put back at the end (a reference into s would not survive new fields of s)
    const auto has = [](const Json& o, const char* k) { return member(o, k) != nullptr; };
    const auto part = [&](const char* name) -> const Json* {
        const Json* v = member(p, name);
        if (v == nullptr || !truthy(*v)) return nullptr;
        // shortcut: a part is an object (what sanitizeParts and captureParts give); a truthy value that is none throws here where the web reads fields of it, upgrade: if a caller hands other values
        if (!v->is_object()) throw std::invalid_argument(std::string("applyParts: the part ") + name + " is no object");
        return v;
    };
    const Json* h = part("harmony");
    const Json* tempo = part("tempo");
    const Json* r = part("rhythm");
    const Json* style = part("style");
    const Json* sound = part("sound");
    const Json* voices = part("voices");
    const Json* layers = part("layers");
    const Json* mixer = part("mixer");
    const Json* variant = part("variant");
    const Json* form = part("form");

    if (h != nullptr) {
        const Json* key = member(*h, "key");
        if (key != nullptr && truthy(*key)) {
            t["key"] = *key;
            // the scale only if it fits the key's mode, else the mode's default scale
            const Json* scale = member(*h, "scale");
            if (scale != nullptr && !scale->is_null() && !scale->is_string()) throw std::invalid_argument("applyParts: scale is no text"); // shortcut: a scale is a text (sanitizeParts), upgrade: if a caller hands another kind
            const Json& modes = music().at("scaleModes");
            const Json* mode = key->is_object() ? member(*key, "mode") : nullptr;
            if (scale != nullptr && scale->is_string() && modes.contains(scale->get_ref<const std::string&>()) && mode != nullptr && modes.at(scale->get_ref<const std::string&>()) == *mode) s["scale"] = *scale;
            else {
                const std::string* fallback = nullptr; // Object.keys(SCALE_MODE).find((name) => SCALE_MODE[name] === mode)
                for (auto it = modes.begin(); fallback == nullptr && it != modes.end(); ++it) if (mode != nullptr && it.value() == *mode) fallback = &it.key();
                if (fallback != nullptr) s["scale"] = *fallback; else s.erase("scale"); // undefined: a key without a mode is no valid track and ends in errors below
            }
        } else if (has(*h, "scale")) s["scale"] = *member(*h, "scale");
        for (const char* k : { "meter", "bars" }) if (has(*h, k)) t[k] = *member(*h, k);
        for (const char* k : { "chordColor", "chordColorFromStyle" }) if (has(*h, k)) s[k] = *member(*h, k);
    }
    // bpm in the meter of the profile -> the meter after loading (harmony is applied already); without a meter (older profiles) as stored
    if (tempo != nullptr && has(*tempo, "bpm")) {
        const Json& bpm = *member(*tempo, "bpm");
        if (has(*tempo, "meter")) {
            const std::string from = meterKey(*member(*tempo, "meter")), to = meterKey(orNull(member(t, "meter")));
            const bool same = !meterGrid().contains(from) || !meterGrid().contains(to) || meterGrid().at(from).at("sub") == meterGrid().at(to).at("sub");
            if (!same && !bpm.is_number()) throw std::invalid_argument("applyParts: bpm is no number"); // shortcut: the web converts a text; a bpm is a number (sanitizeParts), upgrade: if a caller hands another kind
            t["bpm"] = same ? bpm : num(convertTempo(bpm.get<double>(), from, to));
        } else t["bpm"] = bpm;
    }
    if (r != nullptr) {
        for (const char* k : { "groove", "complexity", "loose", "ornaments" })
            if (has(*r, k)) { if (member(*r, k)->is_null()) t.erase(k); else t[k] = *member(*r, k); }
        if (has(*r, "length")) t["length"] = *member(*r, "length");
    }
    if (style != nullptr) {
        if (has(*style, "style")) s["style"] = *member(*style, "style");
        if (has(*style, "tags")) t["tags"] = *member(*style, "tags");
    }
    if (sound != nullptr && has(*sound, "timbre")) t["timbre"] = *member(*sound, "timbre");
    // older profiles without organ leave the lever and the drive as they are
    const auto merged = [&](Json& target, const char* key, const Json& over) { // target[key] = { ...target[key], ...over }
        Json base = spreadValue(orNull(member(target, key)));
        const Json extra = spreadValue(over);
        for (auto it = extra.begin(); it != extra.end(); ++it) base[it.key()] = it.value();
        target[key] = std::move(base);
    };
    if (sound != nullptr && has(*sound, "organ")) merged(s, "organ", *member(*sound, "organ"));
    if (voices != nullptr) {
        if (has(*voices, "voices")) merged(t, "voices", *member(*voices, "voices"));
        if (has(*voices, "jobs")) merged(t, "jobs", *member(*voices, "jobs"));
    }
    if (layers != nullptr && has(*layers, "layers")) merged(t, "layers", *member(*layers, "layers"));
    if (mixer != nullptr && has(*mixer, "mix")) merged(s, "mix", *member(*mixer, "mix"));
    if (mixer != nullptr && has(*mixer, "pan")) merged(s, "pan", *member(*mixer, "pan")); // older profiles without pan leave the position as it is
    if (variant != nullptr) for (const char* k : { "seed", "variety" }) if (has(*variant, k)) t[k] = *member(*variant, k);
    if (form != nullptr && has(*form, "form")) t["form"] = *member(*form, "form");
    else if (r != nullptr && has(*r, "length") && isValidFormValue(orNull(member(t, "form")))
             && nearestSize(numberOf(*member(*r, "length"))) != nearestSize(formLengthOf(t.at("form")))) {
        // only a length and no form in the profile: the form is rolled again for another nearest target size (locks fall as with the target size);
        // with the same target size the form stays with its locks
        const Json& old = t.at("form");
        const Json* automatic = member(old, "auto");
        Json args = Json::object({ { "template", automatic != nullptr && truthy(*automatic) ? Json("auto") : orNull(member(old, "template")) }, { "style", orNull(member(s, "style")) },
                                   { "targetBars", *member(*r, "length") }, { "feel", orNull(member(old, "feel")) }, { "seed", orNull(member(t, "seed")) }, { "tags", orNull(member(t, "tags")) } });
        t["form"] = rollForm(args);
    }

    const Json errors = trackErrors(normalizedTrack(t));
    if (!errors.empty()) return Json::object({ { "ok", false }, { "errors", errors } });
    if (isValidFormValue(orNull(member(t, "form")))) t["length"] = num(formLengthOf(t.at("form"))); // with a form the sum of the parts is the length
    s["track"] = std::move(t);
    return Json::object({ { "ok", true }, { "session", std::move(s) } });
}

Json partIdsOf(const Json& parts) {
    Json out = Json::array();
    for (const std::string& id : partIds()) if (member(parts, id) != nullptr) out.push_back(id);
    return out;
}

Json mergeParts(const Json& base, const Json& over) {
    Json out = Json::object();
    for (const std::string& id : partIds()) {
        if (const Json* v = member(over, id)) out[id] = *v;
        else if (const Json* b = member(base, id)) out[id] = *b;
    }
    return out;
}

// ---------- profile.js ----------

Json LIMITS() { return Json::object({ { "name", NAME_LIMIT }, { "depth", DEPTH_LIMIT }, { "nodes", NODE_LIMIT }, { "file", FILE_LIMIT } }); }
Json FORMATS() { return Json::object({ { "FORMAT_PROFILE", "backingtrack-profile" }, { "FORMAT_FOLDER", "backingtrack-folder" }, { "PROFILE_VERSION", 2 }, { "FOLDER_VERSION", 1 } }); }

Json makeProfileFile(const Json& node) {
    return Json::object({ { "format", "backingtrack-profile" }, { "version", 2 }, { "name", cleanName(member(node, "name")) }, { "parts", sanitizeParts(orNull(member(node, "parts"))).at("parts") } });
}

Json makeFolderFile(const Json& node) {
    // exportNode({ ...node, type: 'folder' }).items: the root is exported as a folder whatever its type
    Json items = Json::array();
    const Json* list = member(node, "items");
    if (list != nullptr && list->is_array()) for (const Json& item : *list) { Json e = exportNode(item); if (!e.is_null()) items.push_back(std::move(e)); }
    Json out = Json::object({ { "format", "backingtrack-folder" }, { "version", 1 }, { "name", cleanName(member(node, "name")) } });
    const Json* backup = member(node, "backup");
    if (backup != nullptr && *backup == true) out["backup"] = true;
    out["items"] = std::move(items);
    return out;
}

namespace { Json parseValue(const Json& raw); }

Json parseFile(const Json& input) {
    // shortcut: a text that nests deeper than 64 levels counts as no JSON (track.cpp), where the web reads it; folders nest 8 deep at most, so no valid file comes near it, upgrade: if a format ever nests deeper
    try { // mirrors the JavaScript's try/catch at this place; no input known that reaches it
        if (!input.is_string()) return parseValue(input);
        const std::string& text = input.get_ref<const std::string&>();
        if (utf16Length(text) > FILE_LIMIT) return REJECT; // before anything is parsed or copied
        return parseValue(parsedText(text));
    } catch (const std::exception&) { return REJECT; }
}

namespace {
// the file as a value
Json parseValue(const Json& raw) {
    if (!raw.is_object()) return REJECT;
    Read st;
    const Json* format = member(raw, "format");
    Json node;
    if (format != nullptr && *format == "backingtrack-folder") {
        const Json* backup = member(raw, "backup");
        if (backup != nullptr && !backup->is_boolean()) ++st.skipped;
        const bool isBackup = backup != nullptr && *backup == true;
        if (isBackup) st.nodes = -1; // a backup: the root is only a container, its entries have level 1 and it is no node itself
        node = readNode(raw, isBackup ? 0 : 1, st, true);
        if (node.is_null() || node.at("items").empty()) return REJECT;
        if (isBackup) node["backup"] = true;
    } else if (format != nullptr && *format == "backingtrack-profile") {
        Json parts;
        if (member(raw, "parts") == nullptr) parts = legacyParts(raw, st.skipped);
        else { const Json r = sanitizeParts(*member(raw, "parts")); st.skipped += r.at("skipped").get<int>(); parts = r.at("parts"); }
        if (parts.is_null() || parts.empty()) return REJECT;
        node = Json::object({ { "type", "profile" }, { "name", cleanName(member(raw, "name")) }, { "parts", std::move(parts) } });
    } else return REJECT;
    return Json::object({ { "ok", true }, { "node", std::move(node) }, { "skipped", st.skipped } });
}
} // namespace

// ---------- ui/profile-factory.js, ui/profile-session.js, ui/session-store.js ----------

Json factoryProfiles() {
    Json out = Json::array();
    for (const Json& p : music().at("styles")) out.push_back(Json::object({ { "key", "factory:" + p.at("id").get<std::string>() }, { "styleId", p.at("id") } }));
    return out;
}

Json factoryParts(const std::string& styleId) {
    for (const Json& p : music().at("styles")) {
        if (p.at("id") != styleId) continue;
        return Json::object({ { "tempo", Json::object({ { "bpm", p.at("bpm") }, { "meter", Json::array({ 4, 4 }) } }) },
                              { "style", Json::object({ { "style", p.at("id") }, { "tags", p.at("tags") } }) },
                              { "sound", Json::object({ { "timbre", Json::object() } }) },
                              { "voices", Json::object({ { "voices", p.at("voices") } }) } });
    }
    throw std::invalid_argument("factoryParts: no such style");
}

namespace {
const std::vector<std::string>& sessionFields() { static const std::vector<std::string> f { "track", "scale", "style", "chordColor", "chordColorFromStyle", "mix", "pan", "organ" }; return f; }
} // namespace

Json readSession(const Json& state) {
    if (!state.is_object()) throw std::invalid_argument("readSession: no state");
    Json out = Json::object();
    for (const std::string& k : sessionFields()) if (const Json* v = member(state, k)) out[k] = *v;
    return out;
}

void writeSession(Json& state, const Json& session) {
    if (!state.is_object() || !isObject(orNull(member(state, "track"))) || !session.is_object() || !isObject(orNull(member(session, "track"))))
        throw std::invalid_argument("writeSession: no state or session");
    const Json st = state.at("track"); // copies: `state` gets new fields below, which would invalidate references into it
    const Json& sn = session.at("track");
    const auto same = [](const Json* a, const Json* b) { return (a == nullptr && b == nullptr) || (a != nullptr && b != nullptr && *a == *b); }; // ===, for numbers and texts
    // tempo or meter come from the profile now: the remembered value of the last change of meter no longer holds (else it stays)
    if (!same(member(st, "bpm"), member(sn, "bpm")) || meterKey(orNull(member(st, "meter"))) != meterKey(orNull(member(sn, "meter")))) state.erase("tempoRef");
    // the target size and the knobs of the page follow the loaded form (applyParts has set the length from the sum already, or rolled it again);
    // an untouched form keeps its target size, also if the sum is a little off
    const Json* form = member(sn, "form");
    if (isValidFormValue(orNull(form))) state["formFeel"] = spreadValue(orNull(member(*form, "feel")));
    const std::optional<std::string> now = form != nullptr ? std::optional<std::string>(stringify(*form)) : std::nullopt;
    const Json* before = member(st, "form");
    const std::optional<std::string> was = before != nullptr ? std::optional<std::string>(stringify(*before)) : std::nullopt;
    if (!same(member(sn, "length"), member(st, "length")) || now != was) {
        const Json* length = member(sn, "length");
        if (length == nullptr || !length->is_number()) throw std::invalid_argument("writeSession: length is no number"); // shortcut: a length is a number (applyParts), upgrade: if a caller hands another kind
        state["formTarget"] = num(nearestSize(length->get<double>()));
    }
    for (const std::string& k : sessionFields()) { if (const Json* v = member(session, k)) state[k] = *v; else state.erase(k); }
    // not here: saveMix(layoutStorage, state.mix, state.pan), the browser's memory of the mixer; the session writes it after this (session.cpp, mix.json)
    state["notice"] = nullptr;
    state["errors"] = Json::array();
}

Json saveLast(Storage& storage, const Json& session, const Json& bar, const Json& at) {
    Json entry = Json::object({ { "parts", captureParts(session, Json()) }, { "bar", bar }, { "at", at } });
    storage.write(SESSION_NAME, stringify(entry)); // a failing write is ignored: without storage the entry holds until the page is loaded again
    return entry;
}

Json loadLast(Storage& storage) {
    try { // mirrors the JavaScript's try/catch at this place; no input known that reaches it
        const std::optional<std::string> text = storage.read(SESSION_NAME);
        const Json raw = text ? parsedText(*text) : Json();
        if (!raw.is_object()) return Json(); // the web: raw?.parts of anything else is undefined, and sanitizeParts of that has no parts
        const Json parts = sanitizeParts(orNull(member(raw, "parts"))).at("parts");
        for (const char* id : { "harmony", "tempo", "style", "variant" }) if (!parts.contains(id)) return Json(); // without them the session can be neither continued nor named
        const Json* scale = member(parts.at("harmony"), "scale");
        const Json* styleId = member(parts.at("style"), "style");
        if (scale == nullptr || !truthy(*scale) || styleId == nullptr || !truthy(*styleId)) return Json();
        const Json* bar = member(raw, "bar");
        const Json* at = member(raw, "at");
        return Json::object({ { "parts", parts }, { "bar", isInteger(bar) && bar->get<double>() >= 0 ? *bar : Json(0) }, { "at", isFiniteNumber(at) ? *at : Json() } });
    } catch (const std::exception&) { return Json(); }
}

} // namespace btg::detail
