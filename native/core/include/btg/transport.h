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
    // leadSeconds: the clock stands at startBeats for that long (playing blocks with beatsPerFrame 0, the first one counts the start) and
    // then moves; the web app starts its song 0.15 s after play() so that the sum's compressors have settled. 0: moves at once.
    // During the lead: seek moves the place it stands on and the lead goes on, setTempo takes effect when the clock moves, stop stops
    // (the lead is gone), a second play starts a new lead.
    // Threads: the fields of a play are written first, then `starts_` is counted up, then `playing_` is set (stopped: the audio thread
    // sees the new start before it sees the clock run). The audio thread detects a play by `starts_` changing and only then reads
    // `startBeats_` and `lead_`; a seek is a separate field, cleared by play(), so a plain seek never carries a play's place.
    void play(double startBeats, double bpm, double leadSeconds = 0.0) {
        bpm_ = bpm;
        startBeats_ = startBeats;
        lead_ = leadSeconds;
        seek_ = none;
        beats_ = startBeats; // what beats() and standing() say until the audio thread has taken the play (the shell reports them)
        standing_ = leadSeconds > 0.0;
        ++starts_;
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
    bool standing() const { return standing_; } // playing, but in the lead: the clock stands at the start place (as of the last block)
    double bpm() const { return bpm_; }
    double beats() const { return beats_; }

    struct Block {
        bool playing = false;
        double beats = 0.0;         // position of the first frame
        double beatsPerFrame = 0.0;
        int frames = 0;             // how many frames this block covers (fewer than asked at a loop end)
        unsigned starts = 0;        // calls of play() so far: a change is a new start, also without a stopped block between
        bool lead = false;          // a block of a play's lead: playing, standing at the start place, nothing of the song is scheduled yet
        double bpm = 0.0;           // the tempo the clock will move with, given in a lead's blocks (there beatsPerFrame is 0); 0 where it is not given
    };

    // Audio thread. Covers at most `frames`; call again for the rest when a loop end cuts the block.
    Block advance(int frames, double sampleRate) {
        const unsigned starts = starts_;
        if (starts != seenStarts_) { // a new play: its place and its lead (written before the count, so they are the play's or a later one's)
            seenStarts_ = starts;
            beats_ = startBeats_.load();
            leadLeft_ = static_cast<long long>(std::llround(lead_ * sampleRate));
        }
        const double seek = seek_.exchange(none);
        double beats = seek == seek ? seek : beats_.load(); // NaN != NaN: no jump pending
        if (!playing_) { // (a lead that is still left stays: the play that follows replaces it, and this one may only be early to run)
            beats_ = beats;
            standing_ = false;
            return { false, beats, 0.0, frames, starts };
        }
        if (leadLeft_ > 0) { // the lead: standing at the start; the block is cut where it ends, so the first moving frame is exact
            const int count = static_cast<int>(std::min<long long>(frames, leadLeft_));
            leadLeft_ -= count;
            beats_ = beats;
            standing_ = true;
            return { true, beats, 0.0, count, starts, true, bpm_.load() };
        }
        standing_ = false;
        const double step = bpm_ / 60.0 / sampleRate;
        const double start = loopStart_, end = loopEnd_;
        const bool looping = end > start;
        if (looping && beats >= end) beats = start + std::fmod(beats - start, end - start);
        int count = frames;
        if (looping) count = std::min(frames, std::max(1, static_cast<int>(std::ceil((end - beats) / step - 1e-9))));
        double next = beats + count * step;
        if (looping && next >= end) next = start + (next - end);
        beats_ = next;
        return { true, beats, step, count, starts };
    }

private:
    static constexpr double none = std::numeric_limits<double>::quiet_NaN();
    std::atomic<bool> playing_ { false }, standing_ { false };
    std::atomic<unsigned> starts_ { 0 };
    std::atomic<double> bpm_ { 120.0 };
    std::atomic<double> beats_ { 0.0 };
    std::atomic<double> seek_ { none };
    std::atomic<double> loopStart_ { 0.0 }, loopEnd_ { 0.0 };
    std::atomic<double> lead_ { 0.0 }, startBeats_ { 0.0 }; // of the last play(): lead in s, start place in beats
    unsigned seenStarts_ = 0;            // audio thread only: the count of the last play it took
    long long leadLeft_ = 0;             // audio thread only: frames of the lead still to stand
};

} // namespace btg
