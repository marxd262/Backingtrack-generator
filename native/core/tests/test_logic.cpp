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
#include "btg/session.h"
#include "btg/track.h"
#include "json_compare.h"

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
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

// Task 29: the session reads and writes nothing yet (Task 30 does); every call is counted, and main() fails on any
struct CountingStorage : btg::Storage {
    int calls = 0;
    std::optional<std::string> read(const std::string&) override { ++calls; return std::nullopt; }
    bool write(const std::string&, const std::string&) override { ++calls; return false; }
};
CountingStorage sessionStorage;
// A case is a sequence: `in` the action texts, `out` per action { change, state, track, sound, tuning }; `track` is what the web hands its player.
json playSession(const json& actions) {
    btg::Session session(sessionStorage);
    json out = json::array();
    for (const json& action : actions) {
        const btg::Session::Change c = session.apply(action.get<std::string>());
        out.push_back({ { "change", { { "events", c.events }, { "sound", c.sound }, { "voices", c.voices }, { "tempo", c.tempo }, { "mix", c.mix }, { "restart", c.restart }, { "inPlace", c.inPlace } } },
                        { "state", json::parse(session.state()) }, { "track", json::parse(session.track()) }, { "sound", json::parse(session.sound()) }, { "tuning", json::parse(session.tuning()) } });
    }
    return out;
}
// where a sequence first differs: the step, its action and the field
void printSessionStep(const json& c, const json& got) {
    for (size_t k = 0; k < c.at("out").size() && k < got.size(); ++k) {
        btg::test::Compare step;
        step.value("record", c.at("out")[k], got[k]);
        if (step.result == btg::test::Match::identical) continue;
        std::printf("session: first difference at step %zu (%s), field %s\n", k, c.at("in")[k].get<std::string>().c_str(), step.field.c_str());
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
    long long identical = 0, close = 0, different = 0, closeString = 0;
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
                json got;
                if (fn == FUNCTIONS.end()) compare.fail("fn");
                else { got = fn->second(c.at("in")); compare.value("out", c.at("out"), got); }
                if (compare.result == btg::test::Match::identical) { ++identical; continue; }
                if (compare.result == btg::test::Match::close && c.at("fn") == "renderString") { // the ruled exception (above): passes, counted
                    ++closeString;
                    std::printf("close (renderString, ruled): #%zu %s by %.3g\n", i, compare.field.c_str(), compare.delta);
                    continue;
                }
                if (compare.result == btg::test::Match::close) { ++close; std::printf("close: %s #%zu %s by %.3g\n", c.at("fn").get<std::string>().c_str(), i, compare.field.c_str(), compare.delta); continue; }
                if (different < 20 && c.at("fn") == "session") printSessionStep(c, got);
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
    std::printf("storage: %d calls of the session (it reads and writes nothing before Task 30)\n", sessionStorage.calls);
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
    int untested = 0; // a function of the table that the file brings no case for was not checked
    for (const auto& entry : FUNCTIONS) if (!seen.count(entry.first)) { std::printf("no case for %s in %s\n", entry.first.c_str(), argv[1]); ++untested; }
    std::printf("logic: functions %zu, cases %zu, identical %lld, close %lld, different %lld\n", FUNCTIONS.size(), read, identical, close, different);
    std::printf("renderString: %lld of %d cases close, passed by the ruled exception (a C runtime function's last bit against V8's)\n", closeString, seen["renderString"]);
    // A close is a difference in the last bits (possibly another platform's math library): it fails too. An exception has to be ruled
    // by the owner and named here (function and field, from the line above), not passed.
    if (close) std::printf("FAIL: %lld case(s) are only close, not bit for bit: a difference in the last bits, possibly another platform's math library; ruled exceptions are named in this test\n", close);
    return different || untested || close || deepWrong || seedWrong || formWrong || sessionStorage.calls || outsideWrong || profileDepthWrong ? 1 : 0;
}
