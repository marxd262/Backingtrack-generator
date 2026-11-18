// Port of src/core/organ.js: the rules of the organ, part of the articulation step. They apply only when the
// chord layer plays the tonewheel organ and only set fields at its tones; what becomes of them is the voice's choice.
// leslie: 1 = the speaker turns fast (chorus, build, and the bar before the chorus). swell: the pedal in dB, taken
// from the level the song form gives the bar. In the bar before the chorus the pedal opens to the chorus's level.
#include "articulation_internal.h"

namespace btg::detail {

void organRules(Env& env, const std::vector<Section>& sections) {
    if (env.track.voice("chords").id != "organ") return;
    const int count = static_cast<int>(env.bars.size());
    std::vector<double> level(env.bars.size(), 0.0); // level of the song form per bar in dB; without a form 0 everywhere
    for (const Section& sec : sections)
        for (int i = sec.start; i < sec.start + sec.bars && i < count; ++i) level[i] = sec.hasResolved ? levelAt(sec.resolved, i - sec.start) : 0.0;
    const auto kind = [&](int bar) { return bar >= 0 && bar < count ? env.ctx[bar].kind : std::string(); };
    for (Event* e : env.out) {
        if (!isNote(*e, "chords")) continue;
        const bool into = kind(e->bar) != "chorus" && kind(e->bar + 1) == "chorus";
        if (into || kind(e->bar) == "chorus" || kind(e->bar) == "build") e->leslie = 1;
        const int at = into ? e->bar + 1 : e->bar;
        const double db = at < count ? level[at] : 0.0;
        if (db < 0) e->swell = r6(db);
        if (into && level[e->bar] < db) {
            e->art = "swell";
            e->artTime = r6(env.bars[e->bar].end - e->t);
        }
    }
}

} // namespace btg::detail
