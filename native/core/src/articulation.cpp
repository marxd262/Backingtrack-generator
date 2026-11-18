// Port of src/core/articulation.js (tag port-base): the rule groups drums, bass, drumsB and bassB with the
// band rules. The groups for chords, keys, pad and lead follow with their layers.
#include "generator_internal.h"

#include <cstdlib>
#include <deque>
#include <limits>
#include <set>

namespace btg::detail {
namespace {

struct Context { // per bar, see barContexts in the JavaScript
    std::string kind;
    int phrase = 0, inPhrase = 0, rep = 0;
    bool first = false, phraseStart = false, phraseEnd = false, verse = false, stop = false, fill = false, roll = false, change = false, nextChange = false;
    double energy = 0.0;
};

std::vector<Context> barContexts(const std::vector<Bar>& bars, const std::vector<Section>& sections, const Params& params) {
    std::vector<Context> ctx(bars.size());
    std::map<std::string, int> seen;
    for (size_t k = 0; k < sections.size(); ++k) {
        const Section& sec = sections[k];
        const int rep = seen[sec.kind]++; // without a form every section counts as the same kind
        const int last = sec.start + sec.bars - 1;
        const std::string after = k + 1 < sections.size() && sections[k + 1].hasResolved ? sections[k + 1].resolved.transition : std::string();
        int phrase = 0;
        for (const auto& [start, count] : phrasesOf(sec)) {
            for (int i = start; i < start + count; ++i) {
                Context c;
                c.energy = sec.hasResolved ? clamp(0.5 + densityAt(sec.resolved, i - sec.start), 0, 1) : params.drive;
                c.kind = sec.kind;
                c.phrase = phrase;
                c.inPhrase = i - start;
                c.rep = rep;
                c.first = i == sec.start;
                c.phraseStart = i == start;
                c.phraseEnd = i == start + count - 1;
                c.verse = !sec.kind.empty() ? sec.kind != "chorus" : c.energy < 0.45;
                c.stop = after == "stop" && i == last;
                c.fill = sec.fillAtEnd && i == last;
                c.roll = after == "roll" && i == last;
                c.change = i > 0 && !(bars[i].chord == bars[i - 1].chord);
                c.nextChange = i + 1 < static_cast<int>(bars.size()) && !(bars[i].next == bars[i].chord);
                ctx[i] = c;
            }
            ++phrase;
        }
    }
    return ctx;
}

std::string profileOf(const Track& track) {
    const std::string groove = grooveIdFor(track);
    if (groove == "slowBlues") return "slowBlues";
    if (groove == "shuffle") return "shuffle";
    if (groove == "latin") return "latin";
    if (groove == "ballad68" || groove == "waltz") return "ballad";
    if (track.tag("rhythm", "swing")) return "shuffle";
    if (track.tag("rhythm", "funky")) return "funk";
    if (track.tag("drums", "halftime") && track.tag("rhythm", "syncopated")) return "reggae";
    if (track.tag("drums", "halftime") || track.tag("mood", "dreamy")) return "ballad";
    if (track.tag("chordSound", "ringing") && track.tag("bassSound", "plucky") && track.tag("rhythm", "straight")) return "country";
    return "rock";
}

// Values per style profile; 0 = the rule does not apply (in the JavaScript: the entry is missing).
struct BassProfile { const char* hold; double dead, slideIn, approach; bool chromatic; };
struct BassBProfile { double slideOff, palmMute, octavePop, hammer; };
struct DrumProfile { const char* stick; bool rimshot, swap; };

BassProfile bassProfile(const std::string& p) {
    if (p == "shuffle") return { "legato", 0, 0.25, 0.4, true };
    if (p == "slowBlues") return { "legato", 0, 0.3, 0, true };
    if (p == "rock") return { "", 0.05, 0.15, 0, false };
    if (p == "funk") return { "staccato", 0.35, 0.15, 0, false };
    if (p == "ballad") return { "legato", 0, 0.1, 0, false };
    if (p == "reggae") return { "legato", 0, 0.15, 0, false };
    if (p == "latin") return { "legato", 0, 0, 0, false };
    return { "", 0, 0.1, 0.4, false }; // country
}
BassBProfile bassBProfile(const std::string& p) {
    if (p == "shuffle") return { 0.2, 0, 0, 0.2 };
    if (p == "slowBlues") return { 0.2, 0, 0, 0 };
    if (p == "rock") return { 0.3, 0.5, 0, 0 };
    if (p == "funk") return { 0, 0, 0.3, 0.2 };
    return { 0, 0, 0, 0 };
}
DrumProfile drumProfile(const std::string& p) {
    if (p == "shuffle" || p == "slowBlues") return { "quiet", false, true };
    if (p == "rock") return { "", true, false };
    if (p == "ballad") return { "verse", true, true };
    if (p == "reggae" || p == "latin" || p == "country") return { "always", false, true };
    return { "", false, true }; // funk
}

// What the rules share (env in the JavaScript). The events live in `store`; `out` is the stream the rules
// change, append to and delete from, as references like the JavaScript objects.
struct Env {
    const Track& track;
    const std::vector<Bar>& bars;
    const Params& params;
    const Rng& rng;
    std::vector<Context> ctx;
    std::string profile;
    double tempo, factor;
    std::deque<Event> store;
    std::vector<Event*> out;

