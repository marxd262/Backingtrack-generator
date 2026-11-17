#include "btg/engine.h"
#include "btg/pack.h"
#include "btg/transport.h"

#include <cmath>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
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
static std::shared_ptr<const btg::Pack> bassPack() {
    auto pack = std::make_shared<btg::Pack>();
    pack->samples.push_back({ 0, 22050, 22050.0, 1000, 21000 });
    for (int i = 0; i < 22050; ++i) pack->audio.push_back(std::sin(2 * 3.14159265 * 110 * i / 22050.0));
    btg::Pack::Zone zone;
    zone.rootKey = 45;
    zone.loop = true;
    zone.hold = 4;
    zone.release = 0.2;
    pack->zones.push_back(zone);
    return pack;
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

    // Engine with the fixture track.
    if (argc < 2) { std::printf("usage: btg_engine_tests <track.json>\n"); return 2; }
    std::ifstream file(argv[1], std::ios::binary);
    const std::string track((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    CHECK(!track.empty());
    const auto play = [&](int blockSize, float drive, bool muteAll, double startBeats) {
        btg::Engine engine;
        engine.setPack(btg::Engine::drums, kit());
        engine.setPack(btg::Engine::bass, bassPack());
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
    engine.setPack(btg::Engine::drums, kit());
    engine.setPack(btg::Engine::bass, bassPack());
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

    std::printf(failures ? "%d check(s) failed\n" : "all checks passed\n", failures);
    return failures ? 1 : 0;
}
