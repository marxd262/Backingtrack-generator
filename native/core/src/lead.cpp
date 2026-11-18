// Port of src/core/lead.js: the lead voice. One job per track, played bar by bar. One voice, MIDI 72 to 88 (an octave
// above the chords), tones of the key's scale or of the bar's chord (the riff is the exception: low, with tones of
// the whole scale). See generator_internal.h for the rules of the port.
#include "articulation_internal.h"

#include <cstdlib>
#include <limits>
#include <set>

namespace btg::detail {
namespace {

const int LEAD_MIN = 72, LEAD_MAX = 88;
const int HOME = 79; // where the line rests (G5), the middle of the range; it is drawn back there gently

struct Tones { std::vector<int> chord, all; };

bool semitone(int a, int b) { return (a - b + 12) % 12 == 1 || (b - a + 12) % 12 == 1; }
int eighth(const Bar& b) { return b.sub == 4 ? 2 : 1; } // an eighth in the grid of sixteenths, a triplet eighth in the compound meters
int nearest(const std::vector<int>& list, double target) {
    int best = list[0];
    for (const int m : list) if (std::fabs(m - target) < std::fabs(best - target)) best = m;
    return best;
}
int indexOf(const std::vector<int>& list, int item) { return static_cast<int>(std::find(list.begin(), list.end(), item) - list.begin()); }

// LEAD_SCALE and SCALES: the scale of the lead per mode, as pitch classes
std::vector<int> leadScale(const Track& track) {
    static const std::map<std::string, std::vector<int>> SCALE_OF_MODE {
        { "minor", { 0, 3, 5, 7, 10 } }, { "major", { 0, 2, 4, 7, 9 } }, { "dorian", { 0, 2, 3, 5, 7, 9, 10 } },
        { "phrygian", { 0, 1, 3, 5, 7, 8, 10 } }, { "lydian", { 0, 2, 4, 6, 7, 9, 11 } }, { "mixolydian", { 0, 2, 4, 5, 7, 9, 10 } },
    };
    const int root = noteToPc(track.keyRoot);
    std::vector<int> out;
    for (const int i : SCALE_OF_MODE.at(track.keyMode)) out.push_back((root + i) % 12);
    return out;
}

// The tones of a bar within the range: chord tones and scale tones. A scale tone that is no chord tone and lies a
// semitone next to one is left out, so that long tones do not rub.
Tones tonesOf(const Bar& b, const std::vector<int>& scale) {
    std::vector<int> chord = chordTones(b.chord, 0);
    for (int& m : chord) m %= 12;
    const auto has = [](const std::vector<int>& list, int pc) { return std::find(list.begin(), list.end(), pc) != list.end(); };
    std::vector<int> ok = chord;
    for (const int pc : scale)
        if (std::none_of(chord.begin(), chord.end(), [&](int c) { return semitone(pc, c); })) ok.push_back(pc);
    Tones tones;
    for (int m = LEAD_MIN; m <= LEAD_MAX; ++m) {
        if (has(chord, m % 12)) tones.chord.push_back(m);
        if (has(ok, m % 12)) tones.all.push_back(m);
    }
    return tones;
}

// A line by steps over the tones from the one near `from`: mostly neighbours, seldom a leap over one, it turns at the edge
std::vector<int> walk(const std::vector<int>& pool, double from, int n, Rng& rng) {
    const int size = static_cast<int>(pool.size());
    int i = indexOf(pool, nearest(pool, from));
    int dir = rng.next() < 0.5 ? -1 : 1;
    std::vector<int> out;
    for (int k = 0; k < n; ++k) {
        out.push_back(pool[i]);
        if (rng.next() < 0.25) dir = -dir;
        const int leap = rng.next() < 0.2 ? 2 : 1;
        if (i + dir * leap < 0 || i + dir * leap >= size) dir = -dir;
        i = std::min(size - 1, std::max(0, i + dir * leap));
    }
    return out;
}

// Steps and tones -> notes. One voice: a note ends at the latest where the next one really starts.
void line(std::vector<Event>& events, const Bar& b, Rng& rng, const Params& params, const std::vector<int>& steps, const std::vector<int>& midis, double len, double base) {
    std::vector<double> times;
    for (const int s : steps) times.push_back(at(b, s, rng, params.swing));
    for (size_t k = 0; k < steps.size(); ++k) {
        Event e;
        e.t = times[k];
        e.bar = b.index;
        e.beat = static_cast<double>(steps[k]) / b.sub;
        e.type = Event::Type::note;
        e.layer = "lead";
        e.midi = midis[k];
        e.vel = humanVel(base * (steps[k] % b.sub ? 0.9 : 1), rng);
        const double dur = std::min(len, (k + 1 < times.size() ? times[k + 1] : b.end) - times[k]);
        e.dur = r6(std::min(dur, b.end - e.t));
        events.push_back(e);
    }
}

double loudness(const Params& params) { return 0.55 + 0.25 * params.drive; }

// Fill: a short phrase (2 to 5 tones) in the last one or two beats, a run into a chord tone. Only in the second half of
// a part's bars: always in the fill bar at its end, else not every time (more often with drive).
void fills(std::vector<Event>& events, const Bar& b, LeadState& v, Rng& rng, const Params& params, bool fill, const std::vector<int>& scale) {
    if (b.index - v.start < v.bars / 2.0 || (!fill && rng.next() >= 0.35 + 0.4 * params.drive)) return;
    const Tones tones = tonesOf(b, scale);
    const int span = std::min(b.beats, rng.next() < 0.3 + 0.4 * params.drive ? 2 : 1);
    const int grid = b.sub == 4 && rng.next() < 0.5 * params.syncopation ? 1 : eighth(b);
    std::vector<int> slots;
    for (int s = b.steps - span * b.sub; s < b.steps; s += grid) slots.push_back(s);
    const int wanted = 2 + rng.integer(0, 1 + static_cast<int>(jsRound(2 * params.drive)));
    std::vector<int> steps(slots.end() - std::min(static_cast<int>(slots.size()), wanted), slots.end());
    // The target is a chord tone near the last place; the run comes by steps from above (dir 1) or below. Where it does
    // not fit at the edge of the range it comes from the other side or gets shorter, so that no tone repeats.
    const int target = indexOf(tones.all, nearest(tones.chord, v.last.value_or(HOME)));
    const auto room = [&](int d) { return d > 0 ? static_cast<int>(tones.all.size()) - 1 - target : target; };
    int dir = rng.next() < 0.6 ? 1 : -1;
    if (room(dir) < static_cast<int>(steps.size()) - 1 && room(-dir) > room(dir)) dir = -dir;
    steps.erase(steps.begin(), steps.end() - std::min(static_cast<int>(steps.size()), room(dir) + 1));
    std::vector<int> midis;
    for (size_t k = 0; k < steps.size(); ++k) midis.push_back(tones.all[target + dir * (static_cast<int>(steps.size()) - 1 - static_cast<int>(k))]);
    v.last = midis.empty() ? std::optional<int>() : midis.back();
    line(events, b, rng, params, steps, midis, grid * b.stepSec * 0.9, loudness(params));
}

// Arpeggio: an even run up and down over four chord tones near the last place, in the groove's arpStep grid (calm: half as often)
void arpeggio(std::vector<Event>& events, const Bar& b, LeadState& v, Rng& rng, const Params& params, int arpStep, const std::vector<int>& scale) {
    const std::vector<int> tones = tonesOf(b, scale).chord;
    const int count = static_cast<int>(tones.size());
    const int rate = arpStep * (params.drive < 0.35 ? 2 : 1);
    const int width = std::min(4, count);
    const int lo = std::max(0, std::min(indexOf(tones, nearest(tones, v.last.value_or(HOME))) - 1, count - width));
    const bool down = rng.next() < 0.3;
    const int period = 2 * (width - 1);
    std::vector<int> steps, midis;
    for (int s = 0, k = 0; s < b.steps; s += rate, ++k) {
        const int p = k % period;
        const int idx = p < width ? p : period - p;
        steps.push_back(s);
        midis.push_back(tones[lo + (down ? width - 1 - idx : idx)]);
    }
    v.last = midis.empty() ? std::optional<int>() : midis.back();
    line(events, b, rng, params, steps, midis, rate * b.stepSec * 0.85, loudness(params) * 0.9);
}

// Melody: long tones, a chord tone on the one (near the last place), with drive more often a second tone at the middle
// of the bar (with syncopation an eighth early)
void melody(std::vector<Event>& events, const Bar& b, LeadState& v, Rng& rng, const Params& params, const std::vector<int>& scale) {
    const Tones tones = tonesOf(b, scale);
    const int prev = v.last.value_or(HOME);
    const double target = prev + (HOME - prev) * 0.5;
    std::vector<int> near = tones.chord;
    std::stable_sort(near.begin(), near.end(), [&](int x, int y) {
        const double dx = std::fabs(x - target), dy = std::fabs(y - target);
        return dx != dy ? dx < dy : x < y;
    });
    if (near.size() > 2) near.resize(2);
    std::vector<int> midis { rng.pick(near) }, steps { 0 };
    const int half = (b.beats / 2) * b.sub;
    if (half > 0 && rng.next() < 0.2 + 0.5 * params.drive) {
        steps.push_back(rng.next() < 0.6 * params.syncopation ? half - eighth(b) : half);
        const int n = 2 + rng.integer(0, 1);
        midis.push_back(walk(tones.all, midis[0], n, rng).back());
    }
    v.last = midis.back();
    line(events, b, rng, params, steps, midis, std::numeric_limits<double>::infinity(), loudness(params));
}

// The rhythm of a call: 2 to 4 eighths in the first half of the bar, with syncopation begun on the "and", a gap in it
std::vector<int> phrase(const Bar& b, Rng& rng, const Params& params) {
    std::vector<int> slots;
    for (int s = 0; s < std::max(1, (b.beats + 1) / 2) * b.sub; s += eighth(b)) slots.push_back(s);
    const int n = 2 + rng.integer(0, 1 + static_cast<int>(jsRound(params.drive)));
    const int from = rng.next() < 0.6 * params.syncopation ? 1 : 0;
    const int size = static_cast<int>(slots.size());
    std::vector<int> pick(slots.begin() + std::min(from, size), slots.begin() + std::min(from + n + 1, size));
    if (static_cast<int>(pick.size()) > n) pick.erase(pick.begin() + rng.integer(1, static_cast<int>(pick.size()) - 1));
    return pick.empty() ? std::vector<int> { 0 } : pick;
}

// Call and response: the call in the even bar, the answer in the odd one with the same rhythm, ending on a chord tone.
// Where the call is missing (the part begins in an odd bar), the answer plays a rhythm of its own.
void callResponse(std::vector<Event>& events, const Bar& b, LeadState& v, Rng& rng, const Params& params, const std::vector<int>& scale) {
    const Tones tones = tonesOf(b, scale);
    const bool answer = b.index % 2 == 1;
    std::vector<int> heard;
    if (answer && v.callBar == b.index - 1)
        for (const int s : v.callRhythm) if (s < b.steps) heard.push_back(s);
    const std::vector<int> steps = !heard.empty() ? heard : phrase(b, rng, params);
    std::vector<int> midis = walk(tones.all, v.last.value_or(HOME), static_cast<int>(steps.size()), rng);
    if (answer) midis.back() = nearest(tones.chord, midis.back());
    else {
        v.callBar = b.index;
        v.callRhythm = steps;
    }
    v.last = midis.back();
    line(events, b, rng, params, steps, midis, b.sub * b.stepSec, loudness(params) * (answer ? 0.92 : 1));
}

// Riff: a boogie line on the low strings, one voice: two eighths per beat (long-short in the triplet grid), first the
// root, then above it fifth, sixth, seventh, sixth. Sixth and seventh come from the key's scale, in the blues (shuffle)
// always the major sixth and the minor seventh. MIDI 45 to 67, below the rest of the lead.
void riff(std::vector<Event>& events, const Bar& b, Rng& rng, const Params& params, const Track& track) {
    const std::vector<int> tones = chordTones(b.chord, 0);
    const int pc = tones[0] % 12, low = 45 + ((pc - 9 + 12) % 12); // the root between A2 and G#3
    const std::vector<int> scale = modePcs(track.keyRoot, track.keyMode);
    const std::string profile = profileOf(track);
    const bool blues = profile == "shuffle" || profile == "slowBlues";
    const auto has = [&](int semi) { return blues || std::find(scale.begin(), scale.end(), (pc + semi) % 12) != scale.end(); };
    const int sixth = has(9) ? 9 : 8;
    int fifth = 7;
    for (const int m : tones) {
        const int d = m - tones[0];
        if (d >= 6 && d <= 8) { fifth = d; break; }
    }
    const int upper[4] = { fifth, sixth, has(10) ? 10 : 11, sixth };
    std::vector<int> steps, midis;
    for (int beat = 0; beat < b.beats; ++beat) {
        steps.push_back(beat * b.sub);
        steps.push_back(beat * b.sub + 2);
        midis.push_back(low);
        midis.push_back(low + upper[beat % 4]);
    }
    // 0.6 of the other jobs' stroke: the riff plays throughout and low; at full stroke it alone was as loud as the rest of the band
    line(events, b, rng, params, steps, midis, 2 * b.stepSec, 0.6 * loudness(params));
}

} // namespace

void playLead(std::vector<Event>& events, const Bar& b, LeadState& v, Rng& rng, const Params& params, bool fill, int arpStep, const Track& track) {
    const auto found = track.jobs.find("lead");
    const std::string job = found != track.jobs.end() ? found->second : std::string();
    if (job != "fills" && job != "arpeggio" && job != "melody" && job != "callResponse" && job != "riff") return;
    const std::vector<int> scale = leadScale(track);
    if (job == "fills") fills(events, b, v, rng, params, fill, scale);
    else if (job == "arpeggio") arpeggio(events, b, v, rng, params, arpStep, scale);
    else if (job == "melody") melody(events, b, v, rng, params, scale);
    else if (job == "callResponse") callResponse(events, b, v, rng, params, scale);
    else riff(events, b, rng, params, track);
}

} // namespace btg::detail
