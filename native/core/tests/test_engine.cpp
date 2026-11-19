#include "btg/engine.h"
#include "btg/generator.h"
#include "btg/pack.h"
#include "btg/transport.h"

#include "../src/compressor.h"
#include "../src/convolver.h"
#include "../src/echo.h"
#include "../src/sampler.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <complex>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

static int failures = 0;
#define CHECK(cond) \
    do { if (!(cond)) { std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); ++failures; } } while (0)

static const int rate = 48000;
static const char* DRY = R"({"master":{"reverb":0,"echo":0,"roomWet":0}})";

// A kit and a bass built in memory: decaying noise for the hits, a looped sine for the bass.
static std::shared_ptr<const btg::Pack> kit() {
    auto pack = std::make_shared<btg::Pack>();
    pack->version = 2;
    pack->channels = 2;
    const char* names[] = { "kick", "snare", "hat", "openHat", "tomHigh", "tomMid", "tomLow", "crash" };
    unsigned int noise = 1;
    for (int k = 0; k < 8; ++k) {
        pack->keys[names[k]] = 36 + k;
        pack->samples.push_back({ k * 8000, 8000, 44100.0, 0, 0 });
        for (int i = 0; i < 8000; ++i) {
            noise = noise * 1664525u + 1013904223u;
            const float x = (static_cast<float>(noise >> 8) / 8388608.0f - 1.0f) * std::exp(-i / 1500.0f);
            pack->audio.push_back(x);
            pack->audio.push_back(x);
        }
        btg::Pack::Zone zone;
        zone.keyLo = zone.keyHi = zone.rootKey = 36 + k;
        zone.sample = k;
        zone.release = 0.04;
        pack->zones.push_back(zone);
    }
    return pack;
}
// A format-1 kit (no key table of its own): every GM key of HIT_KEYS.drums has a zone with decaying noise, mono.
static std::shared_ptr<const btg::Pack> gmKit() {
    auto pack = std::make_shared<btg::Pack>();
    const int keys[] = { 36, 38, 42, 46, 50, 47, 43, 49, 37, 44 };
    unsigned int noise = 7;
    for (int k = 0; k < 10; ++k) {
        pack->samples.push_back({ k * 8000, 8000, 22050.0, 0, 0 });
        for (int i = 0; i < 8000; ++i) {
            noise = noise * 1664525u + 1013904223u;
            pack->audio.push_back((static_cast<float>(noise >> 8) / 8388608.0f - 1.0f) * std::exp(-i / 1500.0f));
        }
        btg::Pack::Zone zone;
        zone.keyLo = zone.keyHi = zone.rootKey = keys[k];
        zone.sample = k;
        zone.release = 0.04;
        pack->zones.push_back(zone);
    }
    return pack;
}
// The kit of the choke tests: every GM key plays a constant (DC) sample of 40000 frames, so a choke shows as the frame where the level falls.
// Format 2 brings its key table; format 1 gets it from sound.json.
static std::shared_ptr<const btg::Pack> dcKit(bool v2) {
    auto pack = std::make_shared<btg::Pack>();
    pack->version = v2 ? 2 : 1;
    const char* names[] = { "kick", "snare", "hat", "openHat", "tomHigh", "tomMid", "tomLow", "crash", "sideStick", "hatPedal" };
    const int keys[] = { 36, 38, 42, 46, 50, 47, 43, 49, 37, 44 };
    for (int k = 0; k < 10; ++k) {
        pack->keys[names[k]] = keys[k];
        pack->samples.push_back({ k * 40000, 40000, 48000.0, 0, 0 });
        pack->audio.insert(pack->audio.end(), 40000, 1.0f);
        btg::Pack::Zone zone;
        zone.keyLo = zone.keyHi = zone.rootKey = keys[k];
        zone.sample = k;
        pack->zones.push_back(zone);
    }
    return pack;
}
// A looped sine of `period` frames (200, or 10 for a tone above the timbre's lowpass of 400 Hz); the loop holds a whole number of
// periods (20000 / period), so the seam does not click.
static std::shared_ptr<const btg::Pack> tonePack(int rootKey, float amplitude, double release, int period = 200) {
    auto pack = std::make_shared<btg::Pack>();
    pack->samples.push_back({ 0, 22050, 22050.0, 1000, 21000 });
    for (int i = 0; i < 22050; ++i) pack->audio.push_back(amplitude * static_cast<float>(std::sin(2 * 3.14159265358979 * i / period)));
    btg::Pack::Zone zone;
    zone.rootKey = rootKey;
    zone.loop = true;
    zone.hold = 4;
    zone.release = release;
    pack->zones.push_back(zone);
    return pack;
}
// A format-1 hit pack whose one zone answers every key (the percussion of the tempo test): decaying noise, mono.
static std::shared_ptr<const btg::Pack> anyKey() {
    auto pack = std::make_shared<btg::Pack>();
    pack->samples.push_back({ 0, 8000, 22050.0, 0, 0 });
    unsigned int noise = 11;
    for (int i = 0; i < 8000; ++i) {
        noise = noise * 1664525u + 1013904223u;
        pack->audio.push_back((static_cast<float>(noise >> 8) / 8388608.0f - 1.0f) * std::exp(-i / 1500.0f));
    }
    btg::Pack::Zone zone; // keys 0 to 127
    zone.release = 0.04;
    pack->zones.push_back(zone);
    return pack;
}
// The packs of the tests by id; any other id is missing, as the shell's source would say.
static std::shared_ptr<const btg::Pack> source(const std::string& id) {
    if (id == "drums-naked") return kit();
    if (id == "drums-brushes") return gmKit();
    if (id == "bass-finger" || id == "bass-upright") return tonePack(45, 0.5f, 0.2);
    if (id == "bass-pick") return tonePack(45, 0.25f, 0.2);
    if (id == "pad-strings") return tonePack(57, 0.5f, 4.0); // the engine caps the release at 2 s
    if (id == "chords-funk") return tonePack(57, 0.3f, 0.3);
    if (id == "lead-flute") return tonePack(69, 0.3f, 0.2);
    if (id == "percussion-studio") return anyKey();
    throw std::runtime_error("not in the test: " + id);
}

// |H| in dB of a biquad at `hz`.
static double gainDb(const btg::detail::Biquad& f, double hz, double sr) {
    const std::complex<double> z = std::polar(1.0, -2 * 3.14159265358979 * hz / sr); // e^-jw
    return 20 * std::log10(std::abs((f.b0 + f.b1 * z + f.b2 * z * z) / (1.0 + f.a1 * z + f.a2 * z * z)));
}

struct Result { std::vector<float> left; double rms = 0.0, peak = 0.0, rmsRight = 0.0; bool finite = true; };

static double rmsOf(const std::vector<float>& x, size_t from, size_t to) {
    double squares = 0.0;
    for (size_t i = from; i < to; ++i) squares += static_cast<double>(x[i]) * x[i];
    return std::sqrt(squares / static_cast<double>(to - from));
}

// One note (midi `midi`, velocity 1, `seconds` long, one beat a second) of the voice `layer` builds with `timbre` from `pack`, rendered
// on the left for `frames` frames: the voice alone, no engine.
static std::vector<float> noteOf(btg::Engine::Layer layer, const char* key, std::shared_ptr<const btg::Pack> pack, const btg::detail::Timbre& timbre, int midi, double seconds, int frames, const char* tuning = "{}") {
    using namespace btg::detail;
    const auto voice = makeVoice(layer, key, std::move(pack), parseTuning(tuning), timbre);
    auto tones = std::make_unique<Tones>();
    tones->sr = rate;
    VoiceState state;
    state.rng = voice->startRng;
    PlayEvent e;
    e.layer = layer;
    e.midi = midi;
    e.vel = 1.0;
    e.durBeats = seconds;
    voice->play(e, 0, 1.0, state, *tones);
    std::vector<float> left(static_cast<size_t>(frames)), right(static_cast<size_t>(frames));
    for (Tone& t : tones->all) if (t.active) t.render(left.data(), right.data(), frames);
    return left;
}

// The envelope of a note in windows of 48 frames: the time to half its highest level and the time from the note's end (`noteEnd` s)
// until it has fallen to a tenth of it.
struct Envelope { double rise, fall; };
static Envelope envelopeOf(const std::vector<float>& x, double noteEnd) {
    const size_t win = 48;
    std::vector<float> peaks;
    for (size_t at = 0; at + win <= x.size(); at += win) peaks.push_back(*std::max_element(x.begin() + static_cast<long>(at), x.begin() + static_cast<long>(at + win), [](float a, float b) { return std::fabs(a) < std::fabs(b); }));
    for (float& p : peaks) p = std::fabs(p);
    float sustain = 0.0f;
    for (size_t i = 0; i < static_cast<size_t>(noteEnd * rate) / win; ++i) sustain = std::max(sustain, peaks[i]);
    Envelope r { -1.0, -1.0 };
    for (size_t i = 0; i < peaks.size() && r.rise < 0; ++i) if (peaks[i] >= 0.5f * sustain) r.rise = static_cast<double>(i * win) / rate;
    for (size_t i = static_cast<size_t>(noteEnd * rate) / win; i < peaks.size() && r.fall < 0; ++i) if (peaks[i] < 0.1f * sustain) r.fall = static_cast<double>(i * win) / rate - noteEnd;
    return r;
}

static Result render(btg::Engine& engine, btg::Transport& transport, double seconds, int blockSize) {
    Result r;
    std::vector<float> l(blockSize), rr(blockSize);
    for (int done = 0; done < seconds * rate;) {
        const auto block = transport.advance(blockSize, rate);
        engine.render(l.data(), rr.data(), block.frames, block);
        for (int i = 0; i < block.frames; ++i) {
            r.left.push_back(l[i]);
            r.rms += l[i] * l[i];
            r.rmsRight += rr[i] * rr[i];
            r.peak = std::max(r.peak, static_cast<double>(std::max(std::fabs(l[i]), std::fabs(rr[i]))));
            r.finite = r.finite && std::isfinite(l[i]) && std::isfinite(rr[i]);
        }
        done += block.frames;
    }
    r.rms = std::sqrt(r.rms / static_cast<double>(r.left.size()));
    r.rmsRight = std::sqrt(r.rmsRight / static_cast<double>(r.left.size()));
    return r;
}

