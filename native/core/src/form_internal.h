#pragma once

// Rolling and editing a song form, on JSON values, one function for each of the web app's with its name: resolveTemplate and rollForm
// (core/form-roll.js, form_roll.cpp), limits, editPart, setLocked, addPart, copyPart, deletePart and movePart (ui/form-ui.js, form_edit.cpp).
// native/core/tests/test_logic.cpp compares them with the web app one by one. Control thread only.
//
// Each function says what the web app's callers hand it (its domain: src/ui/state.js, form-strip.js and profile-parts.js) and what the core does outside it.
// Inside the domain, and for every input the JavaScript itself guards or throws on, the answer is the JavaScript's (the tests hold that). Outside:
//  - where the JavaScript throws, the core throws std::invalid_argument (the message is not the JavaScript's);
//  - where the JavaScript coerces a value (a text read as a number by Math.round or as an index, a number joined to a text) and goes on, the core does NOT rebuild the
//    coercion: it throws std::invalid_argument, so that it never answers differently without saying so. These places are named below and marked `shortcut:` in the code.
// A missing value ("undefined") and null are the same null here where the JavaScript treats them alike. Where a patch or an argument is set to `undefined` on purpose
// (editPart's reset of a field, setLocked's `locked`), a JSON value cannot say so: it is a discarded value, Json(Json::value_t::discarded), as normalizeForm's `undefined`.

#include "track_internal.h"

namespace btg::detail {

// form-roll.js. Domain: what rollForm hands it: `templateOrAuto` a template id, 'auto' or missing; `styleId` a style id or missing; `tags` a track's tags or missing. Any
// other value is handled as the JavaScript does (an unknown template is pop, a style that is no text or no key of the table is unknown); never throws.
// Returns { template, auto }.
Json resolveTemplate(const Json& templateOrAuto, const Json& styleId, const Json& tags);

// form-roll.js. Domain: `args` is { template, style, targetBars, feel, seed, tags, previous } as state.js and profile-parts.js hand it; every field may be missing. Like the
// JavaScript it takes anything (an `args` that is no object has no field; a target, a feel, tags or a previous form of another kind count as missing or broken) and never
// throws: a seed that is no number is 0, as the JavaScript says itself. The result is { template, auto, feel, sections } and passes checkForm.
// A number as the seed of any value is the web's (`seed >>> 0`, see seedBase).
Json rollForm(const Json& args);

// form-ui.js. Domain: `form` an object with a list of parts `sections` (a form as the strip holds it: valid, or a form that editing built); `index` a number (the selected
// part; any value, also one outside the form: the part is then missing). Throws std::invalid_argument where the JavaScript throws (no form, no `sections`) and
// where it would coerce (an `index` that is no number, `sections` that is no list, a part whose `bars` is a text, a boolean, a list or an object).
Json limits(const Json& form, const Json& index);

// form-ui.js. Domain as limits, and `patch` an object of the fields { type, bars, level, density, transition, crash } (a field set to `undefined` on purpose is a discarded
// value: it resets the field). Returns { form, index } or null. A `bars` that is null or undefined (set to it on purpose) gives null, as in the web (Math.round makes 0 and NaN of
// them: no part of that length); a `bars` that is a text, a boolean, a list or an object throws (the web rounds it as a number). A patch that is no object throws too.
Json editPart(const Json& form, const Json& index, const Json& patch);
// form-ui.js. Domain as limits; `locked` any value (the web stores what it gets). Returns { form, index } or null.
Json setLocked(const Json& form, const Json& index, const Json& locked);
// form-ui.js. Domain as limits. Returns { form, index } or null (no room for a part of 8 bars).
Json addPart(const Json& form);
// form-ui.js. Domain as limits. Returns { form, index } or null.
Json copyPart(const Json& form, const Json& index);
// form-ui.js. Domain as limits. Returns { form, index } or null.
Json deletePart(const Json& form, const Json& index);
// form-ui.js. Domain as limits; `dir` a number (-1 left, +1 right; another one gives the part at that distance, or none). Throws for a `dir` that is no number (the web
// concatenates a text). Returns { form, index } or null.
Json movePart(const Json& form, const Json& index, const Json& dir);

// form-types.js FORM_LIMITS (music.json): "parts", "bars", "length", "levelMin", "levelMax", "densityMin" or "densityMax".
double formLimit(const char* name);

} // namespace btg::detail
