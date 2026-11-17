// Compares the C++ generator event by event with the web app at the tag port-base.
// Usage: btg_parity_tests <cases.json>   (written by native/tools/export-events.mjs)
// "identical": every field equal, numbers bit for bit. "close": numbers within 1.5e-6 (one step of the
// rounding to six places). Anything else is a difference and fails the test.
#include "btg/generator.h"

#include <nlohmann/json.hpp>

#include <cmath>
#include <cstdio>
#include <fstream>
#include <map>
#include <string>

using json = nlohmann::json;

namespace {

const double TOLERANCE = 1.5e-6;
enum class Match { identical, close, different };

struct Compare {
    Match result = Match::identical;
    std::string field; // first field that is not identical
    double delta = 0.0;

    void text(const char* name, const json& expected, const std::string& actual) {
        const std::string want = expected.contains(name) && expected[name].is_string() ? expected[name].get<std::string>() : std::string();
        if (want != actual) fail(name);
    }
    void whole(const char* name, const json& expected, int actual, bool present = true) {
        if (expected.contains(name) != present || (present && expected[name] != actual)) fail(name);
    }
    void number(const char* name, const json& expected, bool present, double actual) {
        const bool wanted = expected.contains(name) && expected[name].is_number();
        if (wanted != present) return fail(name);
        if (!present) return;
        const double diff = std::fabs(expected[name].get<double>() - actual);
        if (diff == 0.0) return;
        if (result == Match::identical) field = name;
        delta = std::max(delta, diff);
        if (diff > TOLERANCE) result = Match::different;
        else if (result == Match::identical) result = Match::close;
    }
    void fail(const char* name) {
        if (result != Match::different) field = name;
        result = Match::different;
    }
};

Compare compare(const json& x, const btg::Event& e) {
    static const char* const TYPES[] = { "chord", "marker", "note", "hit" };
    const bool chord = e.type == btg::Event::Type::chord, marker = e.type == btg::Event::Type::marker, note = e.type == btg::Event::Type::note;
    const bool sound = !chord && !marker;
    Compare c;
    c.text("type", x, TYPES[static_cast<int>(e.type)]);
    c.text("layer", x, e.layer);
    c.text("name", x, e.name);
    c.text("art", x, e.art);
    c.text("kind", x, e.kind);
    c.whole("bar", x, e.bar);
    c.whole("midi", x, e.midi, note);
    c.whole("index", x, e.index, marker && e.name == "section");
    if (chord) {
        if (!x.contains("chord") || x["chord"].value("root", "") != e.chordRoot || x["chord"].value("quality", "") != e.chordQuality) c.fail("chord");
    } else if (x.contains("chord")) c.fail("chord");
    c.number("t", x, true, e.t);
    c.number("beat", x, e.beat.has_value(), e.beat.value_or(0));
    c.number("vel", x, sound, e.vel);
    c.number("dur", x, note, e.dur);
    c.number("artSemi", x, e.artSemi.has_value(), e.artSemi.value_or(0));
    c.number("artTime", x, e.artTime.has_value(), e.artTime.value_or(0));
    return c;
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
            const Compare c = compare(expected[i], actual[i]);
            if (c.result == Match::identical) { ++trackIdentical; continue; }
            if (c.result == Match::close) { ++close; ++closeFields[c.field]; worst = std::max(worst, c.delta); continue; }
            ++trackDifferent;
            ++differentFields[c.field];
            if (shown < 12) {
                ++shown;
                std::printf("DIFF %s #%zu field %s: expected %s\n", name.c_str(), i, c.field.c_str(), expected[i].dump().c_str());
                std::printf("     got t=%.6f bar=%d name=%s midi=%d vel=%.3f dur=%.6f art=%s\n", actual[i].t, actual[i].bar, actual[i].name.c_str(), actual[i].midi, actual[i].vel, actual[i].dur, actual[i].art.c_str());
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
