// Compares the C++ generator event by event with the web app in the working tree.
// Usage: btg_parity_tests <cases.json>   (written by native/tools/export-events.mjs)
// Every event of the core is written the way the web app writes it (only the fields that are set) and compared
// key by key, both ways: a field that only one side has is a difference.
// "identical": every field equal, numbers bit for bit. "close": numbers within 1.5e-6 (one step of the
// rounding to six places). Anything else is a difference and fails the test.
#include "btg/generator.h"
#include "json_compare.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <map>
#include <string>

using json = nlohmann::json;
using namespace btg::test;

namespace {

// The event as the web app writes it.
json written(const btg::Event& e) {
    static const char* const TYPES[] = { "chord", "marker", "note", "hit" };
    using Type = btg::Event::Type;
    json j = { { "t", e.t }, { "bar", e.bar }, { "type", TYPES[static_cast<int>(e.type)] } };
    if (e.beat) j["beat"] = *e.beat;
    if (e.type == Type::chord) j["chord"] = { { "root", e.chordRoot }, { "quality", e.chordQuality } };
    if (e.type == Type::marker) {
        j["name"] = e.name;
        if (e.name == "section") { j["kind"] = e.kind; j["index"] = e.index; }
    }
    if (e.type == Type::note) { j["layer"] = e.layer; j["midi"] = e.midi; j["vel"] = e.vel; j["dur"] = e.dur; }
    if (e.type == Type::hit) { j["layer"] = e.layer; j["name"] = e.name; j["vel"] = e.vel; }
    if (!e.art.empty()) j["art"] = e.art;
    if (e.artSemi) j["artSemi"] = *e.artSemi;
    if (e.artTime) j["artTime"] = *e.artTime;
    if (e.artRate) j["artRate"] = *e.artRate;
    if (e.strum) j["strum"] = json::array({ e.strum->first, e.strum->second });
    if (e.strumUp) j["strumUp"] = *e.strumUp;
    if (e.leslie) j["leslie"] = *e.leslie;
    if (e.swell) j["swell"] = *e.swell;
    if (e.ring) j["ring"] = true;
    return j;
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 2) { std::printf("usage: btg_parity_tests <cases.json>\n"); return 2; }
    std::ifstream file(argv[1], std::ios::binary);
    if (!file) { std::printf("cannot open %s\n", argv[1]); return 2; }
    const json cases = json::parse(file);

    long long total = 0, identical = 0, close = 0, different = 0;
    int tracksIdentical = 0, tracksFailed = 0, shown = 0;
    double worst = 0.0;
    std::map<std::string, long long> closeFields, differentFields;
    for (const auto& item : cases) {
        const std::string name = item.at("name");
        const auto& expected = item.at("events");
        std::vector<btg::Event> actual;
        try {
            actual = btg::buildEvents(item.at("track").dump());
        } catch (const std::exception& error) {
            std::printf("FAIL %s: %s\n", name.c_str(), error.what());
            different += static_cast<long long>(expected.size());
            total += static_cast<long long>(expected.size());
            ++tracksFailed;
            continue;
        }
        long long trackIdentical = 0, trackDifferent = 0;
        const size_t count = std::min(expected.size(), actual.size());
        for (size_t i = 0; i < count; ++i) {
            const json got = written(actual[i]);
            Compare c;
            c.value("event", expected[i], got);
            if (c.result == Match::identical) { ++trackIdentical; continue; }
            if (c.result == Match::close) { ++close; ++closeFields[c.field]; worst = std::max(worst, c.delta); continue; }
            ++trackDifferent;
            ++differentFields[c.field];
            if (shown < 12) {
                ++shown;
                std::printf("DIFF %s #%zu field %s: expected %s\n", name.c_str(), i, c.field.c_str(), expected[i].dump().c_str());
                std::printf("     got %s\n", got.dump().c_str());
            }
        }
        const long long extra = static_cast<long long>(std::max(expected.size(), actual.size()) - count);
        if (extra && shown < 12) { ++shown; std::printf("DIFF %s: %zu events expected, %zu built\n", name.c_str(), expected.size(), actual.size()); }
        trackDifferent += extra;
        total += static_cast<long long>(std::max(expected.size(), actual.size()));
        identical += trackIdentical;
        different += trackDifferent;
        if (trackDifferent) ++tracksFailed;
        else if (trackIdentical == static_cast<long long>(expected.size())) ++tracksIdentical;
    }

    std::printf("tracks: %zu, bit-identical: %d, with differences: %d\n", cases.size(), tracksIdentical, tracksFailed);
    std::printf("events: %lld, identical: %lld (%.4f %%), close: %lld, different: %lld\n", total, identical, total ? 100.0 * static_cast<double>(identical) / static_cast<double>(total) : 0.0, close, different);
    if (close) {
        std::printf("close (largest deviation %.3g):", worst);
        for (const auto& [field, n] : closeFields) std::printf(" %s %lld", field.c_str(), n);
        std::printf("\n");
    }
    if (different) {
        std::printf("different by first field:");
        for (const auto& [field, n] : differentFields) std::printf(" %s %lld", field.c_str(), n);
        std::printf("\n");
    }
    return different ? 1 : 0;
}
