// The web app's state and the rules that change it (native/PROTOKOLL.md). The state is the JSON object of src/ui/state.js (the fields of PROTOKOLL.md,
// section 4) plus `touched` of app.js, `selected` of form-strip.js (selectedPart), the web's `errors`, what the profile window holds (`profiles`: selection, open
// folders, message) and `resumed`; the tree, what "undo" keeps and the last session are held beside it (Session::Memory). The functions below are state.js's and
// the handlers' with their names, line by line, on that object.
// native/core/tests/test_logic.cpp (function `session`) plays the sequences of native/tools/export-logic.mjs against native/tools/session-reference.mjs.
#include "btg/session.h"

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
#include <map>
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
    if (s.at("chordColorFromStyle") == true) s["chordColor"] = styleColor(s);
    trackOf(s)["bars"] = derivedBars(s, s.at("chordColor"));
}

void setChordColor(Json& s, const std::string& color) {
    const bool untouched = trackOf(s).at("bars") == derivedBars(s, s.at("chordColor")); // JSON.stringify(a) === JSON.stringify(b): ordered_json compares keys in order
    s["chordColor"] = color;
    if (untouched) deriveBars(s);
    else trackOf(s)["bars"] = detail::colorProgression(trackOf(s).at("bars"), Json(color), trackOf(s).at("key"));
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
    if (t.at("bars").size() >= MAX_CHORDS) return false; // the notice "full" is the page's
    t["bars"].push_back(Json::object({ { "chord", Json::object({ { "root", root }, { "quality", quality } }) }, { "beats", grid(meterKey(t.at("meter"))).at("beats") } }));
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
// loadMix and loadPan of the stored text (nothing, or no JSON: the defaults). shortcut: a text nested deeper than 64 levels counts as no JSON (track.cpp's reader), where the web
// reads the fields beside the deep one, upgrade: with the reader's limit
Json loadMix(const std::optional<std::string>& text) { return sanitizeMix(text ? detail::parsedText(*text) : Json()); }
Json loadPan(const std::optional<std::string>& text) { return sanitizePan(text ? detail::orNull(detail::member(detail::parsedText(*text), "pan")) : Json()); }
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
                            { "organ", Json::object({ { "leslie", "auto" }, { "drive", nullptr } }) }, { "tempoRef", nullptr },
                            { "touched", Json::object({ { "key", false }, { "style", false }, { "tempo", false }, { "variant", false } }) },
                            { "selectedPart", 0 }, // form-strip.js 35: `selected`
                            { "errors", Json::array() }, { "resumed", nullptr } }); // state.js 88; no resume
    deriveBars(s);
    setFormTemplate(s, "auto");
    return s;
}

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
    Pending pending {};
    std::optional<Json> newTree {}, newUndo {}; // a commit's tree and undo, taken when its write holds
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
                           [](Step& x) { Json& bars = x.t()["bars"]; bars.erase(bars.begin() + static_cast<std::ptrdiff_t>(numberOf(x.a.at("index")))); x.restartIfPlaying(false); } } },
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
                          [](Step& x) { x.s["selectedPart"] = num(numberOf(x.a.at("index"))); } } },
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
        // the button stands only with a form (form-strip.js 235). shortcut: its branch for a form that is not valid (setFormTemplate of its template) is left out, as no
        // action of the session makes one, upgrade: when the last session or a profile can bring one (Task 30)
        { "rerollForm", { [](const Json& s, const Json&) { return formNow(s) != nullptr; },
                          [](Step& x) {
                              const Json& sections = formNow(x.s)->at("sections");
                              if (std::all_of(sections.begin(), sections.end(), [](const Json& part) { return truthy(part.value("locked", Json())); })) return; // the note "all locked" is the page's
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
// profile-session.js writeSession with its saveMix; the state keeps tempoRef as null where the web deletes it and holds no notice (the page's, PROTOKOLL.md section 6)
void writeSession(Json& s, const Json& session, Storage& storage) {
    detail::writeSession(s, session);
    if (!s.contains("tempoRef")) s["tempoRef"] = nullptr;
    s.erase("notice");
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
                                     skipped != 0 ? count("ui.profileSkipped", skipped) : Json(), dropped != 0 ? count("ui.profileDropped", dropped) : Json() });
                                 const Json openNext = single ? x.win().at("open") : opened(x.win().at("open"), target.is_null() ? Json("mine") : target); // 351
                                 commit(x, added.at("tree"), single ? added.at("rootId") : Json(), texts, true, &openNext);
                                 return true; } } },
        // 169-172: the button stands while there is something to undo (427)
        { "undoProfile", { [](const Step& x) { return !x.undo.is_null(); },
                           [](Step& x) { const Json u = x.undo; commit(x, u.at("tree"), u.at("selection"), Json::array({ msg("ui.profileUndone") }), false); return true; } } },
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

