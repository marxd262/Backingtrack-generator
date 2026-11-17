// Analysis of a loaded track: tempo and beats from the onset strength (autocorrelation, then dynamic
// programming after Ellis 2007), chords from chroma per beat against major and minor triads with a
// smoothing pass (Viterbi), bar phase from where the chords change, key from the chords.
#include "btg/analysis.h"

#include "fft.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <numeric>
#include <string>
#include <vector>

namespace btg {
namespace {

const double PI = 3.141592653589793;
// Diagnosis only: with BTG_ANALYSIS_LOG set, what the rules do with the model's beats and bar starts goes to stderr.
const bool trace = std::getenv("BTG_ANALYSIS_LOG") != nullptr;
const int N = 4096, HOP = 512;
using Chroma = std::array<double, 12>;

double normalise(Chroma& c) {
    const double length = std::sqrt(std::inner_product(c.begin(), c.end(), c.begin(), 0.0));
    if (length > 0) for (double& v : c) v /= length;
    return length;
}

double knob(const char* name, double fallback);

// The mean of the distances within a tenth of `usual`. A beat model gives its times on a coarse grid (20 ms), so a
// median of beat distances is a value of that grid; the mean of the distances near it is finer.
double fine(const std::vector<double>& gaps, double usual) {
    double sum = 0.0;
    int near = 0;
    for (const double gap : gaps) if (std::fabs(gap / usual - 1) < 0.1) { sum += gap; ++near; }
    return near ? sum / near : usual;
}

// Spectral peaks of one frame onto pitch classes: full range for the chord, low range for its root.
// A peak counts less when the tone a twelfth below it (a third of its frequency) or two octaves and a third below
// (a fifth) is there too: then it is mostly that tone's overtone, and overtones of a triad's tones are exactly the
// sevenths and ninths (and, over a bare fifth, the major third) that are not played.
// `tuning`: how far the track sits above the semitones of A = 440 Hz, in semitones; taken out before a peak is
// assigned. `sits`, when given, collects where the peaks sit between the semitones (as a point on a circle).
void addPeaks(const std::vector<double>& mag, double rate, Chroma& all, Chroma& low, double tuning = 0.0, std::complex<double>* sits = nullptr) {
    static const double third = knob("H3", 0.6), fifth = knob("H5", 0.3);
    struct Peak { double hz, weight, tune; };
    std::vector<Peak> peaks;
    peaks.reserve(128);
    const double binHz = rate / N, top = *std::max_element(mag.begin(), mag.end());
    const int first = std::max(2, static_cast<int>(55 / binHz)), last = std::min(N / 2 - 2, static_cast<int>(2000 / binHz));
    for (int k = first; k <= last; ++k) {
        if (!(mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && mag[k] > 0.01 * top)) continue;
        const double shift = 0.5 * (mag[k - 1] - mag[k + 1]) / (mag[k - 1] - 2 * mag[k] + mag[k + 1]); // parabola through the peak
        peaks.push_back({ (k + shift) * binHz, std::sqrt(mag[k]), 0.0 });
    }
    const auto below = [&](double hz) { // the weight of the peak at this frequency (within a quarter tone), 0 if none
        const auto at = std::lower_bound(peaks.begin(), peaks.end(), hz * 0.972, [](const Peak& p, double v) { return p.hz < v; });
        double weight = 0.0;
        for (auto p = at; p != peaks.end() && p->hz < hz * 1.029; ++p) weight = std::max(weight, p->weight);
        return weight;
    };
    for (const Peak& peak : peaks) {
        const double keep = (1 - third * std::min(1.0, below(peak.hz / 3) / peak.weight)) * (1 - fifth * std::min(1.0, below(peak.hz / 5) / peak.weight));
        const double pitch = 69 + 12 * std::log2(peak.hz / 440) - tuning, nearest = std::floor(pitch + 0.5);
        if (sits) *sits += std::polar(peak.weight, 2 * PI * (pitch - nearest));
        const double weight = peak.weight * keep * (1 - 2 * std::fabs(pitch - nearest)); // in tune counts fully
        const int pc = ((static_cast<int>(nearest) % 12) + 12) % 12;
        all[pc] += weight;
        if (peak.hz < 260) low[pc] += weight;
    }
}

// A number of the analysis. Built with BTG_TUNING (CMake option, off by default) it can be set from outside for
// measuring (environment BTG_<name>, see native/tools/analysis-sweep.ps1); otherwise it is the value given here.
double knob(const char* name, double fallback) {
#ifdef BTG_TUNING
    const char* set = std::getenv((std::string("BTG_") + name).c_str());
    return set ? std::atof(set) : fallback;
#else
    (void) name;
    return fallback;
#endif
}

} // namespace

std::string chordName(int root, bool minor) {
    static const char* const NAMES[12] = { "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B" };
    return std::string(NAMES[((root % 12) + 12) % 12]) + (minor ? "m" : "");
}

std::string chordName(const Analysis::Chord& chord) {
    static const std::pair<const char*, const char*> SUFFIX[] = {
        { "maj", "" }, { "min", "m" }, { "dim", "dim" }, { "aug", "aug" }, { "sus2", "sus2" }, { "sus4", "sus4" }, { "power", "5" },
        { "dom7", "7" }, { "maj7", "maj7" }, { "min7", "m7" }, { "m7b5", "m7b5" }, { "dim7", "dim7" }, { "maj6", "6" }, { "min6", "m6" },
        { "add9", "add9" }, { "dom9", "9" }, { "min9", "m9" },
    };
    for (const auto& [kind, suffix] : SUFFIX) if (chord.kind == kind) return chordName(chord.root, false) + suffix;
    return chordName(chord.root, chord.minor);
}

Analysis analyze(const float* mono, size_t frames, double sampleRate, const std::function<bool(double)>& progress, const Stems& stems, const Grid& grid) {
    Analysis result;
    // A beat model that loses the pulse jumps between beat distances; steady beats almost never do (measured:
    // over 11 % of the distances off where its tempo was wrong, under 8 % elsewhere). Then the own tracker counts.
    Grid model = grid;
    {
        std::vector<double> gaps;
        for (size_t b = 1; b < model.beats.size(); ++b) gaps.push_back(model.beats[b] - model.beats[b - 1]);
        size_t off = 0;
        std::vector<double> near;
        for (size_t i = 0; i < gaps.size(); ++i) {
            near.assign(gaps.begin() + static_cast<ptrdiff_t>(i > 8 ? i - 8 : 0), gaps.begin() + static_cast<ptrdiff_t>(std::min(gaps.size(), i + 9)));
            std::nth_element(near.begin(), near.begin() + static_cast<ptrdiff_t>(near.size() / 2), near.end());
            if (std::fabs(gaps[i] / near[near.size() / 2] - 1) > 0.15) ++off;
        }
        if (static_cast<double>(off) > knob("UNSTEADY", 0.1) * static_cast<double>(gaps.size())) model = {};
        if (trace) std::fprintf(stderr, "steady: %zu of %zu model beat distances off, %s\n", off, gaps.size(), grid.beats.empty() ? "no model beats" : model.beats.empty() ? "own tracker" : "model beats");
    }
    // half the rate is plenty for chords and beats (averaging pairs is filter enough here)
    const int factor = sampleRate >= 40000 ? 2 : 1;
    const double rate = sampleRate / factor;
    const size_t count = frames / factor;
    if (count < static_cast<size_t>(4 * N)) return result;
    const auto sample = [&](const float* source, size_t i) { return factor == 2 ? 0.5 * (source[2 * i] + source[2 * i + 1]) : static_cast<double>(source[i]); };
    // which signal answers which question; without stems the mix answers all three
    const float* beatSource = stems.drums ? stems.drums : mono;
    const float* chordSource = stems.harmonic ? stems.harmonic : mono;
    const float* rootSource = stems.bass ? stems.bass : mono;

    // --- spectra: onset strength and chroma per frame ---
    const size_t steps = (count - N) / HOP + 1;
    const double frameRate = rate / HOP;
    std::vector<double> window(N), onset(steps, 0.0), previous(N / 2, 0.0), mag(N / 2);
    for (int i = 0; i < N; ++i) window[i] = 0.5 - 0.5 * std::cos(2 * PI * i / N);
    std::vector<Chroma> chroma(steps), bass(steps);
    std::vector<std::complex<double>> buffer(N);
    const auto spectrum = [&](const float* source, size_t t) {
        for (int i = 0; i < N; ++i) buffer[i] = sample(source, t * HOP + i) * window[i];
        fft(buffer);
        for (int k = 0; k < N / 2; ++k) mag[k] = std::abs(buffer[k]);
    };
    Chroma unused;
    // Tuning: a recording need not sit on A = 440 Hz (tape speed, old instruments). Where the peaks of every 8th
    // frame sit between the semitones, on average, is the offset; without it a track 40 cents off lands half its
    // tones on the wrong neighbour.
    double tuning = 0.0;
    if (knob("TUNING", 1) > 0) {
        std::complex<double> sits = 0.0;
        for (size_t t = 0; t < steps; t += 8) {
            spectrum(chordSource, t);
            addPeaks(mag, rate, unused, unused, 0.0, &sits);
        }
        tuning = std::arg(sits) / (2 * PI);
    }
    result.tuningCents = 100 * tuning;
    for (size_t t = 0; t < steps; ++t) {
        spectrum(beatSource, t);
        double flux = 0.0;
        for (int k = 0; k < N / 2; ++k) {
            const double loud = std::log1p(100 * mag[k]);
            flux += std::max(0.0, loud - previous[k]);
            previous[k] = loud;
        }
        onset[t] = flux;
        chroma[t].fill(0.0);
        bass[t].fill(0.0);
        if (chordSource != beatSource) spectrum(chordSource, t);
        addPeaks(mag, rate, chroma[t], rootSource == chordSource ? bass[t] : unused, tuning);
        if (rootSource != chordSource) {
            spectrum(rootSource, t);
            addPeaks(mag, rate, unused, bass[t], tuning);
        }
        if (progress && t % 256 == 0 && !progress(0.9 * static_cast<double>(t) / static_cast<double>(steps))) return {};
    }

    // --- tempo: the lag at which the onset strength repeats, with its multiples up to a bar ---
    {
        const int half = static_cast<int>(frameRate / 2);
        std::vector<double> flat(steps);
        for (size_t t = 0; t < steps; ++t) { // minus the local average, negatives off
            const size_t a = t > static_cast<size_t>(half) ? t - half : 0, b = std::min(steps, t + half);
            flat[t] = std::max(0.0, onset[t] - std::accumulate(onset.begin() + a, onset.begin() + b, 0.0) / static_cast<double>(b - a));
        }
        onset = flat;
    }
    const auto repeatAt = [&](double lag) { // autocorrelation at a fractional lag
        const size_t whole = static_cast<size_t>(lag);
        const double frac = lag - whole;
        double sum = 0.0;
        for (size_t t = 0; t + whole + 1 < steps; ++t) sum += onset[t] * ((1 - frac) * onset[t + whole] + frac * onset[t + whole + 1]);
        return sum / static_cast<double>(steps - whole);
    };
    double period = 0.0, best = -1.0;
    for (double bpm = 50; bpm <= 210; bpm += 0.25) {
        const double lag = 60 / bpm * frameRate;
        const double octaves = std::log2(bpm / 105);
        const double score = (repeatAt(lag) + 0.5 * repeatAt(2 * lag) + 0.25 * repeatAt(4 * lag)) * std::exp(-0.5 * octaves * octaves / (0.7 * 0.7)); // most music sits near 105
        if (score > best) { best = score; period = lag; }
    }
    if (progress && !progress(0.93)) return {};

    // --- beats: the path through the onsets that keeps the period (Ellis) ---
    if (!model.beats.empty()) {
        // A model may count some passages at half or double the tempo of the others. One count for the whole
        // track: the beat distance that covers most of the time (not the most frequent one: the fast count has
        // twice the beats). A passage counted twice as fast loses every second beat, one counted half as fast gets
        // beats in between. Only the plain octave counts: a passage at any other tempo is a change of tempo and
        // stays as it is. A single beat the model left out is filled in wherever it is.
        const size_t n = model.beats.size();
        std::vector<double> gaps, around(n, 0.0); // around: the usual distance near a beat (median over 8 beats to each side)
        for (size_t b = 1; b < n; ++b) gaps.push_back(model.beats[b] - model.beats[b - 1]);
        {
            std::vector<double> near;
            for (size_t b = 0; b < n && !gaps.empty(); ++b) {
                near.assign(gaps.begin() + static_cast<ptrdiff_t>(b > 8 ? b - 8 : 0), gaps.begin() + static_cast<ptrdiff_t>(std::min(gaps.size(), b + 8)));
                std::nth_element(near.begin(), near.begin() + static_cast<ptrdiff_t>(near.size() / 2), near.end());
                around[b] = fine(near, near[near.size() / 2]);
            }
        }
        std::vector<double> sorted = gaps;
        std::sort(sorted.begin(), sorted.end());
        double usual = 1.0, covered = 0.0;
        const double whole = std::accumulate(sorted.begin(), sorted.end(), 0.0);
        for (const double gap : sorted) { covered += gap; if (covered >= 0.5 * whole) { usual = gap; break; } }
        usual = fine(gaps, usual); // half and double of it are compared within 6 %: the grid alone would be 5 % at 0.4 s
        const auto isOne = [&](double t) {
            const auto at = std::lower_bound(model.downbeats.begin(), model.downbeats.end(), t - 0.03);
            return at != model.downbeats.end() && *at < t + 0.03;
        };
        const double octave = knob("OCTAVE", 0.06); // how close to half or double a passage must be
        double last = -1e9; // the beat kept last
        if (trace) std::fprintf(stderr, "usual beat distance %.4f s, octave tolerance %.3f\nbeat: time gap around faster slower one action filled\n", usual, octave);
        const auto say = [&](size_t b, const char* action, int filled = 0) {
            if (trace) std::fprintf(stderr, "beat: %.3f %.3f %.3f %d %d %d %s %d\n", model.beats[b], b ? model.beats[b] - model.beats[b - 1] : 0.0, around[b],
                std::fabs(around[b] / (usual / 2) - 1) < octave, std::fabs(around[b] / (2 * usual) - 1) < octave, isOne(model.beats[b]), action, filled);
        };
        for (size_t b = 0; b < n; ++b) {
            const double t = model.beats[b];
            int filled = 0;
            if (t < 0 || t >= static_cast<double>(count) / rate) continue;
            const bool faster = std::fabs(around[b] / (usual / 2) - 1) < octave, slower = std::fabs(around[b] / (2 * usual) - 1) < octave;
            if (faster) {
                if (t - last < 0.75 * usual) { say(b, "drop-between"); continue; } // the one in between
                // the passage starts here: begin it on the beat that keeps the model's bar starts
                if (t - last > 1.5 * usual && b + 1 < n && model.beats[b + 1] - t < 0.75 * usual && !isOne(t) && isOne(model.beats[b + 1])) { say(b, "drop-start"); continue; }
            } else if (t - last < knob("EXTRA", 0.6) * around[b] && b + 1 < n && std::fabs((model.beats[b + 1] - last) / around[b] - 1) < knob("EXTRA_NEXT", 0.15)) {
                say(b, "drop-extra"); // a single beat too many: the beats before and after it are the usual distance apart
                continue;
            } else if (b > 0 && !result.beats.empty()) {
                const double gap = t - model.beats[b - 1], unit = slower ? usual : around[b];
                const int parts = static_cast<int>(std::floor(gap / unit + 0.5));
                if (parts >= 2 && parts <= 4 && std::fabs(gap / (parts * unit) - 1) < 0.12)
                    for (int k = 1; k < parts; ++k) { result.beats.push_back(t - gap + gap * k / parts); ++filled; }
            }
            say(b, "keep", filled);
            result.beats.push_back(t);
            last = t;
        }
    } else {
        const double deviation = std::sqrt(std::inner_product(onset.begin(), onset.end(), onset.begin(), 0.0) / static_cast<double>(steps)) + 1e-9;
        std::vector<double> score(steps);
        std::vector<int> from(steps, -1);
        const int lo = static_cast<int>(period / 2), hi = static_cast<int>(period * 2);
        for (int t = 0; t < static_cast<int>(steps); ++t) {
            double top = 0.0;
            for (int back = lo; back <= hi && back <= t; ++back) {
                const double off = std::log(back / period), candidate = score[t - back] - 100 * off * off;
                if (from[t] < 0 || candidate > top) { top = candidate; from[t] = t - back; }
            }
            score[t] = onset[t] / deviation + (from[t] >= 0 ? top : 0.0);
        }
        int at = static_cast<int>(std::max_element(score.end() - std::min<ptrdiff_t>(hi, static_cast<ptrdiff_t>(steps)), score.end()) - score.begin());
        std::vector<double> beats;
        for (; at >= 0; at = from[at]) beats.push_back((at * HOP + N / 2) / rate);
        result.beats.assign(beats.rbegin(), beats.rend());
    }
    // --- threes: when the notes between the beats fall on thirds of the beat (both of them, so a shuffle does not
    // count) and not half way, the beat is a dotted one: 12/8 or 6/8 counted slowly. The beats then become the
    // eighth notes, as when the count is fast. ---
    bool threes = false;
    {
        const auto strength = [&](double t) { // the onset strength at a time, the strongest of three frames
            const long long i = static_cast<long long>((t * rate - N / 2) / HOP + 0.5);
            double top = 0.0;
            for (long long k = i - 1; k <= i + 1; ++k) if (k >= 0 && k < static_cast<long long>(steps)) top = std::max(top, onset[static_cast<size_t>(k)]);
            return top;
        };
        double thirds = 0.0, half = 0.0, onBeat = 0.0;
        for (size_t b = 0; b + 1 < result.beats.size(); ++b) {
            const double t = result.beats[b], d = result.beats[b + 1] - t;
            thirds += std::min(strength(t + d / 3), strength(t + 2 * d / 3));
            half += strength(t + d / 2);
            onBeat += strength(t);
        }
        // Where nothing is played between the beats both sums are next to nothing, and their ratio says nothing:
        // what the notes on the beats leave on the thirds is then more than what they leave half way (measured on a
        // 12/8 track whose beats are the eighths: 0.5 to 0.9 % of the strength on the beats; a quiet 12/8 counted
        // in dotted beats has 3.1 % there). So the notes on the thirds must also stand clear of that floor.
        const double floored = half + knob("THREES_FLOOR", 0.01) * onBeat;
        threes = result.beats.size() > 8 && thirds > knob("THREES", 1.5) * floored; // measured: 4/4 tracks up to 0.46
        if (trace) std::fprintf(stderr, "threes: notes on the thirds of the beat %.2f times those half way (limit %.2f), %.3f times those on the beats, %zu beats; with the floor %.2f times: %s\n", thirds / (half + 1e-9), knob("THREES", 1.5), thirds / (onBeat + 1e-9), result.beats.size(), thirds / (floored + 1e-9), threes ? "yes" : "no");
        if (threes) {
            std::vector<double> eighths;
            for (size_t b = 0; b + 1 < result.beats.size(); ++b)
                for (int k = 0; k < 3; ++k) eighths.push_back(result.beats[b] + (result.beats[b + 1] - result.beats[b]) * k / 3);
            eighths.push_back(result.beats.back());
            result.beats = eighths;
        }
    }
    const size_t beatCount = result.beats.size();
    if (beatCount < 8) return {};
    result.bpm = 60 * static_cast<double>(beatCount - 1) / (result.beats.back() - result.beats.front());
    if (!model.beats.empty()) { // a model may leave out stretches without a pulse: the usual distance, not the average
        std::vector<double> gaps(beatCount - 1);
        for (size_t b = 0; b + 1 < beatCount; ++b) gaps[b] = result.beats[b + 1] - result.beats[b];
        std::nth_element(gaps.begin(), gaps.begin() + static_cast<ptrdiff_t>(gaps.size() / 2), gaps.end());
        result.bpm = 60 / fine(gaps, gaps[gaps.size() / 2]);
    }

    // --- chords: chroma per beat against the 24 triads, smoothed ---
    std::vector<Chroma> beatChroma(beatCount), beatBass(beatCount);
    std::vector<double> loudness(beatCount), bassLevel(beatCount); // how loud a beat is in all, and below 260 Hz
    for (size_t b = 0; b < beatCount; ++b) {
        const double end = b + 1 < beatCount ? result.beats[b + 1] : result.beats[b] + 60 / result.bpm;
        const size_t first = static_cast<size_t>(std::max(0.0, (result.beats[b] * rate - N / 2) / HOP));
        const size_t last = std::min(steps, std::max(first + 1, static_cast<size_t>((end * rate - N / 2) / HOP)));
        beatChroma[b].fill(0.0);
        beatBass[b].fill(0.0);
        for (size_t t = first; t < last; ++t)
            for (int pc = 0; pc < 12; ++pc) { beatChroma[b][pc] += chroma[t][pc]; beatBass[b][pc] += bass[t][pc]; }
        loudness[b] = normalise(beatChroma[b]);
        bassLevel[b] = normalise(beatBass[b]);
    }
    std::array<double, 24> inKey {}; // head start for the chords of the key, once the key is known
    const double bassWeight = knob("BASS", 0.3), changeFree = knob("CHANGE", 0.35), changeCheap = knob("CHEAP", 0.2), changeDear = knob("DEAR", 0.8);
    std::vector<double> bassAt; // weight of the bass per beat, once the bars are known
    const auto fit = [&](size_t b, int state) { // state: root, +12 for minor
        const int root = state % 12, third = (root + (state >= 12 ? 3 : 4)) % 12, fifth = (root + 7) % 12;
        return (beatChroma[b][root] + beatChroma[b][third] + beatChroma[b][fifth]) / std::sqrt(3.0) + (bassAt.empty() ? bassWeight : bassAt[b]) * beatBass[b][root] + inKey[state];
    };
    // Viterbi; `cheap` marks beats where a change costs little (bar and half-bar starts, once the phase is known)
    const auto smooth = [&](const std::vector<bool>& cheap) {
        std::vector<std::array<double, 24>> total(beatCount);
        std::vector<std::array<int, 24>> back(beatCount);
        for (int s = 0; s < 24; ++s) total[0][s] = fit(0, s);
        for (size_t b = 1; b < beatCount; ++b) {
            const int stay = static_cast<int>(std::max_element(total[b - 1].begin(), total[b - 1].end()) - total[b - 1].begin());
            const double change = cheap.empty() ? changeFree : cheap[b] ? changeCheap : changeDear;
            for (int s = 0; s < 24; ++s) {
                const bool keep = total[b - 1][s] >= total[b - 1][stay] - change;
                back[b][s] = keep ? s : stay;
                total[b][s] = (keep ? total[b - 1][s] : total[b - 1][stay] - change) + fit(b, s);
            }
        }
        std::vector<int> path(beatCount);
        path.back() = static_cast<int>(std::max_element(total.back().begin(), total.back().end()) - total.back().begin());
        for (size_t b = beatCount - 1; b > 0; --b) path[b - 1] = back[b][path[b]];
        return path;
    };
    // --- key: the scale whose chords cover most of the time, with weight on the chord of its first degree ---
    // degrees (semitones above the tonic) that carry a major or a minor triad
    struct Mode { const char* name; const char* scale; std::vector<int> major, minor; bool minorTonic; };
    static const std::vector<Mode> MODES {
        { "major", "majorPentatonic", { 0, 5, 7 }, { 2, 4, 9 }, false },
        { "minor", "minorPentatonic", { 3, 8, 10, 7 }, { 0, 5, 7 }, true }, // with the major dominant
        { "dorian", "dorian", { 3, 5, 10 }, { 0, 2, 7 }, true },
    };
    const auto findKey = [&](const std::vector<int>& states) { // one state per beat; returns the mode found
        std::array<double, 24> time {};
        double whole = 1e-9;
        for (size_t b = 0; b + 1 < beatCount; ++b) { time[states[b]] += result.beats[b + 1] - result.beats[b]; whole += result.beats[b + 1] - result.beats[b]; }
        const Mode* found = &MODES[0];
        double top = -1.0;
        for (int root = 0; root < 12; ++root) {
            for (const Mode& mode : MODES) {
                double covered = 0.0;
                for (const int d : mode.major) covered += time[(root + d) % 12];
                for (const int d : mode.minor) covered += time[(root + d) % 12 + 12];
                const double tonic = time[root + (mode.minorTonic ? 12 : 0)] + 0.5 * time[root + (mode.minorTonic ? 0 : 12)];
                const bool opens = states.front() % 12 == root;
                const double score = covered / whole + 0.6 * tonic / whole + (opens ? 0.1 : 0.0);
                if (score > top) { top = score; found = &mode; result.keyRoot = root; result.keyMode = mode.name; result.scale = mode.scale; }
            }
        }
        return found;
    };
    std::vector<int> path = smooth({});
    if (progress && !progress(0.97)) return {};

    // --- bars: where every beat sits in its bar ---
    // Without a model: four beats to the bar, counted through. With bar starts from a model: its usual distance is
    // the beats per bar and every beat counts from the model's last bar start, so a dropped beat spoils one bar only.
    std::vector<size_t> ones;
    for (const double t : model.downbeats) {
        const size_t b = static_cast<size_t>(std::lower_bound(result.beats.begin(), result.beats.end(), t - 0.07) - result.beats.begin());
        if (b < beatCount && std::fabs(result.beats[b] - t) < 0.07) ones.push_back(b);
    }
    std::array<int, 13> distances {};
    for (size_t i = 1; i < ones.size(); ++i) if (ones[i] - ones[i - 1] >= 2 && ones[i] - ones[i - 1] <= 12) ++distances[ones[i] - ones[i - 1]];
    int perBar = 4;
    bool modelBars = false; // only when the model's bars are steady: most of them of one length
    if (ones.size() > 4) {
        const int usual = static_cast<int>(std::max_element(distances.begin(), distances.end()) - distances.begin());
        if (distances[static_cast<size_t>(usual)] >= 0.6 * static_cast<double>(ones.size() - 1)) { perBar = usual; modelBars = true; }
    }
    if (modelBars && perBar == 6 && result.bpm < 170 && !threes) perBar = 3; // six quarter notes: two bars of three
    if (modelBars && perBar == 2) { // bars of two beats: the model counted twice as fast as the beats now are; two of its bars are one
        std::vector<size_t> every;
        for (const size_t b : ones) if (every.empty() || b - every.back() >= 3) every.push_back(b);
        ones = every;
        perBar = 4;
    }
    if (threes && !modelBars) perBar = 12;                                   // four dotted beats, as most such tracks have
    const bool compound = threes || (modelBars && (perBar == 6 || perBar == 12)); // fast pulses in threes: 6/8, 12/8
    if (!modelBars && !threes) {
        // No steady bars from a model (none there, or it wavers as in 5/4): the bar is as long as the count at which
        // the chord changes line up best. Four, unless another count fits clearly better.
        const auto lineUp = [&](int length) {
            std::vector<int> at(static_cast<size_t>(length), 0);
            int changes = 0;
            for (size_t b = 1; b < beatCount; ++b) if (path[b] != path[b - 1]) { ++at[b % static_cast<size_t>(length)]; ++changes; }
            return changes ? *std::max_element(at.begin(), at.end()) / static_cast<double>(changes) : 0.0;
        };
        const double four = lineUp(4);
        for (const int length : { 3, 5, 6, 7 }) if (lineUp(length) > four + knob("METER_MARGIN", 0.25) && lineUp(length) > lineUp(perBar)) perBar = length;
    }
    if (trace) {
        std::fprintf(stderr, "bars: %zu model bar starts in use, distances between all that sit on a beat, in beats:", ones.size());
        for (size_t d = 1; d < distances.size(); ++d) if (distances[d]) std::fprintf(stderr, " %zux%d", d, distances[d]);
        std::fprintf(stderr, ", beats per bar %d, %s\n", perBar, modelBars ? "model bars" : "counted through");
    }
    result.beatsPerBar = perBar;
    result.meter = std::to_string(perBar) + (compound ? "/8" : "/4");
    std::vector<int> place(beatCount);
    for (size_t b = 0; b < beatCount; ++b) place[b] = static_cast<int>(b % perBar);
    if (modelBars) {
        // A bar start that comes too soon after the one before (the model counting a passage twice as fast) is
        // passed over; the count runs on from the last one that fits.
        std::vector<size_t> fitting;
        for (const size_t b : ones) if (fitting.empty() || b - fitting.back() >= static_cast<size_t>(perBar - 1)) fitting.push_back(b);
        if (trace) std::fprintf(stderr, "bars: %zu of %zu bar starts kept (the others come too soon)\n", fitting.size(), ones.size());
        ones = fitting;
        for (size_t b = ones[0], i = 0; b < beatCount; ++b) {
            if (i + 1 < ones.size() && b == ones[i + 1]) ++i;
            place[b] = static_cast<int>((b - ones[i]) % perBar);
        }
        for (size_t b = 0; b < ones[0]; ++b) place[b] = static_cast<int>((perBar - (ones[0] - b) % perBar) % perBar);
    }
    // The one is where the chords change; the model's own one gets a head start.
    std::vector<double> votes(static_cast<size_t>(perBar), 0.0);
    double changeCount = 1e-9;
    for (size_t b = 1; b < beatCount; ++b) if (path[b] != path[b - 1]) { ++changeCount; votes[place[b]] += 1; }
    for (double& v : votes) v /= changeCount;
    if (modelBars) votes[0] += knob("MODEL_ONE", 0.3);
    const int one = static_cast<int>(std::max_element(votes.begin(), votes.end()) - votes.begin());
    if (trace) {
        std::fprintf(stderr, "bars: chord changes by place in the bar (model one +%.2f):", modelBars ? knob("MODEL_ONE", 0.3) : 0.0);
        for (const double v : votes) std::fprintf(stderr, " %.2f", v);
        std::fprintf(stderr, ", the one is place %d\n", one);
    }
    for (size_t b = 0; b < beatCount; ++b) {
        place[b] = (place[b] - one + perBar) % perBar;
        if (place[b] == 0) result.bars.push_back(static_cast<int>(b));
    }
    result.beat1 = result.bars.empty() ? 0 : result.bars.front();
    const int half = perBar >= 4 && perBar % 2 == 0 ? perBar / 2 : perBar; // changes are cheap on the one and, in even bars, in the middle
    std::vector<bool> cheap(beatCount);
    for (size_t b = 0; b < beatCount; ++b) cheap[b] = place[b] % half == 0;
    // The bass plays the root where the bar starts and walks elsewhere: it counts by its place in the bar.
    bassAt.resize(beatCount);
    for (size_t b = 0; b < beatCount; ++b) bassAt[b] = place[b] == 0 ? knob("BASS_ONE", 0.6) : cheap[b] ? knob("BASS_HALF", 0.3) : knob("BASS_REST", 0.0);
    // Second pass along the bars, now with the key the first pass shows: where the third is unclear (power chords,
    // distortion), the chord that belongs to the key wins.
    {
        const Mode* mode = findKey(path);
        const double bonus = knob("IN_KEY", 0.1);
        for (const int d : mode->major) inKey[(result.keyRoot + d) % 12] = bonus;
        for (const int d : mode->minor) inKey[(result.keyRoot + d) % 12 + 12] = bonus;
    }
    path = smooth(cheap);
    // Passing chords: half a bar or less of a chord that is not of the key is a walk of the bass or a fill between
    // two chords, not a chord anyone would write down. It goes to the chord before it.
    if (knob("PASSING", 1) > 0) {
        const size_t most = static_cast<size_t>(std::max(1, perBar / 2));
        for (size_t b = 1; b < beatCount;) {
            size_t end = b;
            while (end < beatCount && path[end] == path[b]) ++end;
            if (path[b] != path[b - 1] && end - b <= most && end < beatCount && inKey[static_cast<size_t>(path[b])] == 0)
                for (size_t k = b; k < end; ++k) path[k] = path[b - 1];
            b = end;
        }
    }
    // A change in the middle of the bar that the bass makes only at the bar line belongs there: the upper voices
    // come early or play a fill, and nobody would write the chord down before its bar. That is where the chord
    // holds over the bar line, the old root is still there in the bass up to the line (at least 0.6 times as strong
    // as the new one), and at the line the balance tips to the new root (at least three times what it was).
    // Measured: where such a change came two beats before the label the old root had 0.72 to 4 times the strength
    // of the new one and the balance tipped by 5.7 times or more; where the bass had gone to the new root with the
    // upper voices the old root had at most 0.5 times, or the balance moved by at most 1.5 times. There must be a
    // bass to go by: beats with next to nothing below 260 Hz say nothing about a root (the strengths are relative
    // within a beat). Measured: in music the bass is 0.17 to 0.59 of the sound of such beats, without a bass 0.01.
    // Even bars only, and not in 6/8 and 12/8, where the middle of the bar is a beat like the one.
    if (half < perBar && !compound) {
        const double still = knob("HALF_STILL", 0.6), tips = knob("HALF_TIPS", 3.0), audible = knob("HALF_BASS_MIN", 0.1);
        for (size_t b = 1; b < beatCount; ++b) {
            const size_t from = static_cast<size_t>(path[b - 1] % 12), to = static_cast<size_t>(path[b] % 12);
            if (from == to || place[b] != half) continue;
            size_t line = b;
            while (line < beatCount && path[line] == path[b] && (line == b || place[line] != 0)) ++line;
            if (line >= beatCount || place[line] != 0 || path[line] != path[b]) continue; // the chord ends before the bar line
            double was = 0.0, now = 0.0, wasAfter = 0.0, nowAfter = 0.0; // "after": as many beats from the bar line on
            for (size_t k = b; k < line; ++k) { was += beatBass[k][from]; now += beatBass[k][to]; }
            for (size_t k = line; k < std::min(beatCount, 2 * line - b); ++k) { wasAfter += beatBass[k][from]; nowAfter += beatBass[k][to]; }
            double low = 0.0, all = 1e-9; // how much of the sound of these beats is bass
            for (size_t k = b; k < line; ++k) { low += bassLevel[k]; all += loudness[k]; }
            const bool moves = low >= audible * all && was > 0 && nowAfter > 0 && was >= still * now && nowAfter * was >= tips * now * wasAfter;
            if (trace) std::fprintf(stderr, "half: %.3f %s -> %s, old root against new before the bar line %.2f, the balance tips by %.1f, bass %.2f of the sound: %s\n", result.beats[b],
                chordName(path[b - 1] % 12, path[b - 1] >= 12).c_str(), chordName(path[b] % 12, path[b] >= 12).c_str(), was / (now + 1e-9), (nowAfter / (wasAfter + 1e-9)) / (now / (was + 1e-9) + 1e-9), low / all, moves ? "to the bar line" : "stays");
            if (moves) for (size_t k = b; k < line; ++k) path[k] = path[b - 1];
        }
    }
    if (trace) { // every chord change: where in the bar, and how strong the old and the new root are in the bass up to the next bar line
        for (size_t b = 1; b < beatCount; ++b) {
            if (path[b] == path[b - 1]) continue;
            size_t line = b + 1;
            while (line < beatCount && place[line] != 0) ++line;
            double was = 0.0, now = 0.0, wasAfter = 0.0, nowAfter = 0.0; // "after": as many beats from the bar line on
            for (size_t k = b; k < line; ++k) { was += beatBass[k][static_cast<size_t>(path[b - 1] % 12)]; now += beatBass[k][static_cast<size_t>(path[b] % 12)]; }
            for (size_t k = line; k < std::min(beatCount, 2 * line - b); ++k) { wasAfter += beatBass[k][static_cast<size_t>(path[b - 1] % 12)]; nowAfter += beatBass[k][static_cast<size_t>(path[b] % 12)]; }
            std::fprintf(stderr, "change: %.3f place %d of %d %s -> %s, bass up to the next bar on the old root %.2f, on the new %.2f, %s, after the bar line %.2f and %.2f\n", result.beats[b], place[b], perBar,
                chordName(path[b - 1] % 12, path[b - 1] >= 12).c_str(), chordName(path[b] % 12, path[b] >= 12).c_str(), was, now, line < beatCount && path[line] == path[b] ? "holds" : "ends before", wasAfter, nowAfter);
        }
    }
    // Near silence (before the music starts, in a break) there is no chord to read: such beats take the chord
    // before them, and the ones before the first sound take the first chord.
    {
        std::vector<double> sorted = loudness;
        std::nth_element(sorted.begin(), sorted.begin() + static_cast<ptrdiff_t>(sorted.size() / 2), sorted.end());
        const double quiet = knob("QUIET", 0.05) * sorted[sorted.size() / 2];
        size_t first = 0;
        while (first + 1 < beatCount && loudness[first] < quiet) ++first;
        for (size_t b = 0; b < beatCount; ++b) if (loudness[b] < quiet) path[b] = b < first ? path[first] : path[b - 1];
    }
    findKey(path);
    // Pushed chords: a chord may come an eighth before its beat. Where the stretch from the eighth to the beat
    // already sounds like the new chord and the stretch before it like the old one, the change sits on the eighth.
    // Triads only: the bass walks to the new root before the change and would pull every change forward.
    // Where the eighth sits is the track's own: half way, or later when it swings. It is the usual place of the
    // strongest note between two beats, counted from the note on the beat (the long window sees both coming, so
    // both are found equally early); at least half way, and where that place is later than three quarters of the
    // beat it is no eighth and nothing moves. Not in 6/8 and 12/8 (the beats are the eighths there), and not where
    // the stretch is shorter than the window of a spectrum: then the change stays on the beat.
    std::vector<double> startOf(result.beats);
    if (!compound) {
        const auto frameOf = [&](double t) { return static_cast<size_t>(std::max(0.0, (t * rate - N / 2) / HOP)); };
        std::vector<double> places;
        for (size_t b = 0; b + 1 < beatCount; ++b) {
            const double gap = result.beats[b + 1] - result.beats[b];
            const auto strongest = [&](double from, double to) { // the frame with the strongest onset between two times
                size_t top = frameOf(from);
                for (size_t t = top; t <= frameOf(to) && t < steps; ++t) if (onset[t] > onset[top]) top = t;
                return std::min(top, steps - 1);
            };
            const size_t on = strongest(result.beats[b] - 0.2 * gap, result.beats[b] + 0.2 * gap), top = strongest(result.beats[b] + 0.4 * gap, result.beats[b] + 0.8 * gap);
            if (onset[top] > 0 && onset[top] >= 0.3 * onset[on]) places.push_back(static_cast<double>(top - on) * HOP / rate / gap);
        }
        double swing = 0.5;
        if (places.size() >= 16) {
            std::nth_element(places.begin(), places.begin() + static_cast<ptrdiff_t>(places.size() / 2), places.end());
            swing = std::max(0.5, places[places.size() / 2]); // an eighth is never more than half a beat early
        }
        const auto part = [&](size_t from, size_t to) {
            Chroma sum {};
            for (size_t t = from; t < to; ++t) for (int pc = 0; pc < 12; ++pc) sum[pc] += chroma[t][pc];
            normalise(sum);
            return sum;
        };
        const auto triad = [](const Chroma& c, int state) { return (c[state % 12] + c[(state % 12 + (state >= 12 ? 3 : 4)) % 12] + c[(state % 12 + 7) % 12]) / std::sqrt(3.0); };
        const double early = knob("EARLY", 0.1);
        int changes = 0, moved = 0;
        for (size_t b = 1; b < beatCount && swing <= 0.75; ++b) {
            if (path[b] == path[b - 1]) continue;
            ++changes;
            const double eighth = result.beats[b - 1] + swing * (result.beats[b] - result.beats[b - 1]);
            if (result.beats[b] - eighth < N / rate) continue;
            const size_t from = frameOf(result.beats[b - 1]), mid = frameOf(eighth), to = std::min(steps, frameOf(result.beats[b]));
            if (mid < from + 2 || to < mid + 2) continue;
            const Chroma before = part(from, mid), after = part(mid, to);
            if (triad(after, path[b]) - triad(after, path[b - 1]) > early && triad(before, path[b - 1]) >= triad(before, path[b])) { startOf[b] = eighth; ++moved; }
        }
        if (trace) std::fprintf(stderr, "pushed: the eighth sits at %.2f of the beat (%zu beats with a note there), %d of %d chord changes moved to it\n", swing, places.size(), moved, changes);
    }
    for (size_t b = 0; b < beatCount; ++b) {
        const double end = b + 1 < beatCount ? result.beats[b + 1] : result.beats[b] + 60 / result.bpm;
        if (!result.chords.empty() && result.chords.back().root == path[b] % 12 && result.chords.back().minor == (path[b] >= 12)) result.chords.back().end = end;
        else result.chords.push_back({ startOf[b], end, path[b] % 12, path[b] >= 12 });
    }
    for (size_t i = 0; i + 1 < result.chords.size(); ++i) result.chords[i].end = result.chords[i + 1].start;

    if (compound) result.bpm /= 3; // the tempo of the dotted beat, as such meters are counted

    // --- chord kinds: what sounds besides root, third and fifth over the whole time a chord lasts ---
    // Cautious: a plain triad unless another tone is clearly there. Strengths are relative to root and fifth.
    {
        const double seventh = knob("K_SEVENTH", 0.65), sixth = knob("K_SIXTH", 0.7), ninth = knob("K_NINTH", 0.8);
        const double hung = knob("K_SUS", 0.7), bare = knob("K_BARE", 0.2);
        using Tones = std::array<double, 12>; // every tone above the root of a chord, against the mean of root and fifth
        // `s`: how strictly the tones are read. Above 1 an added tone must be that much stronger and a missing
        // third that much weaker to count; below 1 the other way round.
        const auto read = [&](const Tones& t, bool minor, double s) -> std::string {
            if (std::max(t[3], t[4]) < bare / s) return t[5] > hung * s ? "sus4" : t[2] > hung * s ? "sus2" : "power";
            if (minor) {
                if (t[6] > t[7] && t[6] > hung * s * t[0]) return t[9] > seventh * s && t[9] > t[10] ? "dim7" : t[10] > seventh * s ? "m7b5" : "dim";
                if (t[10] > seventh * s) return t[2] > ninth * s ? "min9" : "min7";
                return t[9] > sixth * s ? "min6" : "min";
            }
            // a sus chord has no clear third: a fourth over a triad whose third is there is a melody note or a held tone
            if (t[5] > hung * s && t[5] > t[4] && std::max(t[3], t[4]) < knob("K_SUS_THIRD", 0.5) / s) return "sus4";
            if (t[11] > seventh * s && t[11] > t[10]) return "maj7";
            if (t[10] > seventh * s) return t[2] > ninth * s ? "dom9" : "dom7";
            if (t[9] > sixth * s) return "maj6";
            return t[2] > ninth * s ? "add9" : "maj";
        };
        const size_t chordCount = result.chords.size();
        std::vector<Tones> tones(chordCount);
        std::vector<Chroma> lows(chordCount);
        for (size_t c = 0, b = 0; c < chordCount; ++c) {
            const auto& chord = result.chords[c];
            Chroma sum {};
            lows[c].fill(0.0);
            for (; b < beatCount && result.beats[b] < chord.end - 1e-6; ++b)
                for (int pc = 0; pc < 12; ++pc) { sum[pc] += beatChroma[b][pc] * loudness[b]; lows[c][pc] += beatBass[b][pc] * loudness[b]; }
            const double ref = 0.5 * (sum[static_cast<size_t>(chord.root)] + sum[static_cast<size_t>((chord.root + 7) % 12)]) + 1e-9;
            for (size_t i = 0; i < 12; ++i) tones[c][i] = sum[(static_cast<size_t>(chord.root) + i) % 12] / ref;
        }
        // Close calls follow the track. Where a tone sits near its threshold the kind of a chord flips with every
        // small change of the sound (another sample rate, MP3): the same chord is a seventh chord in one bar and a
        // triad in the next. A chord is close when a reading that much stricter and one that much looser disagree.
        // It then takes, of those two readings and its own, the kind that the clear chords with the same root and
        // third in this track have for the longest time: a track has few chords, and plays them the same way.
        const double close = knob("K_CLOSE", 0.2);
        const auto key = [](const Analysis::Chord& chord, const std::string& kind) { return std::to_string(chord.root) + (chord.minor ? "m " : " ") + kind; };
        std::map<std::string, double> clear; // root, third and kind -> the seconds chords clearly have it
        std::vector<std::string> own(chordCount), strict(chordCount), loose(chordCount);
        std::vector<bool> moved(chordCount, false), minorRead(chordCount);
        for (size_t c = 0; c < chordCount; ++c) {
            auto& chord = result.chords[c];
            minorRead[c] = chord.minor;
            chord.kind = own[c] = strict[c] = loose[c] = read(tones[c], chord.minor, 1.0);
            // A sixth chord has the tones of the minor seventh chord a third below (Bb6 = Gm7). The bass tells
            // them apart: on the lower root, and with that minor chord in the key, it is the minor seventh. That
            // rests on the bass, not on a threshold, so such a chord is not a close call.
            const int relative = (chord.root + 9) % 12;
            if (own[c] == "maj6" && inKey[static_cast<size_t>(relative) + 12] > 0 && lows[c][static_cast<size_t>(relative)] > knob("SIXTH_BASS", 1.0) * lows[c][static_cast<size_t>(chord.root)]) {
                chord.root = relative;
                chord.minor = true;
                chord.kind = "min7";
                moved[c] = true;
                continue;
            }
            strict[c] = read(tones[c], chord.minor, 1 + close);
            loose[c] = read(tones[c], chord.minor, 1 - close);
            if (strict[c] == own[c] && loose[c] == own[c]) clear[key(chord, own[c])] += chord.end - chord.start;
        }
        for (size_t c = 0; c < chordCount; ++c) {
            auto& chord = result.chords[c];
            const bool isClose = strict[c] != own[c] || loose[c] != own[c];
            if (isClose) {
                double most = clear.count(key(chord, own[c])) ? clear[key(chord, own[c])] : 0.0;
                for (const std::string& other : { strict[c], loose[c] }) {
                    const auto found = clear.find(key(chord, other));
                    if (found != clear.end() && found->second > most) { most = found->second; chord.kind = other; }
                }
            }
            if (trace) { // the chord as named; how it was read (moved: a sixth chord read as the minor seventh below); its tones
                std::fprintf(stderr, "kind: %.3f %.3f %s %s |", chord.start, chord.end, chordName(chord).c_str(), moved[c] ? "moved" : minorRead[c] ? "minor" : "major");
                for (const double v : tones[c]) std::fprintf(stderr, " %.3f", v);
                if (isClose) std::fprintf(stderr, " | close: by itself %s, stricter %s, looser %s", own[c].c_str(), strict[c].c_str(), loose[c].c_str());
                std::fprintf(stderr, "\n");
            }
        }
    }

    if (progress) progress(1.0);
    return result;
}

std::string toJson(const Analysis& a) {
    nlohmann::ordered_json j;
    j["bpm"] = std::round(a.bpm * 10) / 10;
    j["beatsPerBar"] = a.beatsPerBar;
    j["meter"] = a.meter;
    j["beat1"] = a.beat1;
    j["bars"] = a.bars;
    j["tuningCents"] = std::round(a.tuningCents);
    j["key"] = { { "root", chordName(a.keyRoot, false) }, { "mode", a.keyMode } };
    j["scale"] = a.scale;
    j["beats"] = nlohmann::ordered_json::array();
    for (const double t : a.beats) j["beats"].push_back(std::round(t * 1000) / 1000);
    j["chords"] = nlohmann::ordered_json::array();
    for (const auto& c : a.chords)
        j["chords"].push_back({ { "t", std::round(c.start * 1000) / 1000 }, { "end", std::round(c.end * 1000) / 1000 }, { "chord", chordName(c) }, { "kind", c.kind }, { "root", c.root }, { "minor", c.minor } });
    return j.dump();
}

} // namespace btg
