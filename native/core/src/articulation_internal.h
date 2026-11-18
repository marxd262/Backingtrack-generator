#pragma once

// What the rule groups of the articulation step share (articulation.cpp, articulation_harmony.cpp, organ.cpp).
// Port of src/core/articulation.js; see generator_internal.h for the rules of the port.

#include "generator_internal.h"

#include <deque>

namespace btg::detail {

struct Context { // per bar, see barContexts in the JavaScript
    std::string kind;
    int phrase = 0, inPhrase = 0, rep = 0;
    bool first = false, phraseStart = false, phraseEnd = false, verse = false, stop = false, fill = false, roll = false, change = false, nextChange = false;
    double energy = 0.0;
};

std::vector<Context> barContexts(const std::vector<Bar>& bars, const std::vector<Section>& sections, const Params& params);
std::string profileOf(const Track& track);

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

// articulation_harmony.cpp: the groups of the chord layer
void chordRules(Env& env); // rhythm guitar, sample guitars only
void keyRules(Env& env);   // keys, the electric piano only
void keyRulesB(Env& env);
void leadRules(Env& env);  // lead: fall, bend, vibrato, scoop or slide, hammer and pull
// organ.cpp: leslie and swell, when the chord layer plays the organ
void organRules(Env& env, const std::vector<Section>& sections);

} // namespace btg::detail
