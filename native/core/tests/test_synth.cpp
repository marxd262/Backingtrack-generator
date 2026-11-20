// The building blocks of the synth voices (osc.h, param.h, patch.h): the rules of Chromium's PeriodicWaveHandler, AudioParam timeline and
// scheduled sources, with the expected values computed here from those rules; a tone's output does not depend on how its render is cut.
#include "../src/osc.h"
#include "../src/param.h"
#include "../src/patch.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <complex>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <numbers>
#include <vector>

static int failures = 0;
#define CHECK(cond) \
    do { if (!(cond)) { std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); ++failures; } } while (0)

using namespace btg::detail;

namespace {

std::vector<float> paramValues(Param& p, int frames) {
    std::vector<float> v(static_cast<size_t>(frames));
    p.values(frames, nullptr, v.data());
    return v;
}

bool near(double a, double b, double tolerance) { return std::fabs(a - b) <= tolerance; }

// |bin k| of one table (a plain DFT)
double bin(const float* table, int size, int k) {
    std::complex<double> sum;
    for (int n = 0; n < size; ++n) sum += static_cast<double>(table[n]) * std::polar(1.0, -2 * std::numbers::pi * k * n / size);
    return std::abs(sum);
}

} // namespace

int main() {
    const double sr = 48000;
    const BasicWaves& waves = basicWaves(sr);
    auto scratch = std::make_unique<SynthTone::Scratch>();

    // The tables (periodic_wave_handler.cc): 4096 entries and 36 ranges up to 88.2 kHz, 16384 and 42 above; built once per rate.
    const WaveTables& saw = waves.wave[static_cast<int>(Wave::sawtooth)];
    CHECK(saw.size == 4096 && saw.ranges == 36 && basicWaves(44100).wave[0].size == 4096);
    CHECK(basicWaves(96000).wave[0].size == 16384 && basicWaves(96000).wave[0].ranges == 42 && &basicWaves(sr) == &waves);
    // The pair for a frequency: pitch range 1 + 3 log2(f / (rate / size)), clamped to [0, 35]; its integer part is the table with more
    // partials, the next range the one with fewer, the fraction the crossfade. 93.75 Hz = 8 times the lowest: exactly on the edge of range 10.
    for (const double hz : { 93.75, 93.7, 93.8, 440.0, 3520.0, 8300.0, 5.0, 23000.0, -440.0 }) {
        const double pitch = std::clamp(1 + 3 * std::log2(std::fabs(hz) / (sr / 4096)), 0.0, 35.0);
        const int range = static_cast<int>(pitch);
        const float* lower;
        const float* higher;
        float factor;
        saw.pair(static_cast<float>(hz), lower, higher, factor);
        CHECK(higher == saw.table(range) && lower == saw.table(std::min(range + 1, 35)) && near(factor, pitch - range, 2e-5));
        if (hz == 93.75) CHECK(higher == saw.table(10) && lower == saw.table(11) && factor == 0.0f);
        if (hz == 93.7) CHECK(higher == saw.table(9) && lower == saw.table(10) && factor > 0.99f);
    }
    // The partials a range keeps: floor(2^(-r/3) * 2048) (range 9: 256, range 20: 20); the next one is gone. A sawtooth's partial k has 1/k
    // of the first's amplitude.
    for (const int range : { 9, 20 }) {
        const int keep = static_cast<int>(static_cast<float>(std::pow(2.0, -range / 3.0)) * 2048.0f);
        const double first = bin(saw.table(range), saw.size, 1);
        const double last = bin(saw.table(range), saw.size, keep) / first, culled = bin(saw.table(range), saw.size, keep + 1) / first;
        std::printf("sawtooth range %d: keeps %d partials, partial %d at %.6f of the first (1/k %.6f), partial %d at %.1e\n", range, keep, keep, last,
                    1.0 / keep, keep + 1, culled);
        CHECK(near(last, 1.0 / keep, 1e-6) && culled < 1e-6);
    }

    // Param (audio_param_handler.cc): an event at frame t begins at ceil(t); the value at each event's end.
    {
        Param p; // setValue: the intrinsic value until then
        p.value = 0.25f;
        p.setValueAtTime(0.5f, 10.5);
        p.setValueAtTime(0.7f, 20);
        const std::vector<float> v = paramValues(p, 40);
        CHECK(v[10] == 0.25f && v[11] == 0.5f && v[19] == 0.5f && v[20] == 0.7f && v[39] == 0.7f);
    }
    {
        Param p; // linear: v1 + x (v2 - v1), x = (frame - t1) / (t2 - t1); the end value from t2 on
        p.setValueAtTime(0.0f, 10);
        p.linearRampToValueAtTime(1.0f, 110);
        const std::vector<float> v = paramValues(p, 200);
        CHECK(v[9] == 0.0f && v[10] == 0.0f && near(v[11], 0.01, 1e-7) && near(v[60], 0.5, 1e-7) && near(v[109], 0.99, 1e-7) && v[110] == 1.0f && v[199] == 1.0f);
    }
    {
        Param p; // exponential: v1 (v2 / v1)^((frame - t1) / (t2 - t1)); the end value from t2 on
        p.setValueAtTime(1.0f, 10);
        p.exponentialRampToValueAtTime(0.001f, 110);
        const std::vector<float> v = paramValues(p, 200);
        CHECK(v[10] == 1.0f && near(v[60] / std::sqrt(0.001), 1, 1e-6) && near(v[109] / std::pow(0.001, 0.99), 1, 1e-6) && v[110] == 0.001f && v[199] == 0.001f);
    }
    {
        Param p; // setTarget: target + (v0 - target) exp(-(frame - t) / tc), at a fractional start the first frame's own distance; converged
        p.value = 1.0f; //  ten time constants after its start: the target itself
        p.setTargetAtTime(0.25f, 50.5, 20);
        const std::vector<float> v = paramValues(p, 300);
        CHECK(v[50] == 1.0f && near(v[51], 0.25 + 0.75 * std::exp(-0.5 / 20), 1e-7) && near(v[71], 0.25 + 0.75 * std::exp(-20.5 / 20), 2e-6));
        CHECK(v[250] != 0.25f && v[251] == 0.25f && v[299] == 0.25f);
    }
    {
        Param p; // setTarget after a linear ramp: from the ramp's end value
        p.setValueAtTime(0.0f, 0);
        p.linearRampToValueAtTime(1.0f, 100);
        p.setTargetAtTime(0.2f, 150, 10);
        const std::vector<float> v = paramValues(p, 200);
        CHECK(v[100] == 1.0f && v[149] == 1.0f && v[150] == 1.0f && near(v[160], 0.2 + 0.8 * std::exp(-1.0), 2e-6));
    }
    {
        Param p; // a ramp after a setTarget (ProcessSetTargetFollowedByRamp): the ramp starts at the setTarget's start, from its value there
        p.setValueAtTime(1.0f, 0);
        p.setTargetAtTime(0.0f, 10, 20);
        p.linearRampToValueAtTime(0.5f, 50);
        const std::vector<float> v = paramValues(p, 60);
        CHECK(v[10] == 1.0f && near(v[30], 0.75, 1e-7) && v[50] == 0.5f);
    }
    {
        // HasSetTargetConverged where Chromium tests it (Task 20): at the event's first frame and at each render quantum's first frame. A
        // setTarget from 0.01 to 0 over 20 frames falls below kSetTargetThreshold (4.54e-5) at frame 108, inside the quantum: with the
        // param's frame 0 on a quantum's first frame (quantum 0) its recursion goes on to frame 127 and it is the target from 128 on; the
        // control, a param without a grid (quantum -1), is the target from the crossing on.
        const auto fall = [](int quantum) {
            Param p;
            p.value = 0.01f;
            p.quantum = quantum;
            p.setTargetAtTime(0.0f, 0, 20);
            return paramValues(p, 200);
        };
        const std::vector<float> grid = fall(0), every = fall(-1);
        int crossed = -1; // the control's first frame at the target
        for (int i = 0; i < 200 && crossed < 0; ++i) if (every[i] == 0.0f) crossed = i;
        std::printf("setTarget per quantum: the control at the target from frame %d, the grid from frame %d (%.3g at 127)\n", crossed,
                    static_cast<int>(std::find(grid.begin(), grid.end(), 0.0f) - grid.begin()), grid[127]);
        CHECK(crossed > 100 && crossed < 127 && grid[crossed] > 0.0f && grid[127] > 0.0f && grid[127] < 4.54e-5f && grid[128] == 0.0f);
        for (int i = 0; i < crossed; ++i) CHECK(grid[i] == every[i]); // the same recursion up to the crossing
    }
    {
        // The same through a SynthTone 64 frames into its quantum (Tones::startSynth gives a tone its place; SynthTone::param hands it to
        // the param): a buffer of ones through a gain whose setTarget falls from 0.01 as above; the quanta begin at the tone's frames 64
        // and 192, so the gain is above 0 at frame 150 and 0 from frame 192 on.
        const std::vector<float> ones(400, 1.0f);
        SynthTone t;
        t.active = true;
        t.basic = &basicWaves(48000.0);
        t.quantum = 64;
        const int source = t.buffer(ones.data(), 400, 0, false, 0, 400), g = t.gain(1.0f);
        Param& p = t.param(g);
        p.setValueAtTime(0.01f, 0);
        p.setTargetAtTime(0.0f, 0, 20);
        t.connect(source, g);
        t.output(g);
        std::vector<float> l(256), r(256);
        const auto scratch = std::make_unique<SynthTone::Scratch>();
        t.render(l.data(), r.data(), 256, *scratch);
        CHECK(!t.overflow() && l[150] > 0.0f && l[191] > 0.0f && l[192] == 0.0f && l[255] == 0.0f);
    }
    {
        Param p; // a ramp as the first event starts from the intrinsic value at the tone's time 0; more than EVENTS events: the flag
        p.value = 2.0f;
        p.linearRampToValueAtTime(0.0f, 100);
        const std::vector<float> v = paramValues(p, 101);
        CHECK(v[0] == 2.0f && near(v[50], 1.0, 1e-6) && v[100] == 0.0f && !p.overflow);
        for (int i = 0; i < EVENTS; ++i) p.setValueAtTime(1.0f, 200.0 + i);
        CHECK(p.overflow && p.count == EVENTS);
    }

    // SynthTone: the same tone cut into calls of 1, 7, 128, 256 and 1000 frames (more than SYNTH_FRAMES: render splits them) gives the same
    // samples, bit for bit, in both channels. Every node kind: a sawtooth (k-rate, the float lanes) through a lowpass whose frequency runs an
    // exponential ramp, a setTarget and a sine LFO (below 0.3: the 3-point path), into adsr's gain; a sine carrier frequency-modulated by a
    // second sine (the a-rate path) through a gain; a looped buffer through a gain and a panner, which makes the sum stereo; 37 frames of delay.
    std::vector<float> noise(static_cast<size_t>(sr));
    for (size_t i = 0; i < noise.size(); ++i) noise[i] = static_cast<float>(std::sin(static_cast<double>(i) * 12.9898) * 0.5);
    const int frames = 40000;
    const auto chunked = [&](int chunk, double carrierStart = 1000, int quantum = 0) {
        SynthTone t;
        t.active = true;
        t.basic = &waves;
        t.delay = 37;
        t.quantum = quantum;
        const int o = t.osc(Wave::sawtooth, 220.0f, 7.0f, 0, 30000), lp = t.biquad(Filter::lowpass, 3000.0f, 4.0f), a = t.gain(0.0f);
        const int lfo = t.osc(Wave::sine, 3.0f, 0.0f, 0, 30000), depth = t.gain(400.0f);
        const int carrier = t.osc(Wave::sine, 300.0f, 0.0f, carrierStart, 28000), modulator = t.osc(Wave::sine, 450.0f, 0.0f, 0, 28000), index = t.gain(600.0f);
        const int carried = t.gain(0.3f), loop = t.buffer(noise.data(), 1000, 123.4, true, 500, 29000), looped = t.gain(0.2f), pan = t.panner(0.5f);
        Param& f = t.param(lp);
        f.setValueAtTime(4000.0f, 0);
        f.exponentialRampToValueAtTime(300.0f, 9000);
        f.setTargetAtTime(2500.0f, 15000, 2000);
        Param& g = t.param(a);
        g.setValueAtTime(0.0001f, 0);
        g.linearRampToValueAtTime(0.8f, 480);
        g.setValueAtTime(0.8f, 12000);
        g.exponentialRampToValueAtTime(0.0001f, 24000);
        t.connect(o, lp);
        t.connect(lp, a);
        t.connect(lfo, depth);
        t.modulate(depth, f);
        t.connect(modulator, index);
        t.modulate(index, t.param(carrier));
        t.connect(carrier, carried);
        t.connect(carried, a);
        t.connect(loop, looped);
        t.connect(looped, pan);
        t.connect(pan, a);
        t.output(a);
        std::vector<float> left(frames), right(frames);
        for (int at = 0; at < frames && t.active; at += chunk) t.render(&left[at], &right[at], std::min(chunk, frames - at), *scratch);
        CHECK(left != right && !t.active && !t.overflow());
        left.insert(left.end(), right.begin(), right.end());
        return left;
    };
    const std::vector<float> whole = chunked(256);
    double energy = 0;
    for (const float x : whole) energy += static_cast<double>(x) * x;
    CHECK(energy > 100 && std::all_of(whole.begin(), whole.begin() + 37, [](float x) { return x == 0.0f; }));
    for (const int chunk : { 1, 7, 128, 1000 }) {
        const bool same = chunked(chunk) == whole;
        std::printf("chunks of %d frames: %s the render in chunks of 256\n", chunk, same ? "bit-identical to" : "DIFFERENT from");
        CHECK(same);
    }
    // The tone's place in its render quantum (Chromium's quanta on the core's grid): at 45 every oscillator starts inside a quantum (the
    // carrier, a-rate, at 1045: 21 frames in, its first quantum on the values of the quantum's first frames; the others at 45: their k-rate
    // blocks of 83 frames, then 128). Cut into calls of 1, 7, 128 and 1000 frames: bit for bit the render in calls of 256, and not the
    // render at place 0. At place 0 with the carrier at 1024 (every oscillator on a quantum's first frame) the bits are those of the code
    // before the grid (Task 20a; the hash taken from it before the change).
    const std::vector<float> placed = chunked(256, 1000, 45);
    CHECK(placed != whole);
    for (const int chunk : { 1, 7, 128, 1000 }) {
        const bool same = chunked(chunk, 1000, 45) == placed;
        std::printf("at place 45, chunks of %d frames: %s the render in chunks of 256\n", chunk, same ? "bit-identical to" : "DIFFERENT from");
        CHECK(same);
    }
    {
        uint32_t hash = 0x811c9dc5u; // FNV-1a over the floats' bits
        for (const float x : chunked(256, 1024)) {
            uint32_t bits;
            std::memcpy(&bits, &x, 4);
            for (int b = 0; b < 4; ++b) { hash ^= (bits >> (8 * b)) & 0xffu; hash *= 0x01000193u; }
        }
        std::printf("on the grid: hash %08x (before the grid: 1eaff96c)\n", hash);
        CHECK(hash == 0x1eaff96cu);
    }
    // The k-rate kernel's blocks on the grid (osc.cpp, Oscillator::constant): an oscillator 45 frames into its quantum renders the 83 frames
    // left of it as its first block, then whole quanta. So, in one call, it is bit for bit an oscillator at offset 0 whose first call ends
    // its block after 83 frames (`left` 83, as a stop inside the quantum does), for the sine, square and sawtooth at 440 Hz. And the offset
    // comes from the tone's place: a tone at place 45 with the oscillator at its time 0 is, 45 frames later, a tone at place 0 whose
    // oscillator starts at 45, and not one at place 0 with the oscillator at 0. Red with the grid taken out (constant() ignoring the
    // offset: the identity; SynthTone::osc not setting it: the tones).
    for (const Wave w : { Wave::sine, Wave::square, Wave::sawtooth }) {
        const int n = 2000;
        const long long never = 1LL << 40;
        std::vector<float> placed45(n), cut(n);
        Oscillator a, b;
        a.wave = b.wave = &waves.wave[static_cast<int>(w)];
        a.offset = 45;
        a.constant(440.0f, 0.0f, placed45.data(), n, never);
        b.constant(440.0f, 0.0f, cut.data(), 83, 83);
        b.constant(440.0f, 0.0f, cut.data() + 83, n - 83, never);
        int differ = 0;
        for (int i = 0; i < n; ++i) differ += placed45[i] != cut[i];
        std::printf("k-rate grid, wave %d: offset 45 against a first block of 83, %d of %d frames differ\n", static_cast<int>(w), differ, n);
        CHECK(differ == 0);
    }
    {
        const auto tone = [&](int place, double start) {
            SynthTone t;
            t.active = true;
            t.basic = &waves;
            t.quantum = place;
            t.output(t.osc(Wave::sawtooth, 440.0f, 0.0f, start, start + 2000));
            std::vector<float> l(2304), r(2304);
            for (int at = 0; at < 2304; at += 256) t.render(&l[at], &r[at], 256, *scratch);
            return l;
        };
        const std::vector<float> atPlace = tone(45, 0), later = tone(0, 45), atZero = tone(0, 0);
        const bool shifted = std::equal(atPlace.begin(), atPlace.begin() + 2000, later.begin() + 45);
        const bool own = std::equal(atPlace.begin(), atPlace.begin() + 2000, atZero.begin());
        std::printf("k-rate grid, tones: place 45 %s the oscillator at 45 of place 0, %s the one at 0\n", shifted ? "equals" : "DIFFERS FROM", own ? "EQUALS" : "differs from");
        CHECK(shifted && !own);
    }
    // A stop of infinity (the web's "no stop"): the tone plays on and does not end by itself
    {
        SynthTone t;
        t.active = true;
        t.basic = &waves;
        t.output(t.osc(Wave::sine, 440.0f, 0.0f, 0, INFINITY));
        std::vector<float> l(SYNTH_FRAMES), r(SYNTH_FRAMES);
        for (int i = 0; i < 2000; ++i) { std::fill(l.begin(), l.end(), 0.0f); t.render(l.data(), r.data(), SYNTH_FRAMES, *scratch); }
        CHECK(t.active && t.end == 4611686018427387904LL && l[100] != 0.0f); // 2^62 frames
        t.release(sr); // releaseSeconds 0: one frame, then the tone ends
        t.render(l.data(), r.data(), SYNTH_FRAMES, *scratch);
        CHECK(!t.active);
    }

    // The coefficient helpers at the ends of the normalised frequency (biquad.cc): a lowpass at Nyquist passes, a highpass there gives 0;
    // at 0 the other way round; a 6 kHz lowpass at a rate of 8 kHz passes (finite); a bandpass outside (0, 1) gives 0, with Q 0 it passes.
    {
        const auto is = [](const Biquad& f, double b0) { return f.b0 == b0 && f.b1 == 0 && f.b2 == 0 && f.a1 == 0 && f.a2 == 0; };
        CHECK(is(lowpassOf(sr / 2, 1, sr), 1) && is(highpassOf(sr / 2, 1, sr), 0) && is(lowpassOf(0, 1, sr), 0) && is(highpassOf(0, 1, sr), 1));
        CHECK(is(lowpassOf(6000, 0.7, 8000), 1) && is(highpassOf(30000, 0.7, sr), 0));
        CHECK(is(bandpassOf(0, 1, sr), 0) && is(bandpassOf(sr / 2, 1, sr), 0) && is(bandpassOf(-10, 1, sr), 0) && is(bandpassOf(1000, 0, sr), 1));
        const Biquad lp = lowpassOf(1000, 1, sr), bp = bandpassOf(1000, 1, sr);
        CHECK(std::isfinite(lp.b0) && lp.a1 != 0 && bp.b0 > 0 && bp.b1 == 0 && bp.b2 == -bp.b0);
    }

    // SynthTone's end: inactive one chunk (SYNTH_FRAMES) after its last source's stop, silent from the stop on
    {
        SynthTone t;
        t.active = true;
        t.basic = &waves;
        t.output(t.osc(Wave::sine, 440.0f, 0.0f, 0, 1000));
        std::vector<float> left(2048), right(2048);
        for (int at = 0; at < 1024; at += 256) t.render(&left[at], &right[at], 256, *scratch);
        CHECK(t.active && left[999] != 0.0f);
        t.render(&left[1024], &right[1024], 256, *scratch);
        CHECK(!t.active && t.age == 1000 + SYNTH_FRAMES && std::all_of(left.begin() + 1000, left.end(), [](float x) { return x == 0.0f; }));
    }
    // choke ends a tone at 1e-7: tc 0.015 s from frame 100 on, ln(1e7) time constants; release falls to 1e-4 over releaseSeconds, then ends
    const auto ringing = [&](SynthTone& t) {
        t.active = true;
        t.basic = &waves;
        t.panLeft = 0.5f;
        t.output(t.osc(Wave::sine, 440.0f, 0.0f, 0, 1e9));
    };
    {
        SynthTone t, twin;
        ringing(t);
        ringing(twin);
        t.choke(100, 0.015, sr);
        std::vector<float> l(20000), r(20000), tl(20000), tr(20000);
        int last = 0;
        for (int at = 0; at < 20000; at += 256) {
            t.render(&l[at], &r[at], std::min(256, 20000 - at), *scratch);
            twin.render(&tl[at], &tr[at], std::min(256, 20000 - at), *scratch);
        }
        for (int i = 0; i < 20000; ++i) if (r[i] != 0.0f) last = i;
        const int expected = 100 + static_cast<int>(std::ceil(std::log(1e7) * 0.015 * sr)) - 1;
        const int at = 100 + 720; // the gain falls from frame 100 on: mul^(k + 1) at frame 100 + k
        CHECK(!t.active && std::abs(last - expected) <= 1 && near(r[at] / tr[at], std::exp(-721.0 / 720), 1e-6) && l[at] == 0.5f * r[at]);
        std::printf("choke: last sample at frame %d (expected %d)\n", last, expected);
    }
    {
        SynthTone t, twin;
        ringing(t);
        ringing(twin);
        t.releaseSeconds = 0.1;
        std::vector<float> l(10000), r(10000), tl(10000), tr(10000);
        for (int at = 0; at < 10000; at += 250) {
            if (at == 2000) t.release(sr);
            t.render(&l[at], &r[at], 250, *scratch);
            twin.render(&tl[at], &tr[at], 250, *scratch);
        }
        int last = 0;
        for (int i = 0; i < 10000; ++i) if (r[i] != 0.0f) last = i;
        CHECK(!t.active && last == 2000 + 4800 - 1 && r[1999] == tr[1999] && near(r[2000 + 2399] / tr[2000 + 2399], 0.01, 1e-6));
        std::printf("release: last sample at frame %d (expected %d)\n", last, 2000 + 4800 - 1);
    }
    // A graph larger than the fixed sizes is not built: the overflow flag, and the tone is silent
    {
        SynthTone t;
        t.active = true;
        t.basic = &waves;
        int last = 0;
        for (int i = 0; i <= NODES; ++i) last = t.gain(1.0f);
        CHECK(last == -1 && t.overflow());
        SynthTone fine;
        fine.active = true;
        fine.basic = &waves;
        int node = fine.osc(Wave::sine, 440.0f, 0.0f, 0, 10000);
        for (int i = 1; i < NODES; ++i) { const int g = fine.gain(1.0f); fine.connect(node, g); node = g; }
        fine.output(node);
        std::vector<float> l(256), r(256);
        fine.render(l.data(), r.data(), 256, *scratch);
        CHECK(!fine.overflow() && fine.active && l[100] != 0.0f);
        t.output(0);
        std::fill(l.begin(), l.end(), 0.0f);
        t.render(l.data(), r.data(), 256, *scratch);
        CHECK(!t.active && std::all_of(l.begin(), l.end(), [](float x) { return x == 0.0f; }));
        SynthTone params;
        params.basic = &waves;
        for (int i = 0; i < 4; ++i) { const int o = params.osc(Wave::sine, 440.0f, 0.0f, 0, 1); params.param(o, 0); params.param(o, 1); }
        CHECK(params.overflow());
        SynthTone events;
        Param& e = events.param(events.gain(1.0f));
        for (int i = 0; i < EVENTS; ++i) e.setValueAtTime(1.0f, i);
        CHECK(!events.overflow());
        e.setValueAtTime(1.0f, EVENTS);
        CHECK(events.overflow());
        // Chromium's first quantum keeps the values of one oscillator per tone whose frequency or detune moves: a tone with two overflows (it
        // is silent, never wrong) by its shape, also with both on a quantum's first frame (where nothing is kept); one alone plays.
        const auto ramps = [&](std::initializer_list<double> starts) {
            SynthTone t;
            t.active = true;
            t.basic = &waves;
            const int sum = t.gain(0.5f);
            for (const double start : starts) {
                const int o = t.osc(Wave::sine, 200.0f, 0.0f, start, 2000);
                t.param(o).exponentialRampToValueAtTime(100.0f, 1000);
                t.connect(o, sum);
            }
            t.output(sum);
            std::vector<float> l(256), r(256);
            t.render(l.data(), r.data(), 256, *scratch);
            return std::make_pair(t.overflow(), std::any_of(l.begin(), l.end(), [](float x) { return x != 0.0f; }));
        };
        CHECK(ramps({ 0.0, 128.0 }) == std::make_pair(true, false) && ramps({ 10.0 }) == std::make_pair(false, true));
    }

    // Timing, not asserted: ns per frame of one tone, rendered in chunks of 256 for 10 s of audio (the tone alone, its output added)
    const auto timed = [&](const char* name, auto build) {
        SynthTone t;
        t.active = true;
        t.basic = &waves;
        build(t);
        const int total = static_cast<int>(10 * sr);
        std::vector<float> l(SYNTH_FRAMES), r(SYNTH_FRAMES);
        const auto began = std::chrono::steady_clock::now();
        for (int at = 0; at < total; at += SYNTH_FRAMES) t.render(l.data(), r.data(), SYNTH_FRAMES, *scratch);
        const double ns = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - began).count() / total;
        std::printf("timing %-44s %6.1f ns per frame%s\n", name, ns, t.active ? "" : " (ended early)");
    };
    const double long_ = 20 * sr;
    timed("sawtooth, constant frequency", [&](SynthTone& t) { t.output(t.osc(Wave::sawtooth, 220.0f, 0.0f, 0, long_)); });
    timed("sine with a modulated frequency (+ sine, gain)", [&](SynthTone& t) {
        const int carrier = t.osc(Wave::sine, 220.0f, 0.0f, 0, long_), m = t.osc(Wave::sine, 330.0f, 0.0f, 0, long_), d = t.gain(200.0f);
        t.connect(m, d);
        t.modulate(d, t.param(carrier));
        t.output(carrier);
    });
    timed("looped buffer alone", [&](SynthTone& t) { t.output(t.buffer(noise.data(), static_cast<int>(noise.size()), 0, true, 0, long_)); });
    timed("looped buffer, static lowpass", [&](SynthTone& t) {
        const int lp = t.biquad(Filter::lowpass, 2000.0f, 1.0f);
        t.connect(t.buffer(noise.data(), static_cast<int>(noise.size()), 0, true, 0, long_), lp);
        t.output(lp);
    });
    timed("looped buffer, lowpass moved by an LFO (+ sine, gain)", [&](SynthTone& t) {
        const int lp = t.biquad(Filter::lowpass, 2000.0f, 1.0f), lfo = t.osc(Wave::sine, 0.5f, 0.0f, 0, long_), d = t.gain(800.0f);
        t.connect(t.buffer(noise.data(), static_cast<int>(noise.size()), 0, true, 0, long_), lp);
        t.connect(lfo, d);
        t.modulate(d, t.param(lp));
        t.output(lp);
    });
    timed("looped buffer, gain with an envelope", [&](SynthTone& t) {
        const int g = t.gain(0.0f);
        Param& p = t.param(g);
        p.setValueAtTime(0.0001f, 0);
        p.linearRampToValueAtTime(1.0f, 480);
        p.setValueAtTime(1.0f, 480);
        p.exponentialRampToValueAtTime(0.0001f, 10 * sr);
        t.connect(t.buffer(noise.data(), static_cast<int>(noise.size()), 0, true, 0, long_), g);
        t.output(g);
    });

    std::printf(failures ? "%d FAILED\n" : "all passed\n", failures);
    return failures ? 1 : 0;
}
