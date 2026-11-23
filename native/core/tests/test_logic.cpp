// Compares the core's logic function by function with the web app in the working tree.
// Usage: btg_logic_tests <logic.json>   (written by native/tools/export-logic.mjs)
// logic.json is a manifest { total, chunks: [{ file, count }] }; the cases are in the chunk files next to it (a list each), read one at a
// time. A manifest or chunk that is missing, cut off or no JSON, and a chunk or a total that does not hold the number the manifest says, fail.
// Every case is { fn, in, out }: the core's function of that name gets `in` and must give `out`, compared as the parity test compares
// events (json_compare.h): numbers bit for bit ("identical") or within 1.5e-6 ("close", which fails too: a difference in the last bits,
// possibly another platform's math library; an exception has to be ruled and named here); anything else fails, also an unknown fn.
// The one ruled exception (progress.md, "Task 24: Ruling", named before any run): a renderString case that is close passes, and their number
// is printed. The string model calls sin, cos, exp, pow and sqrt per partial and per sample, the C runtime's where the web calls V8's; the
// one case close on MSVC (task-24-report.md) differs from the web because one sin returns the other neighbour of a value that lies within
// 1.2e-20 of the midpoint of two doubles, and with V8's results in place of the C runtime's the core's samples are the web's bit for bit.
#include "../src/convolver.h"
#include "../src/form_internal.h"
#include "../src/harmony.h"
#include "../src/profiles.h"
#include "../src/sound_data.h"
#include "../src/sound_model.h"
#include "../src/string_model.h"
#include "../src/timbre.h"
#include "../src/track_internal.h"
#include "btg/generator.h"
#include "btg/session.h"
#include "btg/track.h"
#include "json_compare.h"

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <tuple>

using json = nlohmann::json;
using namespace btg::detail;
using btg::Engine;

