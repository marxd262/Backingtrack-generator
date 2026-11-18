#pragma once

#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace btg {

// One entry of the event stream (docs/interface.md, "buildEvents"). Which fields count depends on the type.
struct Event {
    enum class Type { chord, marker, note, hit };
    Type type = Type::chord;
    double t = 0.0;             // seconds from the start
    int bar = 0;
    std::optional<double> beat; // position in the bar in beats (the fill marker has none)
    std::string layer;          // note, hit: "drums", "bass", "chords", "pad", "lead", "percussion"
    std::string name;           // hit: drum name; marker: "fill" or "section"
    int midi = 0;               // note
    double vel = 0.0;           // note, hit
    double dur = 0.0;           // note
    std::string chordRoot, chordQuality; // chord
    std::string kind;           // section marker: type of the part
    int index = 0;              // section marker: place in the form
    std::string art;            // articulation, empty = none
    std::optional<double> artSemi, artTime, artRate;
    std::optional<std::pair<int, int>> strum; // chords: place of the tone in its stab and how many tones the stab has
    std::optional<double> strumUp, leslie, swell;
    bool ring = false;          // chords: the stab rings out
};

// Port of buildEvents() of the web app (src/core/events.js), all six layers: for the same track the same events,
// bit for bit (native/core/tests/test_parity.cpp). `trackJson` is a track as normalizeTrack() writes it, with
// `voices` filled in; it is not validated here. Throws (std::exception) when the JSON is not such a track.
std::vector<Event> buildEvents(const std::string& trackJson);

// The events with what a player needs around them. Event times are seconds at `bpm`.
struct Song {
    std::vector<Event> events;
    double bpm = 120.0;
    unsigned int seed = 1;
    std::vector<int> barBeats; // beats of every bar, in order
};
Song buildSong(const std::string& trackJson);

} // namespace btg
