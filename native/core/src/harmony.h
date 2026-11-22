#pragma once

// The harmony of the web app and the data its displays read, on JSON values, one function for each of the JavaScript's with its name:
// progressionFor (progressions.js), colorChord and colorProgression (harmony.js), styleChordColor (tags.js), chordTimeline (timeline.js),
// fretboardNotes, nextDistinctChord, progressionRoles, romanDegree, beatsUntilChange and degreeLabel (fretboard.js). native/core/tests/test_logic.cpp
// compares them with the web app one by one. Control thread only.
//
// Each function says what the web app's callers hand it (its domain: src/ui/ and the profile loader) and what the core does outside it.
// Inside the domain, and for every input the JavaScript itself guards or throws on, the answer is the JavaScript's (the tests hold that). Outside:
//  - where the JavaScript throws, the core throws std::invalid_argument (the message is not the JavaScript's);
//  - where the JavaScript coerces a value (a text read as a number, `>>> 0` on a list) and goes on, the core does NOT rebuild the coercion: it throws
//    std::invalid_argument, so that it never answers differently without saying so. These places are named below and marked `shortcut:` in harmony.cpp.
// A missing value ("undefined") and null are the same null here where the JavaScript treats them alike (a default parameter is the exception:
// fretboardNotes takes an object, so that a missing tuning is not a null one).

#include "track_internal.h"

#include <cstdint>
#include <optional>

namespace btg::detail {

// form.js sectionAt(form, bar): the part the bar lies in, its index and the bar within it; none outside the form, for a bar that is no integer of at least 0, and for a part
// whose `bars` is no integer of at least 1 on the way. Never throws.
struct SectionHit { size_t index; double barInSection; };
std::optional<SectionHit> sectionAt(const Json& form, double bar);
// form.js chordIndex({ bars, form }, barIndex) for one track: the entry of `bars` for the bar; with a valid form every part starts the progression again. A number that is
// no index (below 0, or NaN) comes out as the JavaScript's does. The form is checked (isValidForm) and its parts' ends are summed once, when it is made, not for every bar
// (the session's position asks for hundreds of bars 30 times a second). Never throws.
class ChordIndex {
public:
    ChordIndex(const Json& bars, const Json& form);
    double operator()(double barIndex) const;
private:
    double count_;             // bars.length
    std::vector<double> ends_; // with a valid form, where each part ends (sectionAt's `start + section.bars`); empty without one
};

// rng.js createRng: `seed >>> 0`. A number of any value (a fraction, a negative one, beyond 2^32, not finite); null counts as 0. A seed that is a text, a boolean, a list or
// an object throws std::invalid_argument (the web takes 5, 1, 5 of them): see the shortcut comment in harmony.cpp.
uint32_t seedBase(const Json& seed);

// progressions.js. Domain: a valid key, an integer seed (a number of any value works as `seed >>> 0` does: a fraction, a negative one, beyond 2^32; null or
// missing is 0). Throws for a key that allowedChords throws for. A seed that is a text, a boolean, a list or an object throws (the web takes 5, 1, 5, ... of them).
Json progressionFor(const Json& key, const Json& seed);
// harmony.js. Domain: a chord { root, quality }, one of the four colours, a valid key. Outside it equal to the JavaScript, which guards it: an unknown colour, quality
// or root, a root without a step in the key and an invalid key leave the chord as it is (a new object); null gives {}. Never throws.
Json colorChord(const Json& chord, const Json& color, const Json& key);
// harmony.js. Domain: a list of bars { chord, beats } as in a track. Throws where the JavaScript's map does (no list, a null bar). The keys of a bar keep the
// input's order (the web puts integer-like keys first; bars have none).
Json colorProgression(const Json& bars, const Json& color, const Json& key);
// tags.js. Domain: the id of one of STYLE_PRESETS, an integer seed (the seed is read only with variety and a style that has an alternative colour, as in the web
// app; a seed that is no number throws, as in progressionFor). The web function takes the preset object: the core takes its id and finds the colours in
// music.json. Any other value is no preset (the web's `undefined`): "triads". A chordColor of "" counts as none (the web keeps it; no preset has one).
std::string styleChordColor(const Json& style, const Json& seed, bool variety);
// timeline.js. Domain: a track that normalizeTrack and validateTrack accept. A track they do not accept throws std::invalid_argument, but the exception has no
// list of errors (the web's has `.errors`): a caller that shows them calls validateTrack itself.
Json chordTimeline(const Json& track);

// fretboard.js. Domain: `options` is { key, scale, current, next }, as ui/fretboard.js hands it; tuning and frets are optional (a missing one is the standard,
// 22 frets). An invalid key or scale gives []; a current or next that is no usable chord counts as none; `options` null throws (as the web's destructuring),
// a value that is no object gives []. A tuning that is no list throws as in the web; a tuning entry that is no number, and frets that is neither a number nor null
// (null counts as 0, as in the web), throw where the web coerces them.
Json fretboardNotes(const Json& options);
// fretboard.js. Domain: a list of bars { chord, beats }, an integer length of at least 1, an integer barIndex or null, a form or null. The answer is the first
// chord after the one at `barIndex` that differs from it, going around over `length` bars; null if there is none and, as in the web, for everything it
// cannot compute (no list, a bar without a usable chord). Never throws. An input that is no integer length or barIndex is handled as the web does.
Json nextDistinctChord(const Json& bars, const Json& length, const Json& barIndex, const Json& form);
// fretboard.js. Domain: a track { bars (a list of { chord }), length, form }, `bar` null or an integer. Role of each bar entry: "now", "hold", "next" or "later".
// Throws where the web does (no track or bars, a bar without a usable chord on the way). A `bar` that is a text or other non-number, and a `length` that is
// a text, a boolean or other non-number (null and missing are as in the web), throw where the web coerces them. A number as `bar` of any value is the web's.
Json progressionRoles(const Json& track, const Json& bar);
// fretboard.js. Domain: a valid key and chord. The numeral of the chord's root in the key, lower case for a chord with a minor third. Throws where the web does
// (a root that is no note name, a null chord or key, a quality that is a name every object has: 'toString').
std::string romanDegree(const Json& key, const Json& chord);
// fretboard.js. Domain: a normalised track { bars, length, bpm, form } and a number of seconds (`songSec`). Whole beats to the next bar with another chord, at
// least 1; null if the track has only one chord, and for a length below 1 or none, as in the web. Throws where the web does (no bars, a bar that is no chord).
// A `length` that is a text, no or a non-numeric `bpm`, and a bar without numeric `beats` throw where the web goes on with NaN or a coerced text. NaN seconds
// give NaN (null in JSON, the same as "no change"; the web tells them apart).
Json beatsUntilChange(const Json& track, double songSec);
// fretboard.js. Domain: a key with a note name as root (it is called by fretboardNotes with integer pitch classes). Throws for a key without one, and for a pitch
// class that is no integer (the web answers `undefined`, which a JSON value cannot hold).
std::string degreeLabel(const Json& key, double pc);

} // namespace btg::detail
