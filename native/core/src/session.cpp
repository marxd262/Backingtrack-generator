// The web app's state and the rules that change it (native/PROTOKOLL.md). The state is the JSON object of src/ui/state.js (the fields of PROTOKOLL.md,
// section 4) plus `touched` of app.js and `selected` of form-strip.js (selectedPart); the functions below are state.js's and the handlers' with their names,
// line by line, on that object.
// native/core/tests/test_logic.cpp (function `session`) plays the sequences of native/tools/export-logic.mjs against native/tools/session-reference.mjs.
#include "btg/session.h"

#include "form_internal.h"
#include "generator_internal.h"
#include "harmony.h"
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

using detail::Json;
using Change = Session::Change;

// ---------- the tables (music.json, grooves.json, sound.json) ----------

const Json& music() { return detail::musicTable(); }
const Json& grid(const std::string& meterKey) { return music().at("meterGrid").at(meterKey); } // METERS[key]: { beats, sub }
const Json& preset(const std::string& id) { // state.js preset(id)
    for (const Json& p : music().at("styles")) if (p.at("id") == id) return p;
    throw std::invalid_argument("no such style");
}
std::vector<std::string> keysOf(const Json& object) { std::vector<std::string> out; for (auto it = object.begin(); it != object.end(); ++it) out.push_back(it.key()); return out; }
const std::vector<std::string>& layerIds() { static const std::vector<std::string> ids = keysOf(music().at("layers")); return ids; }   // LAYER_IDS
const std::vector<std::string>& voiceLayers() { static const std::vector<std::string> ids = keysOf(music().at("voices")); return ids; } // VOICE_LAYERS
const std::vector<std::string>& styleIds() { static const std::vector<std::string> ids = [] { std::vector<std::string> out; for (const Json& p : music().at("styles")) out.push_back(p.at("id")); return out; }(); return ids; }
const std::vector<std::string>& scaleNames() { static const std::vector<std::string> ids = keysOf(music().at("scaleModes")); return ids; } // SCALE_NAMES
const std::vector<std::string>& mixNames() { static const std::vector<std::string> ids = [] { std::vector<std::string> out = layerIds(); out.push_back("master"); return out; }(); return ids; } // audio/mix.js MIX_NAMES
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

const Json NONE; // a field the action does not have (the web's undefined)
const Json& field(const Json& a, const char* name) { const auto it = a.find(name); return it == a.end() ? NONE : *it; }
bool isNullField(const Json& a, const char* name) { const auto it = a.find(name); return it != a.end() && it->is_null(); } // `=== null`: given as null, not missing
bool isInt(const Json& v, double lo, double hi) { // Number.isInteger(v) && v >= lo && v <= hi
    if (!v.is_number()) return false;
    const double d = v.get<double>();
    return std::isfinite(d) && std::floor(d) == d && d >= lo && d <= hi;
}
bool oneOf(const Json& v, const Json& list) { return v.is_string() && std::find(list.begin(), list.end(), v) != list.end(); }
bool oneOf(const Json& v, const std::vector<std::string>& list) { return v.is_string() && std::find(list.begin(), list.end(), v.get<std::string>()) != list.end(); }
bool isDraw(const Json& v) { return v.is_number() && v.get<double>() >= 0 && v.get<double>() < 1; } // Math.random()
bool isFrom(const Json& v) { return v == "start" || v == "play"; }
bool isVariant(const Json& v) { return isInt(v, 1, 9999); }
bool isDir(const Json& v) { return v.is_number() && (v.get<double>() == -1 || v.get<double>() == 1); }
double numberOf(const Json& v) { return v.get<double>(); }
// a number as the web holds it: a whole one an integer (as JSON.stringify writes it), any other a double
Json num(double v) { return std::floor(v) == v && std::fabs(v) < 9007199254740992.0 ? Json(static_cast<std::int64_t>(v)) : Json(v); }
// JavaScript truthiness. shortcut: only booleans, null and objects reach it (form.auto, track.form, a part's locked), upgrade: if a number or a text can
bool truthy(const Json& v) { return v.is_boolean() ? v.get<bool>() : !v.is_null(); }
const Json& pick(const Json& list, double r) { return list.at(static_cast<size_t>(std::floor(r * static_cast<double>(list.size())))); } // app.js 209 with the draw from the action

// ---------- grooves.js ----------

