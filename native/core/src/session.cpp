// The web app's state and the rules that change it (native/PROTOKOLL.md). The state is the JSON object of src/ui/state.js (the fields of PROTOKOLL.md,
// section 4) plus `touched` of app.js, `selected` of form-strip.js (selectedPart), the web's `errors`, what the profile window holds (`profiles`: selection, open
// folders, message), `resumed` and `legacy`; the tree, what "undo" keeps and the last session are held beside it (Session::Memory). The functions below are state.js's and
// the handlers' with their names, line by line, on that object.
// native/core/tests/test_logic.cpp (function `session`) plays the sequences of native/tools/export-logic.mjs against native/tools/session-reference.mjs.
#include "btg/session.h"

#include "btg/analysis.h"
#include "form_internal.h"
#include "generator_internal.h"
#include "harmony.h"
#include "profiles.h"
#include "sound_data.h"
#include "sound_model.h"
#include "timbre.h"
#include "track_internal.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <vector>

extern const unsigned char btg_grooves_json[]; // native/core/data/grooves.json, embedded by CMake
extern const unsigned int btg_grooves_json_size;

namespace btg {
namespace {

using detail::convertTempo;
using detail::Json;
using detail::keysOf;
using detail::layerIds;
using detail::meterKey;
using detail::mixNames;
using detail::num;
using detail::numberOf;
using detail::oneOf;
using detail::scaleNames;
using detail::styleIds;
using detail::truthy;
using detail::voiceLayers;
using Change = Session::Change;

// ---------- the tables (music.json, grooves.json, sound.json) ----------

const Json& music() { return detail::musicTable(); }
const Json& grid(const std::string& meterKey) { return music().at("meterGrid").at(meterKey); } // METERS[key]: { beats, sub }
const Json& preset(const std::string& id) { // state.js preset(id)
    for (const Json& p : music().at("styles")) if (p.at("id") == id) return p;
    throw std::invalid_argument("no such style");
}
const std::set<std::string>& timbrePaths() { // DEFAULT_TIMBRE as "group.field"
    static const std::set<std::string> paths = [] {
        std::set<std::string> out;
        detail::Timbre t;
        detail::forEachField(t, [&](const char* g, const char* f, double&) { out.insert(std::string(g) + "." + f); });
        return out;
    }();
    return paths;
}
bool isTimbreGroup(const std::string& group) { const auto it = timbrePaths().lower_bound(group + "."); return it != timbrePaths().end() && it->rfind(group + ".", 0) == 0; }
std::vector<std::string> groovesFor(const std::string& key) { // grooves.js: Object.keys(GROOVES).filter((id) => GROOVES[id].meter === key)
    static const Json grooves = Json::parse(btg_grooves_json, btg_grooves_json + btg_grooves_json_size);
    std::vector<std::string> out;
    for (auto it = grooves.begin(); it != grooves.end(); ++it) if (it.value().at("meter") == key) out.push_back(it.key());
    return out;
}
const Json& jobsFor(const std::string& layer) { return music().at("layers").at(layer).at("jobs"); } // layers.js jobsFor (a layer of LAYER_IDS)

// ---------- what the controls can send (session-reference.mjs: int, oneOf, isDraw, isFrom) ----------

const Json& field(const Json& a, const char* name) { return detail::orNull(detail::member(a, name)); } // null for a field the action does not have (the web's undefined)
bool isNullField(const Json& a, const char* name) { const auto it = a.find(name); return it != a.end() && it->is_null(); } // `=== null`: given as null, not missing
bool isInt(const Json& v, double lo, double hi) { // Number.isInteger(v) && v >= lo && v <= hi
    if (!v.is_number()) return false;
    const double d = v.get<double>();
    return std::isfinite(d) && std::floor(d) == d && d >= lo && d <= hi;
}
bool oneOf(const Json& v, const Json& list) { return v.is_string() && std::find(list.begin(), list.end(), v) != list.end(); }
bool isDraw(const Json& v) { return v.is_number() && v.get<double>() >= 0 && v.get<double>() < 1; } // Math.random()
bool isFrom(const Json& v) { return v == "start" || v == "play"; }
bool isVariant(const Json& v) { return isInt(v, 1, 9999); }
bool isDir(const Json& v) { return v.is_number() && (v.get<double>() == -1 || v.get<double>() == 1); }
const Json& pick(const Json& list, double r) { return list.at(static_cast<size_t>(std::floor(r * static_cast<double>(list.size())))); } // app.js 209 with the draw from the action

// ---------- grooves.js ----------

bool isMeterKey(const std::string& key) { return music().at("meterGrid").contains(key); } // Object.hasOwn(METERS, key)
int subOf(const std::string& key) { return grid(key).at("sub").get<int>(); }

// ---------- core/voices.js ----------

const Json& voiceKinds() { return music().at("voiceKinds"); }
std::string voiceKind(const Json& voices) { // 'sample' when every layer has a sample voice, 'synth' when none, else 'mixed'
    const Json full = detail::completeVoices(voices);
    size_t samples = 0;
    for (const std::string& layer : voiceLayers()) if (voiceKinds().at(layer).at(full.at(layer).at("id").get<std::string>()).at("kind") == "sample") ++samples;
    return samples == voiceLayers().size() ? "sample" : samples == 0 ? "synth" : "mixed";
}
Json setAllVoices(const std::string& kind) { // DEFAULT_VOICES (the first sample variant) or SYNTH per layer
    Json out = Json::object();
    for (const std::string& layer : voiceLayers())
        out[layer] = kind == "sample" ? Json::object({ { "id", "sample" }, { "variant", music().at("voices").at(layer).at("sample").at(0) } }) : Json::object({ { "id", "synth" }, { "variant", "classic" } });
    return out;
}
std::string voiceKeys(const Json& voices) { // voices-panel.js 91: what render compares, `${id}/${variant}` per layer
    const Json full = detail::completeVoices(voices);
    std::string out;
    for (const std::string& layer : voiceLayers()) out += full.at(layer).at("id").get<std::string>() + "/" + full.at(layer).at("variant").get<std::string>() + ",";
    return out;
}

// ---------- ui/tags-ui.js toggleTag ----------

// The choice as { category: [tags] } in the order of TAG_CATEGORIES, empty categories left out. Domain: tags of { category: [list] } (the session's own).
Json toggleTag(const Json& tags, const std::string& category, const std::string& tag) {
    Json out = Json::object();
    for (const Json& c : music().at("tags")) {
        const std::string id = c.at("id");
        const Json* chosen = tags.is_object() && tags.contains(id) && tags.at(id).is_array() ? &tags.at(id) : nullptr; // (tags[c.id] ?? [])
        Json list = Json::array();
        for (const Json& x : c.at("tags")) {
            const bool has = chosen != nullptr && std::find(chosen->begin(), chosen->end(), x) != chosen->end();
            if (has != (id == category && x == tag)) list.push_back(x);
        }
        if (!list.empty()) out[id] = list;
    }
    return out;
}

// ---------- ui/state.js ----------

Json& trackOf(Json& s) { return s.at("track"); }
bool hasForm(const Json& t) { return t.contains("form") && truthy(t.at("form")); }

// derivedBars: the progression of the key and the variant in a chord colour, without changing the state
Json derivedBars(const Json& s, const Json& color) {
    const Json& t = s.at("track");
    const Json& beats = grid(meterKey(t.at("meter"))).at("beats");
    Json bars = Json::array();
    for (const Json& chord : detail::progressionFor(t.at("key"), t.at("seed"))) bars.push_back(Json::object({ { "chord", chord }, { "beats", beats } }));
    return detail::colorProgression(bars, color, t.at("key"));
}
std::string styleColor(const Json& s) { const Json& t = s.at("track"); return detail::styleChordColor(s.at("style"), t.at("seed"), truthy(t.at("variety"))); }

void deriveBars(Json& s) {
    s["notice"] = nullptr;
    if (s.at("chordColorFromStyle") == true) s["chordColor"] = styleColor(s);
    trackOf(s)["bars"] = derivedBars(s, s.at("chordColor"));
}

void setChordColor(Json& s, const std::string& color) {
    const bool untouched = trackOf(s).at("bars") == derivedBars(s, s.at("chordColor")); // JSON.stringify(a) === JSON.stringify(b): ordered_json compares keys in order
    s["chordColor"] = color;
    if (untouched) deriveBars(s);
    else trackOf(s)["bars"] = detail::colorProgression(trackOf(s).at("bars"), Json(color), trackOf(s).at("key"));
    s["notice"] = nullptr;
}

Json formChoice(const Json& t) { return hasForm(t) ? (truthy(t.at("form").value("auto", Json())) ? Json("auto") : t.at("form").value("template", Json())) : Json("off"); }
Json feelNow(const Json& s) { // state.track.form?.feel ?? state.formFeel
    const Json& t = s.at("track");
    return hasForm(t) && t.at("form").contains("feel") && !t.at("form").at("feel").is_null() ? t.at("form").at("feel") : s.at("formFeel");
}

void roll(Json& s, const Json& choice, const Json* previous, double salt) {
    Json& t = trackOf(s);
    Json args = Json::object({ { "template", choice }, { "style", s.at("style") }, { "targetBars", s.at("formTarget") }, { "feel", feelNow(s) },
                               { "seed", num(numberOf(t.at("seed")) + salt * 10000) }, { "tags", t.at("tags") } });
    if (previous != nullptr) args["previous"] = *previous;
    const Json form = detail::rollForm(args);
    s["formSalt"] = num(salt);
    t["form"] = form;
    t["length"] = num(detail::formLengthOf(form));
}

void rollNewForm(Json& s, bool reroll) {
    Json& t = trackOf(s);
    if (!hasForm(t)) return;
    const Json previous = t.at("form");
    roll(s, formChoice(t), &previous, reroll ? numberOf(s.at("formSalt")) + 1 : 0);
}

void setFormTemplate(Json& s, const std::string& choice) {
    if (choice == "off") {
        trackOf(s).erase("form");
        trackOf(s)["length"] = s.at("formTarget");
    } else roll(s, Json(choice), nullptr, 0);
}

void setFormTarget(Json& s, double bars) {
    s["formTarget"] = num(bars);
    if (hasForm(trackOf(s))) roll(s, formChoice(trackOf(s)), nullptr, 0);
    else trackOf(s)["length"] = num(bars);
}

void setFormFeel(Json& s, const std::string& name, double value) {
    Json feel = feelNow(s);
    feel[name] = num(value);
    s["formFeel"] = feel;
    if (hasForm(trackOf(s))) trackOf(s)["form"]["feel"] = feel;
}

void applyStyle(Json& s, const std::string& id) {
    const Json& p = preset(id);
    s["style"] = id;
    s["chordColorFromStyle"] = true;
    setChordColor(s, detail::styleChordColor(Json(id), trackOf(s).at("seed"), truthy(trackOf(s).at("variety"))));
    Json& t = trackOf(s);
    // the style's tempo is a quarter tempo: in 6/8 and 12/8 the same speed of eighths holds
    t["bpm"] = num(convertTempo(numberOf(p.at("bpm")), "4/4", meterKey(t.at("meter"))));
    t["tags"] = p.at("tags");
    Json voices = t.at("voices"); // { ...state.track.voices, ...p.voices }
    for (auto it = p.at("voices").begin(); it != p.at("voices").end(); ++it) voices[it.key()] = it.value();
    t["voices"] = detail::completeVoices(voices);
    t["timbre"] = Json::object();
    if (hasForm(t) && truthy(t.at("form").value("auto", Json()))) rollNewForm(s, false);
}

bool setMeter(Json& s, const std::string& key) {
    Json& t = trackOf(s);
    const std::string prev = meterKey(t.at("meter"));
    if (!isMeterKey(key) || key == prev) return false;
    const Json& ref = s.at("tempoRef");
    const bool untouched = ref.is_object() && ref.at("key") == prev && numberOf(ref.at("shown")) == numberOf(t.at("bpm"));
    const double quarter = untouched ? numberOf(ref.at("quarter")) : numberOf(t.at("bpm")) * (subOf(prev) == 3 ? 3.0 / 2.0 : 1);
    const double bpm = std::min(200.0, std::max(40.0, detail::jsRound(quarter * (subOf(key) == 3 ? 2.0 / 3.0 : 1))));
    s["tempoRef"] = Json::object({ { "key", key }, { "quarter", num(quarter) }, { "shown", num(bpm) } });
    const size_t slash = key.find('/');
    t["meter"] = Json::array({ std::stoi(key.substr(0, slash)), std::stoi(key.substr(slash + 1)) }); // key.split('/').map(Number)
    t.erase("groove");
    t["bpm"] = num(bpm);
    for (Json& bar : t["bars"]) bar["beats"] = grid(key).at("beats");
    return true;
}

// key-scale.js
void chooseRoot(Json& s, const std::string& root) {
    trackOf(s)["key"] = Json::object({ { "root", root }, { "mode", music().at("scaleModes").at(s.at("scale").get<std::string>()) } });
    deriveBars(s);
}
void chooseScale(Json& s, const std::string& scale) {
    s["scale"] = scale;
    const Json root = trackOf(s).at("key").at("root");
    trackOf(s)["key"] = Json::object({ { "root", root }, { "mode", music().at("scaleModes").at(scale) } });
    deriveBars(s);
}

// progression-editor.js
constexpr size_t MAX_CHORDS = 8; // state.js 22
bool addChord(Json& s, const Json& root, const Json& quality) {
    Json& t = trackOf(s);
    if (t.at("bars").size() >= MAX_CHORDS) {
        s["notice"] = "ui.progressionFull";
        s["refusals"] = num(numberOf(s.at("refusals")) + 1); // refusals++: the page says the notice again
        return false;
    }
    t["bars"].push_back(Json::object({ { "chord", Json::object({ { "root", root }, { "quality", quality } }) }, { "beats", grid(meterKey(t.at("meter"))).at("beats") } }));
    s["notice"] = nullptr;
    return true;
}

// ---------- ui/mix-state.js: the mixer's memory (mix.json, the web's backingtrack.mix) ----------

double defaultPan(const std::string& layer) { return detail::soundData().tunables.at("mix/pan").at(layer).value; } // DEFAULT_PAN: the fine values mix/pan
// sanitize: per name a number in 0..1 stays, anything else is 1; sanitizePan: per layer a number in -1..1 stays, anything else is the default
Json sanitizeMix(const Json& raw) {
    Json out = Json::object();
    for (const std::string& name : mixNames()) {
        const Json& v = detail::orNull(detail::member(raw, name));
        out[name] = v.is_number() && v.get<double>() >= 0 && v.get<double>() <= 1 ? v : Json(1);
    }
    return out;
}
Json sanitizePan(const Json& raw) {
    Json out = Json::object();
    for (const std::string& layer : layerIds()) {
        const Json& v = detail::orNull(detail::member(raw, layer));
        out[layer] = v.is_number() && v.get<double>() >= -1 && v.get<double>() <= 1 ? v : num(defaultPan(layer));
    }
    return out;
}
// saveMix(storage, state.mix, state.pan): { ...sanitize(mix), pan: sanitizePan(pan) } (the pan is always given: state.pan)
void saveMix(Storage& storage, const Json& s) {
    Json stored = sanitizeMix(s.at("mix"));
    stored["pan"] = sanitizePan(s.at("pan"));
    storage.write(detail::MIX_NAME, detail::stringify(stored)); // a failing write is ignored: without storage the mixer holds until the page is loaded again
}

// The start state of the web app for a variant: the literal of state.js 58-90 (seed: the variant for rollVariant()), then app.js 484-485
Json startState(double variant) {
    const Json& funk = preset("funk");
    Json layers = Json::object();
    for (auto it = music().at("layers").begin(); it != music().at("layers").end(); ++it) layers[it.key()] = it.value().at("defaultOn"); // layerDefaults()
    Json track = Json::object({ { "key", Json::object({ { "root", "A" }, { "mode", "minor" } }) }, { "bpm", funk.at("bpm") }, { "bars", Json::array() }, { "tags", funk.at("tags") },
                                { "voices", detail::completeVoices(funk.at("voices")) }, { "timbre", Json::object() }, { "layers", layers }, { "jobs", detail::completeJobs(Json()) },
                                { "seed", num(variant) }, { "variety", true }, { "length", 96 }, { "meter", Json::array({ 4, 4 }) } });
    Json mix = Json::object(), pan = Json::object(); // loadMix and loadPan of an empty storage: DEFAULT_MIX (all 1), DEFAULT_PAN (the fine values mix/pan)
    for (const std::string& name : mixNames()) mix[name] = 1;
    for (const std::string& layer : layerIds()) pan[layer] = num(detail::soundData().tunables.at("mix/pan").at(layer).value);
    Json s = Json::object({ { "track", track }, { "formTarget", 96 }, { "formSalt", 0 }, { "formFeel", music().at("form").at("feelDefaults") }, { "scale", "minorPentatonic" },
                            { "chordColor", "triads" }, { "chordColorFromStyle", true }, { "style", "funk" }, { "mix", mix }, { "pan", pan },
                            { "organ", music().at("organ").at("default") }, { "tempoRef", nullptr },
                            { "touched", Json::object({ { "key", false }, { "style", false }, { "tempo", false }, { "variant", false } }) },
                            { "selectedPart", 0 }, // form-strip.js 35: `selected`
                            { "errors", Json::array() }, { "resumed", nullptr }, { "legacy", nullptr }, // state.js 88; no resume, no take-over
                            { "notice", nullptr }, { "refusals", 0 }, { "rollNote", false } }); // state.js 89; progression-editor.js 11; form-strip.js 37
    deriveBars(s);
    setFormTemplate(s, "auto");
    return s;
}

// ---------- reading the storage (PROTOKOLL.md sections 2 and 3a) ----------

// What the constructor and reloadProfiles read of a name: nothing stored, unreadable (the storage threw, or the text is above 20,000,000 bytes: it is not parsed), or a text
constexpr size_t STORED_LIMIT = 20000000;
struct Stored { std::optional<std::string> text; bool unreadable = false; };
Stored readStored(Storage& storage, const char* name) {
    try {
        std::optional<std::string> text = storage.read(name);
        if (text && text->size() > STORED_LIMIT) return { std::nullopt, true };
        return { std::move(text), false };
    } catch (...) { return { std::nullopt, true }; }
}
// Where the web's loadTree calls defaultMakeId: "1", "2", ..., each no `id` of an object anywhere in the stored value (PROTOKOLL.md section 2). shortcut: the one place where
// the core names ids itself, the constructor having no action that could bring them; the ids of repaired stored nodes are predictable, upgrade: if the shell should name them
detail::MakeId freeIds(const Json& raw) {
    const auto used = std::make_shared<std::set<std::string>>();
    const std::function<void(const Json&)> walk = [&](const Json& v) {
        if (v.is_array()) for (const Json& x : v) walk(x);
        if (!v.is_object()) return;
        if (const Json* id = detail::member(v, "id"); id != nullptr && id->is_string()) used->insert(id->get<std::string>());
        for (auto it = v.begin(); it != v.end(); ++it) walk(it.value());
    };
    walk(raw);
    const auto k = std::make_shared<long long>(0);
    return [used, k] { std::string id; do id = std::to_string(++*k); while (used->count(id)); return id; };
}
// profiles.json as read, parsed once: the tree and what state().storage names; a damaged or newer text is kept for profiles.damaged.json or profiles.newer.json, `version`
// is that of a newer tree. Throws where treeOf throws (no input is known).
// shortcut: a text nested deeper than 64 levels counts as no JSON, so as damaged (track.cpp's reader), where the web reads it, upgrade: with the reader's limit
struct LoadedTree { Json tree; Json problem; std::string keep; Json version; };
LoadedTree loadProfiles(const Stored& stored) {
    if (stored.unreadable) return { detail::newTree(), "unreadable", "", Json() };
    if (!stored.text) return { detail::newTree(), Json(), "", Json() };
    const Json raw = detail::parsedText(*stored.text);
    std::optional<Json> tree = detail::treeOf(raw, freeIds(raw));
    if (!tree) return { detail::newTree(), "damaged", *stored.text, Json() };
    // The user's decision of 2026-11-24 ("sichern, melden und dann überschreiben klingt gut"), against the web, which writes over it in silence: a tree whose version is
    // a number above the one saveTree writes is read as far as this version knows it, named with its version and kept before the first write over it
    const Json* version = detail::member(raw, "version");
    if (version != nullptr && version->is_number() && version->get<double>() > detail::STORED_VERSION) return { std::move(*tree), "newer", *stored.text, *version };
    return { std::move(*tree), Json(), "", Json() };
}
// where a damaged profiles.json and one of a newer version are kept (PROTOKOLL.md section 3a). shortcut: a later session keeps a second damaged or newer text over the
// first (the shell's .bak holds that one until the next write), upgrade: if the user wants every one kept
constexpr const char* DAMAGED_NAME = "profiles.damaged.json";
constexpr const char* NEWER_NAME = "profiles.newer.json";

// ---------- the handlers (app.js and the panels; session-reference.mjs names their lines) ----------

// What a step writes, held until the whole action is done (Session::apply writes it then, in order): the functions of profiles.h write through a Storage
struct Pending : Storage {
    std::vector<std::pair<std::string, std::string>> texts;
    std::optional<std::string> read(const std::string&) override { return std::nullopt; }
    bool write(const std::string& name, const std::string& text) override { texts.emplace_back(name, text); return true; }
};

struct Step {
    Json& s;
    const Json& a;
    Change& c;
    std::string& pushed; // organ-panel.js 46: the tuning last handed to the player
    const Json playerLength;        // the track the player plays: every action that changes the length or the meter restarts it, so it is the state's before the action
    const std::string playerMeter;
    const Json& tree;               // the profiles before the action
    const Json& undo;               // what "Rückgängig" keeps: null or { tree, selection, message }
    Json& last;                     // the last session: null or { parts, bar, at }
    Storage& shell;                 // the shell's storage: reloadProfiles reads it
    const Json& problems;           // state().storage before the action
    Pending pending {};
    std::optional<Json> newTree {}, newUndo {}; // a commit's tree and undo, taken when its write holds
    std::optional<LoadedTree> reloaded {};      // what reloadProfiles read, or the tree importLegacy took (its tree is newTree)
    Json& t() { return trackOf(s); }
    Json& win() { return s["profiles"]; } // what profiles.js holds: selection, open, message
    void restartIfPlaying(bool inPlace) { c.restart = true; c.inPlace = inPlace; } // app.js 173-181
    // app.js 186-195 while a player runs: setTimbre always, setTempo with tempo, setTrack with patterns. play.js 172-178: setTrack refuses (false) a track of another
    // length, duration or meter than the player's, and the web restarts in place. Every bar has the meter's beats (derivedBars, setMeter, addChord), so the duration
    // follows the length and the meter.
    void applyLive(bool patterns, bool tempo = false) {
        c.sound = true;
        c.tempo = c.tempo || tempo;
        if (!patterns) return;
        if (t().at("length") == playerLength && meterKey(t().at("meter")) == playerMeter) c.events = true;
        else restartIfPlaying(true);
    }
    void renderOrgan() { const std::string key = detail::organTuning(s.at("organ")).dump(); if (key != pushed) { pushed = key; c.sound = true; } } // organ-panel.js 62-64
    void setVariant(const Json& seed) { t()["seed"] = seed; deriveBars(s); rollNewForm(s, false); restartIfPlaying(true); } // app.js 340-346
    void commitFeel(const Json& before) { if (t().at("length") == before) applyLive(true); else restartIfPlaying(true); } // form-panel.js 19
    void commitPart(const Json& result) { // form-strip.js 49-62
        s["rollNote"] = false;
        if (result.is_null()) return;
        const Json before = t().at("length");
        t()["form"] = result.at("form");
        t()["length"] = num(detail::formLengthOf(result.at("form")));
        s["selectedPart"] = result.at("index");
        if (t().at("length") == before) applyLive(true);
        else restartIfPlaying(true);
    }
};

const Json* formNow(const Json& s) { const Json& t = s.at("track"); return t.contains("form") && detail::isValidFormValue(t.at("form")) ? &t.at("form") : nullptr; } // form-strip.js 39
bool isPartIndex(const Json& s, const Json& v) { const Json* f = formNow(s); return f != nullptr && isInt(v, 0, static_cast<double>(f->at("sections").size()) - 1); }
const Json& selectedPart(const Json& s) { return formNow(s)->at("sections").at(s.at("selectedPart").get<size_t>()); } // the inspector's part: a valid form, `selected` clamped to it
// form-strip.js 233-241, at every render: with a form the strip shows, `selected` is clamped to its parts (without one it stays as it is). The web does it only while
// the play page shows the strip; the session does it after every action, as if it did (the selection is read only there).
void clampSelection(Json& s) {
    const Json* f = formNow(s);
    if (f == nullptr) return;
    const double last = static_cast<double>(f->at("sections").size()) - 1;
    s["selectedPart"] = num(std::min(std::max(numberOf(s.at("selectedPart")), 0.0), last));
}
bool showsPercent(const Json& field, const Json& value) { return detail::jsRound(numberOf(field) * 100) == numberOf(value); } // a knob or fader shows String(Math.round(x * 100))
bool organShown(const Json& s) { return detail::completeVoices(s.at("track").at("voices")).at("chords").at("id") == "organ"; } // organ-panel.js 48-50
double feelMax(const std::string& knob) { return knob == "dynamics" ? music().at("form").at("dynamicsMax").get<double>() : 1; } // form-panel.js 12
bool isFeelKnob(const Json& v) { return oneOf(v, keysOf(music().at("form").at("feelDefaults"))); }
double formLimit(const char* name) { return detail::formLimit(name); }

// `same`: the control shows a plain field of the state, and the web sends no event when it is set to the value it shows; such a repeat changes nothing
// (PROTOKOLL.md, section 1). Missing for the controls that fire again (buttons, chips, cards) and those whose shown value is derived.
struct Handler {
    std::function<bool(const Json& s, const Json& a)> valid;
    std::function<void(Step&)> run;
    std::function<bool(const Json& s, const Json& a)> same = nullptr;
};

const std::map<std::string, Handler>& handlers() {
    static const std::map<std::string, Handler> table {
        // a fresh load keeps the mixer and the panorama: they are stored preferences (loadMix, loadPan), read only by the constructor; the profile window, the tree and
        // the last session stay too (PROTOKOLL.md section 2)
        { "start", { [](const Json&, const Json& a) { return isVariant(field(a, "variant")); },
                     [](Step& x) {
                         const Json mix = x.s.at("mix"), pan = x.s.at("pan"), window = x.s.at("profiles");
                         x.s = startState(numberOf(x.a.at("variant")));
                         x.s["mix"] = mix;
                         x.s["pan"] = pan;
                         x.s["profiles"] = window;
                         x.c.events = x.c.sound = x.c.voices = x.c.tempo = x.c.mix = true;
                     } } },
        { "newVariant", { [](const Json&, const Json& a) { return isVariant(field(a, "variant")); }, [](Step& x) { x.setVariant(num(numberOf(x.a.at("variant")))); } } },
        { "stepVariant", { [](const Json&, const Json& a) { return isDir(field(a, "dir")); }, [](Step& x) { // variant.js stepVariant: 1..9999, around at the ends
            x.setVariant(num(std::fmod(numberOf(x.t().at("seed")) - 1 + numberOf(x.a.at("dir")) + 9999, 9999) + 1)); } } },
        { "enterVariant", { [](const Json&, const Json& a) { return isVariant(field(a, "variant")); },
                            [](Step& x) { x.s["touched"]["variant"] = true; x.setVariant(num(numberOf(x.a.at("variant")))); } } },
        // the chips of the start page fire again; the selects of the play page do not (key-scale.js 56-57, app.js 418)
        { "setRoot", { [](const Json&, const Json& a) { return oneOf(field(a, "root"), music().at("roots")) && isFrom(field(a, "from")); },
                       [](Step& x) { chooseRoot(x.s, x.a.at("root")); x.restartIfPlaying(false); if (x.a.at("from") == "start") x.s["touched"]["key"] = true; },
                       [](const Json& s, const Json& a) { return a.at("from") == "play" && a.at("root") == s.at("track").at("key").at("root"); } } },
        { "setScale", { [](const Json&, const Json& a) { return oneOf(field(a, "scale"), scaleNames()) && isFrom(field(a, "from")); },
                        [](Step& x) { chooseScale(x.s, x.a.at("scale")); x.restartIfPlaying(false); if (x.a.at("from") == "start") x.s["touched"]["key"] = true; },
                        [](const Json& s, const Json& a) { return a.at("from") == "play" && a.at("scale") == s.at("scale"); } } },
        { "setStyle", { [](const Json&, const Json& a) { return oneOf(field(a, "style"), styleIds()) && isFrom(field(a, "from")); },
                        [](Step& x) { applyStyle(x.s, x.a.at("style")); if (x.a.at("from") == "start") x.s["touched"]["style"] = true; x.applyLive(true, true); },
                        [](const Json& s, const Json& a) { return a.at("from") == "play" && a.at("style") == s.at("style"); } } },
        // both are ranges showing track.bpm (app.js 415, tuning.js 141-142)
        { "setTempo", { [](const Json&, const Json& a) { return isInt(field(a, "bpm"), 40, 200) && isFrom(field(a, "from")); },
                        [](Step& x) { if (x.a.at("from") == "start") x.s["touched"]["tempo"] = true; x.t()["bpm"] = num(numberOf(x.a.at("bpm"))); x.c.tempo = true; },
                        [](const Json& s, const Json& a) { return numberOf(a.at("bpm")) == numberOf(s.at("track").at("bpm")); } } },
        { "surprise", { [](const Json&, const Json& a) { return isVariant(field(a, "variant")) && isDraw(field(a, "style")) && isDraw(field(a, "tempo")) && isDraw(field(a, "scale")) && isDraw(field(a, "root")); },
            [](Step& x) { // app.js 210-221
                const Json& touched = x.s.at("touched");
                const bool key = touched.at("key") == true, style = touched.at("style") == true, tempo = touched.at("tempo") == true, variant = touched.at("variant") == true;
                const Json bpm = x.t().at("bpm");
                if (!style) applyStyle(x.s, pick(music().at("styles"), numberOf(x.a.at("style"))).at("id"));
                const double styleBpm = convertTempo(numberOf(preset(x.s.at("style")).at("bpm")), "4/4", meterKey(x.t().at("meter")));
                x.t()["bpm"] = tempo ? bpm : num(std::min(200.0, std::max(40.0, detail::jsRound(styleBpm * (0.9 + numberOf(x.a.at("tempo")) * 0.2)))));
                if (!variant) x.t()["seed"] = num(numberOf(x.a.at("variant")));
                if (!key) {
                    x.s["scale"] = pick(Json(scaleNames()), numberOf(x.a.at("scale")));
                    chooseRoot(x.s, pick(music().at("roots"), numberOf(x.a.at("root"))));
                } else deriveBars(x.s);
                rollNewForm(x.s, false);
                x.restartIfPlaying(true);
            } } },
        { "toggleTag", { [](const Json&, const Json& a) {
                const Json& category = field(a, "category");
                if (!category.is_string()) return false;
                for (const Json& c : music().at("tags")) if (c.at("id") == category) return oneOf(field(a, "tag"), c.at("tags"));
                return false; },
            [](Step& x) { // tuning.js 29-34
                const Json before = x.t().at("tags");
                x.t()["tags"] = toggleTag(before, x.a.at("category"), x.a.at("tag"));
                x.applyLive(!detail::isSoundOnlyChange(before, x.t().at("tags")));
            } } },
        { "addChord", { [](const Json& s, const Json& a) {
                if (!field(a, "root").is_string() || !field(a, "quality").is_string()) return false;
                for (const Json& o : detail::chordOptions(s.at("track").at("key"))) if (o.at("root") == a.at("root") && oneOf(a.at("quality"), o.at("qualities"))) return true;
                return false; },
            [](Step& x) { if (addChord(x.s, x.a.at("root"), x.a.at("quality"))) x.restartIfPlaying(false); } } },
        { "removeChord", { [](const Json& s, const Json& a) { const size_t n = s.at("track").at("bars").size(); return n > 1 && isInt(field(a, "index"), 0, static_cast<double>(n) - 1); },
                           [](Step& x) {
                               Json& bars = x.t()["bars"];
                               bars.erase(bars.begin() + static_cast<std::ptrdiff_t>(numberOf(x.a.at("index"))));
                               x.s["notice"] = nullptr; // progression-editor.js 27
                               x.restartIfPlaying(false); } } },
        { "setChordColor", { [](const Json&, const Json& a) { return oneOf(field(a, "color"), keysOf(music().at("chordColors").at("table"))); },
                             [](Step& x) { x.s["chordColorFromStyle"] = false; setChordColor(x.s, x.a.at("color")); x.restartIfPlaying(false); } } },
        { "setMeter", { [](const Json&, const Json& a) { return field(a, "meter").is_string() && isMeterKey(a.at("meter")); },
                        [](Step& x) { if (setMeter(x.s, x.a.at("meter"))) x.restartIfPlaying(true); } } },
        { "setGroove", { [](const Json& s, const Json& a) { return oneOf(field(a, "groove"), groovesFor(meterKey(s.at("track").at("meter")))); },
                         [](Step& x) { x.t()["groove"] = x.a.at("groove"); x.applyLive(true); } } },
        { "setRhythmKnob", { [](const Json&, const Json& a) { return oneOf(field(a, "knob"), std::vector<std::string> { "complexity", "loose", "ornaments" }) && isInt(field(a, "value"), 0, 100); },
                             [](Step& x) { x.t()[x.a.at("knob").get<std::string>()] = num(numberOf(x.a.at("value")) / 100); x.applyLive(true); } } },
        { "setFormTemplate", { [](const Json&, const Json& a) {
                std::vector<std::string> choices { "auto" };
                for (const Json& id : music().at("form").at("templateIds")) choices.push_back(id);
                choices.push_back("off");
                return oneOf(field(a, "template"), choices); },
            [](Step& x) { const Json before = x.t().at("length"); setFormTemplate(x.s, x.a.at("template")); x.commitFeel(before); },
            [](const Json& s, const Json& a) { return a.at("template") == formChoice(s.at("track")); } } }, // form-panel.js 73
        { "setFormTarget", { [](const Json&, const Json& a) {
                const Json& bars = field(a, "bars");
                const Json& sizes = music().at("form").at("targetSizes");
                return bars.is_number() && std::any_of(sizes.begin(), sizes.end(), [&](const Json& n) { return numberOf(n) == numberOf(bars); }); },
            [](Step& x) { const Json before = x.t().at("length"); setFormTarget(x.s, numberOf(x.a.at("bars"))); x.commitFeel(before); },
            [](const Json& s, const Json& a) { return numberOf(a.at("bars")) == numberOf(hasForm(s.at("track")) ? s.at("formTarget") : s.at("track").at("length")); } } }, // form-panel.js 76-77
        { "setFormFeel", { [](const Json& s, const Json& a) {
                return hasForm(s.at("track")) && isFeelKnob(field(a, "knob")) && isInt(field(a, "value"), 0, detail::jsRound(feelMax(a.at("knob")) * 100)); },
            [](Step& x) { setFormFeel(x.s, x.a.at("knob"), numberOf(x.a.at("value")) / 100); if (x.a.at("knob") != "structure") x.applyLive(true); },
            [](const Json& s, const Json& a) { return showsPercent(feelNow(s).at(a.at("knob").get<std::string>()), a.at("value")); } } }, // form-panel.js 79-82
        { "releaseStructure", { [](const Json& s, const Json&) { return hasForm(s.at("track")); },
                                [](Step& x) { const Json before = x.t().at("length"); rollNewForm(x.s, false); x.commitFeel(before); } } },
        // the strip and the inspector stand only with a valid form (form-strip.js 233-240); the inspector edits the selected part (63-64, `selected`)
        { "selectPart", { [](const Json& s, const Json& a) { return isPartIndex(s, field(a, "index")); }, // form-strip.js 66-77, 104-112: a click, or a key that moves the selection
                          [](Step& x) { x.s["rollNote"] = false; x.s["selectedPart"] = num(numberOf(x.a.at("index"))); } } }, // choose, 67
        { "editPart", { [](const Json& s, const Json& a) {
                if (formNow(s) == nullptr) return false;
                const Json& part = selectedPart(s);
                const Json& f = field(a, "field");
                const Json& value = field(a, "value");
                const bool reset = isNullField(a, "value");
                if (f == "type") return oneOf(value, music().at("form").at("partTypes"));
                if (f == "transition") return oneOf(value, music().at("form").at("transitions"));
                if (f == "crash") return value.is_boolean();
                // the resets are disabled while the part has no value of its own (s.level == null)
                if (f == "level") return reset ? part.contains("level") && !part.at("level").is_null() : isInt(value, formLimit("levelMin"), formLimit("levelMax"));
                if (f == "density") return reset ? part.contains("density") && !part.at("density").is_null() : isInt(value, formLimit("densityMin") * 100, formLimit("densityMax") * 100);
                if (f == "bars") return isInt(value, 1, formLimit("bars"));
                return false; },
            [](Step& x) {
                const std::string name = x.a.at("field");
                const Json& v = x.a.at("value");
                const Json value = v.is_null() ? Json(Json::value_t::discarded) : name == "density" ? num(numberOf(v) / 100) : v; // a discarded value is editPart's undefined: the reset
                x.commitPart(detail::editPart(*formNow(x.s), x.s.at("selectedPart"), Json::object({ { name, value } })));
            },
            // the type select shows the part's type (form-strip.js 195); the grip sends a length only when it differs (94); level, density and transition show derived values
            [](const Json& s, const Json& a) { return (a.at("field") == "type" || a.at("field") == "bars") && a.at("value") == selectedPart(s).at(a.at("field").get<std::string>()); } } },
        { "toggleLock", { [](const Json& s, const Json&) { return formNow(s) != nullptr; },
                          [](Step& x) { x.commitPart(detail::setLocked(*formNow(x.s), x.s.at("selectedPart"), !truthy(selectedPart(x.s).value("locked", Json())))); } } },
        { "deletePart", { [](const Json& s, const Json&) { return formNow(s) != nullptr; }, [](Step& x) { x.commitPart(detail::deletePart(*formNow(x.s), x.s.at("selectedPart"))); } } },
        { "movePart", { [](const Json& s, const Json& a) { return formNow(s) != nullptr && isDir(field(a, "dir")); },
                        [](Step& x) { x.commitPart(detail::movePart(*formNow(x.s), x.s.at("selectedPart"), x.a.at("dir"))); } } },
        { "copyPart", { [](const Json& s, const Json&) { return formNow(s) != nullptr; }, [](Step& x) { x.commitPart(detail::copyPart(*formNow(x.s), x.s.at("selectedPart"))); } } },
        { "addPart", { [](const Json& s, const Json&) { return formNow(s) != nullptr; }, [](Step& x) { x.commitPart(detail::addPart(*formNow(x.s))); } } },
        // the button stands only with a form (form-strip.js 235). Its branch for a form that is not valid (setFormTemplate of its template) is left out: no action makes one,
        // and none can bring one (applyParts refuses a track whose form is not valid, profile-parts.js 269-270, so loadProfile and resume cannot), so it is not valid then
        { "rerollForm", { [](const Json& s, const Json&) { return formNow(s) != nullptr; },
                          [](Step& x) {
                              const Json& sections = formNow(x.s)->at("sections");
                              if (std::all_of(sections.begin(), sections.end(), [](const Json& part) { return truthy(part.value("locked", Json())); })) { x.s["rollNote"] = true; return; } // 133
                              x.s["rollNote"] = false; // 136
                              const Json before = x.t().at("length");
                              rollNewForm(x.s, true);
                              if (x.t().at("length") == before) x.applyLive(true);
                              else x.restartIfPlaying(true);
                          } } },
        { "setLevel", { [](const Json&, const Json& a) { return oneOf(field(a, "channel"), mixNames()) && isInt(field(a, "value"), 0, 100); },
                        [](Step& x) { x.s["mix"][x.a.at("channel").get<std::string>()] = num(numberOf(x.a.at("value")) / 100); saveMix(x.pending, x.s); x.c.mix = true; }, // mixer.js 21, 37
                        [](const Json& s, const Json& a) { return showsPercent(s.at("mix").at(a.at("channel").get<std::string>()), a.at("value")); } } }, // mixer.js 101-103
        { "setPan", { [](const Json&, const Json& a) { return oneOf(field(a, "layer"), layerIds()) && isInt(field(a, "value"), -100, 100); },
                      [](Step& x) { x.s["pan"][x.a.at("layer").get<std::string>()] = num(numberOf(x.a.at("value")) / 100); saveMix(x.pending, x.s); x.c.mix = true; }, // mixer.js 21, 57
                      [](const Json& s, const Json& a) { return showsPercent(s.at("pan").at(a.at("layer").get<std::string>()), a.at("value")); } } }, // mixer.js 111-112
        { "toggleMute", { [](const Json&, const Json& a) { return oneOf(field(a, "layer"), layerIds()); },
                          [](Step& x) { Json& on = x.t()["layers"][x.a.at("layer").get<std::string>()]; on = !truthy(on); x.c.mix = true; } } },
        { "toggleAllVoices", { [](const Json&, const Json&) { return true; },
                               [](Step& x) { x.t()["voices"] = setAllVoices(voiceKind(x.t().at("voices")) == "sample" ? "synth" : "sample"); x.c.voices = true; } } },
        { "setVoice", { [](const Json&, const Json& a) {
                const Json& layer = field(a, "layer");
                const Json& id = field(a, "id");
                if (!oneOf(layer, voiceLayers()) || !id.is_string() || !voiceKinds().at(layer.get<std::string>()).contains(id.get<std::string>())) return false;
                return voiceKinds().at(layer.get<std::string>()).at(id.get<std::string>()).at("hidden") == false && oneOf(field(a, "variant"), music().at("voices").at(layer.get<std::string>()).at(id.get<std::string>())); },
            [](Step& x) {
                Json voices = x.t().at("voices");
                voices[x.a.at("layer").get<std::string>()] = Json::object({ { "id", x.a.at("id") }, { "variant", x.a.at("variant") } });
                x.t()["voices"] = detail::completeVoices(voices);
                x.c.voices = true;
            },
            [](const Json& s, const Json& a) { // voices-panel.js 100: the select shows `${id}/${variant}`
                const Json voice = detail::completeVoices(s.at("track").at("voices")).at(a.at("layer").get<std::string>());
                return voice.at("id") == a.at("id") && voice.at("variant") == a.at("variant"); } } },
        { "setJob", { [](const Json&, const Json& a) { const Json& layer = field(a, "layer"); return oneOf(layer, layerIds()) && !jobsFor(layer).empty() && oneOf(field(a, "job"), jobsFor(layer)); },
                      [](Step& x) { x.t()["jobs"][x.a.at("layer").get<std::string>()] = x.a.at("job"); x.applyLive(true); },
                      [](const Json& s, const Json& a) { return detail::completeJobs(s.at("track").at("jobs")).at(a.at("layer").get<std::string>()) == a.at("job"); } } }, // jobs-panel.js 29-33
        { "setTimbre", { [](const Json& s, const Json& a) {
                const Json& group = field(a, "group");
                const Json& name = field(a, "field");
                if (!group.is_string() || !name.is_string() || !timbrePaths().count(group.get<std::string>() + "." + name.get<std::string>())) return false;
                return isInt(field(a, "value"), 0, 100) && detail::usesTimbreField(s.at("track").at("voices"), Json(group.get<std::string>() + "." + name.get<std::string>())); },
            [](Step& x) { x.t()["timbre"][x.a.at("group").get<std::string>()][x.a.at("field").get<std::string>()] = num(numberOf(x.a.at("value")) / 100); x.c.sound = true; } } },
        { "resetTimbre", { [](const Json& s, const Json& a) {
                const Json& group = field(a, "group");
                if (!group.is_string() || !isTimbreGroup(group)) return false;
                const Json& timbre = s.at("track").at("timbre");
                return timbre.contains(group.get<std::string>()) && timbre.at(group.get<std::string>()).is_object() && !timbre.at(group.get<std::string>()).empty(); },
            [](Step& x) { x.t()["timbre"].erase(x.a.at("group").get<std::string>()); x.c.sound = true; } } },
        { "setLeslie", { [](const Json& s, const Json& a) { return organShown(s) && oneOf(field(a, "mode"), music().at("organ").at("leslieModes")); },
                         [](Step& x) { x.s["organ"]["leslie"] = x.a.at("mode"); },
                         [](const Json& s, const Json& a) { return a.at("mode") == s.at("organ").at("leslie"); } } }, // organ-panel.js 51-52: the knob shows the mode's place
        { "setOrganDrive", { [](const Json& s, const Json& a) { return organShown(s) && (isNullField(a, "value") || isInt(field(a, "value"), 0, 100)); },
            [](Step& x) {
                if (!x.a.at("value").is_null()) { x.s["organ"]["drive"] = num(numberOf(x.a.at("value")) / 100); return; }
                // a double click: first the knob's own (knob.js 103-107: set(min), reported only as a change), then the panel's (organ-panel.js 41-44)
                const Json& drive = x.s.at("organ").at("drive");
                const Json variant = detail::completeVoices(x.t().at("voices")).at("chords").at("variant");
                if (detail::jsRound((drive.is_null() ? detail::presetDrive(variant) : numberOf(drive)) * 100) != 0) { x.s["organ"]["drive"] = 0; x.renderOrgan(); }
                x.s["organ"]["drive"] = nullptr;
            } } },
    };
    return table;
}

// ---------- the profile window (profiles.js) and the last session (app.js); session-reference.mjs names their lines ----------

// a message is the web's translation key with its parameters (PROTOKOLL.md section 3)
Json msg(const std::string& key, Json params = Json::object()) { return Json::object({ { "key", key }, { "params", std::move(params) } }); }
Json count(const std::string& key, double n, Json params = Json::object()) { params["n"] = num(n); return msg(n == 1 ? key + ".one" : key, std::move(params)); } // profile-parts-picker.js 17
Json errorsOf(const Json& errors) { // profiles.js 151
    Json out = Json::array();
    for (const Json& e : errors) out.push_back(msg("err." + e.at("code").get<std::string>(), e.at("params")));
    return out;
}
std::string wanted(const Json& name) { return detail::jsTrim(detail::jsSlice(detail::jsTrim(name.get<std::string>()), detail::NAME_LIMIT)); } // profiles.js 24
constexpr double MAX_INT = 9007199254740991.0; // Number.MAX_SAFE_INTEGER

// profiles.js 136-141 (`selected`): the kind of the selected row; an own entry with its node and the id of its folder (null: the top level); a vanished one is the session
struct Chosen { std::string kind, styleId; Json node, parentId; };
Chosen chosen(const Json& s, const Json& tree) {
    const std::string selection = s.at("profiles").at("selection");
    if (selection == "session" || selection == "mine") return { selection, "", Json(), Json() };
    if (selection == "factory") return { "factory-folder", "", Json(), Json() };
    if (selection.rfind("factory:", 0) == 0) return { "factory", selection.substr(8), Json(), Json() };
    const Json f = detail::find(tree, Json(selection));
    if (f.is_null()) return { "session", "", Json(), Json() };
    return { f.at("node").at("type").get<std::string>(), "", f.at("node"), f.at("parent").is_null() ? Json() : f.at("parent").at("id") };
}
bool isOpen(const Json& open, const Json& key) { return std::find(open.begin(), open.end(), key) != open.end(); }
Json opened(Json open, const Json& key) { if (!isOpen(open, key)) open.push_back(key); return open; } // a Set's add in the web: a key it has keeps its place
// profiles.js 144-148 (`select`): the row is selected, "mine" and every folder above it open
void selectRow(Json& win, const Json& tree, const Json& id) {
    win["selection"] = id;
    win["open"] = opened(win.at("open"), Json("mine"));
    for (Json f = detail::find(tree, id); !f.is_null() && !f.at("parent").is_null(); f = detail::find(tree, f.at("parent").at("id"))) win["open"] = opened(win.at("open"), f.at("parent").at("id"));
}
// profiles.js 371-386: the visible rows of the tree view and whether they open (their order does not count here: only which are visible)
std::vector<std::pair<Json, bool>> rows(const Json& s, const Json& tree) {
    const Json& open = s.at("profiles").at("open");
    std::vector<std::pair<Json, bool>> out { { "session", false }, { "factory", true } };
    if (isOpen(open, "factory")) for (const Json& f : detail::factoryProfiles()) out.emplace_back(f.at("key"), false);
    out.emplace_back("mine", true);
    const std::function<void(const Json&)> walk = [&](const Json& items) {
        for (const Json& n : items) {
            const bool folder = n.at("type") == "folder";
            out.emplace_back(n.at("id"), folder);
            if (folder && isOpen(open, n.at("id"))) walk(n.at("items"));
        }
    };
    if (isOpen(open, "mine")) walk(tree.at("items"));
    return out;
}
void idsOf(const Json& items, std::set<std::string>& out) { for (const Json& n : items) { out.insert(n.at("id").get<std::string>()); if (n.at("type") == "folder") idsOf(n.at("items"), out); } }
std::set<std::string> idsOf(const Json& tree) { std::set<std::string> out; idsOf(tree.at("items"), out); return out; }
// what the window's fields can send (PROTOKOLL.md section 1): a name of the input (maxLength 60, no line breaks), a new id, the checked parts in their order
bool isName(const Json& v) { return v.is_string() && detail::utf16Length(v.get_ref<const std::string&>()) <= detail::NAME_LIMIT && v.get_ref<const std::string&>().find_first_of("\n\r") == std::string::npos; }
bool isNewId(const Json& v, const std::set<std::string>& used) { return v.is_string() && !v.get_ref<const std::string&>().empty() && !detail::isReservedId(v.get_ref<const std::string&>()) && !used.count(v.get_ref<const std::string&>()); }
bool isIdList(const Json& v, const std::set<std::string>& used) {
    if (!v.is_array() || v.size() > detail::NODE_LIMIT) return false;
    std::set<std::string> seen;
    for (const Json& id : v) if (!isNewId(id, used) || !seen.insert(id.get<std::string>()).second) return false;
    return true;
}
bool isPartList(const Json& v, const Json& s) { // profiles.js 440-442: without a form its box is disabled
    if (!v.is_array()) return false;
    const Json ids = detail::PART_IDS();
    std::ptrdiff_t last = -1;
    for (const Json& id : v) {
        const std::ptrdiff_t at = std::find(ids.begin(), ids.end(), id) - ids.begin();
        if (!id.is_string() || at == static_cast<std::ptrdiff_t>(ids.size()) || at <= last) return false;
        last = at;
    }
    return hasForm(s.at("track")) || std::find(v.begin(), v.end(), Json("form")) == v.end();
}
bool isFolderId(const Json& v, const Json& tree) { if (!v.is_string()) return false; const Json f = detail::find(tree, v); return !f.is_null() && f.at("node").at("type") == "folder"; }
bool isPlaying(const Json& v) { return v.is_object() && isInt(field(v, "bar"), 0, MAX_INT) && isInt(field(v, "at"), 0, MAX_INT); }
double loopBars(const Json& s) { const Json* f = formNow(s); return f != nullptr ? detail::formLengthOf(*f) : numberOf(s.at("track").at("length")); } // position.js 12
// profile-session.js writeSession with its saveMix; the state keeps tempoRef as null where the web deletes it
void writeSession(Json& s, const Json& session, Storage& storage) {
    detail::writeSession(s, session);
    if (!s.contains("tempoRef")) s["tempoRef"] = nullptr;
    saveMix(storage, s);
}
// app.js 154-155: what stop() remembers while playing, the session at the bar it plays in its loop
void remember(Step& x, const Json& playing) {
    x.last = detail::saveLast(x.pending, detail::readSession(x.s), num(std::fmod(numberOf(playing.at("bar")), loopBars(x.s))), playing.at("at"));
}
// profiles.js 157-167. The tree's write is held with the action's others (Step::pending): if it fails, Session::apply takes nothing of the action but the message
// (Review Focus 3, PROTOKOLL.md section 3). `openNext`: the open folders importRaw sets before its commit (351).
void commit(Step& x, Json next, const Json& selectId, const Json& texts, bool undoable, const Json* openNext = nullptr) {
    Json& win = x.win();
    Json message = Json::array();
    for (const Json& t : texts) if (!t.is_null()) message.push_back(t); // filter(Boolean)
    x.newUndo = undoable ? Json::object({ { "tree", x.tree }, { "selection", win.at("selection") }, { "message", message } }) : Json();
    if (openNext != nullptr) win["open"] = *openNext;
    if (!selectId.is_null()) selectRow(win, next, selectId);
    win["message"] = message;
    detail::saveTree(x.pending, next);
    x.newTree = std::move(next);
}
void say(Step& x, Json message) { x.win()["message"] = std::move(message); }
// profiles.js 215-218
void nameRefused(Step& x, const std::string& code, const Json& value) {
    say(x, Json::array({ msg("ui.profileErr." + (code == "nameTaken" ? std::string("nameTakenHere") : code), Json::object({ { "name", wanted(value) } })) }));
}
detail::MakeId given(const Json& id) { return [id] { return id.get<std::string>(); }; } // the id the action brings
struct OutOfIds {}; // the action brings fewer ids than the import makes nodes
// The user's decision of 2026-11-22 ("Die app soll melden wenn das Profil Aus einer neueren version stammt."), against the web: a file of a version above the one the app
// writes for its format is read as far as its fields are known, as the web reads it, and the import names that version. `text` is a file that parseFile took.
Json newerVersion(const Json& text) {
    const Json raw = detail::parsedText(text.get<std::string>());
    const Json formats = detail::FORMATS();
    const Json& writes = detail::orNull(detail::member(raw, "format")) == formats.at("FORMAT_FOLDER") ? formats.at("FOLDER_VERSION") : formats.at("PROFILE_VERSION");
    const Json* version = detail::member(raw, "version");
    if (version == nullptr || !version->is_number() || !(version->get<double>() > writes.get<double>())) return Json();
    return msg("ui.profileNewerVersion", Json::object({ { "version", *version } }));
}
// the text the constructor read of session.json, for loadLast of profiles.h
struct Texts : Storage {
    std::map<std::string, std::optional<std::string>> files;
    std::optional<std::string> read(const std::string& name) override { const auto it = files.find(name); return it == files.end() ? std::nullopt : it->second; }
    bool write(const std::string&, const std::string&) override { return false; }
};

// valid: for a step built on the state; run: false for an action that turns out not valid on the way (nothing has changed then)
struct ProfileHandler {
    std::function<bool(const Step&)> valid;
    std::function<bool(Step&)> run;
};
bool kindIs(const Step& x, std::initializer_list<const char*> kinds) { const std::string kind = chosen(x.s, x.tree).kind; return std::any_of(kinds.begin(), kinds.end(), [&](const char* k) { return kind == k; }); }

const std::map<std::string, ProfileHandler>& profileHandlers() {
    static const std::map<std::string, ProfileHandler> table {
        // profiles.js 52 (onSelect) and 371-386: a click, Enter or Space on a visible row
        { "profileSelect", { [](const Step& x) {
                                 const Json& key = field(x.a, "key");
                                 const auto all = rows(x.s, x.tree);
                                 return key.is_string() && std::any_of(all.begin(), all.end(), [&](const auto& r) { return r.first == key; }); },
                             [](Step& x) { x.win()["selection"] = x.a.at("key"); say(x, x.undo.is_null() ? Json() : x.undo.at("message")); return true; } } },
        // 53-57 (onToggle): the twisty, ArrowRight on a closed row, ArrowLeft on an open one
        { "profileToggle", { [](const Step& x) {
                                 const Json& key = field(x.a, "key");
                                 const auto all = rows(x.s, x.tree);
                                 return key.is_string() && std::any_of(all.begin(), all.end(), [&](const auto& r) { return r.first == key && r.second; }); },
                             [](Step& x) {
                                 Json& open = x.win()["open"];
                                 const auto at = std::find(open.begin(), open.end(), x.a.at("key"));
                                 if (at != open.end()) open.erase(at); else open.push_back(x.a.at("key"));
                                 return true; } } },
        // profile-drag.js with profiles.js 250-251: a drag begins on an own entry (canDrag) and ends (null) with a drop, Escape or a cancel; profiles() names the rows it may be
        // dropped on (the drop itself is moveNode). It changes nothing but the window
        { "profileDrag", { [](const Step& x) { const Json& key = field(x.a, "key"); return isNullField(x.a, "key") || (key.is_string() && !detail::find(x.tree, key).is_null()); },
                           [](Step& x) { x.win()["drag"] = x.a.at("key"); return true; } } },
        // 175-185: the session box stands only for the session (410); the folder select is listFolders, '' the top level
        { "saveProfile", { [](const Step& x) {
                               return kindIs(x, { "session" }) && isName(field(x.a, "name")) && (isNullField(x.a, "folder") || isFolderId(field(x.a, "folder"), x.tree))
                                      && isPartList(field(x.a, "parts"), x.s) && isNewId(field(x.a, "id"), idsOf(x.tree)); },
                           [](Step& x) {
                               if (x.a.at("parts").empty()) { say(x, Json::array({ msg("ui.profileNeedParts") })); return true; }
                               const Json r = detail::addProfile(x.tree, x.a.at("folder"), x.a.at("name"), detail::captureParts(detail::readSession(x.s), x.a.at("parts")), given(x.a.at("id")));
                               if (r.at("ok") != true) { say(x, Json::array({ msg("ui.profileErr." + r.at("code").get<std::string>(), Json::object({ { "name", wanted(x.a.at("name")) } })) })); return true; }
                               commit(x, r.at("tree"), r.at("id"), Json::array({ msg("ui.profileSaved", Json::object({ { "name", r.at("name") } })) }), false);
                               return true; } } },
        // 202-209: the overwrite button stands only for an own profile (413)
        { "overwriteProfile", { [](const Step& x) { return kindIs(x, { "profile" }) && isPartList(field(x.a, "parts"), x.s); },
                                [](Step& x) {
                                    if (x.a.at("parts").empty()) { say(x, Json::array({ msg("ui.profileNeedParts") })); return true; }
                                    const Json node = chosen(x.s, x.tree).node;
                                    const Json r = detail::overwriteParts(x.tree, node.at("id"), detail::captureParts(detail::readSession(x.s), x.a.at("parts")));
                                    if (r.at("ok") != true) { say(x, Json::array({ msg("ui.profileErr." + r.at("code").get<std::string>()) })); return true; }
                                    commit(x, r.at("tree"), r.at("id"), Json::array({ msg("ui.profileOverwritten", Json::object({ { "name", node.at("name") } })) }), true);
                                    return true; } } },
        // 220-224 (doRename): rename stands for an own entry (416)
        { "renameNode", { [](const Step& x) { return kindIs(x, { "profile", "folder" }) && isName(field(x.a, "name")); },
                          [](Step& x) {
                              const Json r = detail::renameNode(x.tree, chosen(x.s, x.tree).node.at("id"), x.a.at("name"));
                              if (r.at("ok") != true) { nameRefused(x, r.at("code").get<std::string>(), x.a.at("name")); return true; }
                              commit(x, r.at("tree"), r.at("id"), Json::array({ msg("ui.profileRenamed", Json::object({ { "name", r.at("name") } })) }), false);
                              return true; } } },
        // 226-231 (doSubfolder): the button stands for a folder and for "mine" (415)
        { "addFolder", { [](const Step& x) { return kindIs(x, { "folder", "mine" }) && isName(field(x.a, "name")) && isNewId(field(x.a, "id"), idsOf(x.tree)); },
                         [](Step& x) {
                             const Chosen c = chosen(x.s, x.tree);
                             const Json r = detail::addFolder(x.tree, c.kind == "mine" ? Json() : c.node.at("id"), x.a.at("name"), given(x.a.at("id")));
                             if (r.at("ok") != true) { nameRefused(x, r.at("code").get<std::string>(), x.a.at("name")); return true; }
                             commit(x, r.at("tree"), r.at("id"), Json::array({ msg("ui.profileFolderAdded", Json::object({ { "name", r.at("name") } })) }), false);
                             return true; } } },
        // 236-243 (move), from the move form (the selected entry, a target of `targets`) and from a drag (246-254: any own row onto "mine" or an own folder that is not its
        // own and canMove): both are the targets of moveTargets but the entry's folder. shortcut: any own entry, also one whose row is hidden (a drag needs it visible,
        // the form needs it selected), upgrade: if a shell can send a move for a row it does not show
        { "moveNode", { [](const Step& x) {
                            const Json& id = field(x.a, "id");
                            const Json f = id.is_string() ? detail::find(x.tree, id) : Json();
                            if (f.is_null() || !x.a.contains("target") || !(x.a.at("target").is_null() || x.a.at("target").is_string())) return false;
                            const Json& target = x.a.at("target");
                            if (target == (f.at("parent").is_null() ? Json() : f.at("parent").at("id"))) return false;
                            const Json targets = detail::moveTargets(x.tree, id);
                            return std::any_of(targets.begin(), targets.end(), [&](const Json& t) { return t.at("id") == target; }); },
                        [](Step& x) {
                            const Json node = detail::find(x.tree, x.a.at("id")).at("node");
                            const Json& target = x.a.at("target");
                            const Json where = target.is_null() ? Json() : detail::find(x.tree, target).at("node").at("name");
                            const Json r = detail::moveNode(x.tree, x.a.at("id"), target);
                            if (r.at("ok") != true) { say(x, Json::array({ msg("ui.profileErr." + r.at("code").get<std::string>()) })); return true; }
                            const char* key = r.at("name") == node.at("name") ? "ui.profileMoved" : "ui.profileMovedRenamed";
                            commit(x, r.at("tree"), x.a.at("id"), Json::array({ msg(key, Json::object({ { "name", node.at("name") }, { "folder", where }, { "newName", r.at("name") } })) }), true);
                            return true; } } },
        // 257-261 (remove), after the question of 263-271, which is the page's
        { "deleteNode", { [](const Step& x) { return kindIs(x, { "profile", "folder" }); },
                          [](Step& x) {
                              const Json r = detail::removeNode(x.tree, chosen(x.s, x.tree).node.at("id"));
                              if (r.at("ok") != true) { say(x, Json::array({ msg("ui.profileErr." + r.at("code").get<std::string>()) })); return true; }
                              commit(x, r.at("tree"), r.at("parentId").is_null() ? Json("mine") : r.at("parentId"),
                                     Json::array({ msg("ui.profileDeleted", Json::object({ { "name", r.at("removed").at("name") } })) }), true);
                              return true; } } },
        // 274-287: the load button stands for a factory profile and an own profile (411)
        { "loadProfile", { [](const Step& x) { return kindIs(x, { "factory", "profile" }); },
                           [](Step& x) {
                               const Chosen c = chosen(x.s, x.tree);
                               if (c.kind == "factory") {
                                   applyStyle(x.s, c.styleId);
                                   x.applyLive(true, true);
                                   say(x, Json::array({ msg("ui.profileLoaded") }));
                                   return true;
                               }
                               const Json r = detail::applyParts(detail::readSession(x.s), c.node.at("parts"));
                               if (r.at("ok") != true) { say(x, errorsOf(r.at("errors"))); return true; } // all or nothing; no input of the session is known to reach it
                               writeSession(x.s, r.at("session"), x.pending);
                               x.restartIfPlaying(false);
                               say(x, Json::array({ msg("ui.profileLoaded") }));
                               return true; } } },
        // 290-295: the copy button stands for a factory profile (412); `name` is t(`style.${styleId}`) of the page
        { "copyFactory", { [](const Step& x) { return kindIs(x, { "factory" }) && isName(field(x.a, "name")) && isNewId(field(x.a, "id"), idsOf(x.tree)); },
                           [](Step& x) {
                               std::vector<std::string> names;
                               for (const Json& n : x.tree.at("items")) names.push_back(n.at("name").get<std::string>());
                               const Json r = detail::addProfile(x.tree, Json(), Json(detail::freeName(names, x.a.at("name").get<std::string>())), detail::factoryParts(chosen(x.s, x.tree).styleId), given(x.a.at("id")));
                               if (r.at("ok") != true) { say(x, Json::array({ msg("ui.profileErr." + r.at("code").get<std::string>()) })); return true; }
                               commit(x, r.at("tree"), r.at("id"), Json::array({ msg("ui.profileSaved", Json::object({ { "name", r.at("name") } })) }), false);
                               return true; } } },
        // 342-368 (importRaw, the text button, the file input): the import box stands for the session, a folder and "mine" (426)
        { "importProfile", { [](const Step& x) {
                                 const Json& from = field(x.a, "from");
                                 const Json& text = field(x.a, "text");
                                 const bool source = (from == "text" && text.is_string()) || (from == "file" && (text.is_string() || isNullField(x.a, "text")) && isInt(field(x.a, "size"), 0, MAX_INT));
                                 return source && kindIs(x, { "session", "folder", "mine" }) && isIdList(field(x.a, "ids"), idsOf(x.tree)); },
                             [](Step& x) {
                                 if (x.a.at("from") == "file" && (numberOf(x.a.at("size")) > detail::FILE_LIMIT || x.a.at("text").is_null())) { // 366-367
                                     say(x, errorsOf(Json::parse(R"([{"code":"badProfile","params":{}}])")));
                                     return true;
                                 }
                                 const Json r = detail::parseFile(x.a.at("text"));
                                 if (r.at("ok") != true) { say(x, errorsOf(r.at("errors"))); return true; }
                                 const Chosen c = chosen(x.s, x.tree);
                                 const Json target = c.kind == "profile" ? c.parentId : c.kind == "folder" ? c.node.at("id") : Json();
                                 const Json& ids = x.a.at("ids");
                                 size_t next = 0;
                                 Json added;
                                 try {
                                     added = detail::importNode(x.tree, target, r.at("node"), [&]() -> std::string { if (next >= ids.size()) throw OutOfIds(); return ids.at(next++).get<std::string>(); });
                                 } catch (const OutOfIds&) { return false; }
                                 if (added.at("ok") != true) { say(x, Json::array({ msg("ui.profileErr." + added.at("code").get<std::string>()) })); return true; }
                                 const Json node = added.at("rootId").is_null() ? Json() : detail::find(added.at("tree"), added.at("rootId")).at("node");
                                 const bool single = !node.is_null() && node.at("type") == "profile";
                                 const double profiles = numberOf(added.at("profiles")), skipped = numberOf(r.at("skipped")), dropped = numberOf(added.at("dropped"));
                                 const Json texts = Json::array({
                                     single ? msg("ui.profileImported", Json::object({ { "name", node.at("name") } }))
                                            : !node.is_null() ? count("ui.profileImportedFolder", profiles, Json::object({ { "name", node.at("name") } })) : count("ui.profileRestored", profiles),
                                     newerVersion(x.a.at("text")), skipped != 0 ? count("ui.profileSkipped", skipped) : Json(), dropped != 0 ? count("ui.profileDropped", dropped) : Json() });
                                 const Json openNext = single ? x.win().at("open") : opened(x.win().at("open"), target.is_null() ? Json("mine") : target); // 351
                                 commit(x, added.at("tree"), single ? added.at("rootId") : Json(), texts, true, &openNext);
                                 return true; } } },
        // 169-172: the button stands while there is something to undo (427)
        { "undoProfile", { [](const Step& x) { return !x.undo.is_null(); },
                           [](Step& x) { const Json u = x.undo; commit(x, u.at("tree"), u.at("selection"), Json::array({ msg("ui.profileUndone") }), false); return true; } } },
        // PROTOKOLL.md section 3a: "Erneut lesen" stands while profiles.json is unreadable (the web has no such button: its storage never fails to read); a read that fails
        // again changes nothing
        { "reloadProfiles", { [](const Step& x) { return x.problems.at("profiles") == "unreadable"; },
                              [](Step& x) {
                                  const Stored stored = readStored(x.shell, detail::PROFILES_NAME);
                                  if (stored.unreadable) return true;
                                  x.reloaded = loadProfiles(stored);
                                  x.newTree = std::move(x.reloaded->tree);
                                  x.newUndo = Json();
                                  return true; } } },
        // PROTOKOLL.md section 3a, the plan's one-time take-over of what the old page kept in the WebView's storage (backingtrack.profiles, .session, .mix); the web has no such
        // action. A text is taken only when nothing is stored under its name, read as the constructor reads that name, and stored as it is; a text the reader finds unreadable
        // or damaged is not taken. profiles.json is written first: a tree that is not stored takes nothing of the action (Session::apply)
        { "importLegacy", { [](const Step& x) {
                                for (const char* name : { "profiles", "session", "mix" }) if (!x.a.contains(name) || !(x.a.at(name).is_null() || x.a.at(name).is_string())) return false;
                                return true; },
                            [](Step& x) {
                                // state().legacy, per text sent: taken, or why not (PROTOKOLL.md section 3); a write that fails makes "failed" of "taken" (Session::apply)
                                Json said = Json::object({ { "profiles", nullptr }, { "session", nullptr }, { "mix", nullptr } });
                                const auto taken = [&](const char* field, const char* name) -> std::optional<std::string> { // the text, when it may be taken
                                    const Json& text = x.a.at(field);
                                    if (text.is_null()) return std::nullopt;
                                    if (text.get_ref<const std::string&>().size() > STORED_LIMIT) { said[field] = "damaged"; return std::nullopt; } // never readable
                                    // a storage that cannot say holds something, and an own text with a problem (state().storage) is doubtful: the next load may tell
                                    try {
                                        if (x.shell.read(name)) { said[field] = x.problems.at(field).is_null() ? "stored" : "failed"; return std::nullopt; }
                                    } catch (...) { said[field] = "failed"; return std::nullopt; }
                                    return text.get<std::string>();
                                };
                                if (x.problems.at("profiles").is_null()) { // a profiles.json state().storage names (unreadable, damaged, newer, kept) stays as it is
                                    if (const auto text = taken("profiles", detail::PROFILES_NAME)) {
                                        LoadedTree loaded = loadProfiles({ text, false });
                                        said["profiles"] = loaded.problem == "damaged" ? "damaged" : "taken"; // a newer tree is taken, and named and kept as the constructor does
                                        if (loaded.problem != "damaged") {
                                            x.pending.write(detail::PROFILES_NAME, *text);
                                            x.newTree = std::move(loaded.tree);
                                            x.newUndo = Json();
                                            x.reloaded = std::move(loaded);
                                        }
                                    }
                                } else if (!x.a.at("profiles").is_null()) said["profiles"] = "failed";
                                if (const auto text = taken("session", detail::SESSION_NAME)) {
                                    Texts texts;
                                    texts.files[detail::SESSION_NAME] = text;
                                    Json entry = detail::loadLast(texts);
                                    said["session"] = entry.is_null() ? "damaged" : "taken";
                                    if (!entry.is_null()) { x.last = std::move(entry); x.pending.write(detail::SESSION_NAME, *text); }
                                }
                                if (const auto text = taken("mix", detail::MIX_NAME)) {
                                    const Json raw = detail::parsedText(*text);
                                    said["mix"] = raw.is_object() ? "taken" : "damaged";
                                    if (raw.is_object()) {
                                        x.s["mix"] = sanitizeMix(raw);
                                        x.s["pan"] = sanitizePan(detail::orNull(detail::member(raw, "pan")));
                                        x.pending.write(detail::MIX_NAME, *text);
                                        x.c.mix = true;
                                    }
                                }
                                x.s["legacy"] = std::move(said);
                                return true; } } },
        // app.js 153-157, 160: what stop() and pagehide remember while playing; the shell sends it then (PROTOKOLL.md section 3)
        { "rememberSession", { [](const Step& x) { return isInt(field(x.a, "bar"), 0, MAX_INT) && isInt(field(x.a, "at"), 0, MAX_INT); }, [](Step& x) { remember(x, x.a); return true; } } },
        // app.js 226-236 ("Weitermachen", shown with lastPlayed: 449): the entry as it is before stop() remembers the session that plays; the start of the playback is the shell's
        { "resume", { [](const Step& x) { return !x.last.is_null() && (isNullField(x.a, "playing") || isPlaying(field(x.a, "playing"))); },
                      [](Step& x) {
                          const Json old = x.last;
                          if (!x.a.at("playing").is_null()) remember(x, x.a.at("playing"));
                          const Json r = detail::applyParts(detail::readSession(x.s), old.at("parts"));
                          if (r.at("ok") != true) { x.s["errors"] = r.at("errors"); return true; } // 231; no stored entry is known to reach it
                          writeSession(x.s, r.at("session"), x.pending);
                          // 233: startWhenLoaded's bar, never past the end of the loop it restored
                          x.s["resumed"] = Json::object({ { "bar", num(std::min(numberOf(old.at("bar")), loopBars(x.s) - 1)) } });
                          x.restartIfPlaying(false);
                          return true; } } },
    };
    return table;
}

// renderProfiles (393), at every render: a vanished selection goes back to the session
void settleSelection(Json& s, const Json& tree) { if (chosen(s, tree).kind == "session") s["profiles"]["selection"] = "session"; }

// profiles() (PROTOKOLL.md section 4): the tree lightly, and what the window's building blocks read
Json light(const Json& items) {
    Json out = Json::array();
    for (const Json& n : items) {
        if (n.at("type") == "profile") out.push_back(Json::object({ { "id", n.at("id") }, { "type", "profile" }, { "name", n.at("name") }, { "parts", detail::partIdsOf(n.at("parts")) } }));
        else out.push_back(Json::object({ { "id", n.at("id") }, { "type", "folder" }, { "name", n.at("name") }, { "items", light(n.at("items")) } }));
    }
    return out;
}
Json profilesView(const Json& s, const Json& tree, const Json& undo) {
    const Json& win = s.at("profiles");
    const Chosen c = chosen(s, tree);
    Json targets = Json::array(); // profiles.js 395
    if (!c.node.is_null()) for (const Json& t : detail::moveTargets(tree, c.node.at("id"))) if (t.at("id") != c.parentId) targets.push_back(t);
    Json counts; // profile-parts-picker.js 19: everything inside, also deep
    if (c.kind == "folder" || c.kind == "mine") {
        const Json& items = c.kind == "mine" ? tree.at("items") : c.node.at("items");
        const double all = detail::countNodes(Json::object({ { "items", items } })), profiles = detail::countProfiles(Json::object({ { "type", "folder" }, { "items", items } }));
        counts = Json::object({ { "profiles", num(profiles) }, { "folders", num(all - profiles) } });
    }
    Json drag; // profiles.js 246-249 (dropTarget): the rows the dragged one may be dropped on, "mine" or an own folder that is not its own, where canMove holds
    if (const Json& key = win.at("drag"); !key.is_null()) {
        const Json f = detail::find(tree, key);
        const Json parent = f.at("parent").is_null() ? Json() : f.at("parent").at("id");
        Json rows = Json::array();
        for (const Json& t : detail::moveTargets(tree, key)) if (t.at("id") != parent) rows.push_back(t.at("id").is_null() ? Json("mine") : t.at("id"));
        drag = Json::object({ { "key", key }, { "targets", rows } });
    }
    return Json::object({ { "items", light(tree.at("items")) }, { "nodes", num(detail::countNodes(tree)) }, { "factory", detail::factoryProfiles() }, { "selection", win.at("selection") },
                          { "open", win.at("open") }, { "undo", !undo.is_null() }, { "message", win.at("message") }, { "targets", targets }, { "counts", counts }, { "drag", drag } });
}
// what the box "Zuletzt gespielt" shows (app.js 450-459)
Json lastView(const Json& entry) {
    const Json& p = entry.at("parts");
    Json out = Json::object({ { "bar", entry.at("bar") }, { "at", entry.at("at") }, { "root", p.at("harmony").at("key").at("root") }, { "scale", p.at("harmony").at("scale") },
                              { "style", p.at("style").at("style") }, { "bpm", p.at("tempo").at("bpm") } });
    if (const Json* seed = detail::member(p.at("variant"), "seed")) out["seed"] = *seed;
    return out;
}

// a write of the shell's storage that throws counts as one that fails: nothing written
bool written(Storage& storage, const std::string& name, const std::string& text) { try { return storage.write(name, text); } catch (...) { return false; } }

std::string dump(const Json& j) { return j.dump(-1, ' ', false, Json::error_handler_t::replace); }

// profiles() is built when what it shows changes (the tree, the window, "undo": PROTOKOLL.md section 4) and kept; true when its text is another than before
bool rebuild(std::string& view, const Json& state, const Json& tree, const Json& undo) {
    std::string built = dump(profilesView(state, tree, undo));
    ++detail::profilesViewBuilds();
    const bool changed = built != view;
    view = std::move(built);
    return changed;
}

// ---------- what the building blocks show that follows from the state (Session::derived, position; PROTOKOLL.md section 4) ----------

// grooves.js grooveIdFor on the state's track, by the typed port: the state's meter is always one of METERS (setMeter takes no other), where both rules are the same
std::string grooveIdFor(const Json& t) {
    detail::Track typed;
    typed.meter = meterKey(t.at("meter"));
    if (const Json* groove = detail::member(t, "groove"); groove != nullptr && groove->is_string()) typed.groove = groove->get<std::string>();
    return detail::grooveIdFor(typed);
}
// wheel.js 9: the same chord on the wheel, by pitch class and quality
bool sameChord(const Json& a, const Json& b) { return detail::noteToPcOf(a.at("root")) == detail::noteToPcOf(b.at("root")) && a.at("quality") == b.at("quality"); }
const Json* findChord(const Json& list, const Json& chord) { for (const Json& c : list) if (sameChord(c, chord)) return &c; return nullptr; }
// wheel-geometry.js layoutWheel without its geometry: the 24 nodes { ring, index, chord } in its order, the outer ring by fifths from C (the key's diminished chord in place
// of the major one on its root), then the inner ring of the relative minors
Json wheelNodes(const Json& key) {
    std::vector<int> dim;
    for (const Json& c : detail::diatonicChordsOf(key)) if (c.at("quality") == "dim") dim.push_back(detail::noteToPcOf(c.at("root")));
    Json nodes = Json::array();
    for (const bool outer : { true, false }) {
        const Json& roots = music().at("wheel").at(outer ? "fifths" : "relativeMinors");
        for (size_t index = 0; index < roots.size(); ++index) {
            const bool diminished = outer && std::find(dim.begin(), dim.end(), detail::noteToPcOf(roots[index])) != dim.end();
            nodes.push_back(Json::object({ { "ring", outer ? "outer" : "inner" }, { "index", index },
                                           { "chord", Json::object({ { "root", roots[index] }, { "quality", diminished ? "dim" : outer ? "maj" : "min" } }) } }));
        }
    }
    return nodes;
}
// The first node for which `also` holds and wheel-geometry.js nodeMatches(node, chord, key) (the same pitch class, the node's quality the chord's stepBase), or null; the
// chord's pitch class and stepBase are the same for every node, so they are taken once (stepBase walks the key's chords)
Json firstMatch(const Json& layout, const Json& chord, const Json& key, const std::function<bool(const Json&)>& also) {
    const int pc = detail::noteToPcOf(chord.at("root"));
    const std::optional<std::string> base = detail::stepBase(chord, key);
    if (!base) return Json();
    for (size_t i = 0; i < layout.size(); ++i) {
        const Json& c = layout[i].at("chord");
        if (detail::noteToPcOf(c.at("root")) == pc && c.at("quality") == *base && also(layout[i])) return Json(i);
    }
    return Json();
}
// wheel.js 14, 28, 41, 54-73 for the key and the chords of a progression: per node the allowed chord at it in the key's spelling (allowedAt; `named`: with its name, which
// chordDisplays gives), whether it is diatonic and in the progression, its label; the path of the progression (nodeOf of each chord, those without a node left out)
Json wheelOf(const Json& key, const Json& progression, bool named = false) {
    const Json layout = wheelNodes(key), allowed = detail::allowedChords(key), diatonic = detail::diatonicChordsOf(key);
    Json nodes = Json::array();
    for (const Json& n : layout) {
        const Json* chord = findChord(allowed, n.at("chord"));
        const bool inProgression = chord != nullptr && std::any_of(progression.begin(), progression.end(), [&](const Json& c) { return sameChord(c, *chord); });
        Json pick = chord != nullptr ? *chord : Json();
        if (named && chord != nullptr) pick["name"] = detail::chordName(*chord);
        nodes.push_back(Json::object({ { "ring", n.at("ring") }, { "index", n.at("index") }, { "allowed", std::move(pick) },
                                       { "diatonic", chord != nullptr && findChord(diatonic, *chord) != nullptr }, { "inProgression", inProgression },
                                       { "short", detail::chordShort(chord != nullptr ? *chord : n.at("chord")) } }));
    }
    Json path = Json::array();
    for (const Json& c : progression) if (Json i = firstMatch(layout, c, key, [](const Json&) { return true; }); !i.is_null()) path.push_back(std::move(i));
    return Json::object({ { "nodes", nodes }, { "path", path } });
}
// wheel.js 57-58, 96 as wheelState gives them while playing (tuning.js 42-47): the node of the chord that sounds and that of the next one, unless it is the same node;
// a chord that is null (chordDisplays: none sounds) has no node
Json wheelAt(const Json& key, const Json& chord, const Json& next) {
    const Json layout = wheelNodes(key), allowed = detail::allowedChords(key);
    const auto nodeOf = [&](const Json& c) { return c.is_null() ? Json() : firstMatch(layout, c, key, [&](const Json& n) { return findChord(allowed, n.at("chord")) != nullptr; }); };
    const Json current = nodeOf(chord), following = nodeOf(next);
    return Json::object({ { "current", current }, { "next", following == current ? Json() : following }, { "nextShort", next.is_null() ? Json() : Json(detail::chordShort(next)) } });
}
// fretboard.js 173 (chordSentence): the tones of a chord in their order, chordMidi(chord, 3) named with noteName in the key's spelling
Json tonesOf(const Json& key, const Json& chord) {
    const char* const* names = detail::spelledNames(key);
    const int base = 48 + detail::noteToPcOf(chord.at("root"));
    Json out = Json::array();
    for (const Json& i : music().at("chords").at(chord.at("quality").get<std::string>()).at("intervals")) out.push_back(names[(base + i.get<int>()) % 12]);
    return out;
}
// native/app/web/track.js 25-30 (KINDS, chordOf), the old page of the own songs: a chord name as the analysis writes it, a root and the symbol of a quality of the register
// (Am, F#7; KINDS is the register's symbols), as a chord; an unknown symbol is major. No chord (null): a name without a root, or one that is no text (the old page threw)
Json chordOfName(const Json& name) {
    if (!name.is_string()) return Json();
    const std::string& text = name.get_ref<const std::string&>();
    if (text.empty() || text[0] < 'A' || text[0] > 'G') return Json();
    const size_t cut = text.size() > 1 && (text[1] == '#' || text[1] == 'b') ? 2 : 1;
    const std::string rest = text.substr(cut);
    // /^([A-G][#b]?)(.*)$/: JavaScript's `.` takes no line terminator, so such a name does not match
    for (const char* stop : { "\n", "\r", "\xE2\x80\xA8", "\xE2\x80\xA9" }) if (rest.find(stop) != std::string::npos) return Json();
    std::string quality = "maj";
    for (auto it = music().at("chords").begin(); it != music().at("chords").end(); ++it) if (it.value().at("symbol") == rest) { quality = it.key(); break; }
    return Json::object({ { "root", text.substr(0, cut) }, { "quality", quality } });
}

} // namespace

namespace detail {
size_t& profilesViewBuilds() { static size_t builds = 0; return builds; }
} // namespace detail

struct Session::Memory {
    Json state;           // the state: the fields of state() (PROTOKOLL.md section 4) but the tree, the last session, the storage's problems and what is derived, with the web's `errors`
    Json tree;            // the profiles { items }
    Json undo;            // what "Rückgängig" keeps: null or { tree, selection, message }
    Json last;            // the last session: null or { parts, bar, at }
    Json storage;         // state().storage: { profiles, profilesVersion, session, mix }
    std::string keep;     // the text of a damaged or newer profiles.json, while it is not kept yet
    std::string view;     // what profiles() gives
};

// PROTOKOLL.md section 2: the page load on the stored texts (state.js 58-90 with seed 1, app.js 153 and 484-486, profiles.js 41-47). It restores nothing and writes
// nothing: the last session is only the offer of "Weitermachen", which is the action resume (app.js 226-236). Each name is read once and loaded by itself: what throws while
// one is loaded (no input is known) leaves what was loaded so far and names it unreadable. Each loader is the web's and answers any text as it does.
Session::Session(Storage& storage) : storage_(storage), memory_(std::make_unique<Memory>()) {
    Memory& m = *memory_;
    try {
        m.storage = Json::object({ { "profiles", nullptr }, { "profilesVersion", nullptr }, { "session", nullptr }, { "mix", nullptr } });
        m.state = startState(1); // its mixer and panorama are the defaults of an empty storage
        // profiles.js 42-47; `drag`: the row being dragged (profile-drag.js), none
        m.state["profiles"] = Json::object({ { "selection", "session" }, { "open", Json::array({ "mine", "factory" }) }, { "message", nullptr }, { "drag", nullptr } });
        m.tree = detail::newTree();
        try { // state.js 84-85, loadMix and loadPan. shortcut: a text nested deeper than 64 levels counts as no JSON (track.cpp's reader), so as damaged, where the web reads
              // the fields beside the deep one, upgrade: with the reader's limit
            const Stored mix = readStored(storage_, detail::MIX_NAME);
            if (mix.unreadable) m.storage["mix"] = "unreadable";
            else if (mix.text) {
                const Json raw = detail::parsedText(*mix.text);
                if (!raw.is_object()) m.storage["mix"] = "damaged"; // no JSON, or no object: no value can be read
                m.state["mix"] = sanitizeMix(raw);
                m.state["pan"] = sanitizePan(detail::orNull(detail::member(raw, "pan")));
            }
        } catch (...) { m.storage["mix"] = "unreadable"; }
        try {
            LoadedTree loaded = loadProfiles(readStored(storage_, detail::PROFILES_NAME));
            m.tree = std::move(loaded.tree);
            m.storage["profiles"] = loaded.problem;
            m.storage["profilesVersion"] = loaded.version;
            m.keep = std::move(loaded.keep);
        } catch (...) { m.tree = detail::newTree(); m.storage["profiles"] = "unreadable"; }
        try { // app.js 153
            const Stored last = readStored(storage_, detail::SESSION_NAME);
            Texts texts;
            texts.files[detail::SESSION_NAME] = last.text;
            m.last = detail::loadLast(texts);
            if (last.unreadable) m.storage["session"] = "unreadable";
            else if (last.text && m.last.is_null()) m.storage["session"] = "damaged"; // loadLast reads no entry from it
        } catch (...) { m.last = Json(); m.storage["session"] = "unreadable"; }
        rebuild(m.view, m.state, m.tree, m.undo);
    } catch (...) {} // the start state itself failed (an allocation): state() and the others give empty texts, apply changes nothing
}

Session::Session(const Session& other, Storage& storage) : storage_(storage), memory_(std::make_unique<Memory>(*other.memory_)) {}

Session::~Session() = default;

// The actions a newer one with the same key replaces whole (session.h). Each sets one value and reads nothing of the one before; the value is checked
// here as its handler checks it, and the rest of its validity is the state's (the voices for setTimbre, a valid form for editPart), which no action of
// a key changes: two actions of one key are valid alike. Not here, with the reason the logic test's replace check finds: setLevel, setPan, setTempo,
// setFormFeel, setLeslie, setOrganDrive and editPart's type and bars do nothing when they bring the value shown, so a newer one alone could leave
// out a write or its flags; editPart's reset (null) is not valid while the part has no value of its own; what counts or rolls (addChord, rerollForm,
// newVariant) and what toggles (toggleMute, toggleLock) depends on the one before.
std::string Session::replaceKey(const std::string& actionJson) {
    try {
        const Json a = detail::parsedText(actionJson);
        if (!a.is_object() || !a.contains("action") || !a.at("action").is_string()) return "";
        const std::string name = a.at("action").get<std::string>();
        const Json& value = field(a, "value");
        if (name == "setTimbre") { // timbre-panel.js 39-44: track.timbre[group][field] = value / 100
            const Json& group = field(a, "group");
            const Json& f = field(a, "field");
            if (!group.is_string() || !f.is_string() || !isInt(value, 0, 100)) return "";
            const std::string path = group.get<std::string>() + "." + f.get<std::string>();
            return timbrePaths().count(path) ? "setTimbre/" + path : "";
        }
        if (name == "setRhythmKnob") { // rhythm.js 36-49: track[knob] = value / 100
            const Json& knob = field(a, "knob");
            return oneOf(knob, std::vector<std::string> { "complexity", "loose", "ornaments" }) && isInt(value, 0, 100) ? "setRhythmKnob/" + knob.get<std::string>() : "";
        }
        if (name == "editPart") { // form-ui.js editPart of the selected part with one field
            const Json& f = field(a, "field");
            if (f == "level" && isInt(value, formLimit("levelMin"), formLimit("levelMax"))) return "editPart/level";
            if (f == "density" && isInt(value, formLimit("densityMin") * 100, formLimit("densityMax") * 100)) return "editPart/density";
            if (f == "transition" && oneOf(value, music().at("form").at("transitions"))) return "editPart/transition";
        }
        return "";
    } catch (...) { return ""; } // no input is known that reaches it
}

Session::Change Session::apply(const std::string& actionJson) {
    try {
        // JSON.parse; text that is no JSON is null. shortcut: text nested deeper than 64 levels counts as no JSON (track.cpp's reader), where JSON.parse
        // takes it (an action has two levels), upgrade: with the reader's limit
        const Json a = detail::parsedText(actionJson);
        if (!a.is_object() || !a.contains("action") || !a.at("action").is_string()) return {};
        const auto handler = handlers().find(a.at("action").get<std::string>());
        const auto profile = profileHandlers().find(a.at("action").get<std::string>());
        if (handler == handlers().end() && profile == profileHandlers().end()) return {};
        Memory& m = *memory_;
        Json s = m.state;
        if (handler != handlers().end()) {
            if (!handler->second.valid(s, a)) return {};
            if (handler->second.same && handler->second.same(s, a)) return {}; // the value the control shows: the web sends no event
        }
        Json last = m.last;
        Change c;
        const std::string watched = voiceKeys(s.at("track").at("voices"));
        std::string pushed = detail::organTuning(s.at("organ")).dump();
        Step step { s, a, c, pushed, s.at("track").at("length"), meterKey(s.at("track").at("meter")), m.tree, m.undo, last, storage_, m.storage };
        s["resumed"] = nullptr; // the bar of a resume holds for the action that set it only, and what importLegacy did too
        s["legacy"] = nullptr;
        if (handler != handlers().end()) handler->second.run(step);
        else if (!profile->second.valid(step) || !profile->second.run(step)) return {};
        // what render() does: hands the player the voices when one changed (voices-panel.js 89-93) and a changed tuning (organ-panel.js 62-64), clamps the selections
        if (voiceKeys(s.at("track").at("voices")) != watched) c.voices = true;
        step.renderOrgan();
        clampSelection(s);
        settleSelection(s, step.newTree ? *step.newTree : m.tree);
        // PROTOKOLL.md section 3a: after a profiles.json that could not be read, an action that would write it is refused and changes nothing (no text the session could not
        // read is written over)
        const auto& texts = step.pending.texts;
        if (m.storage.at("profiles") == "unreadable" && std::any_of(texts.begin(), texts.end(), [](const auto& w) { return w.first == detail::PROFILES_NAME; })) return {};
        // the writes, in the order the web makes them, when everything else of the action is done: a tree that is not stored is not taken (Review Focus 3), the
        // session's other texts are, as in the web, which goes on without them, and state().storage names them. Dropping the action for a failed profiles.json is all or
        // nothing because the one action that writes profiles.json and another name (importLegacy) writes the tree first: the loop stops before the others
        const auto notStored = [&] { // the tree is not taken: only the message, which may change the window
            m.state["profiles"]["message"] = Json::array({ msg("ui.profileNotStored") });
            m.state["resumed"] = nullptr; // a valid action all the same
            Json said = s.at("legacy"); // importLegacy takes nothing then: what it would have taken was not written
            if (said.is_object()) for (Json& value : said) if (value == "taken") value = "failed";
            m.state["legacy"] = std::move(said);
            Change named;
            named.profiles = rebuild(m.view, m.state, m.tree, m.undo);
            return named;
        };
        for (const auto& [name, text] : texts) {
            const Json problem = m.storage.at("profiles");
            if (name == detail::PROFILES_NAME && (problem == "damaged" || problem == "newer")) { // the damaged or newer text is kept once, before the first write of the tree
                if (!written(storage_, problem == "damaged" ? DAMAGED_NAME : NEWER_NAME, m.keep)) return notStored();
                m.storage["profiles"] = problem.get<std::string>() + "Kept";
                m.keep.clear();
            }
            const bool held = written(storage_, name, text);
            if (name == detail::PROFILES_NAME) { if (!held) return notStored(); }
            else {
                const char* field = name == detail::SESSION_NAME ? "session" : "mix";
                m.storage[field] = held ? Json() : Json("notStored");
                if (!held && s.at("legacy").is_object()) s["legacy"][field] = "failed"; // importLegacy: not stored, so not taken for the next start
            }
        }
        if (step.newTree) s["profiles"]["drag"] = nullptr; // a change of the tree ends a drag
        const bool window = step.newTree.has_value() || s.at("profiles") != m.state.at("profiles"); // what profiles() shows (undo changes only with the tree)
        m.state = std::move(s);
        m.last = std::move(last);
        if (step.newTree) { m.tree = std::move(*step.newTree); m.undo = std::move(*step.newUndo); }
        if (step.reloaded) {
            m.storage["profiles"] = step.reloaded->problem;
            m.storage["profilesVersion"] = step.reloaded->version;
            m.keep = std::move(step.reloaded->keep);
        }
        if (window) c.profiles = rebuild(m.view, m.state, m.tree, m.undo);
        return c;
    } catch (...) { // a helper that throws where the web would coerce (harmony.h, form_internal.h): the action changes nothing
        return {};
    }
}

// app.js 128, 191: the player gets { ...state.track, layers: ALL_LAYERS } and the mutes through setLayer (139, 200), so that switching a layer on sounds at once
// Each accessor gives an empty text when something throws (no input is known: an allocation that fails), and the caller keeps what it had (session.h).
std::string Session::track() const {
    try {
        Json t = memory_->state.at("track");
        Json all = Json::object();
        for (const std::string& layer : layerIds()) all[layer] = true; // state.js 21 ALL_LAYERS
        t["layers"] = all;
        return dump(t);
    } catch (...) { return ""; }
}
std::string Session::sound() const { try { return dump(detail::resolveTrackTimbre(memory_->state.at("track"))); } catch (...) { return ""; } }
std::string Session::tuning() const { try { return dump(detail::organTuning(memory_->state.at("organ"))); } catch (...) { return ""; } }
std::string Session::state() const {
    try {
        const Memory& m = *memory_;
        Json s = m.state;
        // a failed resume's errors (app.js 231), else validateTrack of index.js (normalizeTrack first), what a failed start shows
        if (s.at("errors").empty()) s["errors"] = detail::trackErrors(detail::normalizedTrack(s.at("track")));
        s.erase("profiles"); // profiles()
        s["last"] = m.last.is_null() ? Json() : lastView(m.last);
        s["loopBars"] = num(loopBars(m.state)); // position.js 12
        s["storage"] = m.storage;
        return dump(s);
    } catch (...) { return ""; }
}
std::string Session::profiles() const { try { return memory_->view; } catch (...) { return ""; } }

// PROTOKOLL.md section 4: the web's functions as the building blocks call them on the state; a function with an argument the page chooses, over every value it can choose
std::string Session::derived() const {
    try {
        const Json& s = memory_->state;
        const Json& t = s.at("track");
        Json options = Json::array(); // progression-editor.js 111-126: per root the qualities it allows and the name of every quality of the register on it
        for (const Json& o : detail::chordOptions(t.at("key"))) {
            Json names = Json::object();
            for (auto it = music().at("chords").begin(); it != music().at("chords").end(); ++it) names[it.key()] = detail::chordName(Json::object({ { "root", o.at("root") }, { "quality", it.key() } }));
            options.push_back(Json::object({ { "root", o.at("root") }, { "qualities", o.at("qualities") }, { "names", std::move(names) } }));
        }
        // tagEffect and usesTimbreField per word and per knob read the same of the track each time (isValidForm(track.form), completeVoices(track.voices)): taken once
        const Json* f = formNow(s);
        Json voices = detail::completeVoices(t.at("voices"));
        Json effects = Json::object(); // tags-ui.js 83, 87; tuning.js 127: per word
        for (const Json& category : music().at("tags")) for (const Json& tag : category.at("tags")) effects[tag.get<std::string>()] = detail::tagEffect(tag, t, f != nullptr, voices);
        Json uses = Json::object(); // timbre-panel.js 108, voices-panel.js 105: per knob of DEFAULT_TIMBRE
        detail::Timbre knobs;
        detail::forEachField(knobs, [&](const char* group, const char* name, double&) { const std::string path = std::string(group) + "." + name; uses[path] = detail::usesCompleteTimbreField(voices, Json(path)); });
        Json form; // form-strip.js 233-245, form-ui.js: the strip and the inspector stand only with a valid form; per part what the inspector shows of it
        if (f != nullptr) {
            const Json& feel = detail::orNull(detail::member(*f, "feel"));
            const double total = detail::formLengthOf(*f);
            Json parts = Json::array();
            const Json& sections = f->at("sections");
            for (size_t i = 0; i < sections.size(); ++i) {
                const Json& part = sections[i];
                const detail::Resolved r = detail::resolvePart(part, feel); // the inspector reads its transition and crash (form-strip.js 185, 196-197)
                parts.push_back(Json::object({ { "transition", r.transition }, { "crash", r.crash }, { "levelValue", num(detail::levelValue(part, feel)) },
                                               { "densityValue", num(detail::densityValue(part, feel)) }, { "levelLabel", detail::levelLabel(part, feel) },
                                               { "densityLabel", detail::densityLabel(part, feel) }, { "limits", detail::limits(*f, Json(i)) },
                                               { "maxBars", num(std::min(formLimit("bars"), formLimit("length") - (total - numberOf(part.at("bars"))))) } })); // form-strip.js 85-86
            }
            Json blocks = detail::stripBlocks(*f);
            for (Json& b : blocks) { b.erase("index"); b.erase("width"); } // no block reads them (form-strip.js draws by its place and its bars)
            form = Json::object({ { "blocks", std::move(blocks) }, { "parts", std::move(parts) } });
        }
        Json rhythm = Json::object(); // rhythm.js 66: a knob shows 50 % while its field is missing
        for (const char* knob : { "complexity", "loose", "ornaments" }) { const Json* v = detail::member(t, knob); rhythm[knob] = v != nullptr && !v->is_null() ? *v : Json(0.5); }
        const Json* formFeel = detail::member(t, "form") != nullptr ? detail::member(t.at("form"), "feel") : nullptr; // track.form?.feel
        const Json drive = detail::presetDrive(voices.at("chords").at("variant"));
        // JSON.stringify's text: its numbers as JavaScript writes them (a whole double as 1, not 1.0: the blocks, presetDrive, the knobs)
        Json progression = Json::array();
        for (const Json& b : t.at("bars")) progression.push_back(b.at("chord"));
        return detail::stringify(Json::object({ { "chordOptions", std::move(options) }, { "wheel", wheelOf(t.at("key"), progression) }, { "tagEffect", std::move(effects) }, { "voices", std::move(voices) },
                                   { "voiceKind", voiceKind(t.at("voices")) }, { "jobs", detail::completeJobs(t.at("jobs")) }, { "timbre", detail::resolveTrackTimbre(t) },
                                   { "usesTimbreField", std::move(uses) }, { "presetDrive", drive }, { "meter", meterKey(t.at("meter")) }, { "groove", grooveIdFor(t) },
                                   { "rhythm", std::move(rhythm) }, { "formChoice", formChoice(t) },
                                   { "feel", formFeel != nullptr && !formFeel->is_null() ? *formFeel : s.at("formFeel") }, // form-panel.js 79: the form's, else the remembered
                                   { "form", std::move(form) } }));
    } catch (...) { return ""; }
}

// PROTOKOLL.md section 4: the constants the page lists and labels, from the tables the core embeds (music.json, grooves.json, sound.json), built once
std::string Session::tables() {
    try {
        static const std::string text = [] {
            Json voices = Json::object(); // VOICES as the voice select reads it: kind, hidden, variants
            for (const std::string& layer : voiceLayers()) {
                Json ids = Json::object();
                const Json& variants = music().at("voices").at(layer);
                for (auto it = variants.begin(); it != variants.end(); ++it) {
                    const Json& kind = voiceKinds().at(layer).at(it.key());
                    ids[it.key()] = Json::object({ { "kind", kind.at("kind") }, { "hidden", kind.at("hidden") }, { "variants", it.value() } });
                }
                voices[layer] = ids;
            }
            Json jobs = Json::object(), grooves = Json::object(), chords = Json::object(), styles = Json::array(), timbre = Json::object(), pan = Json::object();
            for (const std::string& layer : layerIds()) { jobs[layer] = jobsFor(layer); pan[layer] = num(defaultPan(layer)); }
            for (auto it = music().at("meterGrid").begin(); it != music().at("meterGrid").end(); ++it) grooves[it.key()] = groovesFor(it.key());
            for (auto it = music().at("chords").begin(); it != music().at("chords").end(); ++it) chords[it.key()] = Json::object({ { "group", it.value().at("group") } });
            for (const Json& p : music().at("styles")) styles.push_back(Json::object({ { "id", p.at("id") }, { "bpm", p.at("bpm") } }));
            detail::Timbre defaults;
            detail::forEachField(defaults, [&](const char* group, const char* name, double& v) { timbre[group][name] = num(v); });
            const Json& form = music().at("form");
            const Json& fretboard = music().at("fretboard");
            Json limits = detail::LIMITS();
            limits.erase("depth"); // the page reads no depth: the session refuses what is too deep
            Json barChords = Json::array(); // native/app/web/track.js 19-20: the names the analysis gives the twelve roots, major, then minor
            for (const bool minor : { false, true }) for (int root = 0; root < 12; ++root) barChords.push_back(btg::chordName(root, minor));
            return detail::stringify(Json::object({ { "ROOTS", music().at("roots") }, { "SCALE_NAMES", scaleNames() }, { "SCALES", keysOf(music().at("scales")) },
                                       { "LAYER_IDS", layerIds() }, { "VOICE_LAYERS", voiceLayers() }, { "VOICES", voices },
                                       { "jobsFor", jobs }, { "METERS", music().at("meterGrid") }, { "groovesFor", grooves }, { "CHORD_COLORS", keysOf(music().at("chordColors").at("table")) },
                                       { "CHORD_GROUPS", music().at("chordGroups") }, { "CHORDS", chords }, { "MAX_CHORDS", MAX_CHORDS }, { "BAR_CHORDS", barChords }, { "STYLE_PRESETS", styles }, { "TAG_CATEGORIES", music().at("tags") },
                                       { "DEFAULT_TIMBRE", timbre }, { "LESLIE_MODES", music().at("organ").at("leslieModes") }, { "DEFAULT_ORGAN", music().at("organ").at("default") },
                                       { "PART_TYPES", form.at("partTypes") }, { "TRANSITIONS", form.at("transitions") }, { "TEMPLATE_IDS", form.at("templateIds") },
                                       { "TARGET_SIZES", form.at("targetSizes") }, { "FEEL_DEFAULTS", form.at("feelDefaults") }, { "DYNAMICS_MAX", form.at("dynamicsMax") },
                                       { "PART_IDS", detail::PART_IDS() }, { "PART_PRESETS", detail::PART_PRESETS() }, { "LIMITS", std::move(limits) },
                                       { "FORMAT_FOLDER", detail::FORMATS().at("FORMAT_FOLDER") }, { "STANDARD_TUNING", fretboard.at("standardTuning") }, { "FRETS", fretboard.at("frets") },
                                       { "DEFAULT_PAN", pan } }));
        }();
        return text;
    } catch (...) { return ""; }
}

// PROTOKOLL.md section 4: what the displays compute from the playback's position (app.js onBar and tickCountdown, tuning.js, progression-editor.js, fretboard.js, form-strip.js).
// The bar is the one in which `beats` lies, wrapped around the loop, as the player's onBar reports it (each bar `bars[chordIndex(track, i)].beats` long, walked as
// beatsUntilChange walks them), in the loop where the web's onBar counts on across loops (PROTOKOLL.md section 4 says why); then the web's functions as the displays call them.
std::string Session::position(double beats) const {
    try {
        const Json& s = memory_->state;
        const Json& t = s.at("track");
        const Json& bars = t.at("bars");
        static const Json none;
        const Json& form = t.contains("form") ? t.at("form") : none;
        const double length = loopBars(s);
        const detail::ChordIndex chordIndex(bars, form);
        const auto dur = [&](double i) { return numberOf(bars.at(static_cast<size_t>(chordIndex(i))).at("beats")); };
        double loop = 0;
        for (double i = 0; i < length; ++i) loop += dur(i);
        const double pos = std::fmod(std::fmod(beats, loop) + loop, loop);
        double bar = 0, start = 0;
        while (bar < length - 1 && start + dur(bar) <= pos) start += dur(bar++);
        const double index = chordIndex(bar);
        const Json& chord = bars.at(static_cast<size_t>(index)).at("chord"); // chordAtBar (position.js 9), what onBar brings
        const Json next = detail::nextDistinctChord(bars, t.at("length"), num(bar), form); // tuning.js 41
        const Json roles = detail::progressionRoles(t, num(bar)); // progression-editor.js 95, tuning.js 75
        Json progression = Json::array();
        for (size_t i = 0; i < bars.size(); ++i) {
            const Json& c = bars[i].at("chord");
            progression.push_back(Json::object({ { "name", detail::chordName(c) }, { "degree", detail::romanDegree(t.at("key"), c) }, { "role", roles.at(i) } }));
        }
        Json part; // app.js 113-119 (partLabel) and form-strip.js 243
        const double total = detail::formLengthOf(form);
        if (const auto hit = total > 0 ? detail::sectionAt(form, std::fmod(bar, total)) : std::nullopt) {
            const Json& sections = form.at("sections");
            const Json& type = sections.at(hit->index).at("type");
            double n = 0;
            for (size_t i = 0; i <= hit->index; ++i) if (detail::member(sections[i], "type") != nullptr && sections[i].at("type") == type) ++n;
            part = Json::object({ { "index", hit->index }, { "type", type }, { "n", num(n) } });
        }
        const Json countdown = detail::beatsUntilChange(t, beats * 60 / numberOf(t.at("bpm"))); // app.js 102: the song's seconds at the track's tempo
        const Json out = Json::object({ { "bar", num(bar) }, { "beat", num(std::floor(beats + 1e-6)) }, { "chord", chord }, { "name", detail::chordName(chord) }, { "next", next },
                                        { "nextName", next.is_null() ? Json() : detail::chordName(next) }, { "index", num(index) }, { "progression", progression },
                                        { "fretboard", detail::fretboardNotes(Json::object({ { "key", t.at("key") }, { "scale", s.at("scale") }, { "current", chord }, { "next", next } })) },
                                        { "part", part }, { "countdown", countdown.is_null() ? countdown : num(countdown.get<double>()) },
                                        { "notes", tonesOf(t.at("key"), chord) }, { "nextNotes", next.is_null() ? Json() : tonesOf(t.at("key"), next) }, { "wheel", wheelAt(t.at("key"), chord, next) } });
        return dump(out); // every number in it is whole: the text is JSON.stringify's (stringify would take three times as long)
    } catch (...) { return ""; }
}

// PROTOKOLL.md section 4b: what native/app/web/track.js hands the fretboard (showBoard, 419: fretboardNotes, chordSentence) and the wheel (421: wheel.js on the chords of the
// part that plays), from the functions derived() and position() use; the names parsed as chordOfName does, a node's allowed chord with the name the page enters for it
std::string chordDisplays(const std::string& requestJson) {
    try {
        const Json r = detail::parsedText(requestJson);
        const Json& key = field(r, "key");
        if (!detail::isValidKeyValue(key)) return "";
        const Json current = chordOfName(field(r, "current")), next = chordOfName(field(r, "next"));
        Json progression = Json::array();
        if (const Json& chords = field(r, "chords"); chords.is_array())
            for (const Json& name : chords) if (Json c = chordOfName(name); !c.is_null()) progression.push_back(std::move(c));
        const auto name = [](const Json& c) { return c.is_null() ? Json() : detail::chordName(c); };
        const auto tones = [&](const Json& c) { return c.is_null() ? Json() : tonesOf(key, c); };
        const Json out = Json::object({ { "wheel", wheelOf(key, progression, true) }, { "at", wheelAt(key, current, next) },
                                        { "fretboard", detail::fretboardNotes(Json::object({ { "key", key }, { "scale", field(r, "scale") }, { "current", current }, { "next", next } })) },
                                        { "name", name(current) }, { "notes", tones(current) }, { "nextName", name(next) }, { "nextNotes", tones(next) } });
        return dump(out); // every number in it is whole: the text is JSON.stringify's
    } catch (...) { return ""; }
}

// ---------- the page of the user's own songs (PROTOKOLL.md section 4c): native/app/ui/track.js up to Task 32f, as session-reference.mjs trackView copies it ----------
namespace {

using Key = std::optional<std::string>; // a bar's main chord; none (the page's undefined) for a bar without beats

std::vector<std::string> pieces(const std::string& text) { // text.split(' ')
    std::vector<std::string> out;
    for (size_t from = 0;;) {
        const size_t cut = text.find(' ', from);
        out.push_back(text.substr(from, cut - from));
        if (cut == std::string::npos) return out;
        from = cut + 1;
    }
}
// track.js 66 (plain): each name of a label by its root and minor third only ("Gm7 C" is "Gm C", "Cmaj7" is "C"); a name without a root stays as it is
std::string plain(const std::string& label) {
    const std::vector<std::string> names = pieces(label);
    std::string out;
    for (size_t k = 0; k < names.size(); ++k) {
        const std::string& c = names[k];
        if (k) out += ' ';
        if (c.empty() || c[0] < 'A' || c[0] > 'G') { out += c; continue; }
        const size_t root = c.size() > 1 && (c[1] == '#' || c[1] == 'b') ? 2 : 1; // /^([A-G][#b]?)(m(?!aj))?/
        out += c.substr(0, root);
        if (root < c.size() && c[root] == 'm' && c.compare(root + 1, 2, "aj") != 0) out += 'm';
    }
    return out;
}
// track.js 68 (most), and 144-146 for a bar's main chord: the value most of the list holds, on a tie the first in the order of Object.keys (texts that are array indices
// first, ascending, then the others as they came). The page counted in an object, so a missing value counts as the text "undefined"; none for an empty list
Key most(const std::vector<Key>& list) {
    std::vector<std::pair<std::string, size_t>> votes; // in the order the values came
    for (const Key& x : list) {
        const std::string name = x ? *x : "undefined";
        const auto it = std::find_if(votes.begin(), votes.end(), [&](const auto& v) { return v.first == name; });
        if (it == votes.end()) votes.emplace_back(name, 1); else ++it->second;
    }
    const std::pair<std::string, size_t>* best = nullptr;
    for (const auto& v : votes)
        if (best == nullptr || v.second > best->second
            || (v.second == best->second && detail::isArrayIndexOf(v.first) && (!detail::isArrayIndexOf(best->first) || std::stoull(v.first) < std::stoull(best->first)))) best = &v;
    return best == nullptr ? Key() : Key(best->first);
}
// String.fromCharCode(code) as UTF-8: one code unit (the code modulo 2^16); a surrogate as its three bytes, which stringify writes as JSON.stringify writes a lone one
std::string fromCharCode(size_t code) {
    code &= 0xFFFF;
    if (code < 0x80) return std::string(1, static_cast<char>(code));
    if (code < 0x800) return { static_cast<char>(0xC0 | code >> 6), static_cast<char>(0x80 | (code & 0x3F)) };
    return { static_cast<char>(0xE0 | (code >> 12 & 0x0F)), static_cast<char>(0x80 | (code >> 6 & 0x3F)), static_cast<char>(0x80 | (code & 0x3F)) };
}

struct Part { size_t first = 0, bars = 0; std::vector<std::string> pattern; std::vector<Key> key; size_t repeats = 0; std::string name; };

// track.js 67-115 (findSections): parts in which the bars repeat with a period of 1 to 24 bars, compared by their main chords (`keys`); the pattern of a part is the
// majority over its repeats; of the periods that fit, the shortest that reaches nearly as far as the best one wins (the comments are the page's)
std::vector<Part> findSections(const std::vector<std::string>& labels, const std::vector<Key>& keys) {
    const size_t count = keys.size();
    // from bar i on: how many bars follow the pattern `ref` (whole repeats; a few misses are forgiven)
    const auto reach = [&](size_t i, const std::vector<Key>& ref) {
        size_t miss = 0, good = i;
        for (size_t j = i; j < count; ++j) {
            if (keys[j] == ref[(j - i) % ref.size()]) { good = j + 1; continue; }
            if (static_cast<double>(++miss) > 1 + static_cast<double>(j - i) / 8) break;
        }
        return good - i - (good - i) % ref.size();
    };
    const auto majority = [&](size_t i, size_t bars, size_t period) {
        std::vector<Key> out;
        for (size_t k = 0; k < period; ++k) {
            std::vector<Key> list;
            for (size_t r = 0; r < bars / period; ++r) list.push_back(keys[i + k + r * period]);
            out.push_back(most(list));
        }
        return out;
    };
    std::vector<Part> out;
    for (size_t i = 0; i < count;) {
        struct Fit { size_t bars, period; };
        std::vector<Fit> fits;
        for (size_t period = 1; period <= 24 && i + 2 * period <= count; ++period) {
            size_t bars = reach(i, std::vector<Key>(keys.begin() + static_cast<std::ptrdiff_t>(i), keys.begin() + static_cast<std::ptrdiff_t>(i + period)));
            if (bars < 2 * period || (period == 1 && bars < 4)) continue; // one chord held is a pattern only when it lasts
            bars = std::max(bars, reach(i, majority(i, bars, period))); // again against the majority: the first pass may hold the misread bar
            fits.push_back({ bars, period });
        }
        size_t far = 0;
        for (const Fit& f : fits) far = std::max(far, f.bars);
        // phrases are mostly 1, 2 or a multiple of 4 bars long: such a period goes first, then an even one
        const auto odd = [](const Fit& f) { return f.period <= 2 || f.period % 4 == 0 ? 0 : f.period % 2 == 0 ? 1 : 2; };
        std::optional<Fit> chosen;
        for (const Fit& f : fits)
            if (static_cast<double>(f.bars) >= 0.8 * static_cast<double>(far) && (!chosen || odd(f) < odd(*chosen) || (odd(f) == odd(*chosen) && f.period < chosen->period))) chosen = f;
        const Fit best = chosen.value_or(Fit { 1, 1 });
        Part part { i, best.bars, {}, majority(i, best.bars, best.period), best.bars / best.period, {} };
        // shown: at every place the most frequent full name among the bars that agree with the majority
        for (size_t at = 0; at < part.key.size(); ++at) {
            std::vector<Key> agree;
            for (size_t r = 0; r < part.repeats; ++r) if (keys[i + at + r * best.period] == part.key[at]) agree.push_back(labels[i + at + r * best.period]);
            const Key shown = most(agree);
            part.pattern.push_back(shown ? *shown : *part.key[at]);
        }
        out.push_back(std::move(part));
        i += best.bars;
    }
    // bars that repeat nothing, next to each other, are one free part
    std::vector<Part> merged;
    for (Part& s : out) {
        if (s.repeats < 2 && !merged.empty() && merged.back().repeats < 2) {
            Part& last = merged.back();
            last.bars += s.bars;
            last.pattern.insert(last.pattern.end(), s.pattern.begin(), s.pattern.end());
            last.key.insert(last.key.end(), s.key.begin(), s.key.end());
        } else merged.push_back(std::move(s));
    }
    // The same pattern gets the same letter: also when it starts at another of its bars, and when a quarter of its bars differ (a part is rarely read the same twice).
    const auto alike = [](const std::vector<Key>& x, const std::vector<Key>& y) {
        if (x.size() != y.size()) return false;
        for (size_t turn = 0; turn < x.size(); ++turn) {
            size_t same = 0;
            for (size_t i = 0; i < x.size(); ++i) if (x[i] == y[(i + turn) % y.size()]) ++same;
            if (static_cast<double>(same) >= 0.75 * static_cast<double>(x.size())) return true;
        }
        return false;
    };
    std::vector<size_t> letters; // per letter the part whose key it has
    for (size_t p = 0; p < merged.size(); ++p) {
        Part& s = merged[p];
        if (s.repeats < 2) { s.name = "\xE2\x80\x93"; continue; } // '–'
        size_t known = 0;
        while (known < letters.size() && !alike(s.key, merged[letters[known]].key)) ++known;
        if (known == letters.size()) letters.push_back(p);
        s.name = fromCharCode(65 + known);
    }
    return merged;
}

// track.js 120-130 (gridOf): the beats and bar starts as found, or at half or double the tempo (whether a track is 76 or 152 bpm is a matter of how one counts); the bpm it
// gives is read by no one and left out
struct Counted { std::vector<double> beats, bars; };
Counted gridOf(const Json& a, const Json& fix) {
    std::vector<double> beats, bars;
    for (const Json& t : a.at("beats")) beats.push_back(t.get<double>());
    for (const Json& b : a.at("bars")) bars.push_back(b.get<double>());
    const Json& tempo = field(fix, "tempo");
    if (tempo.is_number() && tempo.get<double>() == 2) { // a beat between every two, every bar becomes two
        Counted out;
        for (size_t i = 0; i < beats.size(); ++i) {
            out.beats.push_back(beats[i]);
            if (i + 1 < beats.size()) out.beats.push_back((beats[i] + beats[i + 1]) / 2);
        }
        const double per = a.at("beatsPerBar").get<double>();
        for (const double b : bars) { out.bars.push_back(2 * b); out.bars.push_back(2 * b + per); }
        return out;
    }
    if (tempo.is_number() && tempo.get<double>() == 0.5) { // every second beat, every second bar
        Counted out;
        if (bars.empty()) return out; // a.bars[0] % 2 is NaN: no beat is taken
        const double first = std::fmod(bars[0], 2);
        for (size_t i = 0; i < beats.size(); ++i) if (static_cast<double>(i % 2) == first) out.beats.push_back(beats[i]);
        for (size_t k = 0; k < bars.size(); k += 2) out.bars.push_back(detail::jsRound((bars[k] - first) / 2));
        return out;
    }
    return { std::move(beats), std::move(bars) };
}

// PROTOKOLL.md section 4c, as session-reference.mjs validView: the request as the page builds it from the analysis the app gives and the corrections it holds. A name that
// every object of JavaScript has as a property (`toString`, `__proto__`) is none: the page counted the chords by name in an object, where such a name reads the object's own
bool isWhole(const Json& v) { return v.is_number() && std::isfinite(v.get<double>()) && std::floor(v.get<double>()) == v.get<double>(); }
bool isChordName(const Json& v) { return v.is_string() && !detail::isObjectPrototypeNameOf(v.get_ref<const std::string&>()); }
bool validView(const Json& r) {
    if (!r.is_object() || !field(r, "analysis").is_object()) return false;
    const Json& a = r.at("analysis");
    const Json& beats = field(a, "beats");
    const Json& bars = field(a, "bars");
    const Json& chords = field(a, "chords");
    const Json& edits = field(r, "edits");
    if (!beats.is_array() || !bars.is_array() || !chords.is_array() || !edits.is_object()) return false;
    for (size_t i = 0; i < beats.size(); ++i) if (!beats[i].is_number() || (i > 0 && !(beats[i].get<double>() >= beats[i - 1].get<double>()))) return false;
    for (const Json& b : bars) if (!isWhole(b) || b.get<double>() < 0) return false;
    for (const Json& c : chords) if (!c.is_object() || !field(c, "t").is_number() || !isChordName(field(c, "chord"))) return false;
    for (const Json& name : edits) if (!isChordName(name)) return false;
    const Json& per = field(a, "beatsPerBar");
    return isWhole(per) && per.get<double>() >= 1 && field(a, "meter").is_string() && field(r, "seconds").is_number() && isWhole(field(r, "shift"));
}

struct Beat { double t; std::string chord; double from; }; // one of a bar's byBeat
struct Bar { size_t first; double start, end; std::vector<Beat> byBeat; Key main; std::string label; };
struct ChangeAt { double t; std::string chord; };
struct Derived { std::vector<double> beats; std::vector<Bar> bars; std::vector<ChangeAt> changes; std::vector<Part> sections; std::vector<std::string> names; };

// track.js 131-163 (derive) on the analysis `a`, the song's length (track.seconds) and the corrections (`fix`: shift, tempo, edits): what the page kept in its module's
// variables (gridBeats, bars, changes, sections) and the names of the legend's patterns (its buttons, 162-163)
Derived derive(const Json& a, double length, const Json& fix) {
    Derived d;
    const Counted grid = gridOf(a, fix);
    const std::vector<double>& beats = grid.beats;
    const double per = a.at("beatsPerBar").get<double>();
    const Json& chords = a.at("chords");
    const Json& edits = fix.at("edits");
    const size_t n = beats.size();
    // the chord at a time; without chords the page read .chord of undefined and threw
    const auto at = [&](double t) -> const Json& {
        for (size_t c = chords.size(); c-- > 0;) if (chords[c].at("t").get<double>() <= t + 0.01) return chords[c];
        if (chords.empty()) throw std::invalid_argument("trackView: an analysis without chords");
        return chords[0];
    };
    // bar starts as found, moved by the user's correction; beats before the first one form a short first bar
    const double shift = std::fmod(std::fmod(fix.at("shift").get<double>(), per) + per, per);
    std::vector<double> starts;
    std::set<double> seen; // new Set: 0 and -0 are one
    const auto start = [&](double b) { if (seen.insert(b).second) starts.push_back(b); };
    start(0);
    if (shift != 0 && !grid.bars.empty() && grid.bars[0] + shift >= per) start(grid.bars[0] + shift - per); // without bars, grid.bars[0] + shift is NaN
    for (const double b : grid.bars) start(b + shift);
    starts.erase(std::remove_if(starts.begin(), starts.end(), [&](double b) { return !(b < static_cast<double>(n)); }), starts.end());
    for (size_t k = 0; k < starts.size(); ++k) {
        const size_t i = static_cast<size_t>(starts[k]), stop = k + 1 < starts.size() ? static_cast<size_t>(starts[k + 1]) : n;
        const Json* edit = detail::member(edits, std::to_string(i));
        Bar bar { i, beats[i], stop < n ? beats[stop] : length, {}, {}, {} };
        for (size_t j = i; j < stop; ++j) {
            if (edit != nullptr) { bar.byBeat.push_back({ beats[j], edit->get<std::string>(), beats[j] }); continue; }
            const Json& c = at(beats[j]);
            bar.byBeat.push_back({ beats[j], c.at("chord").get<std::string>(), c.at("t").get<double>() });
        }
        std::vector<Key> plains;
        for (const Beat& b : bar.byBeat) plains.push_back(plain(b.chord));
        bar.main = most(plains); // the chord most of the bar plays, for comparing bars (the count of 144-146 is most's)
        std::vector<std::string> distinct;
        for (const Beat& b : bar.byBeat) if (std::find(distinct.begin(), distinct.end(), b.chord) == distinct.end()) distinct.push_back(b.chord);
        for (size_t c = 0; c < distinct.size(); ++c) bar.label += (c ? " " : "") + distinct[c];
        d.bars.push_back(std::move(bar));
    }
    // a change begins where its chord begins in the analysis: on its beat, or an eighth before it (a pushed chord)
    double before = -std::numeric_limits<double>::infinity(); // the beat before
    for (const Bar& b : d.bars) for (const Beat& s : b.byBeat) {
        if (d.changes.empty() || d.changes.back().chord != s.chord) d.changes.push_back({ s.from > before ? s.from : s.t, s.chord });
        before = s.t;
    }
    std::vector<std::string> labels;
    std::vector<Key> mains;
    for (const Bar& b : d.bars) { labels.push_back(b.label); mains.push_back(b.main); }
    d.sections = findSections(labels, mains);
    // the legend: the patterns that fill most of the track, at most eight, in the order they first appear
    std::vector<std::pair<std::string, size_t>> share; // in the order the names came (no name is an array index)
    for (const Part& s : d.sections) {
        if (s.repeats < 2) continue;
        const auto it = std::find_if(share.begin(), share.end(), [&](const auto& v) { return v.first == s.name; });
        if (it == share.end()) share.emplace_back(s.name, s.bars); else it->second += s.bars;
    }
    std::stable_sort(share.begin(), share.end(), [](const auto& x, const auto& y) { return x.second > y.second; });
    std::vector<std::string> top;
    for (size_t k = 0; k < share.size() && k < 8; ++k) top.push_back(share[k].first);
    for (const Part& s : d.sections)
        if (std::find(top.begin(), top.end(), s.name) != top.end() && std::find(d.names.begin(), d.names.end(), s.name) == d.names.end()) d.names.push_back(s.name);
    d.beats = beats;
    return d;
}

} // namespace

// PROTOKOLL.md section 4c: what native/app/ui/track.js derived (derive above) and read of it at the playhead (draw, 423-445) and in the lane, line by line on the request;
// session-reference.mjs trackView holds the page's lines
std::string trackView(const std::string& requestJson) {
    try {
        const Json r = detail::parsedText(requestJson);
        if (!validView(r)) return "";
        const Json& a = r.at("analysis");
        const Derived d = derive(a, r.at("seconds").get<double>(), r); // the request's shift, tempo and edits are the page's fix
        const std::vector<double>& beats = d.beats;
        const std::vector<Bar>& bars = d.bars;
        const std::vector<Part>& sections = d.sections;
        const std::string& meter = a.at("meter").get_ref<const std::string&>();
        const size_t n = beats.size();
        // the answer: what draw() read (423-445) and the lane drew (237-262)
        Json grid_ = Json::array();
        for (const double t : beats) grid_.push_back(t);
        Json tempos = Json::array(); // 433-434: the tempo at the playhead from the beats around it, by the number of beats up to the playhead; none with fewer than ten
        if (n > 9) {
            const bool eighths = meter.size() >= 2 && meter.compare(meter.size() - 2, 2, "/8") == 0;
            for (size_t up = 0; up <= n; ++up) {
                const long long here = std::max(4LL, std::min(static_cast<long long>(n) - 5, static_cast<long long>(up) - 1));
                const Json bpm(detail::jsRound(60.0 * 8 / (beats[static_cast<size_t>(here + 4)] - beats[static_cast<size_t>(here - 4)]) / (eighths ? 3 : 1)));
                tempos.push_back(detail::jsStringOf(&bpm) + " bpm \xC2\xB7 " + meter);
            }
        }
        Json barsOut = Json::array(); // per bar its part (436), its place in the part's pattern (445) and the turn (444)
        for (size_t k = 0; k < bars.size(); ++k) {
            size_t part = 0;
            while (part < sections.size() && !(k >= sections[part].first && k < sections[part].first + sections[part].bars)) ++part;
            const Part& s = sections.at(part); // findSections covers every bar
            Json times = Json::array();
            for (const Beat& b : bars[k].byBeat) times.push_back(b.t);
            barsOut.push_back(Json::object({ { "first", bars[k].first }, { "start", bars[k].start }, { "end", bars[k].end }, { "beats", std::move(times) }, { "label", bars[k].label },
                                             { "part", part }, { "place", (k - s.first) % s.pattern.size() }, { "turn", (k - s.first) / s.pattern.size() + 1 } }));
        }
        Json changesOut = Json::array(); // 428: the beats up to a change
        for (const ChangeAt& c : d.changes)
            changesOut.push_back(Json::object({ { "t", c.t }, { "chord", c.chord }, { "beats", std::count_if(beats.begin(), beats.end(), [&](double b) { return b <= c.t + 0.01; }) } }));
        Json partsOut = Json::array(); // the lane (257-262), the chords sent to chordDisplays (442), 444-445: a part that does not repeat shows no pattern
        for (const Part& s : sections) {
            Json used = Json::array();
            if (s.repeats >= 2) for (const std::string& p : s.pattern) for (const std::string& c : pieces(p)) if (std::find(used.begin(), used.end(), c) == used.end()) used.push_back(c);
            partsOut.push_back(Json::object({ { "start", bars[s.first].start }, { "end", bars[s.first + s.bars - 1].end }, { "name", s.name },
                                              { "pattern", s.repeats >= 2 ? Json(s.pattern) : Json() }, { "repeats", s.repeats }, { "used", std::move(used) } }));
        }
        Json legend = Json::array(); // 162-169: per pattern the text's pieces, the count and the places
        for (const std::string& name : d.names) {
            const Part* first = nullptr;
            size_t count = 0;
            Json places = Json::array();
            for (const Part& s : sections) {
                if (s.name != name) continue;
                if (first == nullptr) first = &s;
                count += s.repeats;
                places.push_back(bars[s.first].start);
            }
            legend.push_back(Json::object({ { "name", name }, { "pattern", first->pattern }, { "count", count }, { "places", std::move(places) } }));
        }
        return detail::stringify(Json::object({ { "beats", std::move(grid_) }, { "tempo", std::move(tempos) }, { "bars", std::move(barsOut) }, { "changes", std::move(changesOut) },
                                                { "sections", std::move(partsOut) }, { "legend", std::move(legend) } }));
    } catch (...) { return ""; }
}

// profiles.js 299-312 for a row's key; `name` stands for the translations the web takes for the session, a factory profile and "mine"
std::string Session::exportFile(const std::string& key, const std::string& name) const {
    try {
        const Memory& m = *memory_;
        Json data;
        if (key == "session") data = detail::makeProfileFile(Json::object({ { "name", name }, { "parts", detail::captureParts(detail::readSession(m.state), Json()) } }));
        else if (key == "mine") data = detail::makeFolderFile(Json::object({ { "name", name }, { "items", m.tree.at("items") }, { "backup", true } }));
        else if (key.rfind("factory:", 0) == 0 && oneOf(Json(key.substr(8)), styleIds()))
            data = detail::makeProfileFile(Json::object({ { "name", name }, { "parts", detail::factoryParts(key.substr(8)) } }));
        else {
            const Json f = detail::find(m.tree, Json(key));
            if (f.is_null()) return ""; // no row, or "factory" (its exchange box is hidden: 425)
            data = f.at("node").at("type") == "profile" ? detail::makeProfileFile(f.at("node")) : detail::makeFolderFile(f.at("node"));
        }
        if (data.at("format") == "backingtrack-folder" && data.at("items").empty()) return ""; // 312, 315: ui.profileNothing
        return detail::stringify(data, 2);
    } catch (...) { return ""; } // no input is known that reaches it
}

} // namespace btg
