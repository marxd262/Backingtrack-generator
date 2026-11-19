// The layer effects alone (guitar_fx.h; Task 19: mod_fx.h): Chromium's nodes as the web app's chains use them (phase-4-design.md 4, 5).
#include "../src/guitar_fx.h"

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
        never.process(y.data(), static_cast<int>(y.size()));
        CHECK(!never.built() && y == x);
        const auto through = [&](size_t chunk) {
            GuitarFx g;
            g.prepare(btg::Engine::chords, sr);
            g.set(on, true);
            std::vector<float> out = x;
            for (size_t at = 0; at < out.size(); at += chunk) g.process(out.data() + at, static_cast<int>(std::min(chunk, out.size() - at)));
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
        g.process(a.data(), static_cast<int>(change));
        g.set(off, false);
        g.process(a.data() + change, static_cast<int>(a.size() - change));
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
    std::printf(failures ? "fx: %d FAILED\n" : "fx: all passed\n", failures);
    return failures ? 1 : 0;
}
