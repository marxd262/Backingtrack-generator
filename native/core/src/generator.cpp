// Port of the event generator of the web app (src/core): events.js, event-helpers.js,
// timeline.js, tags.js, grooves.js, arrange.js, form-arrange.js, form-types.js, form.js (chordIndex),
// form-post.js, microtiming.js. Layers so far: drums, bass and pad. See generator_internal.h for the rules of the port.
#include "generator_internal.h"

#include <nlohmann/json.hpp>

#include <limits>
#include <set>
#include <stdexcept>

extern const unsigned char btg_grooves_json[]; // native/core/data/grooves.json, embedded by CMake
extern const unsigned int btg_grooves_json_size;

namespace btg {
namespace detail {
namespace {

using json = nlohmann::ordered_json;

// ---------- data: meters, chords, grooves ----------

struct Meter { int beats, sub; };
const std::map<std::string, Meter> METERS { { "4/4", { 4, 4 } }, { "3/4", { 3, 4 } }, { "6/8", { 2, 3 } }, { "12/8", { 4, 3 } }, { "5/4", { 5, 4 } } };
const std::map<std::string, std::string> DEFAULT_GROOVE { { "4/4", "straight" }, { "3/4", "waltz" }, { "6/8", "ballad68" }, { "12/8", "shuffle" }, { "5/4", "fiveFour" } };

// src/core/chords.js: fifth and the tone the bass plays as seventh (10 where the chord has none)
const std::map<std::string, std::pair<int, int>> CHORD_BASS {
    { "maj", { 7, 10 } }, { "min", { 7, 10 } }, { "dim", { 6, 10 } }, { "aug", { 8, 10 } }, { "sus2", { 7, 10 } }, { "sus4", { 7, 10 } },
    { "power", { 7, 10 } }, { "dom7", { 7, 10 } }, { "maj7", { 7, 11 } }, { "min7", { 7, 10 } }, { "m7b5", { 6, 10 } }, { "dim7", { 6, 9 } },
    { "maj6", { 7, 9 } }, { "min6", { 7, 9 } }, { "add9", { 7, 10 } }, { "dom9", { 7, 10 } }, { "min9", { 7, 10 } },
};

struct DrumTier {
    std::vector<std::vector<int>> kicks;
    std::vector<int> snare, ghosts;
    std::vector<double> hat;
};
struct BassStep { int step; std::string degree; double len; };
using BassPattern = std::vector<BassStep>;
using Fill = std::vector<std::string>; // empty name = rest

struct Groove {
    std::string meter;
    int fillBeats = 0, cycle = 0;
    std::vector<double> drumThresholds, bassThresholds;
    std::vector<DrumTier> drumTiers;
    std::vector<std::vector<std::vector<int>>> extraKicks;
    std::vector<int> offbeatKicks;
    int openHatStep = -1;
    std::vector<Fill> fills, extraFills;
    std::vector<std::vector<BassPattern>> bassTiers, bassExtra;
    std::vector<std::vector<int>> stabs, extraStabs, arps, extraArps; // chords
    std::vector<int> offbeatStabs;
    int arpStep = 0;
};

const std::map<std::string, Groove>& grooves() {
    static const std::map<std::string, Groove> all = [] {
        const auto fillsOf = [](const json& list) {
            std::vector<Fill> out;
            for (const auto& fill : list) {
                out.emplace_back();
                for (const auto& name : fill) out.back().push_back(name.is_string() ? name.get<std::string>() : std::string());
            }
            return out;
        };
        const auto patternsOf = [](const json& tiers) {
            std::vector<std::vector<BassPattern>> out;
            for (const auto& tier : tiers) {
                out.emplace_back();
                for (const auto& pattern : tier) {
                    out.back().emplace_back();
                    for (const auto& s : pattern) out.back().back().push_back({ s[0].get<int>(), s[1].get<std::string>(), s[2].get<double>() });
                }
            }
            return out;
        };
        std::map<std::string, Groove> out;
        const json data = json::parse(btg_grooves_json, btg_grooves_json + btg_grooves_json_size);
        for (const auto& [id, j] : data.items()) {
            Groove g;
            g.meter = j.at("meter");
            g.fillBeats = j.at("fillBeats");
            g.cycle = METERS.at(g.meter).beats * METERS.at(g.meter).sub;
            const auto& d = j.at("drums");
            g.drumThresholds = d.at("thresholds").get<std::vector<double>>();
            for (const auto& t : d.at("tiers")) {
                g.drumTiers.push_back({ t.at("kicks").get<std::vector<std::vector<int>>>(), t.at("snare").get<std::vector<int>>(),
                                        t.at("ghosts").get<std::vector<int>>(), t.at("hat").get<std::vector<double>>() });
            }
            g.extraKicks = d.at("extraKicks").get<std::vector<std::vector<std::vector<int>>>>();
            g.offbeatKicks = d.at("offbeatKicks").get<std::vector<int>>();
            g.openHatStep = d.value("openHatStep", -1);
            g.fills = fillsOf(d.at("fills"));
            g.extraFills = fillsOf(d.at("extraFills"));
            g.bassThresholds = j.at("bass").at("thresholds").get<std::vector<double>>();
            g.bassTiers = patternsOf(j.at("bass").at("tiers"));
            g.bassExtra = patternsOf(j.at("bass").at("extra"));
            const auto& c = j.at("chords");
            g.stabs = c.at("stabs").get<std::vector<std::vector<int>>>();
            g.extraStabs = c.at("extraStabs").get<std::vector<std::vector<int>>>();
            g.arps = c.at("arps").get<std::vector<std::vector<int>>>();
            g.extraArps = c.at("extraArps").get<std::vector<std::vector<int>>>();
            g.offbeatStabs = c.at("offbeatStabs").get<std::vector<int>>();
            g.arpStep = c.at("arpStep");
            out[id] = std::move(g);
        }
        return out;
    }();
    return all;
}

// ---------- track ----------

Track parseTrack(const std::string& text) {
    const json j = json::parse(text);
    const auto number = [](const json& o, const char* key) -> std::optional<double> {
        return o.contains(key) && o[key].is_number() ? std::optional<double>(o[key].get<double>()) : std::nullopt;
    };
    Track t;
    t.keyRoot = j.at("key").at("root");
    t.keyMode = j.at("key").at("mode");
    t.bpm = j.at("bpm");
    for (const auto& b : j.at("bars")) t.bars.push_back({ { b.at("chord").at("root"), b.at("chord").at("quality") }, b.at("beats").get<int>() });
    t.length = j.at("length");
    t.meter = std::to_string(j.at("meter")[0].get<int>()) + "/" + std::to_string(j.at("meter")[1].get<int>());
    if (j.contains("groove") && j["groove"].is_string()) t.groove = j["groove"];
    t.complexity = number(j, "complexity");
    t.loose = number(j, "loose");
    t.ornaments = number(j, "ornaments");
    t.variety = j.contains("variety") && j["variety"].is_boolean() && j["variety"].get<bool>();
    for (const auto& [category, list] : j.at("tags").items()) t.tags.push_back({ category, list.get<std::vector<std::string>>() });
    for (const auto& [id, on] : j.at("layers").items()) t.layers[id] = on.is_boolean() && on.get<bool>();
    t.seed = static_cast<uint32_t>(static_cast<int64_t>(j.at("seed").get<double>())); // seed >>> 0
    for (const auto& [layer, voice] : j.at("voices").items()) t.voices[layer] = { voice.value("id", ""), voice.value("variant", "") };
    // completeJobs: the job given, else the first one of the layer
    t.jobs = { { "lead", "off" }, { "percussion", "mixed" } };
    if (j.contains("jobs") && j["jobs"].is_object())
        for (auto& [layer, job] : t.jobs) if (j["jobs"].contains(layer) && j["jobs"][layer].is_string()) job = j["jobs"][layer].get<std::string>();
    if (j.contains("form") && j["form"].is_object()) {
        const auto& form = j["form"];
        t.hasForm = true;
        for (const auto& s : form.at("sections")) {
            Part p;
            p.type = s.at("type");
            p.bars = s.at("bars");
            p.level = number(s, "level");
            p.density = number(s, "density");
            if (s.contains("transition") && s["transition"].is_string()) p.transition = s["transition"].get<std::string>();
            if (s.contains("crash") && s["crash"].is_boolean()) p.crash = s["crash"].get<bool>();
            t.parts.push_back(std::move(p));
        }
        if (form.contains("feel") && form["feel"].is_object()) {
            t.dynamics = number(form["feel"], "dynamics").value_or(0.6);
            t.pauses = number(form["feel"], "pauses").value_or(0.4);
            t.randomness = number(form["feel"], "randomness").value_or(0.5);
        }
    }
    return t;
}

// src/core/form.js, chordIndex: the progression starts again in every part
int chordIndex(const Track& track, int barIndex) {
    const int n = static_cast<int>(track.bars.size());
    if (!track.hasForm) return barIndex % n;
    int total = 0;
    for (const Part& p : track.parts) total += p.bars;
    int bar = barIndex % total, start = 0;
    for (const Part& p : track.parts) {
        if (bar < start + p.bars) return (bar - start) % n;
        start += p.bars;
    }
    return barIndex % n;
}

std::vector<Bar> barTimeline(const Track& track) {
    const auto found = METERS.find(track.meter);
    const int sub = (found != METERS.end() ? found->second : METERS.at("4/4")).sub;
    std::vector<Bar> out;
    int startBeat = 0;
    for (int index = 0; index < track.length; ++index) {
        const auto& [chord, beats] = track.bars[chordIndex(track, index)];
        Bar b;
        b.index = index;
        b.chord = chord;
        b.beats = beats;
        b.next = track.bars[chordIndex(track, index + 1)].first;
        b.sub = sub;
        b.steps = beats * sub;
        b.stepSec = 60 / track.bpm / sub;
        b.start = (startBeat * 60) / track.bpm;
        b.end = ((startBeat + beats) * 60) / track.bpm;
        startBeat += beats;
        out.push_back(b);
    }
    return out;
}

// ---------- tags ----------

double clamp01(double x) { return std::min(1.0, std::max(0.0, x)); }

Params resolveTags(const Track& track, Rng& rng) {
    std::vector<std::string> selected; // a Set in insertion order
    for (const auto& [category, list] : track.tags)
        for (const auto& tag : list)
            if (std::find(selected.begin(), selected.end(), tag) == selected.end()) selected.push_back(tag);
    static const std::pair<const char*, const char*> OPPOSITES[] = {
        { "driving", "loose" }, { "calm", "bouncy" }, { "calm", "heavy" }, { "buildsSlowly", "fullFromStart" }, { "straight", "swing" } };
    for (const auto& [a, b] : OPPOSITES) {
        const auto ia = std::find(selected.begin(), selected.end(), a), ib = std::find(selected.begin(), selected.end(), b);
        if (ia != selected.end() && ib != selected.end()) selected.erase(rng.next() < 0.5 ? ia : ib);
    }
    Params p;
    for (const auto& tag : selected) {
        if (tag == "driving") p.drive += 0.3;
        else if (tag == "loose") p.drive += -0.3;
        else if (tag == "halftime") p.drive += -0.15;
        else if (tag == "dry") p.drive += 0.1;
        else if (tag == "heavy") p.drive += 0.2;
        else if (tag == "deepFat") p.bassLow += 0.3;
        else if (tag == "deepSynths") p.bassLow += 0.15;
        else if (tag == "bouncy") p.bassMovement += 0.3;
        else if (tag == "calm") p.bassMovement += -0.3;
        else if (tag == "arpeggio") p.arp = true;
        else if (tag == "widePad") p.padWidth += 0.3;
        else if (tag == "shimmering") p.padWidth += 0.2;
        else if (tag == "dreamy") p.padWidth += 0.2;
        else if (tag == "swing") p.swing += 0.5;
        else if (tag == "funky") { p.swing += 0.25; p.syncopation += 0.25; }
        else if (tag == "syncopated") p.syncopation += 0.3;
        else if (tag == "straight") { p.swing += -1; p.syncopation += -0.3; }
        else if (tag == "buildsSlowly") p.buildUp = "slow";
        else if (tag == "fullFromStart") p.buildUp = "instant";
    }
    p.drive = clamp01(p.drive);
    p.swing = clamp01(p.swing);
    p.syncopation = clamp01(p.syncopation);
    p.bassLow = clamp01(p.bassLow);
    p.bassMovement = clamp01(p.bassMovement);
    p.padWidth = clamp01(p.padWidth);
    return p;
}

Params driftParams(Params p, Rng& rng) {
    const auto spread = [&] { return (rng.next() * 2 - 1) * 0.12; };
    p.swing = clamp01(p.swing * (0.75 + 0.5 * rng.next()));
    p.syncopation = clamp01(p.syncopation + spread());
    p.bassMovement = clamp01(p.bassMovement + spread());
    return p;
}

Params applyComplexity(Params p, std::optional<double> complexity) {
    const double shift = complexity.value_or(0.5) - 0.5;
    p.drive = clamp01(p.drive + shift);
    p.bassMovement = clamp01(p.bassMovement + shift);
    p.syncopation = clamp01(p.syncopation + shift * 0.6);
    return p;
}

int levelOf(double value, const std::vector<double>& thresholds) {
    return static_cast<int>(std::count_if(thresholds.begin(), thresholds.end(), [&](double t) { return value >= t; }));
}

// ---------- arrangement ----------

// layers.js: lead plays where the chords play, percussion where the drums play (`follows`)
void setLayers(Section& sec, const std::vector<std::string>& on) {
    static const std::pair<const char*, const char*> FOLLOWS[] = {
        { "drums", "drums" }, { "bass", "bass" }, { "chords", "chords" }, { "pad", "pad" }, { "lead", "chords" }, { "percussion", "drums" } };
    for (const auto& [id, source] : FOLLOWS) sec.layers[id] = std::find(on.begin(), on.end(), source) != on.end();
}

// src/core/arrange.js: without a form, sections of 8 bars
std::vector<Section> buildArrangement(const Track& track, const Params& params, Rng& rng) {
    const int count = (track.length + 7) / 8;
    std::vector<std::string> slowOrder;
    if (params.buildUp == "slow") {
        slowOrder = { "bass", "drums", "chords", "pad" };
        if (rng.integer(0, 1) == 0) std::swap(slowOrder[2], slowOrder[3]); // shuffled(['chords', 'pad'])
    }
    std::vector<Section> out;
    for (int i = 0; i < count; ++i) {
        const bool isLast = i == count - 1;
        std::vector<std::string> on { "bass", "drums", "chords", "pad" };
        if (!isLast && params.buildUp == "slow") on.assign(slowOrder.begin(), slowOrder.begin() + std::min<size_t>(slowOrder.size(), static_cast<size_t>(i) + 2));
        else if (!isLast && params.buildUp != "instant") on = { "bass", "drums", "chords" };
        Section sec;
        sec.start = i * 8;
        sec.bars = std::min(8, track.length - sec.start);
        setLayers(sec, on);
        sec.fillAtEnd = !isLast;
        out.push_back(sec);
    }
    return out;
}

// src/core/form-types.js: TYPE_TABLE and resolveSection
Resolved resolveSection(const Part& part, double dynamics) {
    struct Row { std::vector<std::string> layers; double density[2], level[2]; const char* transition; bool crash; };
    static const std::map<std::string, Row> TYPE_TABLE {
        { "intro", { { "chords", "pad", "bass" }, { -0.25, -0.25 }, { -5, -5 }, "none", false } },
        { "verse", { { "bass", "drums", "chords" }, { -0.15, -0.15 }, { -3, -3 }, "fill", false } },
        { "build", { { "bass", "drums", "chords", "pad" }, { -0.1, 0.25 }, { -4, -1 }, "roll", false } },
        { "chorus", { { "drums", "bass", "chords", "pad" }, { 0.2, 0.2 }, { 0, 0 }, "fill", true } },
        { "bridge", { { "bass", "drums", "chords", "pad" }, { -0.05, -0.05 }, { -2, -2 }, "fill", false } },
        { "break", { { "pad", "chords" }, { -0.4, -0.4 }, { -7, -7 }, "stop", false } },
        { "outro", { { "bass", "chords", "pad", "drums" }, { -0.15, -0.3 }, { -4, -8 }, "none", false } },
    };
    const Row& row = TYPE_TABLE.at(part.type);
    const double factor = clamp(dynamics / 0.6, 0, 1.3 / 0.6);
    Resolved r;
    r.bars = part.bars;
    r.layers = row.layers;
    for (int k = 0; k < 2; ++k) {
        r.level[k] = part.level ? *part.level : clamp(0.0 + (row.level[k] - 0.0) * factor, -24, 0);
        r.density[k] = part.density ? *part.density : clamp(0.2 + (row.density[k] - 0.2) * factor, -1, 1);
    }
    r.transition = part.transition.value_or(row.transition);
    r.crash = part.crash.value_or(row.crash);
    return r;
}

double ramp(const double v[2], int bars, int i) { return bars > 1 ? v[0] + ((v[1] - v[0]) * clamp(i, 0, bars - 1)) / (bars - 1) : v[0]; }

std::vector<Section> buildFormArrangement(const Track& track) {
    std::vector<Resolved> resolved;
    for (const Part& p : track.parts) resolved.push_back(resolveSection(p, track.dynamics));
    std::vector<Section> out;
    int start = 0;
    for (size_t index = 0; index < track.parts.size(); ++index) {
        Section sec;
        sec.start = start;
        sec.bars = track.parts[index].bars;
        setLayers(sec, resolved[index].layers);
        sec.fillAtEnd = index + 1 < resolved.size() && resolved[index + 1].transition == "fill";
        sec.kind = track.parts[index].type;
        sec.index = static_cast<int>(index);
        sec.hasResolved = true;
        sec.resolved = resolved[index];
        start += sec.bars;
        out.push_back(sec);
    }
    return out;
}

Params withSection(Params p, const Resolved& resolved, int barInSection, double randomness) {
    const double d = densityAt(resolved, barInSection);
    const double r = (randomness - 0.5) * 0.4;
    p.drive = clamp(clamp(p.drive, 0.2, 0.75) + d, 0, 1);
    p.bassMovement = clamp(clamp(p.bassMovement, 0.25, 0.6) + d * 0.6, 0, 1);
    p.syncopation = clamp(p.syncopation + d * 0.4 + r, 0, 1);
    return p;
}

// ---------- players (src/core/events.js, event-helpers.js) ----------

template <typename T> std::vector<const T*> pool(const std::vector<T>& base, const std::vector<T>& extra, const Params& params) {
    std::vector<const T*> out;
    for (const T& item : base) out.push_back(&item);
    if (params.variety) for (const T& item : extra) out.push_back(&item);
    return out;
}

struct DrumVoicing {
    const DrumTier* tier = nullptr;
    const std::vector<int>* kicks[2] = { nullptr, nullptr };
    bool openHat = false;
    const Fill* fill = nullptr;
};

DrumVoicing drumSection(const Params& params, Rng& rng, const Groove& g, const Section& sec) {
    const int step = levelOf(params.drive, g.drumThresholds);
    DrumVoicing v;
    v.tier = &g.drumTiers[step];
    const auto kicks = pool(v.tier->kicks, g.extraKicks[step], params);
    v.kicks[0] = rng.pick(kicks);
    v.kicks[1] = rng.pick(kicks);
    const bool drawn = rng.next() < 0.5;
    // with a form the open hi-hat is fixed in the chorus and missing in verse, break and intro; the draw stays
    v.openHat = sec.kind == "chorus" ? true : sec.kind == "verse" || sec.kind == "break" || sec.kind == "intro" ? false : drawn;
    v.fill = rng.pick(pool(g.fills, g.extraFills, params));
    return v;
}

void playDrums(std::vector<Event>& events, const Bar& b, const DrumVoicing& v, Rng& rng, const Params& params, bool fill, const Groove& g) {
    const int fillStart = fill ? b.steps - b.sub * std::min(g.fillBeats, b.beats) : b.steps;
    std::set<int> kicks(v.kicks[b.index % 2]->begin(), v.kicks[b.index % 2]->end());
    if (rng.next() < 0.6 * params.syncopation) kicks.insert(rng.pick(g.offbeatKicks));
    struct Hit { int step; std::string name; double vel; };
    std::vector<Hit> hits;
    const auto has = [](const std::vector<int>& list, int p) { return std::find(list.begin(), list.end(), p) != list.end(); };
    for (int s = 0; s < b.steps; ++s) {
        const int p = s % g.cycle;
        const double hat = v.tier->hat[s % b.sub];
        if (s >= fillStart) { // under the fill the closed hi-hat keeps time
            if (hat > 0) hits.push_back({ s, "hat", hat });
            continue;
        }
        if (kicks.count(p)) hits.push_back({ s, "kick", 1 });
        if (has(v.tier->snare, p)) hits.push_back({ s, "snare", 0.9 });
        else if (has(v.tier->ghosts, p) && rng.next() < 0.6 * params.syncopation) hits.push_back({ s, "snare", 0.2 });
        if (hat > 0) hits.push_back(v.openHat && p == g.openHatStep ? Hit { s, "openHat", 0.5 } : Hit { s, "hat", hat });
    }
    if (fill) {
        const int from = g.fillBeats * b.sub - (b.steps - fillStart);
        const int length = static_cast<int>(v.fill->size()) - from;
        for (int k = 0; k < length; ++k) {
            const std::string& name = (*v.fill)[from + k];
            if (!name.empty()) hits.push_back({ fillStart + k, name, 0.7 + (0.25 * k) / (length - 1) });
        }
        hits.push_back({ fillStart, "kick", 0.9 });
        hits.push_back({ b.steps - 1, "kick", 0.9 });
    }
    for (const Hit& h : hits) {
        Event e;
        e.t = at(b, h.step, rng, params.swing);
        e.bar = b.index;
        e.beat = static_cast<double>(h.step) / b.sub;
        e.type = Event::Type::hit;
        e.layer = "drums";
        e.name = h.name;
        e.vel = humanVel(h.vel, rng);
        events.push_back(e);
    }
}

void playBass(std::vector<Event>& events, const Bar& b, const BassPattern& pattern, Rng& rng, const Params& params, const Groove& g) {
    const int BASS_MIN = 28, BASS_MAX = 52;
    const int lowest = BASS_MIN + static_cast<int>(jsRound((1 - params.bassLow) * 8));
    const auto inRange = [&](const std::string& name) { return lowest + (((noteToPc(name) - lowest) % 12) + 12) % 12; };
    const int root = inRange(b.chord.root), nextRoot = inRange(b.next.root);
    const bool up = rng.next() < 0.3 || nextRoot - 1 < BASS_MIN;
    const auto& [fifth, seventh] = CHORD_BASS.at(b.chord.quality);
    const auto degree = [&, fifth = fifth, seventh = seventh](const std::string& d) {
        const int m = d == "r" ? root : d == "5" ? root + fifth : d == "o" ? root + 12 : d == "b7" ? root + seventh
                                      : nextRoot == root ? root + 10 : up ? nextRoot + 1 : nextRoot - 1; // ap: approach to the next root
        return m > BASS_MAX ? m - 12 : m;
    };
    int apStep = b.steps;
    for (const BassStep& s : pattern) if (s.degree == "ap") { apStep = b.steps - g.cycle + s.step; break; }
    std::vector<BassStep> steps;
    for (const BassStep& s : pattern) {
        if (s.degree == "ap") steps.push_back({ apStep, s.degree, s.len });
        else for (int at = s.step; at < apStep; at += g.cycle) steps.push_back({ at, s.degree, s.len }); // shorter bars cut off, longer ones repeat
    }
    std::stable_sort(steps.begin(), steps.end(), [](const BassStep& x, const BassStep& y) { return x.step < y.step; });
    std::vector<double> times;
    for (const BassStep& s : steps) times.push_back(at(b, s.step, rng, params.swing));
    for (size_t k = 0; k < steps.size(); ++k) {
        Event e;
        e.t = times[k];
        e.bar = b.index;
        e.beat = static_cast<double>(steps[k].step) / b.sub;
        e.type = Event::Type::note;
        e.layer = "bass";
        e.midi = degree(steps[k].degree);
        e.vel = humanVel(0.95, rng);
        // one voice: a note ends at the latest where the next one really starts
        const double dur = std::min(steps[k].len * b.stepSec, (k + 1 < times.size() ? times[k + 1] : b.end) - times[k]);
        e.dur = r6(std::min(dur, b.end - e.t));
        events.push_back(e);
    }
}

struct ChordPattern { // one of the two is set
    const std::vector<int>* arp = nullptr;
    const std::vector<int>* stabs = nullptr;
};

ChordPattern chordsSection(const Params& params, Rng& rng, const Groove& g) {
    ChordPattern v;
    if (params.arp) v.arp = rng.pick(pool(g.arps, g.extraArps, params));
    else v.stabs = rng.pick(pool(g.stabs, g.extraStabs, params));
    return v;
}

void playChords(std::vector<Event>& events, const Bar& b, const ChordPattern& v, Rng& rng, const Params& params, const Groove& g) {
    const std::vector<int> tones = chordTones(b.chord, 3);
    const auto tone = [&](int step, double t, int midi, double vel, double dur) {
        Event e;
        e.t = t;
        e.bar = b.index;
        e.beat = static_cast<double>(step) / b.sub;
        e.type = Event::Type::note;
        e.layer = "chords";
        e.midi = midi;
        e.vel = vel;
        e.dur = r6(std::min(dur, b.end - t));
        return e;
    };
    if (v.arp) {
        // arpPool: the chord tones in a cycle over the octaves, one octave up
        const int n = static_cast<int>(tones.size());
        int notes[4];
        for (int i = 0; i < 4; ++i) notes[i] = tones[i % n] + 12 * (i / n) + 12;
        for (int s = 0; s < b.steps; s += g.arpStep) {
            const double t = at(b, s, rng, params.swing);
            const double vel = humanVel(s % b.sub ? 0.7 : 0.85, rng);
            events.push_back(tone(s, t, notes[(*v.arp)[(s / g.arpStep) % 8]], vel, g.arpStep * b.stepSec));
        }
        return;
    }
    const auto has = [](const std::vector<int>& list, int p) { return std::find(list.begin(), list.end(), p) != list.end(); };
    const double len = (params.drive < 0.35 ? 4 : 1.5) * b.stepSec * (b.sub / 4.0);
    for (int s = 0; s < b.steps; ++s) {
        const int p = s % g.cycle;
        if (!has(*v.stabs, p) && !(has(g.offbeatStabs, p) && rng.next() < 0.5 * params.syncopation)) continue;
        const double t = at(b, s, rng, params.swing);
        const double vel = humanVel(0.8, rng);
        // strum: place and count of the tone in the stab, so that the voice can choose the direction of the stroke
        for (size_t i = 0; i < tones.size(); ++i) {
            Event e = tone(s, t, tones[i], vel, len);
            e.strum = std::pair<int, int> { static_cast<int>(i), static_cast<int>(tones.size()) };
            events.push_back(e);
        }
    }
}

void playPad(std::vector<Event>& events, const Bar& b, Rng& rng, const Params& params) {
    std::vector<int> midis = chordTones(b.chord, 3);
    if (params.padWidth > 0.6) // a wide pad doubles the voicing an octave up
        for (size_t i = 0, n = midis.size(); i < n; ++i) midis.push_back(midis[i] + 12);
    const double t = r6(b.start);
    for (const int m : midis) {
        Event e;
        e.t = t;
        e.bar = b.index;
        e.beat = 0.0;
        e.type = Event::Type::note;
        e.layer = "pad";
        e.midi = m;
        e.vel = humanVel(0.6, rng);
        e.dur = r6(std::min(b.end - b.start, b.end - t));
        events.push_back(e);
    }
}

// ---------- song form on the finished stream (src/core/form-post.js) ----------

std::vector<Event> postProcess(std::vector<Event> out, const Track& track, const std::vector<Bar>& bars, const std::vector<Section>& sections, Rng rng) {
    static const std::map<std::string, double> PAUSE_FACTOR { { "verse", 0.6 }, { "chorus", 0.25 }, { "bridge", 0.25 }, { "intro", 0.5 }, { "outro", 0.5 }, { "build", 0 }, { "break", 0 } };
    static const std::vector<std::string> PAUSE_LAYERS { "chords", "pad", "lead", "percussion", "drums" };
    const double pauses = track.pauses;
    const auto transitionAfter = [&](const Section& sec) { return sec.index + 1 < static_cast<int>(sections.size()) ? sections[sec.index + 1].resolved.transition : std::string(); };
    const auto removable = [](const Event& e, const std::string& layer) {
        return e.layer == layer && isSound(e) && (layer != "drums" || !(e.name == "kick" || e.name == "hat" || e.name == "openHat")); // the drums never stop completely
    };
    std::map<int, std::string> paused;
    for (const Section& sec : sections) {
        for (int i = 3; i < sec.bars; i += 4) {
            if (i == sec.bars - 1 && (sec.fillAtEnd || transitionAfter(sec) == "stop")) continue;
            const auto factor = PAUSE_FACTOR.find(sec.kind);
            if (rng.next() >= pauses * (factor != PAUSE_FACTOR.end() ? factor->second : 0.0)) continue;
            const int bar = sec.start + i;
            std::vector<std::string> candidates;
            for (const auto& layer : PAUSE_LAYERS)
                if (std::any_of(out.begin(), out.end(), [&](const Event& e) { return e.bar == bar && removable(e, layer); })) candidates.push_back(layer);
            if (!candidates.empty()) paused[bar] = rng.pick(candidates);
        }
    }
    if (!paused.empty()) std::erase_if(out, [&](const Event& e) { const auto p = paused.find(e.bar); return p != paused.end() && removable(e, p->second); });

    for (const Section& sec : sections) {
        const int lastBar = sec.start + sec.bars - 1;
        const Bar& b = bars[lastBar];
        const std::string transition = transitionAfter(sec);
        if (transition == "roll" && track.layer("drums") && sec.plays("drums")) {
            const double half = b.beats / 2.0, unit = b.sub == 4 ? 2 : 1, mid = b.steps / 2.0;
            std::vector<double> steps;
            for (double s = mid; s < mid + (b.steps - mid) / 2; s += unit) steps.push_back(s);
            for (double s = mid + (b.steps - mid) / 2; s < b.steps; s += unit / 2) steps.push_back(s);
            std::erase_if(out, [&](const Event& e) { return e.bar == lastBar && isHit(e, "drums") && e.beat.value_or(0) >= half && e.name != "kick"; });
            for (size_t k = 0; k < steps.size(); ++k) {
                Event e;
                e.t = r6(std::min(b.start + steps[k] * b.stepSec, b.end - 0.001));
                e.bar = lastBar;
                e.beat = steps[k] / b.sub;
                e.type = Event::Type::hit;
                e.layer = "drums";
                e.name = "snare";
                e.vel = roundVel(0.45 + ((0.95 - 0.45) * static_cast<double>(k)) / static_cast<double>(steps.size() - 1));
                out.push_back(e);
            }
        }
        const int gap = std::min(pauses >= 0.6 ? 2 : 1, b.beats - 1);
        if (transition == "stop" && gap > 0) {
            const double from = b.end - (gap * 60) / track.bpm;
            std::vector<Event> kept;
            for (Event& e : out) {
                if (e.bar != lastBar || !isSound(e)) { kept.push_back(e); continue; }
                if (e.beat.value_or(0) >= b.beats - gap || e.t >= from - 0.01) continue;
                if (e.type == Event::Type::note && e.t + e.dur > from) e.dur = r6(from - e.t);
                kept.push_back(e);
            }
            out = std::move(kept);
        }
    }
    if (track.layer("drums")) {
        for (const Section& sec : sections) {
            if (!sec.resolved.crash || sec.start <= 0) continue;
            Event e;
            e.t = r6(bars[sec.start].start);
            e.bar = sec.start;
            e.beat = 0.0;
            e.type = Event::Type::hit;
            e.layer = "drums";
            e.name = "crash";
            e.vel = 0.9;
            out.push_back(e);
        }
    }
    std::map<int, double> gain;
    for (const Section& sec : sections)
        for (int i = 0; i < sec.bars; ++i) gain[sec.start + i] = std::pow(10.0, std::min(0.0, levelAt(sec.resolved, i)) / 20);
    const double crashFloor = std::pow(10.0, -3.0 / 20);
    for (Event& e : out)
        if (isSound(e)) e.vel = roundVel(e.vel * (e.name == "crash" ? std::max(gain[e.bar], crashFloor) : gain[e.bar]));
    sortByTime(out);
    return out;
}

// ---------- microtiming (src/core/microtiming.js) ----------

std::vector<Event> applyMicrotiming(std::vector<Event> out, const Track& track, const std::vector<Bar>& bars, Rng rng, double amount) {
    using Offsets = std::map<std::string, double>;
    static const Offsets STRAIGHT { { "snare", 5 }, { "ghost", 2 }, { "hat", -1 }, { "openHat", -1 }, { "bass", 3 }, { "chords", 2 } };
    static const Offsets FUNKY { { "snare", 3 }, { "ghost", 4 }, { "bass", 1 }, { "chords", -3 }, { "percussion", -2 } };
    static const Offsets SWING { { "snare", 9 }, { "ghost", 5 }, { "hat", -2 }, { "openHat", -2 }, { "bass", -3 }, { "chords", 4 } };
    static const std::map<std::string, std::string> DRUM_FALLBACK { { "sideStick", "snare" }, { "rimshot", "snare" }, { "ride", "hat" }, { "rideBell", "hat" }, { "hatHalf", "openHat" }, { "hatPedal", "hat" } };
    const Offsets& offsets = (!bars.empty() && bars[0].sub != 4) || track.tag("rhythm", "swing") ? SWING : track.tag("rhythm", "funky") ? FUNKY : STRAIGHT;
    const double pi = 3.141592653589793;
    struct Drift { double ms, p1, p2, f1, f2; };
    std::map<std::string, Drift> drifts; // every layer draws, playing or not: the order is fixed
    for (const auto& [layer, ms] : std::vector<std::pair<std::string, double>> { { "drums", 2 }, { "bass", 4 }, { "chords", 5 }, { "lead", 5 }, { "percussion", 4 } }) {
        Drift d;
        d.ms = ms;
        d.p1 = 7 + 4 * rng.next();
        d.p2 = 2.5 + 1.5 * rng.next();
        d.f1 = 2 * pi * rng.next();
        d.f2 = 2 * pi * rng.next();
        drifts[layer] = d;
    }
    for (Event& e : out) {
        if (!(amount > 0) || e.layer.empty() || !e.beat) continue;
        const Bar& b = bars[e.bar];
        std::string name = e.layer;
        if (e.layer == "drums") {
            const auto basic = DRUM_FALLBACK.find(e.name);
            name = e.name == "snare" && e.vel < 0.3 ? "ghost" : basic != DRUM_FALLBACK.end() ? basic->second : e.name;
        }
        const auto offset = offsets.find(name);
        const auto found = drifts.find(e.layer); // the pad has none
        const Drift d = found != drifts.end() ? found->second : Drift { 0, 1, 1, 0, 0 };
        const double drift = d.ms * (0.6 * std::sin((2 * pi * e.t) / d.p1 + d.f1) + 0.4 * std::sin((2 * pi * e.t) / d.p2 + d.f2));
        const double ms = amount * (1 * (offset != offsets.end() ? offset->second : 0.0) + 1 * drift);
        const double t = r6(std::min(b.end - 0.001, std::max(b.start, e.t + ms / 1000)));
        if (e.type == Event::Type::note) e.dur = r6(std::max(0.001, e.t + e.dur - t));
        e.t = t;
    }
    sortByTime(out);
    // one voice (bass, lead): no note sounds into the next
    for (const char* layer : { "bass", "lead" }) {
        Event* previous = nullptr;
        for (Event& e : out) {
            if (!isNote(e, layer)) continue;
            if (previous && previous->t + previous->dur > e.t) previous->dur = r6(std::max(0.0, e.t - previous->t));
            previous = &e;
        }
    }
    return out;
}

} // namespace

double densityAt(const Resolved& r, int barInSection) { return ramp(r.density, r.bars, barInSection); }
double levelAt(const Resolved& r, int barInSection) { return ramp(r.level, r.bars, barInSection); }

std::string grooveIdFor(const Track& track) {
    const std::string key = METERS.count(track.meter) ? track.meter : "4/4";
    const auto found = grooves().find(track.groove);
    if (found != grooves().end() && found->second.meter == key) return track.groove;
    return DEFAULT_GROOVE.at(key);
}

std::vector<std::pair<int, int>> phrasesOf(const Section& sec) {
    std::vector<std::pair<int, int>> out;
    for (int s = 0; s < sec.bars; s += 4) out.push_back({ sec.start + s, std::min(4, sec.bars - s) });
    return out;
}

int noteToPc(const std::string& name) {
    static const std::map<char, int> letters { { 'C', 0 }, { 'D', 2 }, { 'E', 4 }, { 'F', 5 }, { 'G', 7 }, { 'A', 9 }, { 'B', 11 } };
    const auto it = name.empty() ? letters.end() : letters.find(name[0]);
    if (it == letters.end()) throw std::runtime_error("Unknown note name: " + name);
    const int shift = name.size() > 1 ? (name[1] == '#' ? 1 : name[1] == 'b' ? -1 : 0) : 0;
    return (it->second + shift + 12) % 12;
}

// src/core/music.js, MODES: the steps of the mode from the key's root
std::vector<int> modePcs(const std::string& keyRoot, const std::string& keyMode) {
    static const std::map<std::string, std::vector<int>> STEPS {
        { "minor", { 0, 2, 3, 5, 7, 8, 10 } }, { "major", { 0, 2, 4, 5, 7, 9, 11 } }, { "dorian", { 0, 2, 3, 5, 7, 9, 10 } },
        { "phrygian", { 0, 1, 3, 5, 7, 8, 10 } }, { "lydian", { 0, 2, 4, 6, 7, 9, 11 } }, { "mixolydian", { 0, 2, 4, 5, 7, 9, 10 } },
    };
    const int root = noteToPc(keyRoot);
    std::vector<int> out;
    for (const int s : STEPS.at(keyMode)) out.push_back((root + s) % 12);
    return out;
}

double at(const Bar& b, int step, Rng& rng, double swing) {
    const double shift = b.sub == 4 && step % 2 ? (swing * b.stepSec) / 3 : 0;
    const double t = b.start + step * b.stepSec + shift + (rng.next() * 2 - 1) * 0.007 * b.jitterScale;
    return r6(clamp(t, b.start, b.end - 0.001));
}
double humanVel(double base, Rng& rng) { return roundVel(base * (0.94 + rng.next() * 0.12)); }

std::vector<int> chordTones(const Chord& chord, int octave) {
    static const std::map<std::string, std::vector<int>> INTERVALS { // src/core/chords.js
        { "maj", { 0, 4, 7 } }, { "min", { 0, 3, 7 } }, { "dim", { 0, 3, 6 } }, { "aug", { 0, 4, 8 } }, { "sus2", { 0, 2, 7 } }, { "sus4", { 0, 5, 7 } },
        { "power", { 0, 7 } }, { "dom7", { 0, 4, 7, 10 } }, { "maj7", { 0, 4, 7, 11 } }, { "min7", { 0, 3, 7, 10 } }, { "m7b5", { 0, 3, 6, 10 } },
        { "dim7", { 0, 3, 6, 9 } }, { "maj6", { 0, 4, 7, 9 } }, { "min6", { 0, 3, 7, 9 } }, { "add9", { 0, 4, 7, 14 } }, { "dom9", { 0, 4, 7, 10, 14 } },
        { "min9", { 0, 3, 7, 10, 14 } },
    };
    const int base = 12 * (octave + 1) + noteToPc(chord.root);
    std::vector<int> out;
    for (const int i : INTERVALS.at(chord.quality)) out.push_back(base + i);
    return out;
}

} // namespace detail

std::vector<Event> buildEvents(const std::string& trackJson) { return buildSong(trackJson).events; }

Song buildSong(const std::string& trackJson) {
    using namespace detail;
    const Track track = parseTrack(trackJson);

    const Rng master(track.seed);
    Rng tagRng = master.fork("tags");
    Params params = resolveTags(track, tagRng);
    if (track.variety) {
        Rng driftRng = master.fork("drift");
        params = driftParams(params, driftRng);
        params.variety = true;
    }
    params = applyComplexity(params, track.complexity);
    const Groove& g = grooves().at(grooveIdFor(track));
    Rng arrangementRng = master.fork("arrangement");
    const std::vector<Section> sections = track.hasForm ? buildFormArrangement(track) : buildArrangement(track, params, arrangementRng);
    std::vector<Bar> bars = barTimeline(track);
    // microtiming.js, timingOf: strength and tightness from the looseness knob
    const double loose = track.loose.value_or(0.5);
    const double amount = loose < 0.5 ? 3 * loose : 1.5 + 7 * (loose - 0.5);
    const double tight = loose < 0.5 ? 0.6 * loose : 0.3 + 1.4 * (loose - 0.5);
    for (Bar& b : bars) b.jitterScale = tight;

    std::vector<Event> events;
    for (const Bar& b : bars) {
        Event e;
        e.t = r6(b.start);
        e.bar = b.index;
        e.beat = 0.0;
        e.chordRoot = b.chord.root;
        e.chordQuality = b.chord.quality;
        events.push_back(e);
    }
    for (const Section& sec : sections) {
        const int last = sec.start + sec.bars - 1;
        Event e;
        e.type = Event::Type::marker;
        if (track.hasForm) {
            e.t = r6(bars[sec.start].start);
            e.bar = sec.start;
            e.beat = 0.0;
            e.name = "section";
            e.kind = sec.kind;
            e.index = sec.index;
            events.push_back(e);
        }
        if (sec.fillAtEnd) {
            Event fill;
            fill.type = Event::Type::marker;
            fill.t = r6(bars[last].start);
            fill.bar = last;
            fill.name = "fill";
            events.push_back(fill);
        }
    }

    // One random stream per layer, in the order of the layers (it decides the order of events at the same time).
    // With a form: per 4-bar phrase a new pattern with probability `randomness` (the coin has its own stream), and
    // whenever the density ramps. Lead and percussion follow another layer and have no coin: they keep their state
    // over the whole part.
    const auto run = [&](const std::string& layer, auto section, auto play) {
        if (!track.layer(layer)) return;
        Rng rng = master.fork(layer);
        Rng coin = master.fork("form:" + layer);
        const bool tossed = track.hasForm && layer != "lead" && layer != "percussion";
        for (const Section& sec : sections) {
            if (!sec.plays(layer)) continue;
            const int last = sec.start + sec.bars - 1;
            const auto paramsAt = [&](int i) { return track.hasForm ? withSection(params, sec.resolved, i - sec.start, track.randomness) : params; };
            decltype(section(params, rng, sec)) v {};
            double prevDensity = std::numeric_limits<double>::quiet_NaN();
            const auto phrases = track.hasForm ? phrasesOf(sec) : std::vector<std::pair<int, int>> { { sec.start, sec.bars } };
            for (const auto& [start, count] : phrases) {
                const double density = track.hasForm ? densityAt(sec.resolved, start - sec.start) : 0.0;
                const bool coinHit = start != sec.start && tossed && coin.next() < track.randomness;
                if (start == sec.start || coinHit || (tossed && density != prevDensity)) v = section(paramsAt(start), rng, sec);
                prevDensity = density;
                for (int i = start; i < start + count; ++i) play(bars[i], v, rng, paramsAt(i), sec.fillAtEnd && i == last);
            }
        }
    };
    run("drums",
        [&](const Params& p, Rng& rng, const Section& sec) { return drumSection(p, rng, g, sec); },
        [&](const Bar& b, const DrumVoicing& v, Rng& rng, const Params& p, bool fill) { playDrums(events, b, v, rng, p, fill, g); });
    run("bass",
        [&](const Params& p, Rng& rng, const Section&) {
            const int step = levelOf(p.bassMovement, g.bassThresholds);
            return rng.pick(pool(g.bassTiers[step], g.bassExtra[step], p));
        },
        [&](const Bar& b, const BassPattern* v, Rng& rng, const Params& p, bool) { playBass(events, b, *v, rng, p, g); });
    run("chords",
        [&](const Params& p, Rng& rng, const Section&) { return chordsSection(p, rng, g); },
        [&](const Bar& b, const ChordPattern& v, Rng& rng, const Params& p, bool) { playChords(events, b, v, rng, p, g); });
    run("pad",
        [](const Params&, Rng&, const Section&) { return 0; }, // the pad has no pattern to choose
        [&](const Bar& b, int, Rng& rng, const Params& p, bool) { playPad(events, b, rng, p); });
    run("lead",
        [](const Params&, Rng&, const Section& sec) { LeadState v; v.start = sec.start; v.bars = sec.bars; return v; },
        [&](const Bar& b, LeadState& v, Rng& rng, const Params& p, bool fill) { playLead(events, b, v, rng, p, fill, g.arpStep, track); });
    run("percussion",
        [](const Params&, Rng&, const Section&) { return 0; },
        [&](const Bar& b, int, Rng& rng, const Params& p, bool) { playPercussion(events, b, rng, p, track.jobs.at("percussion"), g.drumThresholds, g.cycle, g.drumTiers[1].snare); });

    sortByTime(events);
    if (track.hasForm) events = postProcess(std::move(events), track, bars, sections, master.fork("form"));
    events = articulate(events, track, bars, sections, params, master.fork("art"));
    Song song;
    song.events = applyMicrotiming(std::move(events), track, bars, master.fork("timing"), amount);
    song.bpm = track.bpm;
    song.seed = track.seed;
    for (const Bar& b : bars) song.barBeats.push_back(b.beats);
    return song;
}

} // namespace btg
