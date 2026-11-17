#pragma once

// Shared by generator.cpp and articulation.cpp. The code follows the JavaScript line by line on purpose:
// the event stream must come out the same, so the order of every random draw and of every floating-point
// operation is the web app's. Names of the JavaScript functions are kept.

#include "btg/generator.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace btg::detail {

// Math.round: halves go up, also below zero (std::round goes away from zero).
inline double jsRound(double x) { return std::floor(x + 0.5); }
inline double r6(double x) { return jsRound(x * 1e6) / 1e6; }
inline double clamp(double x, double lo, double hi) { return std::min(hi, std::max(lo, x)); }
inline double roundVel(double x) { return jsRound(clamp(x, 0.05, 1.0) * 1e3) / 1e3; }

// src/core/rng.js: mulberry32, forks by FNV-1a over "<seed>:<label>".
class Rng {
public:
    explicit Rng(uint32_t seed) : base_(seed), state_(seed) {}
    double next() {
        state_ += 0x6d2b79f5u;
        uint32_t t = state_;
        t = (t ^ (t >> 15)) * (t | 1u);
        t ^= t + (t ^ (t >> 7)) * (t | 61u);
        return static_cast<double>(t ^ (t >> 14)) / 4294967296.0;
    }
    int integer(int min, int max) { return min + static_cast<int>(std::floor(next() * (max - min + 1))); }
    template <typename T> const T& pick(const std::vector<T>& items) { return items[static_cast<size_t>(std::floor(next() * static_cast<double>(items.size())))]; }
    Rng fork(const std::string& label) const {
        uint32_t h = 0x811c9dc5u;
        for (const char c : std::to_string(base_) + ":" + label) {
            h ^= static_cast<unsigned char>(c);
            h *= 0x01000193u;
        }
        return Rng(h);
    }

private:
    uint32_t base_, state_;
};

struct Chord {
    std::string root, quality;
    bool operator==(const Chord&) const = default;
};

struct Part { // one part of the song form as given
    std::string type;
    int bars = 0;
    std::optional<double> level, density;
    std::optional<std::string> transition;
    std::optional<bool> crash;
};

struct Track {
    std::string keyRoot, keyMode;
    double bpm = 0.0;
    std::vector<std::pair<Chord, int>> bars; // chord, beats
    int length = 0;
    std::string meter;                        // "4/4"
    std::string groove;                       // empty = default of the meter
    std::optional<double> complexity, loose, ornaments;
    bool variety = false;
    std::vector<std::pair<std::string, std::vector<std::string>>> tags; // in the order given: it decides the order of sums
    std::map<std::string, bool> layers;
    uint32_t seed = 1;
    std::string bassVariant, drumsVoice;      // voices.bass.variant, voices.drums.id
    bool hasForm = false;
    std::vector<Part> parts;
    double dynamics = 0.6, pauses = 0.4, randomness = 0.5; // form.feel

    bool tag(const std::string& category, const std::string& name) const {
        for (const auto& [id, list] : tags) if (id == category) return std::find(list.begin(), list.end(), name) != list.end();
        return false;
    }
    bool layer(const std::string& id) const { const auto it = layers.find(id); return it != layers.end() && it->second; }
};

struct Bar { // src/core/timeline.js, barTimeline
    int index = 0;
    Chord chord, next;
    int beats = 0, sub = 0, steps = 0;
    double stepSec = 0.0, start = 0.0, end = 0.0, jitterScale = 1.0;
};

struct Resolved { // src/core/form-types.js, resolveSection
    int bars = 0;
    std::vector<std::string> layers;
    double density[2] = { 0.0, 0.0 }, level[2] = { 0.0, 0.0 };
    std::string transition;
    bool crash = false;
};

struct Section {
    int start = 0, bars = 0;
    bool drums = false, bass = false; // layers that play in it
    bool fillAtEnd = false;
    std::string kind;                 // type of the part, empty without a form
    int index = 0;
    bool hasResolved = false;
    Resolved resolved;
};

struct Params { // src/core/tags.js, resolveTags
    double drive = 0.5, swing = 0.0, syncopation = 0.5, bassLow = 0.5, bassMovement = 0.5, padWidth = 0.5;
    bool arp = false, variety = false;
    std::string buildUp = "normal";
};

inline int rank(const Event& e) { return e.type == Event::Type::chord ? 0 : e.type == Event::Type::marker ? 1 : 2; }
inline bool earlier(const Event& x, const Event& y) { return x.t < y.t || (x.t == y.t && rank(x) < rank(y)); }
// events.sort(byTime): JavaScript's sort is stable
inline void sortByTime(std::vector<Event>& events) { std::stable_sort(events.begin(), events.end(), earlier); }
inline void sortByTime(std::vector<Event*>& events) { std::stable_sort(events.begin(), events.end(), [](const Event* x, const Event* y) { return earlier(*x, *y); }); }

inline bool isSound(const Event& e) { return e.type == Event::Type::note || e.type == Event::Type::hit; }
inline bool isHit(const Event& e, const char* layer) { return e.type == Event::Type::hit && e.layer == layer; }
inline bool isNote(const Event& e, const char* layer) { return e.type == Event::Type::note && e.layer == layer; }

double densityAt(const Resolved& r, int barInSection);
double levelAt(const Resolved& r, int barInSection);
std::string grooveIdFor(const Track& track);
std::vector<std::pair<int, int>> phrasesOf(const Section& sec); // start, bars

std::vector<Event> articulate(const std::vector<Event>& events, const Track& track, const std::vector<Bar>& bars,
                              const std::vector<Section>& sections, const Params& params, const Rng& rng);

} // namespace btg::detail
