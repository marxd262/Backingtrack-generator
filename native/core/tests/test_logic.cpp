// Compares the core's logic function by function with the web app in the working tree.
// Usage: btg_logic_tests <logic.json>   (written by native/tools/export-logic.mjs)
// Every case is { fn, in, out }: the core's function of that name gets `in` and must give `out`, compared as the parity test compares
// events (json_compare.h): numbers bit for bit ("identical") or within 1.5e-6 ("close", which fails too: a difference in the last bits,
// possibly another platform's math library; an exception has to be ruled and named here); anything else fails, also an unknown fn.
// The one ruled exception (progress.md, "Task 24: Ruling", named before any run): a renderString case that is close passes, and their number
// is printed. The string model calls sin, cos, exp, pow and sqrt per partial and per sample, the C runtime's where the web calls V8's; the
// one case close on MSVC (task-24-report.md) differs from the web because one sin returns the other neighbour of a value that lies within
// 1.2e-20 of the midpoint of two doubles, and with V8's results in place of the C runtime's the core's samples are the web's bit for bit.
#include "../src/convolver.h"
#include "../src/sound_data.h"
#include "../src/sound_model.h"
#include "../src/string_model.h"
#include "../src/track_internal.h"
#include "btg/track.h"
#include "json_compare.h"

#include <cmath>
#include <cstdio>
#include <fstream>
#include <functional>
#include <map>

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
};

} // namespace

int main(int argc, char** argv) {
    if (argc < 2) { std::printf("usage: btg_logic_tests <logic.json>\n"); return 2; }
    std::ifstream file(argv[1], std::ios::binary);
    if (!file) { std::printf("cannot open %s\n", argv[1]); return 2; }
    const json cases = json::parse(file, nullptr, false);
    if (cases.is_discarded()) { std::printf("%s is not valid JSON (cut off?): nothing was checked\n", argv[1]); return 1; }
    if (!cases.is_array() || cases.empty()) { std::printf("%s has no case: nothing was checked\n", argv[1]); return 1; } // a gate must not pass on nothing
    long long identical = 0, close = 0, different = 0, closeString = 0;
    std::map<std::string, int> seen; // cases per function in the file
    for (size_t i = 0; i < cases.size(); ++i) {
        try {
            const json& c = cases[i];
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
            if (++different <= 20) std::printf("different: %s #%zu %s: in %s, want %s, got %s\n", c.at("fn").get<std::string>().c_str(), i, compare.field.c_str(),
                                               c.at("in").dump().c_str(), c.at("out").dump().c_str(), got.dump().c_str());
        } catch (const std::exception& error) { // a case that is no case, or a function that throws what the web's does not
            if (++different <= 20) std::printf("different: #%zu threw: %s\n", i, error.what());
        }
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
    int untested = 0; // a function of the table that the file brings no case for was not checked
    for (const auto& entry : FUNCTIONS) if (!seen.count(entry.first)) { std::printf("no case for %s in %s\n", entry.first.c_str(), argv[1]); ++untested; }
    std::printf("logic: functions %zu, cases %zu, identical %lld, close %lld, different %lld\n", FUNCTIONS.size(), cases.size(), identical, close, different);
    std::printf("renderString: %lld of %d cases close, passed by the ruled exception (a C runtime function's last bit against V8's)\n", closeString, seen["renderString"]);
    // A close is a difference in the last bits (possibly another platform's math library): it fails too. An exception has to be ruled
    // by the owner and named here (function and field, from the line above), not passed.
    if (close) std::printf("FAIL: %lld case(s) are only close, not bit for bit: a difference in the last bits, possibly another platform's math library; ruled exceptions are named in this test\n", close);
    return different || untested || close || deepWrong ? 1 : 0;
}
