#include "btg/analysis.h"
#include "btg/decode.h"
#include "btg/file_player.h"
#ifdef BTG_BEAT_MODEL
#include "btg/beat_model.h"
#endif

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <vector>

static int failures = 0;
#define CHECK(cond) \
    do { if (!(cond)) { std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); ++failures; } } while (0)

int main() {
    // A track built here: 96 bpm, a click on every beat, one triad per bar with its root in the bass: Am F C G.
    const int rate = 22050, bars = 24;
    const double beat = 60.0 / 96, pi = 3.14159265358979;
    const int roots[4] = { 9, 5, 0, 7 };
    const bool minor[4] = { true, false, false, false };
    // A bar of a test track. tones: the upper voices, each as semitones above C (octave 3) and its level; bass:
    // semitones above C, two octaves lower. upperEarly, bassEarly: how long before the bar line they begin.
    struct Bar { std::vector<std::pair<int, double>> tones; int bass; double upperEarly = 0, bassEarly = 0; };
    const auto buildBars = [&](const std::vector<Bar>& cycle, unsigned int& noise) {
        std::vector<float> mono(static_cast<size_t>(bars * 4 * beat * rate));
        for (size_t i = 0; i < mono.size(); ++i) {
            const double t = static_cast<double>(i) / rate, inBeat = std::fmod(t, beat);
            const size_t bar = static_cast<size_t>(t / (4 * beat));
            const Bar& here = cycle[bar % cycle.size()];
            const Bar& next = cycle[(bar + 1) % cycle.size()];
            const double line = static_cast<double>(bar + 1) * 4 * beat;
            double x = 0.0;
            for (const auto& [tone, level] : (t + next.upperEarly >= line ? next : here).tones)
                x += level * std::sin(2 * pi * 440 * std::pow(2.0, (tone - 9) / 12.0 - 1) * t);
            x += 0.25 * std::sin(2 * pi * 440 * std::pow(2.0, ((t + next.bassEarly >= line ? next : here).bass - 9) / 12.0 - 3) * t);
            noise = noise * 1664525u + 1013904223u;
            x += 0.5 * (static_cast<double>(noise >> 8) / 8388608.0 - 1.0) * std::exp(-inBeat / 0.01);              // click
            mono[i] = static_cast<float>(x);
        }
        return mono;
    };
    const auto triadBar = [&](int chord, double early) {
        return Bar { { { roots[chord], 0.15 }, { roots[chord] + (minor[chord] ? 3 : 4), 0.15 }, { roots[chord] + 7, 0.15 } }, roots[chord], early, early };
    };
    // `early`: how long before the bar line the chord of the bar begins (pushed chords)
    const auto build = [&](double early, unsigned int& noise) {
        return buildBars({ triadBar(0, early), triadBar(1, early), triadBar(2, early), triadBar(3, early) }, noise);
    };
    const auto chordAt = [](const btg::Analysis& found, double t) -> const btg::Analysis::Chord& {
        for (const auto& c : found.chords) if (t >= c.start && t < c.end) return c;
        return found.chords.back();
    };
    unsigned int noise = 7;
    const std::vector<float> mono = build(0.0, noise);
    double lastProgress = 0.0;
    const btg::Analysis a = btg::analyze(mono.data(), mono.size(), rate, [&](double p) { lastProgress = p; return true; });
    CHECK(lastProgress == 1.0);
    CHECK(std::fabs(a.bpm / 96 - 1) < 0.02);
    CHECK(a.keyRoot == 9 && a.keyMode == "minor");
    // the chord in the middle of every bar after the first
    int right = 0;
    for (int bar = 1; bar < bars; ++bar) {
        const double t = (bar * 4 + 2) * beat;
        for (const auto& c : a.chords) if (c.start <= t && t < c.end && c.root == roots[bar % 4] && c.minor == minor[bar % 4]) ++right;
    }
    CHECK(right >= bars - 3);
    // bar lines: a "one" lies on a bar start of the track. Sharp clicks are found up to 80 ms early (the long
    // window sees them coming); with music it is 3 to 26 ms (measured on the generated set)
    const double one = a.beats[static_cast<size_t>(a.beat1) + 8], inBar = std::fmod(one + 2 * beat, 4 * beat) - 2 * beat;
    std::printf("a one at %.3f s, off the bar line by %.3f s (a beat is %.3f s)\n", one, inBar, beat);
    CHECK(std::fabs(inBar) < 0.15 * beat);
    CHECK(btg::toJson(a).find("\"chords\"") != std::string::npos);
    CHECK(btg::analyze(mono.data(), mono.size(), rate, [](double) { return false; }).beats.empty()); // cancelled
    CHECK(!a.bars.empty() && a.bars.front() == a.beat1 && a.beatsPerBar == 4);

    // Pushed chords: every change an eighth before the bar line is found there, not on the beat after.
    unsigned int otherNoise = 7;
    const std::vector<float> pushedTrack = build(beat / 2, otherNoise);
    const btg::Analysis pushed = btg::analyze(pushedTrack.data(), pushedTrack.size(), rate);
    int onEighth = 0;
    for (size_t i = 1; i < pushed.chords.size(); ++i) {
        const double want = std::round((pushed.chords[i].start + beat / 2) / (4 * beat)) * 4 * beat - beat / 2;
        if (std::fabs(pushed.chords[i].start - want) < 0.12) ++onEighth;
    }
    std::printf("pushed chords: %d of %zu changes on the eighth before the bar\n", onEighth, pushed.chords.size() - 1);
    CHECK(onEighth >= bars - 4);
    // Beats from elsewhere with one too many, 50 ms after a beat: it goes, and the chords around it hold together.
    btg::Grid given;
    for (int k = 0; k < bars * 4; ++k) {
        given.beats.push_back(k * beat);
        if (k == 40) given.beats.push_back(k * beat + 0.05);
        if (k % 4 == 0) given.downbeats.push_back(k * beat);
    }
    const btg::Analysis gridded = btg::analyze(pushedTrack.data(), pushedTrack.size(), rate, {}, {}, given);
    CHECK(gridded.beats.size() == static_cast<size_t>(bars * 4));
    // Chords on the beat stay on a beat, and chords stay back to back.
    for (const btg::Analysis* found : { &a, &pushed, &gridded })
        for (size_t i = 0; i < found->chords.size(); ++i) {
            CHECK(found->chords[i].start < found->chords[i].end);
            if (i) CHECK(found->chords[i].start == found->chords[i - 1].end);
        }
    for (const auto& c : a.chords) CHECK(std::any_of(a.beats.begin(), a.beats.end(), [&](double t) { return t == c.start; }));

    // A change in the middle of the bar that the bass makes only at the bar line belongs there. Every fourth bar
    // (the Am after G) the upper voices come two beats early while the bass stays on G to the bar line.
    {
        btg::Grid clean;
        for (int k = 0; k < bars * 4; ++k) {
            clean.beats.push_back(k * beat);
            if (k % 4 == 0) clean.downbeats.push_back(k * beat);
        }
        // How the Am bar is played. held: its bass comes with the bar line. along: its bass comes early with the
        // upper voices. never: the bass stays on G all through the Am bar. unheard: there is no bass to go by before
        // the bar line (the upper voices of G and Am sound an octave up, above what counts as bass, and the bass of
        // the G bar lies below what the analysis hears).
        enum class Bass { held, along, never, unheard };
        const auto changesOf = [&](Bass bass) { // { on a bar line, in the middle of a bar, all }
            std::vector<Bar> cycle { triadBar(0, 0), triadBar(1, 0), triadBar(2, 0), triadBar(3, 0) };
            for (Bar& bar : cycle) bar.bass += 12; // an octave up, where the analysis hears a bass (from 55 Hz)
            cycle[0].upperEarly = 2 * beat;
            if (bass == Bass::along) cycle[0].bassEarly = 2 * beat;
            if (bass == Bass::never) cycle[0].bass = cycle[3].bass;
            if (bass == Bass::unheard) {
                for (const size_t i : { size_t { 0 }, size_t { 3 } }) for (auto& tone : cycle[i].tones) tone.first += 12;
                cycle[3].bass -= 12;
            }
            unsigned int n = 7;
            const std::vector<float> track = buildBars(cycle, n);
            const btg::Analysis found = btg::analyze(track.data(), track.size(), rate, {}, {}, clean);
            std::array<int, 3> count {};
            for (size_t i = 1; i < found.chords.size(); ++i, ++count[2]) {
                const double off = std::fabs(std::remainder(found.chords[i].start, 4 * beat));
                if (off < 0.15 * beat) ++count[0];
                if (std::fabs(off - 2 * beat) < 0.15 * beat) ++count[1];
            }
            return count;
        };
        const auto held = changesOf(Bass::held), along = changesOf(Bass::along), never = changesOf(Bass::never), unheard = changesOf(Bass::unheard);
        std::printf("upper voices two beats early: bass on time %d of %d changes on a bar line; bass early too %d in the middle of a bar; "
                    "bass never moves %d in the middle; no bass to go by %d in the middle\n", held[0], held[2], along[1], never[1], unheard[1]);
        CHECK(held[2] >= bars - 3 && held[0] >= held[2] - 1); // the last early chord has no bar line after it
        CHECK(along[1] >= bars / 4 - 2);   // the bass goes along: a change in the middle of the bar, and it stays there
        CHECK(never[1] >= bars / 4 - 2);   // the balance never tips to the new root: stays
        CHECK(unheard[1] == bars / 4);     // nothing to go by: every one of them stays (without the floor for the bass one moved)
    }

    // Close calls follow the track: a chord whose kind hangs on a threshold takes the kind the same chord clearly
    // has elsewhere. C sounds six times, every other time with a B on top: faint (just enough for a major seventh
    // by itself) it is the plain C of the other three times; strong it is Cmaj7 and stays that.
    {
        const auto kindsOfC = [&](double seventh) {
            Bar withB = triadBar(2, 0);
            withB.tones.push_back({ 11, seventh });
            unsigned int n = 7;
            const std::vector<float> track = buildBars({ triadBar(0, 0), triadBar(1, 0), triadBar(2, 0), triadBar(3, 0), triadBar(0, 0), triadBar(1, 0), withB, triadBar(3, 0) }, n);
            const btg::Analysis found = btg::analyze(track.data(), track.size(), rate);
            std::string kinds;
            for (int bar = 2; bar < bars; bar += 4) kinds += chordAt(found, (bar + 0.5) * 4 * beat).kind + " ";
            return kinds;
        };
        const std::string faint = kindsOfC(0.075), strong = kindsOfC(0.12); // stronger still, and the bar reads as E minor
        std::printf("C, every other time with a faint B: %s| with a strong B: %s\n", faint.c_str(), strong.c_str());
        CHECK(faint == "maj maj maj maj maj maj ");
        CHECK(strong == "maj maj7 maj maj7 maj maj7 ");
    }

    // A sus chord has no clear third. C with a loud F on top is still C; C, F and G with only a faint E are Csus4.
    // Two bars of silence before the music change neither.
    {
        const std::vector<std::pair<int, double>> loudFourth { { 0, 0.15 }, { 4, 0.15 }, { 7, 0.15 }, { 17, 0.25 } }; // the F an octave up: next to the E the window cannot tell them apart
        const std::vector<std::pair<int, double>> faintThird { { 0, 0.15 }, { 4, 0.02 }, { 7, 0.15 }, { 5, 0.15 } };
        const auto kindOfC = [&](const std::vector<std::pair<int, double>>& tones, int silentBars) {
            unsigned int n = 7;
            // C, F and G are the tones of Fsus2 as well, so the bar before is not F. With the loud F the bass of the
            // bar sounds an octave up, where the analysis hears it, and holds the root.
            std::vector<float> track = buildBars({ triadBar(1, 0), triadBar(0, 0), Bar { tones, &tones == &loudFourth ? 12 : 0 }, triadBar(3, 0) }, n);
            track.insert(track.begin(), static_cast<size_t>(silentBars * 4 * beat * rate), 0.0f);
            const btg::Analysis found = btg::analyze(track.data(), track.size(), rate);
            return btg::chordName(chordAt(found, (silentBars + 10 + 0.5) * 4 * beat));
        };
        const std::string withFourth = kindOfC(loudFourth, 0), withoutThird = kindOfC(faintThird, 0);
        std::printf("C with a loud F on top: %s; C, F and G with a faint E: %s\n", withFourth.c_str(), withoutThird.c_str());
        CHECK(withFourth == "C");
        CHECK(withoutThird == "Csus4");
        CHECK(kindOfC(loudFourth, 2) == "C");
        CHECK(kindOfC(faintThird, 2) == "Csus4");
    }

#ifdef BTG_BEAT_MODEL
    // The beat model on the same track (skipped where native/tools/get-models.mjs has not run): its beats lie on
    // the clicks, and the analysis takes them.
    std::string why;
    const btg::Grid grid = btg::findBeats(mono.data(), mono.size(), rate, std::string(BTG_MODELS_DIR) + "/beat_this.onnx", {}, &why);
    if (!why.empty()) std::printf("beat model skipped: %s\n", why.c_str());
    else {
        size_t onClick = 0;
        for (const double t : grid.beats) if (std::fabs(std::fmod(t + beat / 2, beat) - beat / 2) < 0.05) ++onClick;
        std::printf("beat model: %zu beats, %zu on a click, %zu bar starts\n", grid.beats.size(), onClick, grid.downbeats.size());
        CHECK(grid.beats.size() > static_cast<size_t>(0.8 * bars * 4));
        CHECK(onClick > grid.beats.size() * 9 / 10);
        const btg::Analysis withModel = btg::analyze(mono.data(), mono.size(), rate, {}, {}, grid);
        CHECK(std::fabs(withModel.bpm / 96 - 1) < 0.02);
        CHECK(withModel.keyRoot == 9 && withModel.keyMode == "minor");

        // A change of tempo stays a change of tempo: 20 s at 90 bpm, then 20 s at 126 bpm (not half, not double).
        std::vector<float> two(static_cast<size_t>(40 * rate));
        for (size_t i = 0; i < two.size(); ++i) {
            const double t = static_cast<double>(i) / rate, step = t < 20 ? 60.0 / 90 : 60.0 / 126, inStep = std::fmod(t < 20 ? t : t - 20, step);
            noise = noise * 1664525u + 1013904223u;
            two[i] = static_cast<float>(0.2 * std::sin(2 * pi * 220 * t) + 0.5 * (static_cast<double>(noise >> 8) / 8388608.0 - 1.0) * std::exp(-inStep / 0.01));
        }
        const btg::Grid twoGrid = btg::findBeats(two.data(), two.size(), rate, std::string(BTG_MODELS_DIR) + "/beat_this.onnx");
        const btg::Analysis changing = btg::analyze(two.data(), two.size(), rate, {}, {}, twoGrid);
        int slow = 0, fast = 0;
        for (const double t : changing.beats) (t < 20 ? slow : fast) += 1;
        std::printf("tempo change: %d beats in 20 s at 90 bpm, %d in 20 s at 126 bpm\n", slow, fast);
        CHECK(std::abs(slow - 30) <= 3);
        CHECK(std::abs(fast - 42) <= 4);
    }
#endif

    // Decoding: the one way for the app and btg_analyze. A WAV written here: 16 bit, stereo, 8000 Hz, 4 frames,
    // left 0.5 and right -0.25, under a name with an umlaut.
    {
        const auto file = std::filesystem::temp_directory_path() / std::filesystem::path(u8"btg-t\u00f6ne.wav");
        const auto le = [](std::ofstream& out, unsigned value, int bytes) { for (int i = 0; i < bytes; ++i) out.put(static_cast<char>(value >> (8 * i))); };
        {
            std::ofstream out(file, std::ios::binary);
            out << "RIFF"; le(out, 36 + 16, 4); out << "WAVEfmt "; le(out, 16, 4); le(out, 1, 2); le(out, 2, 2);
            le(out, 8000, 4); le(out, 8000 * 4, 4); le(out, 4, 2); le(out, 16, 2); out << "data"; le(out, 16, 4);
            for (int i = 0; i < 4; ++i) { le(out, 16384, 2); le(out, static_cast<unsigned>(-8192) & 0xffff, 2); }
        }
        std::string error;
        const auto clip = btg::decodeFile(file, &error);
        CHECK(clip && clip->channels == 2 && clip->rate == 8000.0 && clip->samples.size() == 8);
        CHECK(clip && std::fabs(clip->samples[0] - 0.5f) < 1e-4f && std::fabs(clip->samples[1] + 0.25f) < 1e-4f);
        CHECK(clip && std::fabs(btg::monoOf(*clip)[3] - 0.125f) < 1e-4f);
        auto broken = file;
        broken.replace_extension(".mp3"); // the same bytes are no MP3
        std::filesystem::copy_file(file, broken, std::filesystem::copy_options::overwrite_existing);
        error.clear();
        CHECK(!btg::decodeFile(broken, &error) && !error.empty());
        CHECK(!btg::decodeFile(file.parent_path() / "btg-missing.wav", &error));
        CHECK(!btg::decodeFile(file.parent_path() / "btg.ogg", &error));
        CHECK(!btg::decodeFile(file.parent_path() / std::filesystem::path(u8"btg.\u043c\u043f3"), &error)); // an ending outside the code page
        std::filesystem::remove(file);
        std::filesystem::remove(broken);
    }

    // File player: one beat of the transport is one second of the clip.
    auto clip = std::make_shared<btg::AudioClip>();
    clip->channels = 1;
    clip->rate = 1000.0;
    for (int i = 0; i < 4000; ++i) clip->samples.push_back(i / 4000.0f); // a ramp: the value tells the position
    btg::FilePlayer player;
    player.prepare(48000.0);
    player.setClip(clip);
    btg::Transport transport;
    transport.play(2.0, 60.0);
    std::vector<float> l(4800), r(4800);
    const auto block = transport.advance(4800, 48000.0); // 0.1 s from second 2
    player.render(l.data(), r.data(), block.frames, block);
    CHECK(std::fabs(l.back() - 0.525f) < 0.002f); // second 2.1 of 4
    CHECK(l == r);
    transport.stop();
    const auto stopped = transport.advance(4800, 48000.0);
    player.render(l.data(), r.data(), stopped.frames, stopped);
    CHECK(l.back() == 0.0f);

    // Another speed keeps the pitch: a 440 Hz tone at 75 % speed still has 440 cycles a second.
    auto tone = std::make_shared<btg::AudioClip>();
    tone->channels = 1;
    tone->rate = 44100.0;
    for (int i = 0; i < 44100 * 6; ++i) tone->samples.push_back(0.5f * static_cast<float>(std::sin(2 * pi * 440 * i / 44100.0)));
    btg::FilePlayer slow;
    slow.prepare(48000.0);
    slow.setClip(tone);
    btg::Transport half;
    half.play(1.0, 45.0); // 45 beats a minute = 0.75 seconds of the track per second
    std::vector<float> heard;
    const auto began = std::chrono::steady_clock::now();
    for (int done = 0; done < 3 * 48000; done += 480) {
        const auto piece = half.advance(480, 48000.0);
        slow.render(l.data(), r.data(), piece.frames, piece);
        heard.insert(heard.end(), l.begin(), l.begin() + piece.frames);
    }
    const double renderMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - began).count();
    std::printf("stretching 3 s of sound took %.0f ms (%.1f %% of one core)\n", renderMs, renderMs / 30);
    int cycles = 0;
    for (size_t i = 48000 + 1; i < 2 * 48000; ++i) cycles += heard[i - 1] < 0.0f && heard[i] >= 0.0f; // the second second
    std::printf("440 Hz at 75 %% speed: %d cycles in a second, position %.3f s\n", cycles, half.beats());
    double early = 0.0; // 20 to 70 ms after the start: the stretcher must not begin with a hole
    for (size_t i = 960; i < 3360; ++i) early += heard[i] * heard[i];
    early = std::sqrt(early / 2400);
    std::printf("level 20 to 70 ms after the start: %.3f (the tone has 0.354)\n", early);
    CHECK(early > 0.25);
    CHECK(std::abs(cycles - 440) <= 6);
    CHECK(std::fabs(half.beats() - (1.0 + 3 * 0.75)) < 1e-6);

    std::printf(failures ? "%d check(s) failed\n" : "all checks passed\n", failures);
    return failures ? 1 : 0;
}
