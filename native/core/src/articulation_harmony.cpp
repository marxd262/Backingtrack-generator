// Port of src/core/articulation.js: the rule groups of the chord layer: chords (rhythm guitar), keys and keysB
// (electric piano).
#include "articulation_internal.h"

#include <cstdlib>
#include <limits>
#include <set>

namespace btg::detail {
namespace {

// A JavaScript Map from a step to the tones of the stab there: the keys keep the order in which they were set.
struct Stabs {
    std::vector<int> keys;
    std::map<int, std::vector<Event*>> tones;

    bool has(int s) const { return tones.count(s) != 0; }
    std::vector<Event*>& at(int s) { return tones.at(s); }
    void add(int s, Event* e) {
        if (!has(s)) keys.push_back(s);
        tones[s].push_back(e);
    }
    void set(int s, std::vector<Event*> list) {
        if (!has(s)) keys.push_back(s);
        tones[s] = std::move(list);
    }
    void erase(int s) {
        tones.erase(s);
        keys.erase(std::find(keys.begin(), keys.end(), s));
    }
    std::vector<int> sorted() const {
        std::vector<int> out;
        for (const auto& entry : tones) out.push_back(entry.first);
        return out;
    }
};

// Guitar per style profile; 0, false or -1 = the entry is missing in the JavaScript.
// palmMute [verse, chorus], chuck (free sixteenths), backbeatChuck (on 2 and 4 in the chorus), choke (from 0.8 every
// stab, else on the beats), ring (every stab rings out), ringAccent (the one of the chorus rings out), arpRing,
// strumUp (a fixed way of strumming).
struct GuitarProfile {
    bool hasPalmMute = false;
    double palmMute[2] = { 0, 0 };
    double chuck = 0, backbeatChuck = 0, choke = 0;
    bool ring = false, ringAccent = false, arpRing = false;
    int strumUp = -1;
};

GuitarProfile guitarProfile(const std::string& p) {
    GuitarProfile P;
    if (p == "slowBlues") { P.ring = true; P.arpRing = true; }
    else if (p == "rock") { P.hasPalmMute = true; P.palmMute[0] = 0.7; P.palmMute[1] = 0.1; P.ringAccent = true; }
    else if (p == "funk") { P.chuck = 0.8; P.choke = 0.6; P.strumUp = 2; }
    else if (p == "ballad") { P.ring = true; P.arpRing = true; P.backbeatChuck = 0.3; }
    else if (p == "reggae") P.choke = 1;
    return P; // shuffle, latin, country: nothing
}

} // namespace

// Rhythm guitar, sample guitars only (keys have their own rules). Per bar: the direction of the strum by profile
// and way of playing, chucks, then at most one articulation per stab, first of chuck, choke, letRing, palmMute.
void chordRules(Env& env) {
    static const std::set<std::string> GUITARS { "guitar", "muted", "jazz", "funk", "steel", "nylon", "twelve", "freepats", "freepatsjazz" };
    const Track& track = env.track;
    const Track::Voice& voice = track.voice("chords");
    if (voice.id != "sample" || !GUITARS.count(voice.variant)) return;
    const GuitarProfile P = guitarProfile(env.profile);
    const bool power = std::any_of(track.bars.begin(), track.bars.end(), [](const std::pair<Chord, int>& bar) { return bar.first.quality == "power"; });
    const bool psych = track.tag("mood", "psychedelic");
    const double sixteenth = 15 / track.bpm, infinity = std::numeric_limits<double>::infinity();

    std::map<int, Stabs> stabs; // bar -> stabs; the stream is sorted, so the bars come in ascending order as in the JavaScript Map
    std::set<int> playing;      // bars in which the guitar plays
    for (Event* e : env.out) {
        if (!isNote(*e, "chords")) continue;
        const Bar& b = env.bars[e->bar];
        const Context& c = env.ctx[e->bar];
        const int s = env.stepOf(*e);
        playing.insert(e->bar);
        if (e->strum) stabs[e->bar].add(s, e);
        // picked tones ring on to the end of the bar (ballad, psych, quiet verse); a stop stays silent
        else if ((P.arpRing || psych || (c.verse && c.energy < 0.45)) && !c.stop) {
            e->ring = true;
            e->dur = r6(std::max(e->dur, b.end - e->t));
        }
    }
    for (auto& entry : stabs) {
        const int index = entry.first;
        Stabs& bySteps = entry.second;
        const Bar& b = env.bars[index];
        const Context& c = env.ctx[index];
        // band rule 2 (only one fills): under the drum fill (the last two beats) the guitar is silent, the last stab before rings out
        const double fillFrom = c.fill ? b.steps - 2 * b.sub : infinity;
        const std::vector<int> before = bySteps.sorted();
        for (size_t k = 1; k < before.size(); ++k) {
            const int s = before[k];
            if (s < fillFrom) continue;
            for (Event* e : bySteps.at(s)) env.out.erase(std::find(env.out.begin(), env.out.end(), e));
            bySteps.erase(s);
        }
        const std::vector<int> written = bySteps.keys;
        // direction: funk down-up-up-up (2); else with sixteenths the beat and the "and" down, e and a up (1), with
        // eighths the beat down, the "and" up (2); rock from 160 bpm downstrokes only (0)
        const bool odd = std::any_of(written.begin(), written.end(), [](int s) { return s % 2 != 0; });
        const int mode = P.strumUp >= 0 ? P.strumUp : env.profile == "rock" && track.bpm >= 160 ? 0 : b.sub == 4 && odd ? 1 : 2;
        const auto isUp = [&](int s) { return mode == 2 || b.sub != 4 ? mode > 0 && s % b.sub != 0 : mode == 1 && s % 2 == 1; };
        const double base = bySteps.at(written[0])[0]->vel;
        const auto chuck = [&](int s) {
            const std::vector<int> all = chordTones(b.chord, 3);
            std::vector<Event*> list;
            for (size_t i = 0; i < all.size(); ++i) {
                Event e;
                e.t = env.slotTime(b, s);
                e.bar = index;
                e.beat = static_cast<double>(s) / b.sub;
                e.type = Event::Type::note;
                e.layer = "chords";
                e.midi = all[i];
                e.vel = roundVel(0.5 * base);
                e.dur = 0.03;
                e.art = "chuck";
                e.strum = std::pair<int, int> { static_cast<int>(i), static_cast<int>(all.size()) };
                list.push_back(env.add(e));
            }
            bySteps.set(s, std::move(list));
        };
        // chuck in funk: a muted stroke on the free sixteenths (the hand keeps swinging), not into the silence of a stop
        if (P.chuck > 0 && b.sub == 4)
            for (int s = 0; s < b.steps; ++s)
                if (!bySteps.has(s) && s < fillFrom && !(c.stop && s >= b.steps - 2 * b.sub) && env.roll(c, "chords", "chuck", s) < env.p(P.chuck)) chuck(s);
        // chuck in the pop chorus: on 2 and 4, replaces a stab there
        std::vector<int> backbeat;
        if (P.backbeatChuck > 0 && !c.verse && !c.stop && b.beats == 4)
            for (const int s : { b.sub, 3 * b.sub })
                if (env.roll(c, "chords", "backbeat", s) < env.p(P.backbeatChuck)) backbeat.push_back(s);
        for (const int s : backbeat) if (!bySteps.has(s) && s < fillFrom) chuck(s);
        // palmMute: the whole bar muted (rock: often in the verse, seldom in the chorus; power chords more often)
        const bool muted = P.hasPalmMute && env.roll(c, "chords", "palmMute") < env.p(c.verse ? (power ? 0.8 : P.palmMute[0]) : P.palmMute[1]);
        const std::vector<int> order = bySteps.sorted();
        for (size_t k = 0; k < order.size(); ++k) {
            const int s = order[k];
            const std::vector<Event*>& stab = bySteps.at(s);
            const bool last = k + 1 == order.size(), onBeat = s % b.sub == 0;
            const double until = last ? b.end : bySteps.at(order[k + 1])[0]->t;
            std::string art = stab[0]->art;
            if (art.empty() && last && fillFrom < infinity) art = "letRing";
            else if (art.empty() && std::find(backbeat.begin(), backbeat.end(), s) != backbeat.end()) {
                art = "chuck";
                for (Event* e : stab) {
                    e->vel = roundVel(0.5 * e->vel);
                    e->dur = 0.03;
                }
            }
            // choke: the last stab before a stop; reggae always (from 0.8), funk on the beats
            else if (art.empty() && ((c.stop && last) || (P.choke > 0 && (P.choke >= 0.8 || onBeat) && env.roll(c, "chords", "choke", s) < env.p(P.choke)))) art = "choke";
            // letRing: by profile (ballad, slow blues), the last stab before a rest or the end, the accent on the one of the chorus (rock)
            else if (art.empty() && (P.ring || (last && !playing.count(index + 1)) || (P.ringAccent && !c.verse && s == 0))) art = "letRing";
            else if (art.empty() && muted) art = "palmMute";
            for (Event* e : stab) {
                e->strumUp = mode;
                if (isUp(s)) e->vel = roundVel(e->vel * 0.85); // an upstroke is quieter
                if (!art.empty()) e->art = art;
                if (art == "choke") e->dur = r6(std::min(e->dur, sixteenth));
                if (art == "letRing") {
                    e->ring = true;
                    if (!c.stop) e->dur = r6(std::max(e->dur, until - e->t));
                }
            }
            // a chuck mutes the strings: what sounds before it ends there
            if (art == "chuck" && k > 0)
                for (Event* e : bySteps.at(order[k - 1])) e->dur = r6(std::min(e->dur, std::max(0.001, stab[0]->t - e->t)));
        }
    }
}

namespace {

bool playsElectricPiano(const Track& track) {
    const Track::Voice& voice = track.voice("chords");
    return voice.id == "epiano" || (voice.id == "sample" && voice.variant == "epiano");
}

} // namespace

// Keys, the electric piano only (sample and FM; the organ has rules of its own): weighting of the voices, pedal, staccato.
void keyRules(Env& env) {
    const Track& track = env.track;
    if (!playsElectricPiano(track)) return;
    // KEY_PROFILES: pedal (probability per bar), staccato (short stabs)
    const std::string& profile = env.profile;
    const double pedal = profile == "ballad" ? 1 : profile == "rock" || profile == "shuffle" || profile == "slowBlues" ? 0.5 : 0;
    const bool staccato = profile == "funk";
    std::map<int, double> lastT; // the last stroke of every bar (for the stop)
    for (const Event* e : env.out) {
        if (!isNote(*e, "chords")) continue;
        const auto found = lastT.find(e->bar);
        lastT[e->bar] = std::max(found != lastT.end() ? found->second : 0.0, e->t);
    }
    for (Event* e : env.out) {
        if (!isNote(*e, "chords")) continue;
        const Bar& b = env.bars[e->bar];
        const Context& c = env.ctx[e->bar];
        // weighting in the stab: the top tone (melody) 10 % louder, the middle voices 10 % quieter
        if (e->strum && e->strum->second > 2) e->vel = roundVel(e->vel * (e->strum->first == e->strum->second - 1 ? 1.1 : e->strum->first > 0 ? 0.9 : 1));
        // before a stop everybody plays short (band rule 3): the last stroke a sixteenth at most
        if (c.stop && e->t >= lastT.at(e->bar) - 1e-6) {
            e->art = "staccato";
            e->dur = r6(std::min(e->dur, 15 / track.bpm));
            continue;
        }
        // pedal (per bar, from the plan): the tone holds to the end of the bar; where the chord changes there, the pedal
        // lifts 20 to 50 ms before. A stop stays silent
        if (pedal > 0 && !c.stop && env.roll(c, "keys", "pedal") < env.p(pedal)) {
            const double lift = c.nextChange ? 0.02 + 0.03 * env.roll(c, "keys", "lift") : 0;
            e->art = "pedal";
            e->dur = r6(std::max(0.02, b.end - lift - e->t));
        } else if (staccato && e->strum) { // short stabs, a sixteenth to an eighth
            e->art = "staccato";
            e->dur = r6(std::min(e->dur, (15 / track.bpm) * (1 + env.roll(c, "keys", "staccato"))));
        }
    }
}

// Lead (saxophone, flute, guitar): at most one articulation per note, first of fall (end of a phrase, saxophone only),
// bend (guitar only, long notes: the tone is pulled up from the scale step below), vibrato (long notes), scoop (start
// of a phrase or an accented note; on the guitar a slide of 1 or 2 semitones), hammer and pull (guitar only: a tone 1
// to 3 semitones next to the one before in the same bar, without a gap and without a stroke).
// A phrase is notes without a gap of a beat.
void leadRules(Env& env) {
    const Track& track = env.track;
    const std::vector<Event*> notes = env.notes("lead");
    const double beat = 60 / track.bpm;
    const Track::Voice& voice = track.voice("lead");
    const bool sax = voice.variant == "sax", guitar = voice.id == "sample" && voice.variant == "guitar";
    const std::vector<int> pcs = modePcs(track.keyRoot, track.keyMode);
    const std::set<int> scale(pcs.begin(), pcs.end());
    // The times of bend and vibrato come from the rhythm, never from a fixed number: a share of the note's length,
    // rounded to whole grid steps, at least one, at most a beat. So the target arrives on a place of the grid.
    const auto gridTime = [&](const Event& n, double share, double max) {
        const Bar& b = env.bars[n.bar];
        return r6(std::min(max, clamp(jsRound((share * n.dur) / b.stepSec), 1, b.sub) * b.stepSec));
    };
    for (size_t i = 0; i < notes.size(); ++i) {
        Event& n = *notes[i];
        const Context& c = env.ctx[n.bar];
        const int s = env.stepOf(n);
        Event* prev = i > 0 ? notes[i - 1] : nullptr;
        const Event* next = i + 1 < notes.size() ? notes[i + 1] : nullptr;
        const bool starts = !prev || n.t - (prev->t + prev->dur) >= beat, ends = !next || next->t - (n.t + n.dur) >= beat;
        if (sax && ends && n.dur >= 0.3 && env.roll(c, "lead", "fall", s) < env.p(0.25)) {
            n.art = "fall";
            n.artSemi = -2 - std::floor(4 * env.roll(c, "lead", "fallSemi", s));
            n.artTime = r6(clamp((0.15 + 0.15 * env.roll(c, "lead", "fallTime", s)) * env.tempo, 0.15, 0.3));
        } else if (guitar && n.dur >= beat && env.roll(c, "lead", "bend", s) < env.p(0.3)) {
            n.art = "bend";
            n.artSemi = scale.count((n.midi - 2) % 12) ? -2 : -1;
            n.artTime = gridTime(n, 0.15 + 0.15 * env.roll(c, "lead", "bendTime", s), 0.6); // 15 to 30 % of the note
        } else if (n.dur >= beat && env.roll(c, "lead", "vibrato", s) < env.p(0.6)) {
            n.art = "vibrato";
            n.artSemi = r6(0.1 + 0.1 * env.roll(c, "lead", "vibratoDepth", s));
            n.artTime = gridTime(n, 0.25 + 0.15 * env.roll(c, "lead", "vibratoStart", s), 0.8);
            n.artRate = r6(clamp(4 + (track.bpm - 60) / 40, 4, 5.5)); // the vibrato follows the tempo
        } else if ((starts || n.vel >= 0.85) && env.roll(c, "lead", "scoop", s) < env.p(0.3)) {
            const double artTime = r6(clamp((0.05 + 0.05 * env.roll(c, "lead", "scoopTime", s)) * env.tempo, 0.05, 0.1));
            const double x = env.roll(c, "lead", "scoopSemi", s);
            n.art = guitar ? "slideIn" : "scoop";
            n.artSemi = guitar ? (x < 0.5 ? -1 : -2) : r6(-0.5 - 0.5 * x);
            n.artTime = artTime;
        } else if (guitar && prev && prev->bar == n.bar && n.t - (prev->t + prev->dur) < env.bars[n.bar].stepSec && std::abs(n.midi - prev->midi) >= 1
                   && std::abs(n.midi - prev->midi) <= 3 && env.roll(c, "lead", "hammer", s) < env.p(0.4)) {
            n.art = n.midi > prev->midi ? "hammer" : "pull";
            n.vel = roundVel(n.vel * 0.85);
            prev->dur = r6(std::max(prev->dur, n.t - prev->t)); // tied: the tone before holds until here
        }
    }
}

// Keys, second group: rolled chords in the ballad, a crushed third in the blues, a barked stab in funk.
void keyRulesB(Env& env) {
    if (!playsElectricPiano(env.track)) return;
    const std::string& profile = env.profile;
    struct Stab { int bar, step; std::vector<Event*> tones; };
    std::vector<Stab> stabs; // a Map "bar:step" -> tones, in the order the stabs come in the stream
    for (Event* e : env.out) {
        if (!isNote(*e, "chords") || !e->strum) continue;
        const int step = env.stepOf(*e);
        auto found = std::find_if(stabs.begin(), stabs.end(), [&](const Stab& stab) { return stab.bar == e->bar && stab.step == step; });
        if (found == stabs.end()) found = stabs.insert(stabs.end(), Stab { e->bar, step, {} });
        found->tones.push_back(e);
    }
    double lastT = -std::numeric_limits<double>::infinity();
    for (const Stab& stab : stabs) lastT = std::max(lastT, stab.tones[0]->t);
    for (const Stab& stab : stabs) {
        const Bar& b = env.bars[stab.bar];
        const Context& c = env.ctx[b.index];
        const int s = stab.step, root = chordTones(b.chord, 3)[0];
        const auto shift = [&](Event& e, double d) {
            e.t = r6(e.t + d);
            e.beat = *e.beat + d / (b.stepSec * b.sub);
            e.dur = r6(std::max(0.02, e.dur - d));
        };
        if (profile == "ballad" && ((s == 0 && c.change) || stab.tones[0]->t == lastT) && env.roll(c, "keysB", "roll", s) < env.p(0.2)) {
            const double total = 0.015 + 0.025 * env.roll(c, "keysB", "rollTime", s);
            std::vector<Event*> all = stab.tones;
            std::stable_sort(all.begin(), all.end(), [](const Event* x, const Event* y) { return x->midi < y->midi; });
            for (size_t i = 1; i < all.size(); ++i)
                if (all[i]->t + total < b.end - 0.01) shift(*all[i], (total * static_cast<double>(i)) / static_cast<double>(all.size() - 1));
        } else if ((profile == "shuffle" || profile == "slowBlues") && env.roll(c, "keysB", "crush", s) < env.p(0.2)) {
            const auto third = std::find_if(stab.tones.begin(), stab.tones.end(), [&](const Event* e) { return (((e->midi - root) % 12) + 12) % 12 == 4; });
            const double d = 0.03 + 0.03 * env.roll(c, "keysB", "crushTime", s);
            if (third == stab.tones.end() || (*third)->t + d >= b.end - 0.01) continue;
            Event grace = **third; // the tone a semitone below, without a place in the stab
            grace.strum.reset();
            grace.midi = (*third)->midi - 1;
            grace.dur = r6(d);
            grace.art = "crush";
            env.add(grace);
            shift(**third, d);
        } else if (profile == "funk" && s % b.sub == 0 && env.roll(c, "keysB", "bark", s) < env.p(0.3)) {
            for (Event* e : stab.tones) {
                e->art = "bark";
                e->vel = roundVel(e->vel * 1.15);
            }
        }
    }
}

} // namespace btg::detail
