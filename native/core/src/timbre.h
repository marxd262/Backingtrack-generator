#pragma once

// The sound model's logic on JSON values, one function for each of the web app's with its name: resolveTimbre and resolveTrackTimbre
// (core/timbre.js), usesTimbreField (core/voices.js), isSoundOnlyChange (core/tags.js), tagEffect (ui/tag-effects.js), organTuning and presetDrive
// (ui/organ-tuning.js). completeTimbre (timbre.js) is in sound_model.h, typed. native/core/tests/test_logic.cpp compares them with the web app one by one.
// Control thread only.
//
// A value is nlohmann::ordered_json (track_internal.h): the order of an object's keys is the text's, and it decides the order of the sums of resolveTimbre.
// Each function says what the web app's callers hand it (its domain: src/ui/ and src/audio/) and what the core does outside it.
// Inside the domain, and for every input the JavaScript itself guards or throws on, the answer is the JavaScript's (the tests hold that). Outside:
//  - where the JavaScript throws, the core throws std::invalid_argument (the message is not the JavaScript's);
//  - where the JavaScript coerces a value and goes on, the core rebuilds the coercion only where it is a line of code (a value joined to a text for a property name,
//    `String(x)`); where it would need more, the core throws std::invalid_argument, so that it never answers differently without saying so. Those places are named
//    below and marked `shortcut:` in timbre.cpp.
// A missing value ("undefined") and null are the same null here where the JavaScript treats them alike.

#include "track_internal.h"

namespace btg::detail {

// timbre.js. Domain: a track's `tags`: null, missing or { category: [tag ids] } (what normalizeTrack gives). Returns the 47 knobs { group: { field: value } }, the defaults moved by the
// effect of each chosen tag (a tag counts once, in the order the tags are named) and clamped to [0, 1]. Throws std::invalid_argument where the JavaScript does (collectTags): an unknown
// category, a tag the category does not have, a list that is no array (a text that is not empty, a number, an object, null). A value that is no object, or no list of entries, has
// none (a number, `true`, an empty text or list): the defaults. A non-empty text as a category's list is read by the web character by character, and no tag is one character: the
// core throws as the web does for as long as that holds (shortcut in timbre.cpp).
Json resolveTimbre(const Json& tags);

// timbre.js. Domain: a track as the app holds it (the fields tags, variety, seed and timbre are read). Anything that is no object has none of them (the defaults). The knobs of
// resolveTimbre(track.tags); with `variety` true and a finite number as seed, the seed moves seven of them (a draw each, in the web app's order, of the fork "timbre-drift"; a seed of any
// value is read as `seed >>> 0`); then every field `track.timbre` gives as a finite number (in a group that is an object) replaces it, clamped. Throws like resolveTimbre.
Json resolveTrackTimbre(const Json& track);

// voices.js. Domain: a track's `voices` and a knob path "group.field". The distortion chain, the vibrato and the chorus work behind every voice, a layer the registry does not have has no
// voices (all of master): both count as used. Otherwise the chosen voice's `uses` decide (sound.json). Never throws: anything is a `voices` (completeVoices fills it), a `path` is
// read as the text String(path) (the web finds the layer in it) and only a text can be in a voice's `uses` (an array that reads like a path is not).
bool usesTimbreField(const Json& voices, const Json& path);

// tags.js. Domain: two tracks' `tags`. true when the chosen tags differ and every one that differs is a sound-only tag (an entry in the sound table, none in the play table). Never
// throws; what is no { category: [list] } gives false. A tag of any value: the web's Set keeps a number and a text apart and every list or object as another one, and reads a
// non-text as the text String(tag) in the tables.
bool isSoundOnlyChange(const Json& prevTags, const Json& nextTags);

// ui/tag-effects.js. Domain: a tag id and a track as the app holds it. Returns { play, sound, form, kinds, effective } as the web does. A `tag` that is no text is read as String(tag);
// a track that is no object has no fields. A knob "set by hand" is any own field of a group of `track.timbre` (even null); a group that is a text or a list has `length` as a member
// (a text also `sub`, the name of the knob bass.sub), which the web counts as set: the core knows those members only (shortcut in timbre.cpp). Never throws.
Json tagEffect(const Json& tag, const Json& track);

// ui/organ-tuning.js. Domain: { leslie: 'off' | 'slow' | 'auto' | 'fast', drive: null | 0..1 } (DEFAULT_ORGAN is `auto` and null: nothing). Returns the tuning of every organ preset, or {}.
// Anything else counts as the default, as in the web app. Never throws.
Json organTuning(const Json& organ);
// ui/organ-tuning.js. Domain: the variant of an organ voice. The drive (0..1) of its preset; 0 for a name that is no preset. Throws std::invalid_argument only if a preset's tunables had no drive (the generated data always has one).
double presetDrive(const Json& variant);

} // namespace btg::detail
