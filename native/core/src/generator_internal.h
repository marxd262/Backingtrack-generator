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

// Math.round: halves go up, also below zero (std::round goes away from zero). Not floor(x + 0.5): that sum rounds
// the largest number below 0.5 up to 1.
inline double jsRound(double x) {
    const double f = std::floor(x);
    return x - f >= 0.5 ? f + 1 : f;
}
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
    struct Voice { std::string id, variant; };
    std::map<std::string, Voice> voices;      // voices.<layer>: the rules ask which voice plays
    std::map<std::string, std::string> jobs;  // jobs.<layer>, for the layers that have jobs (lead, percussion)
    bool hasForm = false;
    std::vector<Part> parts;
    double dynamics = 0.6, pauses = 0.4, randomness = 0.5; // form.feel

    bool tag(const std::string& category, const std::string& name) const {
        for (const auto& [id, list] : tags) if (id == category) return std::find(list.begin(), list.end(), name) != list.end();
        return false;
    }
    bool layer(const std::string& id) const { const auto it = layers.find(id); return it != layers.end() && it->second; }
    const Voice& voice(const std::string& layer) const {
        static const Voice none;
        const auto it = voices.find(layer);
        return it != voices.end() ? it->second : none;
    }
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
    std::map<std::string, bool> layers; // which layers play in it
    bool plays(const std::string& layer) const { const auto it = layers.find(layer); return it != layers.end() && it->second; }
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
std::vector<int> chordTones(const Chord& chord, int octave);    // src/core/music.js: MIDI = 12 * (octave + 1) + pitch class + interval
int noteToPc(const std::string& name);
std::vector<int> modePcs(const std::string& keyRoot, const std::string& keyMode); // pitch classes of diatonicChords(key)

// src/core/event-helpers.js
double at(const Bar& b, int step, Rng& rng, double swing); // time of a grid step with swing and jitter; draws once
double humanVel(double base, Rng& rng);                    // loudness spread by 6 %; draws once

// src/core/lead.js
struct LeadState { // what the jobs remember over a part
    int start = 0, bars = 0;
    std::optional<int> last;     // where the line was last
    int callBar = -1;            // callResponse: the bar of the call (-1 = none) and its rhythm
    std::vector<int> callRhythm;
};
// `arpStep` is the groove's (chords.arpStep). The job comes from track.jobs; `off` writes nothing and draws nothing.
void playLead(std::vector<Event>& events, const Bar& b, LeadState& v, Rng& rng, const Params& params, bool fill, int arpStep, const Track& track);

// src/core/percussion.js. From the groove: the thresholds of the drums, the length of its cycle in steps, and the
// backbeat (the snare steps of the second drum level).
void playPercussion(std::vector<Event>& events, const Bar& b, Rng& rng, const Params& params, const std::string& job,
                    const std::vector<double>& drumThresholds, int cycle, const std::vector<int>& backbeat);

std::vector<Event> articulate(const std::vector<Event>& events, const Track& track, const std::vector<Bar>& bars,
                              const std::vector<Section>& sections, const Params& params, const Rng& rng);

} // namespace btg::detail