int main(int argc, char** argv) {
    // Transport: loop and jump.
    btg::Transport transport;
    transport.setLoop(4.0, 8.0);
    transport.play(6.0, 120.0); // 2 beats per second
    int frames = 0, cuts = 0;
    double last = 6.0, lowest = 100.0, highest = 0.0;
    while (frames < 5 * rate) {
        const auto block = transport.advance(480, rate);
        CHECK(block.playing && block.frames >= 1 && block.frames <= 480);
        if (block.beats < last) ++cuts; // wrapped
        last = block.beats;
        lowest = std::min(lowest, block.beats);
        highest = std::max(highest, block.beats + block.frames * block.beatsPerFrame);
        frames += block.frames;
    }
    CHECK(cuts == 2);                                   // 10 beats from 6 in a loop of 4: wraps at 8 twice, the third comes at exactly 5 s
    CHECK(lowest >= 4.0 && highest <= 8.0 + 1e-4);      // never outside the loop (at most one frame over)
    transport.setLoop(0.0, 0.0);
    transport.seek(32.0);
    CHECK(std::fabs(transport.advance(480, rate).beats - 32.0) < 1e-12);

    // A pack that points outside its audio file is refused.
    bool refused = false;
    const unsigned char pcm[8] = {};
    try { btg::loadPack(R"({"samples":[{"offset":0,"frames":100,"rate":22050}],"zones":[{"sample":0}]})", pcm, sizeof pcm); } catch (const std::exception&) { refused = true; }
    CHECK(refused);
    CHECK(btg::loadPack(R"({"samples":[{"offset":0,"frames":4,"rate":22050}],"zones":[{"sample":0}]})", pcm, sizeof pcm).zones.size() == 1);

    // The filters of the Web Audio spec: the gain where each type defines it.
    {
        using namespace btg::detail;
        CHECK(std::fabs(gainDb(peaking(2400, -6, 0.8, 48000), 2400, 48000) + 6) < 0.01);
        CHECK(std::fabs(gainDb(lowshelf(200, 5, 48000), 0, 48000) - 5) < 0.01);
        CHECK(std::fabs(gainDb(highshelf(2600, -4, 48000), 24000, 48000) + 4) < 0.01);
        CHECK(std::fabs(gainDb(lowpass(1000, 1, 48000), 1000, 48000) - 1) < 0.01); // Q in dB is the gain at the corner
        CHECK(std::fabs(gainDb(highpass(50, 1, 48000), 50, 48000) - 1) < 0.01);
        CHECK(std::fabs(gainDb(highshelf(1800, 0, 48000), 5000, 48000)) < 1e-9);    // 0 dB passes unchanged
    }
    // sample-zones.js, artZones: own zones for an art when the pack has them, else the plain ones; release zones never.
    {
        btg::Pack pack;
        pack.samples.push_back({ 0, 4, 22050.0, 0, 0 });
        for (const char* art : { "", "palmMute", "" }) { btg::Pack::Zone z; z.keyLo = 40; z.keyHi = 80; z.art = art; pack.zones.push_back(z); }
        pack.zones[2].releaseTrigger = true;
        const btg::Pack::Zone* best[4];
        bool own = false;
        CHECK(btg::detail::pickZones(pack, 60, 0.8, "palmMute", best, 4, &own) == 1 && best[0] == &pack.zones[1] && own);
        CHECK(btg::detail::pickZones(pack, 60, 0.8, "dead", best, 4, &own) == 1 && best[0] == &pack.zones[0] && !own);
        CHECK(btg::detail::pickZones(pack, 60, 0.8, nullptr, best, 4, &own) == 1 && best[0] == &pack.zones[0] && !own);
    }
    // convolver.h: the same as a direct convolution, without latency, for any chunk size. 3000 taps: the head (512) and five partitions,
    // the last one cut short.
    {
        unsigned int seed = 3;
        const auto noise = [&] { seed = seed * 1664525u + 1013904223u; return static_cast<float>(seed >> 8) / 8388608.0f - 1.0f; };
        std::vector<std::vector<float>> h(2, std::vector<float>(3000)), x(2, std::vector<float>(6000)), y(2, std::vector<float>(6000));
        for (auto& c : h) for (float& v : c) v = 0.01f * noise();
        for (auto& c : x) for (float& v : c) v = noise();
        btg::detail::Convolver conv(h);
        CHECK(conv.frames() == 3000 && conv.partitions() == 5);
        const int sizes[] = { 1, 7, 256, 480, 513, 64 };
        for (int at = 0, k = 0; at < 6000; at += sizes[k++ % 6])
            conv.process(&x[0][at], &x[1][at], &y[0][at], &y[1][at], std::min(sizes[k % 6], 6000 - at));
        double worst = 0.0;
        for (int c = 0; c < 2; ++c)
            for (int n = 0; n < 6000; ++n) {
                double want = 0.0;
                for (int k = 0; k <= std::min(n, 2999); ++k) want += static_cast<double>(h[c][k]) * x[c][n - k];
                worst = std::max(worst, std::fabs(want - y[c][n]));
            }
        CHECK(worst < 1e-5);
        conv.reset();
        std::vector<float> silence(600, 0.0f), out(600, 1.0f), out2(600, 1.0f);
        conv.process(silence.data(), silence.data(), out.data(), out2.data(), 600);
        CHECK(*std::max_element(out.begin(), out.end()) == 0.0f && *std::min_element(out.begin(), out.end()) == 0.0f);
    }
    // Chromium reverb.cc, CalculateNormalizationScale: 1 / rms over both channels, times 10^(-58/20), times 44100 / rate; silence: 1 / 0.000125.
    {
        using btg::detail::normalizationScale;
        const std::vector<std::vector<float>> ir = { { 0.5f, -0.5f, 0.5f, -0.5f }, { 1.0f, 1.0f, -1.0f, -1.0f } }; // rms sqrt(5 / 8)
        CHECK(std::fabs(normalizationScale(ir, 48000) / (1 / std::sqrt(0.625) * std::pow(10.0, -2.9) * 44100 / 48000) - 1) < 1e-6);
        CHECK(std::fabs(normalizationScale({ { 0.0f, 0.0f }, { 0.0f, 0.0f } }, 44100) / (1 / 0.000125 * std::pow(10.0, -2.9)) - 1) < 1e-6);
    }
    // Review Focus 5, the responses: at 44.1, 48 and 96 kHz the reverb (2 s, decay 3) and the room (0.4 s, decay 6.9 / 0.4) have the same length
    // in seconds and decay at the same speed (power from 0.5..1.0 s to 1.0..1.5 s: e^-3 = -13.03 dB; room 0.05..0.2 s to 0.2..0.35 s:
    // e^-5.175 = -22.47 dB; the tolerances cover the noise of the draws), and their summed square goes with Chromium's normalisation,
    // 10^-5.8 * 44100^2 * seconds / rate per channel: the reverb's power is 3.01 dB lower at 96 kHz than at 48 kHz (design open point 3).
    for (const double sr : { 44100.0, 48000.0, 96000.0 }) {
        const auto reverb = btg::detail::normalizedNoise("reverb", 2.0, 3.0, sr), room = btg::detail::normalizedNoise("room", 0.4, 6.9 / 0.4, sr);
        const auto energy = [sr](const std::vector<float>& x, double from, double to) {
            double s = 0.0;
            for (size_t i = static_cast<size_t>(from * sr); i < static_cast<size_t>(to * sr); ++i) s += static_cast<double>(x[i]) * x[i];
            return s;
        };
        CHECK(reverb.size() == 2 && reverb[0].size() == static_cast<size_t>(std::ceil(2.0 * sr)) && room[1].size() == static_cast<size_t>(std::ceil(0.4 * sr)));
        CHECK(std::fabs(10 * std::log10(energy(reverb[0], 1.0, 1.5) / energy(reverb[0], 0.5, 1.0)) + 13.03) < 0.3);
        CHECK(std::fabs(10 * std::log10(energy(room[0], 0.2, 0.35) / energy(room[0], 0.05, 0.2)) + 22.47) < 0.5);
        const double perChannel = (energy(reverb[0], 0.0, 2.0) + energy(reverb[1], 0.0, 2.0)) / 2;
        CHECK(std::fabs(10 * std::log10(perChannel / (std::pow(10.0, -5.8) * 44100.0 * 44100.0 * 2.0 / sr))) < 0.01);
    }
    // echo.h: at 20 bpm the echo comes 2.25 s late (synth.js echoTime: 60 / bpm * 0.75) and fits its 3 s line, also at 96 kHz; with
    // feedback 0.5 it comes again after twice the time and the browser's 128 frames in the loop (inside the 10 ms looked at), nothing
    // between; a longer time stops at 3 s (createDelay(3)); a new time glides
    // with the time constant 0.05 s: 63.2 % of the way after 0.05 s, within 1e-4 s after 0.5 s.
    for (const double sr : { 48000.0, 96000.0 }) {
        btg::detail::Echo echo;
        echo.prepare(sr);
        echo.setTone(2400);
        echo.setTarget(60.0 / 20 * 0.75, true);
        CHECK(echo.delay() == 2.25);
        std::vector<float> out(static_cast<size_t>(4.7 * sr));
        for (size_t i = 0; i < out.size(); ++i) { float right = 0.0f; echo.process(i == 0 ? 1.0f : 0.0f, 0.0f, 0.5, out[i], right); }
        size_t once = 0;
        while (once < out.size() && std::fabs(out[once]) <= 1e-3) ++once;
        CHECK(once == static_cast<size_t>(std::llround(2.25 * sr)));
        double between = 0.0, again = 0.0;
        for (size_t i = once + static_cast<size_t>(0.1 * sr); i < 2 * once; ++i) between = std::max(between, std::fabs(static_cast<double>(out[i])));
        for (size_t i = 2 * once; i < 2 * once + static_cast<size_t>(0.01 * sr); ++i) again = std::max(again, std::fabs(static_cast<double>(out[i])));
        CHECK(between < 1e-6 && again > 1e-3);
        size_t second = once + static_cast<size_t>(0.1 * sr); // the second echo's first frame: exactly 128 frames late (the browser's cycle)
        while (second < out.size() && std::fabs(out[second]) <= 1e-9) ++second;
        CHECK(second == 2 * once + 128);
        echo.setTarget(4.0, true);
        CHECK(echo.delay() == 3.0);
        echo.setTarget(0.45, true);
        echo.setTarget(0.3, false);
        float l = 0.0f, r = 0.0f;
        for (int i = 0; i < static_cast<int>(0.05 * sr); ++i) echo.process(0.0f, 0.0f, 0.0, l, r);
        CHECK(std::fabs(echo.delay() - (0.3 + 0.15 * std::exp(-1.0))) < 1e-4);
        for (int i = 0; i < static_cast<int>(0.45 * sr); ++i) echo.process(0.0f, 0.0f, 0.0, l, r);
        CHECK(std::fabs(echo.delay() - 0.3) < 1e-4);
        // A time of 1000.25 frames reads linearly between two frames (Chromium delay.cc): an impulse comes out as its neighbours 1000 and
        // 1001 frames later weighted 0.75 and 0.25, before the tone filter; the filter sits behind that and is linear, so the output is
        // 0.75 r[n] + 0.25 r[n - 1] for r = the same filter's answer to an impulse at exactly 1000 frames (whole frames: no interpolation).
        {
            btg::detail::Echo whole, fraction;
            for (btg::detail::Echo* e : { &whole, &fraction }) { e->prepare(sr); e->setTone(2400); }
            whole.setTarget(1000.0 / sr, true);
            fraction.setTarget(1000.25 / sr, true);
            std::vector<float> exact(1200), x(1200);
            double worst = 0.0, level = 0.0;
            for (size_t i = 0; i < exact.size(); ++i) {
                float unused = 0.0f, outFraction = 0.0f;
                whole.process(i == 0 ? 1.0f : 0.0f, 0.0f, 0.0, exact[i], unused);
                fraction.process(i == 0 ? 1.0f : 0.0f, 0.0f, 0.0, outFraction, unused);
                x[i] = outFraction;
                if (i >= 1000) { worst = std::max(worst, std::fabs(static_cast<double>(outFraction) - (0.75 * exact[i] + 0.25 * exact[i - 1]))); level = std::max(level, std::fabs(static_cast<double>(exact[i]))); }
            }
            CHECK(level > 1e-3 && worst < 1e-7 && x[999] == 0.0f);
        }
    }

    // compressor.h, Chromium's DynamicsCompressor: the signal leaves (unsigned)(0.006f * rate) frames late (288 at 48 kHz, 264 at 44.1, 576 at
    // 96); below the threshold it only gets the automatic make-up (1 / Saturate(1))^0.6, with knee 0 10^(-0.6 * threshold * (1 - 1/ratio) / 20):
    // 4.5709 for -24 dB and ratio 12, 1.6218 for -14 dB and ratio 2. One impulse of -40 dBFS after 1 s of silence (the detector has settled),
    // chunks of 100 frames; every other frame stays exactly 0. This says nothing about the 32-frame division across calls: the signal lies
    // below both thresholds, so detector and gain are 1 in every division (the check after this loop does that).
    for (const auto& [sr, late] : { std::pair { 48000.0f, 288 }, std::pair { 44100.0f, 264 }, std::pair { 96000.0f, 576 } })
        for (const auto& [threshold, ratio, makeup] : { std::tuple { -24.0f, 12.0f, 4.5709 }, std::tuple { -14.0f, 2.0f, 1.6218 } }) {
            btg::detail::Compressor c;
            c.prepare(sr);
            c.set(threshold, 0.0f, ratio, 0.003f, 0.25f);
            CHECK(c.preDelay() == late);
            std::vector<float> l(static_cast<size_t>(sr) + 1000, 0.0f), r(l.size(), 0.0f);
            l[static_cast<size_t>(sr)] = 0.01f;
            for (size_t at = 0; at < l.size(); at += 100) c.process(&l[at], &r[at], static_cast<int>(std::min<size_t>(100, l.size() - at)));
            const size_t peakAt = static_cast<size_t>(std::max_element(l.begin(), l.end(), [](float a, float b) { return std::fabs(a) < std::fabs(b); }) - l.begin());
            CHECK(peakAt == static_cast<size_t>(sr) + late);
            CHECK(std::fabs(l[peakAt] / 0.01 / makeup - 1) < 1e-3);
            CHECK(std::count_if(l.begin(), l.end(), [](float x) { return x != 0.0f; }) == 1 && *std::max_element(r.begin(), r.end()) == 0.0f);
        }
    // The length of the calls changes nothing: noise at 0 dBFS, 40 dB lower, +3 dBFS, -30 dBFS (0.3 s each, so attack and release both run
    // and the compressor really works the signal), through the glue's and the limiter's settings in one call and in calls of 100, 7 and 128
    // frames (the engine's chunks have remainders; the browser's calls have 128): the four outputs are bit-identical, and the quiet stretch
    // comes out louder against its input than the loud one by at least 10 % (the signal was compressed).
    for (const auto& setting : { std::tuple { -14.0f, 2.0f, 0.03f, 0.25f }, std::tuple { -2.0f, 20.0f, 0.001f, 0.1f } }) {
        const float threshold = std::get<0>(setting), ratio = std::get<1>(setting), attack = std::get<2>(setting), release = std::get<3>(setting); // plain locals: older Clang cannot capture structured bindings
        const size_t part = 14400, frames = 4 * part;
        std::vector<float> left(frames), right(frames);
        unsigned int seed = 5;
        const auto noise = [&] { seed = seed * 1664525u + 1013904223u; return static_cast<float>(seed >> 8) / 8388608.0f - 1.0f; };
        const float amplitude[4] = { 1.0f, 0.01f, 1.4125f, 0.0316f };
        for (size_t i = 0; i < frames; ++i) { left[i] = amplitude[i / part] * noise(); right[i] = 0.6f * amplitude[i / part] * noise(); }
        const auto through = [&](size_t chunk) {
            btg::detail::Compressor c;
            c.prepare(48000.0f);
            c.set(threshold, 0.0f, ratio, attack, release);
            std::vector<float> l = left, r = right;
            for (size_t at = 0; at < frames; at += chunk) c.process(&l[at], &r[at], static_cast<int>(std::min(chunk, frames - at)));
            return std::make_pair(l, r);
        };
        const auto whole = through(frames);
        for (const size_t chunk : { 100, 7, 128 }) CHECK(through(chunk) == whole);
        const auto gainOf = [&](size_t from) { // output (late by the pre-delay) against input over 0.1 s
            return rmsOf(whole.first, from + 288, from + 288 + 4800) / rmsOf(left, from, from + 4800);
        };
        CHECK(gainOf(part - 4800) * 1.1 < gainOf(2 * part - 4800)); // measured: 0.756 against 1.616 (glue), 0.938 against 1.122 (limiter)
    }

    // Engine with the fixture track.
    if (argc < 2) { std::printf("usage: btg_engine_tests <track.json>\n"); return 2; }
    std::ifstream file(argv[1], std::ios::binary);
    const std::string track((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    CHECK(!track.empty());
    const auto play = [&](int blockSize, float drive, bool muteAll, double startBeats) {
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(DRY);
        engine.setTrack(track);
        engine.setBassDrive(drive);
        engine.setMuted(btg::Engine::drums, muteAll);
        engine.setMuted(btg::Engine::bass, muteAll);
        engine.prepare(rate);
        btg::Transport t;
        t.play(startBeats, engine.bpm());
        CHECK(engine.lengthBeats() > 0 && engine.bpm() > 0);
        return render(engine, t, 20.0, blockSize);
    };
    const Result a = play(480, 0.0f, false, 0.0), again = play(480, 0.0f, false, 0.0), small = play(64, 0.0f, false, 0.0);
    CHECK(a.rms > 0.01 && a.peak <= 1.0);
    CHECK(a.left == again.left);                            // same track, same sound
    CHECK(std::fabs(small.rms / a.rms - 1.0) < 0.02);       // the block size does not change the mix
    CHECK(play(480, 0.0f, true, 0.0).peak == 0.0);          // muted layers are silent
    CHECK(play(480, 0.8f, false, 0.0).left != a.left);      // the drive is audible
    CHECK(play(480, 0.0f, false, 64.0).rms > 0.01);         // starting inside the song plays

    // mix/bus on 0 takes the old limiter alone (-10 dB with its make-up), on 1 the glue and the limiter: both finite, below 1.0, not the same.
    // The fine value's default is on 0 (tunables.js, MIX_TUNABLES), so no tuning is the old limiter.
    {
        const auto bus = [&](const char* tuning) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setTuning(tuning);
            engine.setTrack(track);
            engine.prepare(rate);
            btg::Transport t;
            t.play(0.0, engine.bpm());
            return render(engine, t, 5.0, 480);
        };
        const Result glued = bus(R"({"mix/bus":{"on":1}})"), old = bus(R"({"mix/bus":{"on":0}})");
        CHECK(glued.finite && old.finite && glued.peak < 1.0 && old.peak < 1.0 && glued.left != old.left);
        CHECK(bus("{}").left == old.left);
    }

    // A compressor that was left out of the chain starts empty when it comes back: its pre-delay ring would otherwise play up to 1024
    // frames of what went in before the switch (and the detector and gain would be stale). Play 2 s, switch off, play 1 s, switch on:
    // the compressor that comes back delivers exactly 0 for its first 288 frames (its pre-delay), not old audio. The limiter's switch
    // (setLimiter) brings back the limiter (default bus: old limiter alone) or both (on 1: glue first, limiter behind it: 576 frames);
    // the bus's switch (mix/bus on 1 -> 0 -> 1) brings back the glue only, so the limiter's own late frames (0..287) are still music
    // and the glue's silence reaches the output at 288..575.
    {
        const auto peakOf = [](const Result& r, size_t from, size_t to) { return *std::max_element(r.left.begin() + static_cast<long>(from), r.left.begin() + static_cast<long>(to), [](float a, float b) { return std::fabs(a) < std::fabs(b); }); };
        const auto afterSwitch = [&](const char* tuning, const char* off, bool limiterSwitch) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setTuning(tuning);
            engine.setTrack(track);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            render(engine, t, 2.0, 480);
            if (limiterSwitch) engine.setLimiter(false); else engine.setTuning(off);
            render(engine, t, 1.0, 480);
            if (limiterSwitch) engine.setLimiter(true); else engine.setTuning(tuning);
            return render(engine, t, 0.1, 480);
        };
        const char *ON = R"({"mix/bus":{"on":1}})", *OFF = R"({"mix/bus":{"on":0}})";
        const Result limiterOnly = afterSwitch(OFF, OFF, true), both = afterSwitch(ON, ON, true), glueOnly = afterSwitch(ON, OFF, false);
        CHECK(peakOf(limiterOnly, 0, 288) == 0.0f && std::fabs(peakOf(limiterOnly, 288, 2000)) > 0.01f);
        CHECK(peakOf(both, 0, 576) == 0.0f && std::fabs(peakOf(both, 576, 2000)) > 0.01f);
        CHECK(std::fabs(peakOf(glueOnly, 0, 288)) > 0.01f && peakOf(glueOnly, 288, 576) == 0.0f && std::fabs(peakOf(glueOnly, 576, 2000)) > 0.01f);
    }

    // Tempo extremes: all six layers (test packs), reverb, room (1 s) and echo up, the limiter on; at 20 and at 400 bpm, 20 s each: every
    // sample finite, and the render takes less than a quarter of the time it plays (the load limit of the plan). The peak: the core's
    // limiter equals Chromium's compressor sample for sample (compressor-compare.mjs), and with these loud synthetic packs the chain
    // reaches 0.869 (20 bpm) and 1.064 (400 bpm) at the fader's 1, the latter a little above full scale (the shell clips); no web render
    // of these packs exists, so nothing more is known about why. The fader goes to 0.7, which is a gain of 0.49 (the square), and the
    // test asserts only that the peak stays below 1.0 there (about 2.0 before the fader: a runaway chain would not); "below full scale
    // at both tempos" is proven with the real packs in mix.json (mix-funk-20bpm, mix-funk-400bpm).
    // Both start at beat 64, where all six layers play (20 bpm for 20 s covers only 6.7 beats), and every layer has a peak after the render
    // (this also catches a pack that did not load).
    {
        std::string band = track;
        for (const char* layer : { "chords", "pad", "lead", "percussion" }) {
            const std::string off = std::string("\"") + layer + "\":false";
            band.replace(band.find(off), off.size(), std::string("\"") + layer + "\":true");
        }
        band.replace(band.find("\"lead\":\"off\""), 12, "\"lead\":\"melody\""); // the lead layer plays only with a job
        const std::vector<btg::Event> events = btg::buildEvents(band);
        int layers = 0;
        for (const char* name : { "drums", "bass", "chords", "pad", "lead", "percussion" })
            layers += std::any_of(events.begin(), events.end(), [&](const btg::Event& e) { return e.layer == name; });
        CHECK(layers == 6);
        for (const double bpm : { 20.0, 400.0 }) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(R"({"master":{"reverb":1,"echo":1,"roomWet":1,"roomSize":1}})");
            engine.setTrack(band);
            engine.setMaster(0.7f); // fader 0.7 = gain 0.49; not the fader's 1, where the peaks are 0.869 and 1.064 (see above)
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, bpm);
            const auto began = std::chrono::steady_clock::now();
            const Result r = render(engine, t, 20.0, 480);
            const double load = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count() / 20.0;
            std::printf("tempo %.0f bpm: peak %.3f, load %.1f %%\n", bpm, r.peak, 100 * load);
            CHECK(r.finite && r.peak < 1.0 && r.rms > 0.001);
            for (int l = 0; l < btg::Engine::layerCount; ++l) {
                const bool sounded = engine.takePeak(l) > 0.0f;
                if (!sounded) std::printf("tempo %.0f bpm: the layer %s is silent\n", bpm, btg::detail::LAYER_NAMES[l]);
                CHECK(sounded);
            }
            CHECK(load < 0.25);
        }
        // The echo's time in the engine, with the pad alone (sustained sines, echo 1, reverb and room 0, no limiter).
        std::string pad = band;
        for (const char* layer : { "drums", "bass", "chords", "lead", "percussion" }) {
            const std::string on = std::string("\"") + layer + "\":true";
            pad.replace(pad.find(on), on.size(), std::string("\"") + layer + "\":false");
        }
        const auto engineWith = [&](const char* sound) {
            auto e = std::make_unique<btg::Engine>();
            e->setPackSource(source);
            e->setSound(sound);
            e->setTrack(pad);
            e->setLimiter(false);
            e->prepare(rate);
            return e;
        };
        const char* ECHO = R"({"master":{"reverb":0,"echo":0.25,"roomWet":0}})"; // feedback 0.24: the repeats die within a second
        const char* NO_ECHO = R"({"master":{"reverb":0,"echo":0,"roomWet":0}})";
        // A start sets the time at once, never glides from the old tempo: an engine that played at 120 bpm, stopped and starts at 60 bpm
        // sounds exactly as a fresh one started at 60 bpm (a glide from 0.375 s to 0.75 s would show for the first 0.3 s).
        {
            auto used = engineWith(ECHO), fresh = engineWith(ECHO);
            btg::Transport t, t2;
            t.play(0.0, 120.0);
            render(*used, t, 2.0, 480);
            t.stop();
            render(*used, t, 0.3, 480);
            t.play(0.0, 60.0);
            t2.play(0.0, 60.0);
            const Result a = render(*used, t, 3.0, 480), b = render(*fresh, t2, 3.0, 480);
            double most = 0.0;
            for (size_t i = 0; i < a.left.size(); ++i) most = std::max(most, static_cast<double>(std::fabs(a.left[i] - b.left[i])));
            CHECK(b.peak > 0.01 && most == 0.0);
        }
        // A tempo change while playing glides: the wet part (echo minus its dry twin) of a pad that plays at 60 bpm and goes to 70 bpm at
        // 1.5 s has no jump (its largest step from one frame to the next stays below 0.08 of its level over the next 0.2 s; a jump of the
        // echo's time from 0.75 s to 0.643 s breaks the sines by a good part of their level), and the glide arrives: from 2.6 s (the repeats
        // of the glide have died) the wet part equals that of an engine that played at 70 bpm from the start (the pad's sine starts with its note).
        {
            const auto wetPart = [&](double startBpm, double changeAt, double toBpm) {
                auto e = engineWith(ECHO), dry = engineWith(NO_ECHO);
                btg::Transport t[2];
                std::vector<double> out[2];
                std::unique_ptr<btg::Engine>* both[2] = { &e, &dry };
                for (int k = 0; k < 2; ++k) t[k].play(0.0, startBpm);
                const auto run = [&](double seconds) { for (int k = 0; k < 2; ++k) for (const float x : render(**both[k], t[k], seconds, 480).left) out[k].push_back(x); };
                if (changeAt > 0) { run(changeAt); for (btg::Transport& x : t) x.setTempo(toBpm); run(3.4 - changeAt); } else run(3.4);
                for (size_t i = 0; i < out[0].size(); ++i) out[0][i] -= out[1][i];
                return out[0];
            };
            const std::vector<double> changed = wetPart(60.0, 1.5, 70.0), steady = wetPart(70.0, 0.0, 0.0);
            const size_t from = static_cast<size_t>(1.5 * rate), to = from + rate / 5;
            double level = 0.0, step = 0.0;
            for (size_t i = from; i < to; ++i) { level = std::max(level, std::fabs(changed[i])); step = std::max(step, std::fabs(changed[i] - changed[i - 1])); }
            double gap = 0.0, rms = 0.0;
            for (size_t i = static_cast<size_t>(2.6 * rate); i < static_cast<size_t>(3.3 * rate); ++i) { gap += (changed[i] - steady[i]) * (changed[i] - steady[i]); rms += steady[i] * steady[i]; }
            std::printf("echo glide: step %.3f of level %.4f, settled gap %.4f of rms\n", step / level, level, std::sqrt(gap / rms));
            CHECK(level > 0.005 && step < 0.08 * level); // measured 0.030; a jump of the time: 0.137
            CHECK(std::sqrt(gap / rms) < 0.15); // measured 0.068 (the note's length in seconds is fixed when it starts); a time that never arrives: 1.74
        }
    }

    // Live: a new track, a jump and a loop while playing do not break the stream.
    btg::Engine engine;
    engine.setPackSource(source);
    engine.setSound(DRY);
    engine.setTrack(track);
    engine.prepare(rate);
    btg::Transport live;
    live.play(0.0, engine.bpm());
    CHECK(render(engine, live, 2.0, 480).rms > 0.005);
    engine.setTrack(track);
    live.setTempo(180.0);
    live.seek(40.0);
    CHECK(render(engine, live, 2.0, 480).rms > 0.005);
    live.setLoop(40.0, 44.0);
    const Result looped = render(engine, live, 6.0, 480);
    CHECK(looped.rms > 0.005 && looped.peak <= 1.0);
    CHECK(live.beats() >= 40.0 && live.beats() < 44.0);
    live.stop();
    CHECK(render(engine, live, 1.0, 480).left.back() == 0.0f); // silent a second after the stop

    // A new start restarts the voices also when no stopped block falls between stop and play (the web UI's restart sends
    // stop, track, play back to back): 0.5 s after it, the engine sounds as a fresh one started there.
    {
        const auto from64 = [&](bool playedBefore) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(DRY);
            engine.setTrack(track);
            // its subject is the voices: the compressors keep their state across a restart without a stopped block (design open point 7), and
            // their gain remembers more than 0.5 s of the music before, which the peak follower of Phase 2 did not
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            if (playedBefore) {
                t.play(0.0, engine.bpm());
                render(engine, t, 1.0, 480);
            }
            t.play(64.0, engine.bpm());
            return render(engine, t, 2.0, 480);
        };
        const Result fresh = from64(false), restarted = from64(true);
        double most = 0.0;
        for (size_t i = rate / 2; i < fresh.left.size(); ++i) most = std::max(most, static_cast<double>(std::fabs(fresh.left[i] - restarted.left[i])));
        CHECK(most < 1e-6);
    }

    // The voice chosen plays (upright: the same test pack as finger, level 3 instead of 4 in tunables.js), a fine value acts
    // and is clamped, a synth voice is silent and says so. Drums muted, no limiter: the bass alone, linear.
    const auto bassOnly = [&](const char* voices, const char* tuning) {
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(DRY);
        engine.setTrack(track);
        engine.setVoices(voices);
        engine.setTuning(tuning);
        engine.setMuted(btg::Engine::drums, true);
        engine.setLimiter(false);
        engine.prepare(rate);
        btg::Transport t;
        t.play(64.0, engine.bpm());
        const double rms = render(engine, t, 5.0, 480).rms;
        return std::make_pair(rms, engine.voiceStatus());
    };
    const char* finger = R"({"bass":{"id":"sample","variant":"finger"}})";
    const auto plain = bassOnly(finger, "{}");
    const auto upright = bassOnly(R"({"bass":{"id":"sample","variant":"upright"}})", "{}");
    const auto quieter = bassOnly(finger, R"({"bass/sample/finger":{"level":2}})");
    const auto clamped = bassOnly(finger, R"({"bass/sample/finger":{"level":100}})");
    const auto broken = bassOnly(finger, "not json");
    const auto synth = bassOnly(R"({"bass":{"id":"synth","variant":"classic"}})", "{}");
    CHECK(plain.first > 0.005);
    // Linear only to about 0.1 %: a tone's release ends at an absolute floor of 0.0001, as in the web (sampler.js FLOOR).
    CHECK(std::fabs(upright.first / plain.first / 0.75 - 1) < 3e-3); // same draws (fork "voice-bass" of seed 1), only the level differs
    CHECK(std::fabs(quieter.first / plain.first / 0.5 - 1) < 3e-3);
    CHECK(std::fabs(clamped.first / plain.first / 2.0 - 1) < 3e-3);  // level is at most 8
    CHECK(broken.first == plain.first);                          // a tuning that is not JSON counts as none
    CHECK(synth.first == 0.0 && synth.second.find(R"("bass":"silent")") != std::string::npos);
    CHECK(plain.second.find(R"({"drums":"ready","bass":"ready",)") == 0);

    // Review Focus 1: a pack that is missing or cut off. Its layer is silent and says which pack and why; the others play.
    {
        btg::Engine engine;
        engine.setPackSource([](const std::string& id) -> std::shared_ptr<const btg::Pack> {
            static const unsigned char none[8] = {};
            if (id == "pad-strings") return btg::loadPackFiles("no-such-folder", id);                                        // the file is missing
            if (id == "chords-funk") return std::make_shared<const btg::Pack>(btg::loadPack(R"({"samples":[{"offset":0,)", none, sizeof none)); // the JSON is cut off
            return source(id);
        });
        engine.setSound(DRY);
        engine.setTrack(track);
        const std::string status = engine.voiceStatus();
        CHECK(status.find(R"("pad":"error: pad-strings: pack: cannot open no-such-folder/pad-strings.json")") != std::string::npos);
        CHECK(status.find(R"("chords":"error: chords-funk: )") != std::string::npos);
        CHECK(status.find(R"({"drums":"ready","bass":"ready",)") == 0);
        engine.prepare(rate);
        btg::Transport t;
        t.play(64.0, engine.bpm());
        const Result r = render(engine, t, 5.0, 480);
        CHECK(std::isfinite(r.rms) && r.rms > 0.01);
    }

    // A damaged pack (a sample rate that is zero, negative or infinite; loop points outside the sample; an offset that does not fit an int
    // or whose sum with the frames overflows) is an error of its layer: the status names the pack, the other layers play with finite samples.
    {
        const char* damaged[] = {
            R"({"offset":0,"frames":8,"rate":0})",
            R"({"offset":0,"frames":8,"rate":-44100})",
            R"({"offset":0,"frames":8,"rate":1e999})",
            R"({"offset":0,"frames":8,"loopStart":-1,"loopEnd":4})",
            R"({"offset":0,"frames":8,"loopStart":2,"loopEnd":9})",
            R"({"offset":0,"frames":8,"loopStart":9,"loopEnd":0})",
            R"({"offset":0,"frames":8,"loopStart":0,"loopEnd":-3})",
            R"({"offset":2000000000,"frames":2000000000})",  // 1e9 + 2e9 frames overflows an int
            R"({"offset":4294967296,"frames":8})",           // 2^32 bytes: truncated to 0 by a cast to int
            R"({"offset":9223372036854775807,"frames":9223372036854775807})", // offset/2 + frames overflows even a long long
            R"({"offset":0,"frames":8,"rate":1e-300})",      // a rate outside 1000 .. 1000000 Hz makes frames / rate huge
            R"({"offset":0,"frames":8,"rate":5e6})",
        };
        static const unsigned char audio[16] = {};
        for (const char* sample : damaged) {
            const std::string text = std::string(R"({"version":1,"samples":[)") + sample + R"(],"zones":[{"sample":0}]})";
            bool threw = false;
            try { btg::loadPack(text, audio, sizeof audio); } catch (const std::exception&) { threw = true; }
            CHECK(threw);
            if (!threw) std::printf("  not rejected: %s\n", sample);
            btg::Engine engine;
            engine.setPackSource([&](const std::string& id) -> std::shared_ptr<const btg::Pack> {
                if (id == "pad-strings") return std::make_shared<const btg::Pack>(btg::loadPack(text, audio, sizeof audio));
                return source(id);
            });
            engine.setSound(DRY);
            engine.setTrack(track);
            CHECK(engine.voiceStatus().find(R"("pad":"error: pad-strings: )") != std::string::npos);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            const Result r = render(engine, t, 2.0, 480);
            CHECK(std::isfinite(r.rms) && r.rms > 0.01);
        }
        // an id that is not a plain name never reaches the file system: the folder does not exist, yet the reason is the id
        for (const char* id : { "", "..", "../x", "a/b", "a\\b", "C:x", "a..b", "a b", "x.json/../y" }) {
            std::string reason;
            try { btg::loadPackFiles("no-such-folder", id); } catch (const std::exception& error) { reason = error.what(); }
            CHECK(reason.find("not a plain name") != std::string::npos);
        }
        // a good pack is still taken: loop points at the edges of the sample
        const char* fine = R"({"version":1,"samples":[{"offset":0,"frames":8,"rate":44100,"loopStart":0,"loopEnd":8}],"zones":[{"sample":0,"loop":true}]})";
        CHECK(btg::loadPack(fine, audio, sizeof audio).samples.size() == 1);
    }

    // Review Focus 2: the bass changes its voice in every block for 10 s. Old tones ring out and nothing clicks: the second
    // difference of these sines stays below 0.01; a cut tone jumps by its amplitude (0.1 and more). The voice does change:
    // the pick's test pack has half the amplitude, so the run is clearly quieter than with the finger voice alone.
    {
        double rms[2] = {};
        for (const bool alternate : { true, false }) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(DRY);
            engine.setTrack(track);
            engine.setMuted(btg::Engine::drums, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            std::vector<float> l(480), r(480), out;
            for (int block = 0; block < 1000; ++block) {
                engine.setVoices(alternate && block % 2 ? R"({"bass":{"id":"sample","variant":"pick"}})" : R"({"bass":{"id":"sample","variant":"finger"}})");
                const auto b = t.advance(480, rate);
                engine.render(l.data(), r.data(), b.frames, b);
                out.insert(out.end(), l.begin(), l.begin() + b.frames);
            }
            bool finite = true;
            double jump = 0.0, squares = 0.0;
            for (size_t i = 2; i < out.size(); ++i) {
                finite = finite && std::isfinite(out[i]);
                jump = std::max(jump, std::fabs(out[i] - 2.0 * out[i - 1] + out[i - 2]));
                squares += static_cast<double>(out[i]) * out[i];
            }
            rms[alternate ? 0 : 1] = std::sqrt(squares / static_cast<double>(out.size()));
            CHECK(finite);
            CHECK(jump < 0.01); // -40 dBFS
            CHECK(rms[alternate ? 0 : 1] > 0.005);
            CHECK(engine.voiceStatus().find(R"("bass":"ready")") != std::string::npos);
        }
        CHECK(std::fabs(rms[0] / rms[1] - 1) > 0.1);
    }

    // Review Focus 4: a jump or a loop wrap while a pad chord is held. The held tones end at once, 2.5 s later the output is
    // below -60 dBFS. The pad switches to a silent voice at the jump, so only what sounded before can still be heard.
    {
        std::string band = track;
        band.replace(band.find(R"("pad":false)"), 11, R"("pad":true)");
        double from = -1.0; // beat of the first pad note of at least 2 s (track-funk: 100 bpm; the same product as setTrack, to the bit)
        for (const btg::Event& e : btg::buildEvents(band))
            if (e.type == btg::Event::Type::note && e.layer == "pad" && e.dur >= 2.0) { from = e.t * (100.0 / 60.0); break; }
        CHECK(from >= 0.0);
        for (const bool loop : { false, true }) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(DRY);
            engine.setTrack(band);
            engine.setMuted(btg::Engine::drums, true);
            engine.setMuted(btg::Engine::bass, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            t.play(from, engine.bpm());
            CHECK(render(engine, t, 0.3, 480).rms > 0.001); // the pad sounds
            engine.setVoices(R"({"pad":{"id":"synth","variant":"classic"}})");
            if (loop) t.setLoop(from - 4.0, from + 1.0); else t.seek(from + 8.0);
            const Result after = render(engine, t, 2.6, 480);
            double tail = 0.0; // the last 0.1 s
            for (size_t i = after.left.size() - rate / 10; i < after.left.size(); ++i) tail = std::max(tail, static_cast<double>(std::fabs(after.left[i])));
            CHECK(tail < 0.001);
        }
        // A block that stands still where the last one ended (btg_render's 0.2 s after the song) is no jump: the held pad tone keeps
        // its level. One frame further on (1/28800 beat at 100 bpm, 48 kHz) is a jump, and the tone's release begins.
        for (const double off : { 0.0, 1.0 / 28800 }) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(DRY);
            engine.setTrack(band);
            engine.setMuted(btg::Engine::drums, true);
            engine.setMuted(btg::Engine::bass, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            t.play(from, engine.bpm());
            std::vector<float> l(480), r(480), out;
            btg::Transport::Block last;
            for (int i = 0; i < 60; ++i) { // 0.6 s: past the swell (0.37 s) of the chord held for 2.4 s
                last = t.advance(480, rate);
                engine.render(l.data(), r.data(), last.frames, last);
                out.insert(out.end(), l.begin(), l.begin() + last.frames);
            }
            const btg::Transport::Block stand { true, last.beats + last.frames * last.beatsPerFrame + off, 0.0, 480, last.starts };
            for (int i = 0; i < 50; ++i) { // 0.5 s
                engine.render(l.data(), r.data(), stand.frames, stand);
                out.insert(out.end(), l.begin(), l.end());
            }
            const auto rms = [&](size_t at) { double s = 0.0; for (size_t i = at; i < at + rate / 10; ++i) s += static_cast<double>(out[i]) * out[i]; return std::sqrt(s / (rate / 10)); };
            // the last 0.1 s against the 0.1 s before the stand (measured 0.985 and 0.136; the chord's three sines beat a little)
            const double kept = rms(out.size() - rate / 10) / rms(28800 - rate / 10);
            CHECK(off == 0.0 ? kept > 0.9 : kept < 0.5);
        }
    }

    // A slide's tone begins before its note (the lead). A start, a seek or a loop that lands on the note still plays it, with what
    // is left of the lead. Until the jump the bass plays a silent voice, so the 0.1 s after it hold only the slide's tone.
    {
        double slide = -1.0; // beat of the first bass slideIn with a lead (track-funk: 100 bpm)
        for (const btg::Event& e : btg::buildEvents(track))
            if (e.type == btg::Event::Type::note && e.layer == "bass" && e.art == "slideIn" && e.t > 0.02) { slide = e.t * (100.0 / 60.0); break; }
        CHECK(slide > 0.0);
        for (const int how : { 0, 1, 2 }) { // start there, seek there, a loop that starts there wraps
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(DRY);
            engine.setTrack(track);
            engine.setMuted(btg::Engine::drums, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            if (how > 0) {
                engine.setVoices(R"({"bass":{"id":"synth","variant":"classic"}})");
                if (how == 2) t.setLoop(slide, slide + 1.0);
                t.play(how == 1 ? slide - 8.0 : slide + 0.5, engine.bpm());
                render(engine, t, 0.3, 480); // the loop: up to its end
                engine.setVoices(R"({"bass":{"id":"sample","variant":"finger"}})");
                if (how == 1) t.seek(slide);
            } else {
                t.play(slide, engine.bpm());
            }
            const Result after = render(engine, t, 0.15, 480);
            double squares = 0.0; // 0.02 s to 0.12 s: the slide's note is 0.13 s long
            for (int i = rate / 50; i < rate * 12 / 100; ++i) squares += static_cast<double>(after.left[i]) * after.left[i];
            CHECK(std::sqrt(squares / (rate / 10)) > 0.01);
        }
    }

    // A format-1 kit plays through the key table of sound.json (hitKeys "drums").
    {
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(DRY);
        engine.setTrack(track);
        engine.setVoices(R"({"drums":{"id":"sample","variant":"brushes"}})");
        engine.setMuted(btg::Engine::bass, true);
        engine.prepare(rate);
        btg::Transport t;
        t.play(64.0, engine.bpm());
        CHECK(engine.voiceStatus().find(R"({"drums":"ready",)") == 0);
        CHECK(render(engine, t, 5.0, 480).rms > 0.01);
    }

    // Chokes land on the web's time: a self-choke 0.1 s after the hit's own start, a closed hat at its own time on an open hat that began
    // earlier in the same chunk (the tone's frame count starts at its own start, not at the chunk's). Both formats; a constant sample,
    // so the choke is the frame where the level has fallen by 1 %. At 12 ms time constant that is 6 frames after the choke begins.
    for (const bool v2 : { true, false }) {
        using namespace btg::detail;
        const std::string key = v2 ? "drums/sample/standard" : "drums/sample/brushes";
        const auto voice = makeVoice(btg::Engine::drums, key, dcKit(v2), {}, Timbre {});
        CHECK(voice != nullptr);
        if (!voice) continue;
        const auto nameIndex = [](const char* name) { return static_cast<int>(std::find_if(std::begin(HIT_NAMES), std::end(HIT_NAMES), [&](const char* n) { return std::string(n) == name; }) - std::begin(HIT_NAMES)); };
        const auto fallsAt = [&](Tone& tone) { // frame of the first fall below 99 % of the plateau
            std::vector<float> l(20000), r(20000);
            tone.render(l.data(), r.data(), 20000);
            size_t top = 0;
            for (size_t i = 0; i < l.size(); ++i) if (l[i] > l[top]) top = i;
            for (size_t i = top; i < l.size(); ++i) if (l[i] < 0.99f * l[top]) return static_cast<int>(i);
            return -1;
        };
        {   // a crash with art choke 0.1 s that starts at frame 200 of its chunk
            auto tones = std::make_unique<Tones>();
            tones->sr = rate;
            VoiceState state;
            state.rng = voice->startRng;
            PlayEvent e;
            e.hit = true;
            e.name = nameIndex("crash");
            e.vel = 1.0;
            e.art = Art::choke;
            e.artTime = 0.1;
            voice->play(e, 200, 0.5, state, *tones);
            const int at = fallsAt(tones->all[0]);
            CHECK(std::abs(at - (200 + 4800)) < 48); // 0.1 s after its own start, within 1 ms
        }
        if (v2) continue; // the closing hat's rule is format 1's
        {   // an open hat at frame 100, a closed hat at frame 250 of the same chunk
            auto tones = std::make_unique<Tones>();
            tones->sr = rate;
            VoiceState state;
            state.rng = voice->startRng;
            PlayEvent e;
            e.hit = true;
            e.vel = 1.0;
            e.name = nameIndex("openHat");
            voice->play(e, 100, 0.5, state, *tones);
            e.name = nameIndex("hat");
            voice->play(e, 250, 0.5, state, *tones);
            const int at = fallsAt(tones->all[0]);
            CHECK(std::abs(at - 250) < 48); // at the closed hat's time, within 1 ms
        }
    }

    // A hand-filled first block that stands still (beatsPerFrame 0) between a slide's trigger and its note. A still block plays only
    // such a late event (on the regular path its events would lie before the place, which no first block has); with no step to divide
    // by, it starts at frame 0. Unguarded, (ahead - lead) / 0 is +inf and its cast to int undefined: ARM64 saturates to INT_MAX (the tone
    // never starts), x64 gives INT_MIN (it starts at once as well).
    {
        double slide = -1.0, lead = 0.0;
        for (const btg::Event& e : btg::buildEvents(track))
            if (e.type == btg::Event::Type::note && e.layer == "bass" && e.art == "slideIn" && e.t > 0.02) {
                slide = e.t * (100.0 / 60.0);
                lead = std::min(e.artTime ? *e.artTime : 0.08, e.t) * (100.0 / 60.0);
                break;
            }
        CHECK(slide > 0.0 && lead > 0.0);
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(DRY);
        engine.setTrack(track);
        engine.setMuted(btg::Engine::drums, true);
        engine.setLimiter(false); // no look-ahead: frame 0 of the output is frame 0 of the tone
        engine.prepare(rate);
        std::vector<float> l(480), r(480);
        const btg::Transport::Block still { true, slide - lead / 2, 0.0, 480, 1 };
        engine.render(l.data(), r.data(), still.frames, still);
        double squares = 0.0;
        for (int i = 0; i < 200; ++i) squares += static_cast<double>(l[i]) * l[i];
        CHECK(std::sqrt(squares / 200) > 0.01); // the first 200 frames: silent when the tone starts anywhere after them
    }

    // The balance of the web mixer: left 1 - p, right 1 + p. A pan of NaN puts the layer where mix/pan says.
    const auto sides = [&](btg::Engine::Layer layer, const char* voices, float pan, const char* tuning) {
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(DRY);
        engine.setTrack(track);
        engine.setVoices(voices);
        engine.setTuning(tuning);
        engine.setMuted(layer == btg::Engine::bass ? btg::Engine::drums : btg::Engine::bass, true);
        engine.setLimiter(false);
        engine.setPan(layer, pan);
        engine.prepare(rate);
        btg::Transport t;
        t.play(64.0, engine.bpm());
        const Result r = render(engine, t, 5.0, 480);
        return r.rmsRight / r.rms;
    };
    const char* fingerBass = R"({"bass":{"id":"sample","variant":"finger"}})";
    CHECK(std::fabs(sides(btg::Engine::bass, fingerBass, 0.5f, "{}") - 3.0) < 0.01);                                       // 1.5 / 0.5
    CHECK(std::fabs(sides(btg::Engine::bass, fingerBass, NAN, "{}") - 1.0) < 0.01);                                        // mix/pan bass: 0
    CHECK(std::fabs(sides(btg::Engine::bass, fingerBass, NAN, R"({"mix/pan":{"bass":-0.5}})") - 1.0 / 3.0) < 0.01);
    // Kit pan: a format-1 kit spreads its hits by mix/pan "kit" (hi-hat right, crash and floor tom left); a format-2 kit (kitPan 0) does not.
    const char* brushes = R"({"drums":{"id":"sample","variant":"brushes"}})";
    const char* standard = R"({"drums":{"id":"sample","variant":"standard"}})";
    CHECK(std::fabs(sides(btg::Engine::drums, brushes, 0.0f, R"({"mix/pan":{"kit":0}})") - 1.0) < 1e-6);
    CHECK(sides(btg::Engine::drums, brushes, 0.0f, "{}") > 1.02);
    CHECK(std::fabs(sides(btg::Engine::drums, standard, 0.0f, "{}") - sides(btg::Engine::drums, standard, 0.0f, R"({"mix/pan":{"kit":0}})")) < 1e-9);

    // setSound: master.width spreads the layers (synth.js 173: mix.width = 2 * master.width times the pan, then clamped): width 0 is mono,
    // 1 doubles the bass's pan of 0.25 to 0.5 (1.5 / 0.5), the neutral 0.5 keeps it (1.25 / 0.75). A timbre that is no JSON is the neutral one.
    // The timbres are dry (reverb, echo and room at 0) so that only the dry layers are measured, also once the sends exist (Task 14).
    {
        const auto ratio = [&](const char* sound) {
            btg::Engine engine;
            engine.setPackSource(source);
            engine.setSound(sound);
            engine.setTrack(track);
            engine.setMuted(btg::Engine::drums, true);
            engine.setLimiter(false);
            engine.setPan(btg::Engine::bass, 0.25f);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            const Result r = render(engine, t, 5.0, 480);
            return r.rmsRight / r.rms;
        };
        CHECK(std::fabs(ratio(R"({"master":{"width":0,"reverb":0,"echo":0,"roomWet":0}})") - 1.0) < 1e-6);
        CHECK(std::fabs(ratio(R"({"master":{"width":1,"reverb":0,"echo":0,"roomWet":0}})") - 3.0) < 0.01);
        CHECK(std::fabs(ratio(R"({"master":{"reverb":0,"echo":0,"roomWet":0}})") - 1.25 / 0.75) < 0.01);
        CHECK(ratio("no json") == ratio("{}"));
    }
    // Review Focus 5, pitch: the bass test tone (a 200-frame sine at 22050 Hz, root key 45: 110.25 Hz) at key 57 is 220.5 Hz at 44.1, 48
    // and 96 kHz, within 2 cents, measured between the first and the last upward zero crossing after 0.1 s.
    for (const double sr : { 44100.0, 48000.0, 96000.0 }) {
        const auto pack = tonePack(45, 0.5f, 0.2);
        auto tones = std::make_unique<btg::detail::Tones>(); // 256 tones: too large for the stack
        tones->sr = sr;
        tones->start({ .pack = pack.get(), .zone = &pack->zones[0], .sample = 0, .key = 57, .dur = 2.0, .vel = 1.0, .layer = btg::Engine::bass });
        std::vector<float> l(static_cast<size_t>(sr)), r(l.size());
        for (size_t at = 0; at < l.size(); at += 256)
            for (btg::detail::Tone& t : tones->all) if (t.active) t.render(&l[at], &r[at], static_cast<int>(std::min<size_t>(256, l.size() - at)));
        double first = -1.0, last = -1.0;
        int crossings = 0;
        for (size_t i = static_cast<size_t>(0.1 * sr); i + 1 < l.size(); ++i)
            if (l[i] <= 0 && l[i + 1] > 0) {
                last = (static_cast<double>(i) + l[i] / (l[i] - l[i + 1])) / sr;
                if (first < 0) first = last;
                ++crossings;
            }
        CHECK(std::fabs(1200 * std::log2((crossings - 1) / (last - first) / 220.5)) < 2);
    }
    // ... the engine builds the responses for the rate it is prepared at: at 44.1 and 96 kHz the drums' reverb rings on after the song stands
    // (the last hit dies within 0.2 s) until about 2.14 s, and is gone from 2.25 s on (a response built for 48 kHz would ring at 44.1 kHz until
    // about 2.32 s, and end at 96 kHz before 1.6 s). Played from beat 64: the fixture's intro (9.6 s) has no drums.
    for (const double sr : { 44100.0, 96000.0 }) {
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setSound(R"({"master":{"reverb":1,"echo":0,"roomWet":0}})");
        engine.setTrack(track);
        engine.setMuted(btg::Engine::bass, true);
        engine.setLimiter(false);
        engine.prepare(sr);
        btg::Transport t;
        t.play(64.0, engine.bpm());
        std::vector<float> l(480), r(480), after;
        btg::Transport::Block b;
        for (double done = 0; done < 2.0 * sr; done += b.frames) { b = t.advance(480, sr); engine.render(l.data(), r.data(), b.frames, b); }
        const btg::Transport::Block still { true, b.beats + b.frames * b.beatsPerFrame, 0.0, 480, b.starts };
        while (after.size() < 2.6 * sr) { engine.render(l.data(), r.data(), 480, still); after.insert(after.end(), l.begin(), l.end()); }
        const auto peak = [&](double from, double to) {
            double p = 0.0;
            for (size_t i = static_cast<size_t>(from * sr); i < static_cast<size_t>(to * sr); ++i) p = std::max(p, std::fabs(static_cast<double>(after[i])));
            return p;
        };
        CHECK(peak(1.6, 1.9) > 1e-6);
        CHECK(peak(2.25, 2.6) < 1e-9);
    }
    // A stop: the wet returns fade with the web's 0.05 s (play.js FADE), 0.2 s after it everything is exactly silent; a start after that
    // sounds as a fresh engine (reverb, room and their filters start empty, as the web's new graph at every play()). From beat 64 the
    // drums and the bass still sound when the fade ends (the choke takes about 0.14 s), and their tails go into the closed sends after it.
    for (const double from : { 0.0, 64.0 }) {
        const char* WET = R"({"master":{"reverb":1,"roomWet":1}})";
        btg::Engine used, fresh;
        for (btg::Engine* e : { &used, &fresh }) { e->setPackSource(source); e->setSound(WET); e->setTrack(track); e->setLimiter(false); e->prepare(rate); }
        btg::Transport t, t2;
        t.play(from, used.bpm());
        render(used, t, 2.0, 480);
        t.stop();
        const Result after = render(used, t, 0.3, 480);
        double late = 0.0;
        for (size_t i = rate / 5; i < after.left.size(); ++i) late = std::max(late, std::fabs(static_cast<double>(after.left[i])));
        CHECK(late == 0.0);
        t.play(0.0, used.bpm());
        t2.play(0.0, fresh.bpm());
        CHECK(render(used, t, 0.5, 480).left == render(fresh, t2, 0.5, 480).left);
    }
    // The stop as heard, from beat 64: the wet part of the output (the difference to a dry twin: the same engine, track and transport with
    // reverb, echo and room at 0) fades linearly over the 2400 frames of 0.05 s from the peak it had before the stop, and is exactly 0 from
    // the fade's end on, while the choke tails still ring and feed the sends. A start 80 ms after the stop (the fade over, the tails still
    // ringing) sounds wet as a fresh engine started there (measured 5e-5 of its peak apart: the tails after the start); a start 20 ms after
    // it (inside the fade) brings back no tail of what played before the stop: from the fade's end on its wet part is the same whether beat
    // 64 or beat 32 played before (measured 9e-4 apart: the choke tails; uncleared sends 0.26). Limits 1 % of the peak.
    {
        const char* WET = R"({"master":{"reverb":1,"roomWet":1}})";
        // play `before` s from beat `from` and stop for `stopped` s (neither when before is 0), then play `after` s from beat 64; wet minus dry, left
        const auto wetPart = [&](double from, double before, double stopped, double after) {
            btg::Engine e[2];
            btg::Transport t[2];
            std::vector<double> out[2];
            for (int k = 0; k < 2; ++k) { e[k].setPackSource(source); e[k].setSound(k ? DRY : WET); e[k].setTrack(track); e[k].setLimiter(false); e[k].prepare(rate); }
            const auto run = [&](double seconds) { for (int k = 0; k < 2; ++k) for (const float x : render(e[k], t[k], seconds, 480).left) out[k].push_back(x); };
            if (before > 0) {
                for (btg::Transport& x : t) x.play(from, e[0].bpm());
                run(before);
                for (btg::Transport& x : t) x.stop();
                run(stopped);
            }
            for (btg::Transport& x : t) x.play(64.0, e[0].bpm());
            run(after);
            for (size_t i = 0; i < out[0].size(); ++i) out[0][i] -= out[1][i];
            return out[0];
        };
        const auto peakIn = [](const std::vector<double>& x, size_t from, size_t to) { double p = 0.0; for (size_t i = from; i < to; ++i) p = std::max(p, std::fabs(x[i])); return p; };
        const auto rmsIn = [](const std::vector<double>& x, size_t from, size_t to) { double s = 0.0; for (size_t i = from; i < to; ++i) s += x[i] * x[i]; return std::sqrt(s / static_cast<double>(to - from)); };
        const size_t stop = 2 * rate, fade = rate / 20; // the stop's frame, the fade's frames
        const std::vector<double> stopped = wetPart(64.0, 2.0, 0.3, 0.0), fresh = wetPart(64.0, 0.0, 0.0, 0.5);
        const double before = peakIn(stopped, 0, stop);
        double over = 0.0; // the most a frame of the fade lies above the line from that peak to 0 (one frame allowed for rounding), in units of the peak
        for (size_t n = 0; n < fade; ++n) over = std::max(over, std::fabs(stopped[stop + n]) / before - (1 - (static_cast<double>(n) - 1) / fade));
        const double fadeLevel = rmsIn(stopped, stop, stop + 480) / rmsIn(stopped, stop - 480, stop);
        const double afterFade = peakIn(stopped, stop + fade, stopped.size());
        const std::vector<double> late = wetPart(64.0, 2.0, 0.08, 0.5), early = wetPart(64.0, 2.0, 0.02, 0.5), early32 = wetPart(32.0, 2.0, 0.02, 0.5);
        double most = 0.0;
        for (size_t i = 0; i < fresh.size(); ++i) most = std::max(most, std::fabs(late[stop + rate * 8 / 100 + i] - fresh[i]));
        const double lateGap = most / peakIn(fresh, 0, fresh.size());
        most = 0.0;
        for (size_t i = stop + fade; i < early.size(); ++i) most = std::max(most, std::fabs(early[i] - early32[i]));
        const double earlyGap = most / peakIn(early, stop + fade, early.size());
        CHECK(before > 0.01 && over <= 0.0);
        CHECK(fadeLevel > 0.5);  // a fade, not a cut
        CHECK(afterFade == 0.0); // the returns stay closed
        CHECK(lateGap < 0.01);   // the start empties the sends
        CHECK(earlyGap < 0.01);  // the fade's end empties them
    }

    // setSound reaches the voices, in the order the app sends it (setTuning, setTrack, setSound; play.js) and while playing. The bass plays a
    // tone of 2205 Hz at its root, so that cutoff 0 (a lowpass at 400 Hz) takes a lot of it away: that effect lives in the voice, not in the sum.
    // Every engine starts from DRY (neutral voices, no sends), so that only the dry bass is compared.
    {
        const auto bright = [](const std::string& id) -> std::shared_ptr<const btg::Pack> { return id == "bass-finger" ? tonePack(45, 0.5f, 0.2, 10) : source(id); };
        const char* dark = R"({"bass":{"cutoff":0},"master":{"reverb":0,"echo":0,"roomWet":0}})";
        const auto heard = [&](const char* sound, bool afterTrack) {
            btg::Engine engine;
            engine.setPackSource(bright);
            engine.setSound(DRY);
            if (sound && !afterTrack) engine.setSound(sound);
            engine.setTrack(track);
            if (sound && afterTrack) engine.setSound(sound);
            engine.setMuted(btg::Engine::drums, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            return render(engine, t, 5.0, 480);
        };
        const Result neutral = heard(nullptr, false), before = heard(dark, false), after = heard(dark, true);
        CHECK(before.rms < 0.7 * neutral.rms); // the timbre acts in the voice
        CHECK(after.left == before.left);      // setSound after setTrack sounds as setSound before it
        // setSound while playing: what starts after it sounds as the timbre says (the bass's notes end within a bar, 2.4 s), as in an
        // engine that had the timbre from the start; with no setSound after DRY it stays neutral.
        const auto changing = [&](const char* sound, bool atStart) {
            btg::Engine engine;
            engine.setPackSource(bright);
            engine.setSound(DRY);
            if (sound && atStart) engine.setSound(sound);
            engine.setTrack(track);
            engine.setMuted(btg::Engine::drums, true);
            engine.setLimiter(false);
            engine.prepare(rate);
            btg::Transport t;
            t.play(64.0, engine.bpm());
            render(engine, t, 1.0, 480);
            if (sound && !atStart) engine.setSound(sound);
            return render(engine, t, 5.0, 480).left;
        };
        const auto fromStart = changing(dark, true), whilePlaying = changing(dark, false), never = changing(nullptr, false);
        const size_t from = 3 * rate, to = 5 * rate;
        CHECK(std::fabs(rmsOf(whilePlaying, from, to) / rmsOf(fromStart, from, to) - 1.0) < 1e-3);
        CHECK(rmsOf(never, from, to) > 1.2 * rmsOf(fromStart, from, to));
    }

    // The sampler's timbre, voice by voice: the lowpass of the brightness knobs (bass.cutoff, chords.brightness, pad.cutoff), the time scale of
    // chords.length and pad.attack, the kit's pan by the width. Notes of a tone at 2205 Hz, above the lowpass at 400 Hz of knob 0.
    {
        using namespace btg::detail;
        const auto timed = [](double attack, double release) { auto p = std::make_shared<btg::Pack>(*tonePack(45, 0.5f, release, 10)); p->zones[0].attack = attack; return std::shared_ptr<const btg::Pack>(p); };
        struct Knob { btg::Engine::Layer layer; const char* key; double* (*field)(Timbre&); };
        const Knob lowpass[] = { { btg::Engine::bass, "bass/sample/finger", [](Timbre& t) { return &t.bass.cutoff; } },
                                 { btg::Engine::chords, "chords/sample/funk", [](Timbre& t) { return &t.chords.brightness; } },
                                 { btg::Engine::pad, "pad/sample/strings", [](Timbre& t) { return &t.pad.cutoff; } } };
        for (const Knob& k : lowpass) {
            const auto level = [&](double value) { Timbre t; *k.field(t) = value; return rmsOf(noteOf(k.layer, k.key, timed(0.0, 0.2), t, 45, 0.5, rate / 2), rate / 10, rate / 2); };
            const double dark = level(0.0), quarter = level(0.1), middle = level(0.5), open = level(1.0);
            CHECK(dark < 0.4 * middle);                  // 400 Hz against a tone of 2205 Hz
            CHECK(quarter > dark && quarter < middle);
            CHECK(middle == open);                       // from 0.5 up the voice is not filtered
        }
        const Knob scaled[] = { { btg::Engine::chords, "chords/sample/funk", [](Timbre& t) { return &t.chords.length; } },
                                { btg::Engine::pad, "pad/sample/strings", [](Timbre& t) { return &t.pad.attack; } } };
        for (const Knob& k : scaled) {
            const auto times = [&](double value) { Timbre t; *k.field(t) = value; return envelopeOf(noteOf(k.layer, k.key, timed(0.1, 0.6), t, 45, 1.0, 3 * rate, "{\"chords/sample/funk\":{\"decay\":10,\"oneShot\":0}}"), 1.0); }; // the guitar's natural decay at its slowest, no one-shot end of the sample
            const Envelope shortest = times(0.0), middle = times(0.5), longest = times(1.0);
            CHECK(std::fabs(middle.rise - 0.05) < 0.01 && middle.fall > 0.05);           // attack 0.1 s reaches half at 0.05 s
            CHECK(std::fabs(longest.rise / middle.rise / 3 - 1) < 0.12 && std::fabs(longest.fall / middle.fall / 3 - 1) < 0.12);
            CHECK(std::fabs(shortest.rise / middle.rise * 3 - 1) < 0.12 && std::fabs(shortest.fall / middle.fall * 3 - 1) < 0.12);
        }
        // the lead has neither (sample.js 46 to 75)
        Timbre all;
        all.bass.cutoff = all.chords.brightness = all.pad.cutoff = 0.0;
        all.chords.length = all.pad.attack = 1.0;
        CHECK(noteOf(btg::Engine::lead, "lead/sample/flute", timed(0.1, 0.6), all, 45, 1.0, rate) == noteOf(btg::Engine::lead, "lead/sample/flute", timed(0.1, 0.6), Timbre {}, 45, 1.0, rate));
        // the kit's pan: width * mix/pan kit * the hat's place (KIT_PAN), as a ratio of the right to the left level of a constant sample
        const auto nameIndex = [](const char* name) { return static_cast<int>(std::find_if(std::begin(HIT_NAMES), std::end(HIT_NAMES), [&](const char* n) { return std::string(n) == name; }) - std::begin(HIT_NAMES)); };
        const auto hatSides = [&](double width) {
            Timbre t;
            t.master.width = width;
            const auto voice = makeVoice(btg::Engine::drums, "drums/sample/brushes", dcKit(false), {}, t);
            auto tones = std::make_unique<Tones>();
            tones->sr = rate;
            VoiceState state;
            state.rng = voice->startRng;
            PlayEvent e;
            e.hit = true;
            e.vel = 1.0;
            e.name = nameIndex("hat");
            voice->play(e, 0, 0.5, state, *tones);
            std::vector<float> left(4000), right(4000);
            for (Tone& tone : tones->all) if (tone.active) tone.render(left.data(), right.data(), 4000);
            return right[3000] / left[3000];
        };
        const double place = soundData().kitPan.at("hat") * tunedValue("mix/pan", "kit", {});
        for (const double width : { 0.0, 0.25, 0.5, 1.0 }) {
            const double pan = std::min(1.0, 2 * width * place); // mix.width = 2 * master.width
            CHECK(place > 0.0 && std::fabs(hatSides(width) - (1 + pan) / (1 - pan)) < 1e-4);
        }
    }

    std::printf(failures ? "%d check(s) failed\n" : "all checks passed\n", failures);
    return failures ? 1 : 0;
}
