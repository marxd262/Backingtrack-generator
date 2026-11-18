#include "btg/engine.h"
#include "btg/generator.h"
#include "btg/pack.h"
#include "btg/transport.h"

#include "../src/sampler.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

static int failures = 0;
#define CHECK(cond) \
    do { if (!(cond)) { std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); ++failures; } } while (0)

static const int rate = 48000;

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
// A looped sine of 200 frames per period; the loop holds exactly 100 periods, so the seam does not click.
static std::shared_ptr<const btg::Pack> tonePack(int rootKey, float amplitude, double release) {
    auto pack = std::make_shared<btg::Pack>();
    pack->samples.push_back({ 0, 22050, 22050.0, 1000, 21000 });
    for (int i = 0; i < 22050; ++i) pack->audio.push_back(amplitude * static_cast<float>(std::sin(2 * 3.14159265358979 * i / 200.0)));
    btg::Pack::Zone zone;
    zone.rootKey = rootKey;
    zone.loop = true;
    zone.hold = 4;
    zone.release = release;
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
    throw std::runtime_error("not in the test: " + id);
}

// |H| in dB of a biquad at `hz`.
static double gainDb(const btg::detail::Biquad& f, double hz, double sr) {
    const std::complex<double> z = std::polar(1.0, -2 * 3.14159265358979 * hz / sr); // e^-jw
    return 20 * std::log10(std::abs((f.b0 + f.b1 * z + f.b2 * z * z) / (1.0 + f.a1 * z + f.a2 * z * z)));
}

struct Result { std::vector<float> left; double rms = 0.0, peak = 0.0; };

static Result render(btg::Engine& engine, btg::Transport& transport, double seconds, int blockSize) {
    Result r;
    std::vector<float> l(blockSize), rr(blockSize);
    for (int done = 0; done < seconds * rate;) {
        const auto block = transport.advance(blockSize, rate);
        engine.render(l.data(), rr.data(), block.frames, block);
        for (int i = 0; i < block.frames; ++i) {
            r.left.push_back(l[i]);
            r.rms += l[i] * l[i];
            r.peak = std::max(r.peak, static_cast<double>(std::fabs(l[i])));
        }
        done += block.frames;
    }
    r.rms = std::sqrt(r.rms / static_cast<double>(r.left.size()));
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

    // Engine with the fixture track.
    if (argc < 2) { std::printf("usage: btg_engine_tests <track.json>\n"); return 2; }
    std::ifstream file(argv[1], std::ios::binary);
    const std::string track((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    CHECK(!track.empty());
    const auto play = [&](int blockSize, float drive, bool muteAll, double startBeats) {
        btg::Engine engine;
        engine.setPackSource(source);
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

    // Live: a new track, a jump and a loop while playing do not break the stream.
    btg::Engine engine;
    engine.setPackSource(source);
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
            engine.setTrack(track);
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

    // Review Focus 2: the bass changes its voice in every block for 10 s. Old tones ring out and nothing clicks: the second
    // difference of these sines stays below 0.01; a cut tone jumps by its amplitude (0.1 and more). The voice does change:
    // the pick's test pack has half the amplitude, so the run is clearly quieter than with the finger voice alone.
    {
        double rms[2] = {};
        for (const bool alternate : { true, false }) {
            btg::Engine engine;
            engine.setPackSource(source);
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
        const auto voice = makeVoice(btg::Engine::drums, key, dcKit(v2), {});
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

    // A hand-filled first block that stands still (beatsPerFrame 0) on the downbeat of a slide: the late event has no step to
    // divide by, so it starts at the beginning of the chunk. No crash, finite samples.
    {
        double slide = -1.0;
        for (const btg::Event& e : btg::buildEvents(track))
            if (e.type == btg::Event::Type::note && e.layer == "bass" && e.art == "slideIn" && e.t > 0.02) { slide = e.t * (100.0 / 60.0); break; }
        CHECK(slide > 0.0);
        btg::Engine engine;
        engine.setPackSource(source);
        engine.setTrack(track);
        engine.setMuted(btg::Engine::drums, true);
        engine.prepare(rate);
        std::vector<float> l(480), r(480);
        const btg::Transport::Block still { true, slide, 0.0, 480, 1 };
        engine.render(l.data(), r.data(), still.frames, still);
        bool finite = true;
        for (int i = 0; i < 480; ++i) finite = finite && std::isfinite(l[i]) && std::isfinite(r[i]);
        CHECK(finite);
    }

    std::printf(failures ? "%d check(s) failed\n" : "all checks passed\n", failures);
    return failures ? 1 : 0;
}