    // probability of a rule after knob and tempo; rules that make the style (from 0.8) are not scaled
    double p(double base) const { return base >= 0.8 ? base : std::min(0.9, base * factor * tempo * 1.0); }
    // planRoll: a number 0..1 fixed per kind of part, phrase and bar of the phrase; a repeat redraws with 0.3
    double roll(const Context& c, const char* layer, const char* name, int slot = 0) const {
        const std::string key = c.kind + ":" + std::to_string(c.phrase) + ":" + std::to_string(c.inPhrase) + ":" + layer + ":" + name + ":" + std::to_string(slot);
        const bool again = c.rep > 0 && rng.fork(key + ":v" + std::to_string(c.rep)).next() < 0.3;
        return rng.fork(again ? key + ":r" + std::to_string(c.rep) : key).next();
    }
    // time of a grid step with swing, without randomness
    double slotTime(const Bar& b, int s) const { return r6(b.start + s * b.stepSec + (b.sub == 4 && s % 2 ? (params.swing * b.stepSec) / 3 : 0)); }
    int stepOf(const Event& e) const { return static_cast<int>(jsRound(*e.beat * bars[e.bar].sub)); }
    Event* add(const Event& e) { store.push_back(e); out.push_back(&store.back()); return out.back(); }
    std::vector<Event*> notes(const char* layer) const {
        std::vector<Event*> list;
        for (Event* e : out) if (isNote(*e, layer)) list.push_back(e);
        sortByTime(list);
        return list;
    }
};

Event hit(const Env& env, const Bar& b, int s, const char* name, double vel) {
    Event e;
    e.t = env.slotTime(b, s);
    e.bar = b.index;
    e.beat = static_cast<double>(s) / b.sub;
    e.type = Event::Type::hit;
    e.layer = "drums";
    e.name = name;
    e.vel = vel;
    return e;
}

void drumRules(Env& env) {
    const DrumProfile P = drumProfile(env.profile);
    std::vector<std::pair<int, std::vector<Event*>>> byBar; // a Map in insertion order
    const auto hitsOf = [&](int bar) -> std::vector<Event*>* {
        for (auto& [index, hits] : byBar) if (index == bar) return &hits;
        return nullptr;
    };
    for (Event* e : env.out) {
        if (!isHit(*e, "drums")) continue;
        if (!hitsOf(e->bar)) byBar.push_back({ e->bar, {} });
        hitsOf(e->bar)->push_back(e);
    }
    const auto add = [&](const Bar& b, int s, const char* name, double vel) { hitsOf(b.index)->push_back(env.add(hit(env, b, s, name, vel))); };
    for (size_t k = 0; k < byBar.size(); ++k) {
        const int index = byBar[k].first;
        const Bar& b = env.bars[index];
        const Context& c = env.ctx[index];
        const std::vector<Event*> hits = byBar[k].second; // the hits of the bar as they are now
        std::vector<Event*> hats;
        for (Event* e : hits) if (e->name == "hat") hats.push_back(e);
        // accent pattern of the hi-hat in the sixteenth grid, as a factor on the loudest hit of the bar
        if (b.sub == 4 && !hats.empty()) {
            double top = hats[0]->vel;
            bool sixteenths = false;
            for (Event* e : hats) { top = std::max(top, e->vel); sixteenths = sixteenths || env.stepOf(*e) % 2; }
            for (Event* e : hats) {
                const int s = env.stepOf(*e);
                e->vel = roundVel(top * (s % 4 == 0 ? 1 : s % 2 ? 0.6 : sixteenths ? 0.8 : 0.7) * (0.94 + 0.12 * env.roll(c, "drums", "hat", s)));
            }
        }
        for (Event* e : hits) {
            if (e->name != "snare") continue;
            if (e->vel < 0.3) { e->vel = roundVel(0.15 + 0.14 * env.roll(c, "drums", "ghost", env.stepOf(*e))); continue; } // ghost note
            if ((c.fill && *e->beat >= b.beats - 2) || (c.roll && *e->beat >= b.beats / 2.0)) continue; // fill and roll stay on the snare
            const std::string stick = P.stick;
            if (stick == "always" || (stick == "verse" && c.verse) || (stick == "quiet" && c.energy < 0.4)) e->name = "sideStick";
            else if (P.rimshot && !c.verse) e->name = "rimshot";
        }
        // chorus (only with a form): ride instead of the closed hi-hat, the foot closes it on 2 and 4
        if (c.kind == "chorus" && !hats.empty() && P.swap) {
            for (Event* e : hats) e->name = "ride";
            for (int beat = 1; beat < b.beats; beat += 2) add(b, beat * b.sub, "hatPedal", 0.35);
        }
        // before a stop: crash on the last hit before the silence, choked after 50 to 150 ms (sample kits only)
        if (c.stop && env.track.voice("drums").id == "sample") {
            const std::vector<Event*>& now = *hitsOf(index);
            Event* last = now[0];
            for (Event* e : now) if (e->t > last->t) last = e;
            Event crash = *last;
            crash.name = "crash";
            crash.vel = 0.8;
            crash.art = "choke";
            crash.artTime = r6(0.05 + 0.1 * env.roll(c, "drums", "crashChoke"));
            hitsOf(index)->push_back(env.add(crash));
        }
    }
    // open hi-hat: closes on the next beat; where no closed one stands, the foot closes it (not into a stop)
    for (size_t k = 0; k < byBar.size(); ++k) {
        const int index = byBar[k].first;
        const Bar& b = env.bars[index];
        const std::vector<Event*> hits = byBar[k].second;
        for (Event* e : hits) {
            if (e->name != "openHat") continue;
            const int s = (env.stepOf(*e) / b.sub + 1) * b.sub;
            const bool here = s < b.steps;
            if (!here && index + 1 >= static_cast<int>(env.bars.size())) continue;
            const Bar& at = here ? b : env.bars[index + 1];
            const int step = here ? s : 0;
            const std::vector<Event*>* there = hitsOf(at.index);
            if (!there || env.ctx[index].stop) continue;
            bool closed = false;
            for (Event* x : *there) closed = closed || ((x->name == "hat" || x->name == "hatPedal") && static_cast<int>(jsRound(*x->beat * at.sub)) == step);
            if (!closed) add(at, step, "hatPedal", 0.3);
        }
    }
}

void bassRules(Env& env) {
    const std::string& variant = env.track.voice("bass").variant;
    const BassProfile P = bassProfile(env.profile);
    if (variant == "upright") return; // the double bass has rules of its own
    const auto& bars = env.bars;
    const auto& ctx = env.ctx;
    const auto note = [&](const Bar& b, int s) {
        Event e;
        e.t = env.slotTime(b, s);
        e.bar = b.index;
        e.beat = static_cast<double>(s) / b.sub;
        e.type = Event::Type::note;
        e.layer = "bass";
        return e;
    };
    std::set<int> playing; // bars in which the bass plays
    for (Event* n : env.notes("bass")) playing.insert(n->bar);
    std::vector<double> kicks; // band rule 1: slides only where a kick is
    for (Event* e : env.out) if (e->layer == "drums" && e->name == "kick") kicks.push_back(e->t);

    // approach: before a chord change, on the last eighth, a tone one step below or above the first note of the next bar
    if (P.approach > 0) {
        static const std::map<std::string, std::vector<int>> MODES { { "minor", { 0, 2, 3, 5, 7, 8, 10 } }, { "major", { 0, 2, 4, 5, 7, 9, 11 } }, { "dorian", { 0, 2, 3, 5, 7, 9, 10 } },
            { "phrygian", { 0, 1, 3, 5, 7, 8, 10 } }, { "lydian", { 0, 2, 4, 6, 7, 9, 11 } }, { "mixolydian", { 0, 2, 4, 5, 7, 9, 10 } } };
        static const std::map<char, int> letters { { 'C', 0 }, { 'D', 2 }, { 'E', 4 }, { 'F', 5 }, { 'G', 7 }, { 'A', 9 }, { 'B', 11 } };
        const std::string& key = env.track.keyRoot;
        const int root = (letters.at(key[0]) + (key.size() > 1 ? (key[1] == '#' ? 1 : -1) : 0) + 12) % 12;
        std::set<int> scale;
        for (int step : MODES.at(env.track.keyMode)) scale.insert((root + step) % 12);
        std::map<int, Event*> first;
        for (Event* n : env.notes("bass")) if (env.stepOf(*n) == 0) first[n->bar] = n;
        for (const Bar& b : bars) {
            const Context& c = ctx[b.index];
            const auto found = first.find(b.index + 1);
            const int s = b.steps - (b.sub == 4 ? 2 : 1);
            if (!c.nextChange || c.stop || c.fill || found == first.end() || !playing.count(b.index) || !(env.roll(c, "bass", "approach") < env.p(P.approach))) continue;
            const Event& target = *found->second;
            const int dir = target.midi > 50 || (target.midi >= 30 && env.roll(c, "bass", "approachDir") < 0.6) ? -1 : 1;
            int midi = target.midi + dir;
            if (!P.chromatic) while (!scale.count(((midi % 12) + 12) % 12)) midi += dir;
            std::erase_if(env.out, [&](Event* e) { return isNote(*e, "bass") && e->bar == b.index && env.stepOf(*e) >= s; });
            Event e = note(b, s);
            e.midi = midi;
            e.vel = target.vel;
            e.dur = r6(b.end - env.slotTime(b, s));
            e.art = "approach";
            env.add(e);
        }
    }

    // dead: on a free weak sixteenth right before a note, a dead note on its pitch
    if (P.dead > 0) {
        const std::vector<Event*> list = env.notes("bass");
        for (size_t i = 0; i < list.size(); ++i) {
            const Event& n = *list[i];
            const Bar& b = bars[n.bar];
            const int s = env.stepOf(n);
            if (b.sub != 4 || s % 2 || !n.art.empty()) continue;
            if (s == 0 && n.bar == 0) continue;
            const Bar& at = s > 0 ? b : bars[n.bar - 1];
            const int slot = s > 0 ? s - 1 : at.steps - 1;
            if (at.sub != 4 || !playing.count(at.index) || (at.index != b.index && ctx[at.index].stop) || (ctx[at.index].fill && slot >= at.steps - 2 * at.sub)) continue;
            const Context& c = ctx[at.index];
            const Event* prev = i > 0 ? list[i - 1] : nullptr;
            if ((prev && prev->bar == at.index && env.stepOf(*prev) >= slot) || !(env.roll(c, "bass", "dead", slot) < env.p(P.dead))) continue;
            Event e = note(at, slot);
            e.midi = n.midi;
            e.vel = roundVel(0.3 + 0.2 * env.roll(c, "bass", "deadVel", slot));
            e.dur = r6(0.03 + 0.03 * env.roll(c, "bass", "deadDur", slot));
            e.art = "dead";
            env.add(e);
        }
    }

    const std::vector<Event*> list = env.notes("bass");
    for (size_t i = 0; i < list.size(); ++i) {
        Event& n = *list[i];
        if (n.art == "dead") continue;
        const Bar& b = bars[n.bar];
        const Context& c = ctx[n.bar];
        const Event* next = i + 1 < list.size() ? list[i + 1] : nullptr;
        // length: the profile's way of holding (rock is short only with a pick); the last note before a stop is always short
        const std::string hold = c.stop && (!next || next->bar != n.bar) ? "staccato" : *P.hold ? P.hold : env.profile == "rock" && variant == "pick" ? "staccato" : "";
        if (hold == "staccato") {
            n.dur = r6(std::max(0.03, n.dur * (0.3 + 0.3 * env.roll(c, "bass", "staccato"))));
            if (n.art.empty()) n.art = "staccato";
        }
        if (hold == "legato") {
            n.dur = r6(std::max(n.dur, std::min(next ? next->t : std::numeric_limits<double>::infinity(), b.end) - n.t));
            if (n.art.empty()) n.art = "legato";
        }
        // slideIn: on the one at a chord change or the start of a phrase or part, from below, not into the silence of a stop.
        // Band rules: into the one of the chorus always (6); else not after a fill (2) and only where a kick is (1)
        const bool intoChorus = c.first && c.kind == "chorus";
        const bool afterFill = n.bar > 0 && ctx[n.bar - 1].fill, afterStop = n.bar > 0 && ctx[n.bar - 1].stop;
        const bool fits = intoChorus || (!afterFill && std::any_of(kicks.begin(), kicks.end(), [&](double t) { return std::fabs(t - n.t) <= b.stepSec + 1e-6; }));
        if ((P.slideIn > 0 || intoChorus) && env.stepOf(n) == 0 && n.art != "approach" && (c.change || c.phraseStart || c.first) && !afterStop && fits
            && (intoChorus || env.roll(c, "bass", "slideIn") < env.p(P.slideIn))) {
            const double r = env.roll(c, "bass", "slideSemi"); // mostly 1 or 2 semitones, rarely a long slide over 5 to 7
            n.art = "slideIn";
            n.artSemi = r < 0.1 ? -5 - std::floor(r * 30) : r < 0.55 ? -1 : -2;
            n.artTime = r6(clamp((0.04 + 0.06 * env.roll(c, "bass", "slideTime")) * env.tempo, 0.04, std::min(0.1, 15 / env.track.bpm)));
        }
    }
}

// flam: a quiet grace hit of the same name 15 to 30 ms before, in the fill and rarely on the backbeat, never in the roll
void drumRulesB(Env& env) {
    std::vector<Event*> hits;
    for (Event* e : env.out) if (isHit(*e, "drums")) hits.push_back(e);
    for (Event* e : hits) {
        const Bar& b = env.bars[e->bar];
        const Context& c = env.ctx[e->bar];
        const int s = env.stepOf(*e);
        const bool inFill = c.fill && *e->beat >= b.beats - 2;
        const bool body = (e->name == "snare" || e->name == "tomHigh" || e->name == "tomMid" || e->name == "tomLow" || e->name == "rimshot") && e->vel >= 0.3;
        const double d = 0.015 + 0.015 * env.roll(c, "drumsB", "flamTime", s);
        if (!body || e->t - d < b.start || (c.roll && *e->beat >= b.beats / 2.0) || !(env.roll(c, "drumsB", "flam", s) < env.p(inFill ? 0.25 : 0.08))) continue;
        Event flam = *e;
        flam.t = r6(e->t - d);
        flam.beat = *e->beat - d / (b.stepSec * b.sub);
        flam.vel = roundVel(0.4 * e->vel);
        flam.art = "flam";
        env.add(flam);
    }
}

void bassRulesB(Env& env) {
    const BassBProfile P = bassBProfile(env.profile);
    const double beat = 60 / env.track.bpm;
    if (env.track.voice("bass").variant == "upright") return;
    const std::vector<Event*> notes = env.notes("bass");
    for (size_t i = 0; i < notes.size(); ++i) {
        Event& n = *notes[i];
        if (n.art == "dead" || n.art == "approach" || n.art == "slideIn") continue;
        const Bar& b = env.bars[n.bar];
        const Context& c = env.ctx[n.bar];
        const int s = env.stepOf(n);
        Event* prev = i > 0 ? notes[i - 1] : nullptr;
        const Event* next = i + 1 < notes.size() ? notes[i + 1] : nullptr;
        const bool ends = (c.stop && (!next || next->bar != n.bar)) || !next || (c.phraseEnd && next->t - (n.t + n.dur) >= beat);
        const double room = b.end - n.t - 0.005; // the tone ends in the bar
        if (P.slideOff > 0 && ends && room >= 0.1 && env.roll(c, "bassB", "slideOff", s) < env.p(P.slideOff)) {
            const double time = r6(std::min(room, clamp((0.1 + 0.15 * env.roll(c, "bassB", "slideOffTime", s)) * env.tempo, 0.1, 0.25)));
            n.art = "slideOff";
            n.artSemi = -3 - std::floor(5 * env.roll(c, "bassB", "slideOffSemi", s));
            n.artTime = time;
            n.dur = r6(std::min(room, std::max(n.dur, time)));
        } else if (P.palmMute > 0 && c.verse && env.roll(c, "bassB", "palmMute") < env.p(P.palmMute)) {
            n.art = "palmMute";
        } else if (P.octavePop > 0 && b.sub == 4 && s % 4 >= 2 && n.midi <= 40 && env.roll(c, "bassB", "octavePop", s) < env.p(P.octavePop)) {
            n.art = "octavePop";
            n.midi += 12;
            n.vel = roundVel(n.vel * 1.1);
        }
        const int step = prev ? n.midi - prev->midi : 0;
        if (P.hammer > 0 && prev && prev->bar == n.bar && prev->art != "dead" && std::abs(step) >= 1 && std::abs(step) <= 2
            && (n.art.empty() || n.art == "staccato" || n.art == "legato") && (c.fill || c.energy >= 0.6) && env.roll(c, "bassB", "hammer", s) < env.p(P.hammer)) {
            n.art = step > 0 ? "hammer" : "pull";
            n.vel = roundVel(n.vel * 0.8);
            prev->dur = r6(std::max(prev->dur, n.t - prev->t)); // tied: the tone before holds until here
        }
    }
}

// Pad and strings: voice leading, and a swell at the start of a part (in a ballad at every chord change).
void padRules(Env& env) {
    std::map<int, std::vector<Event*>> byBar; // in the order of the stream
    for (Event* e : env.out) if (isNote(*e, "pad")) byBar[e->bar].push_back(e);
    std::vector<int> prev; // where the basic voices lay in the bar before
    int prevBar = -2;
    for (auto& [index, notes] : byBar) {
        const Context& c = env.ctx[index];
        const size_t n = chordTones(env.bars[index].chord, 3).size(), base = std::min(n, notes.size());
        // every chord tone takes the octave nearest to a tone of the chord before (shared tones stay), within 48..72;
        // the doubling of a wide pad follows. After a gap the voicing starts anew
        if (prevBar == index - 1) {
            for (size_t k = 0; k < base; ++k) {
                Event& e = *notes[k];
                int best = e.midi, dist = std::numeric_limits<int>::max();
                for (const int m : prev) {
                    const int d = ((((e.midi - m) % 12) + 18) % 12) - 6;
                    if (std::abs(d) < dist) { dist = std::abs(d); best = m + d; }
                }
                while (best < 48) best += 12;
                while (best > 72) best -= 12;
                e.midi = best;
                if (n + k < notes.size()) notes[n + k]->midi = best + 12;
            }
        }
        prev.clear();
        for (size_t k = 0; k < base; ++k) prev.push_back(notes[k]->midi);
        prevBar = index;
        // swell: 0.3 to 1.5 s, at most half the note
        if (c.first || (env.profile == "ballad" && c.change)) {
            const double time = clamp((0.3 + 1.2 * env.roll(c, "pad", "swell")) * env.tempo, 0.3, 1.5);
            for (Event* e : notes) {
                e->art = "swell";
                e->artTime = r6(std::min(time, e->dur / 2));
            }
        }
    }
}

} // namespace

std::vector<Event> articulate(const std::vector<Event>& events, const Track& track, const std::vector<Bar>& bars,
                              const std::vector<Section>& sections, const Params& params, const Rng& rng) {
    const double amount = track.ornaments.value_or(0.5);
    if (!(amount > 0)) return events;
    Env env { track, bars, params, rng, barContexts(bars, sections, params), profileOf(track),
              clamp(110 / track.bpm, 0.5, 1.2),                      // rule 7: fast = fewer and shorter
              amount <= 0.5 ? 2 * amount : 1 + 6 * (amount - 0.5),   // ornamentFactor
              {}, {} };
    for (const Event& e : events) env.add(e);
    // the order of the groups is the order of RULES in the JavaScript
    if (track.layer("drums")) drumRules(env);
    if (track.layer("bass")) bassRules(env);
    if (track.layer("pad")) padRules(env);
    if (track.layer("drums")) drumRulesB(env);
    if (track.layer("bass")) bassRulesB(env);
    sortByTime(env.out);
    std::vector<Event> out;
    for (const Event* e : env.out) out.push_back(*e);
    return out;
}

} // namespace btg::detail