// meterKey: [6, 8] gives '6/8', anything that is no pair of integers ''. shortcut: an integer beyond 2^53 is '' here and printed by the web ('1e+21/4'),
// upgrade: if a meter can come from outside the session's own actions (Task 30: profiles bring a meter checked against METERS)
std::string meterKey(const Json& meter) {
    constexpr double SAFE = 9007199254740991.0;
    if (!meter.is_array() || meter.size() != 2 || !isInt(meter[0], -SAFE, SAFE) || !isInt(meter[1], -SAFE, SAFE)) return "";
    return std::to_string(static_cast<std::int64_t>(numberOf(meter[0]))) + "/" + std::to_string(static_cast<std::int64_t>(numberOf(meter[1])));
}
bool isMeterKey(const std::string& key) { return music().at("meterGrid").contains(key); } // Object.hasOwn(METERS, key)
int subOf(const std::string& key) { return grid(key).at("sub").get<int>(); }
double convertTempo(double bpm, const std::string& fromKey, const std::string& toKey) {
    if (!isMeterKey(fromKey) || !isMeterKey(toKey)) return bpm;
    const int from = subOf(fromKey), to = subOf(toKey);
    if (from == to) return bpm;
    return std::min(200.0, std::max(40.0, detail::jsRound(bpm * (to == 3 ? 2.0 / 3.0 : 3.0 / 2.0))));
}

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
                            { "selectedPart", 0 } }); // form-strip.js 35: `selected`
    deriveBars(s);
    setFormTemplate(s, "auto");
    return s;
}

// ---------- the handlers (app.js and the panels; session-reference.mjs names their lines) ----------

struct Step {
    Json& s;
    const Json& a;
    Change& c;
    std::string& pushed; // organ-panel.js 46: the tuning last handed to the player
    const Json playerLength;        // the track the player plays: every action that changes the length or the meter restarts it, so it is the state's before the action
    const std::string playerMeter;
    Json& t() { return trackOf(s); }
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
        // a fresh load keeps the mixer and the panorama: they are stored preferences (loadMix, loadPan); only the constructor gives their defaults
        { "start", { [](const Json&, const Json& a) { return isVariant(field(a, "variant")); },
                     [](Step& x) {
                         const Json mix = x.s.at("mix"), pan = x.s.at("pan");
                         x.s = startState(numberOf(x.a.at("variant")));
                         x.s["mix"] = mix;
                         x.s["pan"] = pan;
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
                        [](Step& x) { x.s["mix"][x.a.at("channel").get<std::string>()] = num(numberOf(x.a.at("value")) / 100); x.c.mix = true; },
                        [](const Json& s, const Json& a) { return showsPercent(s.at("mix").at(a.at("channel").get<std::string>()), a.at("value")); } } }, // mixer.js 101-103
        { "setPan", { [](const Json&, const Json& a) { return oneOf(field(a, "layer"), layerIds()) && isInt(field(a, "value"), -100, 100); },
                      [](Step& x) { x.s["pan"][x.a.at("layer").get<std::string>()] = num(numberOf(x.a.at("value")) / 100); x.c.mix = true; },
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

std::string dump(const Json& j) { return j.dump(-1, ' ', false, Json::error_handler_t::replace); }

} // namespace

Session::Session(Storage& storage) : storage_(storage), state_(dump(startState(1))) {}

Session::Change Session::apply(const std::string& actionJson) {
    try {
        // JSON.parse; text that is no JSON is null. shortcut: text nested deeper than 64 levels counts as no JSON (track.cpp's reader), where JSON.parse
        // takes it (an action has two levels), upgrade: with the reader's limit
        const Json a = detail::parsedText(actionJson);
        if (!a.is_object() || !a.contains("action") || !a.at("action").is_string()) return {};
        const auto handler = handlers().find(a.at("action").get<std::string>());
        if (handler == handlers().end()) return {};
        Json s = Json::parse(state_);
        if (!handler->second.valid(s, a)) return {};
        if (handler->second.same && handler->second.same(s, a)) return {}; // the value the control shows: the web sends no event
        Change c;
        const std::string watched = voiceKeys(s.at("track").at("voices"));
        std::string pushed = detail::organTuning(s.at("organ")).dump();
        Step step { s, a, c, pushed, s.at("track").at("length"), meterKey(s.at("track").at("meter")) };
        handler->second.run(step);
        // what render() does: hands the player the voices when one changed (voices-panel.js 89-93) and a changed tuning (organ-panel.js 62-64), clamps the selection
        if (voiceKeys(s.at("track").at("voices")) != watched) c.voices = true;
        step.renderOrgan();
        clampSelection(s);
        state_ = dump(s);
        return c;
    } catch (...) { // a helper that throws where the web would coerce (harmony.h, form_internal.h): the action changes nothing
        return {};
    }
}

// app.js 128, 191: the player gets { ...state.track, layers: ALL_LAYERS } and the mutes through setLayer (139, 200), so that switching a layer on sounds at once
std::string Session::track() const {
    Json t = Json::parse(state_).at("track");
    Json all = Json::object();
    for (const std::string& layer : layerIds()) all[layer] = true; // state.js 21 ALL_LAYERS
    t["layers"] = all;
    return dump(t);
}
std::string Session::sound() const { return dump(detail::resolveTrackTimbre(Json::parse(state_).at("track"))); }
std::string Session::tuning() const { return dump(detail::organTuning(Json::parse(state_).at("organ"))); }
std::string Session::state() const {
    Json s = Json::parse(state_);
    s["errors"] = detail::trackErrors(detail::normalizedTrack(s.at("track"))); // validateTrack of index.js: normalizeTrack first
    return dump(s);
}

} // namespace btg
