// Port of src/core/percussion.js: the percussion. One job per track, played bar by bar behind the drums (every stroke
// below 0.8). The patterns follow the groove's grid (beats, steps per beat 3 or 4); how dense they are follows drive
// and syncopation over the same thresholds as the drums. See generator_internal.h for the rules of the port.
#include "generator_internal.h"

namespace btg::detail {
namespace {

struct Row { int step; const char* name; double vel; int from; }; // step in a pattern of two beats, stroke, from which level

// Patterns over two beats, then repeated; the first for 4 steps per beat, the second for 3
const std::vector<Row> CONGAS[2] = {
    { { 0, "congaLow", 0.5, 0 }, { 3, "congaHigh", 0.45, 1 }, { 4, "congaHigh", 0.55, 0 }, { 6, "congaLow", 0.6, 0 }, { 7, "congaHigh", 0.45, 2 } }, // tumbao
    { { 0, "congaLow", 0.5, 0 }, { 2, "congaHigh", 0.45, 1 }, { 3, "congaHigh", 0.55, 0 }, { 4, "congaLow", 0.6, 0 }, { 5, "congaHigh", 0.4, 2 } },
};
const std::vector<Row> BONGOS[2] = {
    { { 0, "bongoLow", 0.5, 0 }, { 2, "bongoHigh", 0.4, 1 }, { 4, "bongoLow", 0.55, 0 }, { 6, "bongoHigh", 0.45, 0 }, { 7, "bongoHigh", 0.4, 2 } }, // martillo
    { { 0, "bongoLow", 0.5, 0 }, { 2, "bongoHigh", 0.4, 1 }, { 3, "bongoLow", 0.55, 0 }, { 4, "bongoHigh", 0.45, 0 }, { 5, "bongoHigh", 0.4, 2 } },
};
const int SON_CLAVE[] = { 0, 3, 6, 10, 12 }; // 3-2 son clave in 16 steps, scaled to the groove's cycle

struct Player {
    std::vector<Event>& events;
    const Bar& b;
    Rng& rng;
    const Params& params;
    const std::vector<double>& thresholds;
    int cycle;
    const std::vector<int>& backbeat;

    void hit(int s, const char* name, double vel) {
        Event e;
        e.t = at(b, s, rng, params.swing);
        e.bar = b.index;
        e.beat = static_cast<double>(s) / b.sub;
        e.type = Event::Type::hit;
        e.layer = "percussion";
        e.name = name;
        e.vel = humanVel(vel, rng);
        events.push_back(e);
    }
    // level 0 to 2: drive carries it, syncopation lifts it a little
    int level() const {
        const double value = 0.7 * params.drive + 0.3 * params.syncopation;
        return static_cast<int>(std::count_if(thresholds.begin(), thresholds.end(), [&](double t) { return value >= t; }));
    }
    // a pattern from the table over the whole bar, repeated every two beats
    void table(const std::vector<Row> rows[2]) {
        const int lvl = level(), period = 2 * b.sub;
        for (int s = 0; s < b.steps; ++s)
            for (const Row& row : rows[b.sub == 4 ? 0 : 1])
                if (s % period == row.step && lvl >= row.from) hit(s, row.name, row.vel);
    }
    // every step of the grid, the accent on the beat, louder with drive
    void shaker() {
        const double gain = 0.8 + 0.4 * params.drive;
        for (int s = 0; s < b.steps; ++s) hit(s, "shaker", (s % b.sub == 0 ? 0.5 : s % 2 ? 0.28 : 0.36) * gain);
    }
    // on the backbeat steps (the snare of the second level), from level 1 the eighths in between too
    void tambourine() {
        const int lvl = level(), weak = static_cast<int>(jsRound(b.sub / 2.0));
        for (int s = 0; s < b.steps; ++s) {
            if (std::find(backbeat.begin(), backbeat.end(), s % cycle) != backbeat.end()) hit(s, "tambourine", 0.62);
            else if (lvl >= 1 && s % b.sub == weak) hit(s, "tambourine", 0.3);
        }
    }
    // the son clave scaled to the cycle; level 0 plays the three strokes of the first side, every level one more
    void claves() {
        std::vector<int> steps; // a Set: no step twice, in the order given
        for (const int x : SON_CLAVE) {
            const int s = static_cast<int>(jsRound((x * cycle) / 16.0));
            if (std::find(steps.begin(), steps.end(), s) == steps.end()) steps.push_back(s);
        }
        steps.resize(std::min(steps.size(), static_cast<size_t>(3 + level())));
        for (int s = 0; s < b.steps; ++s)
            if (std::find(steps.begin(), steps.end(), s % cycle) != steps.end()) hit(s, "claves", 0.6);
    }
    // on the beats (level 0 only on every second one), on level 2 the eighths in between too
    void cowbell() {
        const int lvl = level(), weak = static_cast<int>(jsRound(b.sub / 2.0));
        for (int s = 0; s < b.steps; ++s) {
            const int beat = s / b.sub;
            if (s % b.sub == 0 && (lvl >= 1 || beat % 2 == 0)) hit(s, "cowbell", beat % 2 ? 0.45 : 0.55);
            else if (lvl >= 2 && s % b.sub == weak) hit(s, "cowbell", 0.3);
        }
    }
};

} // namespace

void playPercussion(std::vector<Event>& events, const Bar& b, Rng& rng, const Params& params, const std::string& job,
                    const std::vector<double>& drumThresholds, int cycle, const std::vector<int>& backbeat) {
    Player p { events, b, rng, params, drumThresholds, cycle, backbeat };
    if (job == "mixed") {
        p.shaker();
        p.tambourine();
        p.table(CONGAS);
    } else if (job == "shaker") p.shaker();
    else if (job == "tambourine") p.tambourine();
    else if (job == "congas") p.table(CONGAS);
    else if (job == "bongos") p.table(BONGOS);
    else if (job == "claves") p.claves();
    else if (job == "cowbell") p.cowbell();
}

} // namespace btg::detail
