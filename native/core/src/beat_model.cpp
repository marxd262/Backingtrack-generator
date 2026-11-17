// Beat This! in C++: the track at 22050 Hz, a log mel spectrogram as the reference computes it (torchaudio:
// 1024-point Hann, hop 441, 128 Slaney mel bands from 30 to 11000 Hz, magnitude, log1p(1000 x)), the model in
// pieces of 30 s, then the reference's "minimal" peak picking. 50 frames a second.
#include "btg/beat_model.h"

#include "fft.h"

#include <onnxruntime_cxx_api.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>

namespace btg {
namespace {

const double PI = 3.141592653589793;
const int RATE = 22050, N = 1024, HOP = 441, MELS = 128, CHUNK = 1500, BORDER = 6;

// Band-limited resampling with a windowed sinc (16 zero crossings to each side, Blackman window).
std::vector<float> resample(const float* in, size_t frames, double rate) {
    if (rate == RATE) return std::vector<float>(in, in + frames);
    const double ratio = rate / RATE;                       // input samples per output sample
    const double cutoff = 0.94 * std::min(1.0, 1.0 / ratio); // of the input's half rate
    const int half = static_cast<int>(std::ceil(16 / cutoff));
    const auto kernel = [&](double x) { // x in input samples from the centre
        const double a = PI * cutoff * x, w = PI * x / half;
        return cutoff * (std::fabs(a) < 1e-9 ? 1.0 : std::sin(a) / a) * (0.42 + 0.5 * std::cos(w) + 0.08 * std::cos(2 * w));
    };
    // The kernel in a table, 256 steps to the input sample, read with a straight line between the steps
    // (computing it per tap costs seconds on a long track).
    const int FINE = 256;
    std::vector<float> table(static_cast<size_t>(2 * half * FINE + 2));
    for (size_t j = 0; j < table.size(); ++j) table[j] = static_cast<float>(kernel(static_cast<double>(j) / FINE - half));
    std::vector<float> out(static_cast<size_t>(static_cast<double>(frames) / ratio));
    const long long total = static_cast<long long>(frames);
    for (size_t n = 0; n < out.size(); ++n) {
        const double centre = static_cast<double>(n) * ratio;
        const long long base = static_cast<long long>(centre);
        const double frac = centre - static_cast<double>(base);
        const double step = (1 - frac) * FINE;            // table position of tap k is (k - 1 + half) * FINE + step
        const size_t whole = static_cast<size_t>(step);
        const float part = static_cast<float>(step - static_cast<double>(whole));
        const long long first = std::max<long long>(-half + 1, -base), last = std::min<long long>(half, total - 1 - base);
        float sum = 0.0f;
        for (long long k = first; k <= last; ++k) {
            const float* at = table.data() + static_cast<size_t>(k - 1 + half) * FINE + whole;
            sum += in[base + k] * (at[0] + part * (at[1] - at[0]));
        }
        out[n] = sum;
    }
    return out;
}

// Slaney's mel scale: linear below 1000 Hz, logarithmic above.
double melOf(double hz) { return hz < 1000 ? hz * 3 / 200 : 15 + std::log(hz / 1000) / (std::log(6.4) / 27); }
double hzOf(double mel) { return mel < 15 ? mel * 200 / 3 : 1000 * std::exp((std::log(6.4) / 27) * (mel - 15)); }

// rows = frames, MELS values each
std::vector<float> logMel(const std::vector<float>& x, size_t& steps) {
    steps = 1 + x.size() / HOP;
    const int bins = N / 2 + 1;
    // triangles between neighbouring band centres, not normalised (torchaudio: norm=None)
    std::array<double, MELS + 2> centre;
    for (int m = 0; m < MELS + 2; ++m) centre[static_cast<size_t>(m)] = hzOf(melOf(30) + (melOf(11000) - melOf(30)) * m / (MELS + 1));
    struct Band { int first = 0; std::vector<float> weights; };
    std::vector<Band> bands(MELS);
    for (int m = 0; m < MELS; ++m) {
        const double lo = centre[static_cast<size_t>(m)], mid = centre[static_cast<size_t>(m) + 1], hi = centre[static_cast<size_t>(m) + 2];
        bool open = false;
        for (int k = 0; k < bins; ++k) {
            const double hz = (RATE / 2.0) * k / (bins - 1);
            const double weight = std::max(0.0, std::min((hz - lo) / (mid - lo), (hi - hz) / (hi - mid)));
            if (weight <= 0) { if (open) break; continue; }
            if (!open) { bands[static_cast<size_t>(m)].first = k; open = true; }
            bands[static_cast<size_t>(m)].weights.push_back(static_cast<float>(weight));
        }
    }
    std::vector<double> window(N);
    for (int i = 0; i < N; ++i) window[static_cast<size_t>(i)] = 0.5 - 0.5 * std::cos(2 * PI * i / N);
    const long long total = static_cast<long long>(x.size());
    std::vector<float> out(steps * MELS);
    std::vector<std::complex<double>> buffer(N);
    std::vector<float> mag(static_cast<size_t>(bins));
    for (size_t t = 0; t < steps; ++t) {
        for (int i = 0; i < N; ++i) { // frame centred on t * HOP, the ends mirrored
            long long at = static_cast<long long>(t) * HOP + i - N / 2;
            if (at < 0) at = -at;
            if (at >= total) at = 2 * total - 2 - at;
            buffer[static_cast<size_t>(i)] = x[static_cast<size_t>(at)] * window[static_cast<size_t>(i)];
        }
        fft(buffer);
        for (int k = 0; k < bins; ++k) mag[static_cast<size_t>(k)] = static_cast<float>(std::abs(buffer[static_cast<size_t>(k)]) / 32); // / sqrt(N): "frame_length" normalisation
        for (int m = 0; m < MELS; ++m) {
            const Band& band = bands[static_cast<size_t>(m)];
            float sum = 0.0f;
            for (size_t k = 0; k < band.weights.size(); ++k) sum += band.weights[k] * mag[static_cast<size_t>(band.first) + k];
            out[t * MELS + static_cast<size_t>(m)] = std::log1p(1000 * sum);
        }
    }
    return out;
}

// Frames that are the largest within 70 ms to each side and more likely a beat than not; neighbours merged.
std::vector<double> peaks(const std::vector<float>& logits) {
    std::vector<double> times;
    const long long steps = static_cast<long long>(logits.size());
    double mean = 0.0; // of the run of neighbouring peaks being collected
    int run = 0;
    for (long long t = 0; t < steps; ++t) {
        if (logits[static_cast<size_t>(t)] <= 0) continue;
        bool top = true;
        for (long long o = std::max(0LL, t - 3); o <= std::min(steps - 1, t + 3) && top; ++o) top = logits[static_cast<size_t>(o)] <= logits[static_cast<size_t>(t)];
        if (!top) continue;
        if (run > 0 && static_cast<double>(t) - mean <= 1) { ++run; mean += (static_cast<double>(t) - mean) / run; }
        else { if (run > 0) times.push_back(mean / 50); mean = static_cast<double>(t); run = 1; }
    }
    if (run > 0) times.push_back(mean / 50);
    return times;
}

} // namespace

Grid findBeats(const float* mono, size_t frames, double sampleRate, const std::string& modelPath, const std::function<bool(double)>& progress, std::string* error) {
    Grid grid;
    try {
        if (frames < static_cast<size_t>(sampleRate)) return grid; // under a second: nothing to track
        if (!std::filesystem::exists(std::filesystem::path(std::u8string(modelPath.begin(), modelPath.end())))) {
            if (error) *error = "beat model not found: " + modelPath;
            return grid;
        }
        size_t steps = 0;
        const std::vector<float> mel = logMel(resample(mono, frames, sampleRate), steps);
        if (progress && !progress(0.1)) return grid;

        Ort::Env env(ORT_LOGGING_LEVEL_ERROR, "btg");
        Ort::SessionOptions options;
        options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
        Ort::Session session(env, std::filesystem::path(std::u8string(modelPath.begin(), modelPath.end())).c_str(), options);
        const Ort::MemoryInfo memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
        const char* const inputs[] = { "input_spectrogram" };
        const char* const outputs[] = { "beat", "downbeat" };

        // Pieces of 30 s that overlap by the border the model was not trained on; the last one ends with the track.
        const long long total = static_cast<long long>(steps);
        std::vector<long long> starts;
        for (long long s = -BORDER; s < total - BORDER; s += CHUNK - 2 * BORDER) starts.push_back(s);
        if (total > CHUNK - 2 * BORDER) starts.back() = total - (CHUNK - BORDER);
        std::vector<float> beat(steps, -1000.0f), down(steps, -1000.0f), piece;
        for (size_t done = 0; done < starts.size(); ++done) { // backwards: where pieces overlap, the earlier one counts
            const long long s = starts[starts.size() - 1 - done];
            const long long from = std::max(s, 0LL), to = std::min(s + CHUNK, total);
            const long long left = std::max(0LL, -s), right = std::max(0LL, std::min<long long>(BORDER, s + CHUNK - total));
            const long long length = left + (to - from) + right;
            piece.assign(static_cast<size_t>(length) * MELS, 0.0f);
            std::copy(mel.begin() + from * MELS, mel.begin() + to * MELS, piece.begin() + left * MELS);
            const std::array<int64_t, 3> shape { 1, length, MELS };
            Ort::Value input = Ort::Value::CreateTensor<float>(memory, piece.data(), piece.size(), shape.data(), shape.size());
            const std::vector<Ort::Value> found = session.Run(Ort::RunOptions { nullptr }, inputs, &input, 1, outputs, 2);
            const float* b = found[0].GetTensorData<float>();
            const float* d = found[1].GetTensorData<float>();
            for (long long k = BORDER; k < length - BORDER; ++k) {
                const long long at = s + k;
                if (at < 0 || at >= total) continue;
                beat[static_cast<size_t>(at)] = b[k];
                down[static_cast<size_t>(at)] = d[k];
            }
            if (progress && !progress(0.1 + 0.9 * static_cast<double>(done + 1) / static_cast<double>(starts.size()))) return {};
        }

        grid.beats = peaks(beat);
        for (const double t : peaks(down)) { // a bar starts on a beat: the nearest one
            if (grid.beats.empty()) break;
            const auto next = std::lower_bound(grid.beats.begin(), grid.beats.end(), t);
            const double nearest = next == grid.beats.begin() ? *next : next == grid.beats.end() || t - *(next - 1) <= *next - t ? *(next - 1) : *next;
            if (grid.downbeats.empty() || grid.downbeats.back() != nearest) grid.downbeats.push_back(nearest);
        }
    } catch (const std::exception& failure) {
        if (error) *error = failure.what();
        return {};
    }
    return grid;
}

} // namespace btg
