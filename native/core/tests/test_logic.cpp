// Compares the core's logic function by function with the web app in the working tree.
// Usage: btg_logic_tests <logic.json>   (written by native/tools/export-logic.mjs)
// Every case is { fn, in, out }: the core's function of that name gets `in` and must give `out`, compared as the parity test compares
// events (json_compare.h): numbers bit for bit ("identical") or within 1.5e-6 ("close", which fails too: a difference in the last bits,
// possibly another platform's math library; an exception has to be ruled and named here); anything else fails, also an unknown fn.
#include "../src/convolver.h"
#include "../src/sound_data.h"
#include "../src/sound_model.h"
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
};

} // namespace

int main(int argc, char** argv) {
    if (argc < 2) { std::printf("usage: btg_logic_tests <logic.json>\n"); return 2; }
    std::ifstream file(argv[1], std::ios::binary);
    if (!file) { std::printf("cannot open %s\n", argv[1]); return 2; }
    const json cases = json::parse(file);
    if (!cases.is_array() || cases.empty()) { std::printf("%s has no case: nothing was checked\n", argv[1]); return 1; } // a gate must not pass on nothing
    long long identical = 0, close = 0, different = 0;
    std::map<std::string, int> seen; // cases per function in the file
    for (size_t i = 0; i < cases.size(); ++i) {
        const json& c = cases[i];
        ++seen[c.at("fn").get<std::string>()];
        const auto fn = FUNCTIONS.find(c.at("fn").get<std::string>());
        btg::test::Compare compare;
        json got;
        if (fn == FUNCTIONS.end()) compare.fail("fn");
        else { got = fn->second(c.at("in")); compare.value("out", c.at("out"), got); }
        if (compare.result == btg::test::Match::identical) { ++identical; continue; }
        if (compare.result == btg::test::Match::close) { ++close; std::printf("close: %s #%zu %s by %.3g\n", c.at("fn").get<std::string>().c_str(), i, compare.field.c_str(), compare.delta); continue; }
        if (++different <= 20) std::printf("different: %s #%zu %s: in %s, want %s, got %s\n", c.at("fn").get<std::string>().c_str(), i, compare.field.c_str(),
                                           c.at("in").dump().c_str(), c.at("out").dump().c_str(), got.dump().c_str());
    }
    int untested = 0; // a function of the table that the file brings no case for was not checked
    for (const auto& entry : FUNCTIONS) if (!seen.count(entry.first)) { std::printf("no case for %s in %s\n", entry.first.c_str(), argv[1]); ++untested; }
    std::printf("logic: functions %zu, cases %zu, identical %lld, close %lld, different %lld\n", FUNCTIONS.size(), cases.size(), identical, close, different);
    // A close is a difference in the last bits (possibly another platform's math library): it fails too. An exception has to be ruled
    // by the owner and named here (function and field, from the line above), not passed.
    if (close) std::printf("FAIL: %lld case(s) are only close, not bit for bit: a difference in the last bits, possibly another platform's math library; ruled exceptions are named in this test\n", close);
    return different || untested || close ? 1 : 0;
}
