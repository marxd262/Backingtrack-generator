#include "sampler.h"

#include "patch.h"

#include <algorithm>
#include <iterator>
#include <map>
#include <utility>

namespace btg::detail {

const char* const LAYER_NAMES[Engine::layerCount] = { "drums", "bass", "chords", "pad", "lead", "percussion" };
const char* const HIT_NAMES[22] = { "kick", "snare", "hat", "openHat", "tomHigh", "tomMid", "tomLow", "crash", "sideStick", "rimshot", "ride", "rideBell", "hatHalf", "hatPedal",
                                    "shaker", "tambourine", "congaHigh", "congaLow", "bongoHigh", "bongoLow", "claves", "cowbell" };
const char* const ART_NAMES[22] = { "approach", "bark", "bend", "choke", "chuck", "crush", "dead", "fall", "flam", "hammer", "legato",
                                    "letRing", "octavePop", "palmMute", "pedal", "pull", "scoop", "slideIn", "slideOff", "staccato", "swell", "vibrato" };

namespace {
const double FLOOR = 0.0001, MIN_RELEASE = 0.04, MAX_RELEASE = 2.0, CHOKE_TC = 0.012, PI = 3.141592653589793;

Biquad divided(double b0, double b1, double b2, double a0, double a1, double a2) {
    Biquad f;
    f.b0 = b0 / a0; f.b1 = b1 / a0; f.b2 = b2 / a0; f.a1 = a1 / a0; f.a2 = a2 / a0;
    return f;
}
} // namespace

// The formulas of the Web Audio spec ("BiquadFilterNode"); shelves have slope 1 and ignore Q.
Biquad lowpass(double hz, double qDb, double sr) {
    const double w = 2 * PI * hz / sr, c = std::cos(w), alpha = std::sin(w) / (2 * std::pow(10.0, qDb / 20));
    return divided((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}
Biquad highpass(double hz, double qDb, double sr) {
    const double w = 2 * PI * hz / sr, c = std::cos(w), alpha = std::sin(w) / (2 * std::pow(10.0, qDb / 20));
    return divided((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}
Biquad peaking(double hz, double db, double q, double sr) {
    const double w = 2 * PI * hz / sr, c = std::cos(w), alpha = std::sin(w) / (2 * q), A = std::pow(10.0, db / 40);
    return divided(1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A);
}
Biquad lowshelf(double hz, double db, double sr) {
    const double w = 2 * PI * hz / sr, c = std::cos(w), A = std::pow(10.0, db / 40), s = 2 * std::sqrt(A) * (std::sin(w) / 2 * std::sqrt(2.0));
    return divided(A * ((A + 1) - (A - 1) * c + s), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - s),
                   (A + 1) + (A - 1) * c + s, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - s);
}
Biquad highshelf(double hz, double db, double sr) {
    const double w = 2 * PI * hz / sr, c = std::cos(w), A = std::pow(10.0, db / 40), s = 2 * std::sqrt(A) * (std::sin(w) / 2 * std::sqrt(2.0));
    return divided(A * ((A + 1) + (A - 1) * c + s), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - s),
                   (A + 1) - (A - 1) * c + s, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - s);
}

// sampler.js, playNote (line numbers of that file). Times in seconds from the tone's start, which is the event's (or earlier by
// the glide's lead, later by the strum: the voice has moved `delay`).
void Tone::start(const Note& n, double sampleRate, uint64_t number) {
    *this = Tone {};
    const Pack::Sample& s = n.pack->samples[n.sample];
    const Pack::Zone& zone = *n.zone;
    active = true;
    serial = number;
    voice = n.voice;
    layer = n.layer;
    delay = n.delay;
    sr = sampleRate;
    data = n.pack->audio.data() + static_cast<size_t>(s.offset) * n.pack->channels;
    channels = n.pack->channels;
    frames = s.frames;
    loop = zone.loop && !n.oneShot;
    loopStart = s.loopStart;
    loopEnd = s.loopEnd;
    panLeft = n.panLeft;
    panRight = n.panRight;

    art = n.art;
    double dur = n.dur, filter = n.filter, naturalDecay = n.naturalDecay, gain = n.gain;
    if (art == Art::dead || art == Art::chuck) { dur = std::min(dur, art == Art::chuck ? 0.04 : 0.05); filter = std::min(filter, 900.0); } // 131
    if (art == Art::palmMute) { filter = std::min(filter, 1600.0); naturalDecay = naturalDecay > 0 ? std::min(naturalDecay, 0.5) : 0.5; }
    if (art == Art::hammer) gain *= 0.85; // no pick attack: quieter, soft start, into the sample
    if (art == Art::bend || art == Art::vibrato) naturalDecay = 0; // they need the sustain
    const double pitch = std::pow(2.0, ((n.key - zone.rootKey) * 100 + zone.tuneCents + n.cents) / 1200); // the web's playbackRate
    rate = pitch * s.rate / sr;

    const double v = clamp(n.vel, 0, 1); // 143
    const double velocity = !zone.hasVelGain ? v
        : zone.velGain[0] + (zone.velGain[1] - zone.velGain[0]) * (zone.velHi > zone.velLo ? clamp((v * 127 - zone.velLo) / (zone.velHi - zone.velLo), 0, 1) : 1.0);
    peak = std::max(FLOOR, gain * std::pow(10.0, -std::max(0.0, zone.attenuationDb) / 20) * velocity);
    sustainLevel = std::max(FLOOR, peak * std::pow(10.0, -zone.sustainDb / 20));
    const double attackTime = std::max(art == Art::swell ? (std::isfinite(n.artTime) ? n.artTime : 0.5) : art == Art::hammer ? 0.02 : 0.003, zone.attack * n.timeScale); // 146
    const int attackN = std::max(1, static_cast<int>(attackTime * sr));
    attackInc = peak / attackN;
    holdLeft = static_cast<int>(zone.hold * n.timeScale * sr); // 147
    decayLeft = std::max(1, static_cast<int>(std::max(0.001, zone.decay * n.timeScale) * sr));
    decayMul = std::pow(sustainLevel / peak, 1.0 / decayLeft);
    double release = n.ring ? MAX_RELEASE : art == Art::staccato || art == Art::choke || art == Art::chuck ? 0.03 : std::min(MAX_RELEASE, std::max(MIN_RELEASE, zone.release * n.timeScale)); // 161
    double span = std::max(0.02, dur); // noteEnd
    if (n.oneShot && zone.loop) { // 149: without its loop the sample ends; the release ends with it
        const double sampleEnd = s.frames / s.rate / pitch;
        span = std::min(span, std::max(0.02, sampleEnd - 0.15));
        release = std::min(release, std::max(MIN_RELEASE, sampleEnd - span));
    }
    toNoteEnd = static_cast<long long>(span * sr);
    releaseN = std::max(1, static_cast<int>(release * sr));
    if (naturalDecay > 0) { // 173: 60 dB in naturalDecay seconds, but not below FLOOR at the end of the release
        const double total = span + release;
        tailMul = std::pow(std::max(FLOOR, std::pow(10.0, -3 * total / naturalDecay)), 1 / (total * sr));
    }

    const double semis = std::isfinite(n.artSemi) ? n.artSemi : -2.0; // 201
    r0 = std::pow(2.0, semis / 12);
    switch (art) {
        case Art::slideIn: case Art::scoop: // 222: from r0 to the note, ending on the event when the tone started early
            artLength = n.lead > 0 ? n.lead : std::min(std::isfinite(n.artTime) ? n.artTime : 0.08, span / 2);
            break;
        case Art::bend: // 202, 203
            artFrom = std::min(0.04, 0.1 * span);
            artLength = std::isfinite(n.artTime) ? std::max(0.02, std::min(n.artTime, 0.5 * span) - artFrom) : std::min(0.18, 0.35 * span);
            shelfDb = 9 * std::fabs(semis) / 2; // artTone 9: the slack string darker, the stretched one brighter
            shelfNow = -shelfDb;
            shelf[0] = shelf[1] = highshelf(1800, shelfNow, sr);
            break;
        case Art::vibrato: // 229
            if (span < 0.3) { art = Art::none; break; }
            artFrom = std::min(std::isfinite(n.artTime) ? n.artTime : 0.2, 0.4 * span);
            artLength = span - artFrom;
            vibratoX = (std::ceil(artLength * 200) - 1) / 200; // the web's N points sit at x = i / 200, spread over the length
            vibratoCents = 100 * (std::isfinite(n.artSemi) ? std::fabs(n.artSemi) : 0.15);
            vibratoHz = std::isfinite(n.artRate) ? n.artRate : 5.5;
            break;
        case Art::fall: case Art::slideOff: // 212
            artLength = std::min(std::isfinite(n.artTime) ? n.artTime : 0.2, 0.6 * span);
            artFrom = span - artLength;
            break;
        default: break;
    }
    if (art == Art::hammer) pos = std::min(0.03, s.frames / s.rate / 2) * s.rate; // 235

    const auto add = [&](const Biquad& f) { filters[filterCount][0] = filters[filterCount][1] = f; ++filterCount; };
    if (n.eq) { // 179: highpass 50 Hz, then the steps of at least 0.05 dB
        add(highpass(50, 1, sr));
        if (std::fabs(n.eq->lowDb) >= 0.05) add(lowshelf(200, n.eq->lowDb, sr));
        if (std::fabs(n.eq->midDb) >= 0.05) add(peaking(n.eq->midHz, n.eq->midDb, 0.8, sr));
        if (std::fabs(n.eq->highDb) >= 0.05) add(highshelf(n.eq->highHz, n.eq->highDb, sr));
    }
    if (filter < 20000 && filter < 0.45 * sr) add(lowpass(filter, 1, sr)); // 195, Q = 1 dB
}

void Tone::choke(long long inFrames, double timeConstant, double sampleRate) {
    if (chokeIn >= 0 && chokeIn <= inFrames) return; // already choked earlier
    chokeIn = inFrames;
    chokeMul = std::exp(-1 / (timeConstant * sampleRate));
}

void Tone::render(float* left, float* right, int count) {
    const auto ease = [](double x) { return x * x * (3 - 2 * x); };
    const int sides = channels == 2 ? 2 : 1; // a mono pack is filtered once and copied to both sides
    for (int i = 0; i < count && active; ++i) {
        if (delay > 0) { --delay; continue; }
        if (toNoteEnd == 0 && stage != release) {
            stage = release;
            releaseLeft = releaseN;
            releaseMul = std::pow(FLOOR / std::max(FLOOR, level), 1.0 / releaseN);
        }
        if (toNoteEnd > 0) --toNoteEnd;
        switch (stage) {
            case attack: level += attackInc; if (level >= peak) { level = peak; stage = hold; } break;
            case hold: if (holdLeft-- <= 0) stage = decay; break;
            case decay: level *= decayMul; if (--decayLeft <= 0) { level = sustainLevel; stage = sustain; } break;
            case sustain: break;
            case release: level *= releaseMul; if (--releaseLeft <= 0) active = false; break;
        }
        // A choked tone ends at a gain of 1e-7. It rings on through its layer's effect chain: behind distortion 1 the end at 1e-4 was a
        // step of -51 dB re the layer's peak (engine test, chords; -35 dB in the review's probe of the chain alone), and the step falls
        // with the gain (measured at 1e-7: -154 dB, below the tail's own -94 dB). It costs time: a choked tone rings 16 time constants (9 at 1e-4).
        if (chokeIn == 0) { chokeGain *= chokeMul; if (chokeGain < 1e-7) active = false; }
        else if (chokeIn > 0) --chokeIn;
        tailGain *= tailMul;

        // the articulation's pitch factor, bend shelf and fade at this frame
        double step = rate, fade = 1.0;
        const double tau = static_cast<double>(age++) / sr;
        switch (art) {
            case Art::slideIn: case Art::scoop:
                if (tau < artLength) step *= std::pow(r0, 1 - tau / artLength);
                break;
            case Art::bend: { // r0 and -d until the hold ends, then the web's 32-point curves (linear between the points), then 1 and +d
                const double p = 31 * (tau - artFrom) / artLength;
                double factor = 1.0, db = shelfDb;
                if (p < 0) { factor = r0; db = -shelfDb; }
                else if (p < 31) {
                    const int k = static_cast<int>(p);
                    const double w = p - k, e0 = ease(k / 31.0), e1 = ease((k + 1) / 31.0), c0 = std::pow(r0, 1 - e0);
                    factor = c0 + (std::pow(r0, 1 - e1) - c0) * w;
                    db = shelfDb * (2 * e0 - 1 + 2 * (e1 - e0) * w);
                }
                step *= factor;
                if (db != shelfNow) {
                    shelfNow = db;
                    const Biquad f = highshelf(1800, db, sr);
                    for (Biquad& b : shelf) { b.b0 = f.b0; b.b1 = f.b1; b.b2 = f.b2; b.a1 = f.a1; b.a2 = f.a2; }
                }
                break;
            }
            case Art::vibrato:
                if (tau >= artFrom) {
                    const double x = vibratoX * std::min(1.0, (tau - artFrom) / artLength);
                    step *= std::pow(2.0, vibratoCents * std::min(1.0, x / 0.25) * std::sin(2 * PI * vibratoHz * x) / 1200);
                }
                break;
            case Art::fall: case Art::slideOff: // down to r0 at noteEnd + 0.03 s, fading to 0.05 at noteEnd; then both hold
                if (tau >= artFrom) {
                    step *= std::pow(r0, std::min(1.0, (tau - artFrom) / (artLength + 0.03)));
                    fade = std::pow(0.05, artLength > 0 ? std::min(1.0, (tau - artFrom) / artLength) : 1.0);
                }
                break;
            default: break;
        }

        if (loop) while (pos >= loopEnd) pos -= loopEnd - loopStart;
        const int at = static_cast<int>(pos);
        if (!loop && at >= frames - 1) { active = false; break; }
        const int after = loop && at + 1 >= loopEnd ? loopStart : at + 1;
        const double frac = pos - at, gain = level * tailGain * chokeGain;
        double out[2];
        for (int c = 0; c < sides; ++c) {
            double x = (data[at * channels + c] * (1 - frac) + data[after * channels + c] * frac) * gain;
            for (int f = 0; f < filterCount; ++f) x = filters[f][c].process(x);
            if (art == Art::bend) x = shelf[c].process(x);
            out[c] = x * fade;
        }
        if (sides == 1) out[1] = out[0];
        left[i] += static_cast<float>(out[0] * panLeft);
        right[i] += static_cast<float>(out[1] * panRight);
        pos += step;
    }
}

Tone* Tones::start(const Note& n) {
    Tone* tone = &all[0];
    for (Tone& t : all) {
        if (!t.active) { tone = &t; break; }
        if (t.serial < tone->serial) tone = &t; // all busy: the oldest goes
    }
    tone->start(n, sr, ++serial);
    return tone;
}

int pickZones(const Pack& pack, int key, double vel01, const char* art, const Pack::Zone** best, int capacity, bool* own) {
    bool mine = false; // artZones: the pack's own zones for this art, else the plain ones
    if (art) for (const Pack::Zone& z : pack.zones) if (!z.releaseTrigger && z.art == art) { mine = true; break; }
    if (own) *own = mine;
    const int vel = static_cast<int>(jsRound(clamp(vel01, 0, 1) * 127));
    const auto distance = [](int x, int lo, int hi) { return x < lo ? lo - x : x > hi ? x - hi : 0; };
    int count = 0, score[3] = { 0, 0, 0 };
    for (const Pack::Zone& z : pack.zones) {
        if (z.releaseTrigger || (mine ? z.art != art : !z.art.empty())) continue;
        const int s[3] = { distance(key, z.keyLo, z.keyHi), distance(vel, z.velLo, z.velHi), z.keyHi - z.keyLo };
        const bool better = count == 0 || std::lexicographical_compare(s, s + 3, score, score + 3);
        if (better) { count = 0; std::copy(s, s + 3, score); }
        if ((better || std::equal(s, s + 3, score)) && count < capacity) best[count++] = &z;
    }
    return count;
}

double velocityBrightnessHz(double vel, double softHz) {
    if (!(softHz < 20000)) return 20000;
    return 20000 * std::pow(softHz / 20000, std::pow((1 - clamp(vel, 0.2, 1)) / 0.8, 1.5));
}

namespace {

// The zone a format-2 voice plays: any of the equally good ones, never the one played last under the same memory (round robin).
// One zone: no draw, so the voice's sequence stays the same.
const Pack::Zone* roundRobin(const Pack::Zone* const* best, int count, const Pack::Zone*& last, Rng& rng) {
    if (count <= 1) return best[0];
    const Pack::Zone* pool[16];
    int n = 0;
    for (int i = 0; i < count; ++i) if (best[i] != last) pool[n++] = best[i];
    return last = pool[std::min(n - 1, static_cast<int>(rng.next() * n))];
}

// sample.js, sampleVoice (line numbers of that file): bass, chords, pad, lead.
class SampleNotes final : public Voice {
public:
    Eq eq {}; // the guitar's equaliser (tuned midDb finite)
    double filterHz = 20000.0, timeScale = 1.0; // the timbre's lowpass and time scale for this layer (makeVoice)

    void play(const PlayEvent& e, int delay, double secondsPerBeat, VoiceState& state, Tones& tones) const override {
        if (e.hit) return;
        const double dur = e.durBeats * secondsPerBeat;
        double strumGain = 1.0;
        int later = 0;                                 // frames the strum moves this tone
        if (layer == Engine::chords && tuned.strum > 0) { // 51: chord tones at the same stream time follow each other
            state.strumRun = std::fabs(e.t - state.lastSong) < 0.001 ? state.strumRun + 1 : 0;
            state.lastSong = e.t;
            double pos = state.strumRun, step = tuned.strum;
            const int n = e.strumCount;
            if (n > 1) {
                const double up = std::isfinite(e.strumUp) ? e.strumUp : tuned.strumUp;
                if (up >= 1) { // an upstroke (highest tone first) off the beat, faster when struck hard, at most 20 % of the note
                    const double frac = e.beatInBar - std::floor(e.beatInBar);
                    const bool isUp = up >= 2 ? frac > 1e-6 : std::fabs(frac * 2 - jsRound(frac * 2)) > 1e-6;
                    pos = isUp ? n - 1 - e.strumIndex : e.strumIndex;
                    step = std::min(step * (1.6 - clamp(e.vel, 0, 1)), 0.2 * dur / (n - 1));
                }
                if (tuned.strumTilt > 0) strumGain = 1 - tuned.strumTilt * (pos / (n - 1));
            }
            later = static_cast<int>(jsRound(pos * step * tones.sr));
        }
        double gain = tuned.level * strumGain, cents = 0.0, filter = filterHz;
        bool oneShot = false;
        if (std::isfinite(tuned.velExp)) { // 79: always both draws, so the sequence stays the same
            const double pitch = state.rng.next(), loud = state.rng.next();
            cents = (2 * pitch - 1) * tuned.humanCents;
            const double v = clamp(e.vel, 1.0 / 127, 1);
            gain *= (std::pow(v, tuned.velExp) / v) * std::pow(10.0, -((2 * loud - 1) * tuned.humanDb) / 20);
            filter = std::min(filter, velocityBrightnessHz(e.vel, tuned.softHz));
            oneShot = tuned.oneShot >= 0.5;
        }
        const Pack::Zone* best[16];
        bool own = false;
        const int count = pickZones(*pack, e.midi, e.vel, e.artName, best, 16, &own); // 88
        if (count == 0) return;
        const Pack::Zone* zone = best[0];
        if (pack->version == 2) {
            const int art = e.artName ? 1 + static_cast<int>(std::find(std::begin(ART_NAMES), std::end(ART_NAMES), e.artName) - std::begin(ART_NAMES)) : 0;
            zone = roundRobin(best, count, state.lastNoteZone[e.midi & 127][art], state.rng);
        }
        tones.start({ .pack = pack.get(), .zone = zone, .sample = zone->sample, .key = e.midi, .dur = dur, .vel = e.vel, .gain = gain, .cents = cents,
                      .art = own ? Art::none : e.art, .artSemi = e.artSemi, .artTime = e.artTime, .artRate = e.artRate, .filter = filter,
                      .naturalDecay = std::isfinite(tuned.decay) ? tuned.decay : 0.0, .timeScale = timeScale, .lead = e.leadBeats * secondsPerBeat,
                      .eq = std::isfinite(tuned.midDb) ? &eq : nullptr, .oneShot = oneShot, .ring = e.ring, .delay = delay + later, .layer = layer,
                      .voice = state.serial });
    }
};

// sample-hits.js, sampleHitVoice: drums and percussion.
class SampleHits final : public Voice {
public:
    // closes: the name after the fallback is hat, or the event's own is hatPedal; opens: it is openHat (format 1: the closed hat chokes the open one)
    struct Hit { int key = -1; bool halfChoke = false, closes = false, opens = false; float panLeft = 1.0f, panRight = 1.0f; };
    std::array<Hit, std::size(HIT_NAMES)> hits; // per HIT_NAMES index: the key that plays it, -1 = none

    // kit: the timbre's width times mix/pan "kit" when the voice places its hits in the kit (synth.js 174, 198), else 0
    SampleHits(Engine::Layer voiceLayer, const std::string& key, const Pack& p, double kit) {
        static const std::map<std::string, std::string> DRUM_FALLBACK { // src/core/event-helpers.js
            { "sideStick", "snare" }, { "rimshot", "snare" }, { "ride", "hat" }, { "rideBell", "hat" }, { "hatHalf", "openHat" }, { "hatPedal", "hat" } };
        const auto& kitPan = soundData().kitPan; // KIT_PAN of synth.js: the place of a hit relative to mix/pan "kit"; every other hit stays in the middle
        const auto& hitKeys = soundData().hitKeys;
        const auto own = hitKeys.find(key);
        const auto& keyMap = own != hitKeys.end() ? own->second : hitKeys.at(LAYER_NAMES[voiceLayer]);
        const auto& gm = hitKeys.at("drums");
        const auto& keys = p.version == 2 ? p.keys : keyMap; // format 1 packs bring no keys: the voice's map
        for (size_t i = 0; i < hits.size(); ++i) {
            std::string n = HIT_NAMES[i];
            // a name the voice's key map puts on the GM key of another plays that one's sample (kit rimshot: snare -> sideStick)
            const auto mapped = keyMap.find(n);
            if (p.version == 2 && mapped != keyMap.end() && (!gm.count(n) || gm.at(n) != mapped->second))
                for (const auto& [name, gmKey] : gm) if (gmKey == mapped->second) { n = name; break; }
            const auto fallback = DRUM_FALLBACK.find(n);
            if (!keys.count(n) && fallback != DRUM_FALLBACK.end()) {
                hits[i].halfChoke = n == "hatHalf"; // the open hat stands in and chokes itself after 0.1 s
                n = fallback->second;
            }
            const auto found = keys.find(n);
            hits[i].key = found != keys.end() ? found->second : -1;
            hits[i].closes = n == "hat" || std::string(HIT_NAMES[i]) == "hatPedal";
            hits[i].opens = n == "openHat";
            // the place goes by the event's name after the fallback (DRUM_FALLBACK[name] ?? name), whichever key plays it
            const auto stand = DRUM_FALLBACK.find(HIT_NAMES[i]);
            const auto place = kitPan.find(stand != DRUM_FALLBACK.end() ? stand->second : HIT_NAMES[i]);
            const double pan = clamp(kit * (place != kitPan.end() ? place->second : 0.0), -1, 1);
            hits[i].panLeft = static_cast<float>(1 - pan);
            hits[i].panRight = static_cast<float>(1 + pan);
        }
    }

    void play(const PlayEvent& e, int delay, double, VoiceState& state, Tones& tones) const override {
        if (!e.hit || e.name < 0) return;
        const Hit& hit = hits[static_cast<size_t>(e.name)];
        if (hit.key < 0) return;
        double selfChoke = e.art == Art::choke ? (std::isfinite(e.artTime) ? e.artTime : 0.1) : 0.0;
        if (hit.halfChoke && selfChoke == 0.0) selfChoke = 0.1;
        const bool v2 = pack->version == 2;
        double cents = 0.0, gain = tuned.level, pickVel = e.vel;
        if (std::isfinite(tuned.humanDb)) { // always all three draws, so the sequence stays the same
            const double pitch = state.rng.next(), loud = state.rng.next(), spread = state.rng.next();
            cents = (2 * pitch - 1) * tuned.humanCents;
            gain *= std::pow(10.0, -((2 * loud - 1) * tuned.humanDb) / 20);
            pickVel = clamp(e.vel + (2 * spread - 1) * tuned.layerSpread, 0, 1); // format 1: neighbouring velocity layers alternate
        }
        const double vel = v2 && e.vel > 0 && std::isfinite(tuned.velCurve) ? std::pow(e.vel, tuned.velCurve) : e.vel;
        const Pack::Zone* best[16];
        const int count = pickZones(*pack, hit.key, v2 ? vel : pickVel, nullptr, best, 16);
        if (count == 0) return;
        const Pack::Zone* zone = v2 ? roundRobin(best, count, state.lastZone[hit.key & 127], state.rng) : best[0];
        const auto start = [&](int sample, double g) {
            const Pack::Sample& s = pack->samples[sample];
            const double length = s.frames / s.rate / std::pow(2.0, ((hit.key - zone->rootKey) * 100 + zone->tuneCents) / 1200);
            return tones.start({ .pack = pack.get(), .zone = zone, .sample = sample, .key = hit.key, .dur = length, .vel = vel, .gain = g, .cents = cents,
                                 .delay = delay, .layer = layer, .voice = state.serial, .panLeft = hit.panLeft, .panRight = hit.panRight });
        };
        Tone* started[2] = { start(zone->sample, gain), v2 && zone->room >= 0 ? start(zone->room, gain * (std::isfinite(tuned.roomMic) ? tuned.roomMic : 1.0)) : nullptr };
        if (!v2) { // 66 to 71: the kit's own choke rule
            if (selfChoke > 0) started[0]->choke(static_cast<long long>(selfChoke * tones.sr), CHOKE_TC, tones.sr);
            if (tuned.choke >= 0.5 && (hit.closes || hit.opens)) {
                Tone* open = state.openHat >= 0 ? &tones.all[static_cast<size_t>(state.openHat)] : nullptr;
                if (hit.closes && open && open->active && open->serial == state.openHatSerial) open->choke(std::max(0, delay - open->delay), CHOKE_TC, tones.sr);
                state.openHat = hit.opens && selfChoke == 0 ? static_cast<int>(started[0] - tones.all.data()) : -1;
                state.openHatSerial = started[0]->serial;
            }
            return;
        }
        for (Tone& t : tones.all) { // the library's off_by among this voice's tones
            if (!t.active || &t == started[0] || &t == started[1] || !t.offBy || t.voice != state.serial) continue;
            if (std::find(zone->chokes.begin(), zone->chokes.end(), t.offBy) != zone->chokes.end()) t.choke(std::max(0, delay - t.delay), t.offTime / 3, tones.sr);
        }
        for (Tone* t : started) {
            if (!t) continue;
            if (selfChoke > 0) t->choke(static_cast<long long>(selfChoke * tones.sr), CHOKE_TC, tones.sr);
            t->offBy = zone->offBy;
            t->offTime = zone->offTime > 0 ? zone->offTime : 3 * CHOKE_TC;
        }
    }
};

} // namespace

std::shared_ptr<const Voice> makeVoice(Engine::Layer layer, const std::string& key, std::shared_ptr<const Pack> pack, const Tuning& tuning, const Timbre& timbre) {
    const auto v = [&](const char* name) { return tunedValue(key, name, tuning); };
    const Tuned tuned { v("level"), v("decay"), v("velExp"), v("softHz"), v("oneShot"), v("humanCents"), v("humanDb"), v("strum"), v("strumUp"), v("strumTilt"),
                        v("lowDb"), v("midDb"), v("midHz"), v("highDb"), v("highHz"), v("layerSpread"), v("choke"), v("roomMic"), v("velCurve"), v("kitPan") };
    std::shared_ptr<Voice> voice;
    if (!pack) { // a synth voice (src/audio/voices/index.js, IMPLS)
        if (key != "chords/epiano/rhodes") return nullptr;
        voice = epianoVoice(tuning, timbre);
    } else if (layer == Engine::drums || layer == Engine::percussion) {
        // synth.js 198: a drums voice places its hits unless its kitPan is 0 (NaN counts as not 0: every format-1 kit)
        const double kit = layer == Engine::drums && !(tuned.kitPan == 0) ? masterParams(timbre.master).width * tunedValue("mix/pan", "kit", tuning) : 0.0;
        voice = std::make_shared<SampleHits>(layer, key, *pack, kit);
    } else {
        auto notes = std::make_shared<SampleNotes>();
        notes->eq = { tuned.lowDb, tuned.midDb, tuned.midHz, tuned.highDb, tuned.highHz };
        // sample.js 46 to 75: the lowpass of the brightness knobs and the time scale of the length knobs; the lead has neither
        if (layer == Engine::bass) notes->filterHz = brightnessHz(timbre.bass.cutoff);
        else if (layer == Engine::chords) {
            notes->filterHz = brightnessHz(timbre.chords.brightness);
            notes->timeScale = std::pow(3.0, (timbre.chords.length - 0.5) * 2);
        } else if (layer == Engine::pad) {
            notes->filterHz = brightnessHz(timbre.pad.cutoff);
            notes->timeScale = std::pow(3.0, (timbre.pad.attack - 0.5) * 2);
        }
        voice = std::move(notes);
    }
    voice->tuned = tuned;
    voice->startRng = Rng(1).fork(std::string("voice-") + LAYER_NAMES[layer]); // synth.js: every voice forks from the seed 1, not the track's
    voice->pack = std::move(pack);
    voice->layer = layer;
    return voice;
}

} // namespace btg::detail
