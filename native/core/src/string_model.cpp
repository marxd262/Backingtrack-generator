// src/audio/string-model.js line by line (line numbers of that file): doubles where the JavaScript has numbers, the result float32, every
// operation in the JavaScript's order (no fused multiply-add: CMakeLists.txt).
#include "string_model.h"

#include "generator_internal.h"

#include <algorithm>
#include <numbers>
#include <stdexcept>
#include <string>

namespace btg::detail {
namespace {

const double RELEASE_TC = 0.02; // 28: the fall after the note's end (s)
const int MAX_PARTIALS = 64;
const int REF_PARTIAL = 6;      // the partial whose decay `brightness` sets
const double TARGET_RMS = 0.3;  // the level of the sum before the lowpass and the body
struct Body { double hz, q, gain; };
const Body BODY[2] = { { 95, 3, 0.5 }, { 210, 4, 0.4 } };

// 34 to 41: every value of RANGES clamped to its range, a value that is not finite the default of STRING_DEFAULTS
double clean(double v, double lo, double hi, double fallback) { return std::isfinite(v) ? std::min(hi, std::max(lo, v)) : fallback; }

} // namespace

std::vector<float> renderString(double midi, double seconds, double dur, double vel, double sampleRate, uint32_t seed, const StringParams& params) {
    if (!std::isfinite(midi) || !std::isfinite(seconds) || seconds <= 0 || !std::isfinite(sampleRate) || sampleRate <= 0) { // 48 to 50
        throw std::invalid_argument("renderString: midi, seconds and sampleRate must be finite and positive, got " + std::to_string(midi) + ", "
                                    + std::to_string(seconds) + ", " + std::to_string(sampleRate));
    }
    const StringParams p { clean(params.pluckPos, 0, 0.5, 0.2), clean(params.brightness, 0, 1, 0.6), clean(params.decay, 0.05, 10, 1.5),
                           clean(params.excite, 0, 1, 0.6), clean(params.stiffness, 0, 1, 0.1), clean(params.pickupPos, 0, 0.5, 0.15),
                           clean(params.pickupLp, 200, 20000, 5000), clean(params.body, 0, 1, 0.3) };
    const double v = std::isfinite(vel) ? std::min(1.0, std::max(0.0, vel)) : 0.8;
    const long long length = static_cast<long long>(std::ceil(seconds * sampleRate));
    const double noteEnd = jsRound((std::isfinite(dur) ? dur : seconds) * sampleRate);
    const double f0 = 440 * std::pow(2.0, (midi - 69) / 12);
    const double excite = std::min(1.0, p.excite * (0.55 + 0.9 * v));
    const double slope = 2.4 - 1.6 * excite;
    const double stiff = p.stiffness * p.stiffness * 4e-4;
    const double t6 = std::min(p.decay, 0.04 * std::pow(25.0, p.brightness));
    const double rate0 = 1 / p.decay, rateRef = 1 / t6;
    // 61, 62: after noteEnd the hand damps; nothing after that needs computing (the fall is below 1e-5 there)
    const long long stop = std::min(length, static_cast<long long>(noteEnd + std::ceil(11.6 * RELEASE_TC * sampleRate)));

    // 64 to 78: the partials' frequency, initial amplitude (slope, pluck and pickup position) and decay rate
    struct Partial { double freq, amp, rate; };
    std::vector<Partial> partials;
    double power = 0;
    for (int h = 1; h <= MAX_PARTIALS; h++) {
        const double freq = h * f0 * std::sqrt(1 + stiff * h * h);
        if (freq >= 0.45 * sampleRate) break;
        double amp = std::pow(static_cast<double>(h), -slope);
        if (p.pluckPos > 0) amp *= std::sin(std::numbers::pi * h * p.pluckPos);
        if (p.pickupPos > 0) amp *= std::sin(std::numbers::pi * h * p.pickupPos);
        if (std::fabs(amp) < 1e-4) continue;
        const double rate = rate0 + (rateRef - rate0) * std::pow(static_cast<double>(h - 1) / (REF_PARTIAL - 1), 1.5); // 1 / T60, growing with h
        partials.push_back({ freq, amp, rate });
        power += (amp * amp) / 2;
    }
    const double scale = power > 0 ? TARGET_RMS / std::sqrt(power) : 0;

    // 80 to 95: each partial a decaying sine by the recurrence (r e^{jw})^i, im = r^i sin(w i), up to where it has fallen below 1e-4
    std::vector<double> string(static_cast<size_t>(length));
    for (const Partial& partial : partials) {
        const double w = (2 * std::numbers::pi * partial.freq) / sampleRate;
        const double r = std::exp((-6.9078 * partial.rate) / sampleRate); // -60 dB after 1 / rate seconds
        const double c = r * std::cos(w), s = r * std::sin(w);
        const double a = partial.amp * scale;
        const long long last = std::min(stop, static_cast<long long>(std::ceil((9.21 / (6.9078 * partial.rate)) * sampleRate)));
        double re = 1, im = 0;
        for (long long i = 0; i < last; i++) {
            string[static_cast<size_t>(i)] += a * im;
            const double nr = re * c - im * s;
            im = re * s + im * c;
            re = nr;
        }
    }
    // 96 to 104: the attack noise, a short lowpassed burst, louder for a harder attack
    Rng rng(seed);
    const double noiseAmp = TARGET_RMS * (0.1 + 0.5 * excite);
    const long long burst = std::min(stop, static_cast<long long>(std::ceil(0.08 * sampleRate)));
    double low = 0;
    for (long long i = 0; i < burst; i++) {
        low = 0.45 * (rng.next() * 2 - 1) + 0.55 * low;
        string[static_cast<size_t>(i)] += noiseAmp * low * std::exp(-static_cast<double>(i) / (0.012 * sampleRate));
    }

    // 106 to 129: the pickup's lowpass, the body, the velocity's level and the damping after the note's end
    const double pa = std::exp((-2 * std::numbers::pi * p.pickupLp) / sampleRate);
    struct Filter { double b0, a1, a2, gain, x1, x2, y1, y2; } bodyFilters[2];
    for (int k = 0; k < 2; ++k) {
        const double wb = (2 * std::numbers::pi * BODY[k].hz) / sampleRate, alpha = std::sin(wb) / (2 * BODY[k].q), b0 = alpha, a0 = 1 + alpha;
        bodyFilters[k] = { b0 / a0, (-2 * std::cos(wb)) / a0, (1 - alpha) / a0, BODY[k].gain, 0, 0, 0, 0 };
    }
    std::vector<float> out(static_cast<size_t>(length));
    const double level = 0.3 + 0.7 * v;
    double plp = 0;
    for (long long i = 0; i < stop; i++) {
        const double x = string[static_cast<size_t>(i)];
        plp = (1 - pa) * x + pa * plp;
        double sum = plp;
        if (p.body > 0) {
            for (Filter& f : bodyFilters) {
                const double yb = f.b0 * (x - f.x2) - f.a1 * f.y1 - f.a2 * f.y2;
                f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = yb;
                sum += p.body * f.gain * yb;
            }
        }
        const double release = static_cast<double>(i) > noteEnd ? std::exp(-(static_cast<double>(i) - noteEnd) / (RELEASE_TC * sampleRate)) : 1;
        out[static_cast<size_t>(i)] = static_cast<float>(sum * level * release);
    }
    return out;
}

} // namespace btg::detail
