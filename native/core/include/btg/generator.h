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
// `voices` filled in; it is not validated here: the track must be one that the web app's normalizeTrack wrote and validateTrack
// accepted (a later task validates here). Throws (std::exception) when the JSON is not a track at all; an inconsistent one
// (`bars: []`, form parts summing to 0, a form longer than `length`) is undefined behaviour: a division by zero or an index outside `bars`.
std::vector<Event> buildEvents(const std::string& trackJson);

// The events with what a player needs around them. Event times are seconds at `bpm`.
struct Song {
    std::vector<Event> events;
    double bpm = 120.0;
    unsigned int seed = 1;
    std::vector<int> barBeats; // beats of every bar, in order
};
Song buildSong(const std::string& trackJson);

// The events as the web app's buildEvents gives them (each with the fields of its type, the fields that are set), as JSON text: what the page draws
// its lanes and LEDs from (native/PROTOKOLL.md section 7). Never throws but for an allocation that fails.
std::string eventsJson(const std::vector<Event>& events);

// The beat at which bar `bar` of the loop begins: the beats of the bars before it, each bars[chordIndex(track, i)].beats of the normalized track, as
// the web's player sums them for its start bar (src/audio/play.js 39-46); what the shell hands the transport to start at a bar (native/PROTOKOLL.md
// section 7). Throws std::invalid_argument for text that is no track and for a bar outside 0 to length - 1, where play() throws a RangeError.
double barStart(const std::string& trackJson, int bar);

// laneKey of the web app (src/ui/lanes.js 10), byte for byte: JSON.stringify of the track fields that change its event stream (key, bars, tags, seed,
// length, meter, groove, complexity, loose, ornaments, form, jobs, voices, variety; not the tempo, not the layers), a missing one as null. `trackJson`
// is a track's text; text that is no object counts as an object without fields. Never throws but for an allocation that fails.
std::string laneKey(const std::string& trackJson);

} // namespace btg