// state().profiles (PROTOKOLL.md section 4): the tree lightly, and what the window's building blocks read
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
    return Json::object({ { "items", light(tree.at("items")) }, { "nodes", num(detail::countNodes(tree)) }, { "factory", detail::factoryProfiles() }, { "selection", win.at("selection") },
                          { "open", win.at("open") }, { "undo", !undo.is_null() }, { "message", win.at("message") }, { "targets", targets }, { "counts", counts } });
}
// what the box "Zuletzt gespielt" shows (app.js 450-459)
Json lastView(const Json& entry) {
    const Json& p = entry.at("parts");
    Json out = Json::object({ { "bar", entry.at("bar") }, { "at", entry.at("at") }, { "root", p.at("harmony").at("key").at("root") }, { "scale", p.at("harmony").at("scale") },
                              { "style", p.at("style").at("style") }, { "bpm", p.at("tempo").at("bpm") } });
    if (const Json* seed = detail::member(p.at("variant"), "seed")) out["seed"] = *seed;
    return out;
}

// a call of the shell's storage that throws counts as one that fails: nothing read, nothing written
struct SafeStorage : Storage {
    explicit SafeStorage(Storage& inner) : inner_(inner) {}
    std::optional<std::string> read(const std::string& name) override { try { return inner_.read(name); } catch (...) { return std::nullopt; } }
    bool write(const std::string& name, const std::string& text) override { try { return inner_.write(name, text); } catch (...) { return false; } }
private:
    Storage& inner_;
};
// the texts the constructor read, once, for the loaders of profiles.h
struct Texts : Storage {
    std::map<std::string, std::optional<std::string>> files;
    std::optional<std::string> read(const std::string& name) override { const auto it = files.find(name); return it == files.end() ? std::nullopt : it->second; }
    bool write(const std::string&, const std::string&) override { return false; }
};
// Where the web's loadTree calls defaultMakeId: "1", "2", ..., each no `id` of an object anywhere in the stored value (PROTOKOLL.md section 2). shortcut: the one place where
// the core names ids itself, the constructor having no action that could bring them; the ids of repaired stored nodes are predictable, upgrade: if the shell should name them
detail::MakeId freeIds(const std::optional<std::string>& text) {
    const auto used = std::make_shared<std::set<std::string>>();
    const std::function<void(const Json&)> walk = [&](const Json& v) {
        if (v.is_array()) for (const Json& x : v) walk(x);
        if (!v.is_object()) return;
        if (const Json* id = detail::member(v, "id"); id != nullptr && id->is_string()) used->insert(id->get<std::string>());
        for (auto it = v.begin(); it != v.end(); ++it) walk(it.value());
    };
    if (text) walk(detail::parsedText(*text));
    const auto k = std::make_shared<long long>(0);
    return [used, k] { std::string id; do id = std::to_string(++*k); while (used->count(id)); return id; };
}

std::string dump(const Json& j) { return j.dump(-1, ' ', false, Json::error_handler_t::replace); }

} // namespace

struct Session::Memory {
    Json state; // the state: the fields of state() (PROTOKOLL.md section 4) but the tree, the last session and what is derived, with the web's `errors`
    Json tree;  // the profiles { items }
    Json undo;  // what "Rückgängig" keeps: null or { tree, selection, message }
    Json last;  // the last session: null or { parts, bar, at }
};