namespace {

json toJson(Timbre t) {
    json j = json::object();
    forEachField(t, [&](const char* group, const char* field, double& v) { j[group][field] = v; });
    return j;
}
json toJson(const MasterParams& p) { return { { "shelfDb", p.shelfDb }, { "level", p.level }, { "shelfFreq", p.shelfFreq }, { "echoWet", p.echoWet }, { "echoFeedback", p.echoFeedback },
    { "echoTone", p.echoTone }, { "reverbWet", p.reverbWet }, { "roomSize", p.roomSize }, { "roomWet", p.roomWet }, { "width", p.width } }; }
json toJson(const DrumParams& p) { return { { "kickStart", p.kickStart }, { "kickEnd", p.kickEnd }, { "kickDrop", p.kickDrop }, { "kickDecay", p.kickDecay }, { "kickPeak", p.kickPeak },
    { "kickClick", p.kickClick }, { "snareFreq", p.snareFreq }, { "snareQ", p.snareQ }, { "snareNoise", p.snareNoise }, { "snareClick", p.snareClick }, { "snareTone", p.snareTone },
    { "snareDecay", p.snareDecay }, { "hatFreq", p.hatFreq }, { "hatPeak", p.hatPeak }, { "hatClosedDecay", p.hatClosedDecay }, { "hatOpenDecay", p.hatOpenDecay },
    { "roomSend", p.roomSend } }; }
json toJson(const BassParams& p) { return { { "sawDetune", p.sawDetune }, { "q", p.q }, { "lpStart", p.lpStart }, { "lpEnd", p.lpEnd }, { "lpTime", p.lpTime }, { "sawMix", p.sawMix },
    { "triMix", p.triMix }, { "sineGain", p.sineGain }, { "peak", p.peak }, { "sustain", p.sustain }, { "attack", p.attack }, { "release", p.release }, { "holdMin", p.holdMin },
    { "holdCut", p.holdCut } }; }
json toJson(const ChordParams& p) { return { { "lpStart", p.lpStart }, { "lpEnd", p.lpEnd }, { "lpTime", p.lpTime }, { "holdScale", p.holdScale }, { "release", p.release }, { "peak", p.peak },
    { "attack", p.attack }, { "chorusMix", p.chorusMix }, { "chorusDetune", p.chorusDetune }, { "tremRate", p.tremRate }, { "tremDepth", p.tremDepth }, { "tremBase", p.tremBase } }; }
json toJson(const PadParams& p) { return { { "attack", p.attack }, { "peak", p.peak }, { "holdMin", p.holdMin }, { "holdCut", p.holdCut }, { "holdAttack", p.holdAttack },
    { "release", p.release }, { "cutoff", p.cutoff }, { "q", p.q }, { "lfoSpeed", p.lfoSpeed }, { "lfoDepth", p.lfoDepth }, { "spread", p.spread }, { "extraMix", p.extraMix },
    { "shimmerMix", p.shimmerMix } }; }
json toJson(const FxStage& s) { return { { "mix", s.mix }, { "drive", s.drive }, { "makeup", s.makeup } }; }
json toJson(const FxChainParams& p) { return { { "active", p.active }, { "od", toJson(p.od) }, { "dist", toJson(p.dist) }, { "fuzz", toJson(p.fuzz) }, { "cab", p.cab } }; }
json toJson(const ModParams& p) { return { { "active", p.active }, { "vibrato", { { "on", p.vibrato.on }, { "hz", p.vibrato.hz }, { "depth", p.vibrato.depth } } },
    { "chorus", { { "wet", p.chorus.wet }, { "norm", p.chorus.norm } } } }; }

// a group as the core reads it: completeTimbre({ <group>: in })
Timbre group(const char* name, const json& in) { return completeTimbre(json { { name, in } }.dump()); }
double number(const json& in, const char* field) { const auto f = in.find(field); return f != in.end() && f->is_number() ? f->get<double>() : NAN; }
Engine::Layer layerOf(const std::string& name) {
    static const std::map<std::string, Engine::Layer> LAYERS { { "drums", Engine::drums }, { "bass", Engine::bass }, { "chords", Engine::chords }, { "pad", Engine::pad },
                                                               { "lead", Engine::lead }, { "percussion", Engine::percussion } };
    return LAYERS.at(name);
}
json toJson(const LayerFx& p) { return { { "ref", p.ref }, { "trim", { { "od", p.trim.od }, { "dist", p.trim.dist }, { "fuzz", p.trim.fuzz } } }, { "odSlope", p.odSlope },
    { "distHp", p.distHp }, { "toneHz", p.toneHz }, { "cabHp", p.cabHp }, { "cabLp", p.cabLp }, { "cabPeakHz", p.cabPeakHz }, { "cabPeakDb", p.cabPeakDb } }; }

// Task 25: the track check. The helpers work on ordered_json (the order of keys is the text's); the comparison does not look at the order of an object's keys.
Json ordered(const json& j) { return Json::parse(j.dump()); }
json plain(const Json& j) { return json::parse(j.dump()); }
// the web's `undefined` is { undefined: true }, a value { value }; a helper that throws in the web throws std::invalid_argument here: { threw: true }
json thrown(const std::function<Json()>& call) {
    try { return plain(call()); } catch (const std::invalid_argument&) { return json { { "threw", true } }; }
}
// the text of the track functions: their `in` is the track's text, their output a text
json parsed(const std::string& text) { return json::parse(text, nullptr, false); }
// Task 26: the argument of a case, null where the case leaves it out (the web's undefined)
Json argument(const Json& in, const char* name) { const auto found = in.find(name); return found == in.end() ? Json() : *found; }
// Task 27: a value the web calls with as `undefined` is { "$undefined": true } in a case (JSON has none); the core takes it as a discarded value
Json undefinedOf(const Json& v) { return v.is_object() && v.size() == 1 && v.contains("$undefined") ? Json(Json::value_t::discarded) : v; }
Json patchOf(const Json& patch) {
    Json out = patch;
    if (out.is_object()) for (auto it = out.begin(); it != out.end(); ++it) it.value() = undefinedOf(it.value());
    return out;
}

// Task 30b: the session's storage in a sequence: the stored texts by name. A step can make every write fail ("false": write returns false, "throw": it throws) and,
// for a new session, every read ("none": nothing, "throw"). Every write is logged as the reference logs the web's setItem: [name, text, took].
struct SequenceStorage : btg::Storage {
    std::map<std::string, std::string> files;
    std::string failWrites, failReads;
    std::string failName; // the checks of Review Focus 3: only the writes of this name fail
    json log = json::array();
    std::optional<std::string> read(const std::string& name) override {
        if (failReads == "throw") throw std::runtime_error("the storage cannot be read");
        if (!failReads.empty()) return std::nullopt;
        const auto it = files.find(name);
        return it == files.end() ? std::nullopt : std::optional<std::string>(it->second);
    }
    bool write(const std::string& name, const std::string& text) override {
        log.push_back(json::array({ name, text, failWrites.empty() && name != failName }));
        if (failWrites == "throw") throw std::runtime_error("the storage is full");
        if (!failWrites.empty() || name == failName) return false;
        files[name] = text;
        return true;
    }
};
// FNV-1a, 64 bits, of the text's bytes, in hexadecimal (export-logic.mjs `fnv`)
std::string fnv(const std::string& text) {
    std::uint64_t h = 0xcbf29ce484222325ULL;
    for (const char c : text) { h ^= static_cast<unsigned char>(c); h *= 0x100000001b3ULL; }
    static const char* HEX = "0123456789abcdef";
    std::string out;
    for (int shift = 60; shift >= 0; shift -= 4) out += HEX[(h >> shift) & 0xF];
    return out;
}
json changeOf(const btg::Session::Change& c) {
    return { { "events", c.events }, { "sound", c.sound }, { "voices", c.voices }, { "tempo", c.tempo }, { "mix", c.mix }, { "restart", c.restart }, { "inPlace", c.inPlace },
             { "profiles", c.profiles } };
}
// the order of an object's keys at every level, as export-logic.mjs `keyOrder` writes it: {"key":<order of its value>,...}, [<order of each entry>], nothing for a value
std::string keyOrder(const Json& v) {
    std::string out;
    if (v.is_array()) {
        out += '[';
        for (size_t i = 0; i < v.size(); ++i) out += (i ? "," : "") + keyOrder(v[i]);
        return out + ']';
    }
    if (!v.is_object()) return out;
    out += '{';
    for (auto it = v.begin(); it != v.end(); ++it) out += (it == v.begin() ? "" : ",") + stringify(Json(it.key())) + ":" + keyOrder(it.value());
    return out + '}';
}
// Task 31, fix round 2: Session::replaceKey (session.h). On the states of the sequences (every REPLACE_EVERY-th step), for candidate actions of many
// kinds (those with a key, and those that must have none: what does nothing on the value shown, what writes, counts, rolls, toggles or marks a value as
// set by hand), with three values each (two others and the one the state shows): whenever an older and a newer one have the same non-empty key, the
// older, then the newer gives on one copy of the session exactly what the newer alone gives on another: state(), track(), sound(), tuning(), profiles(),
// the newer's flags, every stored text. A key on an action for which that fails, fails here. Only directly one after the other: with an action of
// another key between, leaving out the older changes the order of the timbre's groups and fields in the track (a check of that, run once, failed
// 1,033 of 14,994 times on exactly that), so the shell drops only an action whose newer one comes directly behind it.
constexpr size_t REPLACE_EVERY = 4;
long long replaceChecks = 0, replaceWrong = 0;
std::set<std::string> replaceMet; // the keys the check met
std::string actionText(const char* name, json fields) { fields["action"] = name; return fields.dump(); }
struct Candidate { std::function<std::string(const json&)> make; std::vector<json> values; }; // values: two others, then the one the state shows
std::vector<Candidate> replaceCandidates(const json& s, size_t k) {
    const json& t = s.at("track");
    const auto percent = [](const json& v, int otherwise) { return v.is_number() ? json(std::lround(v.get<double>() * 100)) : json(otherwise); };
    const auto at = [](const json& o, const std::string& key) { return o.is_object() && o.contains(key) ? o.at(key) : json(); };
    static const std::vector<std::string> channels { "drums", "bass", "chords", "pad", "lead", "percussion", "master" };
    static const std::vector<std::string> layers { "drums", "bass", "chords", "pad", "lead", "percussion" };
    static const std::vector<std::string> knobs { "complexity", "loose", "ornaments" }, feels { "structure", "dynamics", "pauses", "randomness" };
    static const std::vector<std::string> paths = [] { std::vector<std::string> out; Timbre timbre; forEachField(timbre, [&](const char* g, const char* f, double&) { out.push_back(std::string(g) + "." + f); }); return out; }();
    const std::string ch = channels[k % channels.size()], layer = layers[k % layers.size()], knob = knobs[k % knobs.size()], feel = feels[k % feels.size()];
    const auto timbreAt = [&](size_t i) {
        const std::string path = paths[i % paths.size()], group = path.substr(0, path.find('.')), name = path.substr(path.find('.') + 1);
        return Candidate { [group, name](const json& v) { return actionText("setTimbre", { { "group", group }, { "field", name }, { "value", v } }); },
                           { 13, 87, percent(at(at(at(t, "timbre"), group), name), 50) } };
    };
    const json& sections = at(at(t, "form"), "sections");
    const json part = sections.is_array() && s.at("selectedPart").get<size_t>() < sections.size() ? sections.at(s.at("selectedPart").get<size_t>()) : json::object();
    const auto edit = [](const char* name) { return [name](const json& v) { return actionText("editPart", { { "field", name }, { "value", v } }); }; };
    const json meter = t.at("meter");
    const std::string meterKey = std::to_string(meter.at(0).get<int>()) + "/" + std::to_string(meter.at(1).get<int>());
    return {
        { [ch](const json& v) { return actionText("setLevel", { { "channel", ch }, { "value", v } }); }, { 13, 87, percent(at(s.at("mix"), ch), 100) } },
        { [layer](const json& v) { return actionText("setPan", { { "layer", layer }, { "value", v } }); }, { -40, 60, percent(at(s.at("pan"), layer), 0) } },
        { [](const json& v) { return actionText("setTempo", { { "bpm", v }, { "from", "play" } }); }, { 77, 143, t.at("bpm") } },
        { [](const json& v) { return actionText("setTempo", { { "bpm", v }, { "from", "start" } }); }, { 77, 143, t.at("bpm") } },
        timbreAt(k), timbreAt(k + 11),
        { [knob](const json& v) { return actionText("setRhythmKnob", { { "knob", knob }, { "value", v } }); }, { 13, 87, percent(at(t, knob), 50) } },
        { [feel](const json& v) { return actionText("setFormFeel", { { "knob", feel }, { "value", v } }); }, { 13, 87, percent(at(s.at("formFeel"), feel), 50) } },
        { [](const json& v) { return actionText("setOrganDrive", { { "value", v } }); }, { 13, 87, at(s.at("organ"), "drive").is_number() ? percent(s.at("organ").at("drive"), 0) : json() } },
        { [](const json& v) { return actionText("setLeslie", { { "mode", v } }); }, { "off", "fast", at(s.at("organ"), "leslie") } },
        { edit("level"), { -3, -18, at(part, "level").is_number() ? at(part, "level") : json(-6) } },
        { edit("density"), { -40, 60, at(part, "density").is_number() ? percent(part.at("density"), 0) : json(0) } },
        { edit("transition"), { "fill", "stop", at(part, "transition").is_string() ? at(part, "transition") : json("none") } },
        { edit("type"), { "chorus", "bridge", at(part, "type") } },
        { edit("bars"), { 4, 12, at(part, "bars") } },
        { edit("crash"), { true, false, at(part, "crash").is_boolean() ? at(part, "crash") : json(false) } },
        { edit("level"), { json(), -9, json() } },
        { [](const json& v) { return actionText("setGroove", { { "groove", v } }); }, { "straight", "latin", at(t, "groove") } },
        { [](const json& v) { return actionText("setJob", { { "layer", "lead" }, { "job", v } }); }, { "melody", "riff", at(at(t, "jobs"), "lead") } },
        { [](const json& v) { return actionText("selectPart", { { "index", v } }); }, { 0, 1, s.at("selectedPart") } },
        { [](const json& v) { return actionText("setMeter", { { "meter", v } }); }, { "3/4", "6/8", meterKey } },
        { [](const json& v) { return actionText("newVariant", { { "variant", v } }); }, { 11, 22, t.at("seed") } },
        { [](const json& v) { return actionText("enterVariant", { { "variant", v } }); }, { 11, 22, t.at("seed") } },
        { [](const json& v) { return actionText("setChordColor", { { "color", v } }); }, { "sevenths", "power", s.at("chordColor") } },
        { [layer](const json&) { return actionText("toggleMute", { { "layer", layer } }); }, { 0, 0, 0 } },
        { [](const json&) { return actionText("toggleLock", json::object()); }, { 0, 0, 0 } },
        { [](const json&) { return actionText("rerollForm", json::object()); }, { 0, 0, 0 } },
        { [](const json&) { return actionText("addPart", json::object()); }, { 0, 0, 0 } },
        { [](const json&) { return actionText("toggleAllVoices", json::object()); }, { 0, 0, 0 } },
        { [chord = t.at("bars").at(0).at("chord")](const json&) { return actionText("addChord", { { "root", chord.at("root") }, { "quality", chord.at("quality") } }); }, { 0, 0, 0 } },
    };
}
// `one` and `other`, each played on its own copy of `at` (with a copy of its stored texts): the same state, track, sound, tuning, profile view, flags
// of their last action and stored texts?
bool sameWays(const btg::Session& at, const SequenceStorage& stored, const std::vector<std::string>& one, const std::vector<std::string>& other) {
    SequenceStorage a = stored, b = stored;
    for (SequenceStorage* x : { &a, &b }) { x->failWrites.clear(); x->failReads.clear(); x->failName.clear(); }
    btg::Session first(at, a), second(at, b);
    btg::Session::Change ca, cb;
    for (const std::string& text : one) ca = first.apply(text);
    for (const std::string& text : other) cb = second.apply(text);
    return first.state() == second.state() && first.track() == second.track() && first.sound() == second.sound() && first.tuning() == second.tuning()
        && first.profiles() == second.profiles() && changeOf(ca) == changeOf(cb) && a.files == b.files;
}
void checkReplace(const btg::Session& session, const SequenceStorage& storage, size_t k) {
    const json s = json::parse(session.state());
    // which two of the three values this state pairs, in turn from state to state: another and another, another and the one shown, the one shown and
    // another, the same twice, another and the one shown
    static const std::pair<size_t, size_t> PAIRS[] = { { 0, 1 }, { 0, 2 }, { 2, 0 }, { 0, 0 }, { 1, 2 } };
    const auto [i, j] = PAIRS[(k / REPLACE_EVERY) % 5];
    for (const Candidate& c : replaceCandidates(s, k)) {
        const std::string older = c.make(c.values[i]), newer = c.make(c.values[j]);
        const std::string key = btg::Session::replaceKey(older);
        if (key.empty() || key != btg::Session::replaceKey(newer)) continue;
        replaceMet.insert(key);
        ++replaceChecks;
        if (!sameWays(session, storage, { older, newer }, { newer }) && ++replaceWrong <= 12)
            std::printf("FAIL: replaceKey %s: %s then %s does not give what %s alone gives (step %zu)\n", key.c_str(), older.c_str(), newer.c_str(), newer.c_str(), k);
    }
}

// Task 32a, fix round 1: the members of the text of a JSON object, in the text's order, each its key and the text of its value as it stands there (not read and written
// again: so the comparison sees how numbers are written and the order of keys). For the session's texts: no white space between tokens, keys without escapes.
std::vector<std::pair<std::string, std::string>> membersOf(const std::string& text) {
    std::vector<std::pair<std::string, std::string>> out;
    size_t i = 1; // after '{'
    while (i < text.size() && text[i] == '"') {
        const size_t keyEnd = text.find('"', i + 1);
        std::string key = text.substr(i + 1, keyEnd - i - 1);
        const size_t start = keyEnd + 2; // after ':'
        size_t j = start;
        int depth = 0;
        bool inString = false;
        for (; j < text.size(); ++j) {
            const char c = text[j];
            if (inString) { if (c == '\\') ++j; else if (c == '"') inString = false; continue; }
            if (c == '"') inString = true;
            else if (c == '{' || c == '[') ++depth;
            else if ((c == '}' || c == ']') && depth-- == 0) break;
            else if (c == ',' && depth == 0) break;
        }
        out.emplace_back(std::move(key), text.substr(start, j - start));
        i = j + 1;
    }
    return out;
}
// where two texts first differ, with the text around it on both sides
std::string firstDifference(const std::string& want, const std::string& got) {
    size_t at = 0;
    while (at < want.size() && at < got.size() && want[at] == got[at]) ++at;
    const size_t from = at < 60 ? 0 : at - 60;
    return "at byte " + std::to_string(at) + ": want ..." + want.substr(from, 140) + "..., got ..." + (from < got.size() ? got.substr(from, 140) : std::string()) + "...";
}

// Task 32a: the stored texts of the sequences' new sessions (`stored` of a restart step, by name), for the check of importLegacy; and the state whose derived() is the
// longest text, kept (with a storage of its own) to time derived() on it
std::vector<std::map<std::string, std::string>> storedGroups;
SequenceStorage largestStorage;
std::unique_ptr<btg::Session> largest;
size_t largestBytes = 0;

// A case is { steps, at } (export-logic.mjs, Task 29 and 30b, the fix wave of Phase 6; a plain list is the steps without places): a step is an action text; { action, fail?,
// failReads? }, the action with writes that fail or reads that throw; { restart, stored?, failReads? }, a new session on the same storage after `stored` replaced texts (null
// removes one); { probe: [key, name] }, exportFile only. `at` per step the places of the playback to ask position for. `out` per step { change, state, track, sound, tuning,
// keys, position }: `keys` the order of the keys of track() and state().track (read in the order of their texts), `position` per place the fnv of position's text;
// `profiles` when its text differs from the step before, `writes` if the step wrote, `derived` the fields of derived() whose text differs from the step before (Task 32a:
// a list of [field, text] in the text's order, each text as derived() wrote it), and the export of the selected row with the name "Export" when it differs from the step
// before: `export`, for the session `exportHash`.
json playSession(const json& in) {
    const json& steps = in.is_array() ? in : in.at("steps");
    SequenceStorage storage;
    auto session = std::make_unique<btg::Session>(storage);
    json out = json::array();
    std::optional<std::string> shown;
    std::string viewText; // profiles() as text: recorded when it is another than the step before had (a tree of 1,000 nodes is 170 KB)
    json view;
    std::map<std::string, std::string> shownDerived; // per field of derived() its text at the step before
    for (size_t k = 0; k < steps.size(); ++k) {
        const json& step = steps[k];
        storage.log = json::array();
        btg::Session::Change c;
        if (step.is_string()) c = session->apply(step.get<std::string>());
        else if (step.contains("probe")) { out.push_back({ { "probe", session->exportFile(step.at("probe").at(0).get<std::string>(), step.at("probe").at(1).get<std::string>()) } }); continue; }
        else if (step.contains("restart")) {
            if (step.contains("stored")) {
                std::map<std::string, std::string> group;
                for (const auto& [name, text] : step.at("stored").items()) {
                    if (text.is_null()) storage.files.erase(name); else storage.files[name] = group[name] = text.get<std::string>();
                }
                if (!group.empty()) storedGroups.push_back(std::move(group));
            }
            storage.failReads = step.contains("failReads") ? step.at("failReads").get<std::string>() : "";
            session = std::make_unique<btg::Session>(storage);
            storage.failReads.clear();
        } else {
            storage.failWrites = step.value("fail", std::string());
            storage.failReads = step.value("failReads", std::string());
            c = session->apply(step.at("action").get<std::string>());
            storage.failWrites.clear();
            storage.failReads.clear();
        }
        const std::string stateText = session->state(), trackText = session->track();
        json record = { { "change", changeOf(c) }, { "state", json::parse(stateText) }, { "track", json::parse(trackText) },
                        { "sound", json::parse(session->sound()) }, { "tuning", json::parse(session->tuning()) },
                        { "keys", { { "track", keyOrder(Json::parse(trackText)) }, { "state", keyOrder(Json::parse(stateText).at("track")) } } } };
        if (std::string now = session->profiles(); now != viewText || view.is_null()) {
            view = json::parse(now);
            viewText = std::move(now);
            record["profiles"] = view;
        }
        json places = json::array();
        if (!in.is_array()) for (const json& beats : in.at("at").at(k)) places.push_back(fnv(session->position(beats.get<double>())));
        record["position"] = places;
        if (!storage.log.empty()) record["writes"] = storage.log;
        const std::string derivedText = session->derived();
        json changed = json::array();
        for (auto& [field, text] : membersOf(derivedText)) {
            if (shownDerived[field] == text) continue;
            shownDerived[field] = text;
            changed.push_back(json::array({ field, std::move(text) }));
        }
        if (!changed.empty()) record["derived"] = changed;
        if (derivedText.size() > largestBytes) {
            largestBytes = derivedText.size();
            largestStorage = storage;
            largest = std::make_unique<btg::Session>(*session, largestStorage);
        }
        const std::string selection = view.value("selection", std::string("session"));
        const std::string file = session->exportFile(selection, "Export");
        if (!shown || *shown != file) {
            shown = file;
            if (selection == "session") record["exportHash"] = fnv(file); else record["export"] = file;
        }
        out.push_back(std::move(record));
        if (k % REPLACE_EVERY == 0) checkReplace(*session, storage, k);
    }
    return out;
}
// Task 32a: derived() after each step of a sequence, compared by itself (a summary line of its own) and then taken out of both records. Fix round 1: by text, field by
// field (the list of the fields that changed, in the text's order: at the first step all of them, so the order of the fields counts too), byte for byte
long long derivedChecks = 0, derivedWrong = 0;
double displaysMs = 0, displaysLongest = 0; // Task 32c: the time chordDisplays took over the cases, and its longest call
json withoutDerived(const json& c, json& got) {
    json want = c.at("out");
    const json& steps = c.at("in").is_array() ? c.at("in") : c.at("in").at("steps");
    for (size_t k = 0; k < want.size() && k < got.size(); ++k) {
        if (want[k].contains("probe")) continue;
        ++derivedChecks;
        const json wanted = want[k].value("derived", json::array()), given = got[k].value("derived", json::array());
        std::string difference; // the first field whose name or text differs, and where
        for (size_t f = 0; f < std::max(wanted.size(), given.size()) && difference.empty(); ++f) {
            if (f >= wanted.size() || f >= given.size()) difference = "field " + (f < wanted.size() ? wanted[f] : given[f]).at(0).get<std::string>() + " only on one side";
            else if (wanted[f].at(0) != given[f].at(0)) difference = "field " + wanted[f].at(0).get<std::string>() + " where it has " + given[f].at(0).get<std::string>();
            else if (wanted[f].at(1) != given[f].at(1))
                difference = "field " + wanted[f].at(0).get<std::string>() + " " + firstDifference(wanted[f].at(1).get<std::string>(), given[f].at(1).get<std::string>());
        }
        if (!difference.empty() && ++derivedWrong <= 10) {
            const std::string text = steps[k].is_string() ? steps[k].get<std::string>() : steps[k].dump();
            std::printf("derived: different at step %zu (%.200s), %s\n", k, text.c_str(), difference.c_str());
        }
        want[k].erase("derived");
        got[k].erase("derived");
    }
    return want;
}

// where a sequence first differs: the step, its action and the field (`want`: the case's records without derived)
void printSessionStep(const json& c, const json& want, const json& got) {
    for (size_t k = 0; k < want.size() && k < got.size(); ++k) {
        btg::test::Compare step;
        step.value("record", want[k], got[k]);
        if (step.result == btg::test::Match::identical) continue;
        const json& in = (c.at("in").is_array() ? c.at("in") : c.at("in").at("steps"))[k];
        const std::string text = in.is_string() ? in.get<std::string>() : in.dump();
        std::printf("session: first difference at step %zu (%.300s), field %s\n", k, text.c_str(), step.field.c_str());
        return;
    }
}

// Task 30a: the profiles (profiles.h). A case carries the stored texts (name -> text) and whether a write fails; the output holds the texts afterwards. A text that
// the function writes must be byte for byte the web's JSON.stringify, so the arguments of such a function come as a text (`args`): a json value here has sorted keys.
struct MapStorage : btg::Storage {
    std::map<std::string, std::string> files;
    bool failWrites = false;
    std::optional<std::string> read(const std::string& name) override { const auto it = files.find(name); return it == files.end() ? std::nullopt : std::optional<std::string>(it->second); }
    bool write(const std::string& name, const std::string& text) override { if (failWrites) return false; files[name] = text; return true; }
};
MapStorage storageOf(const json& in) {
    MapStorage storage;
    if (in.contains("stored")) for (const auto& [name, text] : in.at("stored").items()) storage.files[name] = text.get<std::string>();
    storage.failWrites = in.contains("fail") && in.at("fail").get<bool>();
    return storage;
}
json storedOf(const MapStorage& storage) {
    json out = json::object();
    for (const auto& [name, text] : storage.files) out[name] = text;
    return out;
}
// the ids a case gives, in order (the web's makeId; for loadTree the cases stub crypto.randomUUID with the same list)
btg::detail::MakeId idsOf(const Json& in) {
    const auto list = std::make_shared<std::vector<std::string>>();
    const auto found = in.find("ids");
    if (found != in.end()) for (const Json& id : *found) list->push_back(id.get<std::string>());
    const auto next = std::make_shared<size_t>(0);
    return [list, next]() -> std::string {
        if (*next >= list->size()) throw std::invalid_argument("the case gives no more ids");
        return (*list)[(*next)++];
    };
}
// a lone surrogate (which a cut of a name inside an astral character leaves, kept as WTF-8) cannot be in the reference's JSON: both sides write it as the text \udXXX
Json wtfSafe(Json v) {
    if (v.is_string()) {
        const std::string& text = v.get_ref<const std::string&>();
        if (text.find('\xED') == std::string::npos) return v;
        std::string out;
        for (const char32_t cp : btg::detail::codePoints(text)) {
            if (cp < 0xD800 || cp >= 0xE000) { btg::detail::appendCodePoint(out, cp); continue; }
            static const char* HEX = "0123456789abcdef";
            out += "\\u";
            for (int shift = 12; shift >= 0; shift -= 4) out += HEX[(cp >> shift) & 0xF];
        }
        return out;
    }
    if (v.is_array() || v.is_object()) for (auto it = v.begin(); it != v.end(); ++it) it.value() = wtfSafe(it.value());
    return v;
}
json profileOut(const Json& v) { return plain(wtfSafe(v)); }
json storedAnd(const char* name, const Json& value, const MapStorage& storage) { return json { { name, profileOut(value) }, { "stored", storedOf(storage) } }; }

const std::map<std::string, std::function<json(const json&)>> FUNCTIONS {
    { "completeTimbre", [](const json& in) { return toJson(completeTimbre(in.dump())); } },
    { "masterParams", [](const json& in) { return toJson(masterParams(group("master", in).master)); } },
    { "drumParams", [](const json& in) { return toJson(drumParams(group("drums", in).drums)); } },
    { "bassParams", [](const json& in) { return toJson(bassParams(group("bass", in).bass)); } },
    { "chordParams", [](const json& in) { return toJson(chordParams(group("chords", in).chords)); } },
    { "padParams", [](const json& in) { return toJson(padParams(group("pad", in).pad)); } },
    { "fxChainParams", [](const json& in) { const json& t = in.at("timbre");
        return toJson(fxChainParams(number(t, "fuzz"), number(t, "overdrive"), number(t, "distortion"), layerOf(in.at("layer").get<std::string>()))); } },
    { "modParams", [](const json& in) { const json& t = in.at("timbre"); return toJson(modParams(number(t, "vibrato"), number(t, "chorus"), number(in, "bpm"))); } },
    { "MOD", [](const json&) { return json { { "vibCents", MOD.vibCents }, { "vibBase", MOD.vibBase }, { "chorusBase", MOD.chorusBase },
        { "chorusDepth", MOD.chorusDepth }, { "chorusHz", json::array({ MOD.chorusHz[0], MOD.chorusHz[1] }) }, { "chorusPan", MOD.chorusPan }, { "chorusLevel", MOD.chorusLevel } }; } },
    { "brightnessHz", [](const json& in) { return json(brightnessHz(in.is_number() ? in.get<double>() : NAN)); } },
    { "LAYER_FX", [](const json& in) { return toJson(layerFx(layerOf(in.get<std::string>()))); } },
    // an error is an output like any other: { "threw": true } when fxChainParams throws std::invalid_argument (the web: a TypeError)
    { "fxChainThrows", [](const json& in) {
        try { fxChainParams(0.5, 0, 0, layerOf(in.get<std::string>())); return json { { "threw", false } }; }
        catch (const std::invalid_argument&) { return json { { "threw", true } }; } } },
    // the 47 fields in the order and with the defaults of DEFAULT_TIMBRE
    { "timbreFields", [](const json&) {
        Timbre t;
        json names = json::array(), defaults = json::array();
        forEachField(t, [&](const char* group, const char* field, double& value) { names.push_back(std::string(group) + "." + field); defaults.push_back(value); });
        return json { { "names", names }, { "defaults", defaults } }; } },
    { "noiseBuffer", [](const json& in) {
        const auto buffer = noiseBuffer(Rng(1).fork(in.at("label").get<std::string>()), in.at("seconds").get<double>(), in.at("channels").get<int>(),
                                        in.at("decay").get<double>(), in.at("sampleRate").get<double>());
        json sums = json::array(), at = json::object();
        for (const auto& c : buffer) { double s = 0; for (const float x : c) s += static_cast<double>(x) * x; sums.push_back(s); }
        const size_t length = buffer[0].size();
        for (const size_t i : { size_t { 0 }, size_t { 1 }, size_t { 2 }, size_t { 1000 }, length - 1 }) {
            json v = json::array();
            for (const auto& c : buffer) v.push_back(c[i]);
            at[std::to_string(i)] = v;
        }
        return json { { "length", length }, { "sumSquares", sums }, { "at", at } };
    } },
    { "ownsChorus", [](const json& in) {
        const std::string layer = in.at("layer").get<std::string>();
        return json(ownsChorus(layer, layer + "/" + in.at("id").get<std::string>() + "/" + in.at("variant").get<std::string>())); } },
    // the summary of export-logic.mjs: length, the sum of squares (in double, as the web sums the float32 samples), the samples at `at`
    { "renderString", [](const json& in) {
        const json& p = in.at("params");
        const StringParams params { number(p, "pluckPos"), number(p, "brightness"), number(p, "decay"), number(p, "excite"), number(p, "stiffness"),
                                    number(p, "pickupPos"), number(p, "pickupLp"), number(p, "body") };
        const std::vector<float> out = renderString(number(in, "midi"), number(in, "seconds"), number(in, "dur"), number(in, "vel"), number(in, "sampleRate"),
                                                    in.at("seed").get<uint32_t>(), params);
        double sumSquares = 0;
        for (const float x : out) sumSquares += static_cast<double>(x) * x;
        json at = json::object();
        for (const json& i : in.at("at")) at[std::to_string(i.get<size_t>())] = out[i.get<size_t>()];
        return json { { "length", out.size() }, { "sumSquares", sumSquares }, { "at", at } };
    } },
    { "normalizeTrack", [](const json& in) { return parsed(btg::normalizeTrack(in.get<std::string>())); } },
    { "validateTrack", [](const json& in) { return parsed(btg::validateTrack(in.get<std::string>())); } },
    { "completeVoices", [](const json& in) { return plain(completeVoices(ordered(in))); } },
    { "completeJobs", [](const json& in) { return plain(completeJobs(ordered(in))); } },
    { "checkForm", [](const json& in) {
        json found = json::array();
        checkForm(ordered(in), [&](const char* code, Json params) { found.push_back(json { { "code", code }, { "params", plain(params) } }); });
        return found; } },
    { "normalizeForm", [](const json& in) {
        const Json form = normalizeForm(ordered(in));
        return form.is_discarded() ? json { { "undefined", true } } : json { { "value", plain(form) } }; } },
    { "allowedChords", [](const json& in) { return thrown([&] { return allowedChords(ordered(in)); }); } },
    { "chordOptions", [](const json& in) { return thrown([&] { return chordOptions(ordered(in)); }); } },
    { "chordName", [](const json& in) { return thrown([&] { return chordName(ordered(in)); }); } },
    // Task 26: harmony. An argument the case leaves out is null; where the web throws the output is { threw: true }.
    { "progressionFor", [](const json& in) { const Json o = ordered(in); return thrown([&] { return progressionFor(argument(o, "key"), argument(o, "seed")); }); } },
    { "colorChord", [](const json& in) { const Json o = ordered(in); return thrown([&] { return colorChord(argument(o, "chord"), argument(o, "color"), argument(o, "key")); }); } },
    { "colorProgression", [](const json& in) { const Json o = ordered(in); return thrown([&] { return colorProgression(argument(o, "bars"), argument(o, "color"), argument(o, "key")); }); } },
    { "styleChordColor", [](const json& in) { const Json o = ordered(in); return thrown([&] { return Json(styleChordColor(argument(o, "style"), argument(o, "seed"), argument(o, "variety") == true)); }); } },
    { "chordTimeline", [](const json& in) { return thrown([&] { return chordTimeline(ordered(in)); }); } },
    { "fretboardNotes", [](const json& in) { return thrown([&] { return fretboardNotes(ordered(in)); }); } },
    { "nextDistinctChord", [](const json& in) { const Json o = ordered(in);
        return thrown([&] { return nextDistinctChord(argument(o, "bars"), argument(o, "length"), argument(o, "barIndex"), argument(o, "form")); }); } },
    { "progressionRoles", [](const json& in) { const Json o = ordered(in); return thrown([&] { return progressionRoles(argument(o, "track"), argument(o, "bar")); }); } },
    { "romanDegree", [](const json& in) { const Json o = ordered(in); return thrown([&] { return Json(romanDegree(argument(o, "key"), argument(o, "chord"))); }); } },
    { "beatsUntilChange", [](const json& in) { const Json o = ordered(in); return thrown([&] { return beatsUntilChange(argument(o, "track"), o.at("songSec").get<double>()); }); } },
    { "degreeLabel", [](const json& in) { const Json o = ordered(in); return thrown([&] { return Json(degreeLabel(argument(o, "key"), o.at("pc").get<double>())); }); } },
    // Task 27: rolling and editing a song form. A field a case leaves out is null; where the web throws the output is { threw: true }.
    { "resolveTemplate", [](const json& in) { const Json o = ordered(in); return thrown([&] { return resolveTemplate(argument(o, "template"), argument(o, "style"), argument(o, "tags")); }); } },
    { "rollForm", [](const json& in) { const Json o = ordered(in); return thrown([&] { return rollForm(o); }); } },
    { "limits", [](const json& in) { const Json o = ordered(in); return thrown([&] { return limits(argument(o, "form"), argument(o, "index")); }); } },
    { "editPart", [](const json& in) { const Json o = ordered(in); return thrown([&] { return editPart(argument(o, "form"), argument(o, "index"), patchOf(argument(o, "patch"))); }); } },
    { "setLocked", [](const json& in) { const Json o = ordered(in); return thrown([&] { return setLocked(argument(o, "form"), argument(o, "index"), undefinedOf(o.at("locked"))); }); } },
    { "addPart", [](const json& in) { const Json o = ordered(in); return thrown([&] { return addPart(argument(o, "form")); }); } },
    { "copyPart", [](const json& in) { const Json o = ordered(in); return thrown([&] { return copyPart(argument(o, "form"), argument(o, "index")); }); } },
    { "deletePart", [](const json& in) { const Json o = ordered(in); return thrown([&] { return deletePart(argument(o, "form"), argument(o, "index")); }); } },
    { "movePart", [](const json& in) { const Json o = ordered(in); return thrown([&] { return movePart(argument(o, "form"), argument(o, "index"), argument(o, "dir")); }); } },
    // Task 28: the sound model's logic. resolveTimbre and resolveTrackTimbre sum in the order the tags are named, so their `in` is the TEXT of the tags or of the track (a json
    // value here is sorted by key); where the web throws (an unknown tag) the output is { threw: true }. The other functions take an object { field: value }, a field left out is null.
    { "resolveTimbre", [](const json& in) { return thrown([&] { return resolveTimbre(Json::parse(in.get<std::string>())); }); } },
    { "resolveTrackTimbre", [](const json& in) { return thrown([&] { return resolveTrackTimbre(Json::parse(in.get<std::string>())); }); } },
    { "usesTimbreField", [](const json& in) { const Json o = ordered(in); return json(usesTimbreField(argument(o, "voices"), argument(o, "path"))); } },
    { "isSoundOnlyChange", [](const json& in) { const Json o = ordered(in); return json(isSoundOnlyChange(argument(o, "prev"), argument(o, "next"))); } },
    { "tagEffect", [](const json& in) { const Json o = ordered(in); return plain(tagEffect(argument(o, "tag"), argument(o, "track"))); } },
    { "organTuning", [](const json& in) { return plain(organTuning(ordered(in))); } },
    { "presetDrive", [](const json& in) { return json(presetDrive(ordered(in))); } },
    // Task 29: the session, one case per sequence of actions (playSession above)
    { "session", playSession },
    // Task 30a: the profiles. An argument a case leaves out is null; the ids a tree function asks for are `ids`; a function that writes is given its arguments as the text `args`.
    { "PART_IDS", [](const json&) { return profileOut(PART_IDS()); } },
    { "PART_PRESETS", [](const json&) { return profileOut(PART_PRESETS()); } },
    { "LIMITS", [](const json&) { return profileOut(LIMITS()); } },
    { "FORMATS", [](const json&) { return profileOut(FORMATS()); } },
    { "captureParts", [](const json& in) { const Json o = ordered(in); return profileOut(captureParts(o.at("session"), argument(o, "ids"))); } },
    { "sanitizeParts", [](const json& in) { return profileOut(sanitizeParts(ordered(in))); } },
    { "applyParts", [](const json& in) { const Json o = ordered(in); return profileOut(applyParts(o.at("session"), argument(o, "parts"))); } },
    { "partIdsOf", [](const json& in) { return profileOut(partIdsOf(ordered(in))); } },
    { "mergeParts", [](const json& in) { const Json o = ordered(in); return profileOut(mergeParts(argument(o, "base"), argument(o, "over"))); } },
    { "makeProfileFile", [](const json& in) { return profileOut(makeProfileFile(ordered(in))); } },
    { "makeFolderFile", [](const json& in) { return profileOut(makeFolderFile(ordered(in))); } },
    { "parseFile", [](const json& in) { return profileOut(parseFile(ordered(in))); } },
    { "factoryProfiles", [](const json&) { return profileOut(factoryProfiles()); } },
    { "factoryParts", [](const json& in) { return thrown([&] { return factoryParts(in.get<std::string>()); }); } },
    { "readSession", [](const json& in) { return profileOut(readSession(ordered(in))); } },
    { "writeSession", [](const json& in) { Json a = Json::parse(in.at("args").get<std::string>()); Json state = a.at("state"); writeSession(state, a.at("session")); return profileOut(state); } },
    { "saveLast", [](const json& in) { MapStorage s = storageOf(in); const Json a = Json::parse(in.at("args").get<std::string>());
        const Json entry = saveLast(s, a.at("session"), a.at("bar"), a.at("at")); return storedAnd("entry", entry, s); } },
    { "loadLast", [](const json& in) { MapStorage s = storageOf(in); const Json entry = loadLast(s); return storedAnd("entry", entry, s); } },
    { "compareNames", [](const json& in) { return json(compareNames(in.at("a").get<std::string>(), in.at("b").get<std::string>())); } },
    { "lowerCase", [](const json& in) { return json(lowerCase(in.get<std::string>())); } },
    { "newTree", [](const json&) { return profileOut(newTree()); } },
    { "sortItems", [](const json& in) { return profileOut(sortItems(ordered(in))); } },
    { "find", [](const json& in) { const Json o = ordered(in); return profileOut(find(o.at("tree"), argument(o, "id"))); } },
    { "pathNames", [](const json& in) { const Json o = ordered(in); return profileOut(pathNames(o.at("tree"), argument(o, "id"))); } },
    { "countProfiles", [](const json& in) { return json(countProfiles(ordered(in))); } },
    { "countNodes", [](const json& in) { return json(countNodes(ordered(in))); } },
    { "listFolders", [](const json& in) { return profileOut(listFolders(ordered(in))); } },
    { "validName", [](const json& in) { const Json o = ordered(in); return profileOut(validName(o.at("tree"), argument(o, "parentId"), argument(o, "name"), argument(o, "exceptId"))); } },
    { "freeName", [](const json& in) { return json(freeName(in.at("names").get<std::vector<std::string>>(), in.at("name").get<std::string>())); } },
    { "addFolder", [](const json& in) { const Json o = ordered(in); return profileOut(addFolder(o.at("tree"), argument(o, "parentId"), argument(o, "name"), idsOf(o))); } },
    { "addProfile", [](const json& in) { const Json o = ordered(in); return profileOut(addProfile(o.at("tree"), argument(o, "parentId"), argument(o, "name"), argument(o, "parts"), idsOf(o))); } },
    { "renameNode", [](const json& in) { const Json o = ordered(in); return profileOut(renameNode(o.at("tree"), argument(o, "id"), argument(o, "name"))); } },
    { "removeNode", [](const json& in) { const Json o = ordered(in); return profileOut(removeNode(o.at("tree"), argument(o, "id"))); } },
    { "overwriteParts", [](const json& in) { const Json o = ordered(in); return profileOut(overwriteParts(o.at("tree"), argument(o, "id"), argument(o, "parts"))); } },
    { "canMove", [](const json& in) { const Json o = ordered(in); return json(canMove(o.at("tree"), argument(o, "id"), argument(o, "targetId"))); } },
    { "moveTargets", [](const json& in) { const Json o = ordered(in); return profileOut(moveTargets(o.at("tree"), argument(o, "id"))); } },
    { "moveNode", [](const json& in) { const Json o = ordered(in); return profileOut(moveNode(o.at("tree"), argument(o, "id"), argument(o, "targetId"))); } },
    { "importNode", [](const json& in) { const Json o = ordered(in); return profileOut(importNode(o.at("tree"), argument(o, "parentId"), argument(o, "node"), idsOf(o))); } },
    { "isReservedId", [](const json& in) { return json(isReservedId(in.get<std::string>())); } },
    { "loadTree", [](const json& in) { MapStorage s = storageOf(in); const Json tree = loadTree(s, idsOf(ordered(in))); return storedAnd("tree", tree, s); } },
    { "saveTree", [](const json& in) { MapStorage s = storageOf(in); const bool saved = saveTree(s, Json::parse(in.at("args").get<std::string>()).at("tree")); return json { { "saved", saved }, { "stored", storedOf(s) } }; } },
    // Task 31: what the shell sends the page for its lanes (generator.h). `in` is the track's text; laneKey byte for byte, the events as values.
    { "laneKey", [](const json& in) { return json(btg::laneKey(in.get<std::string>())); } },
    { "eventsJson", [](const json& in) { return parsed(btg::eventsJson(btg::buildEvents(in.get<std::string>()))); } },
    // fix round 1: the beat at which a bar begins; a bar outside the loop throws std::invalid_argument, the web's RangeError: { threw: true }
    { "barStart", [](const json& in) {
        try { return json(btg::barStart(in.at("text").get<std::string>(), in.at("bar").get<int>())); }
        catch (const std::invalid_argument&) { return json { { "threw", true } }; } } },
    // Task 32a: the constants the page lists and labels, against the JavaScript's; fix round 1: the text, byte for byte (the order of keys, how numbers are written)
    { "tables", [](const json&) { return json(btg::Session::tables()); } },
    // Task 32c: what the displays of the own songs' page show, the text byte for byte; `in` is the request's text. Each call is timed (the summary line `displays`)
    { "chordDisplays", [](const json& in) {
        const auto begin = std::chrono::steady_clock::now();
        std::string text = btg::chordDisplays(in.get<std::string>());
        const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - begin).count();
        displaysMs += ms;
        displaysLongest = std::max(displaysLongest, ms);
        return json(std::move(text)); } },
};

} // namespace

