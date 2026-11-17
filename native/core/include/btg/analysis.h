#pragma once

#include <cstddef>
#include <functional>
#include <string>
#include <vector>

namespace btg {

// What the analysis of a loaded track finds. Times in seconds.
struct Analysis {
    struct Chord {
        double start = 0.0, end = 0.0;
        int root = 0;       // pitch class, C = 0
        bool minor = false;
        std::string kind = "maj"; // the app's chord quality (src/core/chords.js): maj, min, dom7, maj7, min7, sus4, power, ...
    };
    double bpm = 0.0;
    std::vector<double> beats; // every beat
    int beat1 = 0;             // index in `beats` of the first beat that is a "one"
    int beatsPerBar = 4;       // entries of `beats` per bar, the usual number
    std::string meter = "4/4"; // "3/4", "5/4", ...; "6/8" and "12/8" when the beats are fast and come in threes
                               // (then `beats` are the eighth notes and `bpm` is the dotted beat)
    std::vector<int> bars;     // index in `beats` of every beat that starts a bar
    std::vector<Chord> chords; // back to back; a change sits on a beat or an eighth before one
    double tuningCents = 0.0;  // how far the track sits above A = 440 Hz (taken out before the chords are read)
    int keyRoot = 0;
    std::string keyMode;       // "major", "minor" or "dorian"
    std::string scale;         // suggestion in the app's names: majorPentatonic, minorPentatonic, dorian
};

// The separated parts of the same track, each as long as the mix and in its rate; any may be missing.
// With them the beats come from the drums, the chord roots from the bass and the chords from the rest.
struct Stems {
    const float* drums = nullptr;
    const float* bass = nullptr;
    const float* harmonic = nullptr; // everything that is neither drums nor bass
};

// Beats and bar starts found elsewhere (a beat model), in seconds. Empty: the analysis finds them itself.
struct Grid { std::vector<double> beats, downbeats; };

// Analyses a whole track. `progress` gets 0..1 from time to time; returning false cancels (the result is then empty).
Analysis analyze(const float* mono, size_t frames, double sampleRate, const std::function<bool(double)>& progress = {}, const Stems& stems = {}, const Grid& grid = {});

std::string chordName(int root, bool minor);       // "Bb", "F#m"
std::string chordName(const Analysis::Chord& chord); // with its kind: "Bb7", "F#m7", "Esus4"
std::string toJson(const Analysis& analysis);

} // namespace btg