// PROTOKOLL.md section 2: the page load on the stored texts (state.js 58-90 with seed 1, app.js 153 and 484-486, profiles.js 41-47). It restores nothing and writes
// nothing: the last session is only the offer of "Weitermachen", which is the action resume (app.js 226-236).
Session::Session(Storage& storage) : storage_(storage), memory_(std::make_unique<Memory>()) {
    Memory& m = *memory_;
    m.state = startState(1);
    m.state["profiles"] = Json::object({ { "selection", "session" }, { "open", Json::array({ "mine", "factory" }) }, { "message", nullptr } }); // profiles.js 42-47
    SafeStorage safe(storage_);
    Texts texts;
    for (const char* name : { detail::MIX_NAME, detail::PROFILES_NAME, detail::SESSION_NAME }) texts.files[name] = safe.read(name);
    // each of the four loaders is the web's and answers any text as it does, with its catch-all where the web has one (profiles.h): no text is known that makes one throw
    m.state["mix"] = loadMix(texts.files.at(detail::MIX_NAME)); // state.js 84-85
    m.state["pan"] = loadPan(texts.files.at(detail::MIX_NAME));
    m.tree = detail::loadTree(texts, freeIds(texts.files.at(detail::PROFILES_NAME)));
    m.undo = Json();
    m.last = detail::loadLast(texts); // app.js 153
}

Session::~Session() = default;

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
        Step step { s, a, c, pushed, s.at("track").at("length"), meterKey(s.at("track").at("meter")), m.tree, m.undo, last };
        s["resumed"] = nullptr; // the bar of a resume holds for the action that set it only
        if (handler != handlers().end()) handler->second.run(step);
        else if (!profile->second.valid(step) || !profile->second.run(step)) return {};
        // what render() does: hands the player the voices when one changed (voices-panel.js 89-93) and a changed tuning (organ-panel.js 62-64), clamps the selections
        if (voiceKeys(s.at("track").at("voices")) != watched) c.voices = true;
        step.renderOrgan();
        clampSelection(s);
        settleSelection(s, step.newTree ? *step.newTree : m.tree);
        // the writes, in the order the web makes them, when everything else of the action is done: a tree that is not stored is not taken (Review Focus 3), the
        // session's other texts are, as in the web, which goes on without them. shortcut: dropping the action for a failed profiles.json is all or nothing only while no
        // action writes profiles.json and another name (none does: PROTOKOLL.md section 3a), upgrade: when one does, write the tree first and the others only after it held
        SafeStorage safe(storage_);
        for (const auto& [name, text] : step.pending.texts) {
            if (safe.write(name, text) || name != detail::PROFILES_NAME) continue;
            m.state["profiles"]["message"] = Json::array({ msg("ui.profileNotStored") });
            m.state["resumed"] = nullptr; // a valid action all the same
            return {};
        }
        m.state = std::move(s);
        m.last = std::move(last);
        if (step.newTree) { m.tree = std::move(*step.newTree); m.undo = std::move(*step.newUndo); }
        return c;
    } catch (...) { // a helper that throws where the web would coerce (harmony.h, form_internal.h): the action changes nothing
        return {};
    }
}

// app.js 128, 191: the player gets { ...state.track, layers: ALL_LAYERS } and the mutes through setLayer (139, 200), so that switching a layer on sounds at once
std::string Session::track() const {
    Json t = memory_->state.at("track");
    Json all = Json::object();
    for (const std::string& layer : layerIds()) all[layer] = true; // state.js 21 ALL_LAYERS
    t["layers"] = all;
    return dump(t);
}
std::string Session::sound() const { return dump(detail::resolveTrackTimbre(memory_->state.at("track"))); }
std::string Session::tuning() const { return dump(detail::organTuning(memory_->state.at("organ"))); }
std::string Session::state() const {
    const Memory& m = *memory_;
    Json s = m.state;
    // a failed resume's errors (app.js 231), else validateTrack of index.js (normalizeTrack first), what a failed start shows
    if (s.at("errors").empty()) s["errors"] = detail::trackErrors(detail::normalizedTrack(s.at("track")));
    s["profiles"] = profilesView(m.state, m.tree, m.undo);
    s["last"] = m.last.is_null() ? Json() : lastView(m.last);
    return dump(s);
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