int main(int argc, char** argv) {
    if (argc < 2) { std::printf("usage: btg_logic_tests <logic.json>\n"); return 2; }
    std::ifstream file(argv[1], std::ios::binary);
    if (!file) { std::printf("cannot open %s: the manifest is missing, nothing was checked\n", argv[1]); return 1; }
    // logic.json is the manifest { total, chunks: [{ file, count }] }; the cases are in the chunk files next to it, read one at a time
    const json manifest = json::parse(file, nullptr, false);
    if (manifest.is_discarded()) { std::printf("%s is not valid JSON (cut off?): nothing was checked\n", argv[1]); return 1; }
    const auto count = [](const json& v) { return v.is_number_unsigned() ? v.get<size_t>() : static_cast<size_t>(-1); };
    bool wellFormed = manifest.is_object() && manifest.contains("total") && count(manifest.at("total")) != static_cast<size_t>(-1)
                      && manifest.contains("chunks") && manifest.at("chunks").is_array() && !manifest.at("chunks").empty();
    size_t listed = 0;
    if (wellFormed)
        for (const json& chunk : manifest.at("chunks")) {
            wellFormed = wellFormed && chunk.is_object() && chunk.contains("file") && chunk.at("file").is_string() && chunk.contains("count") && count(chunk.at("count")) != static_cast<size_t>(-1);
            if (wellFormed) listed += count(chunk.at("count"));
        }
    if (!wellFormed) { std::printf("%s is no manifest { total, chunks: [{ file, count }] }: nothing was checked\n", argv[1]); return 1; }
    std::set<std::string> named; // a chunk is a plain file name in the manifest's folder, and each is named once (a name twice would hide a chunk that is missing)
    for (const json& chunk : manifest.at("chunks")) {
        const std::string name = chunk.at("file").get<std::string>();
        const std::filesystem::path path(name);
        if (name.empty() || name == "." || name == ".." || path.filename() != path) { std::printf("%s names the chunk \"%s\": not a plain file name in its folder\n", argv[1], name.c_str()); return 1; }
        if (!named.insert(name).second) { std::printf("%s names the chunk %s twice\n", argv[1], name.c_str()); return 1; }
    }
    if (listed != count(manifest.at("total"))) { std::printf("%s lists %zu cases in its chunks, its total is %zu\n", argv[1], listed, count(manifest.at("total"))); return 1; }
    if (listed == 0) { std::printf("%s has no case: nothing was checked\n", argv[1]); return 1; } // a gate must not pass on nothing
    const std::filesystem::path directory = std::filesystem::path(argv[1]).parent_path();
    long long identical = 0, close = 0, different = 0, closeString = 0, displaysChecks = 0, displaysWrong = 0;
    std::map<std::string, int> seen; // cases per function in the file
    size_t read = 0;                 // cases read so far: the number of the next case
    for (const json& chunk : manifest.at("chunks")) {
        const std::string name = chunk.at("file").get<std::string>();
        std::ifstream chunkFile(directory / name, std::ios::binary);
        if (!chunkFile) { std::printf("chunk %s of %s is missing: the check is incomplete\n", name.c_str(), argv[1]); return 1; }
        const json cases = json::parse(chunkFile, nullptr, false);
        if (cases.is_discarded()) { std::printf("chunk %s is not valid JSON (cut off?): the check is incomplete\n", name.c_str()); return 1; }
        if (!cases.is_array() || cases.size() != count(chunk.at("count"))) {
            std::printf("chunk %s holds %zu cases, the manifest says %zu: the check is incomplete\n", name.c_str(), cases.is_array() ? cases.size() : size_t { 0 }, count(chunk.at("count")));
            return 1;
        }
        for (size_t n = 0; n < cases.size(); ++n) {
            const size_t i = read + n; // the number of the case in the whole reference
            try {
                const json& c = cases[n];
                ++seen[c.at("fn").get<std::string>()];
                const auto fn = FUNCTIONS.find(c.at("fn").get<std::string>());
                btg::test::Compare compare;
                json got, want;
                if (fn == FUNCTIONS.end()) compare.fail("fn");
                else if (c.at("fn") == "session") { got = fn->second(c.at("in")); want = withoutDerived(c, got); compare.value("out", want, got); }
                else { got = fn->second(c.at("in")); compare.value("out", c.at("out"), got); }
                if (c.at("fn") == "chordDisplays") { ++displaysChecks; if (compare.result != btg::test::Match::identical) ++displaysWrong; }
                if (compare.result == btg::test::Match::identical) { ++identical; continue; }
                if (compare.result == btg::test::Match::close && c.at("fn") == "renderString") { // the ruled exception (above): passes, counted
                    ++closeString;
                    std::printf("close (renderString, ruled): #%zu %s by %.3g\n", i, compare.field.c_str(), compare.delta);
                    continue;
                }
                if (compare.result == btg::test::Match::close) { ++close; std::printf("close: %s #%zu %s by %.3g\n", c.at("fn").get<std::string>().c_str(), i, compare.field.c_str(), compare.delta); continue; }
                if (different < 20 && c.at("fn") == "session") printSessionStep(c, want, got);
                if (different < 20 && (c.at("fn") == "tables" || c.at("fn") == "chordDisplays") && c.at("out").is_string() && got.is_string())
                    std::printf("%s: the text differs %s\n", c.at("fn").get<std::string>().c_str(), firstDifference(c.at("out").get<std::string>(), got.get<std::string>()).c_str());
                if (++different <= 20) std::printf("different: %s #%zu %s: in %s, want %s, got %s\n", c.at("fn").get<std::string>().c_str(), i, compare.field.c_str(),
                                                   c.at("in").dump().c_str(), c.at("out").dump().c_str(), got.dump().c_str());
            } catch (const std::exception& error) { // a case that is no case, or a function that throws what the web's does not
                if (++different <= 20) std::printf("different: #%zu threw: %s\n", i, error.what());
            }
        }
        read += cases.size();
    }
    // The reader of track.cpp takes 64 levels of nesting (MAX_DEPTH) and counts deeper text as `null`; the web's validateTrack answers on such text,
    // so no case of the file can hold it (the file has one at exactly 64): here the answer must be the one for `null`, and the program fails if not.
    int deepWrong = 0;
    const auto nestedText = [](int levels, bool arrays) { // a field of a track nested so that the text is `levels` deep (the track's object is the first)
        std::string open, close;
        for (int i = 1; i < levels; ++i) { open += arrays ? "[" : "{\"a\":"; close += arrays ? "]" : "}"; }
        return "{\"bpm\":100,\"extra\":" + open + "1" + close + "}";
    };
    for (const bool arrays : { true, false }) {
        const std::string text = nestedText(65, arrays);
        if (btg::validateTrack(text) != btg::validateTrack("null") || btg::normalizeTrack(text) != btg::normalizeTrack("null")) {
            std::printf("FAIL: a track nested 65 levels deep (%s) is not answered as `null`\n", arrays ? "arrays" : "objects");
            ++deepWrong;
        }
        if (btg::validateTrack(nestedText(64, arrays)) == btg::validateTrack("null")) { // the other side of the cap: 64 levels are read
            std::printf("FAIL: a track nested 64 levels deep (%s) is answered as `null`\n", arrays ? "arrays" : "objects");
            ++deepWrong;
        }
    }
    std::printf("depth: %d of 4 checks wrong\n", deepWrong);
    // Task 26 fix round 1: a seed that is no number throws in the core where the web's `seed >>> 0` takes 5, 1, 5 (the ruling: no coercions that no caller needs).
    // The two sides differ on purpose, so these are no cases of the file. styleChordColor reads the seed only for a style with an alternative colour, with variety.
    int seedWrong = 0;
    for (const Json& seed : { Json("5"), Json(true), Json::array({ 5 }), Json::object(), Json::array() }) {
        const auto throws = [](const std::function<void()>& call) { try { call(); } catch (const std::invalid_argument&) { return true; } return false; };
        const Json key = Json::object({ { "root", "A" }, { "mode", "minor" } });
        if (!throws([&] { progressionFor(key, seed); })) { std::printf("FAIL: progressionFor takes %s as a seed\n", seed.dump().c_str()); ++seedWrong; }
        if (!throws([&] { styleChordColor("blues", seed, true); })) { std::printf("FAIL: styleChordColor takes %s as a seed\n", seed.dump().c_str()); ++seedWrong; }
    }
    std::printf("seed: %d of 10 checks wrong\n", seedWrong);
    // Task 27: where the web coerces a value (a text as an index or as `bars`, a number joined to a text) or indexes what is no list, the core throws, so these are no cases of the file either.
    // (form_internal.h names each of them; the web: "1" is the second part, "8" + 8 is "88", Math.round("4") is 4, "abc"[0] is "a".)
    int formWrong = 0;
    {
        const Json one = Json::parse(R"({"sections":[{"type":"verse","bars":8}]})"), textBars = Json::parse(R"({"sections":[{"type":"verse","bars":"8"}]})"), textList = Json::parse(R"({"sections":"abc"})");
        const std::vector<std::pair<const char*, std::function<void()>>> mustThrow {
            { "limits: a text as index", [&] { limits(one, Json("0")); } }, { "limits: null as index", [&] { limits(one, Json()); } },
            { "limits: a text as bars", [&] { limits(textBars, Json(0)); } }, { "limits: a text as the list of parts", [&] { limits(textList, Json(0)); } },
            { "editPart: a text as patch", [&] { editPart(one, Json(0), Json("x")); } }, { "editPart: a text as bars", [&] { editPart(one, Json(0), Json::parse(R"({"bars":"4"})")); } },
            { "editPart: true as bars", [&] { editPart(one, Json(0), Json::parse(R"({"bars":true})")); } }, { "editPart: a list as bars", [&] { editPart(one, Json(0), Json::parse(R"({"bars":[4]})")); } },
            { "editPart: a part with a text as bars", [&] { editPart(textBars, Json(0), Json::parse(R"({"bars":4})")); } },
            { "setLocked: a text as index", [&] { setLocked(one, Json("0"), Json(true)); } }, { "copyPart: a text as index", [&] { copyPart(one, Json("0")); } },
            { "deletePart: null as index", [&] { deletePart(one, Json()); } }, { "movePart: a text as dir", [&] { movePart(one, Json(0), Json("1")); } },
            { "movePart: a text as index", [&] { movePart(one, Json("0"), Json(1)); } }, { "addPart: a text as the list of parts", [&] { addPart(textList); } },
        };
        for (const auto& [name, call] : mustThrow) {
            bool threw = false;
            try { call(); } catch (const std::invalid_argument&) { threw = true; }
            if (!threw) { std::printf("FAIL: %s does not throw\n", name); ++formWrong; }
        }
        std::printf("form: %d of %zu checks wrong\n", formWrong, mustThrow.size());
    }
    // Task 30b, Review Focus 3: a damaged file and a write that fails leave the tree in memory and the stored texts as they were, and state() names the reason; a damaged
    // or unreadable storage gives a session all the same (the sequences hold the same against the web; here each property is asked for by itself)
    int storageWrong = 0, storageChecks = 0;
    try {
        const auto check = [&](bool ok, const std::string& what) { ++storageChecks; if (!ok) { std::printf("FAIL: %s\n", what.c_str()); ++storageWrong; } };
        const auto stateOf = [](const btg::Session& s) { return json::parse(s.state()); };
        const auto profilesOf = [](const btg::Session& s) { return json::parse(s.profiles()); };
        const auto run = [](btg::Session& s, const std::vector<json>& actions) { for (const json& a : actions) s.apply(a.dump()); };
        const auto sel = [](const char* key) { return json { { "action", "profileSelect" }, { "key", key } }; };
        const json notStored = json::parse(R"([{"key":"ui.profileNotStored","params":{}}])"), bad = json::parse(R"([{"key":"err.badProfile","params":{}}])");
        const std::string goodFile = R"({"format":"backingtrack-profile","version":2,"name":"I","parts":{"tempo":{"bpm":100}}})";
        // a tree: profile A (id a) at the top, folder F (id f) with profile B (id b) in it
        const std::vector<json> tree = { json::parse(R"({"action":"saveProfile","name":"A","folder":null,"parts":["tempo"],"id":"a"})"), sel("mine"),
                                         json::parse(R"({"action":"addFolder","name":"F","id":"f"})"), sel("session"), json::parse(R"({"action":"saveProfile","name":"B","folder":"f","parts":["mixer"],"id":"b"})") };
        // each kind of change of the tree, after what it needs: the write refuses, then throws
        const std::vector<std::pair<std::vector<json>, json>> changes {
            { { sel("session") }, json::parse(R"({"action":"saveProfile","name":"N","folder":null,"parts":["tempo"],"id":"n1"})") },
            { { sel("a") }, json::parse(R"({"action":"overwriteProfile","parts":["mixer"]})") },
            { { sel("a") }, json::parse(R"({"action":"renameNode","name":"A2"})") },
            { { sel("mine") }, json::parse(R"({"action":"addFolder","name":"G","id":"g1"})") },
            { {}, json::parse(R"({"action":"moveNode","id":"a","target":"f"})") },
            { { sel("a") }, json::parse(R"({"action":"deleteNode"})") },
            { { sel("factory:funk") }, json::parse(R"({"action":"copyFactory","name":"Funk","id":"c1"})") },
            { { sel("mine") }, json { { "action", "importProfile" }, { "from", "text" }, { "text", goodFile }, { "ids", json::array({ "i1" }) } } },
            { { sel("a"), json::parse(R"({"action":"deleteNode"})") }, json::parse(R"({"action":"undoProfile"})") },
        };
        for (const char* mode : { "false", "throw" })
            for (const auto& [before, change] : changes) {
                SequenceStorage st;
                btg::Session s(st);
                run(s, tree);
                run(s, before);
                const json was = profilesOf(s);
                const std::string stored = st.files.at("profiles.json");
                st.log = json::array();
                st.failWrites = mode;
                const btg::Session::Change c = s.apply(change.dump());
                st.failWrites.clear();
                const json now = profilesOf(s);
                btg::Session::Change named;
                named.profiles = was.at("message") != notStored; // only the message changes: the window says so
                check(now.at("items") == was.at("items") && now.at("selection") == was.at("selection") && now.at("open") == was.at("open") && now.at("undo") == was.at("undo")
                          && st.files.at("profiles.json") == stored && st.log.size() == 1 && now.at("message") == notStored && changeOf(c) == changeOf(named),
                      std::string("a write that fails (") + mode + ") at " + change.at("action").get<std::string>() + " changes the tree, the stored text or is not named");
            }
        // damaged files: nothing changes, nothing is written, the reason is named
        const std::string tooLong = goodFile + std::string(5000001 - goodFile.size(), ' ');
        const std::vector<std::pair<const char*, json>> damaged {
            { "no JSON", { { "from", "text" }, { "text", "kein JSON" } } }, { "another format", { { "from", "text" }, { "text", R"({"format":"other","version":1})" } } },
            { "5,000,001 characters", { { "from", "text" }, { "text", tooLong } } }, { "a file of 5,000,001 bytes", { { "from", "file" }, { "text", goodFile }, { "size", 5000001 } } },
            { "a file that cannot be read", { { "from", "file" }, { "text", nullptr }, { "size", 10 } } },
        };
        for (const auto& [what, fields] : damaged) {
            SequenceStorage st;
            btg::Session s(st);
            run(s, tree);
            run(s, { sel("mine") });
            const json was = profilesOf(s);
            st.log = json::array();
            json action = fields;
            action["action"] = "importProfile";
            action["ids"] = json::array({ "i1", "i2" });
            s.apply(action.dump());
            const json now = profilesOf(s);
            check(now.at("items") == was.at("items") && st.log.empty() && now.at("message") == bad, std::string("an import of ") + what + " changes the tree, writes or is not named");
        }
        // what the web reads of a file in part (ruled): a newer version as far as its fields are known, nine levels and 1,001 nodes as far as they fit
        {
            SequenceStorage st;
            btg::Session s(st);
            run(s, { sel("mine") });
            std::string newer = goodFile;
            newer.replace(newer.find("\"version\":2"), 11, "\"version\":99");
            s.apply(json { { "action", "importProfile" }, { "from", "text" }, { "text", newer }, { "ids", json::array({ "v1" }) } }.dump());
            check(profilesOf(s).at("items").size() == 1 && profilesOf(s).at("message").at(0).at("key") == "ui.profileImported", "a file of version 99 is not read");
            // Task 32a, the user's decision of 2026-11-22: the newer version is named with its number; a file of the app's own version names none, and both read the same tree
            {
                SequenceStorage own;
                btg::Session same(own);
                run(same, { sel("mine") });
                same.apply(json { { "action", "importProfile" }, { "from", "text" }, { "text", goodFile }, { "ids", json::array({ "v1" }) } }.dump());
                const json named = json { { "key", "ui.profileNewerVersion" }, { "params", { { "version", 99 } } } };
                check(profilesOf(s).at("message").size() == 2 && profilesOf(s).at("message").at(1) == named, "a file of version 99 does not name its version");
                check(profilesOf(same).at("message").size() == 1 && profilesOf(same).at("message").at(0).at("key") == "ui.profileImported" && profilesOf(same).at("items") == profilesOf(s).at("items"),
                      "a file of the app's version names a version, or reads another tree than one of version 99");
                SequenceStorage folders;
                btg::Session folder(folders);
                run(folder, { sel("mine") });
                folder.apply(json { { "action", "importProfile" }, { "from", "text" }, { "text", R"({"format":"backingtrack-folder","version":2,"name":"F","items":[{"type":"profile","name":"p","parts":{"tempo":{"bpm":100}}}]})" },
                                    { "ids", json::array({ "f1", "f2" }) } }.dump());
                check(profilesOf(folder).at("message").size() == 2 && profilesOf(folder).at("message").at(1) == json { { "key", "ui.profileNewerVersion" }, { "params", { { "version", 2 } } } },
                      "a folder file of version 2 (the app writes 1) does not name its version");
            }
            std::string deep = "{\"type\":\"profile\",\"name\":\"p\",\"parts\":{\"tempo\":{\"bpm\":100}}}";
            for (int i = 0; i < 9; ++i) deep = "{\"type\":\"folder\",\"name\":\"T\",\"items\":[" + deep + "]}";
            run(s, { sel("mine") });
            json ids = json::array();
            for (int i = 0; i < 12; ++i) ids.push_back("d" + std::to_string(i));
            s.apply(json { { "action", "importProfile" }, { "from", "text" }, { "text", "{\"format\":\"backingtrack-folder\",\"version\":1,\"name\":\"Tief\",\"items\":[" + deep + "]}" }, { "ids", ids } }.dump());
            const json deepState = profilesOf(s);
            // the file's folder and seven of its nine are kept (eight levels), the eighth of them is skipped with its content
            check(deepState.at("nodes") == 9 && deepState.at("message").size() == 2 && deepState.at("message").at(1).at("key") == "ui.profileSkipped.one", "a folder nine levels deep does not keep what fits");
            std::string many = "{\"format\":\"backingtrack-folder\",\"version\":1,\"name\":\"B\",\"backup\":true,\"items\":[";
            for (int i = 0; i < 1001; ++i) many += std::string(i ? "," : "") + "{\"type\":\"profile\",\"name\":\"N" + std::to_string(i) + "\",\"parts\":{\"variant\":{\"seed\":1}}}";
            many += "]}";
            const int room = 1000 - profilesOf(s).at("nodes").get<int>();
            json more = json::array();
            for (int i = 0; i < room; ++i) more.push_back("m" + std::to_string(i));
            run(s, { sel("mine") });
            s.apply(json { { "action", "importProfile" }, { "from", "text" }, { "text", many }, { "ids", more } }.dump());
            const json full = profilesOf(s);
            // the file keeps 1,000 (one skipped), the tree takes what it has room for (the rest dropped)
            check(full.at("nodes") == 1000 && full.at("message").back().at("key") == "ui.profileDropped" && full.at("message").back().at("params").at("n") == 1000 - room, "1,001 nodes do not keep what fits");
        }
        // a damaged or unreadable storage: a session all the same, without a throw and without a write (the page load writes nothing: app.js 153, 484-486)
        // `ok` gets { state, profiles } of the new session
        const auto start = [&](std::map<std::string, std::string> files, const std::string& reads, const std::string& what, const std::function<bool(const json&)>& ok) {
            try {
                SequenceStorage st;
                st.files = files;
                st.failReads = reads;
                btg::Session s(st);
                st.failReads.clear();
                check(st.log.empty() && st.files == files && ok(json { { "state", stateOf(s) }, { "profiles", profilesOf(s) } }), what);
            } catch (const std::exception& error) { check(false, what + " throws: " + error.what()); }
        };
        // the fix wave of Phase 6 (F1, PROTOKOLL.md section 3a): per name absent, unreadable (the read throws, the text is above 20,000,000 bytes) or damaged, and state().storage names it
        const auto problems = [](const json& s, const char* profiles, const char* session, const char* mix) {
            const auto is = [](const json& v, const char* want) { return want == nullptr ? v.is_null() : v == want; };
            const json& p = s.at("state").at("storage");
            return is(p.at("profiles"), profiles) && is(p.at("session"), session) && is(p.at("mix"), mix);
        };
        start({ { "profiles.json", "kein JSON" } }, "", "a stored tree that is no JSON", [&](const json& s) { return s.at("profiles").at("items").empty() && problems(s, "damaged", nullptr, nullptr); });
        start({ { "profiles.json", R"({"items":5})" } }, "", "a stored tree without a list", [&](const json& s) { return s.at("profiles").at("items").empty() && problems(s, "damaged", nullptr, nullptr); });
        start({ { "profiles.json", "null" }, { "session.json", "[]" }, { "mix.json", "5" } }, "", "null, a list and a number", [&](const json& s) { return problems(s, "damaged", "damaged", "damaged"); });
        start({ { "profiles.json", "[]" }, { "mix.json", "{}" } }, "", "an empty old list and an empty mixer (not damaged)", [&](const json& s) { return problems(s, nullptr, nullptr, nullptr); });
        start({ { "profiles.json", R"({"version":2,"items":[{"type":"note"}]})" } }, "", "a tree of nothing usable (the format, not damaged)", [&](const json& s) { return s.at("profiles").at("items").empty() && problems(s, nullptr, nullptr, nullptr); });
        start({ { "session.json", R"({"parts":5})" } }, "", "a stored last session that is damaged", [&](const json& s) { return s.at("state").at("resumed").is_null() && s.at("state").at("last").is_null() && problems(s, nullptr, "damaged", nullptr); });
        start({ { "mix.json", "[1,2]" } }, "", "a stored mixer that is damaged", [&](const json& s) { return s.at("state").at("mix").at("master") == 1 && problems(s, nullptr, nullptr, "damaged"); });
        start({ { "profiles.json", R"({"version":2,"items":[]})" } }, "throw", "a storage whose reads throw", [&](const json& s) {
            return s.at("profiles").at("items").empty() && s.at("state").at("last").is_null() && problems(s, "unreadable", "unreadable", "unreadable"); });
        start({ { "profiles.json", R"({"version":2,"items":[]})" } }, "none", "a storage that finds nothing", [&](const json& s) { return problems(s, nullptr, nullptr, nullptr); });
        {
            const std::string tree = R"({"version":2,"items":[{"id":"a","type":"profile","name":"A","parts":{"variant":{"seed":1}}}]})", mix = R"({"master":0.5})";
            const auto padded = [](std::string text, size_t bytes) { text.resize(bytes, ' '); return text; }; // JSON with white space after it, `bytes` long
            start({ { "profiles.json", padded(tree, 20000000) }, { "mix.json", padded(mix, 20000000) } }, "", "texts of 20,000,000 bytes (read)", [&](const json& s) {
                return s.at("profiles").at("items").size() == 1 && s.at("state").at("mix").at("master") == 0.5 && problems(s, nullptr, nullptr, nullptr); });
            start({ { "profiles.json", padded(tree, 20000001) }, { "mix.json", padded(mix, 20000001) }, { "session.json", std::string(20000001, ' ') } }, "", "texts of 20,000,001 bytes (not read)",
                  [&](const json& s) { return s.at("profiles").at("items").empty() && s.at("state").at("mix").at("master") == 1 && problems(s, "unreadable", "unreadable", "unreadable"); });
        }
        // a stored last session is only offered: the mixer is the stored one, not the session's, nothing is resumed or written
        SequenceStorage played;
        {
            btg::Session s(played);
            s.apply(R"({"action":"rememberSession","bar":3,"at":4})");
            s.apply(R"({"action":"setLevel","channel":"drums","value":30})");
        }
        start(played.files, "", "a stored last session that is offered", [&](const json& s) {
            const json& state = s.at("state");
            return state.at("last").at("bar") == 3 && state.at("resumed").is_null() && state.at("mix").at("drums") == 0.3 && state.at("track").at("seed") == 1 && problems(s, nullptr, nullptr, nullptr); });
        // "Weitermachen" while playing writes session.json, then mix.json (PROTOKOLL.md section 3a); each holds or fails by itself, and the session keeps both new values
        for (const char* failing : { "", "session.json", "mix.json" }) {
            SequenceStorage st;
            btg::Session s(st);
            run(s, { json::parse(R"({"action":"rememberSession","bar":5,"at":1})"), json::parse(R"({"action":"setLevel","channel":"drums","value":80})") });
            const std::string entry = st.files.at("session.json"), mix = st.files.at("mix.json");
            st.log = json::array();
            st.failName = failing;
            s.apply(R"({"action":"resume","playing":{"bar":7,"at":2}})");
            const json now = stateOf(s);
            const bool order = st.log.size() == 2 && st.log.at(0).at(0) == "session.json" && st.log.at(1).at(0) == "mix.json";
            const bool stored = (st.files.at("session.json") == entry) == (std::string(failing) == "session.json") && (st.files.at("mix.json") == mix) == (std::string(failing) == "mix.json");
            check(order && stored && now.at("last").at("bar") == 7 && now.at("mix").at("drums") == 1 && now.at("resumed") == json { { "bar", 5 } },
                  std::string("resume while playing with ") + (*failing ? failing : "no write") + " failing does not write both in order or does not keep both values");
            const json& named = now.at("storage");
            check(named.at("session") == (std::string(failing) == "session.json" ? json("notStored") : json()) && named.at("mix") == (std::string(failing) == "mix.json" ? json("notStored") : json()),
                  std::string("resume while playing with ") + (*failing ? failing : "no write") + " failing does not name what was not stored");
        }
        const auto allFalse = [](const btg::Session::Change& c) { return changeOf(c) == changeOf({}); };
        // an unreadable profiles.json: the tree is empty and no action writes profiles.json (each that would change the tree is refused and changes nothing; what changes no
        // tree acts as always), until reloadProfiles reads it; a read that throws again changes nothing
        {
            SequenceStorage st;
            {
                btg::Session first(st);
                run(first, tree);
            }
            const std::map<std::string, std::string> stored = st.files;
            st.failReads = "throw";
            btg::Session s(st);
            st.failReads.clear();
            check(profilesOf(s).at("items").empty() && stateOf(s).at("storage").at("profiles") == "unreadable", "an unreadable profiles.json is not named");
            const std::vector<std::pair<json, json>> changesOfTree {
                { sel("session"), json::parse(R"({"action":"saveProfile","name":"N","folder":null,"parts":["tempo"],"id":"n1"})") },
                { sel("mine"), json::parse(R"({"action":"addFolder","name":"G","id":"g1"})") },
                { sel("factory:funk"), json::parse(R"({"action":"copyFactory","name":"Funk","id":"c1"})") },
                { sel("mine"), json { { "action", "importProfile" }, { "from", "text" }, { "text", goodFile }, { "ids", json::array({ "i1" }) } } },
                { sel("session"), json { { "action", "importProfile" }, { "from", "file" }, { "text", goodFile }, { "size", goodFile.size() }, { "ids", json::array({ "i2" }) } } },
            };
            for (const auto& [before, change] : changesOfTree) {
                s.apply(before.dump());
                const std::string view = s.profiles();
                st.log = json::array();
                const btg::Session::Change c = s.apply(change.dump());
                check(allFalse(c) && s.profiles() == view && st.log.empty() && st.files == stored, "after an unreadable read, " + change.at("action").get<std::string>() + " is not refused");
            }
            for (const char* name : { "overwriteProfile", "renameNode", "deleteNode", "undoProfile" }) // no own row: not valid
                check(allFalse(s.apply(json { { "action", name }, { "name", "X" }, { "parts", json::array({ "tempo" }) } }.dump())), std::string("after an unreadable read, ") + name + " is valid");
            run(s, { sel("session") });
            const btg::Session::Change needParts = s.apply(R"({"action":"saveProfile","name":"N","folder":null,"parts":[],"id":"n2"})");
            check(needParts.profiles && profilesOf(s).at("message").at(0).at("key") == "ui.profileNeedParts", "after an unreadable read, a save without parts does not say so");
            check(st.files == stored, "after an unreadable read, a text of profiles.json was replaced");
            st.failReads = "throw";
            const btg::Session::Change again = s.apply(R"({"action":"reloadProfiles"})");
            st.failReads.clear();
            check(allFalse(again) && profilesOf(s).at("items").empty() && stateOf(s).at("storage").at("profiles") == "unreadable", "reloadProfiles on a storage that still throws changes something");
            const btg::Session::Change reloaded = s.apply(R"({"action":"reloadProfiles"})");
            check(reloaded.profiles && profilesOf(s).at("nodes") == 3 && stateOf(s).at("storage").at("profiles").is_null() && st.files == stored, "reloadProfiles does not load the tree or writes");
            check(allFalse(s.apply(R"({"action":"reloadProfiles"})")), "reloadProfiles is valid without a problem");
            run(s, { sel("session"), json::parse(R"({"action":"saveProfile","name":"N","folder":null,"parts":["tempo"],"id":"n3"})") });
            check(profilesOf(s).at("nodes") == 4 && st.files.at("profiles.json") != stored.at("profiles.json"), "after reloadProfiles, saving does not work");
        }
        // a damaged profiles.json: kept once, byte for byte, as profiles.damaged.json before the first write of the tree; a failing write of it refuses the change as a failing
        // write of the tree does; once kept, it stays kept also if the tree's write then fails
        {
            const std::string damaged = "{\"version\":2,\"items\":[ kaputt \xC3\xA4";
            SequenceStorage st;
            st.files["profiles.json"] = damaged;
            btg::Session s(st);
            check(stateOf(s).at("storage").at("profiles") == "damaged" && st.log.empty(), "a damaged profiles.json is not named or written at load");
            const json save = json::parse(R"({"action":"saveProfile","name":"N","folder":null,"parts":["tempo"],"id":"d1"})");
            st.failWrites = "false";
            btg::Session::Change c = s.apply(save.dump());
            st.failWrites.clear();
            check(st.log.size() == 1 && st.log.at(0).at(0) == "profiles.damaged.json" && !st.files.count("profiles.damaged.json") && st.files.at("profiles.json") == damaged
                      && profilesOf(s).at("message") == notStored && profilesOf(s).at("items").empty() && c.profiles && stateOf(s).at("storage").at("profiles") == "damaged",
                  "a failing write of profiles.damaged.json does not refuse the change");
            st.log = json::array();
            st.failName = "profiles.json";
            c = s.apply(save.dump());
            st.failName.clear();
            check(st.log.size() == 2 && st.files.at("profiles.damaged.json") == damaged && st.files.at("profiles.json") == damaged && profilesOf(s).at("items").empty()
                      && stateOf(s).at("storage").at("profiles") == "damagedKept", "a kept text with a failing write of the tree is not kept, or the change is taken");
            st.log = json::array();
            run(s, { save, sel("session"), json::parse(R"({"action":"saveProfile","name":"M","folder":null,"parts":["tempo"],"id":"d2"})") });
            bool once = st.log.size() == 2;
            for (const json& w : st.log) once = once && w.at(0) == "profiles.json";
            check(once && st.files.at("profiles.damaged.json") == damaged && profilesOf(s).at("nodes") == 2 && stateOf(s).at("storage").at("profiles") == "damagedKept",
                  "profiles.damaged.json is written more than once, or saving does not work after it");
        }
        // a write of session.json or mix.json that fails is named until one holds; the memory keeps the new value
        {
            SequenceStorage st;
            btg::Session s(st);
            st.failName = "mix.json";
            s.apply(R"({"action":"setLevel","channel":"drums","value":30})");
            st.failName = "session.json";
            s.apply(R"({"action":"rememberSession","bar":3,"at":4})");
            st.failName.clear();
            json now = stateOf(s);
            check(now.at("storage").at("mix") == "notStored" && now.at("storage").at("session") == "notStored" && now.at("mix").at("drums") == 0.3 && now.at("last").at("bar") == 3,
                  "a failing write of mix.json or session.json is not named, or the new value is not kept");
            s.apply(R"({"action":"setLevel","channel":"drums","value":31})");
            s.apply(R"({"action":"rememberSession","bar":4,"at":5})");
            now = stateOf(s);
            check(now.at("storage").at("mix").is_null() && now.at("storage").at("session").is_null(), "a write of mix.json or session.json that holds does not end the problem");
        }
    } catch (const std::exception& error) { std::printf("FAIL: the checks of Review Focus 3 threw: %s\n", error.what()); ++storageWrong; }
    std::printf("storage: %d of %d checks wrong (a damaged file or a write that fails leaves the tree and the stored texts as they were and is named; a damaged storage gives a session;"
                " an unreadable, damaged or not stored text is named, an unreadable profiles.json is never written over, a damaged one is kept once)\n",
                storageWrong, storageChecks);
    // The fix wave of Phase 6 (F2): profiles() is built when what it shows changes (Change.profiles), not per call: 300 knob moves on a tree of 1,000 nodes with an own profile
    // selected build it no time, and a change of the tree builds it once, however often it is asked for then
    int viewWrong = 0, viewChecks = 0;
    try {
        const auto check = [&](bool ok, const char* what) { ++viewChecks; if (!ok) { std::printf("FAIL: %s\n", what); ++viewWrong; } };
        SequenceStorage st;
        std::string items;
        for (int f = 0; f < 100; ++f) {
            items += std::string(f ? "," : "") + "{\"id\":\"f" + std::to_string(f) + "\",\"type\":\"folder\",\"name\":\"Ordner " + std::to_string(f) + "\",\"items\":[";
            for (int p = 0; p < 9; ++p)
                items += std::string(p ? "," : "") + "{\"id\":\"p" + std::to_string(f) + "-" + std::to_string(p) + "\",\"type\":\"profile\",\"name\":\"Profil " + std::to_string(p) + "\",\"parts\":{\"variant\":{\"seed\":1}}}";
            items += "]}";
        }
        st.files["profiles.json"] = "{\"version\":2,\"items\":[" + items + "]}";
        btg::Session s(st);
        s.apply(R"({"action":"start","variant":7})");
        const btg::Session::Change opened = s.apply(R"({"action":"profileToggle","key":"f50"})");
        const btg::Session::Change chosen = s.apply(R"({"action":"profileSelect","key":"p50-4"})");
        check(opened.profiles && chosen.profiles && json::parse(s.profiles()).at("nodes") == 1000, "the tree of 1,000 nodes is not loaded, or a change of the window is not flagged");
        const size_t before = profilesViewBuilds();
        bool quiet = true;
        for (int i = 0; i < 300; ++i) {
            quiet = !s.apply(std::string(R"({"action":"setTimbre","group":"master","field":"reverb","value":)") + (i % 2 ? "40}" : "60}")).profiles && quiet;
            s.state();
            s.profiles();
        }
        check(quiet && profilesViewBuilds() == before, "300 knob moves build the view of profiles() or flag it");
        const bool renamed = s.apply(R"({"action":"renameNode","name":"Neu"})").profiles;
        const std::string view = s.profiles();
        check(renamed && profilesViewBuilds() == before + 1 && view.find("\"Neu\"") != std::string::npos, "a change of the tree does not build the view once");
        s.profiles();
        check(profilesViewBuilds() == before + 1, "a second call of profiles() builds the view again");
    } catch (const std::exception& error) { std::printf("FAIL: the check of the view threw: %s\n", error.what()); ++viewWrong; }
    std::printf("view: %d of %d checks wrong (profiles() is built once per change of what it shows, not per action or call)\n", viewWrong, viewChecks);
    // Task 30a: where the core is NOT the web's, so these are no cases of the file (profile_tree.cpp, track.cpp: the `shortcut:` comments). 1. A character that collation.json
    // does not hold (Greek, Cyrillic, CJK, an emoji) sorts after every covered character, and such characters among themselves by code point, where the web orders them by ICU.
    // 2. A file whose text nests deeper than 64 levels counts as no JSON, where the web reads it.
    int outsideWrong = 0;
    try {
        using btg::detail::compareNames;
        const std::vector<std::tuple<std::string, std::string, int>> pairs {
            { "Zebra", "\xCE\xA9mega", -1 }, { "~", "\xCE\xA9", -1 }, { "z", "\xCE\xB1", -1 }, { "\xCE\xA9", "\xD0\x9F\xD1\x80\xD0\xB8\xD0\xB2\xD0\xB5\xD1\x82", -1 },
            { "\xD0\x9F\xD1\x80\xD0\xB8\xD0\xB2\xD0\xB5\xD1\x82", "\xE4\xB8\xAD\xE6\x96\x87", -1 }, { "\xE4\xB8\xAD\xE6\x96\x87", "\xF0\x9F\x98\x80", -1 }, { "\xF0\x9F\x98\x80", "\xF0\x9F\x98\x81", -1 },
            { "\xCE\xA9", "\xCE\xA9", 0 }, { "a\xCE\xA9", "aZ", 1 }, { "\xCE\xA9" "A", "\xCE\xA9" "a", 0 }, { "\xF0\x9F\x98\x80", "\xCE\xA9", 1 }, { "9", "\xCE\xA9", -1 },
        };
        for (const auto& [a, b, want] : pairs)
            if (compareNames(a, b) != want || compareNames(b, a) != -want) { std::printf("FAIL: compareNames(\"%s\", \"%s\") is not %d\n", a.c_str(), b.c_str(), want); ++outsideWrong; }
        const Json sorted = btg::detail::sortItems(Json::parse(R"([{"type":"profile","name":"😀"},{"type":"profile","name":"中文"},{"type":"profile","name":"Zebra"},{"type":"profile","name":"Ω"},)"
                                                               R"({"type":"profile","name":"apple"},{"type":"profile","name":"П"}])"));
        std::string order;
        for (const Json& n : sorted) order += n.at("name").get<std::string>() + "|";
        if (order != "apple|Zebra|\xCE\xA9|\xD0\x9F|\xE4\xB8\xAD\xE6\x96\x87|\xF0\x9F\x98\x80|") { std::printf("FAIL: sortItems of names outside the table gives %s\n", order.c_str()); ++outsideWrong; }
        if (btg::detail::lowerCase("\xC3\x84\xCE\xA9" "A") != "\xC3\xA4\xCE\xA9" "a") { std::printf("FAIL: lowerCase outside the table\n"); ++outsideWrong; }
    } catch (const std::exception& error) { std::printf("FAIL: the check of names outside the table threw: %s\n", error.what()); ++outsideWrong; }
    std::printf("outside: %d of %d checks wrong (names outside collation.json sort after the covered ones, by code point)\n", outsideWrong, 14);
    int profileDepthWrong = 0;
    try {
        const auto fileWith = [](int levels) { // the profile file with an unknown field `extra` nested so that the text is `levels + 1` deep (the file's object is the first level)
            return "{\"format\":\"backingtrack-profile\",\"version\":2,\"name\":\"x\",\"parts\":{\"tempo\":{\"bpm\":100}},\"extra\":" + std::string(static_cast<size_t>(levels), '[') + std::string(static_cast<size_t>(levels), ']') + "}";
        };
        const bool at63 = btg::detail::parseFile(Json(fileWith(63))).at("ok").get<bool>();
        const bool at64 = btg::detail::parseFile(Json(fileWith(64))).at("ok").get<bool>();
        if (!at63) { std::printf("FAIL: a profile file nested 64 levels deep is refused\n"); ++profileDepthWrong; }
        if (at64) { std::printf("FAIL: a profile file nested 65 levels deep is read (the core's reader counts it as no JSON, the web reads it)\n"); ++profileDepthWrong; }
        // forty folders inside each other (84 levels of text; the web reads them and keeps eight): refused here, as no JSON
        std::string folders = "{\"format\":\"backingtrack-folder\",\"version\":1,\"name\":\"F\",\"items\":[";
        for (int i = 0; i < 39; ++i) folders += "{\"type\":\"folder\",\"name\":\"F\",\"items\":[";
        folders += "{\"type\":\"profile\",\"name\":\"p\",\"parts\":{\"tempo\":{\"bpm\":100}}}";
        for (int i = 0; i < 40; ++i) folders += "]}";
        if (btg::detail::parseFile(Json(folders)).at("ok").get<bool>()) { std::printf("FAIL: a folder file nested 84 levels deep is read\n"); ++profileDepthWrong; }
    } catch (const std::exception& error) { std::printf("FAIL: the check of the depth of a profile file threw: %s\n", error.what()); ++profileDepthWrong; }
    std::printf("profile depth: %d of 3 checks wrong (a file nested beyond 64 levels counts as no JSON; the web reads it)\n", profileDepthWrong);
    // Task 32a: derived() after every step of every sequence (withoutDerived), and its time on the state of the sequences where its text is the longest
    double perCall = 0;
    if (largest) {
        const auto begin = std::chrono::steady_clock::now();
        for (int i = 0; i < 100; ++i) largest->derived();
        perCall = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - begin).count() / 100;
    }
    std::printf("derived: %lld of %lld steps wrong (what derived() gives after each step of each sequence); the longest, %zu bytes, takes %.3f ms per call\n", derivedWrong, derivedChecks, largestBytes, perCall);
    if (derivedChecks == 0) std::printf("FAIL: the reference has no sequence: derived() was not checked\n");
    // Task 32a: importLegacy (PROTOKOLL.md section 3a) on the texts the sequences stored for a new session, each by itself and those of one step together: a session on an
    // empty storage that got start and then the texts equals (state(), profiles(), every stored text) a session made on a storage that holds them and started alike; a text
    // that session finds unreadable or damaged changes nothing; a storage that holds the name already keeps it; sent twice, the second changes nothing
    int legacyWrong = 0, legacyChecks = 0;
    try {
        const auto check = [&](bool ok, const std::string& what) { ++legacyChecks; if (!ok && ++legacyWrong <= 10) std::printf("FAIL: importLegacy: %s\n", what.c_str()); };
        const std::map<std::string, std::string> FIELD { { "profiles.json", "profiles" }, { "session.json", "session" }, { "mix.json", "mix" } };
        const std::string START = R"({"action":"start","variant":3})";
        const auto legacyOf = [&](const std::map<std::string, std::string>& texts) {
            json a = { { "action", "importLegacy" }, { "profiles", nullptr }, { "session", nullptr }, { "mix", nullptr } };
            for (const auto& [name, text] : texts) a[FIELD.at(name)] = text;
            return a.dump();
        };
        std::map<std::string, std::string> others; // what another session holds under each name
        {
            SequenceStorage st;
            btg::Session s(st);
            for (const char* a : { R"({"action":"saveProfile","name":"Z","folder":null,"parts":["tempo"],"id":"z"})", R"({"action":"rememberSession","bar":2,"at":3})",
                                   R"({"action":"setLevel","channel":"pad","value":20})" }) s.apply(a);
            others = st.files;
        }
        // state() without what importLegacy said of the texts (a session made on them says nothing), and what it said of each text that was sent
        const auto rest = [](const btg::Session& s) { json j = json::parse(s.state()); j.erase("legacy"); return j; };
        const auto said = [&](const btg::Session& s, const std::map<std::string, std::string>& texts, const char* want) {
            const json legacy = json::parse(s.state()).at("legacy");
            bool all = legacy.is_object();
            for (const auto& [name, field] : FIELD) all = all && legacy.at(field) == (texts.count(name) ? json(want) : json());
            return all;
        };
        std::set<std::map<std::string, std::string>> tried;
        for (const auto& group : storedGroups) {
            std::vector<std::map<std::string, std::string>> tries;
            std::map<std::string, std::string> all;
            for (const auto& [name, text] : group) if (FIELD.count(name)) { tries.push_back({ { name, text } }); all[name] = text; }
            if (tries.size() > 1) tries.push_back(all);
            for (const auto& texts : tries) {
                if (!tried.insert(texts).second) continue;
                const std::string what = " (" + legacyOf(texts).substr(0, 160) + ")";
                SequenceStorage made, empty;
                made.files = texts;
                btg::Session b(made), a(empty);
                b.apply(START);
                a.apply(START);
                const json stateBefore = rest(a);
                const std::string profilesBefore = a.profiles();
                const btg::Session::Change c = a.apply(legacyOf(texts));
                const json problems = json::parse(b.state()).at("storage");
                bool readable = true;
                for (const auto& entry : texts) readable = readable && problems.at(FIELD.at(entry.first)).is_null();
                if (readable)
                    check(rest(a) == rest(b) && a.profiles() == b.profiles() && empty.files == made.files && c.mix == (texts.count("mix.json") > 0) && said(a, texts, "taken"),
                          "a session that took the texts is not one made on them, or does not say taken" + what);
                else if (texts.size() == 1)
                    check(rest(a) == stateBefore && a.profiles() == profilesBefore && empty.files.empty() && changeOf(c) == changeOf({}) && said(a, texts, "damaged"),
                          "a text the constructor finds unreadable or damaged is taken, or not said damaged" + what);
                const json stateAfter = rest(a);
                const std::string profilesAfter = a.profiles();
                const auto filesAfter = empty.files;
                check(changeOf(a.apply(legacyOf(texts))) == changeOf({}) && rest(a) == stateAfter && a.profiles() == profilesAfter && empty.files == filesAfter && (!readable || said(a, texts, "stored")),
                      "sent twice, the second changes something, or does not say stored" + what);
                if (texts.size() > 1) continue;
                const std::string& name = texts.begin()->first;
                SequenceStorage holds;
                holds.files[name] = others.at(name);
                btg::Session h(holds);
                h.apply(START);
                const json heldState = rest(h);
                const std::string heldProfiles = h.profiles();
                check(changeOf(h.apply(legacyOf(texts))) == changeOf({}) && rest(h) == heldState && h.profiles() == heldProfiles && holds.files == std::map<std::string, std::string> { { name, others.at(name) } }
                          && said(h, texts, problems.at(FIELD.at(name)) == "unreadable" ? "damaged" : "stored"), // a text above 20,000,000 bytes is judged before the storage is read
                      "a storage that holds the name does not keep it, or does not say stored" + what);
            }
        }
        if (legacyChecks == 0) check(false, "the reference brings no stored texts");
        // Task 32c: state().legacy says per text what the action did: taken, stored (the app's own), damaged (the old text), failed (a read that throws, a write that fails:
        // the page sends it again at the next load); a text not sent is null, and the next action sets it to null
        const std::map<std::string, std::string> DAMAGED { { "profiles.json", "kein JSON" }, { "session.json", R"({"parts":5})" }, { "mix.json", "[1]" } };
        const auto saidOf = [](const btg::Session& s) { return json::parse(s.state()).at("legacy"); };
        for (const auto& [name, field] : FIELD) {
            const auto one = [&, name = name, field = field](const std::string& how, const std::string& text, const std::function<void(SequenceStorage&)>& before, const char* want) {
                SequenceStorage st;
                before(st);
                btg::Session s(st);
                s.apply(START);
                if (how == "reads") st.failReads = "throw";
                if (how == "writes") st.failName = name;
                s.apply(legacyOf({ { name, text } }));
                st.failReads.clear();
                st.failName.clear();
                json expected = { { "profiles", nullptr }, { "session", nullptr }, { "mix", nullptr } };
                expected[field] = want;
                check(saidOf(s) == expected, "state().legacy of " + name + " (" + how + ") is " + saidOf(s).dump() + ", not " + want);
                s.apply(START);
                check(saidOf(s).is_null(), "state().legacy of " + name + " (" + how + ") stays after the next action");
            };
            const auto none = [](SequenceStorage&) {};
            one("taken", others.at(name), none, "taken");
            one("stored", others.at(name), [&, name = name](SequenceStorage& st) { st.files[name] = others.at(name); }, "stored");
            one("damaged", DAMAGED.at(name), none, "damaged");
            one("reads", others.at(name), none, "failed");
            one("writes", others.at(name), none, "failed");
            // fix round 1: the app's own text is stored but damaged (state().storage names it): doubtful, so failed, not stored
            one("stored, damaged", others.at(name), [&, name = name](SequenceStorage& st) { st.files[name] = DAMAGED.at(name); }, "failed");
        }
        {
            SequenceStorage st;
            btg::Session s(st);
            s.apply(START);
            st.failName = "profiles.json";
            s.apply(legacyOf(others));
            st.failName.clear();
            check(saidOf(s) == json { { "profiles", "failed" }, { "session", "failed" }, { "mix", "failed" } } && st.files.empty(), "a profiles.json that is not written leaves the others taken: " + saidOf(s).dump());
            SequenceStorage throwing;
            throwing.failReads = "throw";
            btg::Session t(throwing);
            throwing.failReads.clear();
            t.apply(START);
            t.apply(legacyOf({ { "profiles.json", others.at("profiles.json") } }));
            check(saidOf(t).at("profiles") == "failed" && throwing.files.empty(), "a profiles.json unreadable at the load is not named failed: " + saidOf(t).dump());
        }
    } catch (const std::exception& error) { std::printf("FAIL: the check of importLegacy threw: %s\n", error.what()); ++legacyWrong; }
    std::printf("legacy: %d of %d checks wrong (importLegacy takes a text of the old page as a session made on it does, a damaged one not, nothing over a stored one, nothing twice;"
                " state().legacy says per text taken, stored, damaged or failed)\n", legacyWrong, legacyChecks);
    // the replace check ran inside the sequences (playSession); a key it never met was not proven
    std::set<std::string> kinds; // setTimbre/<path> and setRhythmKnob/<knob> by their action, editPart's by field
    for (const std::string& key : replaceMet) kinds.insert(key.rfind("editPart/", 0) == 0 ? key : key.substr(0, key.find('/')));
    std::string met;
    for (const std::string& kind : kinds) met += (met.empty() ? "" : ", ") + kind;
    const bool replaceUnmet = kinds.size() != 5;
    std::printf("replace: %lld of %lld checks wrong (an action and, directly after it, a newer one of its replaceKey give what the newer alone gives; "
                "%zu keys of the kinds %s)\n", replaceWrong, replaceChecks, replaceMet.size(), met.c_str());
    if (replaceUnmet) std::printf("FAIL: the replace check met %zu kinds of key, the core gives 5 (setTimbre, setRhythmKnob, editPart level, density, transition)\n", kinds.size());
    int untested = 0; // a function of the table that the file brings no case for was not checked
    for (const auto& entry : FUNCTIONS) if (!seen.count(entry.first)) { std::printf("no case for %s in %s\n", entry.first.c_str(), argv[1]); ++untested; }
    std::printf("displays: %lld of %lld cases wrong (chordDisplays: what the displays of the own songs' page show, against the old page's track.js and the web's functions);"
                " %.3f ms per call, the longest %.3f ms\n", displaysWrong, displaysChecks, displaysChecks ? displaysMs / static_cast<double>(displaysChecks) : 0.0, displaysLongest);
    std::printf("logic: functions %zu, cases %zu, identical %lld, close %lld, different %lld\n", FUNCTIONS.size(), read, identical, close, different);
    std::printf("renderString: %lld of %d cases close, passed by the ruled exception (a C runtime function's last bit against V8's)\n", closeString, seen["renderString"]);
    // A close is a difference in the last bits (possibly another platform's math library): it fails too. An exception has to be ruled
    // by the owner and named here (function and field, from the line above), not passed.
    if (close) std::printf("FAIL: %lld case(s) are only close, not bit for bit: a difference in the last bits, possibly another platform's math library; ruled exceptions are named in this test\n", close);
    return different || untested || close || deepWrong || seedWrong || formWrong || storageWrong || viewWrong || outsideWrong || profileDepthWrong || replaceWrong || replaceUnmet
                   || derivedWrong || derivedChecks == 0 || legacyWrong ? 1 : 0;
}
