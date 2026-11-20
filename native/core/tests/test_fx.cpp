// The layer effects alone (guitar_fx.h; Task 19: mod_fx.h): Chromium's nodes as the web app's chains use them (phase-4-design.md 4, 5).
#include "../src/guitar_fx.h"
#include "../src/mod_fx.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

static int failures = 0;
#define CHECK(cond) \
    do { if (!(cond)) { std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); ++failures; } } while (0)

using namespace btg::detail;

int main() {
    // Shaper with the curve [-1, 1] (the identity) is the samplers alone: an impulse comes out 128 (2x) or 192 (4x) frames late, a
    // constant passes with the gain of 1 within 1e-5 (the kernels' sums, computed from the formulas of up_sampler.cc and down_sampler.cc, are
    // 1 + 3e-7 and 1 + 2e-7). With the soft curve a constant 0.1 comes out as tanh(0.25) within 1e-5 relative.
    const float line[2] = { -1.0f, 1.0f };
    for (const int factor : { 2, 4 }) {
        Shaper shaper;
        shaper.prepare(line, 2, factor);
        std::vector<float> y(1024);
        for (size_t i = 0; i < y.size(); ++i) y[i] = shaper.process(i == 0 ? 0.5f : 0.0f);
        const size_t at = static_cast<size_t>(std::max_element(y.begin(), y.end(), [](float a, float b) { return std::fabs(a) < std::fabs(b); }) - y.begin());
        CHECK(at == static_cast<size_t>(Shaper::latency(factor)) && Shaper::latency(factor) == (factor == 2 ? 128 : 192));
        shaper.reset();
        float dc = 0.0f;
        for (int i = 0; i < 2000; ++i) dc = shaper.process(0.25f);
        Shaper soft;
        soft.prepare(guitarCurve(Curve::soft), CURVE_POINTS, factor);
        float shaped = 0.0f;
        for (int i = 0; i < 2000; ++i) shaped = soft.process(0.1f);
        std::printf("shaper %dx: impulse at %zu, dc gain %.6f, soft(0.1) %.6f\n", factor, at, dc / 0.25f, shaped);
        CHECK(std::fabs(dc / 0.25f - 1) < 1e-5 && std::fabs(shaped / std::tanh(0.25f) - 1) < 1e-5);
    }
    // GuitarFx (guitar-fx.js): never built it does not touch the buffer; built at a start every stage at 0.5: the dry path carries the
    // input unchanged for 0.08 s (the creation fade's delay, CREATE), then the chain; any chunk size gives the same output; all knobs back
    // to 0 while built: unchanged again, bit for bit, from 10 time constants (0.2 s) after the change; the first 100 frames after the change
    // and the 50 ms before that point still differ (the dry gain is still 5e-4 short of 1 there). At 44.1, 48 and 96 kHz.
    for (const double sr : { 44100.0, 48000.0, 96000.0 }) {
        std::vector<float> x(static_cast<size_t>(sr)); // a decaying 110 Hz tone for 0.5 s, then silence
        for (size_t i = 0; i < x.size() / 2; ++i) x[i] = static_cast<float>(0.4 * std::sin(2 * 3.14159265358979 * 110 * i / sr) * std::exp(-2.0 * i / sr));
        const FxChainParams off = fxChainParams(0, 0, 0, btg::Engine::chords), on = fxChainParams(0.5, 0.5, 0.5, btg::Engine::chords);
        GuitarFx never;
        never.prepare(btg::Engine::chords, sr);
        never.set(off, true);
        std::vector<float> y = x;
        never.process(y.data(), nullptr, static_cast<int>(y.size()), false);
        CHECK(!never.built() && y == x);
        const auto through = [&](size_t chunk) {
            GuitarFx g;
            g.prepare(btg::Engine::chords, sr);
            g.set(on, true);
            std::vector<float> out = x;
            for (size_t at = 0; at < out.size(); at += chunk) g.process(out.data() + at, nullptr, static_cast<int>(std::min(chunk, out.size() - at)), false);
            return out;
        };
        const std::vector<float> whole = through(x.size());
        for (const size_t chunk : { size_t { 1 }, size_t { 7 }, size_t { 128 }, size_t { 256 } }) CHECK(through(chunk) == whole);
        const size_t hold = static_cast<size_t>(std::lround(0.08 * sr));
        CHECK(std::equal(x.begin(), x.begin() + static_cast<long>(hold), whole.begin()));
        double moved = 0.0;
        for (size_t i = static_cast<size_t>(0.16 * sr); i < static_cast<size_t>(0.4 * sr); ++i) moved = std::max(moved, std::fabs(static_cast<double>(whole[i] - x[i])));
        CHECK(moved > 0.01);
        GuitarFx g;
        g.prepare(btg::Engine::chords, sr);
        g.set(on, true);
        std::vector<float> a = x;
        const size_t change = static_cast<size_t>(0.3 * sr), exact = change + static_cast<size_t>(std::lround(0.2 * sr));
        g.process(a.data(), nullptr, static_cast<int>(change), false);
        g.set(off, false);
        g.process(a.data() + change, nullptr, static_cast<int>(a.size() - change), false);
        CHECK(g.built() && std::equal(x.begin() + static_cast<long>(exact), x.end(), a.begin() + static_cast<long>(exact)));
        CHECK(!std::equal(x.begin() + static_cast<long>(change), x.begin() + static_cast<long>(change + 100), a.begin() + static_cast<long>(change)));
        const size_t before = exact - static_cast<size_t>(0.05 * sr);
        CHECK(!std::equal(x.begin() + static_cast<long>(before), x.begin() + static_cast<long>(exact), a.begin() + static_cast<long>(before)));
        std::printf("guitar %.0f Hz: largest change by the chain %.3f\n", sr, moved);
    }
    // A ramp without an end value (the fuzz bias) goes idle once it has converged (Chromium: at the first render quantum after 10 time
    // constants, here frame 19200 of 48 kHz), so that its frame count stops: it holds the target and no longer counts.
    {
        Ramp bias;
        bias.jump(0.0f);
        bias.to(0.06f, 0.0, 0.04, 48000.0, false);
        float v = 0.0f;
        for (int i = 0; i < 30000; ++i) v = bias.next();
        const int age = bias.age;
        for (int i = 0; i < 1000000; ++i) v = bias.next();
        CHECK(bias.idle && v == 0.06f && age >= 19200 && age <= 19328 && bias.age == age);
    }
    // ModDelay: the ring is 128 + TimeToSampleFrame(0.05 s, rate, up) frames (delay.cc 85 to 95); a delay of 10.25 frames reads 0.75 of
    // an impulse at frame 10 and 0.25 at frame 11 (linear interpolation, the read position in float: within 1e-4).
    for (const double sr : { 44100.0, 48000.0, 96000.0 }) {
        ModDelay d;
        d.prepare(0.05, sr);
        CHECK(d.length() == 128 + static_cast<int>(std::lround(0.05 * sr)));
        std::vector<float> y(20);
        for (size_t i = 0; i < y.size(); ++i) y[i] = d.process(i == 0 ? 1.0f : 0.0f, static_cast<float>(10.25 / sr));
        CHECK(std::fabs(y[10] - 0.75f) < 1e-4f && std::fabs(y[11] - 0.25f) < 1e-4f && y[9] == 0.0f && y[12] == 0.0f);
    }
    // ModFx (mod-fx.js), 48 kHz. Vibrato 1 at 100 bpm (5 Hz, depth 0.744 ms): an impulse comes out at frames 196 and 197 (4 ms plus the
    // LFO's rise from phase 0, sin(2π·5·196.6/48000)·0.744 ms; a phase of pi puts it at 188), also after reset(). Chorus 1 (wet 0.7,
    // norm 0.710669): an impulse at frame 0 comes out times norm on both sides, and copy A (0.6 Hz, pan -0.7, about 873.9 frames late:
    // frames 873 and 874; copy B lies at 877 and 878) with L/R = 0.97237 / 0.23345 (stereo_panner.cc, mono input); a constant 1 comes out
    // as norm·(1 + wet·(0.97237 + 0.23345)) = 1.310526 on each side once the copies are filled (a moving delay scales an impulse's sum by
    // the Doppler factor, a constant not). Never built: both outputs are the input. Back to 0 while built: the input on both sides from
    // 0.2 s after the change on (the input goes on to the end, so the dry gain's return to 1 is proved too). Chunk sizes agree.
    {
        const double sr = 48000.0;
        const auto run = [&](ModFx& fx, const ModParams& p, const std::vector<float>& in) {
            fx.set(p, true);
            std::vector<float> l(in.size()), r(in.size());
            fx.process(in.data(), nullptr, l.data(), r.data(), static_cast<int>(in.size()), false);
            return std::make_pair(l, r);
        };
        std::vector<float> one(1200, 0.0f), dc(1200, 1.0f);
        one[0] = 1.0f;
        const auto argmax = [](const std::vector<float>& v) { return static_cast<size_t>(std::max_element(v.begin(), v.end()) - v.begin()); };
        const auto sum = [](const std::vector<float>& v, size_t from, size_t to) { double s = 0; for (size_t i = from; i < to; ++i) s += v[i]; return s; };
        ModFx fx;
        fx.prepare(sr);
        const auto vib = run(fx, modParams(1, 0, 100), one);
        const size_t at = argmax(vib.first);
        CHECK((at == 196 || at == 197) && vib.first[195] == 0.0f && vib.first[198] == 0.0f && vib.first == vib.second);
        fx.reset();
        CHECK(argmax(run(fx, modParams(1, 0, 100), one).first) == at); // the LFO starts at phase 0 again
        fx.reset();
        const auto chorus = run(fx, modParams(0, 1, 100), one);
        fx.reset();
        const auto level = run(fx, modParams(0, 1, 100), dc);
        const double ratio = sum(chorus.first, 868, 876) / sum(chorus.second, 868, 876);
        std::printf("mod: vibrato impulse at %zu, chorus constant L %.6f R %.6f, copy A L/R %.4f\n", at, level.first[1100], level.second[1100], ratio);
        CHECK(std::fabs(chorus.first[0] - 0.710669f) < 1e-5f && chorus.first[0] == chorus.second[0]);
        CHECK(std::fabs(ratio / (0.97237 / 0.23345) - 1) < 1e-3);
        CHECK(std::fabs(level.first[1100] - 1.310526f) < 1e-5f && std::fabs(level.second[1100] - 1.310526f) < 1e-5f);
        ModFx never;
        never.prepare(sr);
        never.set(modParams(0, 0, 100), true);
        std::vector<float> x(static_cast<size_t>(sr)), l(x.size()), r(x.size());
        for (size_t i = 0; i < x.size(); ++i) x[i] = static_cast<float>(0.4 * std::sin(2 * 3.14159265358979 * 220 * i / sr)); // goes on past 0.5 s: the compared range below carries signal
        never.process(x.data(), nullptr, l.data(), r.data(), static_cast<int>(x.size()), false);
        CHECK(!never.built() && l == x && r == x);
        const auto through = [&](size_t chunk) {
            ModFx g;
            g.prepare(sr);
            g.set(modParams(0.5, 0.5, 100), true);
            std::vector<float> a(x.size()), b(x.size());
            for (size_t from = 0; from < x.size(); from += chunk) {
                const int n = static_cast<int>(std::min(chunk, x.size() - from));
                g.process(x.data() + from, nullptr, a.data() + from, b.data() + from, n, false);
            }
            return std::make_pair(a, b);
        };
        const auto whole = through(x.size());
        for (const size_t chunk : { size_t { 1 }, size_t { 7 }, size_t { 128 }, size_t { 256 } }) CHECK(through(chunk) == whole);
        ModFx g;
        g.prepare(sr);
        g.set(modParams(1, 1, 100), true);
        const size_t change = static_cast<size_t>(0.3 * sr), exact = change + static_cast<size_t>(std::lround(0.2 * sr));
        g.process(x.data(), nullptr, l.data(), r.data(), static_cast<int>(change), false);
        g.set(modParams(0, 0, 100), false);
        g.process(x.data() + change, nullptr, l.data() + change, r.data() + change, static_cast<int>(x.size() - change), false);
        CHECK(std::equal(x.begin() + static_cast<long>(exact), x.end(), l.begin() + static_cast<long>(exact)) && std::equal(x.begin() + static_cast<long>(exact), x.end(), r.begin() + static_cast<long>(exact)));
    }
    std::printf(failures ? "fx: %d FAILED\n" : "fx: all passed\n", failures);
    return failures ? 1 : 0;
}
