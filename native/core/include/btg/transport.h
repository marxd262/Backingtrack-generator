#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <limits>

namespace btg {

// The app's own clock, in beats. The control thread starts, stops, jumps, loops and sets the tempo,
// the audio thread advances it. No locks. A plugin later fills Block from the host's play head instead.
class Transport {
public:
    void play(double startBeats, double bpm) {
        bpm_ = bpm;
        seek_ = startBeats;
        playing_ = true;
    }
    void stop() { playing_ = false; }
    void setTempo(double bpm) { bpm_ = bpm; }
    void seek(double beats) { seek_ = beats; }
    // Repeats [start, end). end <= start switches the loop off.
    void setLoop(double startBeats, double endBeats) {
        loopStart_ = startBeats;
        loopEnd_ = endBeats;
    }

    bool playing() const { return playing_; }
    double bpm() const { return bpm_; }
    double beats() const { return beats_; }

    struct Block {
        bool playing = false;
        double beats = 0.0;         // position of the first frame
        double beatsPerFrame = 0.0;
        int frames = 0;             // how many frames this block covers (fewer than asked at a loop end)
    };

    // Audio thread. Covers at most `frames`; call again for the rest when a loop end cuts the block.
    Block advance(int frames, double sampleRate) {
        const double seek = seek_.exchange(none);
        double beats = seek == seek ? seek : beats_.load(); // NaN != NaN: no jump pending
        if (!playing_) {
            beats_ = beats;
            return { false, beats, 0.0, frames };
        }
        const double step = bpm_ / 60.0 / sampleRate;
        const double start = loopStart_, end = loopEnd_;
        const bool looping = end > start;
        if (looping && beats >= end) beats = start + std::fmod(beats - start, end - start);
        int count = frames;
        if (looping) count = std::min(frames, std::max(1, static_cast<int>(std::ceil((end - beats) / step - 1e-9))));
        double next = beats + count * step;
        if (looping && next >= end) next = start + (next - end);
        beats_ = next;
        return { true, beats, step, count };
    }

private:
    static constexpr double none = std::numeric_limits<double>::quiet_NaN();
    std::atomic<bool> playing_ { false };
    std::atomic<double> bpm_ { 120.0 };
    std::atomic<double> beats_ { 0.0 };
    std::atomic<double> seek_ { none };
    std::atomic<double> loopStart_ { 0.0 }, loopEnd_ { 0.0 };
};

} // namespace btg
